// NOW-card state + block visual state (spec §7b, §7c). Pure.
export function formatTime(min) {
  const n = ((Math.round(min) % 1440) + 1440) % 1440; // wraps midnight and negatives (a 00:00 block with a 5-min lead)
  const h24 = Math.floor(n / 60), m = n % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')}`;
}
export const formatRange = (s, e) => `${formatTime(s)}–${formatTime(e)}`;
export function formatMinutes(min) {
  const n = Math.max(0, Math.round(min));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// done ∈ 'done' | 'skipped' | 'cleared' | null
export function blockVisualState({ startMin, endMin, done, nowMin }) {
  if (done === 'skipped') return 'skipped';
  const checked = done === 'done';
  if (nowMin >= endMin) return checked ? 'past-done' : 'past-unchecked';
  if (nowMin >= startMin) return 'current';
  return checked ? 'future-done' : 'future';
}

// items = composeDay().items (segments, makeups, appts) sorted by startMin.
// behind = oldest routine block / make-up whose LAST surviving segment ended
// with no done|skipped record TODAY. Appointments never set it. Breaks never
// set it either — a "Break · still open" line is noise, and §7h.4 already
// excludes breaks from not-done accounting (plan deviation from the literal
// §7b, recorded for spec rev 11).
// `today` is required: dayRecords carries 7 days and block ids are permanent,
// so an unscoped map would let yesterday's checkmark mark today done.
export function nowState({ items = [], dayRecords = [], nowMin, today, offerBlocked = false }) {
  if (typeof today !== 'string') throw new TypeError('nowState: today is required');
  const done = new Map(dayRecords.filter(r => r && r.kind === 'done' && !r.deletedAt && r.day === today).map(r => [r.blockId, r.status]));
  const current = items.find(it => it.startMin <= nowMin && nowMin < it.endMin) || null;
  const next = items.find(it => it.startMin > nowMin) || null;
  const info = new Map(); // key → { name, startMin (first), endMin (last) }
  for (const it of items) {
    const key = it.kind === 'segment' ? it.blockId : it.kind === 'makeup' ? it.makeupId : null;
    if (!key || it.category === 'break') continue;
    const cur = info.get(key);
    if (!cur) info.set(key, { name: it.name, startMin: it.startMin, endMin: it.endMin });
    else { cur.startMin = Math.min(cur.startMin, it.startMin); cur.endMin = Math.max(cur.endMin, it.endMin); }
  }
  let behind = null;
  for (const [key, v] of info) {
    const status = done.get(key);
    if (v.endMin <= nowMin && status !== 'done' && status !== 'skipped' && (!behind || v.startMin < behind.startMin)) behind = { blockId: key, name: v.name, startMin: v.startMin, endMin: v.endMin };
  }
  let phase;
  if (current) phase = 'now';
  else if (next && items[0] && nowMin < items[0].startMin) phase = 'upFirst';
  else if (next) phase = 'free';
  else phase = (behind || offerBlocked) ? 'free' : 'dayDone'; // 'free' with next === null is a real state — NowCard must render "Free" without an "until"
  return { phase, current, next, behind };
}
