import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStatement, buildAdvancePatch } from './statement.js';

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

// ---------------------------------------------------------------------------
// buildAdvancePatch — the per-lead patch applied when a statement advance
// matches a tracker lead. Regression guard for the bug where advances on
// Not taken / Declined / Withdrawn leads were silently dropped (jaydenmor,
// 2026-06-13): the matched-customers preview promised them, then apply skipped
// any lead not already Pending/Issued.
// ---------------------------------------------------------------------------
test('buildAdvancePatch: writes the advance for ALL stages, not just Pending/Issued', () => {
  for (const stage of ['Not taken', 'Declined', 'Withdrawn']) {
    const patch = buildAdvancePatch({ stage }, 488.57, '2026-06-13');
    assert.equal(patch.dealValue, 488.57, `${stage} lead must receive its advance`);
    assert.equal(patch.stage, undefined, `${stage} must NOT be auto-flipped to Issued`);
    assert.equal(patch.lastTouch, '2026-06-13');
  }
});

test('buildAdvancePatch: Pending is promoted to Issued AND gets the advance', () => {
  const patch = buildAdvancePatch({ stage: 'Pending' }, 100.96, '2026-06-13');
  assert.equal(patch.dealValue, 100.96);
  assert.equal(patch.stage, 'Issued');
});

test('buildAdvancePatch: Issued keeps its stage and gets the advance', () => {
  const patch = buildAdvancePatch({ stage: 'Issued' }, 355.44, '2026-06-13');
  assert.equal(patch.dealValue, 355.44);
  assert.equal(patch.stage, undefined); // no stage change emitted → stays Issued
});

test('buildAdvancePatch: rounds to cents and tolerates junk totals', () => {
  assert.equal(buildAdvancePatch({ stage: 'Issued' }, 100.567, 'd').dealValue, 100.57);
  assert.equal(buildAdvancePatch({ stage: 'Issued' }, undefined, 'd').dealValue, 0);
  assert.equal(buildAdvancePatch(null, 50, 'd').dealValue, 50); // missing lead → still safe
});

// ---------------------------------------------------------------------------
// Stage-aware split of unattributed advances. A product the client Declined /
// didn't take / withdrew earned no commission, so it must not soak up half of
// an advance that belongs to the active product (jaydenmor, 2026-06-13: UW
// product declined, then GI product Health Access III issued — the whole
// advance is the GI lead's, was being split 50/50).
// ---------------------------------------------------------------------------
test('unmatched advance skips a Declined sibling and pays the active product in full', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'GIPOLICY', netAdvance: 400 },
  ];
  const leads = [
    { id: 'UW', name: 'DOE, JANE', policyNumber: 'UWPOL', stage: 'Declined', dealValue: 0, mainProduct: 'Premier Advantage' },
    { id: 'GI', name: 'DOE, JANE', policyNumber: '',      stage: 'Issued',   dealValue: 0, mainProduct: 'Health Access III' },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.GI.total, 400); // active product gets it all
  assert.equal(byId.UW.total, 0);   // declined product gets nothing
});

test('unmatched advance still splits evenly when all siblings are active', () => {
  const advanceRows = [{ writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'X', netAdvance: 300 }];
  const leads = [
    { id: 'A', name: 'DOE, JANE', policyNumber: 'PA', stage: 'Issued',  dealValue: 0 },
    { id: 'B', name: 'DOE, JANE', policyNumber: 'PB', stage: 'Pending', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.A.total, 150);
  assert.equal(byId.B.total, 150);
});

test('unmatched advance falls back to even split when ALL siblings are negative (money not lost)', () => {
  const advanceRows = [{ writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'X', netAdvance: 200 }];
  const leads = [
    { id: 'A', name: 'DOE, JANE', policyNumber: 'PA', stage: 'Declined',  dealValue: 0 },
    { id: 'B', name: 'DOE, JANE', policyNumber: 'PB', stage: 'Not taken', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.A.total, 100);
  assert.equal(byId.B.total, 100);
});

test('exact policy match pays the matched lead even if Declined (only the split avoids dead siblings)', () => {
  const advanceRows = [{ writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'UWPOL', netAdvance: 500 }];
  const leads = [
    { id: 'UW', name: 'DOE, JANE', policyNumber: 'UWPOL', stage: 'Declined', dealValue: 0 },
    { id: 'GI', name: 'DOE, JANE', policyNumber: 'GIPOL', stage: 'Issued',   dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.UW.total, 500);
  assert.equal(byId.GI.total, 0);
});

// --- Per-lead Estimated AV from advance rows (gap-fill for missing AV)
test('reconcileStatement: attaches per-lead estimatedAV from commPremium', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLA', netAdvance: 150, commPremium: 100 },
  ];
  const leads = [{ id: 'L1', name: 'DOE, JANE', policyNumber: 'POLA', stage: 'Not taken', dealValue: 0 }];
  const m = run(advanceRows, leads).matched.find(x => x.leadId === 'L1');
  assert.equal(m.estimatedAV, 1200);
});

test('reconcileStatement: splits estimatedAV across leads in proportion to advance', () => {
  const advanceRows = [
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLA', netAdvance: 300, commPremium: 100 },
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLB', netAdvance: 300, commPremium: 100 },
  ];
  const leads = [
    { id: 'A', name: 'DOE, JANE', policyNumber: 'POLA', stage: 'Issued', dealValue: 0 },
    { id: 'B', name: 'DOE, JANE', policyNumber: 'POLB', stage: 'Issued', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.A.estimatedAV, 1200);
  assert.equal(byId.B.estimatedAV, 1200);
});
