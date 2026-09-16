/**
 * BlockPalette (spec §7d, rev-11 §5): ten category chips + one visually distinct
 * "Event (today)" chip. Blocks are the recurring template; an event is a
 * routine_day_v1 record, today only, and must be unmistakable as a different
 * kind of thing — both to a human (its own label/why-line) and to the drop
 * target (its own sentinel id, so Timeline never treats it like a palette
 * category and never runs it through the block-placement/nearestFit path).
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BlockPalette from './BlockPalette';

test('renders a distinctly-labeled Event chip alongside the ten category chips', () => {
  render(<BlockPalette />);
  expect(screen.getAllByRole('button')).toHaveLength(11); // 10 categories + Event
  expect(screen.getByRole('button', { name: /event/i })).toBeTruthy();
});

test('clicking the Event chip calls onAdd with the reserved "event" id — never a real palette category id', () => {
  const onAdd = vi.fn();
  render(<BlockPalette onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: /event/i }));
  expect(onAdd).toHaveBeenCalledWith('event');
});

test('a category chip still adds by its own paletteId (unaffected by the Event chip)', () => {
  const onAdd = vi.fn();
  render(<BlockPalette onAdd={onAdd} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dial block' }));
  expect(onAdd).toHaveBeenCalledWith('dial');
});

test('dragging the Event chip sets the same drag type Timeline already reads, carrying the "event" id', () => {
  const onDragStart = vi.fn();
  render(<BlockPalette onDragStart={onDragStart} />);
  const setData = vi.fn();
  fireEvent.dragStart(screen.getByRole('button', { name: /event/i }), { dataTransfer: { setData, effectAllowed: '' } });
  expect(setData).toHaveBeenCalledWith('text/prim-palette', 'event');
  expect(onDragStart).toHaveBeenCalledWith('event');
});

test('hovering the Event chip shows its own why-line, distinct from a category chip\'s', () => {
  render(<BlockPalette />);
  fireEvent.mouseEnter(screen.getByRole('button', { name: /event/i }));
  expect(screen.getByText(/today only/i)).toBeTruthy();
  fireEvent.mouseLeave(screen.getByRole('button', { name: /event/i }));
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Dial block' }));
  expect(screen.getByText(/protected outbound time/i)).toBeTruthy();
});
