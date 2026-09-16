/**
 * Component tests for FollowupDueWidget's bulk "Clear overdue backlog"
 * control (the operator had 196 overdue rows — this is the one control
 * that clears them so the widget is meaningful again).
 *
 * Pinned behavior:
 *   - the button is gated on onBulkCadence + !readOnly + at least one
 *     overdue row (due_today alone must NOT show it)
 *   - both bulk actions are scoped to overdue rows ONLY — a due_today
 *     row's id must never appear in the onBulkCadence call, even when
 *     it sits in the same prospects array
 *   - clicking the button must never toggle the collapsible header
 *     (stopPropagation) — this is why the header can no longer be a
 *     literal <button> wrapping another <button>; see the component's
 *     own comment on the role="button" div for the hydration reason.
 *
 * Time is frozen with fake timers so dueStatus's real `now` (computed
 * inside the widget's own useMemo, not a prop) is deterministic. The
 * due_today fixture uses nextDueAt === NOW_ISO exactly so the
 * calendar-day match can never depend on the test runner's local TZ.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import FollowupDueWidget from './FollowupDueWidget';
import { DEFAULT_PLAYBOOK } from '@/lib/followupEngine.mjs';

const NOW_ISO = '2026-09-15T18:00:00.000Z';
const OVERDUE_DUE_AT = '2026-09-01T18:00:00.000Z'; // 14 days before NOW_ISO, TZ-proof

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => { vi.useRealTimers(); });

function overdueProspect(id, name) {
  return {
    id, name, stage: 'GHOSTED', archivedAt: null, touchLog: [],
    cadence: { stepIndex: 0, nextDueAt: OVERDUE_DUE_AT, snoozedUntil: null, completedAt: null },
  };
}
function dueTodayProspect(id, name) {
  return {
    id, name, stage: 'GHOSTED', archivedAt: null, touchLog: [],
    // Exact match with the frozen "now" so this is due_today regardless of TZ.
    cadence: { stepIndex: 0, nextDueAt: NOW_ISO, snoozedUntil: null, completedAt: null },
  };
}

function widget(props = {}) {
  return render(
    <FollowupDueWidget
      prospects={[]}
      playbook={DEFAULT_PLAYBOOK}
      onOpenProspect={vi.fn()}
      defaultCollapsed={false}
      {...props}
    />
  );
}

const bulkButton = (n) => screen.getByRole('button', { name: new RegExp(`^Clear ${n} overdue$`) });

// ---- gating ----

test('renders nothing at all with no rows', () => {
  const { container } = widget({ prospects: [] });
  expect(container.innerHTML).toBe('');
});

// NOTE: matched with the exact "Clear N overdue" pattern, not a loose
// /overdue/i — every ROW button's accessible name also contains "overdue"
// (e.g. "A 14d overdue Next: Text"), so a loose match would pass even if
// the bulk button rendering were broken.
const anyBulkButton = () => screen.queryByRole('button', { name: /^Clear \d+ overdue$/ });

test('bulk button is absent when onBulkCadence is not supplied', () => {
  widget({ prospects: [overdueProspect('p1', 'A')] });
  expect(anyBulkButton()).toBeNull();
});

test('bulk button is absent when readOnly is true', () => {
  widget({ prospects: [overdueProspect('p1', 'A')], onBulkCadence: vi.fn(), readOnly: true });
  expect(anyBulkButton()).toBeNull();
});

test('bulk button is absent when every row is due_today (no overdue rows)', () => {
  widget({ prospects: [dueTodayProspect('p1', 'A')], onBulkCadence: vi.fn() });
  expect(anyBulkButton()).toBeNull();
});

test('bulk button appears labelled with the overdue count when eligible', () => {
  widget({
    prospects: [overdueProspect('p1', 'A'), overdueProspect('p2', 'B'), dueTodayProspect('p3', 'C')],
    onBulkCadence: vi.fn(),
  });
  expect(bulkButton(2)).toBeTruthy();
});

// ---- collapse isolation ----

test('clicking the bulk button opens the modal without collapsing or expanding the widget', () => {
  const { container } = widget({
    prospects: [overdueProspect('p1', 'A'), dueTodayProspect('p2', 'B')],
    onBulkCadence: vi.fn(),
    defaultCollapsed: false,
  });
  const header = container.querySelector('[aria-expanded]');
  expect(header.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(bulkButton(1));
  // Still expanded — the row list is still in the document.
  expect(header.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('A')).toBeTruthy();
  // The confirmation modal is open.
  expect(screen.getByText(/Snooze a week/i)).toBeTruthy();
});

// ---- action scoping and payload ----

test('choosing "Snooze a week" calls onBulkCadence with exactly the overdue ids and snooze7', () => {
  const onBulkCadence = vi.fn();
  widget({
    prospects: [overdueProspect('p1', 'A'), overdueProspect('p2', 'B'), dueTodayProspect('p3', 'C')],
    onBulkCadence,
  });
  fireEvent.click(bulkButton(2));
  fireEvent.click(screen.getByRole('button', { name: /^Snooze a week/i }));
  expect(onBulkCadence).toHaveBeenCalledTimes(1);
  const [ids, action] = onBulkCadence.mock.calls[0];
  expect(new Set(ids)).toEqual(new Set(['p1', 'p2']));
  expect(ids).not.toContain('p3');
  expect(action).toBe('snooze7');
});

test('choosing "Clear them" calls onBulkCadence with exactly the overdue ids and clear', () => {
  const onBulkCadence = vi.fn();
  widget({
    prospects: [overdueProspect('p1', 'A'), overdueProspect('p2', 'B'), dueTodayProspect('p3', 'C')],
    onBulkCadence,
  });
  fireEvent.click(bulkButton(2));
  fireEvent.click(screen.getByRole('button', { name: /^Clear them/i }));
  expect(onBulkCadence).toHaveBeenCalledTimes(1);
  const [ids, action] = onBulkCadence.mock.calls[0];
  expect(new Set(ids)).toEqual(new Set(['p1', 'p2']));
  expect(ids).not.toContain('p3');
  expect(action).toBe('clear');
});

test('Cancel closes the modal without calling onBulkCadence', () => {
  const onBulkCadence = vi.fn();
  widget({ prospects: [overdueProspect('p1', 'A')], onBulkCadence });
  fireEvent.click(bulkButton(1));
  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
  expect(onBulkCadence).not.toHaveBeenCalled();
  expect(screen.queryByText(/Snooze a week/i)).toBeNull();
});
