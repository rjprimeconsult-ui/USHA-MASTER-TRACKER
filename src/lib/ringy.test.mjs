/**
 * ringy.test.mjs — Unit tests for ringy.mjs (node:test)
 *
 * Run with:   node --test src/lib/ringy.test.mjs
 * Or via:     npm test  (which runs node --test src/lib/*.test.mjs)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneKey,
  ageFromDob,
  normalizeRingyPayload,
  mapDispositionToStage,
  upsertRingyLead,
  checkIsBlastDisposition,
  DEFAULT_BLAST_PATTERNS,
} from './ringy.mjs';

// ============================================================
// phoneKey
// ============================================================
test('ringy phoneKey: 11-digit with leading 1 → 10-digit', () => {
  assert.equal(phoneKey('19416851718'), '9416851718');
});

test('ringy phoneKey: +1 prefix stripped', () => {
  assert.equal(phoneKey('+19416851718'), '9416851718');
});

test('ringy phoneKey: formatted (xxx) xxx-xxxx', () => {
  assert.equal(phoneKey('(941) 685-1718'), '9416851718');
});

test('ringy phoneKey: already 10 digits', () => {
  assert.equal(phoneKey('9416851718'), '9416851718');
});

test('ringy phoneKey: 10-digit starting with 1 stays untouched', () => {
  assert.equal(phoneKey('1415555267'), '1415555267');
});

test('ringy phoneKey: null/empty returns empty string', () => {
  assert.equal(phoneKey(null), '');
  assert.equal(phoneKey(''), '');
  assert.equal(phoneKey(undefined), '');
});

// ============================================================
// ageFromDob
// ============================================================
test('ringy ageFromDob: birthday already passed this year', () => {
  // nowIso = 2026-06-09; birthday 1985-03-15 → age 41
  assert.equal(ageFromDob('1985-03-15', '2026-06-09'), 41);
});

test('ringy ageFromDob: birthday NOT yet this year → subtract 1', () => {
  // nowIso = 2026-06-09; birthday 1985-12-25 → age 40
  assert.equal(ageFromDob('1985-12-25', '2026-06-09'), 40);
});

test('ringy ageFromDob: exact birthday today → counts as reached', () => {
  // nowIso = 2026-06-09; birthday 1990-06-09 → age 36
  assert.equal(ageFromDob('1990-06-09', '2026-06-09'), 36);
});

test('ringy ageFromDob: null/empty → null', () => {
  assert.equal(ageFromDob(null), null);
  assert.equal(ageFromDob(''), null);
  assert.equal(ageFromDob(undefined), null);
});

test('ringy ageFromDob: invalid string → null', () => {
  assert.equal(ageFromDob('not-a-date', '2026-06-09'), null);
});

test('ringy ageFromDob: future year → null', () => {
  assert.equal(ageFromDob('2200-01-01', '2026-06-09'), null);
});

// ============================================================
// normalizeRingyPayload — full payload
// ============================================================
test('ringy normalizeRingyPayload: full payload mapped correctly', () => {
  const body = {
    leadId: '12345',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '19415551234',
    email: 'jane@example.com',
    address: '123 Main St',
    city: 'Miami',
    state: 'fl',
    zip: '33179',
    birthday: '1985-03-15',
    notes: 'Interested in PA',
    status: 'Active',
    source: 'Webby',
    disposition: 'Appointment Set',
  };
  const n = normalizeRingyPayload(body);
  assert.equal(n.ringyLeadId, '12345');
  assert.equal(n.name, 'Jane Doe');
  assert.equal(n.phone, '19415551234');
  assert.equal(n.phoneKey, '9415551234');
  assert.equal(n.email, 'jane@example.com');
  assert.equal(n.address, '123 Main St');
  assert.equal(n.city, 'Miami');
  assert.equal(n.state, 'FL');
  assert.equal(n.zip, '33179');
  assert.equal(n.birthday, '1985-03-15');
  assert.equal(typeof n.age, 'number');
  assert.equal(n.notes, 'Interested in PA');
  assert.equal(n.status, 'Active');
  assert.equal(n.source, 'Webby');
  assert.equal(n.disposition, 'Appointment Set');
});

test('ringy normalizeRingyPayload: uses body.name when present', () => {
  const body = { name: 'Full Name', firstName: 'First', lastName: 'Last', phone: '9415551234' };
  const n = normalizeRingyPayload(body);
  assert.equal(n.name, 'Full Name');
});

test('ringy normalizeRingyPayload: builds name from firstName + lastName when name absent', () => {
  const body = { firstName: 'John', lastName: 'Smith', phone: '9415551234' };
  const n = normalizeRingyPayload(body);
  assert.equal(n.name, 'John Smith');
});

test('ringy normalizeRingyPayload: sparse payload — missing keys default to empty string', () => {
  const n = normalizeRingyPayload({ leadId: '99' });
  assert.equal(n.ringyLeadId, '99');
  assert.equal(n.name, '');
  assert.equal(n.phone, '');
  assert.equal(n.phoneKey, '');
  assert.equal(n.email, '');
  assert.equal(n.state, '');
  assert.equal(n.zip, '');
  assert.equal(n.age, null);
  assert.equal(n.notes, '');
  assert.equal(n.disposition, '');
});

test('ringy normalizeRingyPayload: null body → all defaults', () => {
  const n = normalizeRingyPayload(null);
  assert.equal(n.ringyLeadId, '');
  assert.equal(n.name, '');
  assert.equal(n.phone, '');
  assert.equal(n.age, null);
});

test('ringy normalizeRingyPayload: state uppercased and sliced to 2 chars', () => {
  const n = normalizeRingyPayload({ state: 'florida' });
  assert.equal(n.state, 'FL');
});

// ============================================================
// mapDispositionToStage
// ============================================================
const MAPPING = [
  { disposition: 'Appointment Set', stage: 'APPOINTMENT_SET' },
  { disposition: 'Follow Up',       stage: 'FOLLOWUP_LATER' },
  { disposition: 'Not Interested',  stage: 'LOST' },
];

test('mapDispositionToStage: exact match', () => {
  assert.equal(mapDispositionToStage('Appointment Set', MAPPING, 'PENDING_DECISION'), 'APPOINTMENT_SET');
});

test('mapDispositionToStage: case-insensitive match', () => {
  assert.equal(mapDispositionToStage('appointment set', MAPPING, 'PENDING_DECISION'), 'APPOINTMENT_SET');
  assert.equal(mapDispositionToStage('FOLLOW UP', MAPPING, 'PENDING_DECISION'), 'FOLLOWUP_LATER');
});

test('mapDispositionToStage: trim whitespace on both sides', () => {
  assert.equal(mapDispositionToStage('  Follow Up  ', MAPPING, 'PENDING_DECISION'), 'FOLLOWUP_LATER');
});

test('mapDispositionToStage: no match → defaultStage', () => {
  assert.equal(mapDispositionToStage('Unknown Disposition', MAPPING, 'PENDING_DECISION'), 'PENDING_DECISION');
});

test('mapDispositionToStage: empty disposition → defaultStage', () => {
  assert.equal(mapDispositionToStage('', MAPPING, 'PENDING_DECISION'), 'PENDING_DECISION');
  assert.equal(mapDispositionToStage(null, MAPPING, 'PENDING_DECISION'), 'PENDING_DECISION');
});

test('mapDispositionToStage: empty mapping → defaultStage', () => {
  assert.equal(mapDispositionToStage('Appointment Set', [], 'PENDING_DECISION'), 'PENDING_DECISION');
});

test('mapDispositionToStage: null mapping → defaultStage', () => {
  assert.equal(mapDispositionToStage('Appointment Set', null, 'PENDING_DECISION'), 'PENDING_DECISION');
});

// ============================================================
// checkIsBlastDisposition — native blast/repurpose detection
// ============================================================
test('checkIsBlastDisposition: matches the real "REPUROSED - AGED - POST O/E DRIP" tag with no config', () => {
  assert.equal(checkIsBlastDisposition('REPUROSED - AGED - POST O/E DRIP'), true);
});

test('checkIsBlastDisposition: matches correctly-spelled REPURPOSED', () => {
  assert.equal(checkIsBlastDisposition('Repurposed - Aged'), true);
});

test('checkIsBlastDisposition: matches the "POST O/E DRIP" fragment alone', () => {
  assert.equal(checkIsBlastDisposition('post oe drip'), true);
  assert.equal(checkIsBlastDisposition('POST O/E DRIP'), true);
});

test('checkIsBlastDisposition: normal dispositions do NOT match (no false positives)', () => {
  assert.equal(checkIsBlastDisposition('Appointment Set'), false);
  assert.equal(checkIsBlastDisposition('Not Interested'), false);
  assert.equal(checkIsBlastDisposition('Follow Up'), false);
  assert.equal(checkIsBlastDisposition('Expressed Interest'), false);
  assert.equal(checkIsBlastDisposition('Post-Appointment Follow Up'), false);
});

test('checkIsBlastDisposition: empty / null → false', () => {
  assert.equal(checkIsBlastDisposition(''), false);
  assert.equal(checkIsBlastDisposition(null), false);
  assert.equal(checkIsBlastDisposition(undefined), false);
});

test('checkIsBlastDisposition: honors an agent custom pattern', () => {
  assert.equal(checkIsBlastDisposition('MY BLAST CAMPAIGN', ['blast']), true);
  // custom pattern absent → falls back to defaults only
  assert.equal(checkIsBlastDisposition('MY BLAST CAMPAIGN', []), false);
});

test('checkIsBlastDisposition: invalid-regex custom pattern degrades to substring match', () => {
  assert.equal(checkIsBlastDisposition('weekly (special) run', ['(special']), true);
});

test('DEFAULT_BLAST_PATTERNS is a non-empty array', () => {
  assert.ok(Array.isArray(DEFAULT_BLAST_PATTERNS) && DEFAULT_BLAST_PATTERNS.length > 0);
});

// ============================================================
// upsertRingyLead — create
// ============================================================
const NOW = '2026-06-09T12:00:00.000Z';

function mkNorm(overrides = {}) {
  return {
    ringyLeadId:  '555',
    name:         'Jane Doe',
    phone:        '9415551234',
    phoneKey:     '9415551234',
    email:        'jane@example.com',
    address:      '123 Main St',
    city:         'Miami',
    state:        'FL',
    zip:          '33179',
    birthday:     '1985-03-15',
    age:          41,
    notes:        'Interested in PA',
    status:       'Active',
    source:       'Webby',
    disposition:  'Appointment Set',
    ...overrides,
  };
}

test('upsertRingyLead: create — empty prospects list', () => {
  const norm = mkNorm();
  const { prospects, action } = upsertRingyLead([], norm, MAPPING, 'PENDING_DECISION', NOW);
  assert.equal(action, 'create');
  assert.equal(prospects.length, 1);
  const p = prospects[0];
  assert.equal(p.name, 'Jane Doe');
  assert.equal(p.phone, '9415551234');
  assert.equal(p.email, 'jane@example.com');
  assert.equal(p.state, 'FL');
  assert.equal(p.zip, '33179');
  assert.equal(p.age, '41');
  assert.equal(p.situation, 'Interested in PA');
  assert.equal(p.stage, 'APPOINTMENT_SET');
  assert.equal(p.source, 'Ringy');
  assert.equal(p.ringyLeadId, '555');
  assert.equal(p.createdAt, NOW);
  assert.ok(typeof p.id === 'string' && p.id.length > 0, 'has id');
  assert.deepEqual(p.touchLog, []);
  assert.deepEqual(p.cadence, { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null });
  assert.equal(p.stageEnteredAt, NOW);
});

test('upsertRingyLead: create — has all required newProspect fields', () => {
  const { prospects } = upsertRingyLead([], mkNorm(), MAPPING, 'PENDING_DECISION', NOW);
  const p = prospects[0];
  const requiredFields = ['id', 'name', 'phone', 'email', 'state', 'zip', 'timezone',
    'indvOrFamily', 'dobs', 'income', 'quoteSize', 'policyType', 'meds', 'situation',
    'startDate', 'source', 'referrer', 'leadVendor', 'crm', 'stage', 'appointmentTime',
    'nextSteps', 'lastContact', 'custom', 'createdAt', 'archivedAt', 'convertedLeadId',
    'touchLog', 'stageEnteredAt', 'cadence', 'age', 'ringyLeadId'];
  for (const f of requiredFields) {
    assert.ok(f in p, `missing field: ${f}`);
  }
});

test('upsertRingyLead: create — does not mutate original array', () => {
  const original = [];
  const { prospects } = upsertRingyLead(original, mkNorm(), MAPPING, 'PENDING_DECISION', NOW);
  assert.equal(original.length, 0);
  assert.equal(prospects.length, 1);
});

// ============================================================
// upsertRingyLead — update (fill-empty)
// ============================================================
test('upsertRingyLead: update — match by phoneKey, fill empty fields', () => {
  const existing = [{
    id: 'p1',
    name: 'Jane Doe',
    phone: '9415551234',
    email:     '',
    state:     '',
    zip:       '',
    age:       '',
    situation: '',
    address:   '',
    stage:     'PENDING_DECISION',
    source:    'Ringy',
    ringyLeadId: '555',
    touchLog: [],
    cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
  }];
  const norm = mkNorm();
  const { prospects, action } = upsertRingyLead(existing, norm, MAPPING, 'PENDING_DECISION', NOW);
  assert.equal(action, 'update');
  assert.equal(prospects.length, 1);
  const p = prospects[0];
  assert.equal(p.id, 'p1');
  assert.equal(p.email, 'jane@example.com');
  assert.equal(p.state, 'FL');
  assert.equal(p.zip, '33179');
  assert.equal(p.age, '41');
  assert.equal(p.situation, 'Interested in PA');
  assert.equal(p.address, '123 Main St');
});

test('upsertRingyLead: update — never overwrites non-empty email/state/zip', () => {
  const existing = [{
    id: 'p2',
    name: 'John Smith',
    phone: '9415551234',
    email:     'john@existing.com',
    state:     'TX',
    zip:       '78701',
    age:       '50',
    situation: 'Has diabetes',
    address:   '456 Elm St',
    stage:     'PENDING_DECISION',
    source:    'Ringy',
    ringyLeadId: '555',
    touchLog: [],
    cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
  }];
  const norm = mkNorm();
  const { prospects } = upsertRingyLead(existing, norm, MAPPING, 'PENDING_DECISION', NOW);
  const p = prospects[0];
  assert.equal(p.email, 'john@existing.com');
  assert.equal(p.state, 'TX');
  assert.equal(p.zip, '78701');
  assert.equal(p.age, '50');
  assert.equal(p.situation, 'Has diabetes');
  assert.equal(p.address, '456 Elm St');
});

test('upsertRingyLead: update — always sets stage from disposition (authoritative)', () => {
  const existing = [{
    id: 'p3',
    name: 'Jane',
    phone: '9415551234',
    email: 'jane@existing.com',
    state: 'FL',
    zip: '33179',
    age: '41',
    situation: 'Some notes',
    address: '',
    stage:  'PENDING_DECISION',   // ← old stage
    source: 'Ringy',
    ringyLeadId: '555',
    touchLog: [],
    cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
  }];
  // disposition → 'Appointment Set' → 'APPOINTMENT_SET'
  const norm = mkNorm({ disposition: 'Appointment Set' });
  const { prospects } = upsertRingyLead(existing, norm, MAPPING, 'PENDING_DECISION', NOW);
  assert.equal(prospects[0].stage, 'APPOINTMENT_SET');
});

test('upsertRingyLead: update — does not mutate original prospect', () => {
  const orig = {
    id: 'p4', name: 'Jane', phone: '9415551234', email: '', state: '', zip: '',
    age: '', situation: '', address: '', stage: 'PENDING_DECISION',
    source: 'Ringy', ringyLeadId: '555', touchLog: [], cadence: {},
  };
  const original = [orig];
  const { prospects } = upsertRingyLead(original, mkNorm(), MAPPING, 'PENDING_DECISION', NOW);
  assert.notEqual(prospects[0], orig, 'should be a new object');
  assert.equal(orig.email, '', 'original not mutated');
});

// ============================================================
// upsertRingyLead — dedup by ringyLeadId (phone differs)
// ============================================================
test('upsertRingyLead: dedup by ringyLeadId when phone differs', () => {
  const existing = [{
    id: 'p5',
    name: 'Jane Old Phone',
    phone: '8005559999',      // ← different phone
    email: '',
    state: '',
    zip: '',
    age: '',
    situation: '',
    address: '',
    stage: 'GHOSTED',
    source: 'Ringy',
    ringyLeadId: '555',       // ← same ringyLeadId
    touchLog: [],
    cadence: {},
  }];
  const norm = mkNorm({ phone: '9415551234', phoneKey: '9415551234', ringyLeadId: '555' });
  const { prospects, action } = upsertRingyLead(existing, norm, MAPPING, 'PENDING_DECISION', NOW);
  assert.equal(action, 'update');
  assert.equal(prospects.length, 1);
  assert.equal(prospects[0].id, 'p5');
  // Stage set to mapped disposition
  assert.equal(prospects[0].stage, 'APPOINTMENT_SET');
});

// ============================================================
// upsertRingyLead — stamps ringyLeadId and source if missing
// ============================================================
test('upsertRingyLead: stamps source Ringy on update when missing', () => {
  const existing = [{
    id: 'p6',
    name: 'Sam',
    phone: '9415551234',
    email: 'sam@test.com',
    state: 'CA',
    zip: '90210',
    age: '35',
    situation: 'Something',
    address: '',
    stage: 'WEBBY_SET',
    source: '',            // missing
    ringyLeadId: '',       // missing
    touchLog: [],
    cadence: {},
  }];
  const norm = mkNorm({ ringyLeadId: '999' });
  const { prospects } = upsertRingyLead(existing, norm, MAPPING, 'PENDING_DECISION', NOW);
  assert.equal(prospects[0].source, 'Ringy');
  assert.equal(prospects[0].ringyLeadId, '999');
});
