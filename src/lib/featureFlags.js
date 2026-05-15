/**
 * Feature flag system — server-safe core.
 *
 * Pure access-check logic and the BETA_FEATURES registry. Import this
 * file from anywhere — API routes, server components, client components.
 *
 * For React client components, import the `useBetaFeature` hook from
 * `useBetaFeature.js` instead. We keep the hook in a separate file so
 * importing `featureFlags` from a server route doesn't pull in React
 * hooks at module scope (Next.js RSC builds reject that).
 *
 * Three-layer access check (in order):
 *   1. Admin override  — admins always see beta features (for testing on prod).
 *   2. Beta allowlist  — specific email addresses get early access.
 *   3. Tier + GA flag  — when a feature is flipped to publicGA=true, anyone
 *      meeting the tier requirement gets it. Until then, only the allowlist
 *      and admins have access.
 */

// ---------- Tier helpers ----------

const TIER_ORDER = ['starter', 'pro', 'team'];

function meetsTierRequirement(userTier, requiredTier) {
  if (!requiredTier) return true;
  const uIdx = TIER_ORDER.indexOf((userTier || '').toLowerCase());
  const rIdx = TIER_ORDER.indexOf(requiredTier.toLowerCase());
  if (rIdx < 0) return true;
  if (uIdx < 0) return false;
  return uIdx >= rIdx;
}

// ---------- Pure active-subscription check ----------
// Mirrors src/lib/subscription.js → hasActiveSubscription, inlined so this
// module stays import-safe from server routes.
function hasActiveSubscription(profile) {
  if (!profile) return false;
  if (profile.is_complimentary === true) return true;
  const s = profile.subscription_status;
  if (s === 'active') return true;
  if (s === 'trialing') {
    if (!profile.trial_ends_at) return true;
    return new Date(profile.trial_ends_at).getTime() > Date.now();
  }
  if (s === 'past_due') return true;
  return false;
}

// ---------- Beta feature registry ----------

/**
 * Each entry:
 *   name            — display name (used in UI)
 *   requiredTier    — minimum tier when feature goes public ('starter'|'pro'|'team')
 *   betaAllowlist   — lowercase emails that get access in beta (before GA)
 *   publicGA        — when true, anyone meeting requiredTier gets it.
 *                     Keep false during beta — only allowlist + admins see it.
 */
export const BETA_FEATURES = {
  post_sale_emails: {
    name: 'Post-Sale Email Automation',
    requiredTier: 'pro',
    betaAllowlist: [
      'juantrejo9082@gmail.com',
      'rjprimeconsult@gmail.com',
    ],
    // GA at launch: Pro + Team get post-sale email automation. Starter
    // does not — it's an upgrade lever to nudge agents who care about
    // post-sale touchpoints.
    publicGA: true,
  },
  outreach_emails: {
    name: 'Cold Outreach Email Sequences',
    requiredTier: 'team',
    betaAllowlist: [
      'juantrejo9082@gmail.com',
      'rjprimeconsult@gmail.com',
    ],
    // GA at launch: Team only. The Benepath-style outreach + reminders
    // are positioned as a team-leader tool (your downline lifts when
    // their cold outreach is automated). Big upgrade incentive from Pro.
    publicGA: true,
  },
};

/**
 * Pure access checker. Pass in a profile object (id, email,
 * subscription_tier, subscription_status, is_complimentary, is_admin)
 * and a feature key.
 *
 * Returns { canAccess, reason }.
 */
export function canAccessBetaFeature(featureKey, profile) {
  const feature = BETA_FEATURES[featureKey];
  if (!feature) return { canAccess: false, reason: 'unknown_feature' };
  if (!profile) return { canAccess: false, reason: 'not_signed_in' };

  if (profile.is_admin === true) return { canAccess: true, reason: 'admin' };

  const email = (profile.email || '').toLowerCase();
  if (email && feature.betaAllowlist?.some(a => a.toLowerCase() === email)) {
    return { canAccess: true, reason: 'beta_allowlist' };
  }

  if (!feature.publicGA) return { canAccess: false, reason: 'not_in_beta' };
  if (!hasActiveSubscription(profile)) return { canAccess: false, reason: 'no_subscription' };
  if (!meetsTierRequirement(profile.subscription_tier, feature.requiredTier)) {
    return { canAccess: false, reason: 'tier_too_low' };
  }
  return { canAccess: true, reason: 'tier_match' };
}
