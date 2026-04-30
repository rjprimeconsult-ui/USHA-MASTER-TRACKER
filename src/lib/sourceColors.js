/**
 * Per-agent prospect-source color coding.
 *
 * Lets each agent assign a color to every lead source they use ("Aged
 * Lead", "Bizz Lead", "Referral", etc.) so prospect cards in the Kanban
 * and List views are visually distinguishable at a glance.
 *
 * Stored under `prospect_source_colors_v1` via the cloud-aware storage
 * adapter so colors sync across devices.
 *
 * Shape on disk:
 *   { "Aged Lead": "#10b981", "Bizz Lead": "#3b82f6", ... }
 *
 * Sources keys are the literal strings stored on prospect.source — both
 * the predefined PROSPECT_SOURCES and any free-text values agents enter.
 */

import { useEffect, useState, useMemo } from 'react';
import { storage } from './storage';
import { CATEGORY_COLOR_PALETTE, badgeForColor } from './customCategories';

export const SOURCE_COLORS_KEY = 'prospect_source_colors_v1';

// Palette is shared with custom categories so the visual language stays
// consistent across the whole app. Re-exported here for convenience.
export { CATEGORY_COLOR_PALETTE, badgeForColor };

export async function loadSourceColors() {
  try {
    const raw = await storage.getItem(SOURCE_COLORS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export async function saveSourceColors(map) {
  try {
    await storage.setItem(SOURCE_COLORS_KEY, JSON.stringify(map || {}));
    return true;
  } catch {
    return false;
  }
}

/**
 * Hook: returns the current color map + a reload fn so a manager modal
 * can refresh after saving.
 */
export function useSourceColors() {
  const [colors, setColors] = useState({});

  const reload = useMemo(() => async () => {
    const next = await loadSourceColors();
    setColors(next);
    return next;
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { colors, reload, setColors };
}

/**
 * Lookup the color for a source, with a deterministic fallback so
 * uncolored sources still get a stable hue (instead of all rendering
 * gray and looking the same).
 */
export function colorForSource(map, source) {
  if (!source) return null;
  const explicit = map?.[source];
  if (explicit) return explicit;
  return null;
}

/**
 * Pull every source string actually in use, plus PROSPECT_SOURCES so the
 * manager UI shows built-ins even when no prospect uses them yet.
 */
export function collectSourceLabels(prospects, builtinSources) {
  const set = new Set();
  for (const s of builtinSources || []) if (s) set.add(s);
  for (const p of prospects || []) {
    const s = (p?.source || '').trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
