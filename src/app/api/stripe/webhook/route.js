/**
 * POST /api/stripe/webhook
 *
 * Receives subscription lifecycle events from Stripe and mirrors the
 * state into the profiles table so the app can gate features by
 * subscription status.
 *
 * Events handled:
 *   - checkout.session.completed       initial subscribe
 *   - customer.subscription.created    redundant safety net
 *   - customer.subscription.updated    plan change, trial->paid, past_due, etc.
 *   - customer.subscription.deleted    canceled (with or without immediate)
 *   - invoice.payment_failed           writes status='past_due'
 *
 * Required env: STRIPE_WEBHOOK_SECRET (the signing secret from
 * Stripe Dashboard → Developers → Webhooks → endpoint detail page).
 */

import { getStripe, getSupabaseAdmin, subscriptionToProfileFields } from '@/lib/stripe-server';
import { priceIdToTier } from '@/lib/stripe-prices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Raw body required for signature verification — Stripe signs the
// exact bytes received, so we must NOT use req.json() here.
async function readRawBody(req) {
  const reader = req.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function syncSubscription(subscriptionId) {
  const stripe = getStripe();
  const supabase = getSupabaseAdmin();

  // Re-fetch the subscription so we always work from the canonical
  // current state, not whatever payload Stripe happened to send.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price'],
  });

  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;
  if (!customerId) {
    console.warn('[stripe webhook] subscription has no customer id, skipping');
    return;
  }

  // Find the user this customer belongs to
  const { data: profile, error: lookupErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!profile?.id) {
    console.warn(`[stripe webhook] no profile for customer ${customerId} (subscription ${subscriptionId})`);
    return;
  }

  const fields = subscriptionToProfileFields(subscription, priceIdToTier);
  const { error: updateErr } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', profile.id);
  if (updateErr) throw updateErr;

  console.log(`[stripe webhook] synced subscription ${subscriptionId} for user ${profile.id}: ${fields.subscription_status} / ${fields.subscription_tier} / ${fields.subscription_period}`);
}

export async function POST(req) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return new Response(JSON.stringify({ error: 'Missing signature or webhook secret' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = getStripe();
  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    console.error('[stripe webhook] signature verification failed:', e?.message);
    return new Response(JSON.stringify({ error: 'Bad signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          await syncSubscription(session.subscription);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await syncSubscription(subscription.id);
        break;
      }

      case 'invoice.payment_failed': {
        // Mark the subscription past_due so the paywall kicks in. Stripe
        // also sends a subscription.updated, so this is a safety net.
        const invoice = event.data.object;
        if (invoice.subscription) {
          await syncSubscription(invoice.subscription);
        }
        break;
      }

      default:
        // Ignore other event types — we only care about subscription state.
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(`[stripe webhook] handler error for ${event.type}:`, e);
    // Return 500 so Stripe retries the event — better than dropping it
    return new Response(JSON.stringify({ error: e.message || 'Handler error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
