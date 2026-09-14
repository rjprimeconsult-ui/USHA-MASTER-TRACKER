import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PX_PER_MIN, SNAP_MIN, DEFAULT_START, DEFAULT_END, floorHour, ceilHour, bounds, topPx, heightPx, minuteFromPx } from './routineLayout.mjs';

test('constants', () => { assert.deepEqual([PX_PER_MIN, SNAP_MIN, DEFAULT_START, DEFAULT_END], [2, 5, 360, 1260]); });

test('bounds never shrink below the defaults and expand to whole hours', () => {
  assert.deepEqual(bounds([]), { start: 360, end: 1260 });
  assert.deepEqual(bounds([{ startMin: 300, endMin: 330 }]), { start: 300, end: 1260 });
  assert.deepEqual(bounds([{ startMin: 1250, endMin: 1275 }]), { start: 360, end: 1320 });
  assert.deepEqual(bounds([{ startMin: 305, endMin: 1290 }]), { start: 300, end: 1320 });
  assert.deepEqual(bounds([{ startMin: 1425, endMin: 1455 }]), { start: 360, end: 1440 });
});

test('pixel math', () => {
  assert.equal(floorHour(305), 300); assert.equal(ceilHour(1275), 1320); assert.equal(ceilHour(1260), 1260);
  assert.equal(topPx(510, 360), 300); assert.equal(heightPx(120), 240);
  assert.equal(minuteFromPx(303, 360), 510); assert.equal(minuteFromPx(-10, 360), 360); assert.equal(minuteFromPx(99999, 360), 1440);
});
