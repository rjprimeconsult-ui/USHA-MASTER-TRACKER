/**
 * blastLog.mjs — Pure, dependency-free normalisation for the Blast/Repurpose
 * tracker.
 *
 * A "blast" is logged outside PRIM by the Cowork ringy-textdrip-blast skill,
 * which appends each run to blast-log.csv and POSTs the same row to PRIM's
 * blast webhook. This module turns that row (CSV field names OR camelCase)
 * into a canonical record and upserts it into the blast_log_v1 array, deduping
 * on date+platform+time+campaign so an accidental re-POST never double-logs.
 */

// ---------- helpers ----------

function pick(body, keys) {
  if (!body || typeof body !== 'object') return '';
  // case-insensitive key match against the body
  const lower = {};
  for (const k of Object.keys(body)) lower[String(k).toLowerCase()] = body[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Normalise a platform string to 'Ringy' | 'Textdrip' (or the trimmed input). */
export function normPlatform(p) {
  const s = String(p || '').toLowerCase();
  if (s.includes('ring')) return 'Ringy';
  if (s.includes('text')) return 'Textdrip';
  return String(p || '').trim();
}

function toInt(v) {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9.]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function _uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- normalisation ----------

/**
 * normalizeBlastPayload(body) — accept the blast-log.csv field names or their
 * camelCase equivalents and return a canonical blast record (no id/createdAt;
 * upsertBlast stamps those).
 */
export function normalizeBlastPayload(body) {
  return {
    runDate:       pick(body, ['run_date', 'runDate', 'date']),
    platform:      normPlatform(pick(body, ['platform'])),
    rangeStart:    pick(body, ['range_start', 'rangeStart']),
    rangeEnd:      pick(body, ['range_end', 'rangeEnd']),
    campaignOrTag: pick(body, ['campaign_or_tag', 'campaignOrTag', 'campaign', 'tag']),
    contacts:      toInt(pick(body, ['contacts', 'count', 'contact_count', 'contactCount'])),
    sendTime:      pick(body, ['send_time', 'sendTime', 'time']),
    numbersUsed:   pick(body, ['numbers_used', 'numbersUsed', 'numbers']),
    notes:         pick(body, ['notes', 'note']),
  };
}

/**
 * Dedup key — a blast is "the same" only if date+platform+time+campaign AND the
 * lead range all match. Including the range means two distinct same-day/
 * same-time TextDrip windows (different ranges) log as separate rows, while a
 * true re-POST (identical fields) still de-dupes.
 */
export function blastKey(b) {
  return ['runDate', 'platform', 'sendTime', 'campaignOrTag', 'rangeStart', 'rangeEnd']
    .map(k => String(b?.[k] || '').trim().toLowerCase())
    .join('|');
}

/**
 * upsertBlast(list, record, now) — immutable. Re-POST of the same blast updates
 * it in place (refreshing contacts/notes); a new blast is appended.
 *
 * REPLACE semantics: the incoming record carries the FULL contact count for the
 * blast. Use this for the skill-POST path and the manual "Log a blast" form,
 * where one POST = one whole blast.
 * @returns {{ list: object[], action: 'create'|'update' }}
 */
export function upsertBlast(list, record, now) {
  const arr = Array.isArray(list) ? list : [];
  const ts = now || new Date().toISOString();
  const key = blastKey(record);
  const idx = arr.findIndex(b => blastKey(b) === key);
  if (idx === -1) {
    const entry = { id: _uid(), ...record, createdAt: ts };
    return { list: [...arr, entry], action: 'create' };
  }
  // Preserve the original id + createdAt; refresh the rest from the new payload.
  const updated = { ...arr[idx], ...record, id: arr[idx].id, createdAt: arr[idx].createdAt };
  return { list: arr.map((b, i) => (i === idx ? updated : b)), action: 'update' };
}

/**
 * aggregateBlast(list, record, now, incBy=1) — immutable. INCREMENT semantics:
 * on a matching blast key it ADDS incBy to the existing contact count instead
 * of replacing it.
 *
 * This is the Ringy native-capture path: applying a blast/repurpose tag in
 * Ringy fires one webhook POST PER LEAD, so a 2,000-lead blast arrives as 2,000
 * separate POSTs that must roll up into ONE daily entry whose `contacts` climbs
 * to 2,000 — not get overwritten to 1 each time (which is what upsertBlast would
 * do). `record.contacts` is ignored here; the tally is driven by incBy.
 *
 * @returns {{ list: object[], action: 'create'|'update' }}
 */
export function aggregateBlast(list, record, now, incBy = 1) {
  const arr = Array.isArray(list) ? list : [];
  const ts = now || new Date().toISOString();
  const inc = Number.isFinite(Number(incBy)) ? Number(incBy) : 1;
  const key = blastKey(record);
  const idx = arr.findIndex(b => blastKey(b) === key);
  if (idx === -1) {
    const entry = { id: _uid(), ...record, contacts: inc, source: record.source || 'auto', createdAt: ts, lastAt: ts };
    return { list: [...arr, entry], action: 'create' };
  }
  const prev = arr[idx];
  const updated = { ...prev, contacts: (Number(prev.contacts) || 0) + inc, lastAt: ts };
  return { list: arr.map((b, i) => (i === idx ? updated : b)), action: 'update' };
}
