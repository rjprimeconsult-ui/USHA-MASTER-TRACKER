// Tests for the lead-dedup gate that the SalesReport gap-import path was
// MISSING — the root cause of the 2026-06-01 duplicate explosion (an agent
// re-ran the gap upload / overlapped it with the Excel historical, and leads
// stacked with no duplicate guard). These lock in that re-importing the same
// people adds nothing, and that a single batch listing someone twice yields
// one lead.
//
// Run: node --test src/lib/leadDedup.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupLeads } from './leadDedup.js';

// Helper — minimal lead shape the matcher cares about.
const lead = (name, phone, extra = {}) => ({
  id: `${name}-${phone}`.replace(/\s+/g, ''),
  name, phone, ...extra,
});

test('re-importing the SAME leads adds zero fresh (the explosion guard)', () => {
  const book = [
    lead('Eva G Salas', '305-555-0101'),
    lead('Blanca Garcia', '786-555-0102'),
    lead('John Smith', '407-555-0103'),
  ];
  // Second gap upload of the exact same people.
  const incoming = [
    lead('Eva G Salas', '305-555-0101'),
    lead('Blanca Garcia', '786-555-0102'),
    lead('John Smith', '407-555-0103'),
  ];
  const { fresh, duplicates } = dedupLeads(incoming, book, { merge: false });
  assert.equal(fresh.length, 0, 'no new leads should be added on a re-import');
  assert.equal(duplicates.length, 3, 'all three should be flagged as duplicates');
});

test('matches by policy number even if name/phone differ slightly', () => {
  const book = [lead('Eva G. Salas', '305-555-0101', { policyNumber: '52Y2502220' })];
  // Same policy, name spelled without the middle initial, no phone.
  const incoming = [lead('Eva Salas', '', { policyNumber: '52Y2502220' })];
  const { fresh } = dedupLeads(incoming, book, { merge: false });
  assert.equal(fresh.length, 0, 'same policyId = same lead, not a new one');
});

test('dedupes WITHIN a single batch (same customer listed twice)', () => {
  const book = [];
  const incoming = [
    lead('Carla Mendez', '786-555-0104'),
    lead('Carla Mendez', '786-555-0104'), // duplicate row in the same file
  ];
  const { fresh } = dedupLeads(incoming, book, { merge: false });
  assert.equal(fresh.length, 1, 'a customer listed twice in one batch = one lead');
});

test('genuinely new people DO come through', () => {
  const book = [lead('Eva G Salas', '305-555-0101')];
  const incoming = [
    lead('Eva G Salas', '305-555-0101'),   // dup — skip
    lead('Brand New Person', '212-555-9999'), // fresh — keep
  ];
  const { fresh, duplicates } = dedupLeads(incoming, book, { merge: false });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].name, 'Brand New Person');
  assert.equal(duplicates.length, 1);
});

test('two different policies for the same customer stay as separate leads', () => {
  const book = [lead('Eva G Salas', '305-555-0101', { policyNumber: '52Y2502220' })];
  // Same person + phone, but a DIFFERENT policy — a real second policy,
  // not a duplicate.
  const incoming = [lead('Eva G Salas', '305-555-0101', { policyNumber: '52Y9999999' })];
  const { fresh } = dedupLeads(incoming, book, { merge: false });
  assert.equal(fresh.length, 1, 'a distinct policy for the same person is a separate lead');
});
