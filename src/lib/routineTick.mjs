// Routine tick core (spec §6b). Pure — the route does IO around tickAgent().
import { isValidTimeZone, localDayKey, localMinuteOfDay, localWeekday, zonedTimeToUtc } from './tz.mjs';
import { sanitizeSettings, sanitizeDay, liveBlocks } from './routineModel.mjs';
import { todaysAppointments, composeDay, reconcileOwed, apptRecordId, owedId } from './routineLive.mjs';
import { formatRange, formatTime } from './routineClock.mjs';

export const LOOKAHEAD_SEC = 45;
export const GRACE_MIN = 10;
export const COOLDOWN_MIN = 15;
export const STALE_CLAIM_MIN = 2;
export const LOG_WINDOW_MIN = 60;
export const APPT_LEAD_MIN = 5;
export const APPT_DEFAULT_MIN = 30;

const MIN = 60000;

export function tickAgent({ canAccess, settings: rawSettings, blocks, dayRecords, apptRows, logRows = [], subs = [], now, readAt }) {
  if (typeof readAt !== 'string') throw new TypeError('tickAgent: readAt is required');
  const skipped = { already_done: 0, already_held: 0, cooldown: 0 };
  const out = { skip: null, composeEligible: false, sendSkip: null, tz: null, today: null, candidates: [], due: [], skipped, freezeRecords: [], items: [] };
  if (canAccess !== true) return { ...out, skip: 'not_entitled' };
  const settings = sanitizeSettings(rawSettings);
  if (!isValidTimeZone(settings.timezone)) return { ...out, skip: 'bad_tz' };
  const tz = settings.timezone;
  const nowIso = new Date(now).toISOString();
  const today = localDayKey(now, tz);
  const nowMin = localMinuteOfDay(now, tz);
  const dayStart = zonedTimeToUtc(today, 0, tz);
  const live = liveBlocks(blocks, nowIso);
  const liveForCompose = settings.activeDays.includes(localWeekday(today)) ? live : [];
  const day = sanitizeDay(dayRecords, today, nowIso);
  const items = todaysAppointments({ prospectRows: apptRows, blocks: live, dayRecords: day, settings, tz, now });
  const makeups = day.filter(r => r.kind === 'makeup' && r.day === today && !r.deletedAt);
  // rev-11 one-off events (spec 2026-09-07 §4b/§7h.3): same projected/realized split as
  // appointments — a future event is shown and reminded, but its displaced minutes are only
  // realized into `owed` once its own start instant has actually passed.
  const events = day.filter(r => r.kind === 'event' && r.day === today && !r.deletedAt);
  const projected = composeDay({ live: liveForCompose, appointments: items, makeups, events, dayRecords: day, nowMin, today });
  const attachesToday = day.filter(r => r.kind === 'attach' && r.day === today); // live + tombstoned
  const attachedLive = new Set(attachesToday.filter(r => !r.deletedAt).map(r => r.blockId));
  const doneById = new Map(day.filter(r => r.kind === 'done' && r.day === today && !r.deletedAt).map(r => [r.blockId, r.status]));
  const nextAfter = (endMin) => projected.items.find(it => it.startMin >= endMin) || null;

  const candidates = [];
  for (const it of projected.items) {
    if (it.kind === 'segment' && it.isFirst) {
      const b = it.block;
      if (!b.remind?.enabled) continue;
      if (b.category === 'appt' && attachedLive.has(b.id)) continue;
      const lead = b.remind.minutesBefore;
      const startAt = zonedTimeToUtc(today, it.startMin, tz);
      const slotSet = new Set([b.id, ...attachesToday.filter(r => r.blockId === b.id).map(r => `appt:${r.prospectId}`)]);
      candidates.push({ kind: b.category === 'appt' ? 'placeholder' : 'routine', block_id: b.id, name: b.name, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.endMin - it.startMin,
        startAt, endAt: startAt + (it.endMin - it.startMin) * MIN, fireMin: Math.max(0, it.startMin - lead), fireAt: Math.max(startAt - lead * MIN, dayStart),
        fire_key: `${b.id}|${today}|${Math.max(0, it.startMin - lead)}|${tz}`, done: doneById.get(b.id) || null, heldAt: null, slotSet, next: nextAfter(it.endMin) });
    } else if (it.kind === 'makeup' && it.isFirst) {
      const m = it.makeup, lead = settings.defaultMinutesBefore;
      const startAt = zonedTimeToUtc(today, it.startMin, tz);
      candidates.push({ kind: 'makeup', block_id: m.id, name: m.name, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.endMin - it.startMin,
        startAt, endAt: startAt + (it.endMin - it.startMin) * MIN, fireMin: Math.max(0, it.startMin - lead), fireAt: Math.max(startAt - lead * MIN, dayStart),
        fire_key: `${m.id}|${today}|${Math.max(0, it.startMin - lead)}|${tz}`, done: doneById.get(m.id) || null, heldAt: null, slotSet: new Set([m.id]), next: nextAfter(it.endMin) });
    } else if (it.kind === 'appt') {
      const slotSet = new Set([`appt:${it.prospectId}`, ...attachesToday.filter(r => r.prospectId === it.prospectId).map(r => r.blockId)]);
      candidates.push({ kind: 'appt', block_id: `appt:${it.prospectId}`, prospectId: it.prospectId, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.durationMin,
        startAt: it.instant, endAt: it.instant + it.durationMin * MIN, fireMin: Math.max(0, it.startMin - APPT_LEAD_MIN), fireAt: Math.max(it.instant - APPT_LEAD_MIN * MIN, dayStart),
        fire_key: `appt|${it.prospectId}|${today}|${Math.max(0, it.startMin - APPT_LEAD_MIN)}|${tz}`, done: null, heldAt: it.heldAt || null, slotSet, next: nextAfter(it.endMin) });
    } else if (it.kind === 'event') {
      // Deliberately NOT folded into the 'appt' branch above: that branch is name-free by
      // construction (§6b.6, prospect privacy) — an event carries no prospect data, so its
      // push copy uses its own name via the generic buildPayload fallback (below the appt/
      // placeholder check), exactly like a routine block or a make-up.
      if (!it.remind?.enabled) continue;
      const lead = Number.isFinite(it.remind?.minutesBefore) ? it.remind.minutesBefore : settings.defaultMinutesBefore;
      const startAt = zonedTimeToUtc(today, it.startMin, tz);
      candidates.push({ kind: 'event', block_id: it.id, name: it.name, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.endMin - it.startMin,
        startAt, endAt: startAt + (it.endMin - it.startMin) * MIN, fireMin: Math.max(0, it.startMin - lead), fireAt: Math.max(startAt - lead * MIN, dayStart),
        fire_key: `${it.id}|${today}|${Math.max(0, it.startMin - lead)}|${tz}`, done: null, heldAt: null, slotSet: new Set([it.id]), next: nextAfter(it.endMin) });
    }
  }

  const due = [];
  for (const c of candidates) {
    if (c.done === 'done' || c.done === 'skipped') { skipped.already_done++; continue; }
    if (c.heldAt) { skipped.already_held++; continue; }
    const grace = Math.min(GRACE_MIN, Math.floor(c.segDur / 2)) * MIN;
    if (!(c.fireAt <= now + LOOKAHEAD_SEC * 1000 && now < c.startAt + grace && now < c.endAt)) continue;
    const cool = logRows.some(r => c.slotSet.has(r.block_id) && r.fire_key !== c.fire_key && (r.status === 'claimed' || r.status === 'sent') && Math.abs(c.fireAt - new Date(r.fire_at_utc).getTime()) <= COOLDOWN_MIN * MIN);
    if (cool) { skipped.cooldown++; continue; }
    due.push(c);
  }

  // Freeze (§6b.4): started appointments + realized owed.
  const freezeRecords = [];
  const apptIds = new Set(day.filter(r => r.kind === 'appt' && r.day === today).map(r => r.id));
  for (const it of items) {
    if (it.frozen || it.instant > now) continue;
    const id = apptRecordId(today, it.prospectId, it.startMin);
    if (apptIds.has(id)) continue;
    freezeRecords.push({ id, kind: 'appt', day: today, prospectId: it.prospectId, startMin: it.startMin, durationMin: it.durationMin, source: it.source, heldAt: null, updatedAt: new Date(it.instant).toISOString(), deletedAt: null });
  }
  const started = items.filter(it => it.instant <= now);
  const startedEvents = events.filter(e => zonedTimeToUtc(today, e.startMin, tz) <= now);
  const realized = composeDay({ live: liveForCompose, appointments: started, makeups, events: startedEvents, dayRecords: day, nowMin, today });
  const storedOwed = day.find(r => r.kind === 'owed' && r.id === owedId(today) && !r.deletedAt) || null;
  const owed = reconcileOwed(storedOwed, realized, readAt, today);
  if (owed) freezeRecords.push({ ...owed, expect: storedOwed ? storedOwed.updatedAt : null });

  const sendSkip = settings.remindersEnabled === false ? 'disabled' : (!Array.isArray(subs) || subs.length === 0) ? 'no_subs' : null;
  return { ...out, composeEligible: true, sendSkip, tz, today, candidates, due, freezeRecords, items: projected.items };
}

// ---------- §6b.6 payload (name-free by construction) ----------
function relative(startAt, now, capMin = Infinity) {
  const n = Math.round(Math.abs(startAt - now) / MIN);
  if (n === 0) return 'starts now';
  return startAt > now ? `starts in ${Math.min(n, capMin)} min` : `started ${n} min ago`;
}
function thenPart(next) {
  if (!next) return '';
  const isAppt = next.kind === 'appt' || next.category === 'appt';
  return ` · then ${isAppt ? 'an appointment' : next.name} at ${formatTime(next.startMin)}`;
}
export function buildPayload(c, next, now, appUrl) {
  const url = `${appUrl}/?view=routine`;
  const capMin = Number.isFinite(c.fireAt) ? Math.max(1, Math.round((c.startAt - c.fireAt) / MIN)) : Infinity;
  if (c.kind === 'appt' || c.kind === 'placeholder') {
    const rel = relative(c.startAt, now, capMin);
    const body = rel === 'starts now' ? 'Appointment starts now' : rel.startsWith('starts in') ? `Appointment in ${rel.slice('starts in '.length)}` : `Appointment ${rel}`;
    return { title: 'PRIM', body, tag: c.kind === 'appt' ? `appt-${c.prospectId}` : `routine-${c.block_id}`, url, urgent: false };
  }
  return { title: `${c.name} ${relative(c.startAt, now, capMin)}`, body: `${formatRange(c.segStartMin, c.segEndMin)}${thenPart(next)}`, tag: `routine-${c.block_id}`, url, urgent: false };
}

// ---------- §6b.7 stamping ----------
const RETRYABLE = (code) => code == null || code >= 500 || code === 429 || code === 408;
export function classifySend({ sentCount, failures = [], allDead = false }) {
  if (sentCount >= 1) return { status: 'sent', attempts: 1, error: null };
  if (allDead) return { status: 'failed', attempts: 1, error: 'all_subs_dead' };
  const code = failures[0]?.statusCode ?? null;
  if (RETRYABLE(code)) return { status: 'failed', attempts: 1, error: code == null ? 'no_status' : String(code) };
  return { status: 'failed', attempts: 2, error: String(code) };
}
export function retryEligible(row, now) {
  if (row.attempts !== 1) return false;
  if (row.status === 'failed') return true;
  if (row.status === 'claimed') return now - new Date(row.created_at).getTime() >= STALE_CLAIM_MIN * MIN;
  return false;
}
