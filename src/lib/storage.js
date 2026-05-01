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

const useCloud = () => supabaseConfigured() && !!cachedUserId;

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
    if (isQuotaError(e) && quotaListener) {
      quotaListener({ key, valueSize: typeof value === 'string' ? value.length : 0, error: e });
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

// ---------- Public API ----------
export const storage = {
  async getItem(key) {
    if (useCloud()) {
      try {
        const value = await cloudGet(key);
        if (value !== undefined && value !== null) {
          // Mirror to local for offline reads
          try { localSet(key, JSON.stringify(value)); } catch {}
          return JSON.stringify(value);
        }
      } catch (e) {
        console.warn('storage.getItem cloud path failed, falling back', e);
      }
    }
    return localGet(key);
  },
  async setItem(key, value) {
    // Always save locally first — fast UI, offline safety
    const localOk = localSet(key, value);
    if (useCloud()) {
      try {
        let parsed;
        try { parsed = JSON.parse(value); } catch { parsed = value; }
        await cloudSet(key, parsed);
      } catch (e) {
        console.warn('storage.setItem cloud sync failed (local saved)', e);
      }
    }
    return localOk;
  },
  async removeItem(key) {
    localRemove(key);
    if (useCloud()) {
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
];
export async function migrateLocalToCloud() {
  if (!useCloud()) throw new Error('Not signed in');
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
  if (useCloud()) {
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
