/**
 * WeeklyLookback (spec §7h.5): collapsed copy, seven bars on expand with the
 * pinned height formula, and never a number on a bar.
 */
import { test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WeeklyLookback from './WeeklyLookback';
test('collapsed copy, expands to seven bars, no numbers on bars', () => {
  const week = { total: 130, days: Array.from({ length: 7 }, (_, i) => ({ day: `2026-09-0${i + 1}`, minutes: i === 6 ? 120 : i === 3 ? 10 : 0 })) };
  const { container } = render(<WeeklyLookback week={week} />);
  expect(screen.getByText('This week · 2h 10m not done')).toBeTruthy();
  expect(container.querySelectorAll('[data-bar]').length).toBe(0);
  fireEvent.click(screen.getByRole('button'));
  const bars = container.querySelectorAll('[data-bar]'); expect(bars.length).toBe(7);
  expect(bars[6].style.height).toBe('35.2px'); expect(bars[0].style.height).toBe('2px');
  expect(container.textContent.includes('120')).toBe(false);
});
