import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickAgent, buildPayload, classifySend, retryEligible, LOOKAHEAD_SEC, GRACE_MIN } from './routineTick.mjs';
import { DEFAULT_SETTINGS, instantiateTemplate } from './routineModel.mjs';
import { STARTER_TEMPLATE } from './routineTemplates.mjs';

const CHI = 'America/Chicago';
const Z = (s) => Date.parse(s);
const T0 = '2026-09-08T12:00:00.000Z';
const starter = () => STARTER_TEMPLATE.entries.map((e, i) => ({ ...instantiateTemplate(e, { now: T0, defaultMinutesBefore: 5 }), id: 'blk_' + String(i).padStart(7, '0') }));
const DIAL_AM = 'blk_0000001';
const S = { ...DEFAULT_SETTINGS, timezone: CHI };
const run = (o) => tickAgent({ canAccess: true, settings: S, blocks: starter(), dayRecords: [], apptRows: [], logRows: [], subs: [{ endpoint: 'e' }], now: Z('2026-09-08T13:25:00Z'), readAt: '2026-09-08T13:25:00.000Z', ...o });
const keys = (r) => r.due.map(d => d.fire_key);

test('skips: not_entitled and bad_tz stop compose; disabled / no_subs stop sends only', () => {
  assert.equal(run({ canAccess: false }).skip, 'not_entitled');
  assert.equal(run({ settings: { ...S, timezone: null } }).skip, 'bad_tz');
  assert.equal(run({ settings: { ...S, timezone: 'Mars/Olympus' } }).skip, 'bad_tz');
  const off = run({ settings: { ...S, remindersEnabled: false } });
  assert.equal(off.skip, null); assert.equal(off.sendSkip, 'disabled'); assert.equal(off.composeEligible, true);
  const noSubs = run({ subs: [] });
  assert.equal(noSubs.sendSkip, 'no_subs'); assert.equal(noSubs.due.length, 1); // computed, not sent
});

test('lead 5: due at T−5 with the wall-clock instant; not at T−6; T+9 fires "started"; T+11 aged out; key shape', () => {
  const at = (iso) => run({ now: Z(iso), readAt: iso });
  assert.deepEqual(keys(at('2026-09-08T13:25:00Z')), [`${DIAL_AM}|2026-09-08|505|${CHI}`]);
  assert.deepEqual(keys(at('2026-09-08T13:24:10Z')), []);
  assert.deepEqual(keys(at('2026-09-08T13:24:20Z')), [`${DIAL_AM}|2026-09-08|505|${CHI}`]); // 45 s lookahead
  const late = at('2026-09-08T13:39:00Z');
  assert.equal(late.due[0].block_id, DIAL_AM); assert.equal(late.due[0].fireAt, Z('2026-09-08T13:25:00Z'));
  assert.deepEqual(keys(at('2026-09-08T13:41:00Z')), []);
});

test('lead 15 and the midnight clamp; 10-min block at T+6 aged out (half-duration grace)', () => {
  const blocks = [{ ...starter()[0], id: 'blk_early00', startMin: 5, durationMin: 10, remind: { enabled: true, minutesBefore: 15 } }];
  const r = run({ blocks, now: Z('2026-09-08T05:00:20Z'), readAt: '2026-09-08T05:00:20.000Z' });
  assert.equal(r.due[0].fireAt, Z('2026-09-08T05:00:00Z')); assert.equal(r.due[0].fireMin, 0);
  assert.deepEqual(keys(run({ blocks, now: Z('2026-09-08T05:11:00Z') })), []);
});

test('activeDays: inactive day → no routine candidates but appointments still remind and freeze', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T08:30', archivedAt: null }];
  const r = run({ settings: { ...S, activeDays: [] }, apptRows: rows });
  assert.deepEqual(keys(r), [`appt|p1|2026-09-08|505|${CHI}`]);
  assert.equal(r.due[0].block_id, 'appt:p1');
});

test('head-eaten → 8:55 for the 9:00 segment, key stable across ticks and across the freeze; whole-eaten → none', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T08:30', archivedAt: null }];
  const a = run({ apptRows: rows, now: Z('2026-09-08T13:55:00Z'), readAt: 'x' });
  assert.ok(keys(a).includes(`${DIAL_AM}|2026-09-08|535|${CHI}`));
  const frozen = [{ id: '2026-09-08|appt|p1|510', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 510, durationMin: 30, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: null }];
  const b = run({ apptRows: [], dayRecords: frozen, now: Z('2026-09-08T13:55:00Z'), readAt: 'x' });
  assert.ok(keys(b).includes(`${DIAL_AM}|2026-09-08|535|${CHI}`));
  const whole = run({ apptRows: [{ ...rows[0], appointmentTime: '2026-09-08T08:00' }], dayRecords: [{ id: '2026-09-08|appt|p1|480', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 480, durationMin: 150, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: null }], now: Z('2026-09-08T13:25:00Z') });
  assert.equal(keys(whole).some(k => k.startsWith(DIAL_AM)), false);
});

test('already_done, already_held, make-up fires from routine_day_v1 with the default lead', () => {
  assert.equal(run({ dayRecords: [{ id: `2026-09-08|${DIAL_AM}`, kind: 'done', blockId: DIAL_AM, status: 'skipped', day: '2026-09-08', updatedAt: 'x', deletedAt: null }] }).skipped.already_done, 1); // every day record carries its id — sanitizeDay drops idless rows
  const held = [{ id: '2026-09-08|appt|p1|510', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 510, durationMin: 30, source: 'derived', heldAt: 'x', updatedAt: 'x', deletedAt: null }];
  const h = run({ dayRecords: held, now: Z('2026-09-08T13:26:00Z') });
  assert.equal(h.skipped.already_held, 1);
  const mk = [{ id: 'mk_0000001', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 30, category: 'dial', name: 'Dial block (make-up)', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null }];
  const m = run({ dayRecords: mk, now: Z('2026-09-08T17:25:00Z') });
  assert.deepEqual(keys(m), [`mk_0000001|2026-09-08|745|${CHI}`]);
});

test('un-attached appt placeholder reminds name-free; attached → no routine candidate; attached with empty appointmentTime → one appt candidate', () => {
  // Drop the 13:15–15:15 Dial so a 14:00 placeholder can be live (two live blocks never overlap — resolveOverlaps would move it).
  const blocks = [...starter().filter(b => b.id !== 'blk_0000006'), { ...starter()[0], id: 'blk_webby00', name: 'Ana Diaz webby', category: 'appt', paletteId: 'webby', startMin: 840, durationMin: 60 }];
  const un = run({ blocks, now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  const c = un.due.find(d => d.block_id === 'blk_webby00');
  assert.ok(c); assert.equal(c.kind, 'placeholder');
  const pl = buildPayload(c, null, Z('2026-09-08T18:55:00Z'), 'https://app.primtracker.com');
  assert.equal(pl.title, 'PRIM'); assert.equal(pl.body, 'Appointment in 5 min'); assert.equal(pl.tag, 'routine-blk_webby00'); assert.ok(!JSON.stringify(pl).includes('Ana'));
  const att = run({ blocks, dayRecords: [{ id: '2026-09-08|attach|blk_webby00', kind: 'attach', day: '2026-09-08', blockId: 'blk_webby00', prospectId: 'p9', updatedAt: 'x', deletedAt: null }], now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  assert.deepEqual(keys(att), [`appt|p9|2026-09-08|835|${CHI}`]);
});

test('"then an appointment at 10:00" when the next item is an appointment or an appt block; routine copy variants', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T10:30', archivedAt: null, name: 'Ana' }];
  const r = run({ apptRows: rows, now: Z('2026-09-08T13:25:00Z'), readAt: 'x' });
  const dial = r.due.find(d => d.block_id === DIAL_AM);
  const p = buildPayload(dial, dial.next, Z('2026-09-08T13:25:00Z'), 'https://app.primtracker.com');
  assert.equal(p.title, 'Dial block starts in 5 min');
  assert.equal(p.body, '8:30–10:30 · then an appointment at 10:30');
  assert.equal(p.url, 'https://app.primtracker.com/?view=routine'); assert.equal(p.tag, `routine-${DIAL_AM}`); assert.equal(p.urgent, false);
  const now = buildPayload({ ...dial, startAt: Z('2026-09-08T13:25:00Z') }, null, Z('2026-09-08T13:25:10Z'), 'x');
  assert.equal(now.title, 'Dial block starts now');
  const ago = buildPayload({ ...dial, startAt: Z('2026-09-08T13:16:00Z') }, { kind: 'segment', name: 'Break', startMin: 630 }, Z('2026-09-08T13:25:00Z'), 'x');
  assert.equal(ago.title, 'Dial block started 9 min ago'); assert.equal(ago.body, '8:30–10:30 · then Break at 10:30');
  assert.ok(!JSON.stringify(p).includes('Ana'));
  const r2 = run({ apptRows: rows, now: Z('2026-09-08T15:25:00Z'), readAt: 'x' });
  const apCandidate = r2.due.find(d => d.block_id === 'appt:p1');
  assert.ok(apCandidate);
  const ap = buildPayload(apCandidate, null, Z('2026-09-08T15:25:00Z'), 'x');
  assert.equal(ap.body, 'Appointment in 5 min'); assert.equal(ap.tag, 'appt-p1');
});

test('cooldown on instants, and slot sets absorb placeholder ↔ attached transitions', () => {
  const now = Z('2026-09-08T13:25:00Z');
  const row = (block_id, fire_key, fire_at_utc, status = 'sent') => ({ block_id, fire_key, fire_at_utc, status });
  // Dial moved 8:30→8:45 (fireMin 505→520): 15 min apart → absorbed; 8:30→10:30 → 120 → re-arms
  const moved = starter().map(b => b.id === DIAL_AM ? { ...b, startMin: 525 } : b);
  const a = run({ blocks: moved, logRows: [row(DIAL_AM, `${DIAL_AM}|2026-09-08|505|${CHI}`, '2026-09-08T13:25:00Z')], now: Z('2026-09-08T13:40:00Z'), readAt: 'x' });
  assert.equal(a.skipped.cooldown, 1);
  const far = starter().map(b => b.id === DIAL_AM ? { ...b, startMin: 630 } : b).filter(b => b.id !== 'blk_0000002');
  const b = run({ blocks: far, logRows: [row(DIAL_AM, `${DIAL_AM}|2026-09-08|505|${CHI}`, '2026-09-08T13:25:00Z')], now: Z('2026-09-08T15:25:00Z'), readAt: 'x' });
  assert.equal(b.skipped.cooldown, 0); assert.ok(keys(b).includes(`${DIAL_AM}|2026-09-08|625|${CHI}`));
  const blocks = [...starter().filter(b => b.id !== 'blk_0000006'), { ...starter()[0], id: 'blk_webby00', name: 'Webby', category: 'appt', paletteId: 'webby', startMin: 840, durationMin: 60 }]; // no overlap with the afternoon Dial
  const attachRec = { id: '2026-09-08|attach|blk_webby00', kind: 'attach', day: '2026-09-08', blockId: 'blk_webby00', prospectId: 'p9', updatedAt: 'x', deletedAt: null };
  // attached push sent at 13:55; Remove-from-today at 14:05 → placeholder candidate absorbed
  const removed = run({ blocks, dayRecords: [{ ...attachRec, deletedAt: 'y' }, { id: '2026-09-08|appt|p9|840', kind: 'appt', day: '2026-09-08', prospectId: 'p9', startMin: 840, durationMin: 60, source: 'attached', heldAt: null, updatedAt: 'x', deletedAt: 'y' }], logRows: [row('appt:p9', `appt|p9|2026-09-08|835|${CHI}`, '2026-09-08T18:55:00Z')], now: Z('2026-09-08T19:05:00Z'), readAt: 'x' });
  assert.equal(removed.skipped.cooldown, 1); assert.equal(keys(removed).some(k => k.startsWith('blk_webby00')), false);
  // placeholder push at 13:55; attach at 13:57 → attached candidate absorbed
  const attachedAfter = run({ blocks, dayRecords: [attachRec], logRows: [row('blk_webby00', `blk_webby00|2026-09-08|835|${CHI}`, '2026-09-08T18:55:00Z')], now: Z('2026-09-08T18:57:00Z'), readAt: 'x' });
  assert.equal(attachedAfter.skipped.cooldown, 1);
  // attached push at 13:55; Detach at 13:57 → the placeholder's own candidate is absorbed
  const detached = run({ blocks, dayRecords: [{ ...attachRec, deletedAt: 'y' }], logRows: [row('appt:p9', `appt|p9|2026-09-08|835|${CHI}`, '2026-09-08T18:55:00Z')], now: Z('2026-09-08T18:57:00Z'), readAt: 'x' });
  assert.equal(detached.skipped.cooldown, 1);
  // attach at 10:30 for a 14:00 block → fires normally at 13:55
  const early = run({ blocks, dayRecords: [attachRec], logRows: [], now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  assert.ok(keys(early).includes(`appt|p9|2026-09-08|835|${CHI}`));
});

test('DST pins (spec §6c): endAt/fireAt are instant offsets from a zonedTimeToUtc start', () => {
  const NY = 'America/New_York', SN = { ...S, timezone: NY };
  const b = (startMin, lead = 5) => [{ ...starter()[0], id: 'blk_dst0000', startMin, durationMin: 30, remind: { enabled: true, minutesBefore: lead } }];
  const a = run({ settings: SN, blocks: b(150), now: Z('2026-03-08T07:25:00Z'), readAt: 'x' }).due[0]; // 02:30 NY in the spring gap
  assert.deepEqual([a.fireAt, a.startAt, a.endAt], [Z('2026-03-08T07:25:00Z'), Z('2026-03-08T07:30:00Z'), Z('2026-03-08T08:00:00Z')]);
  assert.equal(run({ settings: SN, blocks: b(180), now: Z('2026-03-08T06:55:00Z'), readAt: 'x' }).due[0].fireAt, Z('2026-03-08T06:55:00Z'));
  assert.equal(run({ settings: SN, blocks: b(120), now: Z('2026-11-01T06:55:00Z'), readAt: 'x' }).due[0].fireAt, Z('2026-11-01T06:55:00Z'));
});

test('a 23:50 10-min block seen at 00:03 has ended; there is no previous-day pass', () => {
  const late = [{ ...starter()[0], id: 'blk_late000', startMin: 1430, durationMin: 10, remind: { enabled: true, minutesBefore: 5 } }];
  assert.equal(run({ blocks: late, now: Z('2026-09-09T05:03:00Z'), readAt: 'x' }).due.length, 0);
});

test('freeze: first tick writes appt (updatedAt = start instant, no expect) + owed (updatedAt = readAt, expect null); second tick nothing; later collision refreshes minutes with expect; cancelled-before-start never counts', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T09:00', archivedAt: null }];
  const t1 = run({ apptRows: rows, now: Z('2026-09-08T14:00:30Z'), readAt: '2026-09-08T14:00:05.000Z' });
  assert.equal(t1.freezeRecords.length, 2);
  const appt = t1.freezeRecords.find(r => r.kind === 'appt');
  assert.equal(appt.id, '2026-09-08|appt|p1|540'); assert.equal(appt.updatedAt, new Date(Z('2026-09-08T14:00:00Z')).toISOString()); assert.equal('expect' in appt, false); assert.equal(appt.heldAt, null);
  const owed = t1.freezeRecords.find(r => r.kind === 'owed');
  assert.deepEqual([owed.minutes, owed.status, owed.updatedAt, owed.expect], [30, 'open', '2026-09-08T14:00:05.000Z', null]);
  const stored = [ { ...appt }, { ...owed, expect: undefined } ].map(r => { const c = { ...r }; delete c.expect; return c; });
  const t2 = run({ apptRows: rows, dayRecords: stored, now: Z('2026-09-08T14:01:30Z'), readAt: 'x' });
  assert.equal(t2.freezeRecords.length, 0);
  const reordered = stored.map(r => r.kind === 'owed' ? { ...r, byBlock: Object.fromEntries(Object.entries(r.byBlock).reverse()) } : r);
  assert.equal(run({ apptRows: rows, dayRecords: reordered, now: Z('2026-09-08T14:01:30Z'), readAt: 'x' }).freezeRecords.length, 0);
  const rows2 = [...rows, { id: 'p2', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T13:30', archivedAt: null }];
  const t3 = run({ apptRows: rows2, dayRecords: stored, now: Z('2026-09-08T18:30:30Z'), readAt: '2026-09-08T18:30:05.000Z' });
  const owed2 = t3.freezeRecords.find(r => r.kind === 'owed');
  assert.deepEqual([owed2.minutes, owed2.expect, owed2.updatedAt], [60, owed.updatedAt, '2026-09-08T18:30:05.000Z']);
  const decided = stored.map(r => r.kind === 'owed' ? { ...r, status: 'skipped', decidedAt: 'd', decidedMinutes: 30, updatedAt: 'D' } : r);
  const t4 = run({ apptRows: rows2, dayRecords: decided, now: Z('2026-09-08T18:30:30Z'), readAt: 'r' });
  const o4 = t4.freezeRecords.find(r => r.kind === 'owed');
  assert.deepEqual([o4.status, o4.decidedMinutes, o4.expect, o4.minutes], ['skipped', 30, 'D', 60]);
  const future = run({ apptRows: [{ ...rows[0], appointmentTime: '2026-09-08T14:00' }], now: Z('2026-09-08T14:00:30Z'), readAt: 'x' });
  assert.equal(future.freezeRecords.length, 0);
});

test('a frozen (tombstoned) id is never re-frozen; reminders off + no subs still freeze', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T09:00', archivedAt: null }];
  const tomb = [{ id: '2026-09-08|appt|p1|540', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 540, durationMin: 30, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: 'y' }];
  assert.equal(run({ apptRows: rows, dayRecords: tomb, now: Z('2026-09-08T14:05:00Z'), readAt: 'x' }).freezeRecords.length, 0);
  const off = run({ apptRows: rows, settings: { ...S, remindersEnabled: false }, subs: [], now: Z('2026-09-08T14:00:30Z'), readAt: 'x' });
  assert.equal(off.freezeRecords.length, 2); assert.equal(off.sendSkip, 'disabled');
});

test('Wisconsin vs Florida same 8:30 → different instants and keys', () => {
  const wi = run({ now: Z('2026-09-08T13:25:00Z') }).due[0];
  const fl = run({ settings: { ...S, timezone: 'America/New_York' }, now: Z('2026-09-08T12:25:00Z'), readAt: 'x' }).due[0];
  assert.equal(wi.fireAt - fl.fireAt, 3600000); assert.notEqual(wi.fire_key, fl.fire_key);
});

test('classifySend + retryEligible', () => {
  assert.deepEqual(classifySend({ sentCount: 1, failures: [] }), { status: 'sent', attempts: 1, error: null });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 503 }] }), { status: 'failed', attempts: 1, error: '503' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 400 }] }), { status: 'failed', attempts: 2, error: '400' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [], allDead: true }), { status: 'failed', attempts: 1, error: 'all_subs_dead' });
  const now = Z('2026-09-08T13:30:00Z');
  assert.equal(retryEligible({ status: 'failed', attempts: 1, created_at: '2026-09-08T13:25:00Z' }, now), true);
  assert.equal(retryEligible({ status: 'failed', attempts: 2, created_at: '2026-09-08T13:25:00Z' }, now), false);
  assert.equal(retryEligible({ status: 'claimed', attempts: 1, created_at: '2026-09-08T13:27:30Z' }, now), true);
  assert.equal(retryEligible({ status: 'claimed', attempts: 1, created_at: '2026-09-08T13:29:00Z' }, now), false);
  assert.equal(retryEligible({ status: 'sent', attempts: 1, created_at: '2026-09-08T13:25:00Z' }, now), false);
  assert.equal(LOOKAHEAD_SEC, 45); assert.equal(GRACE_MIN, 10);
});

test('first-surviving-segment rule: a later remnant of an eaten block never re-reminds', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T09:00', archivedAt: null }];
  const r = run({ apptRows: rows, now: Z('2026-09-08T14:25:00Z'), readAt: 'x' });
  assert.equal(keys(r).some(k => k.startsWith(DIAL_AM)), false);
});

test("a candidate's own fire_key never cools itself", () => {
  const row = { block_id: DIAL_AM, fire_key: `${DIAL_AM}|2026-09-08|505|${CHI}`, fire_at_utc: '2026-09-08T13:25:00Z', status: 'claimed' };
  const r = run({ logRows: [row], now: Z('2026-09-08T13:25:00Z'), readAt: 'x' });
  assert.ok(keys(r).includes(`${DIAL_AM}|2026-09-08|505|${CHI}`));
  assert.equal(r.skipped.cooldown, 0);
});

test('claimed rows cool too, within the 15-minute band only', () => {
  const row = (block_id, fire_key, fire_at_utc, status = 'sent') => ({ block_id, fire_key, fire_at_utc, status });
  const moved = starter().map(b => b.id === DIAL_AM ? { ...b, startMin: 525 } : b);
  const a = run({ blocks: moved, logRows: [row(DIAL_AM, `${DIAL_AM}|2026-09-08|505|${CHI}`, '2026-09-08T13:25:00Z', 'claimed')], now: Z('2026-09-08T13:40:00Z'), readAt: 'x' });
  assert.equal(a.skipped.cooldown, 1);
  const b = run({ blocks: moved, logRows: [row(DIAL_AM, `${DIAL_AM}|2026-09-08|505|${CHI}`, '2026-09-08T13:24:00Z', 'claimed')], now: Z('2026-09-08T13:40:00Z'), readAt: 'x' });
  assert.equal(b.skipped.cooldown, 0);
  assert.ok(keys(b).includes(`${DIAL_AM}|2026-09-08|520|${CHI}`));
});

test('inactive day keeps attached appointments alive: compose, freeze, but no routine displacement', () => {
  const blocks = [...starter().filter(b => b.id !== 'blk_0000006'), { ...starter()[0], id: 'blk_webby00', name: 'Ana Diaz webby', category: 'appt', paletteId: 'webby', startMin: 840, durationMin: 60 }];
  const attachRec = { id: '2026-09-08|attach|blk_webby00', kind: 'attach', day: '2026-09-08', blockId: 'blk_webby00', prospectId: 'p9', updatedAt: 'x', deletedAt: null };
  const r = run({ settings: { ...S, activeDays: [] }, blocks, dayRecords: [attachRec], now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  assert.ok(keys(r).includes(`appt|p9|2026-09-08|835|${CHI}`));
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T09:00', archivedAt: null }];
  const f = run({ settings: { ...S, activeDays: [] }, apptRows: rows, now: Z('2026-09-08T14:00:30Z'), readAt: 'r' });
  assert.equal(f.freezeRecords.length, 1);
  assert.equal(f.freezeRecords[0].kind, 'appt');
  assert.equal(f.freezeRecords[0].id, '2026-09-08|appt|p1|540');
});

test('an appt-category next item in "then" copy is name-free', () => {
  const dial = run({}).due.find(d => d.block_id === DIAL_AM);
  const next = { kind: 'segment', category: 'appt', name: 'Ana Diaz webby', startMin: 840 };
  const p = buildPayload(dial, next, Z('2026-09-08T13:25:00Z'), 'x');
  assert.ok(p.body.endsWith('then an appointment at 2:00'));
  assert.ok(!JSON.stringify(p).includes('Ana'));
});

test('classifySend retry-eligible status-code boundaries; retryEligible staleness boundary', () => {
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 429 }] }), { status: 'failed', attempts: 1, error: '429' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 408 }] }), { status: 'failed', attempts: 1, error: '408' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 500 }] }), { status: 'failed', attempts: 1, error: '500' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{}] }), { status: 'failed', attempts: 1, error: 'no_status' });
  const now = Z('2026-09-08T13:30:00Z');
  assert.equal(retryEligible({ status: 'claimed', attempts: 1, created_at: '2026-09-08T13:28:00Z' }, now), true);
  assert.equal(retryEligible({ status: 'claimed', attempts: 1, created_at: '2026-09-08T13:28:01Z' }, now), false);
});

test('make-up lead follows settings.defaultMinutesBefore; midnight clamp applies to make-ups too', () => {
  const mk = [{ id: 'mk_0000001', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 30, category: 'dial', name: 'Dial block (make-up)', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null }];
  const m = run({ settings: { ...S, defaultMinutesBefore: 10 }, dayRecords: mk, now: Z('2026-09-08T17:20:00Z'), readAt: 'x' });
  assert.deepEqual(keys(m), [`mk_0000001|2026-09-08|740|${CHI}`]);
  const early = [{ id: 'mk_0000002', kind: 'makeup', day: '2026-09-08', startMin: 3, durationMin: 20, category: 'dial', name: 'Early make-up', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null }];
  const e = run({ settings: { ...S, defaultMinutesBefore: 15 }, dayRecords: early, now: Z('2026-09-08T05:00:20Z'), readAt: 'x' });
  assert.equal(e.due[0].fireMin, 0);
  assert.equal(e.due[0].fireAt, Z('2026-09-08T05:00:00Z'));
});

test('done status also counts as already_done', () => {
  const r = run({ dayRecords: [{ id: `2026-09-08|${DIAL_AM}`, kind: 'done', blockId: DIAL_AM, status: 'done', day: '2026-09-08', updatedAt: 'x', deletedAt: null }] });
  assert.equal(r.skipped.already_done, 1);
});

test('an attached block never emits a placeholder, even once its appointment is frozen', () => {
  const blocks = [...starter().filter(b => b.id !== 'blk_0000006'), { ...starter()[0], id: 'blk_webby00', name: 'Webby', category: 'appt', paletteId: 'webby', startMin: 840, durationMin: 60 }];
  const attachRec = { id: '2026-09-08|attach|blk_webby00', kind: 'attach', day: '2026-09-08', blockId: 'blk_webby00', prospectId: 'p9', updatedAt: 'x', deletedAt: null };
  const frozen = { id: '2026-09-08|appt|p9|840', kind: 'appt', day: '2026-09-08', prospectId: 'p9', startMin: 840, durationMin: 30, source: 'attached', heldAt: null, updatedAt: 'x', deletedAt: null };
  const r = run({ blocks, dayRecords: [attachRec, frozen], now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  // The 870-900 remnant's fireAt is 14:25 local, so at 13:55 it isn't due
  // regardless of the attachedLive guard — assert on candidates (built before
  // the due-window filter) so this actually exercises the guard.
  assert.equal(r.candidates.some(c => c.block_id === 'blk_webby00'), false);
  assert.ok(keys(r).includes(`appt|p9|2026-09-08|835|${CHI}`));
});

// ---------------- rev-11: one-off events (spec 2026-09-07 §4b, §6b, §7h.3) ----------------
test('event reminder: fires at its OWN remind.minutesBefore even when settings.defaultMinutesBefore differs; disabled remind produces no candidate', () => {
  const events = [{ id: 'ev_0000001', kind: 'event', day: '2026-09-08', startMin: 750, durationMin: 30, name: 'Pay estimated taxes', remind: { enabled: true, minutesBefore: 0 }, updatedAt: 'x', deletedAt: null }];
  // fireMin = 750 − 0 = 750 = 12:30 CHI = 17:30 UTC — not settings.defaultMinutesBefore's 15
  const r = run({ settings: { ...S, defaultMinutesBefore: 15 }, dayRecords: events, now: Z('2026-09-08T17:30:00Z'), readAt: 'x' });
  assert.deepEqual(keys(r), [`ev_0000001|2026-09-08|750|${CHI}`]);
  assert.equal(r.due[0].kind, 'event');
  assert.equal(r.due[0].name, 'Pay estimated taxes');

  const off = [{ id: 'ev_0000002', kind: 'event', day: '2026-09-08', startMin: 750, durationMin: 30, name: 'No reminder wanted', remind: { enabled: false, minutesBefore: 5 }, updatedAt: 'x', deletedAt: null }];
  assert.deepEqual(keys(run({ dayRecords: off, now: Z('2026-09-08T17:25:00Z'), readAt: 'x' })), []);
});

test('event push copy carries its own name — it is NOT routed through the name-free appt branch', () => {
  const events = [{ id: 'ev_0000003', kind: 'event', day: '2026-09-08', startMin: 750, durationMin: 30, name: 'Client callback — Diaz', remind: { enabled: true, minutesBefore: 5 }, updatedAt: 'x', deletedAt: null }];
  const r = run({ dayRecords: events, now: Z('2026-09-08T17:25:00Z'), readAt: 'x' });
  const c = r.due.find((d) => d.block_id === 'ev_0000003');
  assert.ok(c); assert.equal(c.kind, 'event');
  const p = buildPayload(c, null, Z('2026-09-08T17:25:00Z'), 'https://app.primtracker.com');
  assert.equal(p.title, 'Client callback — Diaz starts in 5 min');
  assert.equal(p.tag, 'routine-ev_0000003');
  assert.ok(JSON.stringify(p).includes('Diaz')); // the opposite assertion of the appt/placeholder tests — events carry no prospect data, so a name is fine
});

test('an event only realizes its displaced minutes into owed once it has actually started; a future event does not yet count (mirrors an appointment)', () => {
  const events = [{ id: 'ev_0000004', kind: 'event', day: '2026-09-08', startMin: 600, durationMin: 30, name: 'Landlord call', remind: { enabled: true, minutesBefore: 5 }, updatedAt: 'x', deletedAt: null }];
  // 9:35 CHI — before the 10:00 event starts: projected shows it, nothing realized/owed yet
  const before = run({ dayRecords: events, now: Z('2026-09-08T14:35:00Z'), readAt: '2026-09-08T14:35:00.000Z' });
  assert.ok(before.items.some((i) => i.kind === 'event' && i.id === 'ev_0000004'));
  assert.equal(before.freezeRecords.find((x) => x.kind === 'owed'), undefined);

  // 10:05 CHI — the event has started: DIAL_AM (8:30–10:30) loses its 10:00–10:30 tail, realized
  const after = run({ dayRecords: events, now: Z('2026-09-08T15:05:00Z'), readAt: '2026-09-08T15:05:00.000Z' });
  const owed = after.freezeRecords.find((x) => x.kind === 'owed');
  assert.ok(owed);
  assert.equal(owed.minutes, 30);
  assert.deepEqual(owed.byBlock, { [DIAL_AM]: 30 });
});

test('an event never displaces routine_blocks_v1 — the blocks tickAgent is given come back untouched, only dayRecords/owed change', () => {
  const events = [{ id: 'ev_0000005', kind: 'event', day: '2026-09-08', startMin: 600, durationMin: 30, name: 'Landlord call', remind: { enabled: true, minutesBefore: 5 }, updatedAt: 'x', deletedAt: null }];
  const blocksIn = starter();
  const blocksSnapshot = starter();
  assert.deepEqual(blocksIn, blocksSnapshot);
  run({ blocks: blocksIn, dayRecords: events, now: Z('2026-09-08T15:05:00Z'), readAt: 'x' });
  assert.deepEqual(blocksIn, blocksSnapshot); // tickAgent never mutates the blocks array it was handed
});

test('lead cap on "starts in" copy; readAt is required; subs must be an array', () => {
  const dial = run({}).due.find(d => d.block_id === DIAL_AM);
  assert.equal(buildPayload(dial, null, Z('2026-09-08T13:24:20Z'), 'x').title, 'Dial block starts in 5 min');
  assert.throws(() => tickAgent({ canAccess: true, settings: S, blocks: [], dayRecords: [], apptRows: [], now: Z('2026-09-08T13:25:00Z') }), TypeError);
  assert.equal(run({ subs: {} }).sendSkip, 'no_subs');
});
