import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenRecord, normalizeBody, extractWebformFields, buildRawBlock,
  buildWebformProspect, upsertWebformProspect, buildWebformAiPrompt,
  normalizeState, normalizeIncomeBand, normalizeIndvFamily, normalizeHealthConcern,
} from './webforms.mjs';

const NOW = '2026-07-04T18:00:00.000Z';

test('flattenRecord flattens one level and stringifies scalars', () => {
  assert.deepEqual(
    flattenRecord({ name: 'Jo', form: { phone: 3055551234, ok: true }, tags: ['a', 'b'] }),
    { name: 'Jo', 'form.phone': '3055551234', 'form.ok': 'true', tags: 'a, b' }
  );
});
test('flattenRecord tolerates null/undefined and skips empty values', () => {
  assert.deepEqual(flattenRecord({ a: '', b: null, c: undefined, d: 'x' }), { d: 'x' });
  assert.deepEqual(flattenRecord(null), {});
});
test('normalizeBody parses JSON and urlencoded; null on garbage', () => {
  assert.deepEqual(normalizeBody('application/json', '{"a":"1"}'), { a: '1' });
  assert.deepEqual(normalizeBody('application/x-www-form-urlencoded; charset=UTF-8', 'your-name=Ana+Diaz&email%5B%5D=ana%40x.com'), { 'your-name': 'Ana Diaz', 'email[]': 'ana@x.com' });
  assert.equal(normalizeBody('application/json', 'not json'), null);
});
test('maps the MANUS-style payload with high confidence, no AI needed', () => {
  const r = extractWebformFields({
    first_name: 'John', last_name: 'Smith', email: 'john@example.com',
    phone: '+13055551234', source: 'website', submitted_at: '2026-07-07T14:30:00Z',
  });
  assert.equal(r.fields.name, 'John Smith');
  assert.equal(r.fields.email, 'john@example.com');
  assert.equal(r.fields.phone, '+13055551234');
  assert.equal(r.confident, true);
  assert.equal(r.fields.source, undefined);
});
test('maps bracketed/hyphenated keys (your-name, email[], phone_number)', () => {
  const r = extractWebformFields({ 'your-name': 'Ana Diaz', 'email[]': 'ana@x.com', phone_number: '9545550000' });
  assert.equal(r.fields.name, 'Ana Diaz');
  assert.equal(r.fields.email, 'ana@x.com');
  assert.equal(r.fields.phone, '9545550000');
  assert.equal(r.confident, true);
});
test('message/comments land in situation; unknown keys left for the raw block', () => {
  const r = extractWebformFields({ name: 'Bo', email: 'b@x.com', message: 'Need family coverage', favorite_color: 'red' });
  assert.match(r.fields.situation, /Need family coverage/);
  assert.equal(r.fields.favorite_color, undefined);
});
test('name but NO phone/email -> not confident', () => {
  const r = extractWebformFields({ full_name: 'Solo Name', comments: 'hi' });
  assert.equal(r.confident, false);
});
test('phone but no name -> not confident (still extracted)', () => {
  const r = extractWebformFields({ phone: '3051112222' });
  assert.equal(r.fields.phone, '3051112222');
  assert.equal(r.confident, false);
});
test('buildRawBlock renders Label: value lines and truncates at the cap', () => {
  const block = buildRawBlock({ name: 'Jo', 'form.phone': '305' });
  assert.match(block, /Website form submission/);
  assert.match(block, /name: Jo/);
  const big = buildRawBlock({ k: 'x'.repeat(20000) });
  assert.ok(big.length <= 4200);
});
test('builds a Web Lead prospect; raw block appended to situation; flag only when unsure', () => {
  const flat = { name: 'Jo Lee', email: 'jo@x.com' };
  const conf = buildWebformProspect(extractWebformFields(flat), flat, NOW);
  assert.equal(conf.source, 'Web Lead');
  assert.equal(conf.stage, 'PENDING_DECISION');
  assert.equal(conf.crm, 'None');
  assert.match(conf.situation, /Website form submission/);
  assert.ok(!conf.needsReview);
  const flat2 = { phone: '3051112222' };
  const unsure = buildWebformProspect(extractWebformFields(flat2), flat2, NOW);
  assert.equal(unsure.needsReview, true);
  assert.equal(unsure.name, 'Web Lead — needs review');
});
test('no match -> appended as new', () => {
  const { list, created } = upsertWebformProspect([], buildWebformProspect(extractWebformFields({ name: 'A', phone: '111' }), { name: 'A', phone: '111' }, NOW), NOW);
  assert.equal(list.length, 1);
  assert.equal(created, true);
});
test('E.164 +1 phone dedups against the stored 10-digit number', () => {
  const existing = [{ id: 'p1', name: 'Jo', phone: '3055551234', archivedAt: null, touchLog: [] }];
  const flat = { name: 'John Smith', phone: '+13055551234', email: 'j@x.com' };
  const { created } = upsertWebformProspect(existing, buildWebformProspect(extractWebformFields(flat), flat, NOW), NOW);
  assert.equal(created, false);
});
test('phone match -> no duplicate; fill-empty; re-submission touch appended with real schema', () => {
  const existing = [{ id: 'p1', name: 'Ana D', phone: '3055550000', email: '', situation: 'old notes', archivedAt: null, touchLog: [] }];
  const incoming = buildWebformProspect(
    extractWebformFields({ name: 'Ana Diaz', phone: '(305) 555-0000', email: 'ana@x.com' }),
    { name: 'Ana Diaz', phone: '(305) 555-0000', email: 'ana@x.com' }, NOW
  );
  const { list, created } = upsertWebformProspect(existing, incoming, NOW);
  assert.equal(created, false);
  assert.equal(list.length, 1);
  const p = list[0];
  assert.equal(p.name, 'Ana D');
  assert.equal(p.email, 'ana@x.com');
  const tch = p.touchLog[p.touchLog.length - 1];
  assert.equal(tch.channel, 'Other');
  assert.equal(tch.outcome, 'Other');
  assert.match(tch.note, /Submitted your website form again/);
  assert.equal(tch.at, NOW);
  assert.ok(tch.id);
});
test('re-submission carries the fresh message into the touch note (not dropped by fill-empty)', () => {
  const existing = [{ id: 'p1', name: 'Ana D', phone: '3055550000', situation: 'old inquiry', archivedAt: null, touchLog: [] }];
  const flat = { name: 'Ana Diaz', phone: '3055550000', message: 'Call me ASAP — need family coverage now' };
  const incoming = buildWebformProspect(extractWebformFields(flat), flat, NOW);
  const { list } = upsertWebformProspect(existing, incoming, NOW, 'Call me ASAP — need family coverage now');
  const tch = list[0].touchLog[list[0].touchLog.length - 1];
  assert.match(tch.note, /Call me ASAP/);          // the fresh message survives
  assert.equal(list[0].situation, 'old inquiry');  // existing situation still wins (fill-empty)
});
test('re-submission with no new message keeps the generic note', () => {
  const existing = [{ id: 'p1', name: 'Ana D', phone: '3055550000', situation: 'old', archivedAt: null, touchLog: [] }];
  const flat = { name: 'Ana Diaz', phone: '3055550000' };
  const incoming = buildWebformProspect(extractWebformFields(flat), flat, NOW);
  const { list } = upsertWebformProspect(existing, incoming, NOW, '');
  assert.equal(list[0].touchLog[0].note, 'Submitted your website form again');
});
test('archived prospects are NOT dedup matches', () => {
  const existing = [{ id: 'p1', name: 'A', phone: '111', archivedAt: '2026-01-01', touchLog: [] }];
  const { created } = upsertWebformProspect(existing, buildWebformProspect(extractWebformFields({ name: 'A', phone: '111' }), { name: 'A', phone: '111' }, NOW), NOW);
  assert.equal(created, true);
});
test('buildWebformAiPrompt embeds the payload and demands the fixed JSON shape', () => {
  const p = buildWebformAiPrompt({ weird_field: 'John | j@x.com | 305-111-2222' });
  assert.match(p, /weird_field/);
  assert.match(p, /"name"/);
  assert.match(p, /single lead/i);
});

// ===================== Field mapping & normalization (2026-07-04) =====================

// ---- normalizeState: form value -> the 2-letter code the State dropdown needs ----
test('normalizeState converts full names and codes to the 2-letter dropdown code', () => {
  assert.equal(normalizeState('Florida'), 'FL');
  assert.equal(normalizeState('florida'), 'FL');
  assert.equal(normalizeState('  FLORIDA '), 'FL');
  assert.equal(normalizeState('FL'), 'FL');
  assert.equal(normalizeState('fl'), 'FL');
  assert.equal(normalizeState('New York'), 'NY');
  assert.equal(normalizeState('Texas'), 'TX');
});
test('normalizeState returns empty for unrecognized input (never garbage in the dropdown)', () => {
  assert.equal(normalizeState('Nowhere'), '');
  assert.equal(normalizeState(''), '');
  assert.equal(normalizeState('ZZ'), '');
});

// ---- normalizeIncomeBand: range band -> midpoint number for the income box ----
test('normalizeIncomeBand returns the band midpoint as a grouped number', () => {
  assert.equal(normalizeIncomeBand('$35,000–$59,999').income, '47,500');
  assert.equal(normalizeIncomeBand('$15,000-$34,999').income, '25,000');
  assert.equal(normalizeIncomeBand('$60,000 – $99,999').income, '80,000');
});
test('normalizeIncomeBand handles "Below $X", "$X+", and a plain number', () => {
  assert.equal(normalizeIncomeBand('Below $15,000').income, '7,500');   // midpoint of 0..15000
  assert.equal(normalizeIncomeBand('$100,000+').income, '100,000');     // open-ended -> the bound
  assert.equal(normalizeIncomeBand('50000').income, '50,000');          // already a number
  assert.equal(normalizeIncomeBand('').income, '');
  assert.equal(normalizeIncomeBand('n/a').income, '');
});

// ---- normalizeIndvFamily: coverage answer -> Indv | Family ----
test('normalizeIndvFamily maps coverage answers to the Indv/Family dropdown', () => {
  assert.equal(normalizeIndvFamily('Individual'), 'Indv');
  assert.equal(normalizeIndvFamily('Family'), 'Family');
  assert.equal(normalizeIndvFamily('Family of 4'), 'Family');
  assert.equal(normalizeIndvFamily('Self-Employed'), 'Indv');
  assert.equal(normalizeIndvFamily('Business Owner'), 'Indv');
  assert.equal(normalizeIndvFamily('Just me'), 'Indv');
  assert.equal(normalizeIndvFamily('nonsense'), '');   // unrecognized -> caller keeps default
});

// ---- normalizeHealthConcern: yes/no/unsure -> PRIM's approved general impression ----
test('normalizeHealthConcern converts a yes/no flag to a general impression (PHI-safe)', () => {
  assert.equal(normalizeHealthConcern('Yes'), 'Has health concerns');
  assert.equal(normalizeHealthConcern('yes'), 'Has health concerns');
  assert.equal(normalizeHealthConcern('Not Sure'), 'May have health concerns (unsure)');
  assert.equal(normalizeHealthConcern('Unsure'), 'May have health concerns (unsure)');
  assert.equal(normalizeHealthConcern('No'), '');   // nothing to flag
  assert.equal(normalizeHealthConcern(''), '');
});

// ---- extractWebformFields captures the new fields (raw) ----
test('extractWebformFields captures dob, income, coverage, health, city (label or clean keys)', () => {
  const r = extractWebformFields({
    'First Name': 'John', 'Last Name': 'Smith', 'Email Address': 'j@x.com', 'Phone Number': '3055551234',
    'Date of Birth': '1985-03-02', 'Approximate yearly household income?': '$35,000–$59,999',
    'Who will you need to insure?': 'Family', 'Pre-existing conditions?': 'Yes',
    'City': 'MIRAMAR', 'ZIP Code': '33027', 'State': 'Florida',
  });
  assert.equal(r.fields.name, 'John Smith');
  assert.equal(r.fields.dob, '1985-03-02');
  assert.equal(r.fields.income, '$35,000–$59,999');
  assert.equal(r.fields.indvfam, 'Family');
  assert.equal(r.fields.health, 'Yes');
  assert.equal(r.confident, true);
});

// ---- buildWebformProspect populates the structured fields (the whole form, end-to-end) ----
test('buildWebformProspect fills state(FL)/income(midpoint)/dob/indvOrFamily/health-notes', () => {
  const flat = {
    first_name: 'John', last_name: 'Smith', email: 'j@x.com', phone: '3055551234',
    date_of_birth: '1985-03-02', household_income: '$35,000–$59,999',
    who_to_insure: 'Family', pre_existing_conditions: 'Yes',
    city: 'MIRAMAR', zip: '33027', state: 'Florida',
  };
  const p = buildWebformProspect(extractWebformFields(flat), flat, NOW);
  assert.equal(p.state, 'FL');                 // dropdown-ready
  assert.equal(p.income, '47,500');            // band midpoint
  assert.equal(p.dobs, '1985-03-02');
  assert.equal(p.indvOrFamily, 'Family');
  assert.equal(p.meds, 'Has health concerns'); // general impression, not the raw "Yes"
  assert.match(p.situation, /household_income: \$35,000–\$59,999/); // band preserved in notes (raw block)
  assert.match(p.situation, /city: MIRAMAR/);  // city preserved (no dedicated field)
  assert.ok(!p.needsReview);
});
test('health "No" leaves Health Notes blank; unrecognized state stays blank', () => {
  const flat = { name: 'A B', email: 'a@x.com', pre_existing_conditions: 'No', state: 'Atlantis' };
  const p = buildWebformProspect(extractWebformFields(flat), flat, NOW);
  assert.equal(p.meds, '');
  assert.equal(p.state, '');
  assert.equal(p.indvOrFamily, 'Indv'); // default kept when no coverage answer
});
