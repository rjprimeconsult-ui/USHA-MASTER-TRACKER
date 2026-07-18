/**
 * Per-agent email suppression list for CAN-SPAM opt-outs.
 *
 * Stored in Supabase `user_kv` under key `email_suppression_v1` as a JSON array
 * of lowercased email addresses. When a prospect/customer clicks unsubscribe,
 * their address is added to the SENDING agent's list; the send route checks the
 * list before every commercial send and skips suppressed recipients.
 *
 * This module takes the caller's service-role/admin Supabase client as an
 * argument (the same client the send route + welcome path already build via
 * createClient(url, SERVICE_ROLE_KEY, ...)). It deliberately does NOT import
 * @supabase/supabase-js or read env itself — pass the client in. That keeps it
 * a plain .mjs with zero framework/env coupling.
 *
 * Defensive throughout: a missing/garbage key reads as an empty list, and any
 * read/write error degrades gracefully (isSuppressed -> false, addSuppression
 * -> false) instead of throwing, so a suppression-store hiccup can never take
 * down the send path.
 */

export const SUPPRESSION_KEY = 'email_suppression_v1';

function norm(email) {
  return String(email || '').trim().toLowerCase();
}

// Read the raw suppression array for an owner. Always resolves to an array of
// normalized (lowercased, non-empty) addresses.
async function readList(adminClient, ownerUserId) {
  if (!adminClient || !ownerUserId) return [];
  try {
    const { data, error } = await adminClient
      .from('user_kv')
      .select('value')
      .eq('user_id', ownerUserId)
      .eq('key', SUPPRESSION_KEY)
      .maybeSingle();
    if (error) return [];
    let arr = data?.value;
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr); } catch { arr = null; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.map(norm).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Is `email` on `ownerUserId`'s suppression list? Returns false on any error so
 * an unreadable store never blocks a legitimate send (fail-open on read is the
 * right call here — a false negative just means we attempt one more send, which
 * the recipient can opt out of again).
 */
export async function isSuppressed(adminClient, ownerUserId, email) {
  const target = norm(email);
  if (!target) return false;
  const list = await readList(adminClient, ownerUserId);
  return list.includes(target);
}

/**
 * Add `email` to `ownerUserId`'s suppression list (idempotent, lowercased,
 * deduped). Returns true when the address is now suppressed (either freshly
 * added or already present), false on a write error / bad args.
 */
export async function addSuppression(adminClient, ownerUserId, email) {
  const target = norm(email);
  if (!adminClient || !ownerUserId || !target) return false;
  try {
    const list = await readList(adminClient, ownerUserId);
    if (list.includes(target)) return true; // already opted out — nothing to do
    const next = [...list, target];
    const { error } = await adminClient
      .from('user_kv')
      .upsert(
        { user_id: ownerUserId, key: SUPPRESSION_KEY, value: next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}
