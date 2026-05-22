/**
 * PRIM Reports — pure aggregation. Turns the in-memory data stores plus a
 * date range into uniform report view-models. No UI, no storage writes.
 * See the design spec: docs/superpowers/specs/2026-05-22-reports-design.md
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Resolve a preset id (or 'custom') to a concrete { from, to, label } range.
// from/to are ISO YYYY-MM-DD, inclusive. `now` is injectable for tests.
export function resolvePeriod(presetId, now = new Date(), custom = null) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  const today = iso(now);
  switch (presetId) {
    case 'thisMonth':
      return { from: iso(new Date(y, m, 1)), to: today, label: `${MONTHS[m]} ${y}` };
    case 'lastMonth': {
      const lm = new Date(y, m - 1, 1);
      return {
        from: iso(lm),
        to: iso(new Date(y, m, 0)), // day 0 of this month = last day of prev month
        label: `${MONTHS[lm.getMonth()]} ${lm.getFullYear()}`,
      };
    }
    case 'thisQuarter': {
      const q = Math.floor(m / 3);
      return { from: iso(new Date(y, q * 3, 1)), to: today, label: `Q${q + 1} ${y}` };
    }
    case 'ytd':
      return { from: `${y}-01-01`, to: today, label: `${y} YTD` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    case 'custom': {
      const from = custom?.from || today;
      const to = custom?.to || today;
      return { from, to, label: `${from} to ${to}` };
    }
    default:
      return { from: iso(new Date(y, m, 1)), to: today, label: `${MONTHS[m]} ${y}` };
  }
}

// Whether a period preset covers exactly one calendar month (controls
// whether the Expenses report shows its "vs Budget" indicator).
export function isSingleMonth(presetId) {
  return presetId === 'thisMonth' || presetId === 'lastMonth';
}
