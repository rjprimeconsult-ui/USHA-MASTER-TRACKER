import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAvFromAdvance, productKeyFromDesc, projectCommission } from './commission.js';

test('estimateAvFromAdvance: prefers commPremium × 12 (basis=premium)', () => {
  const r = estimateAvFromAdvance({ commPremium: 100, netAdvance: 999, rate: 0.2, advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);
  assert.equal(r.basis, 'premium');
});

test('estimateAvFromAdvance: reverses from advance when no commPremium (basis=reverse)', () => {
  // monthly = 100, rate 0.20 → monthlyCommission 20; advance = 20 × 7.5 = 150.
  const r = estimateAvFromAdvance({ netAdvance: 150, rate: 0.20, advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);      // (150 / 7.5 / 0.20) × 12
  assert.equal(r.basis, 'reverse');
});

test('estimateAvFromAdvance: percent-style rate (20) is normalized to 0.20', () => {
  const r = estimateAvFromAdvance({ netAdvance: 150, rate: 20, advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);
});

test('estimateAvFromAdvance: resolves rate from product+tier when no rate given', () => {
  // PREMIER ADVANTAGE WA = 0.20. advance 150, months 7.5 → AV 1200.
  const r = estimateAvFromAdvance({ netAdvance: 150, productKey: 'PREMIER_ADVANTAGE', tier: 'WA', advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);
});

test('estimateAvFromAdvance: unknown/zero rate and no premium → 0, basis=unknown', () => {
  assert.deepEqual(estimateAvFromAdvance({ netAdvance: 150, rate: 0, advanceMonths: 7.5 }),
    { estimatedAV: 0, basis: 'unknown' });
  assert.deepEqual(estimateAvFromAdvance({ netAdvance: 0, commPremium: 0 }),
    { estimatedAV: 0, basis: 'unknown' });
});

test('estimateAvFromAdvance: round-trips projectCommission (premium → advance → AV)', () => {
  const proj = projectCommission({ mainProduct: 'HEALTH ACCESS III', mainProductPremium: 300, products: [] }, 'WA');
  const r = estimateAvFromAdvance({ netAdvance: proj.advancePayout, productKey: 'HEALTH_ACCESS', tier: 'WA', advanceMonths: 7.5 });
  assert.ok(Math.abs(r.estimatedAV - 300 * 12) < 0.01);
});

test('productKeyFromDesc: maps common statement product descriptions', () => {
  assert.equal(productKeyFromDesc('PremierAdvantage Sickness'), 'PREMIER_ADVANTAGE');
  assert.equal(productKeyFromDesc('SECURE ADVANTAGE - ACCIDENT'), 'SECURE_ADVANTAGE');
  assert.equal(productKeyFromDesc('Health Access III'), 'HEALTH_ACCESS');
  assert.equal(productKeyFromDesc('Some Unknown Product'), null);
});
