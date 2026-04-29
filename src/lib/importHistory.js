/**
 * Import audit trail — every Smart Import run gets logged here, with:
 *   - What was uploaded (filename, size, type)
 *   - When it ran
 *   - Counts (transactions / platforms / leads / etc.)
 *   - Token usage + cost estimate
 *   - The raw AI JSON output (so we can re-import or debug a misclassify)
 *
 * Stored under `import_history_v1` via the cloud-aware storage adapter.
 * Capped at MAX_ENTRIES — oldest entries roll off so the storage doesn't
 * grow unbounded.
 *
 * Shape on disk:
 *   { entries: [{ id, kind, filename, size, runAt, counts, usage, raw, fingerprint }, ...] }
 *
 * `kind` — 'expenses' | 'leads' | 'prospects' | 'statement'
 * `raw` — full structured AI output (capped at 200KB per entry to stay
 *         under cloud row size limits)
 * `fingerprint` — { filenamePattern, rowCount, colHints[] } for the
 *                 lightweight format-hint feature in agentLearning.js
 */

import { storage } from './storage';
import { uid } from './utils';

export const IMPORT_HISTORY_KEY = 'import_history_v1';
const MAX_ENTRIES = 50;
const MAX_RAW_BYTES = 200 * 1024; // 200KB

export async function loadImportHistory() {
  try {
    const raw = await storage.getItem(IMPORT_HISTORY_KEY);
    if (!raw) return { entries: [] };
    const obj = JSON.parse(raw);
    return { entries: Array.isArray(obj?.entries) ? obj.entries : [] };
  } catch {
    return { entries: [] };
  }
}

export async function saveImportHistory(history) {
  try {
    const trimmed = {
      entries: (history?.entries || []).slice(0, MAX_ENTRIES),
    };
    await storage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a new entry to the front of the history. Auto-trims raw payload if
 * oversize so we don't exceed the per-row cloud storage limit.
 */
export async function recordImport(entry) {
  const current = await loadImportHistory();
  const safeEntry = {
    id: entry.id || uid(),
    kind: entry.kind || 'expenses',
    filename: String(entry.filename || 'upload').slice(0, 200),
    size: Number(entry.size) || 0,
    runAt: entry.runAt || new Date().toISOString(),
    counts: entry.counts || {},
    usage: entry.usage || null,
    fingerprint: entry.fingerprint || null,
    durationMs: Number(entry.durationMs) || 0,
    error: entry.error || null,
    raw: truncateRaw(entry.raw),
  };
  const next = { entries: [safeEntry, ...current.entries].slice(0, MAX_ENTRIES) };
  await saveImportHistory(next);
  return safeEntry;
}

export async function clearImportHistory() {
  await saveImportHistory({ entries: [] });
}

export async function deleteImportHistoryEntry(id) {
  const current = await loadImportHistory();
  const next = { entries: current.entries.filter(e => e.id !== id) };
  await saveImportHistory(next);
}

function truncateRaw(raw) {
  if (!raw) return null;
  try {
    const str = JSON.stringify(raw);
    if (str.length <= MAX_RAW_BYTES) return raw;
    // Too big — drop the array contents but keep summary so it's still useful
    return {
      _truncated: true,
      _originalSizeBytes: str.length,
      summary: raw.summary || null,
      transactionCount: raw.transactions?.length || 0,
      platformCount: raw.platformExpenses?.length || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Token-usage rollup across the last N imports — drives the "AI cost so
 * far this month" line in Settings. Returns { totalCents, totalTokens,
 * count } for entries with usage data.
 */
export function summarizeUsage(entries, sinceDate) {
  const since = sinceDate ? new Date(sinceDate).getTime() : 0;
  let totalInput = 0, totalCachedRead = 0, totalOutput = 0, count = 0;
  for (const e of entries || []) {
    if (since && new Date(e.runAt).getTime() < since) continue;
    if (!e.usage) continue;
    totalInput     += Number(e.usage.inputTokens) || 0;
    totalCachedRead += Number(e.usage.cachedReadTokens) || 0;
    totalOutput    += Number(e.usage.outputTokens) || 0;
    count++;
  }
  // Haiku 4.5 pricing: $1/M input, $0.10/M cached read, $5/M output (per 1M tokens)
  const cents =
    (totalInput * 1) / 1_000_000 * 100 +
    (totalCachedRead * 0.1) / 1_000_000 * 100 +
    (totalOutput * 5) / 1_000_000 * 100;
  return {
    count,
    totalInput, totalCachedRead, totalOutput,
    totalTokens: totalInput + totalCachedRead + totalOutput,
    totalCents: cents,
  };
}
