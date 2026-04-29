/**
 * Custom expense / income categories — user-defined buckets that merge
 * into the built-in EXPENSE_CATEGORIES / INCOME_CATEGORIES at runtime.
 *
 * Stored under `custom_categories_v1` via the cloud-aware storage adapter
 * so adds/edits sync across devices for signed-in users.
 *
 * Shape on disk:
 *   {
 *     expense: [{ id, label, color, badge, custom: true }, ...],
 *     income:  [{ id, label, color, badge, custom: true }, ...],
 *   }
 *
 * Built-in categories live in src/lib/constants.js and are NEVER mutated —
 * users can only add, rename, recolor, or delete THEIR OWN entries. The
 * merged list (built-in followed by custom) is what the UI + AI route see.
 *
 * IDs are prefixed `CUSTOM_` so they never collide with built-in IDs and
 * are easy to spot in saved expense rows. Once a category ID is in use,
 * deleting the category re-tags affected rows to OTHER_EXPENSE / OTHER_INCOME
 * (handled by the manager UI before the delete commits).
 */

import { useEffect, useState, useMemo } from 'react';
import { storage } from './storage';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './constants';

export const CUSTOM_CATEGORIES_KEY = 'custom_categories_v1';

// Tailwind badge presets keyed by hex — keeps custom badges visually
// consistent with the built-ins. The palette doubles as the picker swatches.
export const CATEGORY_COLOR_PALETTE = [
  { color: '#dc2626', badge: 'bg-red-100 text-red-700',         label: 'Red' },
  { color: '#f97316', badge: 'bg-orange-100 text-orange-700',   label: 'Orange' },
  { color: '#f59e0b', badge: 'bg-amber-100 text-amber-700',     label: 'Amber' },
  { color: '#84cc16', badge: 'bg-lime-100 text-lime-700',       label: 'Lime' },
  { color: '#10b981', badge: 'bg-emerald-100 text-emerald-700', label: 'Emerald' },
  { color: '#06b6d4', badge: 'bg-cyan-100 text-cyan-700',       label: 'Cyan' },
  { color: '#0ea5e9', badge: 'bg-sky-100 text-sky-700',         label: 'Sky' },
  { color: '#3b82f6', badge: 'bg-blue-100 text-blue-700',       label: 'Blue' },
  { color: '#6366f1', badge: 'bg-indigo-100 text-indigo-700',   label: 'Indigo' },
  { color: '#8b5cf6', badge: 'bg-violet-100 text-violet-700',   label: 'Violet' },
  { color: '#a855f7', badge: 'bg-purple-100 text-purple-700',   label: 'Purple' },
  { color: '#d946ef', badge: 'bg-fuchsia-100 text-fuchsia-700', label: 'Fuchsia' },
  { color: '#ec4899', badge: 'bg-pink-100 text-pink-700',       label: 'Pink' },
  { color: '#e11d48', badge: 'bg-rose-100 text-rose-700',       label: 'Rose' },
  { color: '#64748b', badge: 'bg-slate-100 text-slate-700',     label: 'Slate' },
];

// Map a hex color to its Tailwind badge class. Falls back to slate if
// somebody saved a free-form hex outside the palette.
export function badgeForColor(color) {
  const hit = CATEGORY_COLOR_PALETTE.find(p => p.color.toLowerCase() === String(color || '').toLowerCase());
  return hit?.badge || 'bg-slate-100 text-slate-700';
}

const EMPTY = { expense: [], income: [] };

export async function loadCustomCategories() {
  try {
    const raw = await storage.getItem(CUSTOM_CATEGORIES_KEY);
    if (!raw) return { ...EMPTY };
    const obj = JSON.parse(raw);
    return {
      expense: Array.isArray(obj?.expense) ? obj.expense : [],
      income:  Array.isArray(obj?.income)  ? obj.income  : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveCustomCategories(map) {
  try {
    await storage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(map || EMPTY));
    return true;
  } catch {
    return false;
  }
}

// Generate a stable, collision-resistant ID for a custom category.
// Uppercase + safe chars only so it reads cleanly in saved rows.
export function makeCustomCategoryId(label) {
  const slug = String(label || 'category')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'CATEGORY';
  // 5-char random suffix — collision odds vanishing for individual users
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CUSTOM_${slug}_${suffix}`;
}

/**
 * Hook: returns the merged (built-in + custom) category list for a given
 * direction, plus a `reload` function and the raw custom map.
 *
 *   const { expense, income, customMap, reload } = useCategoriesAll();
 */
export function useCategoriesAll() {
  const [customMap, setCustomMap] = useState(EMPTY);

  const reload = useMemo(() => async () => {
    const next = await loadCustomCategories();
    setCustomMap(next);
    return next;
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const expense = useMemo(() => mergeCategories(EXPENSE_CATEGORIES, customMap.expense), [customMap.expense]);
  const income  = useMemo(() => mergeCategories(INCOME_CATEGORIES,  customMap.income),  [customMap.income]);

  return { expense, income, customMap, reload };
}

// Built-in entries first, then customs. "Other" is always pinned last so
// the catch-all stays at the bottom of dropdowns and the grid.
function mergeCategories(builtin, customs) {
  const otherIdx = builtin.findIndex(c => c.id === 'OTHER_EXPENSE' || c.id === 'OTHER_INCOME');
  if (otherIdx === -1) return [...builtin, ...customs];
  const head = builtin.slice(0, otherIdx);
  const tail = builtin.slice(otherIdx);
  return [...head, ...customs, ...tail];
}
