/**
 * Server-side MFA enforcement for the admin routes (WISP §9 gap #1, residual).
 *
 * WHY THIS EXISTS: MfaGate.jsx decides what RENDERS. It does not stop anyone
 * from calling /api/admin/* directly with a valid access token, and RLS only
 * checks WHO you are (auth.uid()), never whether you passed a second factor.
 * So an attacker holding the admin password could sign in, get an aal1
 * session, skip the UI, and POST /api/admin/impersonate to mint a login link
 * for any agent. This module is what denies that.
 *
 * Node-only (uses Buffer) — deliberately kept out of mfa.mjs, which is
 * imported by a client component.
 */

import { adminMfaOk } from './mfa.mjs';

/**
 * Read the `aal` claim out of a Supabase access token.
 *
 * The signature is NOT verified here and does not need to be: every caller
 * runs this only after `admin.auth.getUser(accessToken)` has already
 * validated the token against the auth server. This just reads a claim out
 * of an already-trusted string. Never throws — a malformed token yields null,
 * which adminMfaOk treats as "not aal2".
 */
export function decodeAalFromJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.aal ?? null;
  } catch {
    return null;
  }
}

/**
 * Decide whether an already-authenticated admin caller may proceed.
 *
 * @param {object} args
 * @param {string} args.accessToken - the bearer token (already verified upstream)
 * @param {object} args.user        - the user object from getUser(); may carry `factors`
 * @param {object} args.adminClient - service-role client, for the factor fallback
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function requireAdminMfa({ accessToken, user, adminClient }) {
  const aal = decodeAalFromJwt(accessToken);

  // aal2 is conclusive — skip the extra round-trip on the common path.
  if (aal === 'aal2') return { ok: true };

  let factors = user?.factors;
  if (!factors && adminClient && user?.id) {
    try {
      const { data } = await adminClient.auth.admin.getUserById(user.id);
      factors = data?.user?.factors;
    } catch (e) {
      // Unknown factor state — adminMfaOk allows, by design. See its docblock.
      console.warn('[adminMfa] factor lookup failed:', e?.message);
    }
  }

  if (adminMfaOk({ aal, factors })) return { ok: true };
  return {
    ok: false,
    error: 'Two-factor authentication required for admin actions. Sign out and sign back in to complete it.',
  };
}
