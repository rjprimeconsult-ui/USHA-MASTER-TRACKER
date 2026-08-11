/**
 * POST /api/stripe/refresh-subscription
 *
 * Re-syncs the caller's profile from Stripe on demand. Used by
 * PaywallGate's trialing self-heal and payment-recovery paths: when the
 * client suspects the stored subscription row is stale (webhook lag,
 * missed event), it calls this route, which lists the customer's
 * subscriptions, picks the live one, and writes the canonical fields
 * via applySubscriptionFields (past_due_since lifecycle included).
 *
 * Responses:
 *   200 {ok:false, reason:'no_customer'}      — profile has no Stripe customer
 *   200 {ok:false, reason:'no_subscription'}  — customer has no subscriptions
 *   200 {ok:true, subscription_status}        — synced
 *   503                                       — Stripe API error
 *
 * Idempotent; safe to call repeatedly. Modeled on sync-after-checkout.
 */

import { requireUserId } from '@/lib/apiAuth';
import { getStripe, getSupabaseAdmin, applySubscriptionFields } from '@/lib/stripe-server';
import { priceIdToTier } from '@/lib/stripe-prices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Statuses that represent the customer's current, still-billing-relevant
// subscription. Anything else (canceled, incomplete*) only wins as the
// most-recent fallback.
const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid']);

export async function POST(req) {
  const auth = await requireUserId(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  let profile;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, past_due_since')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    profile = data;
  } catch (e) {
    console.error('[stripe/refresh-subscription] profile read error:', e);
    return jsonResponse(500, { error: 'Server error' });
  }

  if (!profile?.stripe_customer_id) {
    return jsonResponse(200, { ok: false, reason: 'no_customer' });
  }

  let subscriptions;
  try {
    const stripe = getStripe();
    const list = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price'],
    });
    subscriptions = list?.data || [];
  } catch (e) {
    console.error('[stripe/refresh-subscription] Stripe error:', e);
    return jsonResponse(503, { error: 'Stripe unavailable — try again shortly' });
  }

  if (subscriptions.length === 0) {
    return jsonResponse(200, { ok: false, reason: 'no_subscription' });
  }

  // Prefer a live subscription; otherwise fall back to the most recent by
  // created, so a fully-canceled customer still syncs to their true state.
  const live = subscriptions.filter((s) => LIVE_STATUSES.has(s.status));
  const pick = (live.length > 0 ? live : subscriptions)
    .slice()
    .sort((a, b) => (b.created || 0) - (a.created || 0))[0];

  const fields = applySubscriptionFields(pick, priceIdToTier, profile.past_due_since);

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update(fields)
      .eq('id', userId);
    if (updateErr) throw updateErr;
  } catch (e) {
    console.error('[stripe/refresh-subscription] update error:', e);
    return jsonResponse(500, { error: 'Server error' });
  }

  return jsonResponse(200, { ok: true, subscription_status: fields.subscription_status });
}
