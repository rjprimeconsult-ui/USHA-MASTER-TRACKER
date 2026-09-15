/**
 * AppointmentCard (spec §7h.1): the only white surface on the timeline — no
 * svg, no bell, no label; Held disabled before start; the name opens the prospect.
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppointmentCard from './AppointmentCard';
const item = { kind: 'appt', prospectId: 'p1', name: 'Ana Diaz', startMin: 600, endMin: 630, durationMin: 30, frozen: true, heldAt: null, source: 'derived' };
test('white surface, no svg, no bell, Held checkbox disabled before start; name opens the prospect', () => {
  const onOpen = vi.fn(), onHeld = vi.fn();
  const { container, rerender } = render(<AppointmentCard item={item} started onHeld={onHeld} onOpenProspect={onOpen} />);
  expect(container.firstChild.className).toContain('bg-white'); expect(container.firstChild.className).toContain('border-slate-200');
  expect(container.querySelector('svg')).toBeNull();
  expect(screen.getByText('10:00–10:30')).toBeTruthy();
  fireEvent.click(screen.getByText('Ana Diaz')); expect(onOpen).toHaveBeenCalledWith('p1');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Held' })); expect(onHeld).toHaveBeenCalledWith(item);
  rerender(<AppointmentCard item={{ ...item, frozen: false }} started={false} onHeld={onHeld} onOpenProspect={onOpen} />);
  expect(screen.getByRole('checkbox', { name: 'Held' }).disabled).toBe(true);
});
