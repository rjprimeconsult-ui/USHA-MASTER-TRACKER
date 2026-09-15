/**
 * GET /api/routine/tick — Routine Builder minute scheduler (spec §6b).
 *
 * Triggered by Supabase pg_cron → pg_net every minute (supabase/routine-tick-cron.sql)
 * with `Authorization: Bearer <CRON_SECRET>`. Fails CLOSED when CRON_SECRET is unset.
 *
 * Per entitled agent with a valid zone: compose today (the SAME pure functions the
 * client runs), freeze started appointments + realized owed minutes through the
 * routine_day_write RPC, then (if subscribed) claim-before-send reminders in
 * routine_push_log. Never selects the prospects blob (routine_appt_rows RPC) and
 * never writes a user_kv row directly. Push copy is name-free by construction.
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 * CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, NEXT_PUBLIC_SITE_URL.
 */
import { createClient } from '@supabase/supabase-js';
import { canAccessBetaFeature } from '@/lib/featureFlags';
import { appUrl } from '@/lib/appUrl.mjs';
import { isValidTimeZone, addDays } from '@/lib/tz.mjs';
import { tickAgent, buildPayload, classifySend, retryEligible, LOG_WINDOW_MIN } from '@/lib/routineTick.mjs';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY, PUSH_SUBS_KEY, ROUTINE_FEATURE_KEY } from '@/lib/routineKeys.mjs';
import { pushConfigured, sendPushAll, pruneDeadSubs } from '@/lib/pushServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHUNK = 100;
const DAY_MS = 86400000;

const parseValue = (v) => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return undefined; } } return v; };
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const groupBy = (rows) => { const m = new Map(); for (const r of rows || []) { if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id).push(r); } return m; };

export async function GET(req) {
  // Fail CLOSED (mirrors reminders/route.js:245-249).
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) return new Response('Unauthorized', { status: 401 });

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  const supa = createClient(url, key, { auth: { persistSession: false } });

  const now = Date.now();
  const summary = {
    compose_eligible: 0, send_eligible: 0, due: 0, claimed: 0, sent: 0, failed: 0, retried: 0, stale_claimed: 0,
    appts_due: 0, appts_sent: 0, frozen: 0, freeze_failed: 0,
    skipped: { not_entitled: 0, disabled: 0, bad_tz: 0, no_subs: 0, cooldown: 0, already_done: 0, already_held: 0, bad_shape: 0, prune_failed: 0, push_not_configured: 0 },
    errors: [],
  };
  const pushOn = pushConfigured();
  if (!pushOn) summary.skipped.push_not_configured = 1; // step 0: sends skipped, freeze still runs

  // ---- Phase A: settings + profiles + subscriptions ----
  const { data: settingsRows, error: sErr } = await supa.from('user_kv').select('user_id, value').eq('key', ROUTINE_SETTINGS_KEY);
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
  const userIds = [...new Set((settingsRows || []).map((r) => r.user_id))];
  if (userIds.length === 0) return Response.json(summary);

  const profiles = new Map();
  const subsByUser = new Map();
  for (const chunk of chunks(userIds, CHUNK)) {
    // literal on purpose: sourceInvariants' selectStrings() only reads literal .select('…') arguments
    const { data: pRows, error: pErr } = await supa.from('profiles').select('id, email, subscription_status, subscription_tier, trial_ends_at, is_complimentary, is_admin, past_due_since').in('id', chunk);
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
    for (const p of pRows || []) profiles.set(p.id, p);
    const { data: subRows, error: subErr } = await supa.from('user_kv').select('user_id, value').eq('key', PUSH_SUBS_KEY).in('user_id', chunk);
    if (subErr) return Response.json({ error: subErr.message }, { status: 500 });
    for (const r of subRows || []) { const v = parseValue(r.value); subsByUser.set(r.user_id, Array.isArray(v) ? v : []); }
  }

  // ---- Step 2: eligibility (Phase B runs only for composeEligible) ----
  const settingsByUser = new Map();
  const eligible = [];
  for (const r of settingsRows) {
    const s = parseValue(r.value);
    if (s === undefined) { summary.skipped.bad_shape++; continue; } // counted once (§6b.2)
    const settings = s && typeof s === 'object' ? s : null;
    settingsByUser.set(r.user_id, settings);
    const access = canAccessBetaFeature(ROUTINE_FEATURE_KEY, profiles.get(r.user_id) || null);
    if (access.canAccess !== true) { summary.skipped.not_entitled++; continue; }
    if (!isValidTimeZone(settings?.timezone)) { summary.skipped.bad_tz++; continue; }
    eligible.push(r.user_id);
  }

  const prefixes = [utcDay(now - DAY_MS), utcDay(now), utcDay(now + DAY_MS)];
  const since = new Date(now - LOG_WINDOW_MIN * 60000).toISOString();

  // ---- Phase B per chunk ----
  for (const chunk of chunks(eligible, CHUNK)) {
    const readAt = new Date().toISOString();
    const [blocksQ, dayQ, logQ, apptQ] = await Promise.all([
      supa.from('user_kv').select('user_id, value').eq('key', ROUTINE_BLOCKS_KEY).in('user_id', chunk),
      supa.from('user_kv').select('user_id, value').eq('key', ROUTINE_DAY_KEY).in('user_id', chunk),
      supa.from('routine_push_log').select('user_id, fire_key, block_id, fire_at_utc, status, attempts, created_at').in('user_id', chunk).gte('created_at', since),
      supa.rpc('routine_appt_rows', { p_user_ids: chunk, p_prefixes: prefixes }),
    ]);
    if (logQ.error) return Response.json({ error: 'log read failed: ' + logQ.error.message }, { status: 500 });
    // A failed read is NOT an empty input: composing on [] would zero an agent's
    // realized owed minutes through the CAS. Skip the chunk; next minute retries.
    if (blocksQ.error || dayQ.error || apptQ.error) {
      summary.errors.push({ chunk: chunk.length, err: 'phase B read failed: ' + (blocksQ.error || dayQ.error || apptQ.error).message });
      continue;
    }
    const blocksBy = new Map((blocksQ.data || []).map((r) => [r.user_id, r.value]));
    const dayBy = new Map((dayQ.data || []).map((r) => [r.user_id, r.value]));
    const logBy = groupBy(logQ.data);
    const apptBy = groupBy(apptQ.data);

    for (const userId of chunk) {
      try {
        const blocksRaw = parseValue(blocksBy.get(userId));
        const dayRaw = parseValue(dayBy.get(userId));
        if (blocksRaw === undefined || dayRaw === undefined) summary.skipped.bad_shape++;
        const apptRows = (apptBy.get(userId) || []).map((r) => ({ id: r.id, stage: r.stage, appointmentTime: r.appointment_time, archivedAt: r.archived_at }));
        const subs = subsByUser.get(userId) || [];
        const logRows = logBy.get(userId) || [];

        const res = tickAgent({
          canAccess: true, settings: settingsByUser.get(userId),
          blocks: Array.isArray(blocksRaw) ? blocksRaw : [],
          dayRecords: Array.isArray(dayRaw) ? dayRaw : [],
          apptRows, logRows, subs, now, readAt,
        });
        if (res.skip) { summary.skipped[res.skip]++; continue; }
        summary.compose_eligible++;
        summary.skipped.cooldown += res.skipped.cooldown;
        summary.skipped.already_done += res.skipped.already_done;
        summary.skipped.already_held += res.skipped.already_held;

        // Step 4: freeze — one RPC per agent, only when there is something to write.
        // p_floor carries §4b's 7-day retention into the function: without it nothing
        // server-side ever prunes routine_day_v1 and the jsonb this tick re-reads every
        // minute grows without bound (the client's write path is the only other pruner,
        // and an agent who never opens the tab never runs it).
        if (res.freezeRecords.length) {
          const { data: written, error: fErr } = await supa.rpc('routine_day_write', { p_user: userId, p_records: res.freezeRecords, p_floor: addDays(res.today, -7) });
          if (fErr) { summary.freeze_failed++; summary.errors.push({ user_id: userId, err: 'freeze: ' + fErr.message }); }
          else summary.frozen += Array.isArray(written) ? written.length : 0;
        }

        if (res.sendSkip) { summary.skipped[res.sendSkip]++; continue; }
        if (!pushOn) continue;
        summary.send_eligible++;
        summary.due += res.due.length;
        summary.appts_due += res.due.filter((d) => d.kind === 'appt').length;
        if (res.due.length === 0) continue;

        // Step 5: claim-before-send.
        const existing = new Map(logRows.map((r) => [r.fire_key, r]));
        const fresh = res.due.filter((d) => !existing.has(d.fire_key));
        const toSend = [];
        if (fresh.length) {
          const rows = fresh.map((d) => ({ user_id: userId, fire_key: d.fire_key, block_id: d.block_id, local_day: res.today, fire_at_utc: new Date(d.fireAt).toISOString(), status: 'claimed', attempts: 1 }));
          const { data: claimed, error: cErr } = await supa.from('routine_push_log').upsert(rows, { onConflict: 'user_id,fire_key', ignoreDuplicates: true }).select('fire_key');
          if (cErr) summary.errors.push({ user_id: userId, err: 'claim: ' + cErr.message });
          else {
            const got = new Set((claimed || []).map((r) => r.fire_key));
            summary.claimed += got.size;
            for (const d of fresh) if (got.has(d.fire_key)) toSend.push({ d, attempts: 1 });
          }
        }
        // Step 7: one CAS retry for failed(attempts=1) or stale claimed rows still inside grace.
        for (const d of res.due) {
          const row = existing.get(d.fire_key);
          if (!row || !retryEligible(row, now)) continue;
          const { data: cas, error: rErr } = await supa.from('routine_push_log')
            .update({ status: 'claimed', attempts: 2 })
            .eq('user_id', userId).eq('fire_key', d.fire_key).eq('attempts', 1).in('status', ['failed', 'claimed'])
            .select('fire_key');
          if (rErr) { summary.errors.push({ user_id: userId, err: 'retry: ' + rErr.message }); continue; }
          if ((cas || []).length === 1) { summary.retried++; if (row.status === 'claimed') summary.stale_claimed++; toSend.push({ d, attempts: 2 }); }
        }

        // Step 6: send one push per item; step 7: stamp.
        let live = subs;
        for (const { d, attempts } of toSend) {
          const payload = buildPayload(d, d.next, now, appUrl());
          const r = await sendPushAll(live, payload);
          if (r.dead.length) {
            const pr = await pruneDeadSubs(supa, userId, r.dead);
            if (!pr.ok) summary.skipped.prune_failed++;
            live = live.filter((s) => !r.dead.includes(s?.endpoint));
          }
          const cls = classifySend({ sentCount: r.sentCount, failures: r.failures, allDead: r.sentCount === 0 && r.failures.length === 0 && r.dead.length > 0 });
          const stamp = { status: cls.status, attempts: cls.status === 'sent' ? attempts : Math.max(attempts, cls.attempts), error: cls.error };
          if (cls.status === 'sent') stamp.sent_at = new Date().toISOString();
          const { error: uErr } = await supa.from('routine_push_log').update(stamp).eq('user_id', userId).eq('fire_key', d.fire_key);
          if (uErr) summary.errors.push({ user_id: userId, err: 'stamp: ' + uErr.message });
          if (cls.status === 'sent') { summary.sent++; if (d.kind === 'appt') summary.appts_sent++; } else summary.failed++;
        }
      } catch (e) {
        summary.errors.push({ user_id: userId, err: String(e?.message || e) });
      }
    }
  }

  // Step 8: housekeeping at minute 7 of each hour.
  if (new Date(now).getUTCMinutes() === 7) {
    const { error: hErr } = await supa.from('routine_push_log').delete().lt('created_at', new Date(now - 30 * DAY_MS).toISOString());
    if (hErr) summary.errors.push({ err: 'housekeeping: ' + hErr.message });
  }
  return Response.json(summary);
}
