/**
 * RoutineView (spec §7a, §7g, §7h.3, §9) — the twelve UI-lane cases of §12, plus two the
 * review found unpinned: the drag/resize commit path (13) and entitlement lost mid-session
 * while a write is already in flight (14).
 *
 * The failure this suite exists to catch: a storage write the agent never asked for.
 * `storage.getItem` never rejects, so a failed read looks exactly like an empty account —
 * any write before `loadRoutine` resolves, any write while the account is not entitled, or
 * any echo-save of settings would overwrite the cloud row with an empty routine. Every case
 * therefore asserts on the in-memory store (parsed `mem.get(key)`) and on setItem call counts
 * PER KEY, never on component internals.
 *
 * Conventions (per PendingEmailQueueRunner.test.jsx / PaywallGate.test.jsx):
 *   - storage mocked in-memory with setItem wrapped in vi.fn; useBetaFeature and push through
 *     hoisted holders; supabase stubbed.
 *   - the clock is pinned to 2026-09-08T14:42Z = 9:42 America/Chicago (a Tuesday, CDT) and
 *     moves ONLY through `advance()`. The device zone is stubbed via
 *     Intl.DateTimeFormat#resolvedOptions.
 *   - waiting is condition-based (`until`), never a fixed flush budget; negative assertions
 *     ("zero writes") follow a positive wait that proves the async chain finished.
 *
 * Two timer notes, both load-bearing:
 *   1. `toFake` is narrowed on purpose. Vitest 4 fakes `Intl` by default (a mirrored fake
 *      implementation), which detaches the resolvedOptions spy from the constructor the view
 *      actually calls — 5 of 12 cases silently ran in the machine's real zone.
 *   2. `shouldAdvanceTime` is OFF, so `Date.now()` is frozen between explicit advances and
 *      every stamp in a case is deterministic. RTL's `waitFor` cannot be used with this
 *      combination (it does not detect these fake timers, so its own timeout never fires and
 *      it hangs); `vi.waitFor` advances them itself and is what `until` wraps.
 */
import { test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const mem = vi.hoisted(() => new Map());
const holder = vi.hoisted(() => ({
  access: { canAccess: true, reason: 'tier_match', loading: false },
  gate: null,          // a pending promise here stalls every storage read
  push: { enabled: true, gate: null },
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
  // `holder.push.gate` lets a case hold enablePush() open across a re-render (case 14).
  enablePush: vi.fn(async () => { if (holder.push.gate) await holder.push.gate; holder.push.enabled = true; return { ok: true }; }),
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

// Drain React's pending work WITHOUT touching the clock — for negative assertions only.
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => {}); };
// Condition-based wait: flush inside act (so no update escapes act), then assert; vi.waitFor
// retries, advancing the fake clock only while the condition is still unmet.
const until = (fn) => vi.waitFor(async () => { await act(async () => {}); return fn(); }, { timeout: 2000, interval: 20 });
const loaded = () => until(() => expect(screen.getByRole('heading', { name: 'Routine' })).toBeTruthy());
const advance = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); await settle(); };

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

// Appointment cards carry data-item-id ('appt|<prospectId>|<startMin>') — the precise handle
// when one prospect holds two cards today.
const apptCard = (root, prospectId, startMin) => root.querySelector(`[data-item-id="appt|${prospectId}|${startMin}"]`);
const cardOf = (name) => screen.getAllByText(name).map((el) => el.closest('.group')).find(Boolean);
const heldOf = (name) => within(cardOf(name)).getByRole('checkbox', { name: 'Held' });
const dragTo = (el, dy) => {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 10, clientY: 100 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 10, clientY: 100 + dy });
  fireEvent.pointerUp(el, { pointerId: 1 });
};

let desktop = true;
const stubMatchMedia = () => {
  window.matchMedia = (query) => ({
    matches: query.includes('min-width: 640px') ? desktop : false,
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
};

let tzSpy;
let deviceTz; // what Intl reports for the DEVICE — settings may carry a different zone
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
  holder.push.gate = null;
  desktop = true;
  stubMatchMedia();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
  deviceTz = 'America/Chicago';
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  tzSpy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolved() {
    return { ...real.call(this), timeZone: deviceTz };
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
  await settle();
  expect(setItem).not.toHaveBeenCalled();

  holder.access = { canAccess: false, reason: 'tier_too_low', loading: false };
  a.rerender(view());
  await settle();
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
  await settle();
  expect(setItem).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Routine' })).toBeNull();
  release();
  holder.gate = null;
  await loaded();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1); // the one-time zone capture, only after load
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
});

test('2. first open captures the device zone and seeds followupStages once (null prospectSettings → 3; custom "Circle back" → 4); a manual zone is never rewritten', async () => {
  const a = mount({ prospectSettings: null });
  await loaded();
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
  await loaded();
  await settle();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1);
  b.unmount();

  // a fresh account whose stage list carries a follow-up-worded custom stage
  mem.clear();
  setItem.mockClear();
  const c = mount({ prospectSettings: { stages: [...DEFAULT_PROSPECT_STAGES, { id: 'CIRCLE_BACK', label: 'Circle back', color: '#000000' }], customFields: [] } });
  await loaded();
  s = read(ROUTINE_SETTINGS_KEY);
  expect(s.followupStages).toEqual(['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION', 'CIRCLE_BACK']);
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(1);
  c.unmount();

  // an agent who picked a zone by hand (travelling) keeps it — capture is for timezoneMode 'auto' only
  mem.clear();
  setItem.mockClear();
  seedSettings({ timezone: 'America/New_York', timezoneMode: 'manual', followupStagesSeeded: true, remindersEnabled: true });
  mount();
  await loaded();
  await settle();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(0);
  expect(read(ROUTINE_SETTINGS_KEY).timezone).toBe('America/New_York');
  expect(read(ROUTINE_SETTINGS_KEY).timezoneMode).toBe('manual');
});

test('3. empty routine → TemplatePicker; picking "Agent day" saves 11 live blocks to routine_blocks_v1 exactly once', async () => {
  settingsReady();
  mount();
  await loaded();
  expect(screen.getByText('Agent day')).toBeTruthy();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);

  fireEvent.click(screen.getByRole('button', { name: 'Use this routine' }));
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1));
  const blocks = read(ROUTINE_BLOCKS_KEY);
  expect(blocks.filter((b) => !b.deletedAt)).toHaveLength(11);
  expect(blocks.map((b) => b.startMin)).toEqual(STARTER_TEMPLATE.entries.map((e) => e.startMin));
  expect(blocks.every((b) => /^blk_[0-9a-z]{7}$/.test(b.id))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Use this routine' })).toBeNull(); // the canvas took over
});

test('4. a checkbox toggle writes ONE done record immediately and un-checks to cleared; a rename through the editor writes once after 400 ms', async () => {
  settingsReady();
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 })]); // 10:00–11:00, upcoming at 9:42
  const { container } = mount();
  await loaded();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  let day = read(ROUTINE_DAY_KEY);
  expect(day).toHaveLength(1);
  expect(day[0]).toMatchObject({ id: `${TODAY}|blk_dial01`, kind: 'done', day: TODAY, blockId: 'blk_dial01', status: 'done', deletedAt: null });

  // a mis-tapped checkbox must be un-checkable for the rest of the day (§4b: status 'cleared')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(2));
  day = read(ROUTINE_DAY_KEY);
  expect(day).toHaveLength(1);
  expect(day[0].status).toBe('cleared');
  expect(screen.getByRole('checkbox', { name: 'Done' }).checked).toBe(false);

  fireEvent.click(container.querySelector('[data-item-id="blk_dial01#0"]'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls' } });
  await settle();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  await advance(400);
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1));
  expect(read(ROUTINE_BLOCKS_KEY)[0].name).toBe('Calls');
  expect(writes(ROUTINE_DAY_KEY)).toBe(2);
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(0);
});

test('5. never writes prospects_v1 / prospect_settings_v1; no block in routine_blocks_v1 ever carries prospectId or a prospect name', async () => {
  settingsReady();
  seedBlocks([apptBlock({ id: 'blk_appt01', startMin: 840, durationMin: 60 })]);
  const prospects = [prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET'), prospect('p2', 'Bob Reyes', 'PENDING_DECISION')];
  const { container } = mount({ prospects, prospectSettings: { stages: DEFAULT_PROSPECT_STAGES, customFields: [] } });
  await loaded();

  fireEvent.click(container.querySelector('[data-item-id="blk_appt01#0"]'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meeting' } });
  await advance(400);
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1));
  fireEvent.change(screen.getByLabelText('Attach prospect (today)'), { target: { value: 'p1' } });
  await until(() => expect(read(ROUTINE_DAY_KEY)?.find((r) => r.kind === 'attach')).toMatchObject({ id: `${TODAY}|attach|blk_appt01`, blockId: 'blk_appt01', prospectId: 'p1', deletedAt: null }));
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
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  await settle();
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

  await advance(30000);
  await advance(30000);
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  a.unmount();

  const b = mount({ prospects }); // a second render over the stored records
  await loaded();
  await settle();
  expect(writes(ROUTINE_DAY_KEY)).toBe(1);
  b.unmount();

  setItem.mockClear();
  seedDay([{ ...appt[0], deletedAt: '2026-09-08T14:30:00.000Z', updatedAt: '2026-09-08T14:30:00.000Z' }]);
  mount({ prospects });
  await loaded();
  await advance(30000);
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  expect(screen.queryByText('Ana Diaz')).toBeNull();
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'appt')).toHaveLength(1);
});

test('7. exactly one of Timeline / MobileRoutineList at the 640 px split, under one NowCard', async () => {
  settingsReady();
  seedBlocks(starter());
  desktop = true;
  const a = mount();
  await loaded();
  expect(a.container.querySelectorAll('[data-routine-timeline]')).toHaveLength(1);
  expect(a.container.querySelectorAll('[data-routine-mobile]')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull();
  expect(screen.getAllByText('NOW')).toHaveLength(1);
  a.unmount();

  desktop = false;
  const b = mount();
  await loaded();
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
  await loaded();

  fireEvent.click(await until(() => screen.getByRole('button', { name: 'Add 12:30–1:00' })));
  await until(() => expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'makeup' && !r.deletedAt)).toHaveLength(1));
  let day = read(ROUTINE_DAY_KEY);
  const mks = day.filter((r) => r.kind === 'makeup' && !r.deletedAt);
  expect(mks[0]).toMatchObject({ day: TODAY, startMin: 750, durationMin: 30, category: 'dial', name: 'Dial block (make-up)', ofBlockId: dial.id, deletedAt: null });
  expect(mks[0].id).toMatch(/^mk_[0-9a-z]{7}$/);
  expect(day.find((r) => r.kind === 'owed')).toMatchObject({ status: 'accepted', decidedMinutes: 0, minutes: 0 }); // accepted-and-kept reads 0 (§7h.4)
  expect(showToast).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^Add \d/ })).toBeNull();

  const seg = a.container.querySelector(`[data-item-id="${mks[0].id}#0"]`);
  expect(seg).toBeTruthy();
  expect(seg.querySelector('span[aria-hidden="true"]').style.borderLeft).toContain('dashed');

  fireEvent.click(seg);
  expect(screen.queryByLabelText('Reminder')).toBeNull(); // a make-up has no per-record lead (§4b)
  fireEvent.click(screen.getByRole('button', { name: 'Remove make-up' }));
  await until(() => expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'makeup').deletedAt).toBeTruthy());
  day = read(ROUTINE_DAY_KEY);
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
  await loaded();
  fireEvent.click(await until(() => screen.getByRole('button', { name: 'Skip' })));
  await until(() => expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'owed')).toMatchObject({ status: 'skipped', decidedMinutes: 30, minutes: 30 }));
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  expect(screen.getByText('30m owed')).toBeTruthy();
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'makeup')).toHaveLength(0);
  expect(showToast).not.toHaveBeenCalled();
});

test('9. × on the yesterday line writes an ack record; the client owed refresh writes minutes when realized changes on the clock', async () => {
  settingsReady();
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 })]); // live yesterday (created 09-01), nothing done then
  const a = mount();
  await loaded();
  expect(screen.getByText('Yesterday · 1h of dial time not done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'ack')).toMatchObject({ id: `${TODAY}|ack`, day: TODAY, deletedAt: null });
  expect(screen.queryByText(/^Yesterday ·/)).toBeNull();
  a.unmount();

  mem.clear();
  setItem.mockClear();
  settingsReady();
  seedBlocks(starter());
  const prospects = [prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET', '2026-09-08T09:00'), prospect('p2', 'Bob Reyes', 'APPOINTMENT_SET', '2026-09-08T09:45')];
  mount({ prospects });
  await until(() => expect(read(ROUTINE_DAY_KEY)?.filter((r) => r.kind === 'appt')).toHaveLength(1));
  expect(read(ROUTINE_DAY_KEY).find((r) => r.kind === 'owed').minutes).toBe(30);

  await advance(4 * 60000); // 9:46 — Bob's 9:45 has started
  await until(() => expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'appt')).toHaveLength(2));
  const day = read(ROUTINE_DAY_KEY);
  expect(day.filter((r) => r.kind === 'appt').map((r) => r.id).sort()).toEqual([`${TODAY}|appt|p1|540`, `${TODAY}|appt|p2|585`]);
  expect(day.find((r) => r.kind === 'owed')).toMatchObject({ minutes: 60, status: 'open' });
});

test('10. Held on a started appointment stamps heldAt (un-Held clears it); Held is disabled before start; "Remove from today" tombstones the appt record and ONLY the attach at that start', async () => {
  settingsReady();
  seedBlocks([
    mk({ id: 'blk_dial01', startMin: 480, durationMin: 60 }),
    apptBlock({ id: 'blk_appt01', startMin: 540, durationMin: 60 }),
    mk({ id: 'blk_fu0001', name: 'Follow-up queue', paletteId: 'followup', category: 'followup', startMin: 600, durationMin: 60 }),
    apptBlock({ id: 'blk_appt02', name: 'Webby appointments', paletteId: 'webby', startMin: 840, durationMin: 60 }),
  ]);
  // the SAME prospect on two placeholders today — the 9:00 one and a 14:00 one
  seedDay([attachRec('blk_appt01', 'p3'), attachRec('blk_appt02', 'p3')]);
  const prospects = [
    prospect('p1', 'Ana Diaz', 'APPOINTMENT_SET', '2026-09-08T08:30'),
    prospect('p2', 'Bob Reyes', 'APPOINTMENT_SET', '2026-09-08T10:00'),
    prospect('p3', 'Cara Lee', 'PENDING_DECISION'),
  ];
  const { container } = mount({ prospects });
  await until(() => expect(read(ROUTINE_DAY_KEY)?.filter((r) => r.kind === 'appt')).toHaveLength(2));
  let day = read(ROUTINE_DAY_KEY);
  expect(day.filter((r) => r.kind === 'appt' && !r.deletedAt).map((r) => r.id).sort()).toEqual([`${TODAY}|appt|p1|510`, `${TODAY}|appt|p3|540`]);
  expect(day.find((r) => r.id === `${TODAY}|appt|p3|540`).source).toBe('attached');
  expect(apptCard(container, 'p3', 540)).toBeTruthy();
  expect(apptCard(container, 'p3', 840)).toBeTruthy();

  expect(heldOf('Bob Reyes').disabled).toBe(true);
  expect(heldOf('Ana Diaz').disabled).toBe(false);
  fireEvent.click(heldOf('Ana Diaz'));
  // the minute, not the millisecond: `until` advances the fake clock while a condition is unmet
  await until(() => expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|appt|p1|510`).heldAt).toMatch(/^2026-09-08T14:42:/));
  fireEvent.click(heldOf('Ana Diaz'));
  await until(() => expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|appt|p1|510`).heldAt).toBeNull());
  expect(read(ROUTINE_DAY_KEY).filter((r) => r.kind === 'done')).toHaveLength(0); // Held never writes a done record

  fireEvent.click(within(apptCard(container, 'p3', 540)).getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from today' }));
  await until(() => expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|appt|p3|540`).deletedAt).toBeTruthy());
  day = read(ROUTINE_DAY_KEY);
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBeTruthy();
  // removing the 9:00 card must NOT kill the same prospect's 14:00 appointment (§7f)
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt02`).deletedAt).toBeNull();
  expect(day.find((r) => r.id === `${TODAY}|appt|p1|510`).deletedAt).toBeNull();
  expect(apptCard(container, 'p3', 540)).toBeNull();
  expect(apptCard(container, 'p3', 840)).toBeTruthy();
  expect(within(apptCard(container, 'p2', 600)).queryByRole('button', { name: 'More' })).toBeNull(); // derived + not started → no menu
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
  await loaded();
  await settle();
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  expect(screen.queryByText('Bob Reyes')).toBeNull(); // the tombstone suppresses the card

  fireEvent.click(within(apptCard(container, 'p1', 840)).getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Detach (today)' }));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBeTruthy();
  expect(screen.queryByText('Ana Diaz')).toBeNull();
  expect(container.querySelector('[data-item-id="blk_appt01#0"]')).toBeTruthy(); // the placeholder is a routine block again

  fireEvent.click(container.querySelector('[data-item-id="blk_appt02#0"]'));
  fireEvent.change(screen.getByLabelText('Attach prospect (today)'), { target: { value: 'p2' } });
  await until(() => expect(read(ROUTINE_DAY_KEY).find((r) => r.id === `${TODAY}|appt|p2|900`).deletedAt).toBeNull());
  const day = read(ROUTINE_DAY_KEY);
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt02`)).toMatchObject({ kind: 'attach', blockId: 'blk_appt02', prospectId: 'p2', deletedAt: null });
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
  await loaded();
  await settle();
  expect(writes(ROUTINE_DAY_KEY)).toBe(0);
  const remnant = container.querySelector('[data-item-id="blk_appt01#0"]');
  expect(remnant).toBeTruthy();
  expect(remnant.getAttribute('aria-label')).toContain('2:20–3:00');

  fireEvent.click(remnant);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  let blocks = read(ROUTINE_BLOCKS_KEY), day = read(ROUTINE_DAY_KEY);
  expect(blocks.find((b) => b.id === 'blk_appt01').deletedAt).toBeTruthy();
  expect(blocks.find((b) => b.id === 'blk_dial01').deletedAt).toBeNull();
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBe(blocks.find((b) => b.id === 'blk_appt01').deletedAt);
  expect(day.find((r) => r.id === `${TODAY}|appt|p1|830`).deletedAt).toBeNull(); // the frozen card stays (§4a)
  expect(container.querySelector('[data-item-id="blk_appt01#0"]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(2));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(2));
  blocks = read(ROUTINE_BLOCKS_KEY); day = read(ROUTINE_DAY_KEY);
  expect(blocks.find((b) => b.id === 'blk_appt01').deletedAt).toBeNull();
  expect(day.find((r) => r.id === `${TODAY}|attach|blk_appt01`).deletedAt).toBeNull();
  expect(container.querySelector('[data-item-id="blk_appt01#0"]')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
});

test('13. a drag commits the snapped start once; a resize clamps to the next block; a drag into a packed hour reverts with the toast and no write', async () => {
  const showToast = vi.fn();
  settingsReady();
  seedBlocks([
    mk({ id: 'blk_move01', startMin: 480, durationMin: 60 }),                                                                        // 8:00–9:00
    mk({ id: 'blk_wall01', name: 'Follow-up queue', paletteId: 'followup', category: 'followup', startMin: 600, durationMin: 120 }),  // 10:00–12:00
    mk({ id: 'blk_wall02', name: 'Apps & underwriting', paletteId: 'admin', category: 'admin', startMin: 720, durationMin: 120 }),    // 12:00–14:00
  ]);
  const { container } = mount({ showToast });
  await loaded();
  const seg = () => container.querySelector('[data-item-id="blk_move01#0"]');

  // +20 px = +10 min at 2 px/min → one write at the snapped start
  dragTo(seg(), 20);
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1));
  expect(read(ROUTINE_BLOCKS_KEY).find((b) => b.id === 'blk_move01').startMin).toBe(490);
  expect(showToast).not.toHaveBeenCalled();

  // a resize past the next block's start clamps to it (490 + 110 = 600), never overlaps
  const handle = seg().querySelector('.cursor-ns-resize');
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 10, clientY: 200 });
  fireEvent.pointerMove(seg(), { pointerId: 2, clientX: 10, clientY: 600 });
  fireEvent.pointerUp(seg(), { pointerId: 2 });
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(2));
  expect(read(ROUTINE_BLOCKS_KEY).find((b) => b.id === 'blk_move01')).toMatchObject({ startMin: 490, durationMin: 110 });

  // dragged onto 12:20, inside two back-to-back blocks: no gap it can still overlap → revert + toast
  dragTo(seg(), 260);
  await until(() => expect(showToast).toHaveBeenCalledWith('No room there — shrink it or move a neighbor'));
  await settle();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(2);
  expect(read(ROUTINE_BLOCKS_KEY).find((b) => b.id === 'blk_move01')).toMatchObject({ startMin: 490, durationMin: 110 });
  expect(read(ROUTINE_BLOCKS_KEY).find((b) => b.id === 'blk_wall01').startMin).toBe(600);
});

test('14. entitlement lost mid-session: neither the editor unmount flush nor an in-flight enablePush may write', async () => {
  // (a) a pending 400 ms rename, then canAccess flips false: the view returns the locked card,
  // BlockEditorSheet unmounts, and its flush calls the onSave captured while still entitled.
  settingsReady();
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 })]);
  const a = mount();
  await loaded();
  fireEvent.click(a.container.querySelector('[data-item-id="blk_dial01#0"]'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls' } });
  await settle();
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);

  holder.access = { canAccess: false, reason: 'tier_too_low', loading: false };
  a.rerender(view());
  await settle();
  expect(screen.getByText('Routine is included with every PRIM plan')).toBeTruthy();
  await advance(1000); // any surviving debounce would have fired by now
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  expect(read(ROUTINE_BLOCKS_KEY)[0].name).toBe('Dial block'); // the rename never reached storage
  a.unmount();

  // (b) the Bell turning ON while the device is off: entitlement flips during the enablePush await
  mem.clear();
  setItem.mockClear();
  holder.access = { canAccess: true, reason: 'tier_match', loading: false };
  holder.push.enabled = false;
  seedSettings({ timezone: 'America/Chicago', timezoneMode: 'auto', followupStagesSeeded: true, remindersEnabled: false });
  let releasePush;
  holder.push.gate = new Promise((r) => { releasePush = r; });
  const b = mount();
  await loaded();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(0);

  fireEvent.click(screen.getByRole('button', { name: 'Reminders off' }));
  await settle();
  holder.access = { canAccess: false, reason: 'tier_too_low', loading: false };
  b.rerender(view());
  await settle();
  releasePush();
  holder.push.gate = null;
  await settle();
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(0);
  expect(read(ROUTINE_SETTINGS_KEY).remindersEnabled).toBe(false);
});

test('15. a positional add that finds no fit says "No room there" (§7c); the palette click keeps "No room today"; neither writes', async () => {
  // Carry-forward from the Task 12 review: a drop / "+ hh:mm" pill is POSITIONAL — it fails
  // because the pointed-at hour is full, not because the day is. §7c scopes "No room today" to
  // the palette-click path and gives every positional gesture the shrink-or-move copy.
  const showToast = vi.fn();
  settingsReady();
  seedBlocks([
    mk({ id: 'blk_pack01', name: 'Follow-up queue', paletteId: 'followup', category: 'followup', startMin: 600, durationMin: 120 }), // 10:00–12:00
    mk({ id: 'blk_pack02', name: 'Apps & underwriting', paletteId: 'admin', category: 'admin', startMin: 720, durationMin: 120 }),   // 12:00–14:00
  ]);
  const a = mount({ showToast });
  await loaded();

  // Drop a 15-minute Break at 11:40, inside two back-to-back blocks: its ±10 min slide window
  // (durationMin − 5, so it still covers the pointed-at minute) finds nothing → the positional
  // copy. 14:00 onward is wide open, so "No room today" would be a lie.
  // The lane's getBoundingClientRect is all-zero in jsdom, so clientY IS the offset from
  // bounds.start (360 = 6:00) at 2 px/min: (700 − 360) × 2.
  fireEvent.drop(a.container.querySelector('[data-item-id="blk_pack01#0"]'), {
    clientY: 680,
    dataTransfer: { types: ['text/prim-palette'], getData: () => 'break' },
  });
  await until(() => expect(showToast).toHaveBeenCalledWith('No room there — shrink it or move a neighbor'));
  await settle();
  expect(showToast).not.toHaveBeenCalledWith('No room today');
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
  a.unmount();

  // The click path (startMin == null) keeps "No room today" — here the day really is full from
  // the next 5-minute mark (9:45) to midnight.
  mem.clear();
  setItem.mockClear();
  showToast.mockClear();
  settingsReady();
  seedBlocks([
    mk({ id: 'blk_full01', startMin: 585, durationMin: 720 }),   // 9:45–21:45
    mk({ id: 'blk_full02', startMin: 1305, durationMin: 135 }),  // 21:45–24:00
  ]);
  mount({ showToast });
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Break' }));
  await until(() => expect(showToast).toHaveBeenCalledWith('No room today'));
  await settle();
  expect(showToast).not.toHaveBeenCalledWith('No room there — shrink it or move a neighbor');
  expect(writes(ROUTINE_BLOCKS_KEY)).toBe(0);
});

test('16. the day document is pruned against the SETTINGS zone, not the device zone (§4b)', async () => {
  // A travelling agent: the phone reports Pacific/Auckland (UTC+12), the routine is pinned to
  // America/Chicago by hand. At 14:42Z it is already 2026-09-09 in Auckland but still
  // 2026-09-08 in Chicago, so the DEVICE floor (today−7 = 09-02) sits a day ahead of the real
  // one (09-01). Sanitizing the day array during the load against the device key dropped
  // 2026-09-01 from state, and the next commitDay wrote that deletion to the cloud — silent,
  // permanent loss of a day of records. The prune floor and every commitDay must share one zone.
  deviceTz = 'Pacific/Auckland';
  seedSettings({ timezone: 'America/Chicago', timezoneMode: 'manual', followupStagesSeeded: true, remindersEnabled: true });
  seedBlocks([mk({ id: 'blk_dial01', startMin: 600, durationMin: 60 })]);
  const days = ['2026-09-01', '2026-09-02', '2026-09-07'];
  seedDay(days.map((d) => ({ id: `${d}|blk_old000`, kind: 'done', day: d, blockId: 'blk_old000', status: 'done', at: OLD, updatedAt: OLD, deletedAt: null })));

  mount();
  await loaded();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  expect(read(ROUTINE_DAY_KEY).map((r) => r.day).sort()).toEqual([...days, TODAY]);
  expect(writes(ROUTINE_SETTINGS_KEY)).toBe(0); // a manual zone is never recaptured from the device
});

test('17. the follow-up sheet times an appointment the timeline HIDES (stage outside appointmentStages — spec risk #15)', async () => {
  // §7h.2's secondary line exists to explain exactly this prospect: a follow-up stage carrying
  // an appointment today that never reaches the timeline, because todaysAppointments filters by
  // appointmentStages. Resolving the time from `items` (that same filtered list) made the line
  // unreachable for the whole population it was written for.
  settingsReady();
  seedBlocks([mk({ id: 'blk_fu0001', name: 'Follow-up queue', paletteId: 'followup', category: 'followup', startMin: 600, durationMin: 60 })]);
  mount({ prospects: [prospect('p9', 'Cara Lee', 'PENDING_DECISION', '2026-09-08T10:00')] });
  await loaded();

  fireEvent.click(screen.getByText('Cara Lee')); // the queue row on the block opens the sheet
  await until(() => expect(screen.getByText('Follow-up queue · 1 due · by last contact')).toBeTruthy());
  expect(screen.getByText('Pending Decision · appt 10:00')).toBeTruthy();
  expect(screen.queryByText('Pending Decision · —')).toBeNull();
});

test('18. a block the resolver cannot place anywhere is tombstoned WITH a "No room for <name>" toast (§4a)', async () => {
  const showToast = vi.fn();
  settingsReady();
  seedBlocks([
    mk({ id: 'blk_aa0001', name: 'Morning', startMin: 0, durationMin: 710 }),   // 0:00–11:50
    mk({ id: 'blk_bb0001', name: 'Evening', startMin: 720, durationMin: 720 }), // 12:00–24:00
    mk({ id: 'blk_cc0001', name: 'Stretch', startMin: 710, durationMin: 10 }),  // 11:50–12:00 — the day is packed
  ]);
  const { container } = mount({ showToast });
  await loaded();

  // delete the 10-minute block, then grow its neighbour into the gap it left …
  fireEvent.keyDown(container.querySelector('[data-item-id="blk_cc0001#0"]'), { key: 'Delete' });
  await until(() => expect(writes(ROUTINE_BLOCKS_KEY)).toBe(1));
  const seg = container.querySelector('[data-item-id="blk_aa0001#0"]');
  fireEvent.pointerDown(seg.querySelector('.cursor-ns-resize'), { button: 0, pointerId: 2, clientX: 10, clientY: 200 });
  fireEvent.pointerMove(seg, { pointerId: 2, clientX: 10, clientY: 600 });
  fireEvent.pointerUp(seg, { pointerId: 2 });
  await until(() => expect(read(ROUTINE_BLOCKS_KEY).find((b) => b.id === 'blk_aa0001').durationMin).toBe(720));

  // … so Undo has nowhere to put it back. §4a: tombstone, and SAY SO — sanitizeBlocks used to
  // swallow the drop and the block simply vanished.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await until(() => expect(showToast).toHaveBeenCalledWith('No room for Stretch'));
  expect(read(ROUTINE_BLOCKS_KEY).find((b) => b.id === 'blk_cc0001').deletedAt).toBeTruthy();
});

test('19. a load that straddles local midnight prunes at the PRE-await day, never ahead of commitDay (§4b)', async () => {
  // Same zone on both sides this time — what skews here is the INSTANT. It is 23:59:50 in
  // Chicago on the 7th; the storage read is held open across local midnight. commitDay's
  // `today` comes from the `now` STATE, which the 30 s clock only starts refreshing after
  // the load resolves, so a floor taken AFTER the await is a day ahead of the floor the very
  // next commit will use — and that commit persists the extra day it dropped.
  vi.setSystemTime(new Date('2026-09-08T04:59:50Z'));
  seedSettings({ timezone: 'America/Chicago', timezoneMode: 'manual', followupStagesSeeded: true, remindersEnabled: true });
  seedBlocks([mk({ id: 'blk_late01', startMin: 1380, durationMin: 60 })]); // 23:00–24:00
  const days = ['2026-08-31', '2026-09-01'];
  seedDay(days.map((d) => ({ id: `${d}|blk_old000`, kind: 'done', day: d, blockId: 'blk_old000', status: 'done', at: OLD, updatedAt: OLD, deletedAt: null })));

  let release;
  holder.gate = new Promise((r) => { release = r; });
  const { container } = mount();
  await settle();
  await advance(20000); // midnight passes while loadRoutine is still in flight
  release();
  holder.gate = null;
  await loaded();

  // the block is the current one at 23:59, so NowCard renders a Done control too — scope
  // to the timeline so this asserts on the prune, never on a selector.
  fireEvent.click(within(container.querySelector('[data-routine-timeline]')).getByRole('checkbox', { name: 'Done' }));
  await until(() => expect(writes(ROUTINE_DAY_KEY)).toBe(1));
  expect(read(ROUTINE_DAY_KEY).map((r) => r.day).sort()).toEqual([...days, '2026-09-07']);
});
