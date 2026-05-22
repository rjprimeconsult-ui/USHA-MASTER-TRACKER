import { SEMANTIC, REPORT_IDENTITY, budgetStatus } from './reportColors.mjs';

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

// Normalize a date string to ISO YYYY-MM-DD. Accepts ISO already, or US
// M/D/YYYY (chargeback/override `period` strings look like "4/16/2026").
// Returns '' when unparseable.
export function toISO(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  let [, mm, dd, yy] = m;
  if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// Is an (any-format) date string within [range.from, range.to] inclusive?
// ISO YYYY-MM-DD strings compare correctly with <=/>=.
export function inRange(dateStr, range) {
  const d = toISO(dateStr);
  if (!d) return false;
  return d >= range.from && d <= range.to;
}

// Whole-dollar currency string: 1234.56 -> "$1,235", -1200 -> "-$1,200".
export function money(n) {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US')}`;
}

// Sum of a lead's product premiums (monthly). Leads store products as an
// array of { id, premium }; there is no top-level premium field.
function leadPremium(lead) {
  return (lead.products || []).reduce((s, p) => s + (Number(p?.premium) || 0), 0);
}

// --- Report 1: Leads Sold -------------------------------------------------
export function buildLeadsSoldReport(leads, range) {
  const sold = (leads || [])
    .filter(l => l && l.stage === 'Issued' && inRange(l.closedDate, range))
    .map(l => ({
      name: l.name || '—',
      products: (l.products || []).map(p => p?.id).filter(Boolean).join(', ') || '—',
      dateSold: toISO(l.closedDate),
      crm: l.crm || '—',
      campaign: l.campaign || '—',
      premium: leadPremium(l),
      advance: Number(l.dealValue) || 0,
      leadCost: Number(l.leadCost) || 0,
    }))
    .sort((a, b) => b.dateSold.localeCompare(a.dateSold));

  const t = sold.reduce((acc, r) => ({
    premium: acc.premium + r.premium,
    advance: acc.advance + r.advance,
    leadCost: acc.leadCost + r.leadCost,
  }), { premium: 0, advance: 0, leadCost: 0 });
  const netProfit = t.advance - t.leadCost;

  return {
    layout: 'table',
    title: 'Leads Sold',
    identityColor: REPORT_IDENTITY.leadsSold,
    kpis: [
      { label: '# Deals',         value: String(sold.length), color: SEMANTIC.neutral },
      { label: 'Total Premium',   value: money(t.premium),    color: SEMANTIC.good },
      { label: 'Total Advance',   value: money(t.advance),    color: SEMANTIC.good },
      { label: 'Total Lead Cost', value: money(t.leadCost),   color: SEMANTIC.neutral },
      { label: 'Net Profit',      value: money(netProfit),    color: netProfit >= 0 ? SEMANTIC.good : SEMANTIC.bad },
    ],
    columns: [
      { label: 'Client', align: 'left' },
      { label: 'Product(s)', align: 'left' },
      { label: 'Date Sold', align: 'left' },
      { label: 'CRM', align: 'left' },
      { label: 'Campaign', align: 'left' },
      { label: 'Premium', align: 'right' },
      { label: 'Advance', align: 'right' },
      { label: 'Lead Cost', align: 'right' },
    ],
    rows: sold.map(r => [
      { text: r.name, color: SEMANTIC.neutral, align: 'left' },
      { text: r.products, color: SEMANTIC.neutral, align: 'left' },
      { text: r.dateSold, color: SEMANTIC.neutral, align: 'left' },
      { text: r.crm, color: SEMANTIC.neutral, align: 'left' },
      { text: r.campaign, color: SEMANTIC.neutral, align: 'left' },
      { text: money(r.premium), color: SEMANTIC.good, align: 'right' },
      { text: money(r.advance), color: SEMANTIC.good, align: 'right' },
      { text: money(r.leadCost), color: SEMANTIC.neutral, align: 'right' },
    ]),
    totalsRow: [
      { text: 'Totals', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: money(t.premium), color: SEMANTIC.good, align: 'right' },
      { text: money(t.advance), color: SEMANTIC.good, align: 'right' },
      { text: money(t.leadCost), color: SEMANTIC.neutral, align: 'right' },
    ],
    empty: sold.length === 0,
    emptyMessage: 'No deals sold in this period.',
  };
}

// --- Report 2: Overrides --------------------------------------------------
export function buildOverridesReport(overrides, range) {
  const rows = (overrides || [])
    .filter(o => o && inRange(o.period, range))
    .map(o => ({
      date: toISO(o.period),
      source: o.label || o.source || o.customer || o.writingAgent || o.note || '—',
      amount: Number(o.amount) || 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return {
    layout: 'table',
    title: 'Overrides',
    identityColor: REPORT_IDENTITY.overrides,
    kpis: [
      { label: '# Entries', value: String(rows.length), color: SEMANTIC.neutral },
      { label: 'Total Override Income', value: money(total), color: SEMANTIC.good },
    ],
    columns: [
      { label: 'Date', align: 'left' },
      { label: 'Source', align: 'left' },
      { label: 'Amount', align: 'right' },
    ],
    rows: rows.map(r => [
      { text: r.date, color: SEMANTIC.neutral, align: 'left' },
      { text: r.source, color: SEMANTIC.neutral, align: 'left' },
      { text: money(r.amount), color: SEMANTIC.good, align: 'right' },
    ]),
    totalsRow: [
      { text: 'Total', align: 'left' },
      { text: '', align: 'left' },
      { text: money(total), color: SEMANTIC.good, align: 'right' },
    ],
    empty: rows.length === 0,
    emptyMessage: 'No override income recorded in this period.',
  };
}

// --- Report 3: Chargebacks ------------------------------------------------
export function buildChargebacksReport(chargebacks, range) {
  const rows = (chargebacks || [])
    .filter(c => c && inRange(c.period, range))
    .map(c => ({
      date: toISO(c.period),
      customer: c.customer || '—',
      policyId: c.policyId || '—',
      productDesc: c.productDesc || '—',
      type: c.isOwn ? 'Own' : 'Override',
      amount: Number(c.amount) || 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const ownTotal = rows.filter(r => r.type === 'Own').reduce((s, r) => s + r.amount, 0);
  const ovrTotal = total - ownTotal;

  return {
    layout: 'table',
    title: 'Chargebacks',
    identityColor: REPORT_IDENTITY.chargebacks,
    kpis: [
      { label: '# Chargebacks', value: String(rows.length), color: SEMANTIC.neutral },
      { label: 'Total Clawed Back', value: money(total), color: SEMANTIC.bad },
      { label: 'Own', value: money(ownTotal), color: SEMANTIC.bad },
      { label: 'Override', value: money(ovrTotal), color: SEMANTIC.bad },
    ],
    columns: [
      { label: 'Date', align: 'left' },
      { label: 'Client', align: 'left' },
      { label: 'Policy', align: 'left' },
      { label: 'Product', align: 'left' },
      { label: 'Type', align: 'left' },
      { label: 'Amount', align: 'right' },
    ],
    rows: rows.map(r => [
      { text: r.date, color: SEMANTIC.neutral, align: 'left' },
      { text: r.customer, color: SEMANTIC.neutral, align: 'left' },
      { text: r.policyId, color: SEMANTIC.neutral, align: 'left' },
      { text: r.productDesc, color: SEMANTIC.neutral, align: 'left' },
      { text: r.type, color: SEMANTIC.neutral, align: 'left' },
      { text: money(r.amount), color: SEMANTIC.bad, align: 'right' },
    ]),
    totalsRow: [
      { text: 'Total', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: '', align: 'left' },
      { text: money(total), color: SEMANTIC.bad, align: 'right' },
    ],
    empty: rows.length === 0,
    emptyMessage: 'No chargebacks in this period — good news.',
  };
}

// --- Report 4: Expenses --------------------------------------------------
// opts: { categoryLabels: { id: label }, budget: number, showBudget: boolean }
export function buildExpensesReport(expenses, range, opts = {}) {
  const { categoryLabels = {}, budget = 0, showBudget = false } = opts;
  const isPlatform = (catId) => String(catId || '').startsWith('PLATFORM_');

  const scoped = (expenses || []).filter(e => e && inRange(e.date, range));

  // Group by category id.
  const groups = new Map(); // catId -> { count, total }
  let platformTotal = 0;
  let booksTotal = 0;
  for (const e of scoped) {
    const catId = e.category || 'OTHER_EXPENSE';
    const amt = Number(e.amount) || 0;
    if (!groups.has(catId)) groups.set(catId, { count: 0, total: 0 });
    const g = groups.get(catId);
    g.count += 1;
    g.total += amt;
    if (isPlatform(catId)) platformTotal += amt; else booksTotal += amt;
  }
  const grandTotal = platformTotal + booksTotal;
  const overBudget = showBudget && budget > 0 && platformTotal > budget;

  const groupRows = [...groups.entries()]
    .map(([catId, g]) => ({
      label: categoryLabels[catId] || catId,
      group: isPlatform(catId) ? 'Platform' : 'Books',
      count: g.count,
      total: g.total,
    }))
    .sort((a, b) => b.total - a.total);

  const kpis = [
    { label: 'Total Spent', value: money(grandTotal),
      color: overBudget ? SEMANTIC.bad : SEMANTIC.neutral },
    { label: 'Books', value: money(booksTotal), color: SEMANTIC.neutral },
    { label: 'Platform', value: money(platformTotal), color: SEMANTIC.neutral },
  ];
  if (showBudget && budget > 0) {
    const bs = budgetStatus(platformTotal, budget);
    const pct = Math.round((platformTotal / budget) * 100);
    kpis.push({ label: 'vs Budget', value: `${pct}% of ${money(budget)}`, color: bs.color });
  }

  return {
    layout: 'table',
    title: 'Expenses',
    identityColor: REPORT_IDENTITY.expenses,
    kpis,
    columns: [
      { label: 'Category', align: 'left' },
      { label: 'Group', align: 'left' },
      { label: '# Items', align: 'right' },
      { label: 'Total', align: 'right' },
    ],
    rows: groupRows.map(r => [
      { text: r.label, color: SEMANTIC.neutral, align: 'left' },
      { text: r.group, color: SEMANTIC.neutral, align: 'left' },
      { text: String(r.count), color: SEMANTIC.neutral, align: 'right' },
      { text: money(r.total), color: SEMANTIC.neutral, align: 'right' },
    ]),
    totalsRow: [
      { text: 'Grand Total', align: 'left' },
      { text: '', align: 'left' },
      { text: String(scoped.length), color: SEMANTIC.neutral, align: 'right' },
      { text: money(grandTotal), color: overBudget ? SEMANTIC.bad : SEMANTIC.neutral, align: 'right' },
    ],
    empty: scoped.length === 0,
    emptyMessage: 'No expenses recorded in this period.',
  };
}
