/**
 * Pure MFA gate-state logic (no Supabase calls — see MfaGate.jsx for the
 * client wiring). Kept pure so every branch is testable in the node lane.
 *
 * Rollout scope (WISP §9 gap #1): MFA is REQUIRED for admin accounts and
 * OPTIONAL for everyone else. An ordinary agent who opts in is honored, but
 * is never forced.
 *
 * Fail-safe direction matters here and runs opposite to most gates in this
 * codebase: an over-eager MFA gate locks the operator out of his own admin
 * account with no recovery path inside the product, so unknown/loading state
 * resolves to OK and lets the app render. The security enforcement that must
 * NOT fail open lives server-side on the admin routes, where a missing aal2
 * denies the request outright.
 */

export const MFA = {
  OK: 'ok',                          // render the app
  CHALLENGE: 'challenge',            // enrolled, needs the 6-digit code
  ENROLL_REQUIRED: 'enroll_required' // admin with no factor — forced setup
};

/**
 * Find a usable TOTP factor. Accepts a bare array, Supabase's
 * listFactors() `{ all, totp }` shape, or garbage.
 *
 * Only `status === 'verified'` counts. An abandoned enrollment leaves an
 * unverified factor on the account; treating that as protection would both
 * skip the forced-enrollment screen and challenge the user for a code their
 * authenticator app never received.
 */
export function verifiedTotpFactor(factors) {
  const list = Array.isArray(factors)
    ? factors
    : (Array.isArray(factors?.totp) ? factors.totp
      : (Array.isArray(factors?.all) ? factors.all : null));
  if (!list) return null;
  return list.find(f =>
    f && f.status === 'verified' &&
    (f.factor_type === 'totp' || f.factorType === 'totp' || f.factor_type == null)
  ) || null;
}

/**
 * Resolve what the user should see.
 *
 * @param {object}  args
 * @param {string?} args.currentLevel - AAL now ('aal1' | 'aal2' | null while loading)
 * @param {string?} args.nextLevel    - AAL this account can reach
 * @param {*}       args.factors      - listFactors() result, array, or null
 * @param {boolean} args.isAdmin      - profiles.is_admin
 */
export function mfaState({ currentLevel, nextLevel, factors, isAdmin }) {
  // Still loading — never flash a gate. See the fail-safe note above.
  if (!currentLevel) return MFA.OK;

  const factor = verifiedTotpFactor(factors);

  // Enrolled but this session hasn't satisfied the second factor yet.
  if (factor && currentLevel === 'aal1' && nextLevel === 'aal2') return MFA.CHALLENGE;

  // Admin with no verified factor — force setup before the app renders.
  if (!factor && isAdmin === true) return MFA.ENROLL_REQUIRED;

  return MFA.OK;
}
