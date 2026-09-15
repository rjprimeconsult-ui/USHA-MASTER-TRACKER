'use client';
import { useEffect, useState } from 'react';
// One breakpoint split for the whole view (spec §7a): 640 = Tailwind `sm:` =
// the breakpoint GlassModal's `sheet` keys on. Guarded for SSR.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const update = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}
