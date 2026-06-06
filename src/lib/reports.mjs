import { SEMANTIC, REPORT_IDENTITY, budgetStatus, identityForPnl, netColor } from './reportColors.mjs';

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

// Total monthly premium for a lead = main product premium + add-on premiums.
//
// `mainProductPremium` holds the policy's monthly premium. For screenshot/
// portal imports — PRIM's dominant path — this is the USHA portal's
// "Monthly Premium" figure, which ALREADY folds in every product and the
// association membership. For manually-entered leads it is the main
// product only, with add-ons carrying their own premiums (screenshot
// imports store add-ons with premium 0, so adding them is harmless).
//
// The association plan premium is deliberately NOT added separately: doing
// so double-counts portal-imported leads (their mainProductPremium already
// includes it). Association is its own monthly stream — see the spec.
export function leadPremium(lead) {
  const main = Number(lead.mainProductPremium) || 0;
  const addons = (lead.products || []).reduce((s, p) => s + (Number(p?.premium) || 0), 0);
  return main + addons;
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
      // Annualized Value — the monthly premium × 12. Agents track AV as
      // their production number, so we surface it alongside the monthly.
      av: leadPremium(l) * 12,
      advance: Number(l.dealValue) || 0,
      leadCost: Number(l.leadCost) || 0,
    }))
    .sort((a, b) => b.dateSold.localeCompare(a.dateSold));

  const t = sold.reduce((acc, r) => ({
    premium: acc.premium + r.premium,
    av: acc.av + r.av,
    advance: acc.advance + r.advance,
    leadCost: acc.leadCost + r.leadCost,
  }), { premium: 0, av: 0, advance: 0, leadCost: 0 });
  const netProfit = t.advance - t.leadCost;

  return {
    layout: 'table',
    title: 'Leads Sold',
    identityColor: REPORT_IDENTITY.leadsSold,
    kpis: [
      { label: '# Deals',         value: String(sold.length), color: SEMANTIC.neutral },
      { label: 'Total AV',        value: money(t.av),         color: SEMANTIC.good },
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
      { label: 'AV', align: 'right' },
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
      { text: money(r.av), color: SEMANTIC.good, align: 'right' },
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
      { text: money(t.av), color: SEMANTIC.good, align: 'right' },
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

// --- Report 5: P&L Summary ----------------------------------------------
// data: { leads, overrides, expenses, abDetail, businessIncome }
//   abDetail       — association-bonus residual rows (association_bonus_detail_v1)
//   businessIncome — Books income entries (business_income_v1)
//
// Chargebacks are intentionally NOT part of the P&L: they draw from the
// agent's USHA-managed reserve account, not their take-home income — USHA
// handles that on their side, and PRIM does not track the reserve. See
// the standalone Chargebacks report for that data.
export function buildPnlReport(data, range) {
  const {
    leads = [], overrides = [], expenses = [],
    abDetail = [], businessIncome = [], ownAdvances = [],
  } = data || {};

  // Own-sales commission income. Prefer the STATEMENT TRUTH — the
  // own_advances rows parsed straight from the weekly statements, scoped by
  // statement period — because that's what was actually paid. Fall back to
  // summing issued-lead dealValue only when no statement rows fall in the
  // range (statements not imported yet, or a lead marked Issued by hand).
  // This mirrors the CPA Dashboard's "Earned" exactly, so the P&L
  // reconciles to the statements instead of drifting from them. (Was: lead
  // dealValue only, which under-counted when statement advances didn't all
  // map onto leads.)
  const ownAdvanceRows = (ownAdvances || []).filter(a => a && inRange(a.period, range));
  const ownFromStatements = ownAdvanceRows.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const ownFromLeads = leads
    .filter(l => l && l.stage === 'Issued' && inRange(l.closedDate, range))
    .reduce((s, l) => s + (Number(l.dealValue) || 0), 0);
  const commissions = ownAdvanceRows.length > 0 ? ownFromStatements : ownFromLeads;
  const overrideIncome = overrides
    .filter(o => o && inRange(o.period, range))
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);
  // Association Bonus residuals — monthly income, not advances. Each row
  // is scoped by its applied date, falling back to the 1st of its
  // production month. asEarned is summed including negative adjustments
  // so the figure is the true net residual income.
  const associationIncome = abDetail
    .filter(r => r && inRange(r.appliedDate || (r.period ? `${r.period}-01` : ''), range))
    .reduce((s, r) => s + (Number(r.asEarned) || 0), 0);
  // Other income logged in Books (production bonuses, misc income).
  const booksIncome = businessIncome
    .filter(e => e && inRange(e.date, range))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  let platformExp = 0;
  let booksExp = 0;
  for (const e of expenses) {
    if (!e || !inRange(e.date, range)) continue;
    const amt = Number(e.amount) || 0;
    if (String(e.category || '').startsWith('PLATFORM_')) platformExp += amt;
    else booksExp += amt;
  }

  const totalIn = commissions + overrideIncome + associationIncome + booksIncome;
  const totalOut = platformExp + booksExp;
  const net = totalIn - totalOut;

  return {
    layout: 'summary',
    title: 'P&L Summary',
    identityColor: identityForPnl(net),
    kpis: [
      { label: 'Total In', value: money(totalIn), color: SEMANTIC.good },
      { label: 'Total Out', value: money(totalOut), color: SEMANTIC.bad },
      { label: 'Net Result', value: money(net), color: netColor(net) },
    ],
    sections: [
      {
        title: 'Income',
        lines: [
          { label: 'Commissions (issued advances)', amount: money(commissions), color: SEMANTIC.good },
          { label: 'Override income', amount: money(overrideIncome), color: SEMANTIC.good },
          { label: 'Association Bonus (residuals)', amount: money(associationIncome), color: SEMANTIC.good },
          { label: 'Other income (Books)', amount: money(booksIncome), color: SEMANTIC.good },
        ],
        subtotal: { label: 'Total In', amount: money(totalIn), color: SEMANTIC.good },
      },
      {
        title: 'Outflow',
        lines: [
          { label: 'Platform expenses', amount: money(platformExp), color: SEMANTIC.neutral },
          { label: 'Books expenses', amount: money(booksExp), color: SEMANTIC.neutral },
        ],
        subtotal: { label: 'Total Out', amount: money(totalOut), color: SEMANTIC.bad },
      },
    ],
    net: { label: 'Net Result', amount: money(net), color: netColor(net) },
    note: 'Chargebacks are not included — they draw from your USHA-managed reserve account, not your take-home income. See the Chargebacks report to review them.',
    empty: false,
  };
}
