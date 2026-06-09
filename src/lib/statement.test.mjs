import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStatement } from './statement.js';

// reconcileStatement(parsed, leads) → { matched, unmatched, ... }
// `matched` is one row per (customer-grouped advance) × matched tracker lead.
const OWNER = 'MORALES, GABRIEL';
const run = (advanceRows, leads) =>
  reconcileStatement({ header: { owner: OWNER }, advanceRows }, leads);

test('multi-policy customer: advances attributed BY POLICY number (not split evenly)', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: 'POLA', netAdvance: 600 },
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: 'POLB', netAdvance: 400 },
  ];
  const leads = [
    { id: 'L1', name: 'SMITH, JOHN', policyNumber: 'POLA', stage: 'Issued', dealValue: 0 },
    { id: 'L2', name: 'SMITH, JOHN', policyNumber: 'POLB', stage: 'Issued', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.L1.total, 600); // policy A advance → lead A
  assert.equal(byId.L2.total, 400); // policy B advance → lead B  (was 500/500)
});

test('policy match is case/space-insensitive', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: ' pola ', netAdvance: 600 },
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: 'polb', netAdvance: 400 },
  ];
  const leads = [
    { id: 'L1', name: 'SMITH, JOHN', policyNumber: 'POLA', stage: 'Issued', dealValue: 0 },
    { id: 'L2', name: 'SMITH, JOHN', policyNumber: 'POLB', stage: 'Issued', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.L1.total, 600);
  assert.equal(byId.L2.total, 400);
});

test('no policy match → falls back to even split (no regression)', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: 'POLX', netAdvance: 1000 },
  ];
  const leads = [
    { id: 'L1', name: 'SMITH, JOHN', policyNumber: 'POLA', stage: 'Issued', dealValue: 0 },
    { id: 'L2', name: 'SMITH, JOHN', policyNumber: 'POLB', stage: 'Issued', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.L1.total, 500);
  assert.equal(byId.L2.total, 500);
});

test('single-policy customer: full advance to the one lead', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLZ', netAdvance: 800 },
  ];
  const leads = [
    { id: 'L9', name: 'DOE, JANE', policyNumber: 'POLZ', stage: 'Issued', dealValue: 0 },
  ];
  const { matched } = run(advanceRows, leads);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].total, 800);
});

test('partial policy match: matched row to its lead, unmatched remainder split', () => {
  // POLA matches L1 → 600; POLX matches nobody → 300 split across L1+L2 (150 each)
  const advanceRows = [
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: 'POLA', netAdvance: 600 },
    { writingAgent: OWNER, customer: 'SMITH, JOHN', policyId: 'POLX', netAdvance: 300 },
  ];
  const leads = [
    { id: 'L1', name: 'SMITH, JOHN', policyNumber: 'POLA', stage: 'Issued', dealValue: 0 },
    { id: 'L2', name: 'SMITH, JOHN', policyNumber: 'POLB', stage: 'Issued', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.L1.total, 750); // 600 (policy) + 150 (share of unmatched 300)
  assert.equal(byId.L2.total, 150); // 0 + 150
});
