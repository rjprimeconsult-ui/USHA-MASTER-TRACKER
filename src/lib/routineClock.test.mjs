import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatRange, formatMinutes, blockVisualState, nowState } from './routineClock.mjs';

test('formatters', () => {
  assert.equal(formatTime(510), '8:30'); assert.equal(formatTime(795), '1:15'); assert.equal(formatTime(0), '12:00'); assert.equal(formatTime(720), '12:00');
  assert.equal(formatRange(510, 630), '8:30–10:30');
  assert.equal(formatMinutes(30), '30m'); assert.equal(formatMinutes(85), '1h 25m'); assert.equal(formatMinutes(120), '2h'); assert.equal(formatMinutes(0), '0m');
});

test('blockVisualState', () => {
  const s = (o) => blockVisualState({ startMin: 480, endMin: 540, done: null, nowMin: 400, ...o });
  assert.equal(s({}), 'future');
  assert.equal(s({ done: 'done' }), 'future-done');
  assert.equal(s({ nowMin: 500 }), 'current');
  assert.equal(s({ nowMin: 600, done: 'done' }), 'past-done');
  assert.equal(s({ nowMin: 600 }), 'past-unchecked');
  assert.equal(s({ nowMin: 600, done: 'cleared' }), 'past-unchecked');
  assert.equal(s({ done: 'skipped' }), 'skipped');
});

// Dial 8:30–10:30 split by a 9:00–9:30 appointment; Break 10:30–10:45.
const seg = (blockId, s, e, extra = {}) => ({ kind: 'segment', blockId, startMin: s, endMin: e, name: blockId, category: blockId === 'break' ? 'break' : 'dial', ...extra });
// Breaks never set `behind` (a "Break · still open" line is noise; consistent with §7h.4 excluding breaks) — plan deviation from the literal §7b, propose for rev 11.
const items = [seg('dial', 510, 540, { isFirst: true }), { kind: 'appt', prospectId: 'p1', startMin: 540, endMin: 570, name: 'Ana' }, seg('dial', 570, 630, { isLast: true }), seg('break', 630, 645, { isFirst: true, isLast: true })];
const noDone = [];

test('nowState phases and the per-block behind rule (spec §7b)', () => {
  assert.equal(nowState({ items, dayRecords: noDone, nowMin: 400 }).phase, 'upFirst');
  const at550 = nowState({ items, dayRecords: noDone, nowMin: 550 });
  assert.equal(at550.phase, 'now'); assert.equal(at550.current.kind, 'appt'); assert.equal(at550.behind, null); // last segment not ended
  assert.equal(nowState({ items, dayRecords: noDone, nowMin: 631 }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [{ kind: 'done', blockId: 'dial', status: 'done' }], nowMin: 631 }).behind, null);
  assert.equal(nowState({ items, dayRecords: [{ kind: 'done', blockId: 'dial', status: 'skipped' }], nowMin: 700 }).phase, 'dayDone');
  assert.equal(nowState({ items, dayRecords: [{ kind: 'done', blockId: 'dial', status: 'done' }], nowMin: 700, offerBlocked: true }).phase, 'free');
  const free = nowState({ items: [seg('a', 480, 500, { isFirst: true, isLast: true }), seg('b', 600, 660, { isFirst: true, isLast: true })], dayRecords: [{ kind: 'done', blockId: 'a', status: 'done' }], nowMin: 520 });
  assert.equal(free.phase, 'free'); assert.equal(free.next.blockId, 'b');
  assert.equal(nowState({ items: [], dayRecords: [], nowMin: 500 }).phase, 'dayDone');
});
