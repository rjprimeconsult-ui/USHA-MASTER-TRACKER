import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenRecord, normalizeBody, extractWebformFields, buildRawBlock,
  buildWebformProspect, upsertWebformProspect, buildWebformAiPrompt,
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
