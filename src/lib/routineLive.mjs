// Routine Builder live layer (spec §5 parseAppointmentTime, §7h). Pure; the
// SAME functions run in the browser and in /api/routine/tick.
import { zonedTimeToUtc, localDayKey, localMinuteOfDay, addDays, daysBetween, localWeekday } from './tz.mjs';

export const APPT_DEFAULT_MIN = 30;
const MIN_SEG = 10;
const ceil5 = (n) => Math.ceil(n / 5) * 5;

// ---------- §5 parseAppointmentTime ----------
const WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const ZONED = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// → { day, minute, instant } | null. Wall-clock strings are interpreted in
// `tz`; only a zoned ISO goes through Date.parse (the ONLY Date.parse here).
export function parseAppointmentTime(value, tz) {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(' ', 'T');
  let m = s.match(WALL);
  if (m) {
    const hh = +m[2], mm = +m[3];
    if (hh > 23 || mm > 59) return null;
    const minute = hh * 60 + mm;
    if (minute === 0) return null;
    return { day: m[1], minute, instant: zonedTimeToUtc(m[1], minute, tz) };
  }
  m = s.match(ZONED);
  if (m) {
    const instant = Date.parse(s);
    if (!Number.isFinite(instant)) return null;
    const minute = localMinuteOfDay(instant, tz);
    if (minute === 0) return null;
    return { day: localDayKey(instant, tz), minute, instant };
  }
  return null;
}

// ---------- §7h.1 todaysAppointments ----------
export const apptRecordId = (day, prospectId, startMin) => `${day}|appt|${prospectId}|${startMin}`;

export function todaysAppointments({ prospectRows = [], blocks = [], dayRecords = [], settings, tz, now }) {
  const today = localDayKey(now, tz);
  const stages = new Set(settings?.appointmentStages || []);
  const names = new Map();
  for (const p of prospectRows) if (p && p.id != null && p.name) names.set(p.id, p.name);
  const apptRecs = dayRecords.filter(r => r && r.kind === 'appt' && r.day === today);
  const recordKeys = new Set(apptRecs.map(r => `${r.prospectId}|${r.startMin}`));
  const frozen = apptRecs.filter(r => !r.deletedAt).map(r => ({
    prospectId: r.prospectId, startMin: r.startMin, durationMin: r.durationMin, source: r.source,
    frozen: true, heldAt: r.heldAt || null, recordId: r.id,
    instant: zonedTimeToUtc(today, r.startMin, tz), name: names.get(r.prospectId) || null,
  }));
  const liveBlock = new Map(blocks.filter(b => b && !b.deletedAt).map(b => [b.id, b]));
  const attached = [];
  for (const r of dayRecords) {
    if (!r || r.kind !== 'attach' || r.day !== today || r.deletedAt) continue;
    const b = liveBlock.get(r.blockId);
    if (!b || b.category !== 'appt') continue;
    attached.push({
      prospectId: r.prospectId, startMin: b.startMin, durationMin: b.durationMin, source: 'attached',
      frozen: false, heldAt: null, blockId: b.id, attachId: r.id,
      instant: zonedTimeToUtc(today, b.startMin, tz), name: names.get(r.prospectId) || b.name || null,
    });
  }
  const derived = [];
  for (const p of prospectRows) {
    if (!p || p.archivedAt || !stages.has(p.stage)) continue;
    const parsed = parseAppointmentTime(p.appointmentTime, tz);
    if (!parsed || parsed.day !== today) continue;
    if (attached.some(a => a.prospectId === p.id && a.startMin === parsed.minute)) continue;
    derived.push({ prospectId: p.id, startMin: parsed.minute, durationMin: APPT_DEFAULT_MIN, source: 'derived', frozen: false, heldAt: null, instant: parsed.instant, name: p.name || null });
  }
  const overlapsFrozen = (it) => frozen.some(f => f.prospectId === it.prospectId && it.startMin < f.startMin + f.durationMin && f.startMin < it.startMin + it.durationMin);
  const live = [...attached, ...derived].filter(it => !recordKeys.has(`${it.prospectId}|${it.startMin}`) && !overlapsFrozen(it));
  return [...frozen, ...live]
    .map(it => ({ ...it, name: it.name || 'Appointment', endMin: it.startMin + it.durationMin }))
    .sort((a, b) => a.startMin - b.startMin || String(a.prospectId).localeCompare(String(b.prospectId)));
}

// ---------- §7h.2 followupQueue ----------
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function followupQueue(prospects, stageIds, tz, now) {
  const today = localDayKey(now, tz);
  const ids = new Set(stageIds || []);
  const rows = [];
  for (const p of prospects || []) {
    if (!p || p.archivedAt || !ids.has(p.stage)) continue;
    const lastContact = typeof p.lastContact === 'string' && DAY_RE.test(p.lastContact) ? p.lastContact : '';
    const createdAt = typeof p.createdAt === 'string' ? p.createdAt : '';
    let age;
    if (lastContact) age = `${Math.max(0, daysBetween(lastContact, today))}d`;
    else { const c = new Date(createdAt).getTime(); age = Number.isFinite(c) && now - c <= 7 * 86400000 ? 'new' : '—'; } // not Date.parse — the tripwire allows exactly one in this file
    rows.push({ id: p.id, name: p.name || '(no name)', stage: p.stage, lastContact, createdAt, age });
  }
  rows.sort((a, b) => {
    if (!a.lastContact !== !b.lastContact) return a.lastContact ? 1 : -1;
    if (a.lastContact !== b.lastContact) return a.lastContact < b.lastContact ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows;
}
