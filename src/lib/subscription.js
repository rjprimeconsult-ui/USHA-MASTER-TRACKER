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

// Full-access check now lives in the pure resolver (subscriptionAccess.mjs)
// so client and server can never disagree — re-exported here for existing
// callers (PaywallGate, Profile). Alias of isFull: comp/admin/active/trialing
// are full; past_due is now BASIC (limited), no longer "active".
export { hasActiveSubscription } from './subscriptionAccess.mjs';

/**
 * True when the user has complimentary access (no Stripe sub, no trial).
 * Used to suppress the trial countdown banner since it's not meaningful
 * for these users.
 */
export function isComplimentary(profile) {
  return profile?.is_complimentary === true;
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
      .select('id, email, subscription_status, subscription_tier, subscription_period, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id, is_complimentary, is_admin, past_due_since')
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
 * Synchronously sync subscription state from a completed Checkout
 * Session. Called right after Stripe redirects back with `?session_id=`
 * so the user's profile is up to date before the paywall checks state.
 *
 * Returns { ok, subscription_status, ... } on success, or null if the
 * call fails (caller is expected to fall back to webhook eventual
 * consistency in that case).
 */
export async function syncAfterCheckout(sessionId) {
  if (!sessionId) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return null;
  try {
    const res = await fetch('/api/stripe/sync-after-checkout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('[syncAfterCheckout] failed:', data?.error || res.status);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[syncAfterCheckout] error:', e?.message);
    return null;
  }
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
