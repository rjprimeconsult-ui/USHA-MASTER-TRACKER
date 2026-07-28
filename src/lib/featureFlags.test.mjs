import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessBetaFeature, BETA_FEATURES } from './featureFlags.js';

// Written alongside the followup_drafts Pro gate (2026-07-28). featureFlags.js
// is dependency-free, so it is importable under `node --test` like the .mjs
// modules. These tests pin the tier semantics the followup-draft route and
// FollowupCard both rely on — especially the trial and complimentary cases,
// which are easy to regress silently.

const P = (over = {}) => ({
  id: 'u1',
  email: 'agent@example.com',
  subscription_status: 'active',
  subscription_tier: 'pro',
  trial_ends_at: null,
  is_complimentary: false,
  is_admin: false,
  ...over,
});

const FUTURE = new Date(Date.now() + 7 * 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

test('followup_drafts is registered as a GA pro feature', () => {
  const f = BETA_FEATURES.followup_drafts;
  assert.ok(f, 'registry entry exists');
  assert.equal(f.requiredTier, 'pro');
  assert.equal(f.publicGA, true);
});

test('active pro and team subscribers get drafts', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', P()).canAccess, true);
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_tier: 'team' })).canAccess, true);
});

test('active starter is denied with tier_too_low', () => {
  const r = canAccessBetaFeature('followup_drafts', P({ subscription_tier: 'starter' }));
  assert.equal(r.canAccess, false);
  assert.equal(r.reason, 'tier_too_low');
});

test('trial counts AT THE TRIALED TIER: pro trial passes, starter trial does not', () => {
  // Juan's decision (2026-07-28): trials experience the feature — at the
  // tier they are trialing. Stripe checkout stamps subscription_tier from
  // the trialed price, so a Starter-price trialist still fails the tier
  // check; only Pro/Team trials see drafts.
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_status: 'trialing', trial_ends_at: FUTURE })).canAccess, true);
  const starterTrial = canAccessBetaFeature('followup_drafts', P({ subscription_status: 'trialing', trial_ends_at: FUTURE, subscription_tier: 'starter' }));
  assert.equal(starterTrial.canAccess, false);
  assert.equal(starterTrial.reason, 'tier_too_low');
  const expired = canAccessBetaFeature('followup_drafts', P({ subscription_status: 'trialing', trial_ends_at: PAST }));
  assert.equal(expired.canAccess, false);
  assert.equal(expired.reason, 'no_subscription');
});

test('canceled / unpaid are denied even at pro tier', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_status: 'canceled' })).canAccess, false);
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_status: 'unpaid' })).canAccess, false);
});

test('past_due keeps access at pro tier (grace period)', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_status: 'past_due' })).canAccess, true);
});

test('complimentary users get everything — no tier needed', () => {
  // Operator decision 2026-07-28: PRIM's ~3 complimentary users (hand-picked
  // partners/testers) get full access to every gated feature. Comp bypasses
  // both the GA flag and the tier requirement, in the UI and in every API
  // route that calls this function.
  const noTier = canAccessBetaFeature('followup_drafts', P({ is_complimentary: true, subscription_status: 'canceled', subscription_tier: null }));
  assert.equal(noTier.canAccess, true);
  assert.equal(noTier.reason, 'complimentary');
  // Even team-tier features:
  assert.equal(canAccessBetaFeature('outreach_emails', P({ is_complimentary: true, subscription_status: 'canceled', subscription_tier: null })).canAccess, true);
});

test('admin override and beta allowlist pass regardless of tier', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', P({ is_admin: true, subscription_tier: 'starter', subscription_status: 'canceled' })).canAccess, true);
  const allowlisted = canAccessBetaFeature('followup_drafts', P({ email: 'juantrejo9082@gmail.com', subscription_tier: null, subscription_status: 'canceled' }));
  assert.equal(allowlisted.canAccess, true);
  assert.equal(allowlisted.reason, 'beta_allowlist');
});

test('no profile / unknown feature are denied', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', null).canAccess, false);
  assert.equal(canAccessBetaFeature('nonexistent_feature', P()).canAccess, false);
});
