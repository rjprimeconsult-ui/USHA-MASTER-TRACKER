import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLAST_PERIODS, DEFAULT_BLAST_PERIOD, blastPeriodRange,
} from './blastPeriod.mjs';

// Helpers to assert a Date is local midnight / local end-of-day of a given Y-M-D.
const isMidnight = (d, y, m, day) =>
  d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day &&
  d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
const isEndOfDay = (d, y, m, day) =>
  d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day &&
  d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59 && d.getMilliseconds() === 999;

// ---------- constants ----------
test('BLAST_PERIODS order and DEFAULT', () => {
  assert.deepEqual(BLAST_PERIODS, ['today', 'week', '30d', 'ytd', 'custom']);
  assert.equal(DEFAULT_BLAST_PERIOD, 'week');
});

// ---------- today ----------
test('today: [today 00:00, today 23:59:59.999]', () => {
  const now = new Date(2026, 6, 23, 14, 30); // Thu Jul 23 2026, 2:30pm local
  const { start, end } = blastPeriodRange('today', { now });
  assert.ok(isMidnight(start, 2026, 7, 23));
  assert.ok(isEndOfDay(end, 2026, 7, 23));
});

// ---------- week (Monday-start, Sunday belongs to prior Monday's week) ----------
test('week: mid-week (Thu Jul 23 2026) -> Mon Jul 20 .. today', () => {
  const now = new Date(2026, 6, 23, 9, 0); // Thursday
  const { start, end } = blastPeriodRange('week', { now });
  assert.ok(isMidnight(start, 2026, 7, 20), 'start should be Monday Jul 20'); // Jul 20 2026 is a Monday
  assert.ok(isEndOfDay(end, 2026, 7, 23));
});
test('week: on Monday (Jul 20 2026) -> start = today', () => {
  const now = new Date(2026, 6, 20, 8, 0); // Monday
  const { start } = blastPeriodRange('week', { now });
  assert.ok(isMidnight(start, 2026, 7, 20));
});
test('week: on Sunday (Jul 26 2026) -> start = the PRIOR Monday Jul 20 (same week)', () => {
  const now = new Date(2026, 6, 26, 20, 0); // Sunday
  const { start, end } = blastPeriodRange('week', { now });
  assert.ok(isMidnight(start, 2026, 7, 20), 'Sunday maps back to Mon Jul 20');
  assert.ok(isEndOfDay(end, 2026, 7, 26));
});
test('week: on Saturday (Jul 25 2026) -> start = Mon Jul 20', () => {
  const now = new Date(2026, 6, 25, 12, 0); // Saturday
  const { start } = blastPeriodRange('week', { now });
  assert.ok(isMidnight(start, 2026, 7, 20));
});
test('week: crossing a month boundary (Wed Apr 1 2026) -> Mon Mar 30', () => {
  const now = new Date(2026, 3, 1, 10, 0); // Wed Apr 1 2026
  const { start } = blastPeriodRange('week', { now });
  assert.ok(isMidnight(start, 2026, 3, 30), 'Mon Mar 30 2026'); // Mar 30 2026 is a Monday
});

// ---------- 30d (rolling: today - 29 .. today, 30 calendar days) ----------
test('30d: today - 29 days at 00:00 .. today 23:59', () => {
  const now = new Date(2026, 6, 23, 11, 0); // Jul 23
  const { start, end } = blastPeriodRange('30d', { now });
  assert.ok(isMidnight(start, 2026, 6, 24), 'Jun 24 = Jul 23 minus 29 days');
  assert.ok(isEndOfDay(end, 2026, 7, 23));
});

// ---------- ytd (Jan 1 local .. today) ----------
test('ytd: Jan 1 of now-year 00:00 .. today', () => {
  const now = new Date(2026, 6, 23, 11, 0);
  const { start, end } = blastPeriodRange('ytd', { now });
  assert.ok(isMidnight(start, 2026, 1, 1));
  assert.ok(isEndOfDay(end, 2026, 7, 23));
});
test('ytd on Jan 1 -> start = today', () => {
  const now = new Date(2026, 0, 1, 6, 0);
  const { start, end } = blastPeriodRange('ytd', { now });
  assert.ok(isMidnight(start, 2026, 1, 1));
  assert.ok(isEndOfDay(end, 2026, 1, 1));
});

// ---------- custom ----------
test('custom: [customStart 00:00, customEnd 23:59:59.999] inclusive', () => {
  const r = blastPeriodRange('custom', { customStart: '2026-06-01', customEnd: '2026-06-30' });
  assert.ok(isMidnight(r.start, 2026, 6, 1));
  assert.ok(isEndOfDay(r.end, 2026, 6, 30));
});
test('custom: same start and end = a single full day', () => {
  const r = blastPeriodRange('custom', { customStart: '2026-06-15', customEnd: '2026-06-15' });
  assert.ok(isMidnight(r.start, 2026, 6, 15));
  assert.ok(isEndOfDay(r.end, 2026, 6, 15));
});
test('custom: missing a date -> null', () => {
  assert.equal(blastPeriodRange('custom', { customStart: '2026-06-01', customEnd: '' }), null);
  assert.equal(blastPeriodRange('custom', { customStart: '', customEnd: '2026-06-30' }), null);
  assert.equal(blastPeriodRange('custom', {}), null);
});
test('custom: start after end -> null', () => {
  assert.equal(blastPeriodRange('custom', { customStart: '2026-06-30', customEnd: '2026-06-01' }), null);
});

// ---------- unknown period ----------
test('unknown period -> null (defensive)', () => {
  assert.equal(blastPeriodRange('bogus', { now: new Date(2026, 6, 23) }), null);
});

// ---------- default now ----------
test('omitting now uses current date (smoke — start <= end, both Date)', () => {
  const { start, end } = blastPeriodRange('today');
  assert.ok(start instanceof Date && end instanceof Date);
  assert.ok(start.getTime() <= end.getTime());
});
