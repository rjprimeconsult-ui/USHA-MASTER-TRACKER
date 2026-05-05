/**
 * Client-side subscription state.
 *
 * Reads from the user's profile row + computes derived state (in-trial,
 * paywall-active, days-left). Used by paywall gates and trial banners.
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase, supabaseConfigured } from './supabase';

export const SUB_STATUS = {
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  UNPAID: 'unpaid',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
};

/**
 * Returns true when the user has full access. That's:
 *   - status='trialing' AND trial hasn't ended
 *   - status='active'
 *   - status='past_due' AND we're inside a grace period (kept generous so
 *     a card decline doesn't kill productivity mid-import)
 */
export function hasActiveSubscription(profile) {
  if (!profile) return false;
  const s = profile.subscription_status;
  if (s === SUB_STATUS.ACTIVE) return true;
  if (s === SUB_STATUS.TRIALING) {
    if (!profile.trial_ends_at) return true; // no end -> still trialing
    return new Date(profile.trial_ends_at).getTime() > Date.now();
  }
  if (s === SUB_STATUS.PAST_DUE) return true; // grace period — gate elsewhere if needed
  return false;
}

export function isInTrial(profile) {
  if (!profile) return false;
  if (profile.subscription_status !== SUB_STATUS.TRIALING) return false;
  if (!profile.trial_ends_at) return true;
  return new Date(profile.trial_ends_at).getTime() > Date.now();
}

export function trialDaysLeft(profile) {
  if (!profile?.trial_ends_at) return null;
  const ms = new Date(profile.trial_ends_at).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Hook: loads the current user's profile (subscription + tier fields)
 * and re-fetches whenever auth state changes. Returns:
 *   { loading, profile, refresh }
 *
 * Returns profile=null when signed out.
 */
export function useSubscription() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabaseConfigured()) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, subscription_status, subscription_tier, subscription_period, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[useSubscription] profile load failed:', error.message);
      setProfile(null);
    } else {
      setProfile(data || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    if (!supabaseConfigured()) return;
    const { data: sub } = supabase.auth.onAuthStateChange(() => { refresh(); });
    return () => { sub?.subscription?.unsubscribe?.(); };
  }, [refresh]);

  return { loading, profile, refresh };
}

/**
 * Open the Stripe Customer Portal — used by the "Manage subscription"
 * button in Settings. Hits our server, redirects to Stripe-hosted UI.
 */
export async function openCustomerPortal() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch('/api/stripe/portal', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.url) window.location.href = data.url;
}

/**
 * Start checkout for a given price ID. Redirects to Stripe-hosted
 * Checkout. If user isn't signed in, redirects to signup first.
 */
export async function startCheckout(priceId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    // Send to home, which will surface the auth flow
    window.location.href = '/?signup=1';
    return;
  }
  const res = await fetch('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.url) window.location.href = data.url;
}
