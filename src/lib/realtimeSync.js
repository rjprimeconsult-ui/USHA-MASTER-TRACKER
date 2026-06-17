/**
 * Live multi-session sync for shared accounts.
 *
 * Subscribes to Postgres changes on this user's `user_kv` rows so that when one
 * browser/device saves (the row is upserted), every other open session for the
 * SAME account is notified and can reload + newest-wins-merge the change in —
 * without a manual refresh. Pairs with the newest-wins merge in mergeStore.mjs:
 * the merge keeps data correct; this just makes other sessions pull it promptly.
 *
 * Requires Supabase Realtime to be enabled on the table once:
 *   alter publication supabase_realtime add table public.user_kv;
 * Until then this is inert — subscribe() connects but no events arrive, no harm.
 *
 * Realtime respects RLS, so a session only ever receives its own account's rows.
 */
import { supabase, supabaseConfigured } from './supabase';

/**
 * Subscribe to this user's user_kv changes. Calls onChange(key) whenever a row
 * for one of `keys` is inserted/updated/deleted by ANY session (including self
 * — the caller de-dupes self-echo via a no-op merge). Returns an unsubscribe fn.
 */
export function subscribeUserKv(userId, keys, onChange) {
  if (!supabaseConfigured() || !userId || typeof supabase?.channel !== 'function') {
    return () => {};
  }
  const watched = new Set(keys);
  const channel = supabase
    .channel(`user_kv_sync_${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_kv', filter: `user_id=eq.${userId}` },
      (payload) => {
        const key = payload?.new?.key ?? payload?.old?.key;
        if (key && watched.has(key)) {
          try { onChange(key); } catch { /* ignore */ }
        }
      },
    )
    .subscribe();

  return () => {
    try { supabase.removeChannel(channel); } catch { /* ignore */ }
  };
}
