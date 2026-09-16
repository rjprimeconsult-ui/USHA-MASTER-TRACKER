/**
 * BlockEditorSheet (spec §7a, §7f): text fields commit through a 400 ms debounce
 * that flushes ONCE on close and on unmount (the two data-loss paths); every
 * other field commits immediately; the time input commits on blur, never per
 * keystroke (Chrome updates a time input per segment while typing).
 * Rendered as the phone sheet (GlassModal) — the desktop popover portals to
 * document.body and shares the same Editor.
 */
import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import BlockEditorSheet from './BlockEditorSheet';

const block = { id: 'b1', name: 'Dial block', paletteId: 'dial', category: 'dial', startMin: 510, durationMin: 120, remind: { enabled: true, minutesBefore: 5 }, note: '' };
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
const setup = (over = {}) => {
  const onSave = vi.fn(), onClose = vi.fn();
  const utils = render(<BlockEditorSheet open sheet block={block} onSave={onSave} onClose={onClose} {...over} />);
  return { onSave, onClose, ...utils };
};
afterEach(() => { vi.useRealTimers(); });

test('a rename saves once at 400 ms, not at 200 ms', () => {
  fakeTimers();
  const { onSave } = setup();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls' } });
  act(() => { vi.advanceTimersByTime(200); });
  expect(onSave).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(200); });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ name: 'Calls' });
});

test('closing at 200 ms flushes the pending rename exactly once more', () => {
  fakeTimers();
  const { onSave, onClose } = setup();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls' } });
  act(() => { vi.advanceTimersByTime(400); });
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls + texts' } });
  act(() => { vi.advanceTimersByTime(200); });
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenLastCalledWith({ name: 'Calls + texts' });
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(onSave).toHaveBeenCalledTimes(2); // the debounce timer died with the flush
});

test('unmount flushes the pending rename exactly once', () => {
  fakeTimers();
  const { onSave, unmount } = setup();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Calls' } });
  unmount();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ name: 'Calls' });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('lead "off" saves remind.enabled=false immediately', () => {
  const { onSave } = setup();
  fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: 'off' } });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ remind: { enabled: false, minutesBefore: 5 } });
});

test('the time input commits on blur, not on change', () => {
  const { onSave } = setup();
  const time = screen.getByLabelText('Start');
  fireEvent.change(time, { target: { value: '09:30' } });
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.blur(time);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ startMin: 570 });
});

test('a typed-but-not-blurred time is folded into the close flush, not lost', () => {
  const { onSave } = setup();
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '09:30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith({ startMin: 570 });
});

// ---------------- rev-11: one-off events (spec 2026-09-07 §4b, §5) ----------------
// Modeled on the isMakeup branch: an event is editable (name, time, duration, reminder)
// and removable through this same sheet, but it is never a block — no Type (palette)
// select, no Note, no "Attach prospect" — those fields don't exist on an event record.
const event = { id: 'ev_0000001', kind: 'event', day: '2026-09-08', name: 'Call the landlord', startMin: 750, durationMin: 30, remind: { enabled: true, minutesBefore: 5 } };

test('isEvent: shows name/start/duration/reminder, hides Type/Note/Attach, and "Remove event" tombstones it', () => {
  const onSave = vi.fn(), onRemoveEvent = vi.fn(), onClose = vi.fn();
  render(<BlockEditorSheet open sheet block={event} isEvent onSave={onSave} onRemoveEvent={onRemoveEvent} onClose={onClose} />);
  expect(screen.getByLabelText('Name')).toBeTruthy();
  expect(screen.getByLabelText('Start')).toBeTruthy();
  expect(screen.getByLabelText('Duration')).toBeTruthy();
  expect(screen.getByLabelText('Reminder')).toBeTruthy();
  expect(screen.queryByLabelText('Type')).toBeNull();
  expect(screen.queryByLabelText('Note')).toBeNull();
  expect(screen.queryByLabelText('Attach prospect (today)')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip today' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove make-up' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Remove event' }));
  expect(onRemoveEvent).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('isEvent: duration and reminder commit immediately; the header reads "Event"', () => {
  const onSave = vi.fn();
  render(<BlockEditorSheet open sheet block={event} isEvent onSave={onSave} onClose={vi.fn()} />);
  expect(screen.getByText('Event')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '45' } });
  expect(onSave).toHaveBeenCalledWith({ durationMin: 45 });
  fireEvent.change(screen.getByLabelText('Reminder'), { target: { value: '10' } });
  expect(onSave).toHaveBeenCalledWith({ remind: { enabled: true, minutesBefore: 10 } });
});
