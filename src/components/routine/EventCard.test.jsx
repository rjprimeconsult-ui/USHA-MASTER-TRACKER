/**
 * EventCard (rev-11 spec 2026-09-07 §5): a one-off, today-only routine_day_v1
 * record rendered as its own item kind — distinct from both a routine block
 * (no category tint) and the appointment white card (no bg-white, no
 * checkbox). Click/Enter opens the editor sheet; there is no drag/resize here
 * on purpose (§5 funnels every edit through the sheet's isEvent branch).
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EventCard from './EventCard';

const item = { kind: 'event', id: 'ev_0000001', name: 'Call the landlord', startMin: 600, endMin: 630, durationMin: 30 };

test('renders the name, time range, and a "Today" marker; never the appointment white-card treatment', () => {
  const { container } = render(<EventCard item={item} />);
  expect(screen.getByText('Call the landlord')).toBeTruthy();
  expect(screen.getByText('10:00–10:30')).toBeTruthy();
  expect(screen.getByText(/today/i)).toBeTruthy();
  expect(container.firstChild.className).not.toContain('bg-white');
});

test('clicking opens the editor with the item and its bounding rect', () => {
  const onOpen = vi.fn();
  render(<EventCard item={item} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: /call the landlord/i }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen.mock.calls[0][0]).toBe(item);
});

test('Enter opens the editor too (keyboard-reachable, same as a routine block)', () => {
  const onOpen = vi.fn();
  render(<EventCard item={item} onOpen={onOpen} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /call the landlord/i }), { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test('compact mode renders a static row (phone list) — same content, no absolute positioning', () => {
  const onOpen = vi.fn();
  render(<EventCard item={item} compact onOpen={onOpen} />);
  expect(screen.getByText('Call the landlord')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /call the landlord/i }));
  expect(onOpen).toHaveBeenCalledTimes(1);
});
