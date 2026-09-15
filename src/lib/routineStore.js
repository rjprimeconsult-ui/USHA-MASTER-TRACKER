/**
 * Routine Builder storage adapter (spec §4). Three user_kv documents; every
 * write is a JSON string. The two arrays are in MERGEABLE_KEYS, so a save
 * merges newest-wins by record id (mergeStore.mjs).
 *
 * Blocks and settings are sanitized here. The day array is NOT — see loadRoutine.
 */
import { storage } from './storage';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY } from './routineKeys.mjs';
import { sanitizeBlocks, sanitizeSettings } from './routineModel.mjs';

async function readJson(key) {
  try { const raw = await storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// Returns `dayRaw` UNSANITIZED, on purpose. sanitizeDay prunes everything older than
// `today − 7` (§4b) and `today` depends on routine_settings_v1.timezone — which this call
// is what reads. Sanitizing here would have to guess a zone (the device's), and whenever
// that guess runs ahead of the configured zone the floor lands a day late: the oldest
// still-in-window day is dropped and the next commitDay persists the deletion. The caller
// sanitizes once the settings zone is resolved, so the prune floor and every later
// commitDay share one zone (RoutineView's load effect).
export async function loadRoutine({ nowIso }) {
  const [blocksRaw, dayRaw, settingsRaw] = await Promise.all([readJson(ROUTINE_BLOCKS_KEY), readJson(ROUTINE_DAY_KEY), readJson(ROUTINE_SETTINGS_KEY)]);
  return {
    blocks: sanitizeBlocks(Array.isArray(blocksRaw) ? blocksRaw : [], nowIso),
    dayRaw: Array.isArray(dayRaw) ? dayRaw : [],
    settings: sanitizeSettings(settingsRaw),
  };
}
export async function saveBlocks(blocks) { await storage.setItem(ROUTINE_BLOCKS_KEY, JSON.stringify(blocks)); return blocks; }
export async function saveDay(records) { await storage.setItem(ROUTINE_DAY_KEY, JSON.stringify(records)); return records; }
export async function saveSettings(settings) { const safe = sanitizeSettings(settings); await storage.setItem(ROUTINE_SETTINGS_KEY, JSON.stringify(safe)); return safe; }
