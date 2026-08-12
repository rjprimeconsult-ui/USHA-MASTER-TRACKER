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
  // CRITICAL-2 (2026-08-02 enforcement spec §2): an EXPIRED 'trialing' row
  // still passes. Stripe moves a genuinely failed trial to past_due within
  // seconds, so a lingering 'trialing' means OUR webhook lagged — and
  // walling a just-charged paying agent over our own lag is the worse
  // error. PaywallGate self-heals the stale row via refresh-subscription.
  const expired = canAccessBetaFeature('followup_drafts', P({ subscription_status: 'trialing', trial_ends_at: PAST }));
  assert.equal(expired.canAccess, true);
  assert.equal(expired.reason, 'tier_match');
});

test('canceled / unpaid are denied even at pro tier', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_status: 'canceled' })).canAccess, false);
  assert.equal(canAccessBetaFeature('followup_drafts', P({ subscription_status: 'unpaid' })).canAccess, false);
});

test('past_due is denied paid features — grace is BASIC, not FULL', () => {
  // Rewritten for subscription enforcement (2026-08-02 spec §2): past_due
  // now maps to BASIC access, and BASIC blocks paid AI/email features
  // client-side. The old "past_due keeps access" grace semantics moved to
  // hasBasicOrBetter — APP access survives the 3-day grace window, paid
  // features do not.
  const r = canAccessBetaFeature('followup_drafts', P({ subscription_status: 'past_due' }));
  assert.equal(r.canAccess, false);
  assert.equal(r.reason, 'no_subscription');
});

test('past_due with a 1-day-old stamp is still denied (inside grace, still BASIC)', () => {
  const r = canAccessBetaFeature('followup_drafts', P({
    subscription_status: 'past_due',
    past_due_since: new Date(Date.now() - 86400000).toISOString(),
  }));
  assert.equal(r.canAccess, false);
  assert.equal(r.reason, 'no_subscription');
});

test('THE COMPLIMENTARY INVARIANT survives past_due: comp/admin/allowlist stay true', () => {
  const pastDue = {
    subscription_status: 'past_due',
    past_due_since: new Date(Date.now() - 86400000).toISOString(),
  };
  const comp = canAccessBetaFeature('followup_drafts', P({ ...pastDue, is_complimentary: true, subscription_tier: null }));
  assert.equal(comp.canAccess, true);
  assert.equal(comp.reason, 'complimentary');
  const admin = canAccessBetaFeature('followup_drafts', P({ ...pastDue, is_admin: true, subscription_tier: null }));
  assert.equal(admin.canAccess, true);
  assert.equal(admin.reason, 'admin');
  const allowlisted = canAccessBetaFeature('followup_drafts', P({ ...pastDue, email: 'juantrejo9082@gmail.com', subscription_tier: null }));
  assert.equal(allowlisted.canAccess, true);
  assert.equal(allowlisted.reason, 'beta_allowlist');
});

test('complimentary users get everything — no tier needed', () => {
  // Operator decision 2026-07-28: PRIM's ~3 complimentary users (hand-picked
  // partners/testers) get full access to every gated feature. Comp bypasses
  // both the GA flag and the tier requirement, in the UI and in every API
  // route that calls this function.
  const noTier = canAccessBetaFeature('followup_drafts', P({ is_complimentary: true, subscription_status: 'canceled', subscription_tier: null }));
  assert.equal(noTier.canAccess, true);
  assert.equal(noTier.reason, 'complimentary');
  // Even tier-gated features with no tier set at all:
  assert.equal(canAccessBetaFeature('outreach_emails', P({ is_complimentary: true, subscription_status: 'canceled', subscription_tier: null })).canAccess, true);
});

test('admin override and beta allowlist pass regardless of tier', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', P({ is_admin: true, subscription_tier: 'starter', subscription_status: 'canceled' })).canAccess, true);
  const allowlisted = canAccessBetaFeature('followup_drafts', P({ email: 'juantrejo9082@gmail.com', subscription_tier: null, subscription_status: 'canceled' }));
  assert.equal(allowlisted.canAccess, true);
  assert.equal(allowlisted.reason, 'beta_allowlist');
});

test('outreach_emails is Pro+ — operator decision 2026-07-29: "Pro can use any email feature"', () => {
  // Pins the sender-identity spec §1 tier change (Team+ → Pro+). The
  // failing-then-fixed run of this test is the proof the policy changed.
  assert.equal(canAccessBetaFeature('outreach_emails', P()).canAccess, true); // active pro
  assert.equal(canAccessBetaFeature('outreach_emails', P({ subscription_tier: 'team' })).canAccess, true);
  const starter = canAccessBetaFeature('outreach_emails', P({ subscription_tier: 'starter' }));
  assert.equal(starter.canAccess, false);
  assert.equal(starter.reason, 'tier_too_low');
  assert.equal(BETA_FEATURES.outreach_emails.requiredTier, 'pro');
  assert.equal(BETA_FEATURES.outreach_emails.publicGA, true);
});

test('no profile / unknown feature are denied', () => {
  assert.equal(canAccessBetaFeature('followup_drafts', null).canAccess, false);
  assert.equal(canAccessBetaFeature('nonexistent_feature', P()).canAccess, false);
});
