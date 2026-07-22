import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitName, csvCell, buildProspectsCsv, prospectMatchesFilters,
  EXPORT_HEADERS, NO_SOURCE, deriveSourceOptions, exportFilename,
} from './prospectExport.mjs';

// ---------- splitName ----------
test('splitName: two words -> first/last', () => {
  assert.deepEqual(splitName('Maria Gonzalez'), { first: 'Maria', last: 'Gonzalez' });
});
test('splitName: single word -> first only', () => {
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
});
test('splitName: 4 words -> first + rest-as-last', () => {
  assert.deepEqual(splitName('Maria Elena Gonzalez Ruiz'), { first: 'Maria', last: 'Elena Gonzalez Ruiz' });
});
test('splitName: leading/trailing spaces are trimmed BEFORE the split', () => {
  assert.deepEqual(splitName('  Maria Gonzalez  '), { first: 'Maria', last: 'Gonzalez' });
});
test('splitName: empty and all-spaces -> empty first/last', () => {
  assert.deepEqual(splitName(''), { first: '', last: '' });
  assert.deepEqual(splitName('   '), { first: '', last: '' });
  assert.deepEqual(splitName(null), { first: '', last: '' });
  assert.deepEqual(splitName(undefined), { first: '', last: '' });
});

// ---------- csvCell ----------
test('csvCell: plain value gets quoted', () => {
  assert.equal(csvCell('hello'), '"hello"');
});
test('csvCell: embedded quotes doubled', () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});
test('csvCell: null/undefined -> empty quoted cell', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});
test('csvCell: numbers stringified', () => {
  assert.equal(csvCell(33073), '"33073"');
});
test('csvCell: injection guard - leading = + - @ get tab prefix INSIDE quotes', () => {
  assert.equal(csvCell('=2+2'), '"\t=2+2"');
  assert.equal(csvCell('+50k'), '"\t+50k"');
  assert.equal(csvCell('-1234'), '"\t-1234"');
  assert.equal(csvCell('@handle'), '"\t@handle"');
});
test('csvCell: injection guard inspects the RAW value - leading space/digit untouched', () => {
  assert.equal(csvCell(' =2+2'), '" =2+2"'); // leading space, not =, no guard
  assert.equal(csvCell('55'), '"55"');
});

// ---------- buildProspectsCsv ----------
const P = (over = {}) => ({
  id: 'x', name: 'Maria Gonzalez', phone: '(954) 555-0132', email: 'mg@x.com',
  dobs: '01/02/1985', state: 'FL', zip: '33073', income: '$45,000',
  source: 'Benepath', stage: 'PENDING_DECISION', archivedAt: null, ...over,
});

test('buildProspectsCsv: header row is the 9 exact columns', () => {
  assert.deepEqual(EXPORT_HEADERS,
    ['First Name', 'Last Name', 'Full Name', 'Phone', 'Email', 'Date of Birth', 'State', 'ZIP', 'Income']);
});
test('buildProspectsCsv: golden file - BOM, CRLF, quoted cells, exact string', () => {
  const csv = buildProspectsCsv([
    P(),
    P({ id: 'y', name: 'Cher', phone: '', email: '', dobs: '', state: '', zip: '', income: '' }),
  ]);
  const expected = '\uFEFF'
    + '"First Name","Last Name","Full Name","Phone","Email","Date of Birth","State","ZIP","Income"\r\n'
    + '"Maria","Gonzalez","Maria Gonzalez","(954) 555-0132","mg@x.com","01/02/1985","FL","33073","$45,000"\r\n'
    + '"Cher","","Cher","","","","","",""';
  assert.equal(csv, expected);
});
test('buildProspectsCsv: BOM exactly once at position 0', () => {
  const csv = buildProspectsCsv([P()]);
  assert.equal(csv.indexOf('\uFEFF'), 0);
  assert.equal(csv.lastIndexOf('\uFEFF'), 0);
});
test('buildProspectsCsv: comma inside dobs survives inside its quotes', () => {
  const csv = buildProspectsCsv([P({ dobs: '01/02/1985, 03/04/1990' })]);
  assert.ok(csv.includes('"01/02/1985, 03/04/1990"'));
});
test('buildProspectsCsv: a cell containing a literal CRLF stays inside its quotes', () => {
  const csv = buildProspectsCsv([P({ income: 'line1\r\nline2' })]);
  assert.ok(csv.includes('"line1\r\nline2"'));
  // Still exactly 1 header + 1 data row when split on row-delimiter-after-quote:
  const rows = csv.split('\r\n');
  // naive split gives 3 pieces because of the embedded CRLF - that is EXPECTED;
  // the guarantee is the embedded CRLF sits between an opening and closing quote.
  assert.equal(rows.length, 3);
});
test('buildProspectsCsv: Full Name is as stored (untrimmed), First/Last from trimmed', () => {
  const csv = buildProspectsCsv([P({ name: ' Maria Gonzalez' })]);
  assert.ok(csv.includes('"Maria","Gonzalez"," Maria Gonzalez"'));
});

// ---------- prospectMatchesFilters ----------
test('filters: archived prospects NEVER match', () => {
  assert.equal(prospectMatchesFilters(P({ archivedAt: '2026-01-01' }), { source: '', stage: '', query: '' }), false);
});
test('filters: empty filters match any active prospect', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: '' }), true);
});
test('filters: source exact match is trim-both-sides', () => {
  assert.equal(prospectMatchesFilters(P({ source: ' Benepath ' }), { source: 'Benepath', stage: '', query: '' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: 'Ringy', stage: '', query: '' }), false);
});
test('filters: NO_SOURCE sentinel matches only trimmed-empty source', () => {
  assert.equal(prospectMatchesFilters(P({ source: '' }), { source: NO_SOURCE, stage: '', query: '' }), true);
  assert.equal(prospectMatchesFilters(P({ source: '   ' }), { source: NO_SOURCE, stage: '', query: '' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: NO_SOURCE, stage: '', query: '' }), false);
});
test('filters: stage matches by exact id', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: 'PENDING_DECISION', query: '' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: 'SOLD', query: '' }), false);
});
test('filters: query matches name and email case-insensitively', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: 'maria' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: 'MG@X' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: 'zzz' }), false);
});
test('filters: digit query matches phone digits-only', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: '(954) 555' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: '9545550132' }), true);
});
test('filters: all-alphabetic query must NOT match via phone (empty-digits guard)', () => {
  // "abc" has no digits; digits("abc")="" which is a substring of every phone.
  // The phone branch must be skipped entirely for digitless queries.
  assert.equal(prospectMatchesFilters(P({ name: 'Zed', email: '' }), { source: '', stage: '', query: 'abc' }), false);
});
test('filters: AND-combine source+stage+query', () => {
  assert.equal(prospectMatchesFilters(P(), { source: 'Benepath', stage: 'PENDING_DECISION', query: 'maria' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: 'Benepath', stage: 'SOLD', query: 'maria' }), false);
});

test('deriveSourceOptions: trimmed, deduped, sorted; NO_SOURCE appended when empties exist', () => {
  const opts = deriveSourceOptions([
    P({ source: 'Ringy' }), P({ source: ' Benepath ' }), P({ source: 'Benepath' }),
    P({ source: '  ' }), P({ source: 'Aged Lead', archivedAt: '2026-01-01' }),
  ]);
  assert.deepEqual(opts, ['Benepath', 'Ringy', NO_SOURCE]);
});
test('deriveSourceOptions: no empties -> no NO_SOURCE option', () => {
  assert.deepEqual(deriveSourceOptions([P()]), ['Benepath']);
});
test('exportFilename: zero-padded local date', () => {
  assert.equal(exportFilename(new Date(2026, 6, 3)), 'prospects-2026-07-03.csv');
});
