/**
 * POST /api/stripe/sync-after-checkout
 *
 * Body: { sessionId }
 *
 * Synchronously fetches a Checkout Session from Stripe, follows it to
 * the created Subscription, and writes the subscription state into
 * profiles. Eliminates the race between Stripe's redirect and the
 * webhook delivery — the user's profile is up-to-date by the time the
 * frontend checks subscription status.
 *
 * Idempotent: safe to call multiple times for the same session_id.
 * The webhook continues to sync separately as a backup channel.
 */

import { createClient } from '@supabase/supabase-js';
import { getStripe, getSupabaseAdmin, subscriptionToProfileFields } from '@/lib/stripe-server';
import { priceIdToTier } from '@/lib/stripe-prices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req) {
  try {
    // Auth: verify the caller's Supabase session
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return jsonResponse(401, { error: 'Missing bearer token' });

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return jsonResponse(500, { error: 'Server not configured' });
    const supabaseAuth = createClient(url, anonKey);
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse(401, { error: 'Invalid session' });

    const body = await req.json().catch(() => ({}));
    const sessionId = body.sessionId;
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
      return jsonResponse(400, { error: 'Invalid sessionId' });
    }

    // Fetch the Checkout Session and its subscription
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'subscription.items.data.price'],
    });

    if (session.mode !== 'subscription') {
      return jsonResponse(400, { error: 'Not a subscription checkout' });
    }
    if (!session.subscription) {
      return jsonResponse(400, { error: 'Session has no subscription yet — try again in a moment' });
    }

    // Auth check: verify the calling user owns this checkout session.
    // Without this, anyone with a valid Supabase token could claim
    // someone else's subscription.
    const supabaseAdmin = getSupabaseAdmin();
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const { data: profile, error: lookupErr } = await supabaseAdmin
      .from('profiles')
      .select('id, stripe_customer_id')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!profile) return jsonResponse(404, { error: 'Profile not found' });
    if (profile.stripe_customer_id && profile.stripe_customer_id !== customerId) {
      // The session belongs to a different customer — refuse
      return jsonResponse(403, { error: 'Session does not belong to this user' });
    }

    // Backfill stripe_customer_id on the profile if it was missing
    // (race where the user signed up before the customer was saved).
    const subscription = typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription, { expand: ['items.data.price'] })
      : session.subscription;

    const fields = subscriptionToProfileFields(subscription, priceIdToTier);
    const update = { ...fields };
    if (!profile.stripe_customer_id && customerId) {
      update.stripe_customer_id = customerId;
    }

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update(update)
      .eq('id', userData.user.id);
    if (updateErr) throw updateErr;

    return jsonResponse(200, {
      ok: true,
      subscription_status: fields.subscription_status,
      subscription_tier: fields.subscription_tier,
      subscription_period: fields.subscription_period,
    });
  } catch (e) {
    console.error('[stripe/sync-after-checkout] error:', e);
    return jsonResponse(500, { error: e.message || 'Server error' });
  }
}
