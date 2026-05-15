/**
 * Drop-in fetch replacement that auto-attaches the current Supabase
 * session as a Bearer token. Use for any client → /api/* call that
 * the server-side route requires authentication on (AI smart imports,
 * email send, etc.).
 *
 * Falls back to a plain fetch when no session exists — the server
 * will then return 401 and the caller can surface a clear error.
 */
import { supabase, supabaseConfigured } from './supabase';

export async function authedFetch(url, options = {}) {
  let bearer = null;
  try {
    if (supabaseConfigured()) {
      const { data } = await supabase.auth.getSession();
      bearer = data.session?.access_token || null;
    }
  } catch { /* fall through */ }
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });
}
