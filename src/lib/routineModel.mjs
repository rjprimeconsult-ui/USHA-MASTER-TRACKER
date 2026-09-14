// Routine Builder data model (spec §4a, §4b, §4c, §7e). Pure; node-tested.
import { CATEGORIES, paletteById, paletteForCategory } from './routinePalette.mjs';
import { addDays } from './tz.mjs';

const SEVEN_DAYS = 7 * 86400000;
const MAX_LIVE = 60;
const MIN_DUR = 10;
const MAX_DUR = 720;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function base36(n) {
  let s = '';
  while (s.length < n) s += Math.random().toString(36).slice(2);
  return s.slice(0, n);
}
export function uid() { return 'blk_' + base36(7); }
export function dayUid() { return 'mk_' + base36(7); }

const snap5 = (n) => Math.round(n / 5) * 5;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isoOrNull = (v) => (typeof v === 'string' && v ? v : null);
const olderThan = (iso, nowIso, ms) => Date.parse(nowIso) - Date.parse(iso) > ms;

function clampBlock(b) {
  const durationMin = clamp(snap5(Number(b.durationMin) || MIN_DUR), MIN_DUR, MAX_DUR);
  let startMin = clamp(snap5(Number(b.startMin) || 0), 0, 1440 - MIN_DUR);
  if (startMin + durationMin > 1440) startMin = 1440 - durationMin;
  const category = CATEGORIES.includes(b.category) ? b.category : 'custom';
  const pal = paletteById(b.paletteId) || paletteForCategory(category);
  const remind = {
    enabled: b.remind ? b.remind.enabled !== false : pal.defaultRemind,
    minutesBefore: [0, 5, 10, 15].includes(Number(b.remind?.minutesBefore)) ? Number(b.remind.minutesBefore) : 5,
  };
  return {
    id: b.id,
    name: (typeof b.name === 'string' && b.name.trim() ? b.name : pal.name).slice(0, 60),
    paletteId: pal.id,
    category,
    startMin, durationMin, remind,
    note: String(b.note ?? '').slice(0, 200),
    deletedAt: isoOrNull(b.deletedAt),
    createdAt: isoOrNull(b.createdAt) || isoOrNull(b.updatedAt) || '1970-01-01T00:00:00.000Z',
    updatedAt: isoOrNull(b.updatedAt) || '1970-01-01T00:00:00.000Z',
  };
}

// Dedupe by id keeping the newest updatedAt (a tombstone stamped later than
// the live copy wins → a stale merge cannot resurrect a delete).
function dedupeNewest(records) {
  const byId = new Map();
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    const prev = byId.get(r.id);
    if (!prev || String(r.updatedAt || '') > String(prev.updatedAt || '')) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// Free gaps (as [start, end)) between placed blocks inside [0, 1440).
function gaps(placed) {
  const sorted = [...placed].sort((x, y) => x.startMin - y.startMin);
  const out = [];
  let cursor = 0;
  for (const p of sorted) {
    if (p.startMin > cursor) out.push([cursor, p.startMin]);
    cursor = Math.max(cursor, p.startMin + p.durationMin);
  }
  if (cursor < 1440) out.push([cursor, 1440]);
  return out;
}

function place(block, placed) {
  // 1) first gap at/after its start that fits
  for (const [s, e] of gaps(placed)) {
    const start = Math.max(s, block.startMin);
    if (e - start >= block.durationMin) return { ...block, startMin: start };
  }
  // 2) shrink to the largest gap ≥ MIN_DUR (prefer at/after start, else any)
  const all = gaps(placed).map(([s, e]) => [s, e, e - s]).filter(g => g[2] >= MIN_DUR);
  const after = all.filter(([s]) => s >= block.startMin);
  const pick = (after.length ? after : all).sort((a, b) => b[2] - a[2])[0];
  if (pick) return { ...block, startMin: pick[0], durationMin: Math.min(block.durationMin, Math.floor(pick[2] / 5) * 5) };
  return null;
}

// Priority placement (spec §4a): blocks are placed in order of (updatedAt asc,
// id asc). The earliest-updated block keeps its slot; every later block is
// placed into the free gaps left by those before it — at/after its own start,
// else shrunk into the largest free gap ≥ 10 min, else dropped. Equal stamps →
// the greater id yields. Overlap-free and idempotent by construction. Resolved
// moves keep their updatedAt on purpose: bumping it would flip priority on the
// next merge and ping-pong the block across devices.
export function resolveOverlaps(live) {
  const order = [...live].sort((a, b) =>
    String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) || String(a.id).localeCompare(String(b.id)));
  const placed = [];
  const dropped = [];
  for (const b of order) {
    const moved = place(b, placed);
    if (moved) placed.push(moved); else dropped.push(b.id);
  }
  return { blocks: placed.sort((a, b) => a.startMin - b.startMin || String(a.id).localeCompare(String(b.id))), dropped };
}

export function sanitizeBlocks(blocks, nowIso = new Date().toISOString()) {
  const deduped = dedupeNewest(Array.isArray(blocks) ? blocks : []).map(clampBlock);
  const tombstones = deduped.filter(b => b.deletedAt && !olderThan(b.deletedAt, nowIso, SEVEN_DAYS));
  let live = deduped.filter(b => !b.deletedAt);
  if (live.length > MAX_LIVE) {
    const byNewest = [...live].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    const extra = new Set(byNewest.slice(0, live.length - MAX_LIVE).map(b => b.id));
    for (const b of live) if (extra.has(b.id)) tombstones.push({ ...b, deletedAt: nowIso, updatedAt: nowIso });
    live = live.filter(b => !extra.has(b.id));
  }
  const { blocks: resolved, dropped } = resolveOverlaps(live);
  for (const id of dropped) { const b = live.find(x => x.id === id); tombstones.push({ ...b, deletedAt: nowIso, updatedAt: nowIso }); }
  return [...resolved, ...tombstones].sort((a, b) => a.startMin - b.startMin);
}

export function liveBlocks(blocks, nowIso = new Date().toISOString()) {
  return sanitizeBlocks(blocks, nowIso).filter(b => !b.deletedAt);
}

// ---------------- per-day records (spec §4b) ----------------
const DAY_KINDS = new Set(['done', 'appt', 'attach', 'owed', 'makeup', 'ack']);

export function sanitizeDay(records, today, nowIso = new Date().toISOString()) {
  if (!DAY_KEY_RE.test(String(today))) throw new TypeError('sanitizeDay: today must be YYYY-MM-DD');
  const floor = addDays(today, -7);
  const out = [];
  for (const r of dedupeNewest(Array.isArray(records) ? records : [])) {
    if (!DAY_KINDS.has(r.kind)) continue;
    if (typeof r.day !== 'string' || !DAY_KEY_RE.test(r.day) || r.day < floor) continue;
    const deletedAt = isoOrNull(r.deletedAt);
    if (deletedAt && olderThan(deletedAt, nowIso, SEVEN_DAYS)) continue;
    const rec = { ...r, deletedAt, updatedAt: isoOrNull(r.updatedAt) || '1970-01-01T00:00:00.000Z' };
    if (rec.kind === 'makeup') {
      rec.durationMin = clamp(snap5(Number(rec.durationMin) || MIN_DUR), MIN_DUR, MAX_DUR);
      rec.startMin = clamp(snap5(Number(rec.startMin) || 0), 0, 1440 - rec.durationMin);
      if (!/^mk_[0-9a-z]{7}$/.test(rec.id)) continue;
    }
    if (rec.kind === 'owed') {
      rec.minutes = Math.max(0, Number(rec.minutes) || 0);
      rec.byBlock = rec.byBlock && typeof rec.byBlock === 'object' ? rec.byBlock : {};
      rec.status = ['open', 'accepted', 'skipped'].includes(rec.status) ? rec.status : 'open';
      rec.decidedMinutes = rec.decidedMinutes == null ? null : Math.max(0, Number(rec.decidedMinutes) || 0);
    }
    if (rec.kind === 'done' && !['done', 'skipped', 'cleared'].includes(rec.status)) continue;
    if (rec.kind === 'appt') {
      rec.startMin = clamp(Number(rec.startMin) || 0, 0, 1439);
      rec.durationMin = clamp(Number(rec.durationMin) || 30, 5, MAX_DUR);
      rec.source = rec.source === 'attached' ? 'attached' : 'derived';
      rec.heldAt = isoOrNull(rec.heldAt);
    }
    out.push(rec);
  }
  return out;
}

// ---------------- settings (spec §4c) ----------------
export const DEFAULT_SETTINGS = Object.freeze({
  version: 1, timezone: null, timezoneMode: 'auto',
  remindersEnabled: true, defaultMinutesBefore: 5,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  appointmentStages: ['WEBBY_SET', 'WEBBY_CONFIRMED', 'APPOINTMENT_SET'],
  followupStages: ['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION'],
  followupStagesSeeded: false, lastReplacedBackup: null,
});

const uniqStrings = (arr, fallback) => (Array.isArray(arr) ? [...new Set(arr.filter(x => typeof x === 'string' && x))] : [...fallback]);

export function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return { ...DEFAULT_SETTINGS, activeDays: [...DEFAULT_SETTINGS.activeDays], appointmentStages: [...DEFAULT_SETTINGS.appointmentStages], followupStages: [...DEFAULT_SETTINGS.followupStages] };
  const lead = typeof s.defaultMinutesBefore === 'number' ? s.defaultMinutesBefore : NaN;
  const nearest = [0, 5, 10, 15].reduce((best, v) => (Math.abs(v - lead) < Math.abs(best - lead) ? v : best), 5);
  return {
    version: 1,
    timezone: typeof s.timezone === 'string' && s.timezone ? s.timezone : null,
    timezoneMode: s.timezoneMode === 'manual' ? 'manual' : 'auto',
    remindersEnabled: s.remindersEnabled !== false,
    defaultMinutesBefore: Number.isFinite(lead) ? nearest : 5,
    activeDays: Array.isArray(s.activeDays) ? [...new Set(s.activeDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [...DEFAULT_SETTINGS.activeDays],
    appointmentStages: uniqStrings(s.appointmentStages, DEFAULT_SETTINGS.appointmentStages),
    followupStages: uniqStrings(s.followupStages, DEFAULT_SETTINGS.followupStages),
    followupStagesSeeded: s.followupStagesSeeded === true,
    lastReplacedBackup: Array.isArray(s.lastReplacedBackup) ? s.lastReplacedBackup : null,
  };
}

// Custom stages seed ONLY on follow-up wording (Juan 2026-09-11) AND never on
// closed-won / not-interested wording.
export const FOLLOWUP_WORDS = /follow|circle|check\s*back|call\s*back|callback|pitch|needs?\s*app|re-?engage|interest|missed|pending|later|reschedul|no[\s-]*show|think|decid/i;
// A bare \bno\b would also reject "No show – reschedule", which the positive
// list deliberately seeds — the lookahead keeps "no" as a negation word except
// when it heads "no show" / "no-show". (Spec §4c's regex lacks the lookahead
// and contradicts its own §12 pin; recorded as a plan deviation for spec rev 11 §4c.)
export const NOT_FOLLOWUP_WORDS = /\b(won|sold|closed|lost|dead|not|never)\b|\bno\b(?![\s-]*show)|\b(un|dis)interest/i;
// Hand copy of constants.js DEFAULT_PROSPECT_STAGES ids — a node test in Task 13 pins the two equal.
export const DEFAULT_STAGE_IDS = new Set(['WEBBY_SET', 'WEBBY_CONFIRMED', 'APPOINTMENT_SET', 'MISSED_APPT', 'PENDING_DECISION', 'FOLLOWUP_LATER', 'GHOSTED', 'SOLD', 'LOST']);

export function seedFollowupStages(stages) {
  const out = [...DEFAULT_SETTINGS.followupStages];
  for (const s of Array.isArray(stages) ? stages : []) {
    if (!s || typeof s.id !== 'string' || DEFAULT_STAGE_IDS.has(s.id)) continue;
    const label = String(s.label || '');
    if (FOLLOWUP_WORDS.test(label) && !NOT_FOLLOWUP_WORDS.test(label)) out.push(s.id);
  }
  return out;
}

// ---------------- templates (spec §7e) ----------------
export function instantiateTemplate(entry, { now, defaultMinutesBefore }) {
  const pal = paletteById(entry.paletteId) || paletteById('custom');
  return clampBlock({
    id: uid(),
    name: entry.name ?? pal.name,
    paletteId: pal.id,
    category: pal.category,
    startMin: entry.startMin,
    durationMin: entry.durationMin ?? pal.defaultMin,
    remind: { enabled: pal.defaultRemind, minutesBefore: defaultMinutesBefore, ...(entry.remind || {}) },
    note: entry.note ?? '',
    deletedAt: null, createdAt: now, updatedAt: now,
  });
}

// → { blocks, backup }. See spec §7e for the four branches.
export function applyTemplate(existing, template, { replace = false, now, defaultMinutesBefore }) {
  const sanitized = sanitizeBlocks(existing, now);
  const live = sanitized.filter(b => !b.deletedAt);
  const fresh = template.entries.map(e => instantiateTemplate(e, { now, defaultMinutesBefore }));
  if (live.length > 0 && !replace) return { blocks: sanitized, backup: null };
  if (live.length === 0) return { blocks: sanitizeBlocks([...sanitized, ...fresh], now), backup: null };
  const tombstoned = live.map(b => ({ ...b, deletedAt: now, updatedAt: now }));
  const tombs = sanitized.filter(b => b.deletedAt);
  return { blocks: sanitizeBlocks([...tombstoned, ...tombs, ...fresh], now), backup: sanitized };
}
