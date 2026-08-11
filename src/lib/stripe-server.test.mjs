import test from 'node:test';
import assert from 'node:assert/strict';
import { applySubscriptionFields } from './stripe-server.js';

// Task 3 of the subscription-enforcement plan
// (docs/superpowers/plans/2026-08-02-subscription-enforcement.md): the ONE
// writer path. applySubscriptionFields = subscriptionToProfileFields +
// applyPastDueStamp — every writer (webhook, sync-after-checkout,
// refresh-subscription) goes through it, so the past_due_since lifecycle
// (stamp once, never reset on dunning retries, clear on recovery) is pinned
// here. stripe-server.js has only npm + explicit-.mjs imports, so it loads
// under the node lane; priceIdToTier is stubbed.

const stub = () => ({ tier: 'pro', period: 'monthly' });

const subFixture = (status) => ({
  status,
  cancel_at_period_end: false,
  trial_end: null,
  current_period_end: 1754222400, // 2025-08-03T12:00:00Z
  items: { data: [{ price: { id: 'price_test_123' } }] },
});

test('past_due with no existing stamp → stamps ISO now', () => {
  const before = Date.now();
  const out = applySubscriptionFields(subFixture('past_due'), stub, null);
  const after = Date.now();

  assert.equal(out.subscription_status, 'past_due'); // base fields compose through
  assert.equal(typeof out.past_due_since, 'string');
  const stamped = Date.parse(out.past_due_since);
  assert.ok(!Number.isNaN(stamped), 'past_due_since must be a parseable ISO timestamp');
  assert.ok(stamped >= before && stamped <= after, 'stamp must be "now"');
});

test('past_due with an existing stamp keeps it (dunning retry never resets the clock)', () => {
  const out = applySubscriptionFields(subFixture('past_due'), stub, 't0');
  assert.equal(out.past_due_since, 't0');
});

test('active clears the stamp (recovery ends grace bookkeeping)', () => {
  const out = applySubscriptionFields(subFixture('active'), stub, 't0');
  assert.equal(out.past_due_since, null);
});
