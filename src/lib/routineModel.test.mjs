import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uid, dayUid, sanitizeBlocks, liveBlocks, resolveOverlaps, sanitizeDay, sanitizeSettings,
  DEFAULT_SETTINGS, seedFollowupStages, instantiateTemplate, applyTemplate,
} from './routineModel.mjs';
import { STARTER_TEMPLATE } from './routineTemplates.mjs';

const NOW = '2026-09-08T15:00:00.000Z';
const blk = (o) => ({ id: uid(), name: 'X', paletteId: 'dial', category: 'dial', startMin: 480, durationMin: 60,
  remind: { enabled: true, minutesBefore: 5 }, note: '', deletedAt: null, createdAt: NOW, updatedAt: NOW, ...o });

test('uid shapes', () => {
  assert.match(uid(), /^blk_[0-9a-z]{7}$/);
  assert.match(dayUid(), /^mk_[0-9a-z]{7}$/);
  assert.notEqual(uid(), uid());
});

test('sanitizeBlocks: drops idless, dedupes by newest updatedAt, snaps, clamps, whitelists category', () => {
  const a1 = blk({ id: 'blk_aaaaaaa', startMin: 482, durationMin: 7, updatedAt: '2026-09-08T10:00:00Z' });
  const a2 = { ...a1, name: 'newer', updatedAt: '2026-09-08T11:00:00Z' };
  const bad = blk({ id: 'blk_bbbbbbb', category: 'nope', startMin: 1430, durationMin: 60 });
  const out = sanitizeBlocks([{ name: 'no id' }, a1, a2, bad], NOW);
  assert.equal(out.length, 2);
  const a = out.find(b => b.id === 'blk_aaaaaaa');
  assert.equal(a.name, 'newer');
  assert.equal(a.startMin, 480);
  assert.equal(a.durationMin, 10);
  const b = out.find(b => b.id === 'blk_bbbbbbb');
  assert.equal(b.category, 'custom');
  assert.equal(b.startMin + b.durationMin <= 1440, true);
});

test('sanitizeBlocks retains tombstones ≤ 7 days, prunes older; liveBlocks hides them', () => {
  const live = blk({ id: 'blk_live000' });
  const fresh = blk({ id: 'blk_dead001', startMin: 600, deletedAt: '2026-09-05T00:00:00Z' });
  const old = blk({ id: 'blk_dead002', startMin: 700, deletedAt: '2026-08-20T00:00:00Z' });
  const out = sanitizeBlocks([live, fresh, old], NOW);
  assert.deepEqual(out.map(b => b.id).sort(), ['blk_dead001', 'blk_live000']);
  assert.deepEqual(liveBlocks([live, fresh, old], NOW).map(b => b.id), ['blk_live000']);
});

test('resolveOverlaps: later-updatedAt moves to the next free gap; equal stamps → greater id moves', () => {
  const a = blk({ id: 'blk_a000000', startMin: 480, durationMin: 60, updatedAt: '2026-09-08T10:00:00Z' });
  const b = blk({ id: 'blk_b000000', startMin: 500, durationMin: 30, updatedAt: '2026-09-08T11:00:00Z' });
  const { blocks } = resolveOverlaps([a, b]);
  assert.equal(blocks.find(x => x.id === 'blk_b000000').startMin, 540);
  const c = blk({ id: 'blk_c000000', startMin: 480, durationMin: 60, updatedAt: NOW });
  const d = blk({ id: 'blk_d000000', startMin: 480, durationMin: 60, updatedAt: NOW });
  const r2 = resolveOverlaps([c, d]);
  assert.equal(r2.blocks.find(x => x.id === 'blk_d000000').startMin, 540);
  assert.equal(r2.blocks.find(x => x.id === 'blk_c000000').startMin, 480);
});

test('resolveOverlaps: no gap before 1440 → shrink to the largest free gap ≥ 10; none → dropped', () => {
  const big = blk({ id: 'blk_big0000', startMin: 0, durationMin: 720, updatedAt: '2026-09-08T09:00:00Z' });
  const big2 = blk({ id: 'blk_big0001', startMin: 720, durationMin: 700, updatedAt: '2026-09-08T09:00:00Z' });
  const late = blk({ id: 'blk_late000', startMin: 700, durationMin: 60, updatedAt: '2026-09-08T12:00:00Z' });
  const r = resolveOverlaps([big, big2, late]);
  const l = r.blocks.find(x => x.id === 'blk_late000');
  assert.equal(l.startMin, 1420);
  assert.equal(l.durationMin, 20);
  const full = blk({ id: 'blk_full000', startMin: 1420, durationMin: 20, updatedAt: '2026-09-08T09:00:00Z' });
  const extra = blk({ id: 'blk_extra00', startMin: 1425, durationMin: 10, updatedAt: '2026-09-08T12:00:00Z' });
  const r3 = resolveOverlaps([big, big2, full, extra]);
  assert.deepEqual(r3.dropped, ['blk_extra00']);
  assert.ok(!r3.blocks.some(x => x.id === 'blk_extra00'));
});

test('sanitizeBlocks caps at 60 live (newest-createdAt extras tombstoned) and two live blocks never overlap', () => {
  const many = Array.from({ length: 62 }, (_, i) => blk({ id: 'blk_' + String(i).padStart(7, '0'), startMin: (i * 20) % 1400, durationMin: 10, createdAt: `2026-09-0${i < 31 ? 1 : 2}T${String(i % 24).padStart(2, '0')}:00:00Z` }));
  const out = liveBlocks(many, NOW);
  assert.equal(out.length, 60);
  const sorted = [...out].sort((x, y) => x.startMin - y.startMin);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].startMin >= sorted[i - 1].startMin + sorted[i - 1].durationMin);
});

test('sanitizeBlocks: a stale merge cannot resurrect a delete (tombstone with newer updatedAt wins the dedupe)', () => {
  const alive = blk({ id: 'blk_same000', updatedAt: '2026-09-08T10:00:00Z' });
  const dead = { ...alive, deletedAt: '2026-09-08T10:30:00Z', updatedAt: '2026-09-08T10:30:00Z' };
  assert.equal(liveBlocks([alive, dead], NOW).length, 0);
  assert.equal(liveBlocks([dead, alive], NOW).length, 0);
});

test('sanitizeDay: prunes < today−7, drops 8-day-old tombstones, clamps make-up duration, validates kinds', () => {
  const recs = [
    { id: '2026-09-08|blk_a', kind: 'done', day: '2026-09-08', blockId: 'blk_a', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null },
    { id: '2026-08-30|blk_a', kind: 'done', day: '2026-08-30', blockId: 'blk_a', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null },
    { id: 'mk_0000001', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 3, category: 'dial', name: 'Dial block (make-up)', ofBlockId: 'blk_a', updatedAt: NOW, deletedAt: null },
    { id: 'mk_0000002', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 30, category: 'dial', name: 'x', ofBlockId: 'blk_a', updatedAt: NOW, deletedAt: '2026-08-25T00:00:00Z' },
    { id: '2026-09-08|weird', kind: 'weird', day: '2026-09-08', updatedAt: NOW, deletedAt: null },
    { id: '2026-09-08|owed', kind: 'owed', day: '2026-09-08', minutes: 30, byBlock: { blk_a: 30 }, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: NOW, deletedAt: null },
    { id: 'garbage|blk_a', kind: 'done', day: 'garbage', blockId: 'blk_a', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null },
  ];
  const out = sanitizeDay(recs, '2026-09-08', NOW);
  assert.deepEqual(out.map(r => r.id).sort(), ['2026-09-08|blk_a', '2026-09-08|owed', 'mk_0000001']);
  assert.equal(out.find(r => r.id === 'mk_0000001').durationMin, 10);
});

test('sanitizeSettings + DEFAULT_SETTINGS', () => {
  assert.equal(DEFAULT_SETTINGS.timezone, null);
  assert.deepEqual(DEFAULT_SETTINGS.activeDays, [0, 1, 2, 3, 4, 5, 6]);
  const s = sanitizeSettings({ activeDays: [1, 1, 9, -1, 3], defaultMinutesBefore: 7, timezoneMode: 'weird', timezone: 'America/Chicago', appointmentStages: ['A', 'A', 5], followupStages: ['B'], remindersEnabled: 'yes', junk: 1 });
  assert.deepEqual(s.activeDays, [1, 3]);
  assert.equal(s.defaultMinutesBefore, 5);
  assert.equal(s.timezoneMode, 'auto');
  assert.equal(s.timezone, 'America/Chicago');
  assert.deepEqual(s.appointmentStages, ['A']);
  assert.equal(s.remindersEnabled, true);
  assert.equal('junk' in s, false);
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.equal(sanitizeSettings({ defaultMinutesBefore: 13 }).defaultMinutesBefore, 15);
  assert.deepEqual(sanitizeSettings({ activeDays: [] }).activeDays, []);
});

test('seedFollowupStages: defaults + follow-up-worded customs; never won/sold/not-interested; null settings → defaults', () => {
  const stages = [
    { id: 'WEBBY_SET', label: 'Webby Set' }, { id: 'MISSED_APPT', label: 'Missed Appt' }, { id: 'SOLD', label: 'Sold' },
    { id: 'STAGE_1', label: 'Expressed Interest/ Aiming APPT' },
    { id: 'STAGE_2', label: 'Try to Reengage/Get interest back' },
    { id: 'STAGE_3', label: 'Pitched / needs app' },
    { id: 'STAGE_4', label: 'Circle back Q4' },
    { id: 'STAGE_5', label: 'Check back in Jan' },
    { id: 'STAGE_6', label: 'Call back Friday' },
    { id: 'STAGE_7', label: 'No show – reschedule' },
    { id: 'STAGE_8', label: 'Re-engaged (won)' },
    { id: 'STAGE_9', label: 'Not Interested' },
    { id: 'STAGE_10', label: 'Uninterested' },
    { id: 'STAGE_11', label: 'No interest' },
    { id: 'STAGE_12', label: 'Referral source' },
    { id: 'STAGE_13', label: 'Hot lead' },
    { id: 'STAGE_14', label: 'Quoted' },
  ];
  const out = seedFollowupStages(stages);
  assert.deepEqual(out, ['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'STAGE_6', 'STAGE_7']);
  assert.deepEqual(seedFollowupStages(null), ['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION']);
});

test('instantiateTemplate fills id/category/remind/timestamps from the palette', () => {
  const b = instantiateTemplate({ paletteId: 'break', name: 'Lunch', startMin: 750, durationMin: 45 }, { now: NOW, defaultMinutesBefore: 10 });
  assert.match(b.id, /^blk_/);
  assert.equal(b.category, 'break');
  assert.deepEqual(b.remind, { enabled: false, minutesBefore: 10 });
  assert.equal(b.name, 'Lunch');
  assert.equal(b.createdAt, NOW);
  const d = instantiateTemplate({ paletteId: 'dial', startMin: 510 }, { now: NOW, defaultMinutesBefore: 5 });
  assert.equal(d.name, 'Dial block');
  assert.equal(d.durationMin, 120);
  assert.deepEqual(d.remind, { enabled: true, minutesBefore: 5 });
});

test('applyTemplate: non-empty + !replace → unchanged; empty → seeded; replace → old tombstoned + backup; undo restores', () => {
  const existing = [blk({ id: 'blk_old0000' })];
  const r1 = applyTemplate(existing, STARTER_TEMPLATE, { now: NOW, defaultMinutesBefore: 5 });
  assert.equal(r1.backup, null);
  assert.deepEqual(r1.blocks.map(b => b.id), ['blk_old0000']);
  const r2 = applyTemplate([], STARTER_TEMPLATE, { now: NOW, defaultMinutesBefore: 5 });
  assert.equal(liveBlocks(r2.blocks, NOW).length, 11);
  const r3 = applyTemplate(existing, STARTER_TEMPLATE, { replace: true, now: NOW, defaultMinutesBefore: 5 });
  assert.equal(r3.backup.length, 1);
  assert.equal(r3.blocks.find(b => b.id === 'blk_old0000').deletedAt, NOW);
  assert.equal(liveBlocks(r3.blocks, NOW).length, 11);
  const restored = sanitizeBlocks(r3.backup.map(b => ({ ...b, updatedAt: '2026-09-08T16:00:00Z' })), NOW);
  assert.equal(liveBlocks(restored, NOW).length, 1);
});
