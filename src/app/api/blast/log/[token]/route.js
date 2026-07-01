/**
 * POST /api/blast/log/[token]
 *
 * Public endpoint — the Cowork ringy-textdrip-blast skill POSTs each completed
 * blast/repurpose run here (right after it appends the row to blast-log.csv).
 * The URL token (profiles.blast_webhook_token) is the only auth — the skill
 * can't send custom headers reliably.
 *
 * Flow mirrors the Benepath webhook: resolve token → userId, parse + normalize
 * the blast, upsert into blast_log_v1 with compare-and-swap retry (dedup on
 * date+platform+time+campaign so a re-POST never double-logs), bump counters.
 * Always returns 200.
 */

import { createClient } from '@supabase/supabase-js';
import { normalizeBlastPayload, upsertBlast } from '@/lib/blastLog.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cleanEnv(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

function noop200() {
  return new Response(JSON.stringify({ ok: false }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

// Always-200 success with an explicit token so the caller can match on it.
function ok200(payload) {
  return new Response(JSON.stringify({ ok: true, status: 'success', ...payload }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET() {
  return new Response(JSON.stringify({ ok: true, status: 'success', message: 'Blast log endpoint ready' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
export async function HEAD() {
  return new Response(null, { status: 200 });
}

// Tolerant body parse: JSON, form-urlencoded/multipart, or sniffed raw text.
async function parseBody(req) {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) return await req.json();
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const fd = await req.formData();
      const obj = {};
      for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v : '';
      return obj;
    }
    const text = (await req.text()).trim();
    if (!text) return {};
    if (text.startsWith('{') || text.startsWith('[')) { try { return JSON.parse(text); } catch { /* fall through */ } }
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
      console.error('[blast/log] server not configured');
      return noop200();
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Generous fail-open rate limit — caps a runaway flood on a leaked token
    // (~10k/min, far above any real blast). Never blocks capture if the limiter
    // RPC is unavailable (e.g. migration not yet run) — errors just proceed.
    try {
      const { data: rlOk, error: rlErr } = await admin.rpc('check_webhook_rate_limit', { p_token: token, p_limit: 10000, p_window_secs: 60 });
      if (!rlErr && rlOk === false) {
        return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
      }
    } catch { /* fail open */ }

    // ---- Resolve token → userId ----
    const { data: profileRow, error: profileErr } = await admin
      .from('profiles').select('id').eq('blast_webhook_token', token).maybeSingle();
    if (profileErr) { console.error(`[blast/log] profile lookup error: ${profileErr.message}`); return noop200(); }
    if (!profileRow?.id) return noop200(); // unknown token — silent noop
    const userId = profileRow.id;

    // ---- Parse + normalize ----
    const body = await parseBody(req);
    const blast = normalizeBlastPayload(body);
    // A blast must name a platform to be meaningful. Also REJECT Ringy: it is now
    // captured authoritatively and atomically by the Ringy webhook into
    // blast_counters (one increment per lead). Accepting a Ringy skill-POST here
    // too would double-count the same blast. This endpoint handles TextDrip (and
    // any non-Ringy) only.
    if (!blast.platform || blast.platform === 'Ringy') {
      console.log(`[blast/log] user=${userId} skipped — platform=${blast.platform || 'none'} (Ringy is captured natively)`);
      return ok200({ action: 'skipped' });
    }

    const now = new Date().toISOString();

    // ---- Upsert into blast_log_v1 with optimistic-concurrency retry ----
    let action = null, wrote = false;
    for (let attempt = 0; attempt < 5 && !wrote; attempt++) {
      const cur = await admin.from('user_kv').select('value, updated_at')
        .eq('user_id', userId).eq('key', 'blast_log_v1').maybeSingle();
      if (cur.error) { console.error(`[blast/log] load error user=${userId}: ${cur.error.message}`); return noop200(); }
      const list = Array.isArray(cur.data?.value) ? cur.data.value : [];
      const prior = cur.data?.updated_at ?? null;
      const res = upsertBlast(list, blast, now);
      action = res.action;
      const ts = new Date().toISOString();
      if (prior === null) {
        const ins = await admin.from('user_kv').insert({ user_id: userId, key: 'blast_log_v1', value: res.list, updated_at: ts });
        if (!ins.error) { wrote = true; break; }
      } else {
        const upd = await admin.from('user_kv')
          .update({ value: res.list, updated_at: ts })
          .eq('user_id', userId).eq('key', 'blast_log_v1').eq('updated_at', prior).select('user_id');
        if (!upd.error && Array.isArray(upd.data) && upd.data.length > 0) { wrote = true; break; }
      }
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
    if (!wrote) { console.error(`[blast/log] write contention — gave up user=${userId}`); return noop200(); }

    // ---- Bump counters (non-fatal) ----
    const cfgRes = await admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'blast_config_v1').maybeSingle();
    const cfg = cfgRes.data?.value ?? {};
    admin.from('user_kv').upsert(
      { user_id: userId, key: 'blast_config_v1', value: { ...cfg, lastReceivedAt: now, blastCount: ((cfg.blastCount || 0) + (action === 'create' ? 1 : 0)) }, updated_at: now },
      { onConflict: 'user_id,key' },
    ).then(({ error }) => { if (error) console.error(`[blast/log] counter error user=${userId}: ${error.message}`); });

    console.log(`[blast/log] user=${userId} action=${action} platform=${blast.platform}`);
    return ok200({ action });
  } catch (e) {
    console.error('[blast/log] uncaught error:', e?.message || String(e));
    return noop200();
  }
}
