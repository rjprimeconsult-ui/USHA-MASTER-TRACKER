'use client';
/**
 * Profile hub — the agent's personal control center.
 *
 * Lives separate from the gear-icon Settings (which holds destructive
 * data ops). Reached via the user avatar/initial in the top-right
 * header. Sections:
 *   - Identity (display name, email read-only, phone)
 *   - Subscription (plan card, trial countdown, manage billing, upgrade)
 *   - Email Sender Identity (moved from Post-Sale Emails settings)
 *   - Appearance (Phase 2 preview, locked)
 *   - Preferences (Phase 2 preview, locked)
 *
 * Storage:
 *   - display_name / phone → user_kv via `lib/agentProfile.js`
 *   - sender identity     → user_kv via `lib/postSaleEmails.js`
 *   - subscription state  → read-only from Supabase `profiles` table
 *     via `useSubscription`
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User as UserIcon,
  CreditCard,
  Mail,
  Palette,
  Sliders,
  Save,
  Loader2,
  CheckCircle2,
  Lock,
  ExternalLink,
  Sparkles,
  ShieldCheck,
  Clock,
  Phone as PhoneIcon,
  AtSign,
  ArrowUpRight,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import {
  useSubscription,
  openCustomerPortal,
  isInTrial,
  trialDaysLeft,
  isComplimentary,
  hasActiveSubscription,
  SUB_STATUS,
} from '@/lib/subscription';
import { PLAN_DISPLAY } from '@/lib/stripe-prices';
import {
  loadAgentProfile,
  saveAgentProfile,
  formatPhone,
  initialsFor,
  DEFAULT_AGENT_PROFILE,
} from '@/lib/agentProfile';
import {
  loadSenderIdentity,
  saveSenderIdentity,
  isValidEmailAddress,
  DEFAULT_SENDER_IDENTITY,
} from '@/lib/postSaleEmails';

const SECTIONS = [
  { id: 'identity',     label: 'Identity',     icon: UserIcon,   phase: 1 },
  { id: 'subscription', label: 'Subscription', icon: CreditCard, phase: 1 },
  { id: 'sender',       label: 'Email sender', icon: Mail,       phase: 1 },
  { id: 'appearance',   label: 'Appearance',   icon: Palette,    phase: 2 },
  { id: 'preferences',  label: 'Preferences',  icon: Sliders,    phase: 2 },
];

export default function Profile({ open, onClose }) {
  const { user: authUser } = useAuth();
  const { profile: subProfile, loading: subLoading, refresh: refreshSub } = useSubscription();

  const [active, setActive] = useState('identity');
  const [agentProfile, setAgentProfile] = useState({ ...DEFAULT_AGENT_PROFILE });
  const [senderIdentity, setSenderIdentity] = useState({ ...DEFAULT_SENDER_IDENTITY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  // Hydrate when modal opens. Re-fetches on every open so a fresh
  // record from another tab is reflected; doesn't flash a spinner on
  // re-opens since the previous data stays visible during refetch.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([loadAgentProfile(), loadSenderIdentity()]).then(([ap, si]) => {
      if (!alive) return;
      setAgentProfile(ap);
      setSenderIdentity(si);
      setDirty(false);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open]);

  const updateAgent = (patch) => {
    setAgentProfile((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const updateSender = (patch) => {
    setSenderIdentity((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const onSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const [nextAgent, nextSender] = await Promise.all([
        saveAgentProfile(agentProfile),
        saveSenderIdentity(senderIdentity),
      ]);
      setAgentProfile(nextAgent);
      setSenderIdentity(nextSender);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const onManageBilling = async () => {
    setPortalLoading(true);
    try {
      await openCustomerPortal();
    } catch (e) {
      console.warn('[Profile] portal open failed:', e?.message);
      setPortalLoading(false);
    }
    // Note: openCustomerPortal redirects on success; no need to clear loading.
  };

  const initials = useMemo(
    () => initialsFor(agentProfile.displayName, authUser?.email),
    [agentProfile.displayName, authUser?.email]
  );

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="profile-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="profile-card"
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white border border-white/60 shadow-2xl shadow-indigo-500/20 rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
        >
          {/* Top hero strip */}
          <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-5 text-white overflow-hidden">
            {/* Decorative orb */}
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />

            <div className="relative flex items-center gap-4">
              {/* Avatar */}
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 14 }}
                className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/40 flex items-center justify-center text-white text-2xl font-bold shadow-xl"
              >
                {initials}
              </motion.div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h2 className="text-xl font-bold leading-tight truncate">
                    {agentProfile.displayName || 'Your Profile'}
                  </h2>
                  <PlanPill profile={subProfile} loading={subLoading} />
                </div>
                <div className="text-sm text-white/85 flex items-center gap-1.5 truncate">
                  <AtSign size={12} className="opacity-70 flex-shrink-0" />
                  <span className="truncate">{authUser?.email || '—'}</span>
                </div>
              </div>

              <button
                onClick={onClose}
                className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/15 transition flex-shrink-0"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Body — sidebar + content */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Sidebar */}
            <nav className="w-52 bg-slate-50/80 border-r border-slate-200 py-4 px-2 flex-shrink-0 overflow-y-auto">
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                const isActive = active === s.id;
                const isLocked = s.phase > 1;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-0.5 ${
                      isActive
                        ? 'bg-white text-indigo-700 shadow-sm border border-indigo-100'
                        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                    }`}
                  >
                    <Icon size={15} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
                    <span className="flex-1 text-left">{s.label}</span>
                    {isLocked && (
                      <span className="text-[9px] uppercase tracking-wider bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                        Soon
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Helper text at bottom */}
              <div className="mt-6 px-3 py-3 rounded-lg bg-indigo-50/60 border border-indigo-100">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700 uppercase tracking-wider mb-1">
                  <Sparkles size={11} /> Profile
                </div>
                <p className="text-[11px] text-indigo-900/80 leading-relaxed">
                  Personalize how you appear, manage your plan, and dial in your email identity.
                </p>
              </div>
            </nav>

            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-white">
              {loading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin mr-2" /> Loading your profile…
                </div>
              ) : (
                <div className="p-6">
                  {active === 'identity' && (
                    <IdentitySection
                      authUser={authUser}
                      agentProfile={agentProfile}
                      updateAgent={updateAgent}
                      initials={initials}
                    />
                  )}
                  {active === 'subscription' && (
                    <SubscriptionSection
                      profile={subProfile}
                      loading={subLoading}
                      onManageBilling={onManageBilling}
                      portalLoading={portalLoading}
                      onRefresh={refreshSub}
                    />
                  )}
                  {active === 'sender' && (
                    <SenderSection
                      identity={senderIdentity}
                      updateIdentity={updateSender}
                      authEmail={authUser?.email}
                      agentName={agentProfile.displayName}
                    />
                  )}
                  {active === 'appearance' && <AppearancePreview />}
                  {active === 'preferences' && <PreferencesPreview />}
                </div>
              )}
            </div>
          </div>

          {/* Footer — sticky save bar */}
          {!loading && (active === 'identity' || active === 'sender') && (
            <div className="border-t border-slate-200 bg-slate-50/80 backdrop-blur-sm px-6 py-3 flex items-center justify-end gap-3 flex-shrink-0">
              <AnimatePresence>
                {savedFlash && (
                  <motion.span
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    className="text-xs text-emerald-700 flex items-center gap-1 font-medium"
                  >
                    <CheckCircle2 size={13} /> Saved
                  </motion.span>
                )}
              </AnimatePresence>
              {dirty && !savedFlash && (
                <span className="text-xs text-amber-700 font-medium">Unsaved changes</span>
              )}
              <button
                onClick={onSave}
                disabled={!dirty || saving}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm shadow-indigo-500/20 disabled:shadow-none"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save changes
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ----------------------------------------------------------------
 * Plan pill — shown in the hero strip next to display name.
 * --------------------------------------------------------------- */
function PlanPill({ profile, loading }) {
  if (loading) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-white/15 text-white/80 px-2 py-0.5 rounded-full font-bold">
        Loading…
      </span>
    );
  }
  if (isComplimentary(profile)) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-emerald-400/90 text-emerald-950 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
        <ShieldCheck size={10} /> Complimentary
      </span>
    );
  }
  if (isInTrial(profile)) {
    const days = trialDaysLeft(profile);
    return (
      <span className="text-[10px] uppercase tracking-wider bg-amber-300 text-amber-950 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
        <Clock size={10} /> Trial · {days}d
      </span>
    );
  }
  if (profile?.subscription_status === SUB_STATUS.ACTIVE) {
    const tier = profile?.subscription_tier;
    const label = tier ? (PLAN_DISPLAY[tier]?.name || tier) : 'Active';
    return (
      <span className="text-[10px] uppercase tracking-wider bg-white/95 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
        {label}
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider bg-white/15 text-white/85 px-2 py-0.5 rounded-full font-bold">
      No active plan
    </span>
  );
}

/* ----------------------------------------------------------------
 * Identity section
 * --------------------------------------------------------------- */
function IdentitySection({ authUser, agentProfile, updateAgent, initials }) {
  return (
    <SectionShell
      title="Identity"
      description="How you appear inside PRIM. Display name feeds the {agent_name} variable in your email templates; phone feeds {agent_phone}."
    >
      <div className="flex items-start gap-5 mb-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-indigo-500/30 flex-shrink-0">
          {initials}
        </div>
        <div className="text-xs text-slate-500 mt-2 leading-relaxed">
          Avatar uses your initials for now. Custom image upload is coming in Phase 3 alongside dark mode and banner images.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Display name" hint="Used inside PRIM and in your email signature.">
          <input
            type="text"
            value={agentProfile.displayName}
            onChange={(e) => updateAgent({ displayName: e.target.value })}
            placeholder="e.g. Julio Fernandez"
            maxLength={100}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          />
        </Field>

        <Field label="Account email" hint="Locked — change requires re-signing up. Contact support.">
          <div className="relative">
            <input
              type="email"
              value={authUser?.email || ''}
              readOnly
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-600 cursor-not-allowed pr-8"
            />
            <Lock size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </Field>

        <Field label="Phone" hint="Optional. Auto-formats as you type.">
          <div className="relative">
            <PhoneIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="tel"
              value={agentProfile.phone}
              onChange={(e) => updateAgent({ phone: formatPhone(e.target.value) })}
              placeholder="(555) 123-4567"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>
        </Field>
      </div>
    </SectionShell>
  );
}

/* ----------------------------------------------------------------
 * Subscription section
 * --------------------------------------------------------------- */
function SubscriptionSection({ profile, loading, onManageBilling, portalLoading, onRefresh }) {
  if (loading) {
    return (
      <SectionShell title="Subscription" description="Loading…">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading subscription state…
        </div>
      </SectionShell>
    );
  }

  const complimentary = isComplimentary(profile);
  const inTrial = isInTrial(profile);
  const days = trialDaysLeft(profile);
  const active = hasActiveSubscription(profile);
  const tier = profile?.subscription_tier;
  const period = profile?.subscription_period; // 'monthly' | 'yearly'
  const planMeta = tier ? PLAN_DISPLAY[tier] : null;
  const nextBillDate = profile?.current_period_end
    ? new Date(profile.current_period_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const cancelAtEnd = profile?.cancel_at_period_end === true;

  return (
    <SectionShell
      title="Subscription"
      description="Your current plan, status, and billing. Manage your payment method or upgrade tier anytime."
    >
      {/* Plan hero card */}
      <div className="relative bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-900 rounded-2xl p-5 text-white mb-5 overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-indigo-500/30 blur-2xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/60 mb-1 font-bold">
              Current plan
            </div>
            <div className="text-2xl font-bold mb-1">
              {complimentary
                ? 'Complimentary access'
                : planMeta?.name
                ? planMeta.name
                : inTrial
                ? 'Free trial'
                : 'No active plan'}
            </div>
            <div className="text-sm text-white/75">
              {complimentary && 'Full access, courtesy of the team. No card required.'}
              {!complimentary && planMeta && period && (
                <>
                  ${period === 'yearly' ? planMeta.yearly.toLocaleString() : planMeta.monthly.toFixed(2)}
                  {' '}/ {period === 'yearly' ? 'year' : 'month'}
                </>
              )}
              {!complimentary && !planMeta && inTrial && (
                <>You&apos;re inside the 7-day free trial.</>
              )}
              {!complimentary && !planMeta && !inTrial && (
                <>Pick a plan to keep working past your trial.</>
              )}
            </div>
          </div>

          <StatusBadge profile={profile} />
        </div>

        {/* Trial countdown bar */}
        {inTrial && typeof days === 'number' && (
          <div className="relative mt-4 pt-4 border-t border-white/15">
            <div className="flex items-center justify-between text-xs text-white/80 mb-1.5">
              <span className="flex items-center gap-1.5">
                <Clock size={12} /> Trial ends in {days} {days === 1 ? 'day' : 'days'}
              </span>
              {nextBillDate && <span className="font-mono text-[11px]">{nextBillDate}</span>}
            </div>
            <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(8, Math.min(100, (days / 7) * 100))}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="h-full bg-gradient-to-r from-amber-300 to-amber-400 rounded-full"
              />
            </div>
          </div>
        )}

        {/* Renewal / cancel notice */}
        {active && !inTrial && !complimentary && nextBillDate && (
          <div className="relative mt-4 pt-4 border-t border-white/15 text-xs text-white/80">
            {cancelAtEnd
              ? <>Your plan ends on <span className="font-semibold text-amber-200">{nextBillDate}</span>. Reactivate from billing to keep going.</>
              : <>Next bill on <span className="font-semibold">{nextBillDate}</span>.</>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ActionTile
          onClick={onManageBilling}
          disabled={complimentary || portalLoading || !profile?.stripe_customer_id}
          loading={portalLoading}
          icon={CreditCard}
          title="Manage billing"
          description={complimentary
            ? 'Not applicable for complimentary access.'
            : profile?.stripe_customer_id
            ? 'Update card, view invoices, or cancel.'
            : 'No billing account yet — upgrade first.'}
          accent="indigo"
        />
        <ActionTile
          onClick={() => { window.location.href = '/pricing'; }}
          icon={ArrowUpRight}
          title={planMeta?.name === 'Team' ? 'View plans' : 'Upgrade plan'}
          description={planMeta?.name === 'Team'
            ? 'You&apos;re on the top tier. Compare plans or downgrade.'
            : 'See higher tiers, features, and yearly savings.'}
          accent="violet"
          external
        />
      </div>

      <div className="mt-5 text-xs text-slate-500 flex items-center gap-1.5">
        <ShieldCheck size={12} className="text-emerald-600" />
        Billing handled by Stripe. PRIM never stores your card details.
      </div>
    </SectionShell>
  );
}

function StatusBadge({ profile }) {
  if (isComplimentary(profile)) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-emerald-400/90 text-emerald-950 px-2 py-1 rounded font-bold flex items-center gap-1 flex-shrink-0">
        <ShieldCheck size={10} /> Active
      </span>
    );
  }
  const s = profile?.subscription_status;
  if (s === SUB_STATUS.ACTIVE) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-emerald-400/90 text-emerald-950 px-2 py-1 rounded font-bold flex-shrink-0">
        Active
      </span>
    );
  }
  if (s === SUB_STATUS.TRIALING) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-amber-300 text-amber-950 px-2 py-1 rounded font-bold flex-shrink-0">
        Trialing
      </span>
    );
  }
  if (s === SUB_STATUS.PAST_DUE) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-rose-300 text-rose-950 px-2 py-1 rounded font-bold flex-shrink-0">
        Past due
      </span>
    );
  }
  if (s === SUB_STATUS.CANCELED) {
    return (
      <span className="text-[10px] uppercase tracking-wider bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold flex-shrink-0">
        Canceled
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider bg-white/20 text-white/85 px-2 py-1 rounded font-bold flex-shrink-0">
      Inactive
    </span>
  );
}

function ActionTile({ onClick, disabled, loading, icon: Icon, title, description, accent = 'indigo', external = false }) {
  const accentMap = {
    indigo: 'from-indigo-50 to-indigo-100/50 border-indigo-200 hover:border-indigo-300 text-indigo-700',
    violet: 'from-violet-50 to-violet-100/50 border-violet-200 hover:border-violet-300 text-violet-700',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative bg-gradient-to-br ${accentMap[accent]} border rounded-xl p-4 text-left transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-current`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`w-9 h-9 rounded-lg bg-white border border-current/20 flex items-center justify-center shadow-sm`}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
        </div>
        {external
          ? <ArrowUpRight size={14} className="opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
          : <ExternalLink size={13} className="opacity-50 group-hover:opacity-100 transition" />}
      </div>
      <div className="font-semibold text-sm text-slate-900 mb-0.5">{title}</div>
      <div className="text-xs text-slate-600 leading-snug">{description}</div>
    </button>
  );
}

/* ----------------------------------------------------------------
 * Email sender identity section
 * --------------------------------------------------------------- */
function SenderSection({ identity, updateIdentity, authEmail, agentName }) {
  const addrLooksOk = !identity.fromAddress || isValidEmailAddress(identity.fromAddress);
  const previewName = identity.fromName || agentName || (authEmail || '').split('@')[0] || 'PRIM';
  const previewAddr = identity.fromAddress || 'welcome@contact.primtracker.com';

  return (
    <SectionShell
      title="Email sender identity"
      description="How outbound post-sale emails appear to your customers. Leave both fields blank to use the PRIM default."
    >
      <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 mb-5 text-xs text-amber-900 flex items-start gap-2">
        <ShieldCheck size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
        <div>
          <span className="font-semibold">Domain verification required.</span>{' '}
          Custom From addresses only work on a domain that&apos;s been verified in Resend. Otherwise sends silently fail.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="From name" hint="What customers see in their inbox as the sender's name.">
          <input
            type="text"
            value={identity.fromName}
            onChange={(e) => updateIdentity({ fromName: e.target.value })}
            placeholder="Julio Fernandez"
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          />
        </Field>
        <Field label="From address" hint="Must be on a Resend-verified domain.">
          <input
            type="email"
            value={identity.fromAddress}
            onChange={(e) => updateIdentity({ fromAddress: e.target.value })}
            placeholder="julio.fernandez@rjprimehealth.com"
            className={`w-full bg-slate-50 border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition ${
              addrLooksOk ? 'border-slate-200' : 'border-rose-300'
            }`}
          />
          {!addrLooksOk && (
            <p className="text-[11px] text-rose-700 mt-1">That doesn&apos;t look like a valid email.</p>
          )}
        </Field>
      </div>

      {/* Live preview */}
      <div className="mt-5">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Preview</div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">From</div>
          <div className="font-mono text-sm text-slate-900 mb-3">
            {previewName} &lt;{previewAddr}&gt;
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Reply-To</div>
          <div className="font-mono text-sm text-slate-700">
            {previewAddr}
          </div>
          {!identity.fromName && !identity.fromAddress && (
            <div className="mt-3 text-xs text-slate-500 italic">
              Using PRIM default sender. Customer replies land in <span className="font-mono">welcome@contact.primtracker.com</span>.
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

/* ----------------------------------------------------------------
 * Appearance — Phase 2 preview
 * --------------------------------------------------------------- */
function AppearancePreview() {
  const palettes = [
    { id: 'indigo',  name: 'Indigo',  from: '#6366F1', to: '#8B5CF6' },
    { id: 'emerald', name: 'Emerald', from: '#10B981', to: '#14B8A6' },
    { id: 'rose',    name: 'Rose',    from: '#F43F5E', to: '#EC4899' },
    { id: 'amber',   name: 'Amber',   from: '#F59E0B', to: '#EF4444' },
    { id: 'teal',    name: 'Teal',    from: '#06B6D4', to: '#3B82F6' },
  ];
  return (
    <SectionShell
      title="Appearance"
      description="Pick an accent palette that flows through PRIM's buttons, badges, and highlights. Dark mode and banner image are on the Phase 3 roadmap."
    >
      <ComingSoonBanner phase={2} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 opacity-60 pointer-events-none">
        {palettes.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div
              className="w-full h-12 rounded-lg mb-2 shadow-inner"
              style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
            />
            <div className="text-xs font-semibold text-slate-700 text-center">{p.name}</div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

/* ----------------------------------------------------------------
 * Preferences — Phase 2 preview
 * --------------------------------------------------------------- */
function PreferencesPreview() {
  return (
    <SectionShell
      title="Preferences"
      description="Tune how PRIM behaves day-to-day: assistant language, default lead source, email opt-ins."
    >
      <ComingSoonBanner phase={2} />
      <div className="mt-4 space-y-2 opacity-60 pointer-events-none">
        <PreferenceRow label="PRIM Assistant language" value="English (US)" />
        <PreferenceRow label="Default lead source" value="Smart Import (AI)" />
        <PreferenceRow label="Email digest" value="Weekly summary" />
      </div>
    </SectionShell>
  );
}

function PreferenceRow({ label, value }) {
  return (
    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="text-sm text-slate-500">{value}</div>
    </div>
  );
}

function ComingSoonBanner({ phase }) {
  return (
    <div className="bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
      <Sparkles size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
      <div>
        <div className="font-semibold text-sm text-indigo-900 mb-0.5">
          Coming in Phase {phase}
        </div>
        <p className="text-xs text-indigo-900/75 leading-relaxed">
          Preview only — wired and ready to ship. We&apos;re finalizing Phase 1 (Identity · Subscription · Sender) first.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
 * Shared shells
 * --------------------------------------------------------------- */
function SectionShell({ title, description, children }) {
  return (
    <motion.div
      key={title}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mb-5">
        <h3 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h3>
        {description && (
          <p className="text-sm text-slate-500 mt-1 leading-relaxed max-w-2xl">{description}</p>
        )}
      </div>
      {children}
    </motion.div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}
