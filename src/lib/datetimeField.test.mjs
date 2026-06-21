// Tests for the pure 12h<->24h conversion + datetime-local (de)composition
// that backs the custom clamping time picker. 12 AM = 00:00 and 12 PM = 12:00
// are the classic off-by-one traps, so they're locked in here.
//
// Run: node --test src/lib/datetimeField.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { to24, to12, parseDateTimeLocal, composeDateTimeLocal, clampIndex } from './datetimeField.mjs';

test('to24 — 12 AM is midnight (00), 12 PM is noon (12)', () => {
  assert.equal(to24(12, 'AM'), 0);
  assert.equal(to24(12, 'PM'), 12);
  assert.equal(to24(1, 'AM'), 1);
  assert.equal(to24(1, 'PM'), 13);
  assert.equal(to24(11, 'PM'), 23);
  assert.equal(to24(11, 'AM'), 11);
});

test('to12 — inverse of to24 across all 24 hours', () => {
  assert.deepEqual(to12(0), { hour12: 12, ampm: 'AM' });
  assert.deepEqual(to12(12), { hour12: 12, ampm: 'PM' });
  assert.deepEqual(to12(13), { hour12: 1, ampm: 'PM' });
  assert.deepEqual(to12(23), { hour12: 11, ampm: 'PM' });
  assert.deepEqual(to12(9), { hour12: 9, ampm: 'AM' });
  // round-trip every hour
  for (let h = 0; h < 24; h++) {
    const { hour12, ampm } = to12(h);
    assert.equal(to24(hour12, ampm), h, `round-trip failed at ${h}`);
  }
});

test('parseDateTimeLocal — splits a YYYY-MM-DDTHH:mm string into parts', () => {
  assert.deepEqual(parseDateTimeLocal('2026-06-20T10:20'), { date: '2026-06-20', hour12: 10, minute: 20, ampm: 'AM' });
  assert.deepEqual(parseDateTimeLocal('2026-06-20T00:05'), { date: '2026-06-20', hour12: 12, minute: 5, ampm: 'AM' });
  assert.deepEqual(parseDateTimeLocal('2026-06-20T13:00'), { date: '2026-06-20', hour12: 1, minute: 0, ampm: 'PM' });
  assert.deepEqual(parseDateTimeLocal('2026-06-20T23:59'), { date: '2026-06-20', hour12: 11, minute: 59, ampm: 'PM' });
});

test('parseDateTimeLocal — empty / garbage yields all-null parts', () => {
  assert.deepEqual(parseDateTimeLocal(''), { date: '', hour12: null, minute: null, ampm: null });
  assert.deepEqual(parseDateTimeLocal(null), { date: '', hour12: null, minute: null, ampm: null });
  assert.deepEqual(parseDateTimeLocal('not a date'), { date: '', hour12: null, minute: null, ampm: null });
});

test('composeDateTimeLocal — rebuilds the 24h string from parts', () => {
  assert.equal(composeDateTimeLocal({ date: '2026-06-20', hour12: 10, minute: 20, ampm: 'AM' }), '2026-06-20T10:20');
  assert.equal(composeDateTimeLocal({ date: '2026-06-20', hour12: 12, minute: 5, ampm: 'AM' }), '2026-06-20T00:05');
  assert.equal(composeDateTimeLocal({ date: '2026-06-20', hour12: 1, minute: 0, ampm: 'PM' }), '2026-06-20T13:00');
});

test('composeDateTimeLocal — no date means an incomplete value (empty string)', () => {
  assert.equal(composeDateTimeLocal({ date: '', hour12: 10, minute: 20, ampm: 'AM' }), '');
});

test('round-trip — compose(parse(x)) === x for valid inputs', () => {
  for (const s of ['2026-06-20T10:20', '2026-01-01T00:00', '2026-12-31T12:00', '2026-06-20T13:45', '2026-06-20T23:59']) {
    assert.equal(composeDateTimeLocal(parseDateTimeLocal(s)), s, `round-trip failed for ${s}`);
  }
});

test('clampIndex — never wraps; stays within [0, len-1]', () => {
  assert.equal(clampIndex(-1, 12), 0);   // scrolling up past the top stops
  assert.equal(clampIndex(12, 12), 11);  // scrolling down past the bottom stops
  assert.equal(clampIndex(0, 60), 0);
  assert.equal(clampIndex(59, 60), 59);
  assert.equal(clampIndex(60, 60), 59);  // 59 does NOT roll to 0
  assert.equal(clampIndex(5, 12), 5);
});
