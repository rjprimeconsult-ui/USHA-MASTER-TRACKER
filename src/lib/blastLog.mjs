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

/** Dedup key — a blast is "the same" if date+platform+time+campaign match. */
export function blastKey(b) {
  return ['runDate', 'platform', 'sendTime', 'campaignOrTag']
    .map(k => String(b?.[k] || '').trim().toLowerCase())
    .join('|');
}

/**
 * upsertBlast(list, record, now) — immutable. Re-POST of the same blast updates
 * it in place (refreshing contacts/notes); a new blast is appended.
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
  const updated = { ...arr[idx], ...record };
  return { list: arr.map((b, i) => (i === idx ? updated : b)), action: 'update' };
}
