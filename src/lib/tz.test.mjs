import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, offsetMinutesAt, localDayKey, localMinuteOfDay, localWeekday, addDays, daysBetween, zonedTimeToUtc } from './tz.mjs';

const NY = 'America/New_York';
const CHI = 'America/Chicago';
const Z = (s) => Date.parse(s);

test('isValidTimeZone', () => {
  assert.equal(isValidTimeZone(NY), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
});

test('offsetMinutesAt returns local − UTC (NY = −240 EDT, −300 EST)', () => {
  assert.equal(offsetMinutesAt(Z('2026-07-01T12:00:00Z'), NY), -240);
  assert.equal(offsetMinutesAt(Z('2026-01-15T12:00:00Z'), NY), -300);
  assert.equal(offsetMinutesAt(Z('2026-07-01T12:00:00Z'), 'Asia/Kolkata'), 330);
});

test('localDayKey / localMinuteOfDay follow the zone, not the server', () => {
  const t = Z('2026-09-09T04:30:00Z'); // 23:30 CDT on 09-08 (Chicago is UTC−5 in September)
  assert.equal(localDayKey(t, CHI), '2026-09-08');
  assert.equal(localMinuteOfDay(t, CHI), 23 * 60 + 30);
  assert.equal(localDayKey(t, 'UTC'), '2026-09-09');
});

test('localWeekday: 0 = Sunday (2026-09-06 is a Sunday)', () => {
  assert.equal(localWeekday('2026-09-06'), 0);
  assert.equal(localWeekday('2026-09-08'), 2);
});

test('addDays / daysBetween are calendar arithmetic on the day key', () => {
  assert.equal(addDays('2026-09-08', -7), '2026-09-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // DST day, still +1
  assert.equal(daysBetween('2026-09-01', '2026-09-08'), 7);
  assert.equal(daysBetween('2026-03-01', '2026-03-15'), 14); // across a DST change
  assert.equal(daysBetween('2026-09-08', '2026-09-08'), 0);
});

test('zonedTimeToUtc — the four DST pins (spec §5)', () => {
  assert.equal(zonedTimeToUtc('2026-03-08', 2 * 60 + 30, NY), Z('2026-03-08T07:30:00Z')); // spring gap → utc1
  assert.equal(zonedTimeToUtc('2026-03-08', 3 * 60, NY), Z('2026-03-08T07:00:00Z'));
  assert.equal(zonedTimeToUtc('2026-11-01', 1 * 60 + 30, NY), Z('2026-11-01T05:30:00Z')); // first 01:30 (EDT)
  assert.equal(zonedTimeToUtc('2026-11-01', 2 * 60, NY), Z('2026-11-01T07:00:00Z'));
});

test('zonedTimeToUtc — an ordinary day, and WI vs FL differ by an hour', () => {
  assert.equal(zonedTimeToUtc('2026-09-08', 8 * 60 + 30, CHI), Z('2026-09-08T13:30:00Z'));
  assert.equal(zonedTimeToUtc('2026-09-08', 8 * 60 + 30, NY), Z('2026-09-08T12:30:00Z'));
  assert.equal(zonedTimeToUtc('2026-09-08', 0, CHI), Z('2026-09-08T05:00:00Z'));
});
