/**
 * Record-merge for array-shaped user_kv stores (leads, prospects).
 *
 * PRIM persists each store by writing the whole array. With the app open
 * in two tabs/devices, a stale snapshot can overwrite — and silently
 * delete — records the other session added. This merge runs at save
 * time: re-read the database copy, fold it into the array being written,
 * and never drop a record another session created.
 *
 *   local     — the array this session is about to persist
 *   remote    — the array currently in the database (re-read at save time)
 *   baseline  — Set of record ids this session has ever held locally
 *               (seeded on load, extended on every save)
 *
 * Per remote record, keyed by `id`:
 *   - also in local            → keep whichever copy has the newer `updatedAt`
 *                                (NEWEST-WINS); ties / un-stamped fall back to
 *                                the local copy.
 *   - in remote only:
 *       · id is in baseline    → this session deleted it on purpose → drop
 *       · id NOT in baseline   → another session added it           → keep
 *
 * Returns the merged array, OR `null` when the data can't be safely
 * merged (a record is missing an `id`) — the caller should then fall
 * back to a plain write.
 *
 * NEWEST-WINS: records carrying an `updatedAt` ISO timestamp are reconciled by
 * recency, so a stale session can no longer clobber another session's more
 * recent edit (e.g. a logged touch). A record WITH a timestamp beats one
 * without (so a touched record always beats an un-stamped stale copy). Records
 * with no timestamp on either side fall back to local-wins (backward-compatible
 * with stores that don't stamp).
 *
 * Known limitation: a record deleted by *another* session while this session
 * holds it stale is kept until this tab reloads — resurrects a delete, never
 * loses an add — the safe direction.
 */
export function mergeArrayStores(local, remote, baseline) {
  // Nothing sensible to merge into — hand back whichever is the array.
  if (!Array.isArray(local)) return Array.isArray(remote) ? remote : local;
  // No remote records to reconcile — local is the whole truth.
  if (!Array.isArray(remote) || remote.length === 0) return local;

  // Index local by id, preserving order. A record with no id means we can't
  // merge this store safely — signal the caller to fall back to a plain write.
  const byId = new Map();
  const order = [];
  for (const r of local) {
    if (!r || r.id == null) return null;
    byId.set(r.id, r);
    order.push(r.id);
  }

  for (const r of remote) {
    if (!r || r.id == null) return null;
    if (byId.has(r.id)) {
      // Present in both → newest-wins by updatedAt; tie/un-stamped → keep local.
      const localRec = byId.get(r.id);
      if (String(r.updatedAt || '') > String(localRec.updatedAt || '')) byId.set(r.id, r);
    } else if (baseline && baseline.has(r.id)) {
      // This session deleted it on purpose → stay deleted.
    } else {
      byId.set(r.id, r);   // another session added it → keep it
      order.push(r.id);
    }
  }
  return order.map(id => byId.get(id));
}

/**
 * Stamp `updatedAt` on records that CHANGED (new object reference) vs the
 * previous array, so the newest-wins merge can resolve concurrent edits.
 * Unchanged records keep their existing stamp (never bumped) — only the
 * record an agent actually edited gets a fresh timestamp, so "newest" stays
 * meaningful per record. Pure; `tsMap` (id → last stamp) is read + updated.
 */
/**
 * Cheap reference-equality check for two record arrays (same length, same
 * object refs in order). Used when applying a remote (realtime) reload: if the
 * merge produced no actual change, skip the state update so we don't re-render
 * or re-save (which would echo back out as another realtime event).
 */
export function sameRecords(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function stampUpdatedAt(prevArr, nextArr, tsMap, now) {
  const prevById = new Map((prevArr || []).map(r => [r && r.id, r]));
  return (nextArr || []).map(r => {
    if (r == null || r.id == null) return r;
    const changed = prevById.get(r.id) !== r;          // new record or edited (new ref)
    if (changed) tsMap.set(r.id, now);
    else if (!tsMap.has(r.id) && r.updatedAt) tsMap.set(r.id, r.updatedAt); // seed from loaded data
    const ts = tsMap.get(r.id);
    return ts ? { ...r, updatedAt: ts } : r;
  });
}
