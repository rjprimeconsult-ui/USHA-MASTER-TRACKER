/**
 * Statement Manager logic — pure, read-only grouping + range selection over
 * statement-derived data. No storage/DOM.
 *
 * Weekly stores (ownAdvances / overrides / chargebacks): rows keyed by `period`
 *   (ISO YYYY-MM-DD statement week).
 * Monthly: business-income rows that came from a statement (flag or note),
 *   keyed by `date` (ISO).
 */

const STATEMENT_NOTE_PREFIX = 'Auto-imported from statement';

/** Did a business-income row come from a statement (vs manual entry)? */
export function isStatementIncome(row) {
  if (!row) return false;
  if (row.fromStatement === true) return true;
  return typeof row.notes === 'string' && row.notes.startsWith(STATEMENT_NOTE_PREFIX);
}

const day = (s) => String(s || '').slice(0, 10);
const month = (s) => String(s || '').slice(0, 7);
const sum = (rows) => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

/**
 * Group weekly rows by period and statement-income rows by month.
 * Returns { weekly:[{period, own, override, chargeback, counts, totals}],
 *           monthly:[{month, rows, total}] }, each sorted newest-first.
 */
export function groupStatements({ ownAdvances = [], overrides = [], chargebacks = [], businessIncome = [] }) {
  const weeks = new Map();
  const ensure = (p) => {
    const k = day(p);
    if (!weeks.has(k)) weeks.set(k, { period: k, own: [], override: [], chargeback: [] });
    return weeks.get(k);
  };
  for (const r of ownAdvances)  ensure(r.period).own.push(r);
  for (const r of overrides)    ensure(r.period).override.push(r);
  for (const r of chargebacks)  ensure(r.period).chargeback.push(r);

  const weekly = [...weeks.values()].map(w => ({
    ...w,
    counts: { own: w.own.length, override: w.override.length, chargeback: w.chargeback.length },
    totals: { own: sum(w.own), override: sum(w.override), chargeback: sum(w.chargeback) },
  })).sort((a, b) => b.period.localeCompare(a.period));

  const months = new Map();
  for (const r of businessIncome) {
    if (!isStatementIncome(r)) continue;
    const k = month(r.date);
    if (!months.has(k)) months.set(k, { month: k, rows: [] });
    months.get(k).rows.push(r);
  }
  const monthly = [...months.values()]
    .map(m => ({ ...m, total: sum(m.rows) }))
    .sort((a, b) => b.month.localeCompare(a.month));

  return { weekly, monthly };
}

/**
 * Select all statement rows whose date falls within [from, to] (inclusive).
 * Weekly rows matched by `period`; monthly statement-income rows by `date`.
 * Returns id Sets + counts + dollar totals (for preview and delete).
 */
export function statementsInRange({ ownAdvances = [], overrides = [], chargebacks = [], businessIncome = [] }, from, to) {
  const lo = day(from);
  const hi = day(to);
  const inRange = (d) => { const k = day(d); return k >= lo && k <= hi; };

  const pick = (rows, dateKey) => rows.filter(r => inRange(r[dateKey]));
  const own = pick(ownAdvances, 'period');
  const override = pick(overrides, 'period');
  const chargeback = pick(chargebacks, 'period');
  const monthly = businessIncome.filter(r => isStatementIncome(r) && inRange(r.date));

  const idSet = (rows) => new Set(rows.map(r => r.id));
  const uniqWeeks = new Set([...own, ...override, ...chargeback].map(r => day(r.period)));
  const uniqMonths = new Set(monthly.map(r => month(r.date)));

  return {
    ownIds: idSet(own),
    overrideIds: idSet(override),
    chargebackIds: idSet(chargeback),
    monthlyIds: idSet(monthly),
    counts: {
      own: own.length, override: override.length, chargeback: chargeback.length,
      monthly: monthly.length, weeks: uniqWeeks.size, months: uniqMonths.size,
    },
    totals: { own: sum(own), override: sum(override), chargeback: sum(chargeback), monthlyIncome: sum(monthly) },
  };
}
