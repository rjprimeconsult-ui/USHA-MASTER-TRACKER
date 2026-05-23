// Tests for the duplicate-lead resolver pure logic.
//
//   Run:  node --test src/lib/duplicateResolver.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDuplicateGroups,
  enumeratePairs,
  shouldSkipPair,
  classifyPair,
  mergeLeads,
} from './duplicateResolver.mjs';

// Trivial nameKey — strips middle initials + lowercases tokens, sorts.
// Mirrors the real lib/statement.js nameKey for test purposes.
const nameKey = (name) => String(name || '')
  .toLowerCase()
  .replace(/[^a-z\s']/g, ' ')
  .replace(/\b[a-z]\b/g, ' ')
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(' ');

test('findDuplicateGroups — groups leads by normalized name', () => {
  const leads = [
    { id: '1', name: 'Eva G Salas' },
    { id: '2', name: 'EVA SALAS' },
    { id: '3', name: 'John Doe' },
    { id: '4', name: 'Jane Doe' },
  ];
  const groups = findDuplicateGroups(leads, nameKey);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].leads.length, 2);
  assert.deepEqual(groups[0].leads.map(l => l.id).sort(), ['1', '2']);
});

test('findDuplicateGroups — ignores leads without a name', () => {
  const leads = [
    { id: '1', name: '' },
    { id: '2' },
    { id: '3', name: 'Jane' },
    { id: '4', name: 'Jane' },
  ];
  const groups = findDuplicateGroups(leads, nameKey);
  assert.equal(groups.length, 1);
});

test('enumeratePairs — 2 leads -> 1 pair, 3 leads -> 3 pairs', () => {
  const g2 = { leads: [{ id: 'a' }, { id: 'b' }] };
  const g3 = { leads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.equal(enumeratePairs(g2).length, 1);
  assert.equal(enumeratePairs(g3).length, 3);
});

test('shouldSkipPair — both reviewed -> skip; one only -> dont skip', () => {
  const reviewed = { dedupReviewedAt: '2026-05-20' };
  const fresh = {};
  assert.equal(shouldSkipPair(reviewed, reviewed), true);
  assert.equal(shouldSkipPair(reviewed, fresh), false);
  assert.equal(shouldSkipPair(fresh, fresh), false);
});

test('classifyPair — same close date -> duplicate', () => {
  const a = { closedDate: '2026-05-10', policyNumber: '52Z179403J' };
  const b = { closedDate: '2026-05-10', policyNumber: '72D666529S' };
  assert.equal(classifyPair(a, b), 'duplicate');
});

test('classifyPair — within 7 days -> duplicate', () => {
  const a = { closedDate: '2026-05-10' };
  const b = { closedDate: '2026-05-15' };
  assert.equal(classifyPair(a, b), 'duplicate');
});

test('classifyPair — policy-number base overlap -> duplicate even when 30d apart', () => {
  const a = { closedDate: '2026-05-10', policyNumber: '52Z179403J, 52Z179403L' };
  const b = { closedDate: '2026-04-10', policyNumber: '52Z179403S' };
  assert.equal(classifyPair(a, b), 'duplicate');
});

test('classifyPair — 60+ days apart, no overlap -> repeated', () => {
  const a = { closedDate: '2025-01-10', policyNumber: '52Z111111J' };
  const b = { closedDate: '2026-05-10', policyNumber: '52Z999999J' };
  assert.equal(classifyPair(a, b), 'repeated');
});

test('classifyPair — 30 days apart, no overlap -> ambiguous', () => {
  const a = { closedDate: '2026-04-10' };
  const b = { closedDate: '2026-05-10' };
  assert.equal(classifyPair(a, b), 'ambiguous');
});

test('classifyPair — missing dates with no policy overlap -> ambiguous', () => {
  const a = {};
  const b = {};
  assert.equal(classifyPair(a, b), 'ambiguous');
});

test('mergeLeads — winner id preserved, policy numbers combined and deduped', () => {
  const winner = { id: 'W', name: 'Eva G Salas', policyNumber: '52Z179403J, 52Z179403L', products: [{ id: 'PA' }] };
  const loser  = { id: 'L', name: 'Eva Salas',   policyNumber: '72D666529S, 52Z179403J', products: [{ id: 'MG' }] };
  const merged = mergeLeads(winner, loser);
  assert.equal(merged.id, 'W');
  const policies = merged.policyNumber.split(',').map(s => s.trim()).sort();
  assert.deepEqual(policies, ['52Z179403J', '52Z179403L', '72D666529S']);
  const prodIds = merged.products.map(p => p.id).sort();
  assert.deepEqual(prodIds, ['MG', 'PA']);
});

test('mergeLeads — winner empty fields filled from loser', () => {
  const winner = { id: 'W', name: 'Eva Salas', phone: '', email: 'eva@example.com' };
  const loser  = { id: 'L', name: 'Eva Salas', phone: '305-555-1234', email: '' };
  const merged = mergeLeads(winner, loser);
  assert.equal(merged.phone, '305-555-1234');     // filled from loser
  assert.equal(merged.email, 'eva@example.com');  // winner kept
});

test('mergeLeads — sets dedupReviewedAt', () => {
  const merged = mergeLeads({ id: 'W' }, { id: 'L' });
  assert.ok(merged.dedupReviewedAt);
  assert.match(merged.dedupReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});
