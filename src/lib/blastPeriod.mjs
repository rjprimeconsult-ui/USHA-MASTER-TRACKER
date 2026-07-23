/**
 * blastPeriod.mjs — time-range logic for the Blasts view period selector.
 *
 * SELF-CONTAINED (no imports): unit-tested under `node --test`, where sibling
 * app modules are unimportable (extensionless imports). Keep it dependency-free.
 *
 * Turns a period id into a concrete { start, end } Date window (local time).
 * `start` is local midnight of the first day; `end` is local end-of-day
 * (23:59:59.999) of the last day, so a range check is `d >= start && d <= end`.
 *
 * Spec: docs/superpowers/specs/2026-07-23-blasts-period-selector-design.md
 */

// Button order = display order.
export const BLAST_PERIODS = ['today', 'week', '30d', 'ytd', 'custom'];
export const DEFAULT_BLAST_PERIOD = 'week';

// Human labels for the selector + rollup card.
export const BLAST_PERIOD_LABELS = {
  today: 'Today',
  week: 'This week',
  '30d': 'Last 30 days',
  ytd: 'Year to date',
  custom: 'Custom',
};

// Local midnight (00:00:00.000) of a Date's calendar day.
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
// Local end-of-day (23:59:59.999) of a Date's calendar day.
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
// Parse a 'YYYY-MM-DD' string to a LOCAL Date (not UTC — `new Date('YYYY-MM-DD')`
// would parse as UTC midnight and shift a day in western timezones).
function parseYmdLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * blastPeriodRange(period, opts) -> { start: Date, end: Date } | null
 *
 * @param {string} period  one of BLAST_PERIODS
 * @param {object} [opts]
 * @param {Date}   [opts.now]          reference "now" (default new Date()) — injectable for tests
 * @param {string} [opts.customStart]  'YYYY-MM-DD' (only for period 'custom')
 * @param {string} [opts.customEnd]    'YYYY-MM-DD' (only for period 'custom')
 * @returns {{start: Date, end: Date} | null}  null when custom is incomplete/invalid
 *          or the period id is unknown.
 */
export function blastPeriodRange(period, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  switch (period) {
    case 'today':
      return { start: todayStart, end: todayEnd };

    case 'week': {
      // Monday-start week. getDay(): 0=Sun..6=Sat. daysBack maps each day to
      // its week's Monday; Sunday (0) -> 6 so it belongs to the prior Monday.
      const daysBack = (now.getDay() + 6) % 7;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, 0, 0, 0, 0);
      return { start, end: todayEnd };
    }

    case '30d': {
      // Rolling: today + 29 prior calendar days = 30 days including today.
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
      return { start, end: todayEnd };
    }

    case 'ytd': {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return { start, end: todayEnd };
    }

    case 'custom': {
      const s = parseYmdLocal(opts.customStart);
      const e = parseYmdLocal(opts.customEnd);
      if (!s || !e) return null;
      if (s.getTime() > e.getTime()) return null;
      return { start: startOfDay(s), end: endOfDay(e) };
    }

    default:
      return null;
  }
}
