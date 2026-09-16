/**
 * MobileRoutineList (spec §7f) — focused on the rev-11 one-off event row
 * (2026-09-07 §5): a tap opens the editor, a long-press offers only "Remove
 * event" (mirroring the make-up row's single "Remove" action), and the row
 * renders through EventCard's own dashed treatment, never the block or
 * appointment row styling.
 */
import { test, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MobileRoutineList from './MobileRoutineList';

beforeAll(() => {
  const proto = window.Element.prototype;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
});
afterEach(() => { vi.useRealTimers(); });

const event = { kind: 'event', id: 'ev_0000001', name: 'Call the landlord', startMin: 600, endMin: 630, durationMin: 30, isTitle: true, index: 0 };

test('an event row renders via EventCard and a tap opens the editor', () => {
  const onOpen = vi.fn();
  const { container } = render(<MobileRoutineList items={[event]} nowMin={500} onOpen={onOpen} />);
  const row = container.querySelector('[data-item-id="ev_0000001"]');
  expect(row).toBeTruthy();
  expect(row.className).toContain('border-dashed');
  fireEvent.click(row);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen.mock.calls[0][0]).toBe(event);
});

test('a long-press on an event row offers only "Remove event"; tapping it calls onRemoveEvent', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const onRemoveEvent = vi.fn(), onSkipToday = vi.fn(), onDelete = vi.fn();
  const { container } = render(<MobileRoutineList items={[event]} nowMin={500} onRemoveEvent={onRemoveEvent} onSkipToday={onSkipToday} onDelete={onDelete} />);
  const row = container.querySelector('[data-item-id="ev_0000001"]');
  fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10 });
  act(() => { vi.advanceTimersByTime(500); });
  fireEvent.pointerUp(row, { pointerId: 1 });
  const removeBtn = screen.getByRole('button', { name: 'Remove event' });
  expect(removeBtn).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Skip today' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  fireEvent.click(removeBtn);
  expect(onRemoveEvent).toHaveBeenCalledWith(event);
  expect(onSkipToday).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
});
