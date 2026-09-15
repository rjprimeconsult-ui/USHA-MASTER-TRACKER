/**
 * RoutineView (spec §7a, §7g, §7h.3, §9) — the twelve UI-lane cases of §12.
 *
 * The failure this suite exists to catch: a storage write the agent never
 * asked for. `storage.getItem` never rejects, so a failed read looks exactly
 * like an empty account — any write before `loadRoutine` resolves, any write
 * while the account is not entitled, or any echo-save of settings would
 * overwrite the cloud row with an empty routine. Every case therefore asserts
 * on the in-memory store (parsed `mem.get(key)`) and on setItem call counts
 * PER KEY, never on component internals.
 *
 * Conventions (per PendingEmailQueueRunner.test.jsx / PaywallGate.test.jsx):
 *   - storage mocked in-memory with setItem wrapped in vi.fn; useBetaFeature
 *     and push through hoisted holders; supabase stubbed.
 *   - fake timers with shouldAdvanceTime so the editor's 400 ms debounce and
 *     the 30 s clock are driven by vi.advanceTimersByTime; the clock is pinned
 *     to 2026-09-08T14:42Z = 9:42 America/Chicago (a Tuesday, CDT).
 *   - the device zone is stubbed through Intl.DateTimeFormat#resolvedOptions.
 *   - every assertion follows an `await act(async () => {})` flush.
 */
import { test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const mem = vi.hoisted(() => new Map());
const holder = vi.hoisted(() => ({
  access: { canAccess: true, reason: 'tier_match', loading: false },
  gate: null,          // a pending promise here stalls every storage read
  push: { enabled: true },
}));
const setItem = vi.hoisted(() => vi.fn(async (k, v) => { mem.set(k, v); return true; }));

vi.mock('@/lib/storage', () => ({
  storage: {
    getItem: async (k) => { if (holder.gate) await holder.gate; return mem.has(k) ? mem.get(k) : null; },
    setItem: (k, v) => setItem(k, v),
    removeItem: async (k) => { mem.delete(k); },
  },
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseConfigured: () => false,
}));
vi.mock('@/lib/push', () => ({
  pushSupported: () => true,
  pushPermission: () => 'granted',
  isPushEnabled: vi.fn(async () => holder.push.enabled),
  enablePush: vi.fn(async () => { holder.push.enabled = true; return { ok: true }; }),
}));
vi.mock('@/lib/useBetaFeature', () => ({ useBetaFeature: () => holder.access }));

import RoutineView from './RoutineView';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY, PROSPECTS_KEY, PROSPECT_SETTINGS_KEY } from '@/lib/routineKeys.mjs';
import { STARTER_TEMPLATE } from '@/lib/routineTemplates.mjs';
import { instantiateTemplate } from '@/lib/routineModel.mjs';
import { DEFAULT_PROSPECT_STAGES } from '@/lib/constants';

const NOW_ISO = '2026-09-08T14:42:00Z'; // 9:42 America/Chicago
const TODAY = '2026-09-08';
const OLD = '2026-09-01T12:00:00.000Z';

const read = (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : null);
const writes = (k) => setItem.mock.calls.filter(([key]) => key === k).length;
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => {}); };
const tick = async (ms) => { act(() => { vi.advanceTimersByTime(ms); }); await flush(); };

const noop = () => {};
const view = (p = {}) => (
  <RoutineView
    showToast={p.showToast || noop}
    prospects={p.prospects || []}
    prospectSettings={p.prospectSettings ?? null}
    onOpenProspect={p.onOpenProspect || noop}
  />
);
const mount = (p) => render(view(p));

let seq = 0;
const mk = (over = {}) => ({
  id: `blk_t${String(++seq).padStart(6, '0')}`, name: 'Dial block', paletteId: 'dial', category: 'dial',
  startMin: 480, durationMin: 60, remind: { enabled: true, minutesBefore: 5 }, note: '',
  deletedAt: null, createdAt: OLD, updatedAt: OLD, ...over,
});
const apptBlock = (over = {}) => mk({ name: 'In-person appointment', paletteId: 'inperson', category: 'appt', ...over });
const attachRec = (blockId, prospectId) => ({ id: `${TODAY}|attach|${blockId}`, kind: 'attach', day: TODAY, blockId, prospectId, updatedAt: OLD, deletedAt: null });
const doneRec = (blockId) => ({ id: `${TODAY}|${blockId}`, kind: 'done', day: TODAY, blockId, status: 'done', at: '2026-09-08T13:30:00.000Z', updatedAt: '2026-09-08T13:30:00.000Z', deletedAt: null });
const prospect = (id, name, stage, appointmentTime = '') => ({ id, name, stage, appointmentTime, archivedAt: null, lastContact: '', createdAt: OLD });
const starter = () => STARTER_TEMPLATE.entries.map((e) => instantiateTemplate(e, { now: OLD, defaultMinutesBefore: 5 }));

const seedBlocks = (blocks) => mem.set(ROUTINE_BLOCKS_KEY, JSON.stringify(blocks));
const seedDay = (recs) => mem.set(ROUTINE_DAY_KEY, JSON.stringify(recs));
const seedSettings = (s) => mem.set(ROUTINE_SETTINGS_KEY, JSON.stringify(s));
const settingsReady = () => seedSettings({ timezone: 'America/Chicago', timezoneMode: 'auto', followupStagesSeeded: true, remindersEnabled: true });

// The appointment card that carries `name` (the NowCard may echo the same name).
const cardOf = (name) => screen.getAllByText(name).map((el) => el.closest('.group')).find(Boolean);
const heldOf = (name) => within(cardOf(name)).getByRole('checkbox', { name: 'Held' });

let desktop = true;
const stubMatchMedia = () => {
  window.matchMedia = (query) => ({
    matches: query.includes('min-width: 640px') ? desktop : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
};

let tzSpy;
beforeAll(() => {
  const proto = window.Element.prototype;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});
beforeEach(() => {
  mem.clear();
  setItem.mockClear();
  holder.access = { canAccess: true, reason: 'tier_match', loading: false };
  holder.gate = null;
  holder.push.enabled = true;
  desktop = true;
  stubMatchMedia();
  // Explicit toFake: Vitest 4 fakes `Intl` by default (a mirrored fake implementation), which
  // would detach the resolvedOptions spy below from the constructor the view actually calls.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  tzSpy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolved() {
    return { ...real.call(this), timeZone: 'America/Chicago' };
  });
});
afterEach(() => {
  tzSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

test('1. zero writes before loaded; zero writes and the locked card with /pricing when canAccess === false', async () => {
  holder.access = { canAccess: false, reason: 'loading', loading: true };
  const a = mount();
  await flush();
  expect(setItem).not.toHaveBeenCalled();

  holder.access = { canAccess: false, reason: 'tier_too_low', loading: false };
  a.rerender(view());
  await flush();
  const link = screen.getByRole('link', { name: 'See plans' });
  expect(link.getAttribute('href')).toBe('/pricing');
  expect(screen.getByText('Routine is included with every PRIM plan')).toBeTruthy();
  expect(setItem).not.toHaveBeenCalled();
  a.unmount();

  // entitled, but storage has not answered yet → still nothing may be written
  let release;
  holder.gate = new Promise((r) => { release = r; });
  holder.access = { canAccess: true, reason: 'tier_match', loading: false };
  mount();
  await flush();
  expect(setItem).not.toHaveBeenCalled();
  release();
  holder.gate = null;
  await flush();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1); // the one-time zone capture, only after load
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
});

test('2. first open captures the device zone and seeds followupStages once (null prospectSettings → 3; custom "Circle back" → 4)', async () => {
  const a = mount({ prospectSettings: null });
  await flush();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1);
  let s = read(ROUTINE_SETTINGS_KEY);
  expect(s.timezone).toBe('America/Chicago');
  expect(s.timezoneMode).toBe('auto');
  expect(s.followupStagesSeeded).toBe(true);
  expect(s.followupStages).toEqual(['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION']);
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  a.unmount();

  // a second open has nothing to capture or seed → no echo write
  const b = mount({ prospectSettings: null });
  await flush();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1);
  b.unmount();

  // a fresh account whose stage list carries a follow-up-worded custom stage
  mem.clear();
  setItem.mockClear();
  mount({ prospectSettings: { stages: [...DEFAULT_PROSPECT_STAGES, { id: 'CIRCLE_BACK', label: 'Circle back', color: '#000000' }], customFields: [] } });
  await flush();
  s = read(ROUTINE_SETTINGS_KEY);
  expect(s.followupStages).toEqual(['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION', 'CIRCLE_BACK']);
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1);
});

test('3. empty routine → TemplatePicker; picking "Agent day" saves 11 live blocks to routine_blocks_v1 exactly once', async () => {
  settingsReady();
  mount();
  await flush();
  expect(screen.getByText('Agent day')).toBeTruthy();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);

  fireEvent.click(screen.getByRole('button', { name: 'Use this routine' }));
  await flush();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1);
  const blocks = read(ROUTINE_BLOCKS_KEY);
  expect(blocks.filter((b) => !b.deletedAt)).toHaveLength(11);
  expect(blocks.map((b) => b.startMin)).toEqual(STARTER_TEMPLATE.entries.map((e) => e.startMin));
  expect(blocks.every((b) => /^blk_[0-9a-z]{7}$/.test(b.id))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Use this routine' })).toBeNull(); // the canvas took over
});

test('4. a checkbox toggle writes ONE done record immediately; a rename through the editor writes once after 400 ms', async () => {
  settingsReady();
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 })]); // 10:00–11:00, upcoming at 9:42
  const { container } = mount();
  await flush();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  const day = read(ROUTINE_DAY_KEY);
  expect(day).toHaveLength(1);
  expect(day[0]).toMatchObject({ id: `${TODAY}|blk_dial01`, kind: 'done', day: TODAY, blockId: 'blk_dial01', status: 'done', deletedAt: null });

  fireEvent.click(container.querySelector('[data-item-id="blk_dial01#0"]'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls' } });
  await flush();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  await tick(400);
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1);
  expect(read(ROUTINE_BLOCKS_KEY)[0].name).toBe('Calls');
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(0);
});

test('5. never writes prospects_v1 / prospect_settings_v1; no block in routine_blocks_v1 ever carries prospectId or a prospect name', async () => {
  settingsReady();
  seedBlocks([apptBlock({ id: 'blk_appt01', startMin: 840, durationMin: 60 })]);
  const prospects = [prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET'), prospect('p2', 'Bob Reyes', 'PENDING_DECISION')];
  const { container } = mount({ prospects, prospectSettings: { stages: DEFAULT_PROSPECT_STAGES, customFields: [] } });
  await flush();

  fireEvent.click(container.querySelector('[data-item-id="blk_appt01#0"]'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meeting' } });
  await tick(400);
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1);
  fireEvent.change(screen.getByLabelText('Attach prospect (today)'), { target: { value: 'p1' } });
  await flush();
  const day = read(ROUTINE_DAY_KEY);
  expect(day.find((r) => r.kind === 'attach')).toMatchObject({ id: `${TODAY}|attach|blk_appt01`, blockId: 'blk_appt01', prospectId: 'p1', deletedAt: null });
  expect(cardOf('Ana Diaz')).toBeTruthy(); // the name is resolved at render, from props

  const keys = setItem.mock.calls.map(([k]) => k);
  expect(keys).not.toContain(PROSPECTS_KEY);
  expect(keys).not.toContain(PROSPECT_SETTINGS_KEY);
  expect(mem.has(PROSPECTS_KEY)).toBe(false);
  expect(mem.has(PROSPECT_SETTINGS_KEY)).toBe(false);
  const raw = mem.get(ROUTINE_BLOCKS_KEY);
  expect(raw).not.toMatch(/prospectId|Ana Diaz|Bob Reyes|"p1"|"p2"/);
  for (const b of read(ROUTINE_BLOCKS_KEY)) { expect('prospectId' in b).toBe(false); expect(b.name).toBe('Meeting'); }
});

test('6. at 9:42 a 9:00 APPOINTMENT_SET prospect freezes ONE appt record; ticks and a re-render never write again; a tombstoned id is never re-frozen', async () => {
  settingsReady();
  seedBlocks(starter());
  const prospects = [prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET', '2026-09-08T09:00')];
  const a = mount({ prospects });
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  let day = read(ROUTINE_DAY_KEY);
  const appt = day.filter((r) => r.kind === 'appt');
  expect(appt).toHaveLength(1);
  expect(appt[0]).toMatchObject({
    id: `${TODAY}|appt|p1|540`, day: TODAY, prospectId: 'p1', startMin: 540, durationMin: 30,
    source: 'derived', heldAt: null, deletedAt: null, updatedAt: '2026-09-08T14:00:00.000Z', // stamped at its START instant (§4b)
  });
  // the owed refresh rides the same commit: 30 min of the 8:30 Dial block
  expect(day.find((r) => r.kind === 'owed')).toMatchObject({ id: `${TODAY}|owed`, minutes: 30, status: 'open' });

  await tick(30000);
  await tick(30000);
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  a.unmount();

  const b = mount({ prospects }); // a second render over the stored records
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  b.unmount();

  setItem.mockClear();
  seedDay([{ ...appt[0], deletedAt: '2026-09-08T14:30:00.000Z', updatedAt: '2026-09-08T14:30:00.000Z' }]);
  mount({ prospects });
  await flush();
  await tick(30000);
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  expect(screen.queryByText('Ana Diaz')).toBeNull();
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'appt')).toHaveLength(1);
});

test('7. exactly one of Timeline / MobileRoutineList at the 640 px split, under one NowCard', async () => {
  settingsReady();
  seedBlocks(starter());
  desktop = true;
  const a = mount();
  await flush();
  expect(a.container.querySelectorAll('[data-routine-timeline]')).toHaveLength(1);
  expect(a.container.querySelectorAll('[data-routine-mobile]')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull();
  expect(screen.getAllByText('NOW')).toHaveLength(1);
  a.unmount();

  desktop = false;
  const b = mount();
  await flush();
  expect(b.container.querySelectorAll('[data-routine-mobile]')).toHaveLength(1);
  expect(b.container.querySelectorAll('[data-routine-timeline]')).toHaveLength(0);
  expect(screen.getByRole('button', { name: /Add block/ })).toBeTruthy();
  expect(screen.getAllByText('NOW')).toHaveLength(1);
});

test('8. Accept writes one make-up (dashed) + the owed decision with no toast; Skip → the note; removing the make-up brings the offer back', async () => {
  const blocks = starter();
  const review = blocks[0], dial = blocks[1];
  const prospects = [prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET', '2026-09-08T09:00')];
  const showToast = vi.fn();

  settingsReady();
  seedBlocks(blocks);
  seedDay([doneRec(review.id)]); // Morning review checked → no "still open" line competes with the note later
  const a = mount({ prospects, showToast });
  await flush();

  fireEvent.click(screen.getByRole('button', { name: 'Add 12:30–1:00' }));
  await flush();
  let day = read(ROUTINE_DAY_KEY);
  const mks = day.filter((r) => r.kind === 'makeup' && !r.deletedAt);
  expect(mks).toHaveLength(1);
  expect(mks[0]).toMatchObject({ day: TODAY, startMin: 750, durationMin: 30, category: 'dial', name: 'Dial block (make-up)', ofBlockId: dial.id, deletedAt: null });
  expect(mks[0].id).toMatch(/^mk_[0-9a-z]{7}$/);
  expect(day.find((r) => r.kind === 'owed')).toMatchObject({ status: 'accepted', decidedMinutes: 0, minutes: 0 }); // accepted-and-kept reads 0 (§7h.4)
  expect(showToast).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^Add \d/ })).toBeNull();

  const seg = a.container.querySelector(`[data-item-id="${mks[0].id}#0"]`);
  expect(seg).toBeTruthy();
  expect(seg.querySelector('span[aria-hidden="true"]').style.borderLeft).toContain('dashed');

  fireEvent.click(seg);
  fireEvent.click(screen.getByRole('button', { name: 'Remove make-up' }));
  await flush();
  day = read(ROUTINE_DAY_KEY);
  expect(day.find((r) => r.kind === 'makeup').deletedAt).toBeTruthy();
  expect(day.find((r) => r.kind === 'owed')).toMatchObject({ status: 'accepted', minutes: 30 });
  expect(screen.getByRole('button', { name: 'Add 12:30–1:00' })).toBeTruthy();
  expect(showToast).not.toHaveBeenCalled();
  a.unmount();

  mem.clear();
  setItem.mockClear();
  settingsReady();
  seedBlocks(blocks);
  seedDay([doneRec(review.id)]);
  mount({ prospects, showToast });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  await flush();
  expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'owed')).toMatchObject({ status: 'skipped', decidedMinutes: 30, minutes: 30 });
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  expect(screen.getByText('30m owed')).toBeTruthy();
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'makeup')).toHaveLength(0);
  expect(showToast).not.toHaveBeenCalled();
});

test('9. × on the yesterday line writes an ack record; the client owed refresh writes minutes when realized changes on the clock', async () => {
  settingsReady();
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 })]); // live yesterday (created 09-01), nothing done then
  const a = mount();
  await flush();
  expect(screen.getByText('Yesterday · 1h of dial time not done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'ack')).toMatchObject({ id: `${TODAY}|ack`, day: TODAY, deletedAt: null });
  expect(screen.queryByText(/^Yesterday ·/)).toBeNull();
  a.unmount();

  mem.clear();
  setItem.mockClear();
  settingsReady();
  seedBlocks(starter());
  const prospects = [prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET', '2026-09-08T09:00'), prospect('p2', 'Bob Reyes', 'APPOINTMENT_SET', '2026-09-08T09:45')];
  mount({ prospects });
  await flush();
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'appt')).toHaveLength(1);
  expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'owed').minutes).toBe(30);

  await tick(4 * 60000); // 9:46 — Bob's 9:45 has started
  const day = read(ROUTINE_DAY_KEY);
  expect(day.filter((r) => r.kind === 'appt').map((r) => r.id).sort()).toEqual([`${TODAY}|appt|p1|540`, `${TODAY}|appt|p2|585`]);
  expect(day.find((r) => r.kind === 'owed')).toMatchObject({ minutes: 60, status: 'open' });
});

test('10. Held on a started appointment stamps heldAt (un-Held clears it); Held is disabled before start; "Remove from today" tombstones the appt record and the attach', async () => {
  settingsReady();
  seedBlocks([
    mk({ id: 'blk_dial01', startMin: 480, durationMin: 60 }),
    apptBlock({ id: 'blk_appt01', startMin: 540, durationMin: 60 }),
    mk({ id: 'blk_fu0001', name: 'Follow-up queue', paletteId: 'followup', category: 'followup', startMin: 600, durationMin: 60 }),
  ]);
  seedDay([attachRec('blk_appt01', 'p3')]);
  const prospects = [
    prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET', '2026-09-08T08:30'),
    prospect('p2', 'Bob Reyes', 'APPOINTMENT_SET', '2026-09-08T10:00'),
    prospect('p3', 'Cara Lee', 'PENDING_DECISION'),
  ];
  mount({ prospects });
  await flush();
  let day = read(ROUTINE_DAY_KEY);
  expect(day.filter((r) => r.kind === 'appt' && !r.deletedAt).map((r) => r.id).sort()).toEqual([`${TODAY}|appt|p1|510`, `${TODAY}|appt|p3|540`]);
  expect(day.find((r) => r.id === `${TODAY}|appt|p3|540`).source).toBe('attached');

  expect(heldOf('Bob Reyes').disabled).toBe(true);
  expect(heldOf('Ana Diaz').disabled).toBe(false);
  fireEvent.click(heldOf('Ana Diaz'));
  await flush();
  expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|appt|p1|510`).heldAt).toMatch(/^2026-09-08T14:4/);
  fireEvent.click(heldOf('Ana Diaz'));
  await flush();
  expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|appt|p1|510`).heldAt).toBeNull();
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'done')).toHaveLength(0); // Held never writes a done record

  fireEvent.click(within(cardOf('Cara Lee')).getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from today' }));
  await flush();
  day = read(ROUTINE_DAY_KEY);
  expect(day.find((r) => r.id === `${TODAY}|appt|p3|540`).deletedAt).toBeTruthy();
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBeTruthy();
  expect(day.find((r) => r.id === `${TODAY}|appt|p1|510`).deletedAt).toBeNull();
  expect(screen.queryByText('Cara Lee')).toBeNull();
  expect(within(cardOf('Bob Reyes')).queryByRole('button', { name: 'More' })).toBeNull(); // derived + not started → no menu
});

test('11. Detach on an unstarted attached row tombstones the attach; attaching to a placeholder whose start has a tombstoned appt record un-deletes it', async () => {
  settingsReady();
  seedBlocks([apptBlock({ id: 'blk_appt01', startMin: 840, durationMin: 60 }), apptBlock({ id: 'blk_appt02', name: 'Webby appointments', paletteId: 'webby', startMin: 900, durationMin: 60 })]);
  seedDay([
    attachRec('blk_appt01', 'p1'),
    { id: `${TODAY}|appt|p2|900`, kind: 'appt', day: TODAY, prospectId: 'p2', startMin: 900, durationMin: 60, source: 'derived', heldAt: null, updatedAt: '2026-09-08T13:00:00.000Z', deletedAt: '2026-09-08T13:30:00.000Z' },
  ]);
  const prospects = [prospect('p1', 'Ana Diaz', 'PENDING_DECISION'), prospect('p2', 'Bob Reyes', 'PENDING_DECISION')];
  const { container } = mount({ prospects });
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  expect(screen.queryByText('Bob Reyes')).toBeNull(); // the tombstone suppresses the card

  fireEvent.click(within(cardOf('Ana Diaz')).getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Detach (today)' }));
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBeTruthy();
  expect(screen.queryByText('Ana Diaz')).toBeNull();
  expect(container.querySelector('[data-item-id="blk_appt01#0"]')).toBeTruthy(); // the placeholder is a routine block again

  fireEvent.click(container.querySelector('[data-item-id="blk_appt02#0"]'));
  fireEvent.change(screen.getByLabelText('Attach prospect (today)'), { target: { value: 'p2' } });
  await flush();
  const day = read(ROUTINE_DAY_KEY);
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt02`)).toMatchObject({ kind: 'attach', blockId: 'blk_appt02', prospectId: 'p2', deletedAt: null });
  expect(day.find((r) => r.id === `${TODAY}|appt|p2|900`).deletedAt).toBeNull();
  expect(cardOf('Bob Reyes')).toBeTruthy();
  expect(read(ROUTINE_BLOCKS_KEY).every((b) => !('prospectId' in b))).toBe(true);
});

test('12. deleting an appt block tombstones its live attach in the same commit; Undo restores both', async () => {
  settingsReady();
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 }), apptBlock({ id: 'blk_appt01', startMin: 840, durationMin: 60 })]);
  // p1 is attached to the 14:00 placeholder AND carries a live frozen card at 13:50–14:20 (the state
  // test 11's un-delete produces): the attached item is absorbed by the overlap (§7h.1), so the
  // placeholder's 14:20–15:00 remnant renders as a routine block that still owns a live attach.
  seedDay([
    attachRec('blk_appt01', 'p1'),
    { id: `${TODAY}|appt|p1|830`, kind: 'appt', day: TODAY, prospectId: 'p1', startMin: 830, durationMin: 30, source: 'derived', heldAt: null, updatedAt: '2026-09-08T13:00:00.000Z', deletedAt: null },
  ]);
  const { container } = mount({ prospects: [prospect('p1', 'Ana Diaz', 'PENDING_DECISION')] });
  await flush();
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  const remnant = container.querySelector('[data-item-id="blk_appt01#0"]');
  expect(remnant).toBeTruthy();
  expect(remnant.getAttribute('aria-label')).toContain('2:20–3:00');

  fireEvent.click(remnant);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await flush();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1);
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  let blocks = read(ROUTINE_BLOCKS_KEY), day = read(ROUTINE_DAY_KEY);
  expect(blocks.find((b) => b.id === 'blk_appt01').deletedAt).toBeTruthy();
  expect(blocks.find((b) => b.id === 'blk_dial01').deletedAt).toBeNull();
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBe(blocks.find((b) => b.id === 'blk_appt01').deletedAt);
  expect(day.find((r) => r.id === `${TODAY}|appt|p1|830`).deletedAt).toBeNull(); // the frozen card stays (§4a)
  expect(container.querySelector('[data-item-id="blk_appt01#0"]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await flush();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(2);
  expect(writes(ROUTINE_DAY_KEY)).toBe(2);
  blocks = read(ROUTINE_BLOCKS_KEY); day = read(ROUTINE_DAY_KEY);
  expect(blocks.find((b) => b.id === 'blk_appt01').deletedAt).toBeNull();
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBeNull();
  expect(container.querySelector('[data-item-id="blk_appt01#0"]')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
});
