'use client';
/**
 * ThemeProvider — applies the agent's appearance settings (accent
 * palette + light/dark theme) to <html> on mount and keeps them in
 * sync with live previews from the Profile hub.
 *
 *   - On mount: reads loadAgentProfile() and applies both.
 *   - Listens for 'prim:accent-changed' (live palette preview).
 *   - Listens for 'prim:theme-changed' (live theme preview).
 *   - Listens for OS prefers-color-scheme changes when theme === 'system'.
 *
 * Mounted high in the tree (inside AuthProvider) so the appearance is
 * applied before any visible UI paints.
 */
import { useEffect } from 'react';
import { loadAgentProfile, applyAccentToDOM, applyThemeToDOM } from '@/lib/agentProfile';

export default function ThemeProvider({ children }) {
  useEffect(() => {
    let alive = true;
    loadAgentProfile().then((p) => {
      if (!alive) return;
      applyAccentToDOM(p.accent);
      applyThemeToDOM(p.theme);
    });

    const onAccentChange = (e) => {
      const id = e?.detail?.accent;
      if (id) applyAccentToDOM(id);
    };
    const onThemeChange = (e) => {
      const t = e?.detail?.theme;
      if (t) applyThemeToDOM(t);
    };
    window.addEventListener('prim:accent-changed', onAccentChange);
    window.addEventListener('prim:theme-changed', onThemeChange);

    // Track OS-level color-scheme changes; only re-apply when the agent
    // is on 'system' (read live from the html dataset that
    // applyThemeToDOM sets).
    const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const pref = document.documentElement.dataset.themePref;
      if (pref === 'system') applyThemeToDOM('system');
    };
    mql?.addEventListener?.('change', onSystemChange);

    return () => {
      alive = false;
      window.removeEventListener('prim:accent-changed', onAccentChange);
      window.removeEventListener('prim:theme-changed', onThemeChange);
      mql?.removeEventListener?.('change', onSystemChange);
    };
  }, []);

  return children;
}
