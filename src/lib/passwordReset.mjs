/**
 * Pure logic for password reset + change password (spec
 * docs/superpowers/specs/2026-08-26-password-reset-design.md §5).
 * No Supabase imports — every branch runs under node --test.
 *
 * recoveryPhase's row order is NORMATIVE (first match wins) and is a
 * security property, not style:
 *   row 2 (loading) keeps the set-password form off-screen until the AAL
 *   lookup resolves — without it, an enrolled account's first frame is the
 *   set form and an autofill+Enter rotates the password at aal1.
 *   row 3 (blocked) fails CLOSED — the opposite direction from MfaGate,
 *   deliberately: a user mid-recovery can retry or re-enter from a fresh
 *   link, while MfaGate protects against locking the operator out of a
 *   signed-in session. See spec §4c.3.
 */
import { verifiedTotpFactor } from './mfa.mjs';

export function recoveryPhase({ recovering, currentLevel, nextLevel, factors, lookupFailed } = {}) {
  if (!recovering) return 'none';
  if (currentLevel == null && !lookupFailed) return 'loading';
  if (lookupFailed) return 'blocked';
  if (currentLevel === 'aal2') return 'set';
  if (verifiedTotpFactor(factors) && currentLevel === 'aal1' && nextLevel === 'aal2') return 'challenge';
  return 'set';
}

/** Shared validator for the recovery screen and the Profile form (min 6 = parity with signup). */
export function newPasswordIssue(pw, confirm) {
  if (!pw || pw.length < 6) return 'too_short';
  if (pw !== confirm) return 'mismatch';
  return null;
}

// Enumeration-safe by design: success and "no such user" read identically
// (spec §4a). Only rate limits surface, because the user can act on those.
export const RESET_SENT_COPY = 'If an account exists for that email, a reset link is on the way. Check spam too.';
export const RESET_RATE_LIMIT_COPY = 'Too many requests — wait a minute and try again.';

export function resetRequestMessage(error) {
  if (error && (error.code === 'over_email_send_rate_limit' || error.status === 429)) {
    return { kind: 'rate_limited', text: RESET_RATE_LIMIT_COPY };
  }
  return { kind: 'sent', text: RESET_SENT_COPY };
}

/**
 * GoTrue's expired/used-link redirect leaves
 * `#error=access_denied&error_code=otp_expired&error_description=…` in the
 * URL and emits NO auth event. There is no `type` param on the error path,
 * so this cannot distinguish a stale recovery link from a stale signup
 * confirmation — callers must keep the copy generic (spec §4b).
 */
export function recoveryErrorFromHash(hash) {
  if (!hash || typeof hash !== 'string') return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('error_code') === 'otp_expired') return 'expired';
  if (params.get('error') === 'access_denied') return 'expired';
  return null;
}

const hostOf = (url) => {
  try { return new URL(String(url)).host.toLowerCase(); } catch { return null; }
};
const stripWww = (host) => (host && host.startsWith('www.') ? host.slice(4) : host);

/**
 * Spec §3 redirect rule: the browser's own origin is right everywhere
 * (localhost, previews, app host) EXCEPT the marketing host, where the
 * recovery link would burn its token on the landing page — there, the app
 * origin wins. Apex and www count as the same marketing host, matching
 * classifyHost() in hostRouting.mjs.
 */
export function resetRedirectTarget({ origin, marketingUrl, appOrigin } = {}) {
  const o = hostOf(origin);
  const m = hostOf(marketingUrl);
  if (o && m && stripWww(o) === stripWww(m)) return appOrigin;
  return origin;
}
