import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowupStats } from './followupStats.mjs';

const t = (at, outcome, channel = 'Call') => ({ id: at, at, channel, outcome, note: '' });
const P = (stage, cadence, touches = []) => ({ id: Math.random().toString(36).slice(2), stage, cadence, touchLog: touches });
const NOW = '2026-06-10T12:00:00.000Z';
const cad = (nextDueAt, completedAt = null, snoozedUntil = null) => ({ stepIndex: 0, nextDueAt, snoozedUntil, completedAt });

test('empty input → safe zeros / nulls', () => {
  const s = computeFollowupStats([], NOW);
  assert.equal(s.totalTouches, 0);
  assert.equal(s.connectRate, 0);
  assert.equal(s.onTimeRate, null);
  assert.equal(s.avgTouchesToAppt, null);
  assert.equal(s.activeCount, 0);
  assert.equal(s.overdueCount, 0);
  assert.deepEqual(s.byOutcome, {});
  assert.deepEqual(s.byStage, []);
});

test('totalTouches + byOutcome + connectRate', () => {
  const ps = [
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-01T10:00:00.000Z', 'No answer'), t('2026-06-02T10:00:00.000Z', 'Connected')]),
    P('PENDING_DECISION', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-03T10:00:00.000Z', 'Booked appt')]),
  ];
  const s = computeFollowupStats(ps, NOW);
  assert.equal(s.totalTouches, 3);
  assert.deepEqual(s.byOutcome, { 'No answer': 1, 'Connected': 1, 'Booked appt': 1 });
  assert.equal(Math.round(s.connectRate * 100), 67);
});

test('onTimeRate: active = has nextDueAt & not completed & not terminal; overdue lowers it', () => {
  const ps = [
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z')),
    P('PENDING_DECISION', cad('2026-06-05T12:00:00.000Z')),
    P('FOLLOWUP_LATER', cad('2026-06-20T12:00:00.000Z', null, '2026-06-30T12:00:00.000Z')),
    P('SOLD', cad(null)),
    P('WEBBY_SET', cad(null)),
  ];
  const s = computeFollowupStats(ps, NOW);
  assert.equal(s.activeCount, 3);
  assert.equal(s.overdueCount, 1);
  assert.equal(Math.round(s.onTimeRate * 100), 67);
});

test('avgTouchesToAppt: touches up to & incl first Booked appt, averaged over prospects that booked', () => {
  const ps = [
    P('APPOINTMENT_SET', cad(null), [t('2026-06-01T10:00:00.000Z', 'No answer'), t('2026-06-02T10:00:00.000Z', 'No answer'), t('2026-06-03T10:00:00.000Z', 'Booked appt'), t('2026-06-04T10:00:00.000Z', 'Connected')]),
    P('APPOINTMENT_SET', cad(null), [t('2026-06-01T10:00:00.000Z', 'Booked appt')]),
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-01T10:00:00.000Z', 'No answer')]),
  ];
  const s = computeFollowupStats(ps, NOW);
  assert.equal(s.avgTouchesToAppt, 2);
});

test('byStage: count, overdue, touches per stage; excludes archived', () => {
  const ps = [
    P('GHOSTED', cad('2026-06-05T12:00:00.000Z'), [t('2026-06-01T10:00:00.000Z', 'No answer')]),
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-02T10:00:00.000Z', 'Connected')]),
    { ...P('GHOSTED', cad('2026-06-05T12:00:00.000Z')), archivedAt: '2026-06-01T00:00:00.000Z' },
  ];
  const s = computeFollowupStats(ps, NOW);
  const g = s.byStage.find(x => x.stage === 'GHOSTED');
  assert.equal(g.count, 2);
  assert.equal(g.overdue, 1);
  assert.equal(g.touches, 2);
});
