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
