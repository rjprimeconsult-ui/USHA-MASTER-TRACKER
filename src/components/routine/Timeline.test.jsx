/**
 * Timeline (spec §7c): a drag on the first segment commits onMove ONCE at
 * drag end with the snapped start; the browser's trailing click never opens the
 * editor — after a finished drag AND after an Escape-cancelled one; a plain
 * click opens with the block's rect (the popover anchor).
 * jsdom 29 has PointerEvent but no pointer capture or scrollIntoView — stubbed.
 */
import { test, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import Timeline from './Timeline';

beforeAll(() => {
  const proto = window.Element.prototype;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
});

const block = { id: 'b1', name: 'Dial block', category: 'dial', paletteId: 'dial', startMin: 510, durationMin: 120, remind: { enabled: true, minutesBefore: 5 } };
const seg = { kind: 'segment', id: 'b1#0', blockId: 'b1', block, name: 'Dial block', category: 'dial', startMin: 510, endMin: 630, index: 0, isTitle: true, isFirst: true, isLast: true, done: null };

test('drag commits onMove once with the snapped start; trailing clicks never open; Escape cancels; a plain click opens with a rect', () => {
  const onMove = vi.fn(), onOpen = vi.fn();
  const { container } = render(<Timeline items={[seg]} bounds={{ start: 360, end: 1260 }} nowMin={500} onMove={onMove} onOpen={onOpen} />);
  const root = container.querySelector('[data-item-id="b1#0"]');
  expect(root).toBeTruthy();

  // +60 px = 30 min at 2 px/min → 510 + 30
  fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 10, clientY: 100 });
  fireEvent.pointerMove(root, { pointerId: 1, clientX: 10, clientY: 160 });
  fireEvent.pointerUp(root, { pointerId: 1 });
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onMove).toHaveBeenCalledWith('b1', 540);
  fireEvent.click(root);
  expect(onOpen).not.toHaveBeenCalled();

  // Escape before release → cancelled: no second commit, and the trailing click still does not open
  fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 10, clientY: 100 });
  fireEvent.pointerMove(root, { pointerId: 1, clientX: 10, clientY: 160 });
  fireEvent.keyDown(window, { key: 'Escape' });
  fireEvent.pointerUp(root, { pointerId: 1 });
  expect(onMove).toHaveBeenCalledTimes(1);
  fireEvent.click(root);
  expect(onOpen).not.toHaveBeenCalled();

  // a plain click (no drag) opens, carrying the block's rect for the popover anchor
  fireEvent.pointerDown(root, { button: 0, pointerId: 1, clientX: 10, clientY: 100 });
  fireEvent.pointerUp(root, { pointerId: 1 });
  fireEvent.click(root);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen.mock.calls[0][0]).toBe(seg);
  expect(typeof onOpen.mock.calls[0][1]?.top).toBe('number');
});
