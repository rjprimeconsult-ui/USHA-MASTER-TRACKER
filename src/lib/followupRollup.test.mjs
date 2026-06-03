import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followupDailyActivity, mergeFunnelTotals } from './followupRollup.mjs';

const prospect = (touches) => ({ id: 'p', touchLog: touches });

test('followupDailyActivity: each attempt = 1 dial; Booked appt = 1 appointment', () => {
  const ps = [
    prospect([
      { at: '2026-06-01T10:00:00.000Z', channel: 'Call', outcome: 'No answer' },
      { at: '2026-06-01T14:00:00.000Z', channel: 'Text', outcome: 'Connected' },
      { at: '2026-06-02T09:00:00.000Z', channel: 'Call', outcome: 'Booked appt' },
    ]),
  ];
  const map = followupDailyActivity(ps);
  assert.deepEqual(map['2026-06-01'], { dials: 2, appointments: 0 });
  assert.deepEqual(map['2026-06-02'], { dials: 1, appointments: 1 });
});

test('mergeFunnelTotals: manual day wins; follow-up fills empty days', () => {
  const activities = [
    { date: '2026-06-01', dials: 20, appointments: 3, pitches: 2, closes: 1 },
  ];
  const ps = [
    prospect([
      { at: '2026-06-01T10:00:00.000Z', channel: 'Call', outcome: 'No answer' },
      { at: '2026-06-02T09:00:00.000Z', channel: 'Call', outcome: 'Booked appt' },
    ]),
  ];
  const t = mergeFunnelTotals(activities, ps);
  assert.deepEqual(t, { dials: 21, appts: 4, pitches: 2, closes: 1 });
});

test('mergeFunnelTotals: no prospects = pure manual totals', () => {
  const activities = [{ date: '2026-06-01', dials: 5, appointments: 1, pitches: 1, closes: 0 }];
  assert.deepEqual(mergeFunnelTotals(activities, []), { dials: 5, appts: 1, pitches: 1, closes: 0 });
});

test('mergeFunnelTotals: empty everything = zeros', () => {
  assert.deepEqual(mergeFunnelTotals([], []), { dials: 0, appts: 0, pitches: 0, closes: 0 });
});
