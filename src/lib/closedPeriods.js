/**
 * Period close-out — agents can lock a month so subsequent imports/edits
 * don't accidentally affect already-finalized data.
 *
 * Stored under `closed_periods_v1` via the cloud-aware storage adapter so
 * close/reopen state syncs across devices.
 *
 * Shape on disk:
 *   {
 *     books:     ['2026-01', '2026-02'],   // YYYY-MM strings
 *     platforms: ['2026-01'],
 *   }
 *
 * "Closed" semantics:
 *   - Per-row edit / delete / bulk-delete on rows in a closed month is blocked
 *   - Manual "Add" form for that month is blocked (a different month is fine)
 *   - Smart Import skips extracted rows whose date falls in a closed month
 *   - "Re-scan with AI" skips rows in closed months
 *   - "Reopen month" button always available — closes are reversible
 *
 * Conservative by design: a closed period is a soft lock the agent owns,
 * not a regulatory commitment.
 */

import { useEffect, useState, useMemo } from 'react';
import { storage } from './storage';

export const CLOSED_PERIODS_KEY = 'closed_periods_v1';

const EMPTY = { books: [], platforms: [] };

export async function loadClosedPeriods() {
  try {
    const raw = await storage.getItem(CLOSED_PERIODS_KEY);
    if (!raw) return { ...EMPTY };
    const obj = JSON.parse(raw);
    return {
      books: Array.isArray(obj?.books) ? obj.books : [],
      platforms: Array.isArray(obj?.platforms) ? obj.platforms : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveClosedPeriods(map) {
  try {
    await storage.setItem(CLOSED_PERIODS_KEY, JSON.stringify(map || EMPTY));
    return true;
  } catch {
    return false;
  }
}

// "2026-01-15" -> "2026-01"
export function ymOf(date) {
  return String(date || '').slice(0, 7);
}

/**
 * Is a given date inside a closed period for the given kind?
 *   isPeriodClosed(map, 'books', '2026-01-15')  -> true|false
 */
export function isPeriodClosed(map, kind, dateOrYm) {
  if (!map || !dateOrYm) return false;
  const ym = ymOf(dateOrYm);
  if (!ym) return false;
  const list = (kind === 'platforms' ? map.platforms : map.books) || [];
  return list.includes(ym);
}

// Books and Platforms used to be separate stores with independent
// close/reopen decisions. After the 2026 unification, Platforms rows
// live INSIDE Books as PLATFORM_* categories — so there is now ONE
// monthly decision, not two. Both writers below always mutate both
// buckets together to keep them in lockstep. Readers may still query
// either kind; both will agree.
//
// This kills the silent bug where reopening April in the Books view
// left Platforms-April locked, which caused Smart Import to silently
// drop every platform row from the imported file.
function syncKinds(current) {
  const set = new Set([...(current.books || []), ...(current.platforms || [])]);
  const sorted = Array.from(set).sort();
  return { books: sorted, platforms: [...sorted] };
}

export async function closePeriod(kind, ym) {
  const current = await loadClosedPeriods();
  current.books    = (current.books    || []);
  current.platforms = (current.platforms || []);
  if (!current.books.includes(ym))    current.books.push(ym);
  if (!current.platforms.includes(ym)) current.platforms.push(ym);
  const next = syncKinds(current);
  await saveClosedPeriods(next);
  return next;
}

export async function reopenPeriod(kind, ym) {
  const current = await loadClosedPeriods();
  const next = {
    books:    (current.books    || []).filter(m => m !== ym),
    platforms: (current.platforms || []).filter(m => m !== ym),
  };
  await saveClosedPeriods(next);
  return next;
}

/**
 * Hook: returns the closed-period map + helpers. Consumers use the helpers
 * to gate edits and to render lock indicators.
 */
export function useClosedPeriods() {
  const [map, setMap] = useState(EMPTY);

  const reload = useMemo(() => async () => {
    const next = await loadClosedPeriods();
    setMap(next);
    return next;
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const close = useMemo(() => async (kind, ym) => {
    const next = await closePeriod(kind, ym);
    setMap(next);
  }, []);

  const reopen = useMemo(() => async (kind, ym) => {
    const next = await reopenPeriod(kind, ym);
    setMap(next);
  }, []);

  const isClosed = (kind, dateOrYm) => isPeriodClosed(map, kind, dateOrYm);

  return { map, isClosed, close, reopen, reload };
}
