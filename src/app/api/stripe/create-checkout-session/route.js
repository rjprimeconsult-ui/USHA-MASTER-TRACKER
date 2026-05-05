/**
 * POST /api/stripe/create-checkout-session
 *
 * Body: { priceId, period?, successUrl?, cancelUrl? }
 *
 * Verifies the caller via the Authorization bearer token (their
 * Supabase session), ensures they have a Stripe customer, then creates
 * a Stripe Checkout session for the requested Price ID with a 7-day
 * trial. Returns { url } so the client can redirect to Stripe-hosted
 * checkout.
 */

import { createClient } from '@supabase/supabase-js';
import { getStripe, ensureStripeCustomer } from '@/lib/stripe-server';
import { TRIAL_DAYS, STRIPE_PRICES } from '@/lib/stripe-prices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build a Set of every valid Price ID so we can reject clients trying
// to subscribe to a price we didn't define (defense-in-depth).
const VALID_PRICE_IDS = new Set(
  Object.values(STRIPE_PRICES).flatMap(t => [t.monthly, t.yearly])
);

export async function POST(req) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return jsonResponse(401, { error: 'Missing bearer token' });

    // Verify the user via Supabase
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return jsonResponse(500, { error: 'Server not configured' });
    const supabase = createClient(url, anonKey);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse(401, { error: 'Invalid session' });

    const body = await req.json().catch(() => ({}));
    const priceId = body.priceId;
    if (!priceId || !VALID_PRICE_IDS.has(priceId)) {
      return jsonResponse(400, { error: 'Invalid priceId' });
    }

    const customerId = await ensureStripeCustomer({
      userId: userData.user.id,
      email: userData.user.email,
    });

    const origin = req.headers.get('origin') || 'https://www.primtracker.com';
    // Include the session_id in the success URL so the client can call
    // /api/stripe/sync-after-checkout synchronously instead of waiting
    // for the webhook. {CHECKOUT_SESSION_ID} is a Stripe template var.
    const successUrl = body.successUrl || `${origin}/?subscription=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = body.cancelUrl  || `${origin}/pricing?canceled=1`;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { supabase_user_id: userData.user.id },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Lets Stripe collect a payment method during the trial so the
      // first invoice doesn't fail. Required for trial-then-charge flow.
      payment_method_collection: 'always',
      // Save card so the Customer Portal can manage it later
      allow_promotion_codes: true,
      metadata: { supabase_user_id: userData.user.id },
    });

    return jsonResponse(200, { url: session.url, id: session.id });
  } catch (e) {
    console.error('[stripe/create-checkout-session] error:', e);
    return jsonResponse(500, { error: e.message || 'Server error' });
  }
}
