/**
 * Cloud-aware storage adapter.
 *
 * - When user is signed in (Supabase session exists): reads/writes go to the
 *   `user_kv` table in Supabase. Each `key` maps to one row (user, key, value).
 * - When user is signed out OR Supabase isn't configured: falls back to
 *   browser localStorage (Phase 1 behavior).
 *
 * Always mirrors writes to localStorage as a backup so a flaky network can't
 * lose data — next save/sync overwrites the cloud value.
 *
 * Public API matches the original Phase 1 storage.js so calling code is unchanged:
 *   await storage.getItem(key)         → string | null
 *   await storage.setItem(key, value)  → boolean
 *   await storage.removeItem(key)      → void
 */

import { supabase, supabaseConfigured } from './supabase';
import { mergeArrayStores } from './mergeStore.mjs';

const hasLS = () => typeof window !== 'undefined' && !!window.localStorage;

// Cached user id so we don't hit getSession() on every call.
let cachedUserId = null;
let authListenerAttached = false;

function attachAuthListener() {
  if (authListenerAttached || !supabaseConfigured() || typeof window === 'undefined') return;
  authListenerAttached = true;
  supabase.auth.getSession().then(({ data }) => {
    cachedUserId = data.session?.user?.id || null;
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUserId = session?.user?.id || null;
  });
}
attachAuthListener();

const cloudActive = () => supabaseConfigured() && !!cachedUserId;

// ---------- Quota error notification ----------
let quotaListener = null;
export const onStorageError = (fn) => { quotaListener = fn; };
const isQuotaError = (e) => (
  e && (
    e.code === 22 ||
    e.code === 1014 ||
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  )
);

// ---------- Local helpers ----------
function localGet(key) {
  if (!hasLS()) return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function localSet(key, value) {
  if (!hasLS()) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (isQuotaError(e)) {
      // CRITICAL distinction (root cause #1 of the 2026-06-01 incident):
      // when signed in, Supabase is the source of truth and its write is
      // INDEPENDENT of this localStorage mirror. A full mirror is NOT data
      // loss, so we must NOT raise the alarming "your save wasn't persisted"
      // toast — that false alarm made an agent re-import 1,490 leads and
      // triggered a duplicate explosion. Only surface the quota error when
      // signed out, where localStorage IS the only store and it's real.
      if (cloudActive()) {
        if (typeof console !== 'undefined') {
          console.warn('localStorage mirror full — cloud save is the source of truth and is unaffected', key);
        }
      } else if (quotaListener) {
        quotaListener({ key, valueSize: typeof value === 'string' ? value.length : 0, error: e });
      }
    } else if (typeof console !== 'undefined') {
      console.warn('localStorage.setItem failed', key, e);
    }
    return false;
  }
}
function localRemove(key) {
  if (!hasLS()) return;
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

// ---------- Cloud helpers ----------
async function cloudGet(key) {
  const { data, error } = await supabase
    .from('user_kv')
    .select('value')
    .eq('user_id', cachedUserId)
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.warn('cloudGet failed', key, error);
    return undefined; // sentinel: unknown
  }
  return data?.value; // may be null/undefined if row doesn't exist
}
async function cloudSet(key, parsedValue) {
  const { error } = await supabase
    .from('user_kv')
    .upsert(
      { user_id: cachedUserId, key, value: parsedValue, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  if (error) {
    console.warn('cloudSet failed', key, error);
    return false;
  }
  return true;
}
async function cloudRemove(key) {
  const { error } = await supabase
    .from('user_kv')
    .delete()
    .eq('user_id', cachedUserId)
    .eq('key', key);
  if (error) console.warn('cloudRemove failed', key, error);
}

// ---------- Merge-on-save (multi-tab / multi-device safety) ----------
// These keys hold arrays of id'd records. They get merge-on-save so a
// record another tab/device added is never overwritten away by a stale
// snapshot. See mergeStore.mjs for the merge rules.
//
// Extended 2026-05 to cover the actively hand-edited array stores —
// agents routinely use PRIM on a laptop + phone, and these were plain
// last-write-wins, so a stale second device could silently wipe the
// first device's edits. All four hold records with stable `id` fields
// (uid()), which is what mergeArrayStores keys on; any row missing an id
// makes the merge no-op to a safe plain write, so this can't regress.
// (Import-derived stores like chargebacks/overrides/abDetail are left on
// plain-write — they're rewritten by a dedup pass on load and aren't
// hand-edited across devices, so merge-on-save would add risk, not safety.)
const MERGEABLE_KEYS = new Set([
  'leads_v5',
  'prospects_v1',
  'business_expenses_v1',
  'business_income_v1',
  'investments_v2',
  'activities_v1',
]);

// Per-session baseline: every record id this session has loaded or
// written for a mergeable key. Lets the merge tell "another session
// added this" (keep) from "this session deleted this" (drop). Lives for
// the page lifetime; resets on reload.
const sessionBaseline = new Map(); // key -> Set<id>

function baselineFor(key) {
  let s = sessionBaseline.get(key);
  if (!s) { s = new Set(); sessionBaseline.set(key, s); }
  return s;
}
function recordBaseline(key, arr) {
  if (!Array.isArray(arr)) return;
  const s = baselineFor(key);
  for (const r of arr) { if (r && r.id != null) s.add(r.id); }
}

// Re-read the remote array and merge this session's local array into it.
// Returns the array to write, OR undefined when a plain write should be
// used instead (parse failure, remote unreadable, or un-mergeable shape).
async function mergeOnSave(key, value) {
  let local;
  try { local = JSON.parse(value); } catch { return undefined; }
  if (!Array.isArray(local)) return undefined;

  // Everything we're about to write joins our baseline, so a later
  // delete of one of these ids reads as an intentional delete.
  recordBaseline(key, local);

  const remote = await cloudGet(key); // undefined on error, null if absent
  if (remote === undefined) return undefined; // remote unreadable → plain write
  if (remote === null) return local;          // nothing remote yet → local is the truth

  let remoteArr = remote;
  if (typeof remoteArr === 'string') {
    try { remoteArr = JSON.parse(remoteArr); } catch { return undefined; }
  }
  const merged = mergeArrayStores(local, remoteArr, baselineFor(key));
  if (merged === null) return undefined;      // un-mergeable (missing ids) → plain write
  return merged;
}

// ---------- Public API ----------
export const storage = {
  async getItem(key) {
    let result = null;
    if (cloudActive()) {
      try {
        const value = await cloudGet(key);
        if (value !== undefined && value !== null) {
          // Mirror to local for offline reads
          try { localSet(key, JSON.stringify(value)); } catch {}
          result = JSON.stringify(value);
        }
      } catch (e) {
        console.warn('storage.getItem cloud path failed, falling back', e);
      }
    }
    if (result === null) result = localGet(key);
    // Seed the merge baseline with whatever this session just loaded.
    if (result != null && MERGEABLE_KEYS.has(key)) {
      try { recordBaseline(key, JSON.parse(result)); } catch {}
    }
    return result;
  },
  async setItem(key, value) {
    // Merge-on-save for array stores: fold in any records another
    // tab/device added so a stale snapshot can't erase them.
    if (cloudActive() && MERGEABLE_KEYS.has(key)) {
      try {
        const merged = await mergeOnSave(key, value);
        if (merged !== undefined) {
          const str = JSON.stringify(merged);
          const localOk = localSet(key, str);
          const cloudOk = await cloudSet(key, merged);
          // Signed in → the cloud write is the source of truth. Report
          // success on it, NOT the localStorage mirror — a full mirror is
          // not data loss (root cause #1). cloudOk||localOk so a cloud
          // hiccup with a good local cache still reads as saved.
          return cloudOk || localOk;
        }
      } catch (e) {
        console.warn('storage.setItem merge failed, plain write', key, e);
      }
    }
    // Plain write — non-mergeable keys, signed out, or merge fell back.
    const localOk = localSet(key, value);
    if (cloudActive()) {
      try {
        let parsed;
        try { parsed = JSON.parse(value); } catch { parsed = value; }
        const cloudOk = await cloudSet(key, parsed);
        // Same as the merge path: signed in → judge success on the cloud
        // write, not the localStorage mirror (root cause #1).
        return cloudOk || localOk;
      } catch (e) {
        console.warn('storage.setItem cloud sync failed (local saved)', e);
        return localOk;
      }
    }
    return localOk;
  },
  async removeItem(key) {
    localRemove(key);
    if (cloudActive()) {
      try { await cloudRemove(key); } catch (e) { console.warn(e); }
    }
  },
};

/**
 * Bulk migration helper — uploads ALL non-empty localStorage keys to the cloud
 * for the currently signed-in user. Returns { migrated: count, skipped: count }.
 *
 * Used by the AuthGate's "Upload your local data to cloud" prompt.
 */
const APP_KEYS = [
  // Core data
  'leads_v5', 'investments_v2', 'activities_v1', 'agent_tier_v1',
  'chargebacks_v1', 'overrides_v1', 'own_advances_v1', 'advance_months_history_v1',
  'platform_expenses_v1', 'business_expenses_v1', 'business_income_v1',
  'business_accounts_v1', 'platform_budget_v1',
  'prospects_v1', 'prospect_settings_v1',
  'announcement_acks_v1', 'no_phi_ack_v1',
  // Per-agent learning + customization (PRIM v3+)
  'vendor_memory_v1',
  'custom_categories_v1',
  'closed_periods_v1',
  'prospect_source_colors_v1',
  'user_rubric_v1',
  'import_history_v1',
  // Association Bonus residual tracking (CommissionDetail.csv imports).
  // Isolated from leads/Books — these only affect the Associations tab.
  'association_bonus_detail_v1',
  'agent_residual_rates_v1',
  // Post-Sale Emails feature
  'post_sale_email_template_v1',
  'email_sender_identity_v1',
  'pending_email_queue_v1',
  // Setup checklist dismiss flag (Dashboard widget)
  'setup_checklist_v1',
];
export async function migrateLocalToCloud() {
  if (!cloudActive()) throw new Error('Not signed in');
  let migrated = 0, skipped = 0;
  for (const key of APP_KEYS) {
    const raw = localGet(key);
    if (raw == null) { skipped++; continue; }
    try {
      const parsed = JSON.parse(raw);
      const ok = await cloudSet(key, parsed);
      if (ok) migrated++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { migrated, skipped };
}

/**
 * Inspect what's available locally vs in cloud — used by the migration prompt
 * to tell the user "you have N leads + M expenses locally, cloud is empty".
 */
export async function inspectStorage() {
  const out = { local: {}, cloud: {}, hasLocal: false, hasCloud: false };
  for (const key of APP_KEYS) {
    const raw = localGet(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          out.local[key] = parsed.length;
          out.hasLocal = true;
        }
      } catch {}
    }
  }
  if (cloudActive()) {
    const { data, error } = await supabase
      .from('user_kv')
      .select('key, value')
      .eq('user_id', cachedUserId);
    if (!error && data) {
      for (const row of data) {
        if (Array.isArray(row.value) && row.value.length > 0) {
          out.cloud[row.key] = row.value.length;
          out.hasCloud = true;
        }
      }
    }
  }
  return out;
}
