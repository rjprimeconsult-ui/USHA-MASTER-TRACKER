/**
 * FollowupSheet (spec §7h.2): FollowupDueWidget's row grammar with the chip
 * and the "Next:" line excluded; a row opens the prospect.
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FollowupSheet from './FollowupSheet';
test('FollowupDueWidget row grammar without chip or Next line; rows open the prospect', () => {
  const onOpen = vi.fn();
  const rows = [{ id: 'p1', name: 'Ana Diaz', stage: 'MISSED_APPT', age: '12d' }, { id: 'p2', name: 'Bo Li', stage: 'STAGE_X', age: 'new' }];
  const { container } = render(<FollowupSheet open rows={rows} stageLabelOf={(id) => ({ MISSED_APPT: 'Missed Appt', STAGE_X: 'Try to Reengage' })[id]} apptTimeOf={(id) => (id === 'p2' ? 600 : null)} onOpenProspect={onOpen} onClose={() => {}} />);
  expect(screen.getByText('Follow-up queue · 2 due · by last contact')).toBeTruthy();
  expect(container.querySelector('.divide-y.divide-slate-100')).toBeTruthy();
  expect(screen.getByText('Missed Appt · 12d')).toBeTruthy(); expect(screen.getByText('Try to Reengage · appt 10:00')).toBeTruthy();
  expect(screen.queryByText(/Due today/)).toBeNull(); expect(screen.queryByText(/Next:/)).toBeNull();
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0);
  fireEvent.click(screen.getByText('Ana Diaz')); expect(onOpen).toHaveBeenCalledWith('p1');
});
