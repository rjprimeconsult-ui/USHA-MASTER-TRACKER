/**
 * Per-agent custom values for the three free-text lead dropdowns:
 * Lead Category, CRM, and Campaign. Lets agents add their own
 * options without requiring a code change.
 *
 * Stored under `custom_lead_options_v1` via the cloud-aware storage
 * adapter so adds sync across devices.
 *
 * Shape on disk:
 *   {
 *     leadCategories: ['MY CUSTOM CAT', ...],
 *     crms:           ['MY CUSTOM CRM', ...],
 *     campaigns:      ['MY CUSTOM CAMPAIGN', ...],
 *   }
 *
 * Each entry is a free-text string. Built-in options live in
 * src/lib/constants.js and are NEVER mutated — users add to the list,
 * they don't override built-ins.
 *
 * Custom IDs render as plain string labels (no color / badge metadata)
 * so the form stays simple. If we ever want colored custom values,
 * extend the shape to objects like { id, color } the same way
 * customCategories.js does.
 */

import { useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import { storage } from './storage';
import { LEAD_CATEGORIES, CRMS, CAMPAIGNS } from './constants';

export const CUSTOM_LEAD_OPTIONS_KEY = 'custom_lead_options_v1';

const EMPTY = { leadCategories: [], crms: [], campaigns: [] };

// ---- Cross-instance shared store -----------------------------------------
// Every useLeadOptionsAll() consumer (Closed Deals, Portal Clients, the lead
// editor, …) reads from ONE shared snapshot. A custom option added in any view
// is broadcast to all the others immediately — no remount, no "do it again".
let _cachedMap = null;
const _listeners = new Set();
function _emit() { for (const cb of [..._listeners]) { try { cb(); } catch { /* ignore */ } } }
function _subscribe(cb) { _listeners.add(cb); return () => { _listeners.delete(cb); }; }
function _getSnapshot() { return _cachedMap || EMPTY; }
async function _refreshFromStorage() {
  _cachedMap = await loadCustomLeadOptions();
  _emit();
  return _cachedMap;
}

export async function loadCustomLeadOptions() {
  try {
    const raw = await storage.getItem(CUSTOM_LEAD_OPTIONS_KEY);
    if (!raw) return { ...EMPTY };
    const obj = JSON.parse(raw);
    return {
      leadCategories: Array.isArray(obj?.leadCategories) ? obj.leadCategories.filter(Boolean) : [],
      crms:           Array.isArray(obj?.crms)           ? obj.crms.filter(Boolean)           : [],
      campaigns:      Array.isArray(obj?.campaigns)      ? obj.campaigns.filter(Boolean)      : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveCustomLeadOptions(map) {
  try {
    await storage.setItem(CUSTOM_LEAD_OPTIONS_KEY, JSON.stringify(map || EMPTY));
    _cachedMap = map || { ...EMPTY };
    _emit(); // every mounted useLeadOptionsAll() instance re-renders with the new option
    return true;
  } catch {
    return false;
  }
}

/** Add a value to one of the lists. Idempotent — duplicate adds are no-ops. */
export async function addCustomLeadOption(field, value) {
  if (!['leadCategories', 'crms', 'campaigns'].includes(field)) return null;
  const v = String(value || '').trim();
  if (!v) return null;
  const current = await loadCustomLeadOptions();
  // Don't duplicate against built-ins or existing customs (case-insensitive)
  const builtIns = field === 'leadCategories' ? LEAD_CATEGORIES.map(c => c.id)
                  : field === 'crms'           ? CRMS.map(c => c.id)
                  :                              CAMPAIGNS.map(c => c.id);
  const all = [...builtIns, ...(current[field] || [])];
  if (all.some(x => String(x).toLowerCase() === v.toLowerCase())) return current;
  const next = { ...current, [field]: [...(current[field] || []), v] };
  await saveCustomLeadOptions(next);
  return next;
}

export async function removeCustomLeadOption(field, value) {
  if (!['leadCategories', 'crms', 'campaigns'].includes(field)) return null;
  const current = await loadCustomLeadOptions();
  const next = { ...current, [field]: (current[field] || []).filter(v => v !== value) };
  await saveCustomLeadOptions(next);
  return next;
}

/**
 * Hook: returns merged option lists (built-in + custom) for all three
 * fields, plus the raw custom map and a refresh fn for after edits.
 */
export function useLeadOptionsAll() {
  // All instances read from the SAME shared snapshot, so a custom option added
  // in one view shows up in every other view instantly.
  const customMap = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);

  // Refresh from THIS user's storage on mount (keeps the shared cache current
  // across devices / account switches) and whenever a consumer asks.
  const reload = useCallback(() => _refreshFromStorage(), []);
  useEffect(() => { reload(); }, [reload]);

  // Merged lists — built-ins first, customs after, so dropdowns render
  // the familiar values at the top with custom additions below.
  const leadCategories = useMemo(
    () => [
      ...LEAD_CATEGORIES.map(c => ({ id: c.id, custom: false })),
      ...(customMap.leadCategories || []).map(id => ({ id, custom: true })),
    ],
    [customMap.leadCategories]
  );
  const crms = useMemo(
    () => [
      ...CRMS.map(c => ({ id: c.id, custom: false })),
      ...(customMap.crms || []).map(id => ({ id, custom: true })),
    ],
    [customMap.crms]
  );
  const campaigns = useMemo(
    () => [
      ...CAMPAIGNS.map(c => ({ id: c.id, custom: false })),
      ...(customMap.campaigns || []).map(id => ({ id, custom: true })),
    ],
    [customMap.campaigns]
  );

  return { leadCategories, crms, campaigns, customMap, reload };
}

// Sentinel value used in dropdowns to trigger the "Add custom..." prompt.
// Any string a user might legitimately enter would collide if we used
// something normal — using a NUL-prefixed token guarantees uniqueness.
export const ADD_CUSTOM_VALUE = '__ADD_CUSTOM__';
