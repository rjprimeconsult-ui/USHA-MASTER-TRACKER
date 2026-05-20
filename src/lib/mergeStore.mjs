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
 *   - also in local            → keep the local copy (active tab wins edits)
 *   - in remote only:
 *       · id is in baseline    → this session deleted it on purpose → drop
 *       · id NOT in baseline   → another session added it           → keep
 *
 * Returns the merged array, OR `null` when the data can't be safely
 * merged (a record is missing an `id`) — the caller should then fall
 * back to a plain write.
 *
 * Known v1 limitation: a record deleted by *another* session while this
 * session holds it stale is kept (local wins) until this tab reloads.
 * That resurrects a delete, never loses an add — the safe direction.
 */
export function mergeArrayStores(local, remote, baseline) {
  // Nothing sensible to merge into — hand back whichever is the array.
  if (!Array.isArray(local)) return Array.isArray(remote) ? remote : local;
  // No remote records to reconcile — local is the whole truth.
  if (!Array.isArray(remote) || remote.length === 0) return local;

  // Index local by id. A record with no id means we can't merge this
  // store safely — signal the caller to fall back to a plain write.
  const localIds = new Set();
  for (const r of local) {
    if (!r || r.id == null) return null;
    localIds.add(r.id);
  }

  const result = local.slice();
  for (const r of remote) {
    if (!r || r.id == null) return null;
    if (localIds.has(r.id)) continue;               // already here — local copy wins
    if (baseline && baseline.has(r.id)) continue;   // this session deleted it — stay deleted
    result.push(r);                                 // another session added it — keep it
  }
  return result;
}
