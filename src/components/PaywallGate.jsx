'use client';
import { useEffect, useState } from 'react';
import { Lock, Sparkles, ArrowRight, Loader2, X, AlertTriangle, Zap } from 'lucide-react';
import { useSubscription, hasActiveSubscription, isInTrial, trialDaysLeft, isComplimentary, syncAfterCheckout } from '@/lib/subscription';

/**
 * Wraps the app's main content. Shows a soft-paywall screen when the
 * signed-in user has no active subscription (trial expired or never
 * started). Doesn't block sign-up or the pricing page itself.
 *
 * Special case: when the URL contains `?session_id=cs_...` (Stripe's
 * post-checkout redirect), we synchronously sync the subscription state
 * before showing the paywall. Eliminates the race between the redirect
 * and the webhook delivery.
 *
 * Renders children unmodified when:
 *   - User isn't signed in (auth handles its own gate)
 *   - Subscription state is still loading
 *   - We're mid-sync after a successful checkout
 *   - User has any kind of active access (trial, active, past_due grace)
 */
export default function PaywallGate({ children }) {
  const { loading, profile, refresh } = useSubscription();
  // True while we're calling /api/stripe/sync-after-checkout. We don't
  // want to flash the paywall during this window — the user JUST paid.
  const [postCheckoutSyncing, setPostCheckoutSyncing] = useState(false);

  // Detect Stripe's post-checkout redirect and force-sync the profile
  // so the gate reads up-to-date state instead of webhook-eventual.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId) return;

    let alive = true;
    setPostCheckoutSyncing(true);

    (async () => {
      try {
        await syncAfterCheckout(sessionId);
        if (!alive) return;
        await refresh();
      } finally {
        if (!alive) return;
        setPostCheckoutSyncing(false);
        // Strip the session_id + subscription params from the URL so a
        // refresh doesn't re-trigger sync.
        params.delete('session_id');
        params.delete('subscription');
        const newSearch = params.toString();
        const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
        window.history.replaceState({}, '', newUrl);
      }
    })();

    return () => { alive = false; };
  }, [refresh]);

  // While the post-checkout sync is in flight, render the children with
  // a small overlay so the user sees progress instead of a paywall flash.
  if (postCheckoutSyncing) {
    return (
      <>
        {children}
        <div className="fixed inset-x-0 top-0 z-50 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm py-2 px-4 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span>Activating your subscription…</span>
        </div>
      </>
    );
  }

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
/**
 * Tiered urgency banner during the 7-day trial. Copy + color shifts based
 * on days left so the message feels right at each stage of the journey:
 *
 *   7+ days  → calm informational ("you're trying it out")
 *   3-7 days → indigo nudge ("a few days left — check out plans")
 *   1-2 days → amber urgency ("don't lose what you've built")
 *   0 days   → red high-pressure ("today is the last day")
 *
 * Optional `stats` prop quantifies what the agent has built so far
 * ({ leadsCount, ytdNet }) — lets the banner say "Keep your 47 leads
 * + $12K tracked" instead of a generic message. LeadTracker passes
 * these in; consumers without stats fall back to generic copy.
 *
 * Dismissible per-day via localStorage. Banner re-appears the next day
 * so it doesn't permanently disappear.
 */
const DISMISS_KEY = 'trial_banner_dismissed_day_v1';

export function TrialBanner({ stats } = {}) {
  const { profile } = useSubscription();
  const [dismissed, setDismissed] = useState(false);

  // Check dismiss flag on mount. Stored as YYYY-MM-DD so it auto-expires
  // when the day rolls over — the banner reappears the next morning even
  // if the agent dismissed yesterday.
  useEffect(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const last = localStorage.getItem(DISMISS_KEY);
      if (last === today) setDismissed(true);
    } catch { /* ignore */ }
  }, []);

  const onDismiss = () => {
    setDismissed(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(DISMISS_KEY, today);
    } catch { /* ignore */ }
  };

  if (!profile) return null;
  if (isComplimentary(profile)) return null;
  if (!isInTrial(profile)) return null;
  if (dismissed) return null;
  const days = trialDaysLeft(profile);
  if (days == null) return null;

  // Stat string — only shown when LeadTracker passes real counts.
  const valueChunks = [];
  if (stats?.leadsCount > 0) valueChunks.push(`${stats.leadsCount} lead${stats.leadsCount === 1 ? '' : 's'}`);
  if (stats?.ytdNet != null && stats.ytdNet !== 0) {
    const fmt = stats.ytdNet >= 0 ? '$' : '−$';
    valueChunks.push(`${fmt}${Math.abs(Math.round(stats.ytdNet)).toLocaleString()} tracked`);
  }
  const valueLine = valueChunks.length > 0 ? valueChunks.join(' + ') : null;

  // Tier resolution.
  const tier = days === 0
    ? 'critical'
    : days <= 2
      ? 'urgent'
      : days <= 4
        ? 'nudge'
        : 'calm';

  const styles = {
    calm:     { bar: 'from-indigo-600 to-violet-600', pill: 'bg-white/15 hover:bg-white/25', Icon: Sparkles },
    nudge:    { bar: 'from-indigo-600 to-violet-600', pill: 'bg-white/15 hover:bg-white/25', Icon: Sparkles },
    urgent:   { bar: 'from-amber-500 to-orange-600',  pill: 'bg-white/20 hover:bg-white/30', Icon: AlertTriangle },
    critical: { bar: 'from-rose-600 to-red-700',      pill: 'bg-white/25 hover:bg-white/35', Icon: Zap },
  }[tier];

  // Copy varies by tier so it doesn't feel like the same generic banner
  // every day. Each tier has its own framing.
  let headline;
  let ctaLabel;
  if (tier === 'critical') {
    headline = (
      <>
        <b>Today is the last day of your trial.</b>
        {valueLine && <> Don&apos;t lose your {valueLine}.</>}
      </>
    );
    ctaLabel = 'Pick a plan now →';
  } else if (tier === 'urgent') {
    headline = (
      <>
        Trial ends in <b>{days} day{days === 1 ? '' : 's'}</b>.
        {valueLine ? <> Keep your {valueLine}.</> : <> Lock in a plan to keep your data.</>}
      </>
    );
    ctaLabel = 'See plans →';
  } else if (tier === 'nudge') {
    headline = (
      <>
        <b>{days} day{days === 1 ? '' : 's'} left</b> on your trial.
        {valueLine ? <> Already tracking {valueLine}.</> : <> Plans start at $49.95/mo.</>}
      </>
    );
    ctaLabel = 'See plans →';
  } else {
    headline = (
      <>
        Free trial — <b>{days} day{days !== 1 ? 's' : ''} left</b>. Plans from $49.95/mo when you&apos;re ready.
      </>
    );
    ctaLabel = 'See plans →';
  }

  const { Icon } = styles;

  return (
    <div className={`bg-gradient-to-r ${styles.bar} text-white text-sm py-2 px-4 flex items-center justify-center gap-3 flex-wrap relative`}>
      <Icon size={14} className="flex-shrink-0" />
      <span>{headline}</span>
      <a
        href="/pricing"
        className={`${styles.pill} rounded-lg px-3 py-1 text-xs font-semibold transition`}
      >
        {ctaLabel}
      </a>
      {/* Dismiss button — only available on calm/nudge tiers. We don't
          let agents bury urgent / critical day banners since those are
          the conversion windows that actually matter. */}
      {(tier === 'calm' || tier === 'nudge') && (
        <button
          onClick={onDismiss}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-1"
          title="Hide for today"
          aria-label="Hide for today"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
