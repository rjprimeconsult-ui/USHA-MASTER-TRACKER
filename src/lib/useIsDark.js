'use client';
/**
 * useIsDark — small hook that returns true when dark mode is active.
 *
 * Reads `document.documentElement.classList.contains('dark')` on mount
 * and re-reads whenever a `prim:theme-changed` event fires from the
 * Profile Appearance toggle, or when the OS prefers-color-scheme
 * changes (the ThemeProvider syncs in that case too).
 *
 * Used by chart components (recharts) to swap hardcoded grid/label
 * colors that look great in light mode but disappear on a dark
 * canvas. Returning a boolean keeps callsites simple — they just
 * pick the right color for the active theme.
 */
import { useEffect, useState } from 'react';

export function useIsDark() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    // Theme can change via three paths — listen to all of them.
    window.addEventListener('prim:theme-changed', update);
    const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    mql?.addEventListener?.('change', update);
    // Also observe the class attribute directly so any other code that
    // toggles `.dark` (e.g. dev tools, browser extensions) is picked up.
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('prim:theme-changed', update);
      mql?.removeEventListener?.('change', update);
      obs.disconnect();
    };
  }, []);

  return isDark;
}

/**
 * Theme-aware color palette for chart components. Centralizing these
 * so the values stay consistent across Dashboard / CpaDashboard /
 * AssociationsView / ClosedDeals.
 */
export function useChartColors() {
  const isDark = useIsDark();
  return {
    grid:       isDark ? '#334155' : '#e2e8f0', // CartesianGrid stroke
    label:      isDark ? '#E2E8F0' : '#0f172a', // LabelList fill (bold numbers next to bars)
    axisText:   isDark ? '#94A3B8' : '#475569', // axis tick labels
    tooltipBg:  isDark ? '#1F2945' : '#ffffff',
    tooltipBorder: isDark ? '#3A476B' : '#e2e8f0',
    tooltipText:   isDark ? '#F1F5F9' : '#0f172a',
  };
}
