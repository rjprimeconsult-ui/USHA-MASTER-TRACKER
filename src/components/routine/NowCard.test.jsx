/**
 * NowCard (spec §7b): the four phases, exactly one meta line per state in the
 * pinned priority order, every reminder-strip case, and the appointment Held
 * action. Behavior only — the single styling assertion is the spec's own
 * tripwire: with projected = 0 no element carries an amber class.
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@/lib/push', () => ({ isPushEnabled: async () => true, enablePush: async () => ({ ok: true }), pushPermission: () => 'granted' }));
import NowCard from './NowCard';

const base = { nowMin: 582, projected: { unrecovered: 0, displacedByBlock: {} }, offer: { offerOpen: false, makeupMin: 10 }, slot: null, storedOwed: null, yesterday: { minutes: 0, hidden: true, noun: 'routine time' }, strip: null, onDone: vi.fn(), onHeld: vi.fn(), onAccept: vi.fn(), onSkip: vi.fn(), onAck: vi.fn(), onEnable: vi.fn(), onScrollTo: vi.fn() };
const seg = { kind: 'segment', blockId: 'b1', name: 'Dial block', startMin: 510, endMin: 630, category: 'dial', done: null };
const metaLines = (c) => c.querySelectorAll('[data-meta-line]').length;

test('phases: upFirst / now with Done checkbox / free / dayDone; exactly one meta line per state', () => {
  const { container, rerender } = render(<NowCard {...base} state={{ phase: 'upFirst', next: seg, current: null, behind: null }} />);
  expect(screen.getByText(/Dial block/)).toBeTruthy(); expect(screen.getByText(/starts 8:30/)).toBeTruthy(); expect(metaLines(container)).toBe(0);
  rerender(<NowCard {...base} state={{ phase: 'now', current: seg, next: { kind: 'segment', name: 'Break', startMin: 630 }, behind: null }} />);
  expect(screen.getByText('NOW')).toBeTruthy(); expect(screen.getByText(/then Break at 10:30/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /done/i })); expect(base.onDone).toHaveBeenCalledWith('b1');
  rerender(<NowCard {...base} state={{ phase: 'free', current: null, next: { ...seg, startMin: 645, name: 'Text blast + replies' }, behind: null }} />);
  expect(screen.getByText(/Free until 10:45/)).toBeTruthy();
  rerender(<NowCard {...base} state={{ phase: 'dayDone', current: null, next: null, behind: null }} />);
  expect(screen.getByText(/Day done/)).toBeTruthy();
});

test('meta line priority: offer > still open > note > yesterday; never two', () => {
  const offer = { offerOpen: true, makeupMin: 30 };
  const proj = { unrecovered: 30, displacedByBlock: { b1: 30 } };
  const blocksCat = { b1: 'dial' };
  const { container, rerender } = render(<NowCard {...base} categoryOf={(id) => blocksCat[id]} state={{ phase: 'free', next: null, current: null, behind: { blockId: 'b0', name: 'Morning review' } }} projected={proj} offer={offer} slot={{ startMin: 750, endMin: 780 }} yesterday={{ minutes: 30, hidden: false, noun: 'dial time' }} />);
  expect(metaLines(container)).toBe(1); expect(screen.getByText('30m of dial time displaced.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add 12:30–1:00' })); expect(base.onAccept).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' })); expect(base.onSkip).toHaveBeenCalled();
  rerender(<NowCard {...base} categoryOf={(id) => blocksCat[id]} state={{ phase: 'free', next: null, current: null, behind: { blockId: 'b0', name: 'Morning review' } }} projected={proj} offer={{ offerOpen: false, makeupMin: 10 }} yesterday={{ minutes: 30, hidden: false, noun: 'dial time' }} />);
  expect(metaLines(container)).toBe(1); expect(screen.getByText('Morning review · still open')).toBeTruthy();
  rerender(<NowCard {...base} categoryOf={(id) => blocksCat[id]} state={{ phase: 'free', next: null, current: null, behind: null }} projected={proj} offer={{ offerOpen: false, makeupMin: 10 }} yesterday={{ minutes: 30, hidden: false, noun: 'dial time' }} />);
  expect(screen.getByText('30m owed')).toBeTruthy();
  rerender(<NowCard {...base} state={{ phase: 'dayDone', next: null, current: null, behind: null }} yesterday={{ minutes: 150, hidden: false, noun: 'routine time' }} />);
  expect(screen.getByText('Yesterday · 2h 30m of routine time not done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i })); expect(base.onAck).toHaveBeenCalled();
});

test('with projected = 0 no amber class and no offer/note line; reminder strip cases', () => {
  const { container, rerender } = render(<NowCard {...base} state={{ phase: 'dayDone', next: null, current: null, behind: null }} />);
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0); expect(metaLines(container)).toBe(0);
  for (const [strip, text] of [['off', 'Reminders are off'], ['ios', /Add to Home Screen/], ['denied', 'Reminders are blocked in your browser settings'], ['device', 'Reminders are off on this device'], ['tz', "PRIM doesn't know your time zone"], ['days', 'All days off']]) {
    rerender(<NowCard {...base} strip={strip} state={{ phase: 'dayDone', next: null, current: null, behind: null }} />);
    expect(screen.getByText(text)).toBeTruthy();
    if (strip === 'device') { fireEvent.click(screen.getByRole('button', { name: 'Enable' })); expect(base.onEnable).toHaveBeenCalled(); }
    else expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
  }
});

test('a one-off event as the current item shows no Done checkbox — events carry no done/skip concept (rev-11 §4b)', () => {
  const event = { kind: 'event', id: 'ev_0000001', name: 'Call the landlord', startMin: 600, endMin: 630 };
  render(<NowCard {...base} state={{ phase: 'now', current: event, next: null, behind: null }} />);
  expect(screen.getByText('Call the landlord')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: /done/i })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Held' })).toBeNull();
});

test('appointment as the current item: Held action, disabled before start', () => {
  const appt = { kind: 'appt', prospectId: 'p1', name: 'Ana Diaz', startMin: 600, endMin: 630, instant: 1, frozen: true, heldAt: null };
  const { rerender } = render(<NowCard {...base} state={{ phase: 'now', current: appt, next: null, behind: null }} started />);
  fireEvent.click(screen.getByRole('button', { name: 'Held' })); expect(base.onHeld).toHaveBeenCalledWith(appt);
  rerender(<NowCard {...base} state={{ phase: 'now', current: appt, next: null, behind: null }} started={false} />);
  expect(screen.getByText('Ana Diaz')).toBeTruthy(); // still the current item…
  expect(screen.queryByRole('button', { name: 'Held' })).toBeNull(); // …but Held is withheld until it has started (§7g)
});
