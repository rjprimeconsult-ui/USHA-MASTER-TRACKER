import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessLevel,
  ACCESS,
  GATE_FIELDS,
  isFull,
  isLocked,
  hasBasicOrBetter,
  hasActiveSubscription,
  graceDaysLeft,
  applyPastDueStamp,
  gateFromProfile,
} from './subscriptionAccess.mjs';

// Task 1 of the subscription-enforcement plan
// (docs/superpowers/plans/2026-08-02-subscription-enforcement.md). Pure module,
// node lane. Every call passes NOW explicitly — no wall-clock dependence.

const NOW = Date.parse('2026-08-02T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const P = (over = {}) => ({
  id: 'u1',
  is_admin: false,
  is_complimentary: false,
  subscription_status: 'active',
  trial_ends_at: null,
  past_due_since: null,
  ...over,
});

// ---------------------------------------------------------------------------
// THE COMPLIMENTARY INVARIANT (operator, 2026-08-02): is_complimentary and
// is_admin yield FULL before ANY status logic — even for the worst-case rows
// (canceled, or past_due with a long-stale stamp). Locking one of these
// accounts is the worst failure this module can produce.
// ---------------------------------------------------------------------------

test('INVARIANT: is_admin → FULL even when canceled', () => {
  assert.equal(accessLevel(P({ is_admin: true, subscription_status: 'canceled' }), NOW), ACCESS.FULL);
});

test('INVARIANT: is_admin → FULL even when past_due with a stale stamp', () => {
  const p = P({ is_admin: true, subscription_status: 'past_due', past_due_since: iso(NOW - 10 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.FULL);
});

test('INVARIANT: is_complimentary → FULL even when canceled', () => {
  assert.equal(accessLevel(P({ is_complimentary: true, subscription_status: 'canceled' }), NOW), ACCESS.FULL);
});

test('INVARIANT: is_complimentary → FULL even when past_due with a stale stamp', () => {
  const p = P({ is_complimentary: true, subscription_status: 'past_due', past_due_since: iso(NOW - 10 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.FULL);
});

// --- active / trialing → FULL ----------------------------------------------

test('active → FULL', () => {
  assert.equal(accessLevel(P({ subscription_status: 'active' }), NOW), ACCESS.FULL);
});

test('trialing with a future trial_ends_at → FULL', () => {
  const p = P({ subscription_status: 'trialing', trial_ends_at: iso(NOW + 3 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.FULL);
});

test('trialing with a PAST trial_ends_at → still FULL (stale-row policy, spec §2)', () => {
  const p = P({ subscription_status: 'trialing', trial_ends_at: iso(NOW - 3 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.FULL);
});

test('trialing with no trial_ends_at → FULL', () => {
  const p = P({ subscription_status: 'trialing', trial_ends_at: null });
  assert.equal(accessLevel(p, NOW), ACCESS.FULL);
});

// --- past_due grace window --------------------------------------------------

test('past_due with no stamp yet → BASIC', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: null });
  assert.equal(accessLevel(p, NOW), ACCESS.BASIC);
});

test('past_due stamped 2 days ago → BASIC (inside grace)', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW - 2 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.BASIC);
});

test('past_due stamped exactly 3 days ago → LOCKED (strict <, boundary excluded)', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW - 3 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.LOCKED);
});

test('past_due stamped 4 days ago → LOCKED', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW - 4 * DAY) });
  assert.equal(accessLevel(p, NOW), ACCESS.LOCKED);
});

// --- everything else → LOCKED -----------------------------------------------

test('canceled / unpaid / incomplete / incomplete_expired / null / garbage → LOCKED', () => {
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', null, 'garbage']) {
    assert.equal(accessLevel(P({ subscription_status: s }), NOW), ACCESS.LOCKED, `status=${s}`);
  }
});

test('accessLevel(null) → LOCKED', () => {
  assert.equal(accessLevel(null, NOW), ACCESS.LOCKED);
});

// --- helpers + compat alias --------------------------------------------------

test('hasActiveSubscription alias ⟺ isFull for FULL and non-FULL profiles', () => {
  const full = P({ subscription_status: 'active' });
  const locked = P({ subscription_status: 'canceled' });
  assert.equal(hasActiveSubscription(full, NOW), true);
  assert.equal(hasActiveSubscription(full, NOW), isFull(full, NOW));
  assert.equal(hasActiveSubscription(locked, NOW), false);
  assert.equal(hasActiveSubscription(locked, NOW), isFull(locked, NOW));
});

test('isLocked / hasBasicOrBetter on a LOCKED profile → true / false', () => {
  const locked = P({ subscription_status: 'canceled' });
  assert.equal(isLocked(locked, NOW), true);
  assert.equal(hasBasicOrBetter(locked, NOW), false);
});

test('isLocked / hasBasicOrBetter on a BASIC profile → false / true', () => {
  const basic = P({ subscription_status: 'past_due', past_due_since: null });
  assert.equal(isLocked(basic, NOW), false);
  assert.equal(hasBasicOrBetter(basic, NOW), true);
});

// --- graceDaysLeft ------------------------------------------------------------

test('graceDaysLeft: stamped at NOW → 3', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW) });
  assert.equal(graceDaysLeft(p, NOW), 3);
});

test('graceDaysLeft: stamped 2.5 days ago → 1', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW - 2.5 * DAY) });
  assert.equal(graceDaysLeft(p, NOW), 1);
});

test('graceDaysLeft: stamped exactly 3 days ago → 0', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW - 3 * DAY) });
  assert.equal(graceDaysLeft(p, NOW), 0);
});

test('graceDaysLeft: stamped 4 days ago → 0', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: iso(NOW - 4 * DAY) });
  assert.equal(graceDaysLeft(p, NOW), 0);
});

test('graceDaysLeft: past_due with no stamp → null', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: null });
  assert.equal(graceDaysLeft(p, NOW), null);
});

test('graceDaysLeft: stamp present but status not past_due → null', () => {
  const p = P({ subscription_status: 'active', past_due_since: iso(NOW - 1 * DAY) });
  assert.equal(graceDaysLeft(p, NOW), null);
});

// --- applyPastDueStamp --------------------------------------------------------

test('applyPastDueStamp: past_due with no existing stamp → stamps ISO(NOW)', () => {
  const out = applyPastDueStamp({ subscription_status: 'past_due', subscription_tier: 'pro' }, null, NOW);
  assert.equal(out.past_due_since, iso(NOW));
  assert.equal(out.subscription_status, 'past_due');
  assert.equal(out.subscription_tier, 'pro');
});

test('applyPastDueStamp: past_due with an existing stamp → keeps t0 (never re-stamps on dunning retries)', () => {
  const t0 = iso(NOW - 2 * DAY);
  const out = applyPastDueStamp({ subscription_status: 'past_due' }, t0, NOW);
  assert.equal(out.past_due_since, t0);
});

test('applyPastDueStamp: non-past_due status → clears the stamp to null', () => {
  const out = applyPastDueStamp({ subscription_status: 'active' }, iso(NOW - 2 * DAY), NOW);
  assert.equal(out.past_due_since, null);
});

test('applyPastDueStamp: does not mutate its input', () => {
  const fields = { subscription_status: 'past_due' };
  applyPastDueStamp(fields, null, NOW);
  assert.equal(Object.hasOwn(fields, 'past_due_since'), false);
});

// --- gateFromProfile ----------------------------------------------------------

test('gateFromProfile: read error → fail closed, locked + transient', () => {
  const r = gateFromProfile(P(), new Error('boom'), NOW);
  assert.deepEqual(r, { ok: false, level: ACCESS.LOCKED, transient: true });
});

test('gateFromProfile: null profile → fail closed, locked + transient', () => {
  const r = gateFromProfile(null, null, NOW);
  assert.deepEqual(r, { ok: false, level: ACCESS.LOCKED, transient: true });
});

test('gateFromProfile: FULL profile → ok', () => {
  const r = gateFromProfile(P({ subscription_status: 'active' }), null, NOW);
  assert.deepEqual(r, { ok: true, level: ACCESS.FULL });
});

test('gateFromProfile: BASIC profile → not ok, level basic', () => {
  const p = P({ subscription_status: 'past_due', past_due_since: null });
  assert.deepEqual(gateFromProfile(p, null, NOW), { ok: false, level: ACCESS.BASIC });
});

test('gateFromProfile: LOCKED profile → not ok, level locked', () => {
  const p = P({ subscription_status: 'canceled' });
  assert.deepEqual(gateFromProfile(p, null, NOW), { ok: false, level: ACCESS.LOCKED });
});

// --- GATE_FIELDS --------------------------------------------------------------

test('GATE_FIELDS deep-equals the five columns the server gate must SELECT', () => {
  assert.deepEqual(GATE_FIELDS, [
    'is_admin',
    'is_complimentary',
    'subscription_status',
    'trial_ends_at',
    'past_due_since',
  ]);
});
