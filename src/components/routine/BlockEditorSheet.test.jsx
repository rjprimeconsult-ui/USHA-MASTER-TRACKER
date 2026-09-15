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
