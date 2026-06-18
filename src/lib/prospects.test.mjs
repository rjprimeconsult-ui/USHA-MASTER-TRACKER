import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDateLike, sanitizeImportedProspect } from './prospectDates.mjs';

test('isDateLike accepts real dates, rejects free text', () => {
  // Valid date strings
  assert.equal(isDateLike('2026-07-01'), true);
  assert.equal(isDateLike('3/1/01'), true);
  assert.equal(isDateLike('2026-07-01T14:30:00Z'), true);
  // Garbage the AI sometimes drops into date fields
  assert.equal(isDateLike('RINGY'), false);
  assert.equal(isDateLike('ASAP'), false);
  assert.equal(isDateLike('VanillaSoft'), false);
  assert.equal(isDateLike(''), false);
  assert.equal(isDateLike(null), false);
  assert.equal(isDateLike(undefined), false);
});

test('sanitizeImportedProspect blanks non-date values in date fields', () => {
  // The exact Troy Walker bug: "RINGY" landed in startDate
  const cleaned = sanitizeImportedProspect({
    name: 'Troy Walker',
    startDate: 'RINGY',
    lastContact: 'see notes',
    appointmentTime: 'Friday',
    crm: 'VanillaSoft',
  });
  assert.equal(cleaned.startDate, '');
  assert.equal(cleaned.lastContact, '');
  assert.equal(cleaned.appointmentTime, '');
  // Non-date fields are untouched
  assert.equal(cleaned.name, 'Troy Walker');
  assert.equal(cleaned.crm, 'VanillaSoft');
});

test('sanitizeImportedProspect preserves valid dates', () => {
  const cleaned = sanitizeImportedProspect({
    name: 'Jane Doe',
    startDate: '2026-08-01',
    lastContact: '2026-06-10',
    appointmentTime: '2026-06-20T15:00:00Z',
  });
  assert.equal(cleaned.startDate, '2026-08-01');
  assert.equal(cleaned.lastContact, '2026-06-10');
  assert.equal(cleaned.appointmentTime, '2026-06-20T15:00:00Z');
});
