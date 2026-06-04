import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStatementIncome, groupStatements, statementsInRange } from './statementManager.mjs';

const adv = (id, period, amount, customer = 'C') => ({ id, period, amount, customer, productDesc: 'P', policyId: 'PID' + id });
const inc = (id, date, amount, over = {}) => ({ id, date, amount, category: 'MONTHLIES', source: 'Production Bonus', notes: 'Auto-imported from statement (RENEWAL_BONUS)', ...over });

test('isStatementIncome: flag, note-prefix true; manual income false', () => {
  assert.equal(isStatementIncome({ fromStatement: true }), true);
  assert.equal(isStatementIncome({ notes: 'Auto-imported from statement (BONUS)' }), true);
  assert.equal(isStatementIncome({ notes: 'Manual entry', category: 'OTHER_INCOME' }), false);
  assert.equal(isStatementIncome({}), false);
});

test('groupStatements: weekly grouped by period (desc), monthly by month (desc)', () => {
  const g = groupStatements({
    ownAdvances: [adv('o1', '2026-01-05', 100), adv('o2', '2026-01-12', 50)],
    overrides:   [adv('v1', '2026-01-05', 20)],
    chargebacks: [adv('c1', '2026-01-12', 30)],
    businessIncome: [inc('i1', '2026-01-31', 200), inc('i2', '2026-02-28', 300), { id: 'm1', date: '2026-01-15', amount: 999, notes: 'Manual' }],
  });
  assert.deepEqual(g.weekly.map(w => w.period), ['2026-01-12', '2026-01-05']);
  const wk5 = g.weekly.find(w => w.period === '2026-01-05');
  assert.equal(wk5.own.length, 1);
  assert.equal(wk5.override.length, 1);
  assert.equal(wk5.totals.own, 100);
  assert.equal(wk5.totals.override, 20);
  const wk12 = g.weekly.find(w => w.period === '2026-01-12');
  assert.equal(wk12.totals.chargeback, 30);
  assert.deepEqual(g.monthly.map(m => m.month), ['2026-02', '2026-01']);
  assert.equal(g.monthly.find(m => m.month === '2026-01').total, 200);
});

test('statementsInRange: inclusive boundaries; weekly by period, monthly by date', () => {
  const stores = {
    ownAdvances: [adv('o1', '2026-01-01', 100), adv('o2', '2026-06-04', 50), adv('o3', '2026-06-05', 10)],
    overrides:   [adv('v1', '2026-03-01', 20)],
    chargebacks: [adv('c1', '2025-12-31', 30)],
    businessIncome: [inc('i1', '2026-01-01', 200), inc('i2', '2026-06-04', 300), inc('i3', '2026-07-01', 1)],
  };
  const r = statementsInRange(stores, '2026-01-01', '2026-06-04');
  assert.deepEqual([...r.ownIds].sort(), ['o1', 'o2']);
  assert.deepEqual([...r.overrideIds], ['v1']);
  assert.deepEqual([...r.chargebackIds], []);
  assert.deepEqual([...r.monthlyIds].sort(), ['i1', 'i2']);
  assert.equal(r.totals.own, 150);
  assert.equal(r.totals.override, 20);
  assert.equal(r.totals.chargeback, 0);
  assert.equal(r.totals.monthlyIncome, 500);
  assert.equal(r.counts.own, 2);
  assert.equal(r.counts.monthly, 2);
});

test('statementsInRange: empty range → zeros', () => {
  const r = statementsInRange({ ownAdvances: [], overrides: [], chargebacks: [], businessIncome: [] }, '2026-01-01', '2026-12-31');
  assert.equal(r.counts.own, 0);
  assert.equal(r.totals.monthlyIncome, 0);
  assert.equal(r.ownIds.size, 0);
});
