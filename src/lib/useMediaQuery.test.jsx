import { test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

test('reads matchMedia and follows change events', () => {
  let listener = null; let matches = false;
  vi.stubGlobal('matchMedia', (q) => ({ matches, media: q, addEventListener: (_, fn) => { listener = fn; }, removeEventListener: () => { listener = null; } }));
  const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 640px)'));
  expect(result.current).toBe(false);
  act(() => { matches = true; listener({ matches: true }); });
  expect(result.current).toBe(true);
  unmount(); expect(listener).toBe(null);
});

test('query change re-subscribes: old listener removed, new one added', () => {
  const added = []; const removed = [];
  vi.stubGlobal('matchMedia', (q) => ({
    matches: false,
    media: q,
    addEventListener: () => { added.push(q); },
    removeEventListener: () => { removed.push(q); },
  }));
  const { rerender } = renderHook(({ query }) => useMediaQuery(query), { initialProps: { query: '(min-width: 640px)' } });
  expect(added).toEqual(['(min-width: 640px)']);
  rerender({ query: '(min-width: 768px)' });
  expect(removed).toEqual(['(min-width: 640px)']);
  expect(added).toEqual(['(min-width: 640px)', '(min-width: 768px)']);
});
