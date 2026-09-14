// NOW-card state + block visual state (spec §7b, §7c). Pure.
export function formatTime(min) {
  const h24 = Math.floor(min / 60) % 24, m = min % 60;
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
// behind = oldest routine block / make-up whose LAST segment ended with no
// done|skipped record. Appointments never set it.
export function nowState({ items = [], dayRecords = [], nowMin, offerBlocked = false }) {
  const done = new Map(dayRecords.filter(r => r.kind === 'done' && !r.deletedAt).map(r => [r.blockId, r.status]));
  const current = items.find(it => it.startMin <= nowMin && nowMin < it.endMin) || null;
  const next = items.find(it => it.startMin > nowMin) || null;
  const lastEnd = new Map();
  const firstStart = new Map();
  for (const it of items) {
    const key = it.kind === 'segment' ? it.blockId : it.kind === 'makeup' ? it.makeupId : null;
    if (!key || it.category === 'break') continue; // breaks never set `behind` (see the test note)
    lastEnd.set(key, Math.max(lastEnd.get(key) ?? -1, it.endMin));
    firstStart.set(key, Math.min(firstStart.get(key) ?? 1e9, it.startMin));
  }
  let behind = null;
  for (const [key, end] of lastEnd) {
    const status = done.get(key);
    if (end <= nowMin && status !== 'done' && status !== 'skipped') {
      const item = items.find(it => (it.blockId === key || it.makeupId === key));
      if (!behind || firstStart.get(key) < behind.startMin) behind = { blockId: key, name: item.name, startMin: firstStart.get(key), endMin: end };
    }
  }
  let phase;
  if (current) phase = 'now';
  else if (next && items[0] && nowMin < items[0].startMin) phase = 'upFirst';
  else if (next) phase = 'free';
  else phase = (behind || offerBlocked) ? 'free' : 'dayDone';
  return { phase, current, next, behind };
}
