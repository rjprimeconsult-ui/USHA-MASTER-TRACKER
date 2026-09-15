/**
 * TimelineBlock (spec §7c, §7h.2, §7h.3): title vs non-title segments, the
 * past-unchecked dot, spent-tier fade only when done/skipped, the loss marker
 * as the only amber, and the follow-up block's name rows by tier.
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineBlock from './TimelineBlock';
const block = { id: 'b1', name: 'Dial block', category: 'dial', paletteId: 'dial', startMin: 510, durationMin: 120, remind: { enabled: true, minutesBefore: 5 } };
const seg = (s, e, o) => ({ kind: 'segment', blockId: 'b1', block, name: 'Dial block', category: 'dial', startMin: s, endMin: e, done: null, ...o });
const props = { tier: 'full', visual: 'current', isDark: false, boundsStart: 360, onToggle: vi.fn(), onOpen: vi.fn(), onNames: vi.fn() };

test('title segment carries checkbox, title, bell; a non-title segment shows only its time range and any marker', () => {
  const { container, rerender } = render(<TimelineBlock {...props} item={seg(570, 630, { isTitle: true, index: 1 })} />);
  expect(screen.getByRole('checkbox')).toBeTruthy(); expect(screen.getByText('Dial block')).toBeTruthy(); expect(screen.getByText('9:30–10:30')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox')); expect(props.onToggle).toHaveBeenCalledWith('b1');
  rerender(<TimelineBlock {...props} item={seg(510, 540, { isTitle: false, index: 0 })} marker={{ minutes: 30 }} visual="current" />);
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('Dial block')).toBeNull(); expect(screen.getByText('8:30–9:00')).toBeTruthy();
  const m = screen.getByText('−30m'); expect(m.className).toContain('text-amber-600');
  expect(container.querySelector('[data-dot]')).toBeNull();
});

test('past-unchecked shows the slate dot at full opacity; spent tier fades only when done/skipped', () => {
  const { container, rerender } = render(<TimelineBlock {...props} item={seg(510, 630, { isTitle: true, index: 0 })} tier="spent" visual="past-unchecked" />);
  expect(container.querySelector('[data-dot]')).toBeTruthy(); expect(container.firstChild.style.opacity).not.toBe('0.55');
  rerender(<TimelineBlock {...props} item={seg(510, 630, { isTitle: true, index: 0, done: 'done' })} tier="spent" visual="past-done" />);
  expect(container.firstChild.style.opacity).toBe('0.55');
});

test('follow-up block: ≤ 4 names in full, count only in compact, count is slate not amber; "+N more" and names open the sheet', () => {
  const fb = { ...block, id: 'f1', name: 'Follow-up queue', category: 'followup', paletteId: 'followup', startMin: 675, durationMin: 75 };
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: 'p' + i, name: 'Name ' + i, age: `${i}d` }));
  const item = { kind: 'segment', blockId: 'f1', block: fb, name: fb.name, category: 'followup', startMin: 675, endMin: 750, isTitle: true, index: 0, done: null };
  const { container, rerender } = render(<TimelineBlock {...props} item={item} followupRows={rows} followupCount={14} />);
  expect(screen.getAllByText(/^Name /).length).toBe(4); expect(screen.getByText('14').className).toContain('text-slate-400');
  fireEvent.click(screen.getByText('+10 more')); expect(props.onNames).toHaveBeenCalled();
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0);
  rerender(<TimelineBlock {...props} item={item} tier="compact" followupRows={rows} followupCount={14} />);
  expect(screen.queryAllByText(/^Name /).length).toBe(0); expect(screen.getByText('14')).toBeTruthy();
});
