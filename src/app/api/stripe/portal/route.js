/**
 * POST /api/stripe/portal
 *
 * Creates a Stripe Customer Portal session so the user can manage
 * their subscription (change plan, update card, cancel) on
 * Stripe-hosted UI. Returns { url } for redirect.
 */

import { createClient } from '@supabase/supabase-js';
import { getStripe, ensureStripeCustomer } from '@/lib/stripe-server';

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
    const auth = req.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return jsonResponse(401, { error: 'Missing bearer token' });

    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return jsonResponse(500, { error: 'Server not configured' });
    const supabase = createClient(url, anonKey);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse(401, { error: 'Invalid session' });

    const customerId = await ensureStripeCustomer({
      userId: userData.user.id,
      email: userData.user.email,
    });

    const origin = req.headers.get('origin') || 'https://primtracker.com';
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/?portal=closed`,
    });

    return jsonResponse(200, { url: session.url });
  } catch (e) {
    console.error('[stripe/portal] error:', e);
    return jsonResponse(500, { error: e.message || 'Server error' });
  }
}
