/**
 * POST /api/ringy/webhook/[token]
 *
 * Public endpoint — Ringy POSTs lead data here when an agent dispositions
 * a lead. The URL token (stored in profiles.ringy_webhook_token) is the
 * only auth mechanism (Ringy cannot send custom headers).
 *
 * Flow:
 *   1. Resolve token → userId via service-role profiles query.
 *   2. Parse + normalize the Ringy JSON body.
 *   3. Load ringy_config_v1 (mapping/defaultStage) + prospects_v1.
 *   4. Upsert the lead into prospects.
 *   5. Write prospects_v1 + bump lastReceivedAt / importedCount.
 *   6. Always return 200 (Ringy will hammer retries on any non-200).
 *
 * SECURITY: never log PHI (names, notes, phone, email). Log only aggregate.
 */

import { createClient } from '@supabase/supabase-js';
import { normalizeRingyPayload, upsertRingyLead, checkIsBlastDisposition } from '@/lib/ringy.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * incrementRingyBlast — a blast/repurpose tag fires ONE Ringy POST per lead, so
 * a 2,000-lead blast arrives as 2,000 POSTs in a burst. We record each hit with
 * a single ATOMIC database increment (the increment_blast RPC) keyed on
 * (user, day, platform, tag). Postgres serializes the increments at the row
 * level, so the burst lands as exactly 2,000 with NO lost updates — unlike a
 * read-modify-write of a JSON blob, where concurrent writers lose the
 * compare-and-swap race and silently drop. One fast statement per POST: no
 * retry loop, no whole-array rewrite, so it also doesn't bog the app down.
 */
async function incrementRingyBlast(admin, userId, disposition, nowIso) {
  const { error } = await admin.rpc('increment_blast', {
    p_user:     userId,
    p_date:     nowIso.slice(0, 10), // YYYY-MM-DD
    p_platform: 'Ringy',
    p_tag:      String(disposition || '').trim(),
    p_inc:      1,
  });
  if (error) {
    console.error(`[ringy/webhook] blast increment error user=${userId}: ${error.message}`);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

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

export async function POST(req, ctx) {
  try {
    // Next.js 16: dynamic-route params are ASYNC and must be awaited.
    // (Reading ctx.params.token synchronously yields undefined → silent no-op.)
    const params = await ctx?.params;
    const token = params?.token || '';
    if (!token) return noop200();

    const supabaseUrl = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey  = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseUrl || !serviceKey) {
      console.error('[ringy/webhook] server not configured');
      return noop200();
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ⚠️ CRITICAL CAPTURE PATH — do NOT add pre-processing here (rate limiting,
    // analytics, extra DB round-trips) before the blast increment. Under a fast
    // Ringy burst, latency added here drops hits: on 2026-07-01 a rate-limit RPC
    // in this exact spot dropped ~3,700 of a 6,000-lead blast. Anything like that
    // must run AFTER capture or asynchronously. Test any webhook change with
    // scripts/blast-burst-smoketest.mjs before shipping.

    // ---- Resolve token → userId ----
    const { data: profileRow, error: profileErr } = await admin
      .from('profiles')
      .select('id')
      .eq('ringy_webhook_token', token)
      .maybeSingle();

    if (profileErr) {
      console.error(`[ringy/webhook] profile lookup error: ${profileErr.message}`);
      return noop200();
    }
    if (!profileRow?.id) {
      // Unknown token — silently noop (do not leak whether the token exists)
      return noop200();
    }

    const userId = profileRow.id;

    // ---- Parse body ----
    let body;
    try {
      body = await req.json();
    } catch {
      // Unparseable body — noop
      return noop200();
    }

    // ---- Normalize ----
    const normalized = normalizeRingyPayload(body);

    const now = new Date().toISOString();

    // ---- Load config (mapping / defaultStage / blast detection) ----
    const cfgResult = await admin.from('user_kv').select('value')
      .eq('user_id', userId).eq('key', 'ringy_config_v1').maybeSingle();
    if (cfgResult.error) {
      console.error(`[ringy/webhook] config load error user=${userId}: ${cfgResult.error.message}`);
      return noop200();
    }
    const cfg          = cfgResult.data?.value ?? {};
    const mapping      = Array.isArray(cfg.mapping) ? cfg.mapping : [];
    const defaultStage = cfg.defaultStage ?? 'PENDING_DECISION';

    // ---- Blast / repurpose detection (skill-independent native capture) ----
    // Applying a blast tag in Ringy fires one POST per lead. Detect it and roll
    // those per-lead hits into ONE daily Blasts entry instead of creating a
    // prospect for each. On by default; an agent can disable it in Ringy
    // settings (blastDetectionEnabled:false) or add custom patterns.
    if (cfg.blastDetectionEnabled !== false
        && checkIsBlastDisposition(normalized.disposition, cfg.blastDispositionPatterns)) {
      const res = await incrementRingyBlast(admin, userId, normalized.disposition, now);
      if (!res.ok) {
        // Fail LOUD, not silent: if the atomic increment didn't land (RPC missing
        // because the migration hasn't run, transient DB error, etc.) return a
        // non-200 so Ringy retries this hit and it recovers — instead of silently
        // dropping the count (which is how a 2,000 blast became 119).
        console.error(`[ringy/webhook] blast increment failed user=${userId} — returning 503 so Ringy retries`);
        return new Response(JSON.stringify({ ok: false, error: 'blast increment failed' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        });
      }
      console.log(`[ringy/webhook] user=${userId} action=blast_aggregated`);
      return ok200({ action: 'blast_aggregated' });
    }

    // Skip if there's no phone and no leadId (nothing to key off of)
    if (!normalized.phone && !normalized.ringyLeadId) {
      console.log(`[ringy/webhook] user=${userId} skipped — no phone or leadId`);
      return noop200();
    }

    // ---- Upsert into prospects_v1 with optimistic-concurrency retry ----
    // The webhook is the authoritative server-side writer of the whole prospects
    // array, so two near-simultaneous POSTs for the same agent (e.g. bulk
    // dispositioning) could clobber each other. Compare-and-swap on updated_at:
    // only write if the row hasn't changed since our read; otherwise re-read and
    // retry. Prevents the lost-update; nothing here is reconciled elsewhere.
    let action = null;
    let wrote = false;
    for (let attempt = 0; attempt < 5 && !wrote; attempt++) {
      const cur = await admin.from('user_kv').select('value, updated_at')
        .eq('user_id', userId).eq('key', 'prospects_v1').maybeSingle();
      if (cur.error) {
        console.error(`[ringy/webhook] prospects load error user=${userId}: ${cur.error.message}`);
        return noop200();
      }
      const prospects = Array.isArray(cur.data?.value) ? cur.data.value : [];
      const prior = cur.data?.updated_at ?? null;
      const res = upsertRingyLead(prospects, normalized, mapping, defaultStage, now);
      action = res.action;
      const ts = new Date().toISOString();

      if (prior === null) {
        // No row yet — insert. If a concurrent request inserted first, the PK
        // conflict errors and we fall through to retry on the update path.
        const ins = await admin.from('user_kv')
          .insert({ user_id: userId, key: 'prospects_v1', value: res.prospects, updated_at: ts });
        if (!ins.error) { wrote = true; break; }
      } else {
        // CAS: only succeeds if updated_at is still what we read.
        const upd = await admin.from('user_kv')
          .update({ value: res.prospects, updated_at: ts })
          .eq('user_id', userId).eq('key', 'prospects_v1').eq('updated_at', prior)
          .select('user_id');
        if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) { wrote = true; break; }
      }
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
    if (!wrote) {
      console.error(`[ringy/webhook] prospects write contention — gave up user=${userId}`);
      return noop200();
    }

    // ---- Bump config counters ----
    const updatedCfg = {
      ...cfg,
      lastReceivedAt: now,
      importedCount: ((cfg.importedCount || 0) + (action === 'create' ? 1 : 0)),
    };
    // Non-fatal — fire and forget counter update
    admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'ringy_config_v1', value: updatedCfg, updated_at: now },
        { onConflict: 'user_id,key' }
      )
      .then(({ error }) => {
        if (error) console.error(`[ringy/webhook] config counter update error user=${userId}: ${error.message}`);
      });

    // Aggregate log only — no PHI
    console.log(`[ringy/webhook] user=${userId} action=${action}`);

    return ok200({ action });
  } catch (e) {
    // Log server-side, always 200 to avoid Ringy retry storms
    console.error('[ringy/webhook] uncaught error:', e?.message || String(e));
    return noop200();
  }
}
