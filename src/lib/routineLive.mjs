// Routine Builder live layer (spec §5 parseAppointmentTime, §7h). Pure; the
// SAME functions run in the browser and in /api/routine/tick.
// Callers guarantee a valid IANA zone (the tick skips bad_tz; the view nulls it) — an invalid tz throws RangeError from Intl.
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
    const aNone = !a.lastContact, bNone = !b.lastContact; if (aNone !== bNone) return aNone ? -1 : 1;
    if (a.lastContact !== b.lastContact) return a.lastContact < b.lastContact ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows;
}

// ---------- interval helpers ----------
function unionIntervals(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
function subtract([s, e], cuts) {
  const out = [];
  let cursor = s;
  for (const [a, b] of cuts) {
    if (b <= cursor || a >= e) continue;
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < e) out.push([cursor, e]);
  return out;
}
const isDisplaceable = (category) => category !== 'break' && category !== 'appt';
const px = (min) => min * 2; // PX_PER_MIN, inlined to keep this module import-light

// ---------- §7h.3 composeDay ----------
// `today` is REQUIRED: dayRecords carries 7 days and block ids are permanent, so
// done records must be scoped to today (same day-2 bug as nowState — Task 4 review).
export function composeDay({ live = [], appointments = [], makeups = [], dayRecords = [], nowMin = 0, today }) {
  if (typeof today !== 'string') throw new TypeError('composeDay: today is required');
  const apptCuts = unionIntervals(appointments.map(a => [a.startMin, Math.min(1440, a.startMin + a.durationMin)]));
  const liveMk = makeups.filter(m => m && !m.deletedAt);
  const mkCuts = unionIntervals(liveMk.map(m => [m.startMin, m.startMin + m.durationMin]));
  const doneById = new Map(dayRecords.filter(r => r && r.kind === 'done' && !r.deletedAt && r.day === today).map(r => [r.blockId, r.status]));
  const displacedByBlock = {};
  const markers = [];
  const items = [];

  const pushSegments = (kind, owner, ownerKey, segs) => {
    const ti = segs.findIndex(([, e]) => e > nowMin);
    const titleIdx = ti === -1 ? segs.length - 1 : ti;
    segs.forEach(([s, e], i) => items.push({
      kind, id: `${ownerKey}#${i}`, [kind === 'segment' ? 'blockId' : 'makeupId']: ownerKey,
      [kind === 'segment' ? 'block' : 'makeup']: owner,
      category: owner.category, name: owner.name, startMin: s, endMin: e, index: i,
      isTitle: i === titleIdx, isFirst: i === 0, isLast: i === segs.length - 1,
      done: doneById.get(ownerKey) || null,
    }));
  };

  for (const b of live) {
    if (!b || b.deletedAt) continue;
    const full = [b.startMin, b.startMin + b.durationMin];
    const keptA = subtract(full, apptCuts).filter(([s, e]) => e - s >= MIN_SEG);
    const survived = keptA.reduce((n, [s, e]) => n + (e - s), 0);
    const displaced = b.durationMin - survived;
    const segs = keptA.flatMap(seg => subtract(seg, mkCuts)).filter(([s, e]) => e - s >= MIN_SEG);
    if (isDisplaceable(b.category) && displaced > 0) {
      displacedByBlock[b.id] = displaced;
      for (const [as, ae] of apptCuts) {
        const os = Math.max(as, full[0]), oe = Math.min(ae, full[1]);
        if (oe <= os) continue;
        let idx = -1;
        for (let i = segs.length - 1; i >= 0; i--) if (segs[i][1] <= os) { idx = i; break; }
        if (idx >= 0 && px(segs[idx][1] - segs[idx][0]) < 40) idx = -1;
        if (idx === -1) { const f = segs.findIndex(([s]) => s >= oe); if (f >= 0 && px(segs[f][1] - segs[f][0]) >= 40) idx = f; }
        if (idx >= 0) markers.push({ blockId: b.id, segmentIndex: idx, minutes: oe - os, apptStart: as });
      }
    }
    pushSegments('segment', b, b.id, segs);
  }

  const displacedByMakeup = {};
  for (const m of liveMk) {
    const full = [m.startMin, m.startMin + m.durationMin];
    const kept = subtract(full, apptCuts).filter(([s, e]) => e - s >= MIN_SEG);
    displacedByMakeup[m.id] = m.durationMin - kept.reduce((n, [s, e]) => n + (e - s), 0);
    pushSegments('makeup', m, m.id, kept);
  }

  for (const a of appointments) items.push({ kind: 'appt', id: `appt|${a.prospectId}|${a.startMin}`, ...a, endMin: Math.min(1440, a.startMin + a.durationMin) }); // a 23:45 appointment never hangs below the lane
  items.sort((x, y) => x.startMin - y.startMin || (x.kind === 'appt' ? -1 : 1));

  const totalDisplaced = Object.values(displacedByBlock).reduce((n, v) => n + v, 0);
  const recovered = liveMk.reduce((n, m) => n + (m.durationMin - displacedByMakeup[m.id]), 0);
  const unrecovered = Math.max(0, totalDisplaced - recovered);
  return { items, displacedByBlock, displacedByMakeup, recovered, unrecovered, markers };
}

// ---------- §7h.3 findMakeupSlot ----------
export function findMakeupSlot({ live = [], appointments = [], makeups = [], dayRecords = [], makeupMin, nowMin, today }) {
  if (typeof today !== 'string') throw new TypeError('findMakeupSlot: today is required');
  const blocks = live.filter(b => b && !b.deletedAt).sort((a, b) => a.startMin - b.startMin);
  if (!blocks.length || !(makeupMin > 0)) return null;
  const spanStart = Math.max(nowMin, blocks[0].startMin);
  const spanEnd = Math.max(...blocks.map(b => b.startMin + b.durationMin));
  if (spanEnd - spanStart < makeupMin) return null;
  const skipped = new Set(dayRecords.filter(r => r && r.kind === 'done' && !r.deletedAt && r.status === 'skipped' && r.day === today).map(r => r.blockId));
  const covered = unionIntervals([
    ...appointments.map(a => [a.startMin, a.startMin + a.durationMin]),
    ...makeups.filter(m => m && !m.deletedAt).map(m => [m.startMin, m.startMin + m.durationMin]),
    ...blocks.filter(b => b.category !== 'break' && !skipped.has(b.id)).map(b => [b.startMin, b.startMin + b.durationMin]),
  ]);
  const gaps = subtract([spanStart, spanEnd], covered);
  for (const floor of [720, 0]) {
    for (const [gs, ge] of gaps) {
      const s = ceil5(Math.max(gs, floor, nowMin));
      if (ge - s >= makeupMin) return { startMin: s, endMin: s + makeupMin };
    }
  }
  return null;
}

// ---------- §7h.3 owed record ----------
export const owedId = (day) => `${day}|owed`;
const cleanByBlock = (obj) => { const out = {}; for (const [k, v] of Object.entries(obj || {})) if (v > 0) out[k] = v; return out; };
function sameByBlock(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every(k => Number((a || {})[k]) === Number((b || {})[k]));
}

// realized = composeDay over STARTED appointments only. Never changes status.
export function reconcileOwed(stored, realized, nowIso, day) {
  const minutes = realized.unrecovered;
  const byBlock = cleanByBlock(realized.displacedByBlock);
  if (!stored || stored.deletedAt) {
    if (minutes === 0) return null;
    return { id: owedId(day), kind: 'owed', day, minutes, byBlock, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: nowIso, deletedAt: null };
  }
  if (Number(stored.minutes) === minutes && sameByBlock(stored.byBlock, byBlock)) return null;
  return { ...stored, minutes, byBlock, updatedAt: nowIso };
}

// projected = composeDay over ALL of today's items. Derived, never stored.
export function offerState(stored, projected) {
  const decided = stored && !stored.deletedAt ? (stored.decidedMinutes ?? 0) : 0;
  const remainder = projected.unrecovered - decided;
  return { offerOpen: remainder > 0, makeupMin: Math.max(10, ceil5(Math.max(0, remainder))), decidedMinutes: decided };
}

// decision ∈ 'skip' | 'accept'. Creates the record when absent.
export function applyOwedDecision(stored, decision, { projected, realized, makeupMin, nowIso, day }) {
  const base = stored && !stored.deletedAt ? { ...stored } : {
    id: owedId(day), kind: 'owed', day, minutes: realized.unrecovered, byBlock: cleanByBlock(realized.displacedByBlock),
    status: 'open', decidedAt: null, decidedMinutes: null, deletedAt: null,
  };
  if (decision === 'skip') return { ...base, status: 'skipped', decidedAt: nowIso, decidedMinutes: projected.unrecovered, updatedAt: nowIso };
  return { ...base, status: 'accepted', decidedAt: nowIso, decidedMinutes: Math.max(0, projected.unrecovered - makeupMin), updatedAt: nowIso };
}

// ---------- §7h.4 / §7h.5 not-done accounting ----------
function nounFor(byCategory) {
  const cats = Object.entries(byCategory).filter(([, v]) => v > 0).map(([k]) => k);
  if (cats.length && cats.every(c => c === 'dial')) return 'dial time';
  if (cats.length && cats.every(c => c === 'followup')) return 'follow-up time';
  return 'routine time';
}

export function dayNotDone({ day, blocks = [], dayRecords = [], settings, tz }) {
  const empty = { minutes: 0, byBlock: {}, byCategory: {}, noun: 'routine time' };
  if (!(settings?.activeDays || []).includes(localWeekday(day))) return empty;
  const dayEnd = zonedTimeToUtc(addDays(day, 1), 0, tz);
  const recs = dayRecords.filter(r => r && r.day === day && !r.deletedAt);
  const owed = recs.find(r => r.kind === 'owed');
  const byBlock = cleanByBlock(owed?.byBlock);
  const byCategory = {};
  const add = (cat, n) => { if (n > 0) byCategory[cat] = (byCategory[cat] || 0) + n; };
  let minutes = owed ? Math.max(0, Number(owed.minutes) || 0) : 0;
  const catOf = new Map(blocks.map(b => [b.id, b.category]));
  for (const [id, n] of Object.entries(byBlock)) add(catOf.get(id) || 'other', n);
  const decided = new Set(recs.filter(r => r.kind === 'done' && (r.status === 'done' || r.status === 'skipped')).map(r => r.blockId));
  const t = (iso) => new Date(iso || 0).getTime();
  for (const b of blocks) {
    if (!b || !isDisplaceable(b.category) || decided.has(b.id)) continue;
    if (t(b.createdAt) > dayEnd) continue;
    if (b.deletedAt && t(b.deletedAt) <= dayEnd) continue;
    const part = Math.max(0, b.durationMin - (byBlock[b.id] || 0));
    if (!part) continue;
    minutes += part; byBlock[b.id] = (byBlock[b.id] || 0) + part; add(b.category, part);
  }
  for (const m of recs.filter(r => r.kind === 'makeup')) {
    if (decided.has(m.id)) continue;
    minutes += m.durationMin; byBlock[m.id] = m.durationMin; add(m.category || 'other', m.durationMin);
  }
  return { minutes, byBlock, byCategory, noun: nounFor(byCategory) };
}

export function yesterdayMiss({ blocks, dayRecords, settings, tz, now }) {
  const today = localDayKey(now, tz);
  const r = dayNotDone({ day: addDays(today, -1), blocks, dayRecords, settings, tz });
  const hidden = dayRecords.some(x => x && x.day === today && !x.deletedAt && (x.kind === 'ack' || (x.kind === 'done' && (x.status === 'done' || x.status === 'skipped'))));
  return { ...r, hidden };
}

export function weeklyNotDone({ blocks, dayRecords, settings, tz, now }) {
  const today = localDayKey(now, tz);
  const days = [];
  for (let i = 7; i >= 1; i--) {
    const day = addDays(today, -i);
    days.push({ day, minutes: dayNotDone({ day, blocks, dayRecords, settings, tz }).minutes });
  }
  return { days, total: days.reduce((n, d) => n + d.minutes, 0) };
}
