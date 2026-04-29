/**
 * Vendor memory — learns from manual corrections in Smart Import.
 *
 * Map shape: { [normalizedVendor]: { direction, category, platformId?, hits, lastSeen } }
 *   - direction: 'expense' | 'income' | 'platform'
 *   - category:  EXPENSE_CATEGORIES | INCOME_CATEGORIES (omitted when direction='platform')
 *   - platformId: 'TD' | 'RINGY' | 'VANILLA' (only when direction='platform')
 *   - hits: how many times the user has confirmed this mapping (used to decay
 *     stale entries if we ever exceed the prompt budget)
 *   - lastSeen: ISO date — newest entries win when we send hints to the AI
 *
 * Stored under `vendor_memory_v1` via the cloud-aware storage adapter, so
 * corrections sync across devices for signed-in users.
 *
 * Used in two places:
 *   1. Client side — SmartImportWizard pre-fills extracted rows that match
 *      memory exactly (so a vendor you've corrected once never gets the AI's
 *      guess again).
 *   2. Server side — the AI route receives a compact "USER PREFERENCES" hint
 *      list so even fuzzy / new-variant vendors line up with how the user
 *      categorizes things.
 */

import { storage } from './storage';

export const VENDOR_MEMORY_KEY = 'vendor_memory_v1';

/**
 * Normalize a vendor string for lookup.
 * Lowercase, collapse whitespace, strip transaction codes / store numbers /
 * trailing reference IDs that change every charge.
 */
export function normalizeVendor(raw) {
  if (!raw) return '';
  let s = String(raw).toLowerCase().trim();
  // Strip leading/trailing transaction noise: "tst* ", "sq *", "pos ", "debit "
  s = s.replace(/^(tst\*|sq\s*\*|pos\s+|debit\s+|credit\s+|purchase\s+|payment\s+to\s+)/i, '');
  // Strip store numbers like "#1234", "store 5512", "#12345-6"
  s = s.replace(/\s*#\s*\d{2,}/g, '');
  s = s.replace(/\bstore\s+\d{2,}\b/gi, '');
  // Strip trailing reference numbers / dates
  s = s.replace(/\s+\d{6,}\b/g, '');
  s = s.replace(/\s+\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/, '');
  // Common payment-processor prefixes
  s = s.replace(/^(amzn\s*mktp\s+us|amazon\s*mktpl|amazon\.com|amzn\.com\/bill)/i, 'amazon');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export async function loadVendorMemory() {
  try {
    const raw = await storage.getItem(VENDOR_MEMORY_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export async function saveVendorMemory(map) {
  try {
    await storage.setItem(VENDOR_MEMORY_KEY, JSON.stringify(map || {}));
    return true;
  } catch {
    return false;
  }
}

/**
 * Look up an entry by raw vendor (handles normalization). Returns the memory
 * entry or null.
 */
export function lookupVendor(map, rawVendor) {
  if (!map || !rawVendor) return null;
  const key = normalizeVendor(rawVendor);
  if (!key) return null;
  const entry = map[key];
  return entry || null;
}

/**
 * Record / upsert a confirmed mapping.
 *   recordVendor(map, { vendor, direction, category })             -> books row
 *   recordVendor(map, { vendor, direction: 'platform', platformId }) -> platform row
 * Returns the (mutated) map.
 */
export function recordVendor(map, { vendor, direction, category, platformId }) {
  if (!map) map = {};
  const key = normalizeVendor(vendor);
  if (!key) return map;
  const existing = map[key];
  const hits = (existing?.hits || 0) + 1;
  map[key] = {
    direction,
    ...(category ? { category } : {}),
    ...(platformId ? { platformId } : {}),
    hits,
    lastSeen: new Date().toISOString(),
  };
  return map;
}

/**
 * Pull the most recently confirmed N entries — the AI route gets this list
 * so it mimics the user's own categorizing style on new vendors that look
 * similar to ones they've seen.
 *
 * Returns an array of { vendor, direction, category?, platformId? }
 * sorted newest-first.
 */
export function vendorMemoryToHints(map, max = 60) {
  if (!map) return [];
  const entries = Object.entries(map)
    .map(([vendor, v]) => ({
      vendor,
      direction: v.direction,
      category: v.category,
      platformId: v.platformId,
      hits: v.hits || 1,
      lastSeen: v.lastSeen || '',
    }))
    .sort((a, b) => {
      // Sort by hits desc (sticky favorites), then lastSeen desc
      if (b.hits !== a.hits) return b.hits - a.hits;
      return (b.lastSeen || '').localeCompare(a.lastSeen || '');
    })
    .slice(0, max);
  return entries.map(({ vendor, direction, category, platformId }) => ({
    vendor, direction, ...(category ? { category } : {}), ...(platformId ? { platformId } : {}),
  }));
}
