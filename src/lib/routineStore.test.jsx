import { test, expect, vi, beforeEach } from 'vitest';
const mem = vi.hoisted(() => new Map());
const fail = vi.hoisted(() => new Set());
vi.mock('@/lib/storage', () => ({
  storage: {
    getItem: async (k) => { if (fail.has(k)) throw new Error('boom'); return mem.has(k) ? mem.get(k) : null; },
    setItem: async (k, v) => { mem.set(k, v); return true; },
    removeItem: async (k) => { mem.delete(k); },
  },
}));
import { loadRoutine, saveBlocks, saveDay, saveSettings } from './routineStore';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY } from './routineKeys.mjs';

beforeEach(() => { mem.clear(); fail.clear(); });
const NOW = '2026-09-08T15:00:00.000Z';

test('loadRoutine: empty store → [] / [] / default settings (timezone null)', async () => {
  const r = await loadRoutine({ today: '2026-09-08', nowIso: NOW });
  expect(r.blocks).toEqual([]); expect(r.day).toEqual([]); expect(r.settings.timezone).toBe(null); expect(r.settings.activeDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

test('save* write strings; loadRoutine sanitizes and tolerates corrupt JSON', async () => {
  await saveBlocks([{ id: 'blk_aaaaaaa', name: 'X', paletteId: 'dial', category: 'dial', startMin: 482, durationMin: 60, remind: { enabled: true, minutesBefore: 5 }, note: '', deletedAt: null, createdAt: NOW, updatedAt: NOW }]);
  expect(typeof mem.get(ROUTINE_BLOCKS_KEY)).toBe('string');
  await saveDay([{ id: '2026-09-08|blk_aaaaaaa', kind: 'done', day: '2026-09-08', blockId: 'blk_aaaaaaa', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null }]);
  await saveSettings({ timezone: 'America/Chicago', defaultMinutesBefore: 12, junk: true });
  const r = await loadRoutine({ today: '2026-09-08', nowIso: NOW });
  expect(r.blocks[0].startMin).toBe(480); expect(r.day.length).toBe(1); expect(r.settings.defaultMinutesBefore).toBe(10); expect('junk' in r.settings).toBe(false);
  mem.set(ROUTINE_DAY_KEY, '{oops');
  const r2 = await loadRoutine({ today: '2026-09-08', nowIso: NOW });
  expect(r2.day).toEqual([]);
  expect(mem.has(ROUTINE_SETTINGS_KEY)).toBe(true);
});

test('corrupt settings default safely; a throwing storage read never rejects loadRoutine', async () => {
  mem.set(ROUTINE_SETTINGS_KEY, '{oops');
  const r = await loadRoutine({ today: '2026-09-08', nowIso: NOW });
  expect(r.settings.timezone).toBe(null);
  fail.add(ROUTINE_BLOCKS_KEY);
  await expect(loadRoutine({ today: '2026-09-08', nowIso: NOW })).resolves.toMatchObject({ blocks: [] });
});
