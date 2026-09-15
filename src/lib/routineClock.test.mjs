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
  assert.equal(s({ nowMin: 540 }), 'past-unchecked');
  assert.equal(s({ nowMin: 480 }), 'current');
});

// Dial 8:30–10:30 split by a 9:00–9:30 appointment; Break 10:30–10:45.
const seg = (blockId, s, e, extra = {}) => ({ kind: 'segment', blockId, startMin: s, endMin: e, name: blockId, category: blockId === 'break' ? 'break' : 'dial', ...extra });
// Breaks never set `behind` (a "Break · still open" line is noise; consistent with §7h.4 excluding breaks) — plan deviation from the literal §7b, propose for rev 11.
const items = [seg('dial', 510, 540, { isFirst: true }), { kind: 'appt', prospectId: 'p1', startMin: 540, endMin: 570, name: 'Ana' }, seg('dial', 570, 630, { isLast: true }), seg('break', 630, 645, { isFirst: true, isLast: true })];
const noDone = [];
const TODAY = '2026-09-08';

test('nowState phases and the per-block behind rule (spec §7b)', () => {
  assert.equal(nowState({ items, dayRecords: noDone, nowMin: 400, today: TODAY }).phase, 'upFirst');
  const at550 = nowState({ items, dayRecords: noDone, nowMin: 550, today: TODAY });
  assert.equal(at550.phase, 'now'); assert.equal(at550.current.kind, 'appt'); assert.equal(at550.behind, null); // last segment not ended
  assert.equal(nowState({ items, dayRecords: noDone, nowMin: 631, today: TODAY }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [{ kind: 'done', blockId: 'dial', status: 'done', day: TODAY }], nowMin: 631, today: TODAY }).behind, null);
  assert.equal(nowState({ items, dayRecords: [{ kind: 'done', blockId: 'dial', status: 'skipped', day: TODAY }], nowMin: 700, today: TODAY }).phase, 'dayDone');
  assert.equal(nowState({ items, dayRecords: [{ kind: 'done', blockId: 'dial', status: 'done', day: TODAY }], nowMin: 700, today: TODAY, offerBlocked: true }).phase, 'free');
  const free = nowState({ items: [seg('a', 480, 500, { isFirst: true, isLast: true }), seg('b', 600, 660, { isFirst: true, isLast: true })], dayRecords: [{ kind: 'done', blockId: 'a', status: 'done', day: TODAY }], nowMin: 520, today: TODAY });
  assert.equal(free.phase, 'free'); assert.equal(free.next.blockId, 'b');
  assert.equal(nowState({ items: [], dayRecords: [], nowMin: 500, today: TODAY }).phase, 'dayDone');
});

test('nowState: done scoped to today; tombstoned done ignored; oldest of two wins; make-ups keyed by makeupId; free with no next; boundaries; midnight', () => {
  const d = (blockId, status, day = TODAY) => ({ kind: 'done', blockId, status, day, deletedAt: null });
  assert.equal(nowState({ items, dayRecords: [d('dial', 'done', '2026-09-07')], nowMin: 631, today: TODAY }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [d('dial', 'done')], nowMin: 631, today: TODAY }).behind, null);
  assert.equal(nowState({ items, dayRecords: [{ ...d('dial', 'done'), deletedAt: 'x' }], nowMin: 631, today: TODAY }).behind.blockId, 'dial');
  const two = [seg('a', 480, 500, { isFirst: true, isLast: true }), seg('b', 520, 540, { isFirst: true, isLast: true })];
  assert.equal(nowState({ items: two, dayRecords: [], nowMin: 600, today: TODAY }).behind.blockId, 'a');
  assert.equal(nowState({ items: two, dayRecords: [d('a', 'done')], nowMin: 600, today: TODAY }).behind.blockId, 'b');
  const mk = [{ kind: 'makeup', makeupId: 'mk_0000001', name: 'Dial block (make-up)', category: 'dial', startMin: 750, endMin: 780 }];
  assert.equal(nowState({ items: mk, dayRecords: [], nowMin: 800, today: TODAY }).behind.blockId, 'mk_0000001');
  assert.equal(nowState({ items: mk, dayRecords: [d('mk_0000001', 'done')], nowMin: 800, today: TODAY }).behind, null);
  const late = nowState({ items, dayRecords: [], nowMin: 700, today: TODAY });
  assert.equal(late.phase, 'free'); assert.equal(late.next, null); assert.equal(late.behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [], nowMin: 630, today: TODAY }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [], nowMin: 510, today: TODAY }).current.blockId, 'dial');
  assert.throws(() => nowState({ items, dayRecords: [], nowMin: 500 }), TypeError);
  assert.equal(formatTime(1440), '12:00'); assert.equal(formatTime(-5), '11:55'); assert.equal(formatTime(1445), '12:05');
});
