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
 * useSubscription's profile SELECT (subscription.js) includes `is_admin`
 * and `is_complimentary`, so the admin and complimentary overrides in
 * canAccessBetaFeature work client-side too — no allowlist workaround
 * needed (the old note claiming is_admin was missing was stale).
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
