import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phoneKey,
  normalizeBenepathPayload,
  upsertBenepathLead,
  payloadFieldNames,
} from './benepath.mjs';

const NOW = '2026-06-18T12:00:00.000Z';

test('phoneKey strips formatting and US country code', () => {
  assert.equal(phoneKey('(941) 685-1718'), '9416851718');
  assert.equal(phoneKey('+1 941-685-1718'), '9416851718');
  assert.equal(phoneKey(''), '');
});

test('normalize: standard field names', () => {
  const n = normalizeBenepathPayload({
    lead_id: 'BP-123',
    first_name: 'Troy',
    last_name: 'Walker',
    phone: '9416851718',
    email: 'Troy@example.com',
    address: '123 Main St',
    city: 'Tampa',
    state: 'florida',
    zip_code: '33601',
    date_of_birth: '1985-03-01',
    household_income: '$45,000',
    coverage_type: 'Individual Health',
    currently_insured: 'No',
  });
  assert.equal(n.benepathLeadId, 'BP-123');
  assert.equal(n.name, 'Troy Walker');
  assert.equal(n.phoneKey, '9416851718');
  assert.equal(n.email, 'Troy@example.com');
  assert.equal(n.state, 'FL'); // uppercased + truncated to 2
  assert.equal(n.zip, '33601');
  assert.equal(n.income, '$45,000');
  assert.ok(n.situation.includes('Coverage: Individual Health'));
  assert.ok(n.situation.includes('Currently insured: No'));
});

test('normalize: alternate field names + full name field', () => {
  const n = normalizeBenepathPayload({
    UID: 'x9',
    name: 'Jane Q Public',
    'Cell Phone': '1-813-555-0100',
    'E-Mail': 'jane@x.com',
    postal_code: '33602',
    St: 'FL',
  });
  assert.equal(n.benepathLeadId, 'x9');
  assert.equal(n.name, 'Jane Q Public');
  assert.equal(n.phoneKey, '8135550100');
  assert.equal(n.email, 'jane@x.com');
  assert.equal(n.zip, '33602');
  assert.equal(n.state, 'FL');
});

test('normalize: household size > 1 → Family', () => {
  const n = normalizeBenepathPayload({ name: 'Fam Ily', phone: '5550001111', household_size: '4' });
  assert.equal(n.indvOrFamily, 'Family');
  const s = normalizeBenepathPayload({ name: 'Solo', phone: '5550002222', household_size: '1' });
  assert.equal(s.indvOrFamily, 'Indv');
});

test('normalize: age falls back to age field; bogus startDate dropped', () => {
  const n = normalizeBenepathPayload({ name: 'A B', phone: '5550003333', age: '52', coverage_start_date: 'ASAP' });
  assert.equal(n.age, 52);
  assert.equal(n.startDate, ''); // "ASAP" is not date-like
  const n2 = normalizeBenepathPayload({ name: 'C D', phone: '5550004444', coverage_start_date: '2026-08-01' });
  assert.equal(n2.startDate, '2026-08-01');
});

test('upsert: creates a fresh Web Lead prospect at default stage', () => {
  const n = normalizeBenepathPayload({ first_name: 'New', last_name: 'Lead', phone: '5551112222' });
  const { prospects, action } = upsertBenepathLead([], n, 'PENDING_DECISION', NOW);
  assert.equal(action, 'create');
  assert.equal(prospects.length, 1);
  const p = prospects[0];
  assert.equal(p.name, 'New Lead');
  assert.equal(p.source, 'Web Lead');
  assert.equal(p.leadVendor, 'Benepath');
  assert.equal(p.crm, 'None');
  assert.equal(p.stage, 'PENDING_DECISION');
  assert.equal(p.benepathLeadId, '');
  assert.equal(p.createdAt, NOW);
  assert.ok(Array.isArray(p.touchLog));
});

test('upsert: dedup by phone fills gaps but never changes agent stage', () => {
  const existing = [{
    id: 'p1', name: 'New Lead', phone: '(555) 111-2222', email: '', state: '', zip: '',
    stage: 'APPOINTMENT_SET', source: 'Web Lead', leadVendor: 'Benepath', situation: 'agent note',
  }];
  const n = normalizeBenepathPayload({ name: 'New Lead', phone: '5551112222', email: 'new@x.com', state: 'FL', zip: '33601' });
  const { prospects, action } = upsertBenepathLead(existing, n, 'PENDING_DECISION', NOW);
  assert.equal(action, 'update');
  assert.equal(prospects.length, 1);
  assert.equal(prospects[0].stage, 'APPOINTMENT_SET'); // preserved, NOT reset
  assert.equal(prospects[0].email, 'new@x.com');       // filled
  assert.equal(prospects[0].state, 'FL');
  assert.equal(prospects[0].situation, 'agent note');  // existing preserved
});

test('upsert: dedup by email and by benepathLeadId', () => {
  const byEmail = upsertBenepathLead(
    [{ id: 'p1', name: 'E', phone: '', email: 'dup@x.com', stage: 'GHOSTED' }],
    normalizeBenepathPayload({ name: 'E', email: 'DUP@x.com', phone: '5559998888' }),
    'PENDING_DECISION', NOW,
  );
  assert.equal(byEmail.action, 'update');

  const byId = upsertBenepathLead(
    [{ id: 'p1', name: 'I', phone: '', benepathLeadId: 'BP-7', stage: 'LOST' }],
    normalizeBenepathPayload({ lead_id: 'BP-7', name: 'I', phone: '5554443333' }),
    'PENDING_DECISION', NOW,
  );
  assert.equal(byId.action, 'update');
});

test('normalize: captures Benepath health fields into situation + income', () => {
  const n = normalizeBenepathPayload({
    first_name: 'Health', last_name: 'Lead', phone: '5550009999',
    date_of_birth: '1980-05-15',
    age: '45',
    gender: 'Female',
    marital_status: 'Married',
    household_income: '$60,000',
    number_of_dependents: '2',
    tobacco: 'No',
    occupation: 'Teacher',
    qualifying_life_event: 'Lost coverage',
    expectant: 'Yes',
    currently_insured: 'true',
  });
  assert.equal(n.income, '$60,000');          // household_income -> income
  assert.equal(n.indvOrFamily, 'Family');     // dependents 2 > 1
  assert.match(n.situation, /Marital: Married/);
  assert.match(n.situation, /Occupation: Teacher/);
  assert.match(n.situation, /Qualifying life event: Lost coverage/);
  assert.match(n.situation, /Expectant: Yes/);
  assert.match(n.situation, /Tobacco: No/);
  assert.match(n.situation, /Currently insured: true/);
});

test('normalize: flattens nested payload (contact/address sub-objects)', () => {
  const n = normalizeBenepathPayload({
    lead: { lead_id: 'BP-9' },
    contact: { first_name: 'Nest', last_name: 'Ed', phone: '5557778888', email: 'nest@x.com' },
    address: { city: 'Miami', state: 'FL', zip: '33101' },
  });
  assert.equal(n.benepathLeadId, 'BP-9');
  assert.equal(n.name, 'Nest Ed');
  assert.equal(n.phoneKey, '5557778888');
  assert.equal(n.email, 'nest@x.com');
  assert.equal(n.state, 'FL');
  assert.equal(n.zip, '33101');
});

test('payloadFieldNames: flat and nested leaf names', () => {
  assert.deepEqual(
    payloadFieldNames({ first_name: 'A', phone: '5551112222' }),
    ['first_name', 'phone'],
  );
  assert.deepEqual(
    payloadFieldNames({ contact: { first_name: 'A', phone: '5551112222' }, lead_id: 'X' }),
    ['first_name', 'phone', 'lead_id'],
  );
  assert.deepEqual(payloadFieldNames(null), []);
});

test('upsert: handles form-style string values without throwing', () => {
  // Simulates an application/x-www-form-urlencoded body already parsed to {k:v}
  const n = normalizeBenepathPayload({
    firstname: 'Form', lastname: 'Encoded', phone: '5551234567', zip: '90210', state: 'ca',
  });
  const { prospects, action } = upsertBenepathLead([], n, 'PENDING_DECISION', NOW);
  assert.equal(action, 'create');
  assert.equal(prospects[0].name, 'Form Encoded');
  assert.equal(prospects[0].state, 'CA');
  assert.equal(prospects[0].zip, '90210');
});
