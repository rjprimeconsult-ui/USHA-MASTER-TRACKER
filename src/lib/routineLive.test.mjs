import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppointmentTime, todaysAppointments, followupQueue } from './routineLive.mjs';
import { DEFAULT_SETTINGS } from './routineModel.mjs';

const CHI = 'America/Chicago', NY = 'America/New_York';
const Z = (s) => Date.parse(s);
const NOW = Z('2026-09-08T14:42:00Z'); // 9:42 Chicago
const S = { ...DEFAULT_SETTINGS };

test('parseAppointmentTime: wall-clock in the agent zone, identical under any server TZ (spec §5)', () => {
  const r = parseAppointmentTime('2026-09-08T10:00', CHI);
  assert.deepEqual(r, { day: '2026-09-08', minute: 600, instant: Z('2026-09-08T15:00:00Z') });
  assert.equal(parseAppointmentTime('2026-09-08 10:00', CHI).instant, r.instant);
  assert.equal(parseAppointmentTime('2026-09-08T10:00:00', CHI).instant, r.instant);
  assert.equal(parseAppointmentTime('2026-09-08T23:30', 'Pacific/Auckland').minute, 1410);
  assert.equal(parseAppointmentTime('2026-09-08T23:30', 'Pacific/Auckland').day, '2026-09-08');
});

test('parseAppointmentTime: zoned ISO uses Date.parse; date-only and T00:00 are time-less → null', () => {
  const z = parseAppointmentTime('2026-09-09T02:30:00-05:00', NY); // 03:30 NY on 09-09
  assert.deepEqual(z, { day: '2026-09-09', minute: 210, instant: Z('2026-09-09T07:30:00Z') });
  assert.equal(parseAppointmentTime('2026-09-08', CHI), null);
  assert.equal(parseAppointmentTime('2026-09-08T00:00', CHI), null);
  assert.equal(parseAppointmentTime('garbage', CHI), null);
  assert.equal(parseAppointmentTime('', CHI), null);
  assert.equal(parseAppointmentTime(null, CHI), null);
});

const p = (id, o = {}) => ({ id, name: 'N ' + id, stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T10:00', archivedAt: null, ...o });
const blk = (id, startMin, o = {}) => ({ id, name: 'Webby appointments', category: 'appt', paletteId: 'webby', startMin, durationMin: 120, deletedAt: null, ...o });
const attach = (blockId, prospectId, o = {}) => ({ id: `2026-09-08|attach|${blockId}`, kind: 'attach', day: '2026-09-08', blockId, prospectId, updatedAt: 'x', deletedAt: null, ...o });
const frozen = (pid, startMin, o = {}) => ({ id: `2026-09-08|appt|${pid}|${startMin}`, kind: 'appt', day: '2026-09-08', prospectId: pid, startMin, durationMin: 30, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: null, ...o });
const ta = (o) => todaysAppointments({ prospectRows: [], blocks: [], dayRecords: [], settings: S, tz: CHI, now: NOW, ...o });

test('derived: today only, stage-filtered, archived excluded, 30 min, name from the row', () => {
  const rows = [p('a'), p('b', { stage: 'SOLD' }), p('c', { archivedAt: '2026-09-01T00:00:00Z' }), p('d', { appointmentTime: '2026-09-09T10:00' }), p('e', { appointmentTime: '2026-09-08T14:00' })];
  const out = ta({ prospectRows: rows });
  assert.deepEqual(out.map(i => [i.prospectId, i.startMin, i.durationMin, i.source, i.frozen]), [['a', 600, 30, 'derived', false], ['e', 840, 30, 'derived', false]]);
  assert.equal(out[0].name, 'N a');
  assert.equal(out[0].instant, Z('2026-09-08T15:00:00Z'));
});

test('appointmentStages is agent-configurable; a custom stage counts', () => {
  const out = ta({ prospectRows: [p('a', { stage: 'STAGE_9' })], settings: { ...S, appointmentStages: ['STAGE_9'] } });
  assert.equal(out.length, 1);
});

test('frozen wins over a stage change at the same start; needs no prospect row; name falls back', () => {
  const out = ta({ prospectRows: [p('a', { stage: 'PENDING_DECISION' })], dayRecords: [frozen('a', 600)] });
  assert.equal(out.length, 1); assert.equal(out[0].frozen, true); assert.equal(out[0].name, 'N a');
  const noRow = ta({ dayRecords: [frozen('zz', 600)] });
  assert.equal(noRow[0].name, 'Appointment'); assert.equal(noRow[0].instant, Z('2026-09-08T15:00:00Z'));
});

test('frozen 10:00 + live 14:00 → two items; a post-start nudge to 10:05 is absorbed; pre-start edit moves the one card', () => {
  const two = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T14:00' })], dayRecords: [frozen('a', 600)] });
  assert.deepEqual(two.map(i => i.startMin), [600, 840]);
  const nudge = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T10:05' })], dayRecords: [frozen('a', 600)] });
  assert.deepEqual(nudge.map(i => i.startMin), [600]);
  const moved = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T10:10' })] });
  assert.deepEqual(moved.map(i => i.startMin), [610]);
});

test('a tombstoned appt record suppresses the live item at that start (Remove from today)', () => {
  const out = ta({ prospectRows: [p('a')], dayRecords: [frozen('a', 600, { deletedAt: '2026-09-08T15:02:00Z' })] });
  assert.equal(out.length, 0);
});

test('attach: block geometry, wins over derived only at the same start; derived 10:00 + attach 14:00 → two; tombstoned block → nothing', () => {
  const b = blk('webby', 840);
  const same = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T14:00' })], blocks: [b], dayRecords: [attach('webby', 'a')] });
  assert.deepEqual(same.map(i => [i.startMin, i.durationMin, i.source]), [[840, 120, 'attached']]);
  const two = ta({ prospectRows: [p('a')], blocks: [b], dayRecords: [attach('webby', 'a')] });
  assert.deepEqual(two.map(i => [i.startMin, i.source]), [[600, 'derived'], [840, 'attached']]);
  const dead = ta({ blocks: [blk('webby', 840, { deletedAt: 'x' })], dayRecords: [attach('webby', 'a')] });
  assert.equal(dead.length, 0);
  const twoBlocks = ta({ blocks: [blk('w1', 840), blk('w2', 960)], dayRecords: [attach('w1', 'a'), attach('w2', 'a')] });
  assert.deepEqual(twoBlocks.map(i => i.startMin), [840, 960]);
  assert.equal(ta({ blocks: [b], dayRecords: [attach('webby', 'zz')] })[0].name, 'Webby appointments');
});

test('activeDays never affects appointments (caller passes liveBlocks regardless)', () => {
  const out = ta({ prospectRows: [p('a')], settings: { ...S, activeDays: [] } });
  assert.equal(out.length, 1);
});

test('followupQueue: stage-selected, archived out, lastContact asc with empty first, createdAt asc, ages', () => {
  const mk = (id, o) => ({ id, name: 'N' + id, stage: 'FOLLOWUP_LATER', archivedAt: null, lastContact: '', createdAt: '2026-09-01T00:00:00Z', ...o });
  const rows = [
    mk('1', { lastContact: '2026-08-27' }), mk('2', { lastContact: '2026-09-05' }), mk('3', { createdAt: '2026-09-07T00:00:00Z' }),
    mk('4', { createdAt: '2026-08-01T00:00:00Z' }), mk('5', { archivedAt: 'x' }), mk('6', { stage: 'SOLD' }), mk('7', { stage: 'STAGE_X', lastContact: '2026-09-01' }),
  ];
  const out = followupQueue(rows, ['FOLLOWUP_LATER', 'STAGE_X'], CHI, NOW);
  assert.deepEqual(out.map(r => r.id), ['4', '3', '1', '7', '2']);
  assert.deepEqual(out.map(r => r.age), ['—', 'new', '12d', '7d', '3d']);
});
