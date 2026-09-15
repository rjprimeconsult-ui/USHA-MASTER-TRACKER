'use client';
import { useCallback, useSyncExternalStore } from 'react';
// One breakpoint split for the whole view (spec §7a): 640 = Tailwind `sm:` =
// the breakpoint GlassModal's `sheet` keys on. Server snapshot (false) hydrates,
// then React re-renders with the live value — no mismatch, no setState-in-effect.
const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
export function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    if (!canQuery()) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => (canQuery() ? window.matchMedia(query).matches : false), () => false);
}
