/**
 * React hook for beta feature gating.
 *
 * Reads the user's profile via useSubscription() and returns the access
 * result for a given beta-feature key. Pairs with the pure access checker
 * in featureFlags.js (which is server-import-safe).
 */

'use client';
import { useMemo } from 'react';
import { useSubscription } from './subscription';
import { BETA_FEATURES, canAccessBetaFeature } from './featureFlags';

/**
 * Usage:
 *   const { canAccess, loading, reason, profile, feature } = useBetaFeature('post_sale_emails');
 *
 * IMPORTANT: useSubscription's profile shape doesn't currently include
 * `is_admin`. If admin override matters for your beta, either:
 *   (a) extend the select in subscription.js to include is_admin, OR
 *   (b) add the admin user's email to betaAllowlist in featureFlags.js.
 * For PRIM today, option (b) is in place.
 */
export function useBetaFeature(featureKey) {
  const { profile, loading } = useSubscription();
  const result = useMemo(
    () => (loading ? { canAccess: false, reason: 'loading' } : canAccessBetaFeature(featureKey, profile)),
    [featureKey, profile, loading]
  );
  return {
    ...result,
    loading,
    profile,
    feature: BETA_FEATURES[featureKey] || null,
  };
}
