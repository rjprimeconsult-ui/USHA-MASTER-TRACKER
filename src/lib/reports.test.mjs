import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, netColor, valueColor, SEMANTIC } from './reportColors.mjs';

test('budgetStatus — no budget set returns "none"', () => {
  assert.equal(budgetStatus(500, 0).status, 'none');
  assert.equal(budgetStatus(500, null).status, 'none');
});

test('budgetStatus — under 90% is "under" / good', () => {
  const r = budgetStatus(800, 1000);
  assert.equal(r.status, 'under');
  assert.equal(r.color, SEMANTIC.good);
});

test('budgetStatus — 90%-100% is "near" / warn', () => {
  assert.equal(budgetStatus(950, 1000).status, 'near');
  assert.equal(budgetStatus(1000, 1000).status, 'near');
});

test('budgetStatus — over 100% is "over" / bad', () => {
  const r = budgetStatus(1300, 1000);
  assert.equal(r.status, 'over');
  assert.equal(r.color, SEMANTIC.bad);
});

test('netColor — non-negative is good, negative is bad', () => {
  assert.equal(netColor(0), SEMANTIC.good);
  assert.equal(netColor(100), SEMANTIC.good);
  assert.equal(netColor(-1), SEMANTIC.bad);
});

test('valueColor — maps kind to a hex, unknown falls back to neutral', () => {
  assert.equal(valueColor('good'), SEMANTIC.good);
  assert.equal(valueColor('bad'), SEMANTIC.bad);
  assert.equal(valueColor('whatever'), SEMANTIC.neutral);
});

import { resolvePeriod } from './reports.mjs';

// Fixed "now" — Fri May 22 2026 — for deterministic preset boundaries.
const NOW = new Date(2026, 4, 22);

test('resolvePeriod thisMonth — 1st of month to today', () => {
  const r = resolvePeriod('thisMonth', NOW);
  assert.equal(r.from, '2026-05-01');
  assert.equal(r.to, '2026-05-22');
  assert.equal(r.label, 'May 2026');
});

test('resolvePeriod lastMonth — full previous calendar month', () => {
  const r = resolvePeriod('lastMonth', NOW);
  assert.equal(r.from, '2026-04-01');
  assert.equal(r.to, '2026-04-30');
  assert.equal(r.label, 'April 2026');
});

test('resolvePeriod thisQuarter — Q2 starts April 1', () => {
  const r = resolvePeriod('thisQuarter', NOW);
  assert.equal(r.from, '2026-04-01');
  assert.equal(r.to, '2026-05-22');
  assert.equal(r.label, 'Q2 2026');
});

test('resolvePeriod ytd — Jan 1 to today', () => {
  const r = resolvePeriod('ytd', NOW);
  assert.equal(r.from, '2026-01-01');
  assert.equal(r.to, '2026-05-22');
});

test('resolvePeriod lastYear — full previous year', () => {
  const r = resolvePeriod('lastYear', NOW);
  assert.equal(r.from, '2025-01-01');
  assert.equal(r.to, '2025-12-31');
  assert.equal(r.label, '2025');
});

test('resolvePeriod custom — uses provided from/to', () => {
  const r = resolvePeriod('custom', NOW, { from: '2026-02-10', to: '2026-03-15' });
  assert.equal(r.from, '2026-02-10');
  assert.equal(r.to, '2026-03-15');
});

import { toISO, inRange, money, buildLeadsSoldReport } from './reports.mjs';

test('toISO — accepts ISO and US M/D/YYYY', () => {
  assert.equal(toISO('2026-05-10'), '2026-05-10');
  assert.equal(toISO('5/10/2026'), '2026-05-10');
  assert.equal(toISO('5/9/26'), '2026-05-09');
  assert.equal(toISO(''), '');
  assert.equal(toISO('garbage'), '');
});

test('inRange — inclusive on both ends', () => {
  const range = { from: '2026-05-01', to: '2026-05-31' };
  assert.equal(inRange('2026-05-01', range), true);
  assert.equal(inRange('2026-05-31', range), true);
  assert.equal(inRange('2026-04-30', range), false);
  assert.equal(inRange('2026-06-01', range), false);
});

test('money — whole-dollar formatting', () => {
  assert.equal(money(1234.56), '$1,235');
  assert.equal(money(0), '$0');
  assert.equal(money(-1200), '-$1,200');
});

test('buildLeadsSoldReport — filters to Issued in range, totals sum the rows', () => {
  const leads = [
    { name: 'A', stage: 'Issued', closedDate: '2026-05-10',
      products: [{ id: 'PA', premium: 400 }, { id: 'MG', premium: 100 }],
      crm: 'RINGY', campaign: 'AGED', dealValue: 600, leadCost: 25 },
    { name: 'B', stage: 'Issued', closedDate: '2026-05-20',
      products: [{ id: 'PC', premium: 300 }], crm: 'TD', campaign: 'AGED',
      dealValue: 350, leadCost: 8 },
    { name: 'C', stage: 'Pending', closedDate: '2026-05-15', products: [], dealValue: 0, leadCost: 0 },
    { name: 'D', stage: 'Issued', closedDate: '2026-04-01', products: [], dealValue: 999, leadCost: 0 },
  ];
  const rep = buildLeadsSoldReport(leads, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.layout, 'table');
  assert.equal(rep.rows.length, 2);          // A + B only (C pending, D out of range)
  assert.equal(rep.empty, false);
  // KPI 0 is "# Deals"
  assert.equal(rep.kpis[0].value, '2');
  // totalsRow last cells: premium 800, advance 950, leadCost 33, net 917
  const totalsText = rep.totalsRow.map(c => c.text);
  assert.ok(totalsText.includes('$800'));    // total premium
  assert.ok(totalsText.includes('$950'));    // total advance
  assert.ok(totalsText.includes('$33'));     // total lead cost
});

test('buildLeadsSoldReport — empty when no deals match', () => {
  const rep = buildLeadsSoldReport([], { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.empty, true);
  assert.equal(rep.rows.length, 0);
});

import { buildOverridesReport } from './reports.mjs';

test('buildOverridesReport — filters by period, totals sum amounts', () => {
  const overrides = [
    { amount: 120, period: '2026-05-05', customer: 'Client A' },
    { amount: 80,  period: '5/18/2026', source: 'Sub-agent B' },
    { amount: 500, period: '2026-03-01' },          // out of range
  ];
  const rep = buildOverridesReport(overrides, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.rows.length, 2);
  assert.equal(rep.kpis[0].value, '2');             // # Entries
  assert.equal(rep.kpis[1].value, '$200');          // Total Override Income
  assert.equal(rep.empty, false);
});

test('buildOverridesReport — empty input', () => {
  const rep = buildOverridesReport([], { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.empty, true);
});

import { buildChargebacksReport } from './reports.mjs';

test('buildChargebacksReport — filters by period, totals + own/override split', () => {
  const cbs = [
    { customer: 'A', policyId: 'P1', productDesc: 'PA', amount: 200, period: '2026-05-04', isOwn: true },
    { customer: 'B', policyId: 'P2', productDesc: 'PC', amount: 150, period: '5/19/2026', isOwn: false },
    { customer: 'C', policyId: 'P3', productDesc: 'SA', amount: 999, period: '2026-01-01', isOwn: true },
  ];
  const rep = buildChargebacksReport(cbs, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.rows.length, 2);
  assert.equal(rep.kpis[0].value, '2');        // # Chargebacks
  assert.equal(rep.kpis[1].value, '$350');     // Total Clawed Back
  assert.equal(rep.empty, false);
});

test('buildChargebacksReport — empty input shows good-news message', () => {
  const rep = buildChargebacksReport([], { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.empty, true);
  assert.match(rep.emptyMessage, /good news/i);
});

import { buildExpensesReport } from './reports.mjs';

const CAT_LABELS = {
  PLATFORM_RINGY: 'Ringy',
  SOFTWARE: 'Software',
  OFFICE: 'Office Supplies',
};

test('buildExpensesReport — groups by category, splits Platform vs Books', () => {
  const exp = [
    { date: '2026-05-03', amount: 100, category: 'PLATFORM_RINGY' },
    { date: '2026-05-09', amount: 100, category: 'PLATFORM_RINGY' },
    { date: '2026-05-12', amount: 60,  category: 'SOFTWARE' },
    { date: '2026-04-01', amount: 999, category: 'OFFICE' },   // out of range
  ];
  const rep = buildExpensesReport(exp, { from: '2026-05-01', to: '2026-05-31' },
    { categoryLabels: CAT_LABELS, budget: 0, showBudget: false });
  assert.equal(rep.rows.length, 2);                 // Ringy group + Software group
  assert.equal(rep.kpis[0].value, '$260');          // Total Spent
  // Platform subtotal = 200, Books subtotal = 60
  assert.ok(rep.kpis.some(k => k.label === 'Platform' && k.value === '$200'));
  assert.ok(rep.kpis.some(k => k.label === 'Books' && k.value === '$60'));
});

test('buildExpensesReport — vs Budget KPI appears only when showBudget', () => {
  const exp = [{ date: '2026-05-03', amount: 1200, category: 'PLATFORM_RINGY' }];
  const range = { from: '2026-05-01', to: '2026-05-31' };
  const withBudget = buildExpensesReport(exp, range,
    { categoryLabels: CAT_LABELS, budget: 1000, showBudget: true });
  assert.ok(withBudget.kpis.some(k => k.label === 'vs Budget'));
  const without = buildExpensesReport(exp, range,
    { categoryLabels: CAT_LABELS, budget: 1000, showBudget: false });
  assert.equal(without.kpis.some(k => k.label === 'vs Budget'), false);
});

test('buildExpensesReport — empty input', () => {
  const rep = buildExpensesReport([], { from: '2026-05-01', to: '2026-05-31' },
    { categoryLabels: {}, budget: 0, showBudget: false });
  assert.equal(rep.empty, true);
});

import { buildPnlReport } from './reports.mjs';

test('buildPnlReport — net = total in minus total out, chargebacks excluded', () => {
  const data = {
    leads: [{ stage: 'Issued', closedDate: '2026-05-10', products: [], dealValue: 3000, leadCost: 0 }],
    overrides: [{ amount: 500, period: '2026-05-12' }],
    chargebacks: [{ amount: 200, period: '2026-05-15' }],   // must NOT affect the P&L
    expenses: [
      { date: '2026-05-03', amount: 300, category: 'PLATFORM_RINGY' },
      { date: '2026-05-08', amount: 100, category: 'SOFTWARE' },
    ],
  };
  const rep = buildPnlReport(data, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.layout, 'summary');
  // In = 3000 + 500 = 3500; Out = 300 + 100 = 400 (chargeback ignored); Net = 3100
  assert.equal(rep.net.amount, '$3,100');
  assert.equal(rep.net.color, '#059669');           // good — positive
  // Outflow has exactly 2 lines — no Chargebacks line.
  const outflow = rep.sections.find(s => s.title === 'Outflow');
  assert.equal(outflow.lines.length, 2);
  assert.equal(outflow.lines.some(l => /chargeback/i.test(l.label)), false);
});

test('buildPnlReport — commissions use statement own-advances when present', () => {
  const data = {
    // Lead dealValue says 3000, but the weekly statements actually paid 3500.
    leads: [{ stage: 'Issued', closedDate: '2026-05-10', products: [], dealValue: 3000, leadCost: 0 }],
    ownAdvances: [
      { amount: 2000, period: '2026-05-09' },
      { amount: 1500, period: '2026-05-16' },
    ],
    overrides: [], expenses: [],
  };
  const rep = buildPnlReport(data, { from: '2026-05-01', to: '2026-05-31' });
  const income = rep.sections.find(s => s.title === 'Income');
  const comm = income.lines.find(l => /commission/i.test(l.label));
  // Statement truth (3500) wins over lead dealValue (3000) — the bug fix.
  assert.equal(comm.amount, '$3,500');
  assert.equal(rep.net.amount, '$3,500');
});

test('buildPnlReport — falls back to lead dealValue when no statement rows in range', () => {
  const data = {
    leads: [{ stage: 'Issued', closedDate: '2026-05-10', products: [], dealValue: 3000, leadCost: 0 }],
    ownAdvances: [{ amount: 999, period: '2026-04-15' }],   // out of range → ignored
    overrides: [], expenses: [],
  };
  const rep = buildPnlReport(data, { from: '2026-05-01', to: '2026-05-31' });
  const income = rep.sections.find(s => s.title === 'Income');
  const comm = income.lines.find(l => /commission/i.test(l.label));
  assert.equal(comm.amount, '$3,000');
});

test('buildPnlReport — negative net flips color to red', () => {
  const data = {
    leads: [], overrides: [],
    chargebacks: [{ amount: 500, period: '2026-05-15' }],   // ignored
    expenses: [{ date: '2026-05-03', amount: 200, category: 'SOFTWARE' }],
  };
  const rep = buildPnlReport(data, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.net.amount, '-$200');            // 0 in - 200 expenses
  assert.equal(rep.net.color, '#DC2626');           // bad — negative
});

test('buildLeadsSoldReport — premium = mainProductPremium + add-ons', () => {
  const leads = [{
    name: 'A', stage: 'Issued', closedDate: '2026-05-10',
    mainProductPremium: 450,
    products: [{ id: 'MG', premium: 100 }],
    dealValue: 600, leadCost: 0,
  }];
  const rep = buildLeadsSoldReport(leads, { from: '2026-05-01', to: '2026-05-31' });
  // 450 + 100 = 550. Column index 5 = Premium.
  assert.equal(rep.rows[0][5].text, '$550');
});

test('buildLeadsSoldReport — AV column = premium × 12 (row, total, KPI)', () => {
  const leads = [{
    name: 'A', stage: 'Issued', closedDate: '2026-05-10',
    mainProductPremium: 450,
    products: [{ id: 'MG', premium: 100 }],   // premium = 550
    dealValue: 600, leadCost: 10,
  }];
  const rep = buildLeadsSoldReport(leads, { from: '2026-05-01', to: '2026-05-31' });
  // Index 5 = Premium ($550), index 6 = AV (550 × 12 = $6,600).
  assert.equal(rep.rows[0][5].text, '$550');
  assert.equal(rep.rows[0][6].text, '$6,600');
  // Total AV KPI is present and correct.
  const avKpi = rep.kpis.find(k => k.label === 'Total AV');
  assert.ok(avKpi, 'Total AV KPI exists');
  assert.equal(avKpi.value, '$6,600');
  // Totals row carries both premium and AV.
  const totalsText = rep.totalsRow.map(c => c.text);
  assert.ok(totalsText.includes('$550'));
  assert.ok(totalsText.includes('$6,600'));
});

test('buildLeadsSoldReport — portal-imported lead: premium is mainProductPremium, association NOT re-added', () => {
  // Screenshot/portal imports store the portal's full Monthly Premium in
  // mainProductPremium and add-ons with premium 0. The association plan
  // must NOT be added on top — it is already inside mainProductPremium.
  const leads = [{
    name: 'Rocio', stage: 'Issued', closedDate: '2026-05-20',
    mainProductPremium: 504.41,
    products: [{ id: 'MedGuard III', premium: 0 }, { id: 'SA Accident', premium: 0 }],
    associationPlan: 'AMERICAN INDEPENDENT BUSINESS COALITION - Ruby',
    dealValue: 0, leadCost: 0,
  }];
  const rep = buildLeadsSoldReport(leads, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.rows[0][5].text, '$504');        // matches the USHA portal
});

test('buildPnlReport — income includes association residuals + Books income', () => {
  const data = {
    leads: [{ stage: 'Issued', closedDate: '2026-05-10', products: [], dealValue: 1000, leadCost: 0 }],
    overrides: [{ amount: 200, period: '2026-05-12' }],
    chargebacks: [],
    expenses: [],
    abDetail: [
      { period: '2026-05', appliedDate: '2026-05-15', asEarned: 150 },
      { period: '2026-05', appliedDate: '2026-05-20', asEarned: -10 },  // adjustment nets in
      { period: '2026-02', appliedDate: '2026-02-10', asEarned: 999 },  // out of range
    ],
    businessIncome: [
      { date: '2026-05-08', amount: 300 },
      { date: '2026-04-01', amount: 999 },                              // out of range
    ],
  };
  const rep = buildPnlReport(data, { from: '2026-05-01', to: '2026-05-31' });
  // In = 1000 + 200 + (150 - 10) + 300 = 1640
  assert.equal(rep.net.amount, '$1,640');
  assert.equal(rep.sections[0].lines.length, 4);
  assert.equal(rep.sections[0].lines[2].label, 'Association Bonus (residuals)');
  assert.equal(rep.sections[0].lines[2].amount, '$140');
  assert.equal(rep.sections[0].lines[3].label, 'Other income (Books)');
  assert.equal(rep.sections[0].lines[3].amount, '$300');
});

test('buildPnlReport — association residual scoped by period when appliedDate is null', () => {
  const data = {
    leads: [], overrides: [], chargebacks: [], expenses: [],
    abDetail: [{ period: '2026-05', appliedDate: null, asEarned: 75 }],
    businessIncome: [],
  };
  const rep = buildPnlReport(data, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(rep.sections[0].lines[2].amount, '$75');
});

// --- Estimated AV fallback (gap-fill for clients with an advance but no real AV)
import { leadPremium, isEstimatedAV, estimatedAvTotals } from './reports.mjs';

test('leadPremium: real premium wins, estimate ignored', () => {
  const l = { mainProductPremium: 200, products: [], avEstimated: true, estimatedAV: 9999 };
  assert.equal(leadPremium(l), 200);
  assert.equal(isEstimatedAV(l), false);
});

test('leadPremium: falls back to estimatedAV/12 when no real premium', () => {
  const l = { mainProductPremium: 0, products: [], avEstimated: true, estimatedAV: 1200 };
  assert.equal(leadPremium(l), 100);   // 1200 / 12
  assert.equal(isEstimatedAV(l), true);
});

test('leadPremium: no premium and no estimate → 0', () => {
  assert.equal(leadPremium({ mainProductPremium: 0, products: [] }), 0);
});

test('estimatedAvTotals: sums estimated AV vs total AV', () => {
  const leads = [
    { mainProductPremium: 100, products: [] },                                   // real AV 1200
    { mainProductPremium: 0, products: [], avEstimated: true, estimatedAV: 600 }, // est AV 600
  ];
  assert.deepEqual(estimatedAvTotals(leads), { estimatedAV: 600, totalAV: 1800 });
});
