'use client';
/**
 * ThemeProvider — reads the agent's accent preference from user_kv on
 * mount and applies it to <html> as CSS variables. Also listens for a
 * window 'prim:accent-changed' event so the Profile hub can broadcast
 * live previews and saves without a full reload.
 *
 * Sits high in the tree (just inside AuthProvider) so the accent is
 * applied before any visible UI paints.
 */
import { useEffect } from 'react';
import { loadAgentProfile, applyAccentToDOM } from '@/lib/agentProfile';

export default function ThemeProvider({ children }) {
  useEffect(() => {
    let alive = true;
    loadAgentProfile().then((p) => {
      if (!alive) return;
      applyAccentToDOM(p.accent);
    });

    // Listen for live-preview events from the Profile Appearance picker.
    const onAccentChange = (e) => {
      const id = e?.detail?.accent;
      if (id) applyAccentToDOM(id);
    };
    window.addEventListener('prim:accent-changed', onAccentChange);
    return () => {
      alive = false;
      window.removeEventListener('prim:accent-changed', onAccentChange);
    };
  }, []);

  return children;
}
