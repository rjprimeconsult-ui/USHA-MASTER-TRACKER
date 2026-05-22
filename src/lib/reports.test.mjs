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
