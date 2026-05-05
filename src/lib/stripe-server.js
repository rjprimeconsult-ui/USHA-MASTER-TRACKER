/**
 * Server-side Stripe helpers. Never imported from client code.
 *
 * Reads STRIPE_SECRET_KEY from env. Routes that touch Stripe (checkout,
 * portal, webhook) all go through this module so config + error handling
 * stay consistent.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

let _stripe = null;
export function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = new Stripe(key, {
    apiVersion: '2025-08-27.basil',
    typescript: false,
  });
  return _stripe;
}

/**
 * Service-role Supabase client for server-side writes that bypass RLS.
 * Used by the webhook to update profiles after subscription events.
 * NEVER expose to the client.
 */
let _supabaseAdmin = null;
export function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
  _supabaseAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabaseAdmin;
}

/**
 * Find or create a Stripe Customer for a Supabase user. Idempotent and
 * resilient to test↔live key swaps:
 *
 *   1. Looks up profiles.stripe_customer_id
 *   2. If present, verifies the customer still exists in CURRENT Stripe
 *      mode (i.e. test customers don't exist when using live keys, and
 *      vice versa). When the lookup returns 'resource_missing', the
 *      stored ID is treated as stale and we create a fresh customer.
 *      Other Stripe errors propagate.
 *   3. If absent or stale, creates a new Customer and saves the new ID.
 *
 * This means the only manual recovery needed when swapping modes is
 * nothing — the next checkout attempt heals itself.
 */
export async function ensureStripeCustomer({ userId, email }) {
  const supabase = getSupabaseAdmin();
  const stripe = getStripe();

  // Look up existing profile
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', userId)
    .single();

  if (profileErr) {
    if (profileErr.code === 'PGRST116') {
      // Profile doesn't exist yet (rare, depends on auth flow) — create it
      await supabase.from('profiles').insert({ id: userId, email });
    } else {
      throw profileErr;
    }
  }

  // If we have a saved customer ID, verify it still resolves in the
  // current Stripe mode. A stale ID returns 'resource_missing' — that's
  // the cue to drop it and create a fresh customer.
  if (profile?.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(profile.stripe_customer_id);
      // Stripe returns the customer object even when "deleted" (with
      // .deleted === true). Treat deleted as stale too.
      if (existing && !existing.deleted) {
        return profile.stripe_customer_id;
      }
      // fall through to recreate
    } catch (e) {
      const code = e?.code || e?.raw?.code;
      const status = e?.statusCode;
      if (code === 'resource_missing' || status === 404) {
        // Stale customer ID (likely from a test/live key swap). Drop it.
        console.warn(`[stripe] stale customer ${profile.stripe_customer_id} for user ${userId} — recreating`);
      } else {
        throw e;
      }
    }
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email: email || profile?.email || undefined,
    metadata: { supabase_user_id: userId },
  });

  // Save back to profile (overwrites any stale value)
  await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  return customer.id;
}

/**
 * Translate a Stripe subscription object into our profiles columns.
 * Centralized so checkout, webhook, and portal flows write the same shape.
 */
export function subscriptionToProfileFields(subscription, priceIdToTier) {
  const item = subscription?.items?.data?.[0];
  const priceId = item?.price?.id || null;
  const mapping = priceId ? priceIdToTier(priceId) : null;

  return {
    subscription_status: subscription.status, // 'trialing' | 'active' | 'past_due' | etc.
    subscription_tier: mapping?.tier || null,
    subscription_period: mapping?.period || null,
    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: !!subscription.cancel_at_period_end,
  };
}
