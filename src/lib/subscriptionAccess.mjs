/**
 * Subscription access resolver — pure and CLIENT-SAFE (no React, no fetch,
 * no server imports). Consumed by featureFlags + PaywallGate (client) and
 * subscriptionGate.server.mjs (server); fully exercised by the node lane.
 * Spec: docs/superpowers/specs/2026-08-02-subscription-enforcement-design.md §2/§4.
 *
 * THE COMPLIMENTARY INVARIANT (operator, 2026-08-02): is_complimentary and
 * is_admin yield FULL before ANY status logic. Locking one of these accounts
 * is the worst failure this module can produce.
 */

export const GRACE_DAYS = 3;
export const ACCESS = { FULL: 'full', BASIC: 'basic', LOCKED: 'locked' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The exact profile columns the server gate must SELECT. Exported so the
 * query and this list cannot drift — a dropped column goes red in the node
 * lane instead of silently 402ing complimentary accounts. */
export const GATE_FIELDS = ['is_admin', 'is_complimentary', 'subscription_status', 'trial_ends_at', 'past_due_since'];

export function accessLevel(profile, now = Date.now()) {
  if (!profile) return ACCESS.LOCKED;

  // Privileged bypasses — MIRROR canAccessBetaFeature (featureFlags.js:117,123).
  if (profile.is_admin === true) return ACCESS.FULL;
  if (profile.is_complimentary === true) return ACCESS.FULL;

  const s = profile.subscription_status;
  if (s === 'active') return ACCESS.FULL;

  if (s === 'trialing') {
    // ANY 'trialing' → FULL, expired included. Stripe moves a real failed
    // trial to past_due within seconds; a stuck 'trialing' means OUR webhook
    // lagged, and walling a just-charged paying agent over that is the worse
    // error. PaywallGate self-heals stale rows via refresh-subscription.
    return ACCESS.FULL;
  }

  if (s === 'past_due') {
    if (!profile.past_due_since) return ACCESS.BASIC; // failed, clock not stamped yet
    const graceEnds = new Date(profile.past_due_since).getTime() + GRACE_DAYS * DAY_MS;
    return now < graceEnds ? ACCESS.BASIC : ACCESS.LOCKED; // strict <: at exactly +3d → LOCKED
  }

  return ACCESS.LOCKED; // canceled | unpaid | incomplete* | null | anything
}

export const isFull = (p, now) => accessLevel(p, now) === ACCESS.FULL;
export const isLocked = (p, now) => accessLevel(p, now) === ACCESS.LOCKED;
export const hasBasicOrBetter = (p, now) => accessLevel(p, now) !== ACCESS.LOCKED;

// Compat alias — callers: PaywallGate.jsx:104, Profile.jsx:550.
export const hasActiveSubscription = (p, now) => isFull(p, now);

/** Whole days of grace remaining; null when not in a stamped past_due grace. */
export function graceDaysLeft(profile, now = Date.now()) {
  if (!profile?.past_due_since || profile.subscription_status !== 'past_due') return null;
  const remaining = new Date(profile.past_due_since).getTime() + GRACE_DAYS * DAY_MS - now;
  return remaining > 0 ? Math.ceil(remaining / DAY_MS) : 0;
}

/**
 * past_due_since lifecycle — stamp once, never reset on dunning retries,
 * clear on any non-past_due status. Reset-on-retry = infinite grace; a
 * missing clear = a later failure skips grace entirely (spec §4).
 * `fields` is a subscriptionToProfileFields() result; `existingPastDueSince`
 * is the RAW stored timestamp (string|null).
 */
export function applyPastDueStamp(fields, existingPastDueSince, now = Date.now()) {
  const out = { ...fields };
  if (out.subscription_status === 'past_due') {
    out.past_due_since = existingPastDueSince || new Date(now).toISOString();
  } else {
    out.past_due_since = null;
  }
  return out;
}

/** Pure decision for the server gate — fail CLOSED on any read problem. */
export function gateFromProfile(profile, error, now = Date.now()) {
  if (error || !profile) return { ok: false, level: ACCESS.LOCKED, transient: true };
  const level = accessLevel(profile, now);
  return level === ACCESS.FULL ? { ok: true, level } : { ok: false, level };
}
