/**
 * POST /api/benepath/webhook/[token]
 *
 * Public endpoint — Benepath POSTs a new lead here in real time (configured in
 * the Benepath portal under Integrations → New Integration → Posting URL). The
 * URL token (stored in profiles.benepath_webhook_token) is the only auth
 * mechanism — Benepath cannot send custom headers.
 *
 * Benepath's content-type / field names are not fixed, so the body parser
 * accepts JSON, form-urlencoded, and multipart, and the normaliser matches a
 * broad alias set (src/lib/benepath.mjs). We also record the raw field NAMES
 * (not values — no PHI) so the field mapping can be confirmed from a real lead.
 *
 * Flow mirrors the Ringy webhook: resolve token → userId, parse + normalize,
 * upsert into prospects_v1 with compare-and-swap retry, bump config counters.
 * Always returns 200 so the vendor doesn't hammer retries.
 *
 * SECURITY: never log PHI (names, notes, phone, email). Log only aggregate.
 */

import { createClient } from '@supabase/supabase-js';
import { normalizeBenepathPayload, upsertBenepathLead } from '@/lib/benepath.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
 * Parse the request body into a plain object regardless of how Benepath sends
 * it: JSON, application/x-www-form-urlencoded, multipart/form-data, or a raw
 * body we sniff (JSON-looking text, else a query string).
 */
async function parseBody(req) {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      return await req.json();
    }
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const fd = await req.formData();
      const obj = {};
      for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v : '';
      return obj;
    }
    // Unknown / missing content-type — sniff the raw text.
    const text = (await req.text()).trim();
    if (!text) return {};
    if (text.startsWith('{') || text.startsWith('[')) {
      try { return JSON.parse(text); } catch { /* fall through */ }
    }
    try {
      const params = new URLSearchParams(text);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      if (Object.keys(obj).length) return obj;
    } catch { /* ignore */ }
    return {};
  } catch {
    return {};
  }
}

export async function POST(req, ctx) {
  try {
    const params = await ctx?.params;
    const token = params?.token || '';
    if (!token) return noop200();

    const supabaseUrl = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey  = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseUrl || !serviceKey) {
      console.error('[benepath/webhook] server not configured');
      return noop200();
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ---- Resolve token → userId ----
    const { data: profileRow, error: profileErr } = await admin
      .from('profiles')
      .select('id')
      .eq('benepath_webhook_token', token)
      .maybeSingle();

    if (profileErr) {
      console.error(`[benepath/webhook] profile lookup error: ${profileErr.message}`);
      return noop200();
    }
    if (!profileRow?.id) {
      // Unknown token — silently noop (don't leak whether the token exists)
      return noop200();
    }
    const userId = profileRow.id;

    // ---- Parse + normalize ----
    const body = await parseBody(req);
    const receivedKeys = (body && typeof body === 'object') ? Object.keys(body).slice(0, 60) : [];
    const normalized = normalizeBenepathPayload(body);

    // Need at least one identity signal to key off of.
    if (!normalized.phone && !normalized.email && !normalized.benepathLeadId) {
      console.log(`[benepath/webhook] user=${userId} skipped — no phone/email/leadId (keys=${receivedKeys.length})`);
      // Still record the field names so the agent/dev can see what arrived.
      recordKeys(admin, userId, receivedKeys).catch(() => {});
      return noop200();
    }

    const now = new Date().toISOString();

    // ---- Load config (defaultStage) ----
    const cfgResult = await admin.from('user_kv').select('value')
      .eq('user_id', userId).eq('key', 'benepath_config_v1').maybeSingle();
    if (cfgResult.error) {
      console.error(`[benepath/webhook] config load error user=${userId}: ${cfgResult.error.message}`);
      return noop200();
    }
    const cfg = cfgResult.data?.value ?? {};
    const defaultStage = cfg.defaultStage ?? 'PENDING_DECISION';

    // ---- Upsert into prospects_v1 with optimistic-concurrency retry ----
    let action = null;
    let wrote = false;
    for (let attempt = 0; attempt < 5 && !wrote; attempt++) {
      const cur = await admin.from('user_kv').select('value, updated_at')
        .eq('user_id', userId).eq('key', 'prospects_v1').maybeSingle();
      if (cur.error) {
        console.error(`[benepath/webhook] prospects load error user=${userId}: ${cur.error.message}`);
        return noop200();
      }
      const prospects = Array.isArray(cur.data?.value) ? cur.data.value : [];
      const prior = cur.data?.updated_at ?? null;
      const res = upsertBenepathLead(prospects, normalized, defaultStage, now);
      action = res.action;
      const ts = new Date().toISOString();

      if (prior === null) {
        const ins = await admin.from('user_kv')
          .insert({ user_id: userId, key: 'prospects_v1', value: res.prospects, updated_at: ts });
        if (!ins.error) { wrote = true; break; }
      } else {
        const upd = await admin.from('user_kv')
          .update({ value: res.prospects, updated_at: ts })
          .eq('user_id', userId).eq('key', 'prospects_v1').eq('updated_at', prior)
          .select('user_id');
        if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) { wrote = true; break; }
      }
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
    if (!wrote) {
      console.error(`[benepath/webhook] prospects write contention — gave up user=${userId}`);
      return noop200();
    }

    // ---- Bump config counters + record field names (non-fatal) ----
    const updatedCfg = {
      ...cfg,
      lastReceivedAt: now,
      importedCount: ((cfg.importedCount || 0) + (action === 'create' ? 1 : 0)),
      lastReceivedKeys: receivedKeys,
    };
    admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'benepath_config_v1', value: updatedCfg, updated_at: now },
        { onConflict: 'user_id,key' }
      )
      .then(({ error }) => {
        if (error) console.error(`[benepath/webhook] config counter update error user=${userId}: ${error.message}`);
      });

    console.log(`[benepath/webhook] user=${userId} action=${action} keys=${receivedKeys.length}`);
    return ok200({ action });
  } catch (e) {
    console.error('[benepath/webhook] uncaught error:', e?.message || String(e));
    return noop200();
  }
}

/** Persist just the field NAMES from a payload (PII-free) for mapping help. */
async function recordKeys(admin, userId, receivedKeys) {
  const now = new Date().toISOString();
  const { data } = await admin.from('user_kv').select('value')
    .eq('user_id', userId).eq('key', 'benepath_config_v1').maybeSingle();
  const cfg = data?.value ?? {};
  await admin.from('user_kv').upsert(
    { user_id: userId, key: 'benepath_config_v1', value: { ...cfg, lastReceivedKeys: receivedKeys, lastReceivedAt: now }, updated_at: now },
    { onConflict: 'user_id,key' }
  );
}
