/**
 * Routine Builder storage adapter (spec §4). Three user_kv documents; every
 * read is sanitized, every write is a JSON string. The two arrays are in
 * MERGEABLE_KEYS, so a save merges newest-wins by record id (mergeStore.mjs).
 */
import { storage } from './storage';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY } from './routineKeys.mjs';
import { sanitizeBlocks, sanitizeDay, sanitizeSettings } from './routineModel.mjs';

async function readJson(key) {
  try { const raw = await storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function loadRoutine({ today, nowIso }) {
  const [blocksRaw, dayRaw, settingsRaw] = await Promise.all([readJson(ROUTINE_BLOCKS_KEY), readJson(ROUTINE_DAY_KEY), readJson(ROUTINE_SETTINGS_KEY)]);
  return {
    blocks: sanitizeBlocks(Array.isArray(blocksRaw) ? blocksRaw : [], nowIso),
    day: sanitizeDay(Array.isArray(dayRaw) ? dayRaw : [], today, nowIso),
    settings: sanitizeSettings(settingsRaw),
  };
}
export async function saveBlocks(blocks) { await storage.setItem(ROUTINE_BLOCKS_KEY, JSON.stringify(blocks)); return blocks; }
export async function saveDay(records) { await storage.setItem(ROUTINE_DAY_KEY, JSON.stringify(records)); return records; }
export async function saveSettings(settings) { const safe = sanitizeSettings(settings); await storage.setItem(ROUTINE_SETTINGS_KEY, JSON.stringify(safe)); return safe; }
