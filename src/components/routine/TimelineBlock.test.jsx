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

test('the slate dot appears only on past-unchecked: a current title segment has none', () => {
  const { container } = render(<TimelineBlock {...props} item={seg(510, 630, { isTitle: true, index: 0 })} visual="current" />);
  expect(screen.getByRole('checkbox')).toBeTruthy();
  expect(container.querySelector('[data-dot]')).toBeNull();
});

test('follow-up cap bites: a 120-min block has room for 9 rows (floor((240−58)/20)) but shows exactly 4 and "+10 more"', () => {
  const fb = { ...block, id: 'f2', name: 'Follow-up queue', category: 'followup', paletteId: 'followup', startMin: 675, durationMin: 120 };
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: 'p' + i, name: 'Name ' + i, age: `${i}d` }));
  const item = { kind: 'segment', blockId: 'f2', block: fb, name: fb.name, category: 'followup', startMin: 675, endMin: 795, isTitle: true, index: 0, done: null };
  render(<TimelineBlock {...props} item={item} followupRows={rows} followupCount={14} />);
  expect(screen.getAllByText(/^Name /).length).toBe(4);
  expect(screen.getByText('+10 more')).toBeTruthy();
});

test('accent ring on the current segment only: a split block with now inside the second segment', () => {
  const first = seg(510, 540, { id: 'b1#0', isTitle: false, isFirst: true, isLast: false, index: 0 });
  const second = seg(570, 630, { id: 'b1#1', isTitle: true, isFirst: false, isLast: true, index: 1 });
  const { container } = render(
    <div>
      <TimelineBlock {...props} item={first} visual="current" nowMin={582} />
      <TimelineBlock {...props} item={second} visual="current" nowMin={582} />
    </div>,
  );
  const roots = container.querySelectorAll('[data-item-id]');
  // the pinned `ring-1 ring-accent` — a bare class token, not the focus-visible variant every block carries
  const ringed = (el) => /(^|\s)ring-accent(\s|$)/.test(el.className) && /(^|\s)ring-1(\s|$)/.test(el.className);
  expect(roots.length).toBe(2);
  expect(ringed(roots[0])).toBe(false);
  expect(ringed(roots[1])).toBe(true);
});

test('the follow-up count opens the names sheet from any tier — the only route on a block that is not current or next', () => {
  const fb = { ...block, id: 'f1', name: 'Follow-up queue', category: 'followup', paletteId: 'followup', startMin: 675, durationMin: 120 };
  const item = { kind: 'segment', blockId: 'f1', block: fb, name: fb.name, category: 'followup', startMin: 675, endMin: 795, isTitle: true, index: 0, done: null };
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: 'p' + i, name: 'Name ' + i, age: `${i}d` }));

  // compact: no name rows and no "+N more", so the count is the only door to the sheet.
  const onNames = vi.fn();
  const { container, rerender } = render(<TimelineBlock {...props} item={item} tier="compact" followupRows={rows} followupCount={14} onNames={onNames} />);
  expect(screen.queryAllByText(/^Name /).length).toBe(0);
  expect(screen.queryByText('+10 more')).toBeNull();
  const countBtn = screen.getByRole('button', { name: 'Show 14 follow-ups' });
  expect(countBtn.className).toContain('text-slate-400');
  fireEvent.click(countBtn);
  expect(onNames).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0);

  // clicking the count must not also open the editor behind it
  const onOpen = vi.fn();
  rerender(<TimelineBlock {...props} item={item} tier="compact" followupRows={rows} followupCount={14} onNames={onNames} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show 14 follow-ups' }));
  expect(onOpen).not.toHaveBeenCalled();

  // an empty queue has nothing to show, so the count is inert text
  rerender(<TimelineBlock {...props} item={item} tier="compact" followupRows={[]} followupCount={0} onNames={onNames} />);
  // the block root is itself role="button" and carries the block name, so match the count's own label
  expect(screen.queryByRole('button', { name: /^Show \d+ follow-up/ })).toBeNull();
  expect(screen.getByText('0')).toBeTruthy();
});
