'use client';
import { useEffect } from 'react';
import { Lock, Sparkles, ArrowRight } from 'lucide-react';
import { useSubscription, hasActiveSubscription, isInTrial, trialDaysLeft } from '@/lib/subscription';

/**
 * Wraps the app's main content. Shows a soft-paywall screen when the
 * signed-in user has no active subscription (trial expired or never
 * started). Doesn't block sign-up or the pricing page itself.
 *
 * Renders children unmodified when:
 *   - User isn't signed in (auth handles its own gate)
 *   - Subscription state is still loading
 *   - User has any kind of active access (trial, active, past_due grace)
 */
export default function PaywallGate({ children }) {
  const { loading, profile } = useSubscription();

  // Don't gate during initial load — would flash the paywall on first
  // paint before the profile has loaded. Don't gate signed-out users
  // either — let the regular sign-in flow handle them.
  if (loading || !profile) return children;

  if (hasActiveSubscription(profile)) return children;

  // No active subscription → soft paywall
  return <PaywallScreen profile={profile} />;
}

function PaywallScreen({ profile }) {
  // Auto-redirect to /pricing after a short beat so users land where
  // the action is, not on a dead-end "you're locked out" page.
  useEffect(() => {
    const t = setTimeout(() => {
      window.location.href = '/pricing';
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  const wasInTrial = profile?.trial_ends_at;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg">
          <Lock size={28} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {wasInTrial ? 'Your trial ended' : 'Subscription required'}
        </h1>
        <p className="text-slate-600 mb-6">
          {wasInTrial
            ? 'Pick a plan to keep using PRIM. Your data is safe and waiting — nothing is deleted.'
            : 'Pick a plan to unlock PRIM. 7-day free trial on every plan, cancel anytime.'}
        </p>
        <a
          href="/pricing"
          className="inline-flex items-center gap-2 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl px-5 py-2.5 font-semibold shadow-lg shadow-indigo-500/30"
        >
          <Sparkles size={16} /> See plans <ArrowRight size={16} />
        </a>
        <p className="text-xs text-slate-400 mt-6">Redirecting…</p>
      </div>
    </div>
  );
}

/**
 * Trial countdown banner shown above the app while the user is still
 * inside their 7-day trial. Auto-hides for active paid subscribers.
 */
export function TrialBanner() {
  const { profile } = useSubscription();

  if (!profile) return null;
  if (!isInTrial(profile)) return null;
  const days = trialDaysLeft(profile);
  if (days == null) return null;

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm py-2 px-4 flex items-center justify-center gap-3 flex-wrap">
      <Sparkles size={14} />
      <span>
        Free trial — <b>{days} day{days !== 1 ? 's' : ''} left</b>. Add a plan now to keep using PRIM after the trial ends.
      </span>
      <a
        href="/pricing"
        className="bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1 text-xs font-semibold transition"
      >
        See plans →
      </a>
    </div>
  );
}
