/**
 * POST /api/webforms/webhook/[token]
 *
 * Public endpoint — a visitor's website contact form (or the site's form
 * plugin / Zapier / raw fetch) POSTs lead data here. The URL token (stored in
 * profiles.webforms_webhook_token) is the only auth mechanism.
 *
 * Flow:
 *   1. Resolve token → userId via service-role profiles query.
 *   2. Parse the body ONCE (multipart / json / urlencoded / raw text).
 *   3. Deterministically extract name/phone/email/state/zip/situation.
 *   4. AI fallback (Claude Haiku) ONLY when extraction isn't confident.
 *   5. Build a prospect + upsert into prospects_v1 (compare-and-swap loop).
 *   6. Best-effort bump webforms_config_v1 counters.
 *   7. Always return 200 (a form plugin retrying on non-200 duplicates leads).
 *
 * SECURITY: never log PHI (names, notes, phone, email). Log only aggregate
 * counts / keys / booleans — mirrors the Ringy route's discipline.
 *
 * NOTE: deliberately does NOT do blast increment, disposition mapping, or a
 * ringy_config load — none of that applies to website leads.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  normalizeBody,
  flattenRecord,
  extractWebformFields,
  buildWebformProspect,
  upsertWebformProspect,
  buildWebformAiPrompt,
} from '@/lib/webforms.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Body-size caps so an untrusted POST can't stream an unbounded body into memory.
const MAX_TEXT_BYTES = 65536;      // 64KB for json / urlencoded / raw text
const MAX_MULTIPART_VALUE = 8192;  // 8KB per multipart string field
const AI_TIMEOUT_MS = 8000;        // hard cap on the fallback AI call

function cleanEnv(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

function noop200() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok200(payload) {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * runAiFallback(flat) — ask Claude Haiku to extract the standard fields when the
 * deterministic pass wasn't confident. Returns a plain object of the extracted
 * fields (empty object on any failure). Never throws.
 */
async function runAiFallback(flat) {
  const apiKey = cleanEnv(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) return {};
  try {
    // maxRetries:0 so the 8s timeout fails fast instead of the SDK retrying it.
    const client = new Anthropic({ apiKey, maxRetries: 0 });
    const resp = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: buildWebformAiPrompt(flat) }],
      },
      { timeout: AI_TIMEOUT_MS },
    );
    const textBlock = Array.isArray(resp?.content)
      ? resp.content.find((b) => b.type === 'text')
      : null;
    if (!textBlock?.text) return {};
    // Defensive parse: grab the first {...} object in the response text.
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    console.error('[webforms/webhook] AI fallback error:', e?.message || String(e));
    return {};
  }
}

export async function POST(req, ctx) {
  try {
    // Next.js 16: dynamic-route params are ASYNC and must be awaited.
    const params = await ctx?.params;
    const token = params?.token || '';
    if (!token) return noop200();

    const supabaseUrl = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey  = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseUrl || !serviceKey) {
      console.error('[webforms/webhook] server not configured');
      return noop200();
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ---- Resolve token → userId ----
    const { data: profileRow, error: profileErr } = await admin
      .from('profiles')
      .select('id')
      .eq('webforms_webhook_token', token)
      .maybeSingle();

    if (profileErr) {
      console.error(`[webforms/webhook] profile lookup error: ${profileErr.message}`);
      return noop200();
    }
    if (!profileRow?.id) {
      // Unknown token — silently noop (do not leak whether the token exists).
      return noop200();
    }

    const userId = profileRow.id;

    // ---- Parse body EXACTLY ONCE ----
    // The request stream can only be consumed once, so we branch on Content-Type
    // and pick a single read path. NEVER call req.json() after req.text().
    const contentType = req.headers.get('content-type') || '';
    let raw;
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      try {
        const form = await req.formData();
        const obj = {};
        for (const [k, v] of form.entries()) {
          // Keep only string values; skip File parts. Cap each value.
          if (typeof v === 'string') obj[k] = v.slice(0, MAX_MULTIPART_VALUE);
        }
        raw = obj;
      } catch {
        return noop200();
      }
    } else {
      let text;
      try {
        text = (await req.text()).slice(0, MAX_TEXT_BYTES);
      } catch {
        return noop200();
      }
      // Garbage / unrecognized content-type → preserve the raw text so nothing
      // the visitor sent is lost; extraction just won't find named fields.
      raw = normalizeBody(contentType, text) || { _raw: text.slice(0, 4000) };
    }

    // ---- Deterministic extraction ----
    const flat = flattenRecord(raw);
    const extraction = extractWebformFields(flat);
    let usedAi = false;

    // ---- AI fallback ONLY when not confident ----
    if (!extraction.confident) {
      usedAi = true;
      const ai = await runAiFallback(flat);
      // Merge non-empty AI fields — heuristic WINS over AI (only fill gaps).
      for (const key of ['name', 'phone', 'email', 'state', 'zip', 'situation']) {
        const val = ai && typeof ai[key] === 'string' ? ai[key].trim() : '';
        if (val && !extraction.fields[key]) extraction.fields[key] = val;
      }
      // Recompute confidence — result may still be needsReview.
      extraction.confident = !!extraction.fields.name
        && !!(extraction.fields.phone || extraction.fields.email);
    }

    const now = new Date().toISOString();

    // ---- Build prospect + upsert into prospects_v1 with CAS retry ----
    const incoming = buildWebformProspect(extraction, flat, now);

    let created = false;
    let wrote = false;
    for (let attempt = 0; attempt < 5 && !wrote; attempt++) {
      const cur = await admin.from('user_kv').select('value, updated_at')
        .eq('user_id', userId).eq('key', 'prospects_v1').maybeSingle();
      if (cur.error) {
        console.error(`[webforms/webhook] prospects load error user=${userId}: ${cur.error.message}`);
        return noop200();
      }
      const prospects = Array.isArray(cur.data?.value) ? cur.data.value : [];
      const prior = cur.data?.updated_at ?? null;
      // Pass the fresh extracted message so a re-submission's new inquiry text
      // rides into the touch note (fill-empty would otherwise drop it).
      const res = upsertWebformProspect(prospects, incoming, now, extraction.fields?.situation || '');
      created = res.created;
      const ts = new Date().toISOString();

      if (prior === null) {
        // No row yet — insert. If a concurrent request inserted first, the PK
        // conflict errors and we fall through to retry on the update path.
        const ins = await admin.from('user_kv')
          .insert({ user_id: userId, key: 'prospects_v1', value: res.list, updated_at: ts });
        if (!ins.error) { wrote = true; break; }
      } else {
        // CAS: only succeeds if updated_at is still what we read.
        const upd = await admin.from('user_kv')
          .update({ value: res.list, updated_at: ts })
          .eq('user_id', userId).eq('key', 'prospects_v1').eq('updated_at', prior)
          .select('user_id');
        if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) { wrote = true; break; }
      }
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
    if (!wrote) {
      console.error(`[webforms/webhook] prospects write contention — gave up user=${userId}`);
      return noop200();
    }

    // ---- Bump config counters (best-effort, fire-and-forget) ----
    const cfgRes = await admin.from('user_kv').select('value')
      .eq('user_id', userId).eq('key', 'webforms_config_v1').maybeSingle();
    const cfg = cfgRes.error ? {} : (cfgRes.data?.value ?? {});
    const updatedCfg = {
      ...cfg,
      lastReceivedAt: now,
      receivedCount: ((cfg.receivedCount || 0) + 1),
    };
    admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'webforms_config_v1', value: updatedCfg, updated_at: now },
        { onConflict: 'user_id,key' }
      )
      .then(({ error }) => {
        if (error) console.error(`[webforms/webhook] config counter update error user=${userId}: ${error.message}`);
      });

    // Aggregate log only — no PHI (userId + counts + whether AI ran).
    const needsReview = !extraction.confident;
    console.log(`[webforms/webhook] user=${userId} created=${created} needsReview=${needsReview} ai=${usedAi} keys=${Object.keys(flat).length}`);

    return ok200({ created, needsReview });
  } catch (e) {
    // Log server-side, always 200 to avoid form-plugin retry storms.
    console.error('[webforms/webhook] uncaught error:', e?.message || String(e));
    return noop200();
  }
}
