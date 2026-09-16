import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppointmentTime, todaysAppointments, followupQueue, apptRecordId } from './routineLive.mjs';
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
  const row = (id, o) => ({ id, name: 'N' + id, stage: 'FOLLOWUP_LATER', archivedAt: null, lastContact: '', createdAt: '2026-09-01T00:00:00Z', ...o });
  const rows = [
    row('1', { lastContact: '2026-08-27' }), row('2', { lastContact: '2026-09-05' }), row('3', { createdAt: '2026-09-07T00:00:00Z' }),
    row('4', { createdAt: '2026-08-01T00:00:00Z' }), row('5', { archivedAt: 'x' }), row('6', { stage: 'SOLD' }), row('7', { stage: 'STAGE_X', lastContact: '2026-09-01' }),
  ];
  const out = followupQueue(rows, ['FOLLOWUP_LATER', 'STAGE_X'], CHI, NOW);
  assert.deepEqual(out.map(r => r.id), ['4', '3', '1', '7', '2']);
  assert.deepEqual(out.map(r => r.age), ['—', 'new', '12d', '7d', '3d']);
});

import { composeDay, findMakeupSlot, reconcileOwed, offerState, applyOwedDecision, owedId, dayNotDone, yesterdayMiss, weeklyNotDone } from './routineLive.mjs';
import { STARTER_TEMPLATE } from './routineTemplates.mjs';
import { instantiateTemplate } from './routineModel.mjs';

// T0 is the blocks' createdAt: it MUST predate the 7-day look-back window
// (dayNotDone excludes blocks created after the day being scored — §7h.4).
const T0 = '2026-08-25T12:00:00.000Z';
const starter = () => STARTER_TEMPLATE.entries.map((e, i) => ({ ...instantiateTemplate(e, { now: T0, defaultMinutesBefore: 5 }), id: 'blk_' + String(i).padStart(7, '0') }));
const DIAL_AM = 'blk_0000001', TEXT = 'blk_0000003', FU_AM = 'blk_0000004', LUNCH = 'blk_0000005', DIAL_PM = 'blk_0000006';
const ap = (pid, startMin, durationMin = 30) => ({ prospectId: pid, startMin, durationMin, endMin: startMin + durationMin, instant: 0, source: 'derived', frozen: false, heldAt: null, name: 'N' });
const mk = (id, startMin, durationMin, o = {}) => ({ id, kind: 'makeup', day: '2026-09-08', startMin, durationMin, category: 'dial', name: 'Dial block (make-up)', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null, ...o });
const TODAY = '2026-09-08';
const compose = (o) => composeDay({ live: starter(), appointments: [], makeups: [], dayRecords: [], nowMin: 582, today: TODAY, ...o });
const segsOf = (r, id) => r.items.filter(i => i.kind === 'segment' && i.blockId === id).map(i => [i.startMin, i.endMin]);

test('composeDay: tail / head / mid / whole; displaced per block; title segment = first ending after now', () => {
  const tail = compose({ appointments: [ap('a', 600)] });
  assert.deepEqual(segsOf(tail, DIAL_AM), [[510, 600]]); assert.deepEqual(tail.displacedByBlock, { [DIAL_AM]: 30 }); assert.equal(tail.unrecovered, 30);
  const head = compose({ appointments: [ap('a', 510)] });
  assert.deepEqual(segsOf(head, DIAL_AM), [[540, 630]]);
  const mid = compose({ appointments: [ap('a', 540)] });
  assert.deepEqual(segsOf(mid, DIAL_AM), [[510, 540], [570, 630]]);
  const segs = mid.items.filter(i => i.blockId === DIAL_AM);
  assert.deepEqual(segs.map(s => s.isTitle), [false, true]); assert.deepEqual(segs.map(s => s.isFirst), [true, false]);
  const whole = compose({ appointments: [ap('a', 510, 120)] });
  assert.deepEqual(segsOf(whole, DIAL_AM), []); assert.equal(whole.displacedByBlock[DIAL_AM], 120);
  const past = compose({ appointments: [ap('a', 540)], nowMin: 700 });
  assert.deepEqual(past.items.filter(i => i.blockId === DIAL_AM).map(s => s.isTitle), [false, true]);
});

test('composeDay: 9-min remnant dropped and counted; unioned overlaps counted once; breaks and appt placeholders contribute 0', () => {
  const r = compose({ appointments: [ap('a', 621), ap('b', 640, 11)] }); // b (640–651) lies inside a (621–651): union 10:21–10:51, counted once
  assert.deepEqual(segsOf(r, DIAL_AM), [[510, 621]]); assert.equal(r.displacedByBlock[DIAL_AM], 9);
  assert.deepEqual(segsOf(r, TEXT), [[651, 675]]); assert.equal(r.displacedByBlock[TEXT], 6);
  assert.equal(r.displacedByBlock['blk_0000002'], undefined); // break
  assert.equal(r.unrecovered, 15);
  const rem = compose({ appointments: [ap('a', 519)] }); // 8:39–9:09 leaves a 9-min head 8:30–8:39 → dropped and counted
  assert.deepEqual(segsOf(rem, DIAL_AM), [[549, 630]]); assert.equal(rem.displacedByBlock[DIAL_AM], 39);
  const live = [...starter(), { id: 'blk_webby00', name: 'Webby', category: 'appt', paletteId: 'webby', startMin: 1100, durationMin: 60, deletedAt: null, remind: { enabled: true, minutesBefore: 5 } }];
  const r2 = composeDay({ live, appointments: [ap('a', 1110)], makeups: [], dayRecords: [], nowMin: 582, today: TODAY });
  assert.equal(r2.displacedByBlock['blk_webby00'], undefined); assert.equal(r2.unrecovered, 0);
});

test('composeDay: two appointments → two markers, one sum; marker on preceding ≥ 40 px else following else omitted', () => {
  const r = compose({ appointments: [ap('a', 540), ap('b', 600)] });
  assert.equal(r.displacedByBlock[DIAL_AM], 60);
  assert.deepEqual(r.markers.filter(m => m.blockId === DIAL_AM).map(m => [m.minutes, m.segmentIndex]), [[30, 0], [30, 1]]);
  const f = compose({ appointments: [ap('a', 660)] }); // Text 10:45–11:15 → 10:45–11:00 (15 min = 30 px) survives, Follow-up 11:30–12:30
  assert.deepEqual(f.markers.filter(m => m.blockId === TEXT), []);
  assert.deepEqual(f.markers.filter(m => m.blockId === FU_AM).map(m => [m.minutes, m.segmentIndex]), [[15, 0]]);
});

test('composeDay: make-up cuts are render-only (breaks, skipped blocks, un-skipped afterwards); recovered/unrecovered; make-up re-split', () => {
  const overLunch = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000001', 750, 30)] });
  assert.deepEqual(segsOf(overLunch, LUNCH), [[780, 795]]); assert.equal(overLunch.recovered, 30); assert.equal(overLunch.unrecovered, 0);
  assert.equal(overLunch.markers.some(m => m.blockId === LUNCH), false);
  assert.equal(Object.keys(overLunch.displacedByBlock).some(k => k.startsWith('mk_')), false);
  const skippedFu = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000002', 930, 30)], dayRecords: [{ kind: 'done', blockId: 'blk_0000008', status: 'skipped', day: '2026-09-08', deletedAt: null }] });
  assert.deepEqual(skippedFu.displacedByBlock, { [DIAL_AM]: 30 });
  const unskipped = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000002', 930, 30)] });
  assert.deepEqual(unskipped.displacedByBlock, { [DIAL_AM]: 30 }); assert.deepEqual(segsOf(unskipped, 'blk_0000008'), [[960, 990]]);
  const hit = compose({ appointments: [ap('a', 540), ap('b', 765, 15)], makeups: [mk('mk_0000001', 750, 30)] });
  assert.equal(hit.displacedByMakeup['mk_0000001'], 15); assert.equal(hit.recovered, 15); assert.equal(hit.unrecovered, 15);
  const gone = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000001', 750, 30, { deletedAt: 'x' })] });
  assert.equal(gone.unrecovered, 30);
});

test('findMakeupSlot: the three pinned cases, over-a-break/skipped, afternoon first, never before now', () => {
  const live = starter();
  const slot = (o) => findMakeupSlot({ live, appointments: [], makeups: [], dayRecords: [], makeupMin: 30, nowMin: 582, today: TODAY, ...o });
  assert.deepEqual(slot({ appointments: [ap('a', 540)] }), { startMin: 750, endMin: 780 });
  const gapLive = live.filter(b => b.id !== FU_AM).map(b => b.id === TEXT ? { ...b, startMin: 645, durationMin: 60 } : b); // gap 11:45–12:30
  assert.deepEqual(findMakeupSlot({ live: gapLive, appointments: [], makeups: [], dayRecords: [], makeupMin: 30, nowMin: 582, today: TODAY }), { startMin: 720, endMin: 750 });
  assert.equal(slot({ makeupMin: 45, nowMin: 1020 }), null);
  assert.deepEqual(slot({ makeupMin: 15, nowMin: 600 }), { startMin: 750, endMin: 765 });
  // FU_AM skipped + Lunch (a break) merge into one 11:15–13:15 gap. Pass 1 (12:00 floor) offers 75 min — enough for 60, not for 90 — so 90 falls through to pass 2 and lands on the skipped morning block.
  assert.deepEqual(slot({ makeupMin: 60, dayRecords: [{ kind: 'done', blockId: FU_AM, status: 'skipped', day: TODAY, deletedAt: null }] }), { startMin: 720, endMin: 780 });
  assert.deepEqual(slot({ makeupMin: 90, dayRecords: [{ kind: 'done', blockId: FU_AM, status: 'skipped', day: TODAY, deletedAt: null }] }), { startMin: 675, endMin: 765 });
  // Lunch fully taken by a 45-min make-up and every morning block live → only the two 15-min breaks remain → null
  assert.equal(slot({ makeupMin: 30, makeups: [mk('mk_0000001', 750, 45)] }), null);
});

test('reconcileOwed: absent+0 → null; absent+>0 → open; differ → minutes/byBlock/updatedAt only; equal (even reordered keys) → null', () => {
  const day = '2026-09-08';
  assert.equal(reconcileOwed(null, { unrecovered: 0, displacedByBlock: {} }, T0, day), null);
  const fresh = reconcileOwed(null, { unrecovered: 30, displacedByBlock: { a: 30 } }, T0, day);
  assert.deepEqual(fresh, { id: `${day}|owed`, kind: 'owed', day, minutes: 30, byBlock: { a: 30 }, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: T0, deletedAt: null });
  const decided = { ...fresh, status: 'skipped', decidedAt: T0, decidedMinutes: 30, updatedAt: 'old' };
  const up = reconcileOwed(decided, { unrecovered: 60, displacedByBlock: { a: 30, b: 30 } }, 'later', day);
  assert.equal(up.minutes, 60); assert.equal(up.status, 'skipped'); assert.equal(up.decidedMinutes, 30); assert.equal(up.updatedAt, 'later');
  assert.equal(reconcileOwed({ ...up, byBlock: { b: 30, a: 30 } }, { unrecovered: 60, displacedByBlock: { a: 30, b: 30 } }, 'x', day), null);
  assert.equal(owedId(day), `${day}|owed`);
});

test('offer lifecycle (derived offerOpen, remainder-sized make-ups) — spec §7h.3 walk', () => {
  const day = '2026-09-08';
  const proj = (u) => ({ unrecovered: u, displacedByBlock: u ? { a: u } : {} });
  let stored = null;
  let st = offerState(stored, proj(30)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 30]);
  stored = applyOwedDecision(stored, 'skip', { projected: proj(30), realized: proj(0), makeupMin: 30, nowIso: T0, day });
  assert.deepEqual([stored.status, stored.decidedMinutes, stored.minutes], ['skipped', 30, 0]);
  st = offerState(stored, proj(30)); assert.equal(st.offerOpen, false);
  st = offerState(stored, proj(45)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 15]);
  st = offerState(stored, proj(30)); assert.equal(st.offerOpen, false);
  st = offerState(stored, proj(60)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 30]);
  stored = applyOwedDecision(stored, 'accept', { projected: proj(60), realized: proj(30), makeupMin: 30, nowIso: T0, day });
  assert.deepEqual([stored.status, stored.decidedMinutes], ['accepted', 30]);
  assert.equal(offerState(stored, proj(30)).offerOpen, false); // make-up recovered 30
  st = offerState(stored, proj(50)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 20]); // make-up hit by 20
  st = offerState(stored, proj(60)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 30]); // make-up removed
  const freshAccept = applyOwedDecision(null, 'accept', { projected: proj(30), realized: proj(30), makeupMin: 30, nowIso: T0, day });
  assert.deepEqual([freshAccept.status, freshAccept.decidedMinutes, freshAccept.minutes], ['accepted', 0, 30]);
  assert.equal(offerState({ ...freshAccept }, proj(0)).offerOpen, false);
  assert.equal(offerState(null, proj(0)).offerOpen, false);
  assert.equal(offerState(null, proj(7)).makeupMin, 10);
  assert.equal(offerState(null, proj(33)).makeupMin, 35);
});

const dnd = (o) => dayNotDone({ day: '2026-09-07', blocks: starter(), dayRecords: [], settings: { ...DEFAULT_SETTINGS }, tz: CHI, ...o });
const doneRec = (blockId, status = 'done', day = '2026-09-07') => ({ id: `${day}|${blockId}`, kind: 'done', day, blockId, status, updatedAt: 'x', deletedAt: null });
const owedRec = (minutes, byBlock, day = '2026-09-07', o = {}) => ({ id: `${day}|owed`, kind: 'owed', day, minutes, byBlock, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: 'x', deletedAt: null, ...o });
const allDone = (day = '2026-09-07') => starter().map(b => doneRec(b.id, 'done', day));

test('dayNotDone: displaced + unchecked, never double-counted; skipped/break/appt/inactive → 0; created-later excluded, deleted-later included', () => {
  assert.equal(dnd({ dayRecords: allDone() }).minutes, 0);
  assert.equal(dnd({ dayRecords: [...allDone(), owedRec(30, { [DIAL_AM]: 30 })] }).minutes, 30);
  const uncheckedDial = allDone().filter(r => r.blockId !== DIAL_AM);
  assert.equal(dnd({ dayRecords: [...uncheckedDial, owedRec(30, { [DIAL_AM]: 30 })] }).minutes, 120);
  assert.equal(dnd({ dayRecords: uncheckedDial }).minutes, 120);
  assert.equal(dnd({ dayRecords: uncheckedDial }).byCategory.dial, 120);
  assert.equal(dnd({ dayRecords: [...uncheckedDial.filter(r => r.blockId !== DIAL_AM), doneRec(DIAL_AM, 'skipped')] }).minutes, 0);
  assert.equal(dnd({ dayRecords: allDone().filter(r => r.blockId !== 'blk_0000002') }).minutes, 0); // break unchecked
  const total = dnd({}).minutes; // whole non-break routine: 30+120+30+75+120+60+45+15 = 495
  assert.equal(total, 495);
  assert.equal(dnd({ day: '2026-09-06', settings: { ...DEFAULT_SETTINGS, activeDays: [1, 2, 3, 4, 5] } }).minutes, 0); // Sunday, inactive → 0
  const createdToday = starter().map(b => ({ ...b, createdAt: '2026-09-08T14:00:00Z' }));
  assert.equal(dnd({ blocks: createdToday }).minutes, 0);
  const deletedToday = starter().map(b => ({ ...b, deletedAt: '2026-09-08T14:00:00Z' }));
  assert.equal(dnd({ blocks: deletedToday }).minutes, 495);
  const withMakeup = [...allDone(), { id: 'mk_0000009', kind: 'makeup', day: '2026-09-07', startMin: 750, durationMin: 30, category: 'dial', name: 'x', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null }];
  assert.equal(dnd({ dayRecords: withMakeup }).minutes, 30);
  assert.equal(dnd({ dayRecords: [...withMakeup, doneRec('mk_0000009')] }).minutes, 0);
});

test('yesterdayMiss and weeklyNotDone', () => {
  const now = Z('2026-09-08T14:42:00Z');
  const recs = [...allDone('2026-09-07').filter(r => r.blockId !== DIAL_AM), owedRec(30, { [DIAL_AM]: 30 })];
  const y = yesterdayMiss({ blocks: starter(), dayRecords: recs, settings: DEFAULT_SETTINGS, tz: CHI, now });
  assert.equal(y.minutes, 120); assert.equal(y.hidden, false); assert.equal(y.noun, 'dial time');
  assert.equal(yesterdayMiss({ blocks: starter(), dayRecords: [...recs, { id: '2026-09-08|ack', kind: 'ack', day: '2026-09-08', updatedAt: 'x', deletedAt: null }], settings: DEFAULT_SETTINGS, tz: CHI, now }).hidden, true);
  assert.equal(yesterdayMiss({ blocks: starter(), dayRecords: [...recs, doneRec('blk_0000000', 'done', '2026-09-08')], settings: DEFAULT_SETTINGS, tz: CHI, now }).hidden, true);
  const week = weeklyNotDone({ blocks: starter(), dayRecords: [...recs, ...allDone('2026-09-06'), owedRec(20, {}, '2026-09-05', { deletedAt: 'x' }), ...allDone('2026-09-05')], settings: { ...DEFAULT_SETTINGS, activeDays: [0, 1, 2, 3, 4, 5, 6] }, tz: CHI, now });
  assert.deepEqual(week.days.map(d => d.day), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
  assert.equal(week.days[6].minutes, 120); assert.equal(week.days[5].minutes, 0); assert.equal(week.days[4].minutes, 0);
  assert.equal(week.days[0].minutes, 495); // never opened → whole routine
  assert.equal(week.total, 495 * 4 + 120);
});

test('composeDay/findMakeupSlot scope done/skip records and make-ups to `today` (a day-2 bug class, same as nowState)', () => {
  const doneYesterday = compose({ dayRecords: [{ kind: 'done', blockId: DIAL_AM, status: 'done', day: '2026-09-07', deletedAt: null }] });
  assert.deepEqual(doneYesterday.items.filter(i => i.blockId === DIAL_AM).map(i => i.done), [null]);

  const withYesterdaySkip = findMakeupSlot({ live: starter(), appointments: [], makeups: [], dayRecords: [{ kind: 'done', blockId: FU_AM, status: 'skipped', day: '2026-09-07', deletedAt: null }], makeupMin: 60, nowMin: 582, today: TODAY });
  const noRecords = findMakeupSlot({ live: starter(), appointments: [], makeups: [], dayRecords: [], makeupMin: 60, nowMin: 582, today: TODAY });
  assert.notDeepEqual(withYesterdaySkip, { startMin: 720, endMin: 780 }); // yesterday's skip must not free today's block
  assert.deepEqual(withYesterdaySkip, noRecords);

  const stale = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_y', 750, 30, { day: '2026-09-07' })] });
  assert.equal(stale.recovered, 0); assert.equal(stale.unrecovered, 30);
  assert.deepEqual(stale.items.filter(i => i.kind === 'makeup'), []);
});

test('composeDay: MIN_SEG boundary (9 survives-dropped vs 10 survives) and the 40px marker boundary (39 rejects, 40 accepts, else falls to the following segment)', () => {
  const exactlyTen = compose({ appointments: [ap('a', 520)] }); // head cut leaves exactly a 10-min (MIN_SEG) piece
  assert.deepEqual(segsOf(exactlyTen, DIAL_AM), [[510, 520], [550, 630]]);
  assert.equal(exactlyTen.displacedByBlock[DIAL_AM], 30);

  const exactlyForty = compose({ appointments: [ap('a', 530)] }); // preceding segment is exactly 20 min = 40px, right at the marker threshold
  assert.deepEqual(segsOf(exactlyForty, DIAL_AM), [[510, 530], [560, 630]]);
  assert.deepEqual(exactlyForty.markers.filter(m => m.blockId === DIAL_AM).map(m => [m.minutes, m.segmentIndex]), [[30, 0]]);

  const precedingTooSmall = compose({ appointments: [ap('a', 525, 30)] }); // preceding segment is 15 min = 30px (< 40) → rejected; following (75 min) qualifies
  assert.deepEqual(segsOf(precedingTooSmall, DIAL_AM), [[510, 525], [555, 630]]);
  assert.deepEqual(precedingTooSmall.markers.filter(m => m.blockId === DIAL_AM).map(m => [m.minutes, m.segmentIndex]), [[30, 1]]);
});

test('composeDay: Math.max(0, …) clamps (a make-up with no active appointment recovers with nothing to offset; an accepted decision cannot go negative)', () => {
  const idleMakeup = compose({ makeups: [mk('mk_0000001', 750, 30)] }); // no appointments at all → nothing displaced, but the make-up still "recovers"
  assert.equal(idleMakeup.recovered, 30); assert.equal(idleMakeup.unrecovered, 0);

  const day = '2026-09-08';
  const proj = (u) => ({ unrecovered: u, displacedByBlock: u ? { a: u } : {} });
  const overshoot = applyOwedDecision(null, 'accept', { projected: proj(7), realized: proj(7), makeupMin: 10, nowIso: T0, day }); // makeupMin(10) > projected(7)
  assert.equal(overshoot.decidedMinutes, 0);
  assert.equal(offerState(overshoot, proj(0)).offerOpen, false);
});

test('composeDay: overlapping make-ups render once and recover once (priority = updatedAt asc, id asc, same tie-break as resolveOverlaps); a partial overlap recovers the union', () => {
  const dup = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000001', 750, 30), mk('mk_0000002', 750, 30)] });
  assert.equal(dup.recovered, 30); assert.equal(dup.unrecovered, 0);
  const dupMakeupItems = dup.items.filter(i => i.kind === 'makeup');
  assert.equal(dupMakeupItems.length, 1);
  assert.ok(dupMakeupItems[0].id.startsWith('mk_0000001#')); // lower id wins the tie, mk_0000002 is fully absorbed

  const partial = compose({ appointments: [ap('a', 540, 60)], makeups: [mk('mk_0000001', 750, 30), mk('mk_0000002', 765, 30)] }); // 60-min appt displaces DIAL_AM by 60
  assert.equal(partial.displacedByBlock[DIAL_AM], 60);
  assert.equal(partial.recovered, 45); // union of [750,780) and [765,795) is 45 unique minutes, not 60
});

const mkSegsOf = (r, id) => r.items.filter(i => i.kind === 'makeup' && i.makeupId === id).map(i => [i.startMin, i.endMin]);

test('composeDay: make-up MIN_SEG boundaries mirror the block ones (a sub-10 head is dropped and still counted; a surviving tail renders)', () => {
  const head = compose({ appointments: [ap('a', 740)], makeups: [mk('mk_0000001', 750, 30)] }); // appt 740–770 leaves exactly a 10-min tail
  assert.equal(head.recovered, 10); assert.equal(head.displacedByMakeup['mk_0000001'], 20);
  assert.deepEqual(mkSegsOf(head, 'mk_0000001'), [[770, 780]]);

  const overlap = compose({ makeups: [mk('mk_0000001', 750, 30), mk('mk_0000002', 770, 20)] }); // mk_0000002 overlaps mk_0000001's tail by 10 min
  assert.equal(overlap.recovered, 40);
  assert.deepEqual(mkSegsOf(overlap, 'mk_0000002'), [[780, 790]]);
});

test('composeDay: following-segment marker at the exact 40px boundary (20-min following segment)', () => {
  const r = compose({ appointments: [ap('a', 525, 85)] });
  assert.deepEqual(segsOf(r, DIAL_AM), [[510, 525], [610, 630]]);
  assert.deepEqual(r.markers.filter(m => m.blockId === DIAL_AM).map(m => [m.minutes, m.segmentIndex]), [[85, 1]]);
});

test('findMakeupSlot: a make-up from a different day never blocks a slot (same day-scoping as the done/skip records)', () => {
  const slot = findMakeupSlot({ live: starter(), appointments: [ap('a', 540)], makeups: [mk('mk_y', 750, 30, { day: '2026-09-07' })], makeupMin: 30, nowMin: 582, today: TODAY });
  assert.deepEqual(slot, { startMin: 750, endMin: 780 });
});

test('composeDay: priorMk accumulates from the appointment-cut (keptA) segments, not the full span — a dropped sub-MIN_SEG remnant cannot cut a later make-up', () => {
  // appt 745–775 leaves mk_0000001 (750–780) a 5-min remnant [775,780) — dropped (< MIN_SEG) and
  // unrendered. If priorMk used the FULL span [750,780) instead, mk_0000002 (775–805) would lose
  // its own first 5 minutes to a segment nobody ever draws (the bug this fix corrects).
  const r = compose({ appointments: [ap('a', 745, 30)], makeups: [mk('mk_0000001', 750, 30), mk('mk_0000002', 775, 30)] });
  assert.equal(r.recovered, 30);
  assert.equal(r.displacedByMakeup['mk_0000001'], 30);
  assert.deepEqual(mkSegsOf(r, 'mk_0000001'), []);
  assert.deepEqual(mkSegsOf(r, 'mk_0000002'), [[775, 805]]);
});

test('composeDay: item ordering and the 1440-minute clamp', () => {
  // NOTE: composeDay's own cutting algorithm makes a segment/appt startMin tie structurally
  // unreachable — any appointment overlapping a block's boundary consumes that boundary before
  // a shared start can render, and abutting appointments merge in apptCuts before cutting. Verified
  // by direct execution: with the default starter template, ap('a', 510) puts the review block's
  // segment (480–510, untouched) at items[0], not the appt — the appt is simply the only
  // item that ever starts at 510 (DIAL_AM's head is fully consumed). The comparator fix (§ item 3)
  // is defensive/order-stable, matching resolveOverlaps' style, rather than independently observable
  // through composeDay's output. Pinning the true, verified behavior here instead.
  const atStart = compose({ appointments: [ap('a', 510)] });
  const at510 = atStart.items.filter(i => i.startMin === 510);
  assert.equal(at510.length, 1);
  assert.equal(at510[0].kind, 'appt');

  const clamped = compose({ appointments: [ap('a', 1425, 30)] });
  assert.equal(clamped.items.find(i => i.kind === 'appt').endMin, 1440);
});

test('applyOwedDecision rejects an unknown decision', () => {
  const proj = (u) => ({ unrecovered: u, displacedByBlock: u ? { a: u } : {} });
  assert.throws(() => applyOwedDecision(null, 'bogus', { projected: proj(10), realized: proj(10), makeupMin: 10, nowIso: T0, day: '2026-09-08' }), TypeError);
});

test('part A pins: cross-day appt records never suppress; attach only on appt blocks; tombstoned attach ignored; hh/mm range; 7-day "new" window; apptRecordId', () => {
  const yday = { ...frozen('a', 600), day: '2026-09-07', id: apptRecordId('2026-09-07', 'a', 600) };
  const cross = ta({ prospectRows: [p('a')], dayRecords: [yday] });
  assert.equal(cross.length, 1); assert.equal(cross[0].frozen, false);
  assert.deepEqual(ta({ blocks: [blk('w', 600, { category: 'dial' })], dayRecords: [attach('w', 'a')] }), []);
  assert.deepEqual(ta({ blocks: [blk('w', 600)], dayRecords: [attach('w', 'a', { deletedAt: 'x' })] }), []);
  assert.equal(parseAppointmentTime('2026-09-08T25:00', CHI), null);
  assert.equal(parseAppointmentTime('2026-09-08T10:60', CHI), null);
  assert.equal(apptRecordId('2026-09-08', 'p1', 600), '2026-09-08|appt|p1|600');
  const mk7 = (id, createdAt) => ({ id, name: 'N' + id, stage: 'FOLLOWUP_LATER', archivedAt: null, lastContact: '', createdAt });
  const sixDays = new Date(NOW - (6 * 24 + 23) * 3600000).toISOString();
  const eightDays = new Date(NOW - (7 * 24 + 1) * 3600000).toISOString();
  // DEVIATION from task spec text: the literal spec asserted ['new', '—'], but sixDays (167h
  // ago) is chronologically LATER than eightDays (169h ago), so under the pre-existing,
  // already-pinned createdAt-ascending tie-break (see the 'createdAt asc' test above, unchanged),
  // eightDays ('b') sorts first. Verified independently in Node outside this module; part A's
  // sort is correct and untouched. Flagged for the operator to confirm.
  assert.deepEqual(followupQueue([mk7('a', sixDays), mk7('b', eightDays)], ['FOLLOWUP_LATER'], CHI, NOW).map(r => r.age), ['—', 'new']);
});

// ---------------- rev-11: one-off events (spec 2026-09-07 §4b, §7h.3) ----------------
// An event is a DAY RECORD (routine_day_v1), never a block: it must never be able to
// reach routine_blocks_v1 or trigger resolveOverlaps' rearrangement of the template.
// composeDay proves this at the pure-function boundary — the `live` blocks argument
// passed in must come back byte-identical, because composeDay never returns (and a
// caller therefore never persists) a mutated copy of it.
const evt = (id, startMin, durationMin, o = {}) => ({ id, kind: 'event', day: TODAY, startMin, durationMin, name: 'Call Jane back', remind: { enabled: true, minutesBefore: 5 }, updatedAt: 'x', deletedAt: null, ...o });

test('composeDay: an event displaces a routine block exactly like an appointment (tail cut) and never mutates the live block records it is given', () => {
  const liveSnapshot = starter();
  const before = starter(); // a fresh, independently-built reference — deep-equal, not the same object
  assert.deepEqual(liveSnapshot, before);
  const tail = composeDay({ live: liveSnapshot, appointments: [], makeups: [], events: [evt('ev_0000001', 600, 30)], dayRecords: [], nowMin: 582, today: TODAY });
  assert.deepEqual(segsOf(tail, DIAL_AM), [[510, 600]]);
  assert.deepEqual(tail.displacedByBlock, { [DIAL_AM]: 30 });
  assert.equal(tail.unrecovered, 30);
  // the whole point of the feature: routine_blocks_v1's would-be payload is untouched
  assert.deepEqual(liveSnapshot, before);
});

test('composeDay: event displacement mirrors appointment displacement exactly — head, mid, and whole-block eaten', () => {
  const headA = compose({ appointments: [ap('a', 510)] });
  const headE = compose({ events: [evt('ev_h', 510, 30)] });
  assert.deepEqual(segsOf(headE, DIAL_AM), segsOf(headA, DIAL_AM));
  assert.deepEqual(headE.displacedByBlock, headA.displacedByBlock);

  const midA = compose({ appointments: [ap('a', 540)] });
  const midE = compose({ events: [evt('ev_m', 540, 30)] });
  assert.deepEqual(segsOf(midE, DIAL_AM), segsOf(midA, DIAL_AM));
  assert.deepEqual(midE.displacedByBlock, midA.displacedByBlock);

  const wholeA = compose({ appointments: [ap('a', 510, 120)] });
  const wholeE = compose({ events: [evt('ev_w', 510, 120)] });
  assert.deepEqual(segsOf(wholeE, DIAL_AM), []);
  assert.equal(wholeE.displacedByBlock[DIAL_AM], 120);
  assert.deepEqual(wholeE.displacedByBlock, wholeA.displacedByBlock);
});

test('composeDay: an event and an overlapping appointment join the SAME displacing-cut union (counted once, like two overlapping appointments)', () => {
  // appointment 10:00–10:20 + event 10:10–10:40 → union 10:00–10:40 (40 min) cuts the same
  // way a single 40-min displacing interval would — not 20+30=50.
  const r = compose({ appointments: [ap('a', 600, 20)], events: [evt('ev_0000002', 610, 30)] });
  assert.deepEqual(segsOf(r, DIAL_AM), [[510, 600]]);
  assert.equal(r.displacedByBlock[DIAL_AM], 30);
});

test('composeDay: events render as their own item kind, scoped to today, tombstones dropped, end clamped to 1440, and raise a loss marker like an appointment', () => {
  const r = compose({ events: [evt('ev_0000003', 600, 30)] });
  const evItems = r.items.filter(i => i.kind === 'event');
  assert.equal(evItems.length, 1);
  assert.deepEqual([evItems[0].id, evItems[0].startMin, evItems[0].endMin, evItems[0].name], ['ev_0000003', 600, 630, 'Call Jane back']);
  assert.deepEqual(r.markers.filter(m => m.blockId === DIAL_AM).map(m => [m.minutes, m.segmentIndex]), [[30, 0]]);

  const otherDay = compose({ events: [evt('ev_0000004', 600, 30, { day: '2026-09-07' })] });
  assert.deepEqual(otherDay.items.filter(i => i.kind === 'event'), []);
  assert.equal(otherDay.unrecovered, 0);

  const tombstoned = compose({ events: [evt('ev_0000005', 600, 30, { deletedAt: 'x' })] });
  assert.deepEqual(tombstoned.items.filter(i => i.kind === 'event'), []);
  assert.equal(tombstoned.unrecovered, 0);

  const late = compose({ events: [evt('ev_0000006', 1425, 30)] });
  assert.equal(late.items.find(i => i.kind === 'event').endMin, 1440);
});

test('composeDay: an event cuts a live make-up for rendering, the same way an appointment does (it is a displacing interval)', () => {
  const r = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000001', 750, 30)], events: [evt('ev_0000007', 760, 10)] });
  assert.deepEqual(mkSegsOf(r, 'mk_0000001'), [[750, 760], [770, 780]]);
  assert.equal(r.displacedByMakeup['mk_0000001'], 10);
});

test('findMakeupSlot: an event counts as covered — a make-up is never offered on top of it; a different-day or tombstoned event never blocks a slot', () => {
  const live = starter();
  const slot = (o) => findMakeupSlot({ live, appointments: [ap('a', 540)], makeups: [], events: [], dayRecords: [], makeupMin: 30, nowMin: 582, today: TODAY, ...o });
  assert.deepEqual(slot(), { startMin: 750, endMin: 780 });
  // the event eats 750–780 out of the 45-min Lunch gap, leaving only three 15-min remnants
  // (630–645, 780–795, 915–930) — none reach makeupMin 30, so no slot exists anywhere
  assert.equal(slot({ events: [evt('ev_0000008', 750, 30)] }), null);
  assert.deepEqual(slot({ events: [evt('ev_0000009', 750, 30, { day: '2026-09-07' })] }), { startMin: 750, endMin: 780 });
  assert.deepEqual(slot({ events: [evt('ev_0000010', 750, 30, { deletedAt: 'x' })] }), { startMin: 750, endMin: 780 });
});
