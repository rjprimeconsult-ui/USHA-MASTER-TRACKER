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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  Camera,
  Image as ImageIcon,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import { PrimAppIcon } from '@/components/PrimLogo';
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
  PALETTES,
  applyAccentToDOM,
  applyThemeToDOM,
  compressForProfile,
} from '@/lib/agentProfile';
import { Sun, Moon, Monitor } from 'lucide-react';
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

// Lead-source options for the Preferences default-source dropdown.
// Matches the most common values the lead form already uses; agents
// can still pick anything inside the form itself.
const LEAD_SOURCE_OPTIONS = [
  { value: '',            label: 'No default (pick each time)' },
  { value: 'AGED',        label: 'Aged leads' },
  { value: 'INTERNET',    label: 'Internet leads' },
  { value: 'REFERRAL',    label: 'Referral' },
  { value: 'PERSONAL',    label: 'Personal market' },
  { value: 'SOCIAL',      label: 'Social media' },
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
  // Original accent + theme at modal-open time — used to revert live
  // previews when the user closes without saving.
  const [originalAccent, setOriginalAccent] = useState('indigo');
  const [originalTheme, setOriginalTheme] = useState('light');

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
      setOriginalAccent(ap.accent || 'indigo');
      setOriginalTheme(ap.theme || 'light');
      setDirty(false);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open]);

  const updateAgent = (patch) => {
    setAgentProfile((prev) => {
      const next = { ...prev, ...patch };
      // Live-preview accent changes so the hero strip + avatar repaint
      // instantly as the user clicks through palettes.
      if (patch.accent && patch.accent !== prev.accent) {
        applyAccentToDOM(patch.accent);
        window.dispatchEvent(new CustomEvent('prim:accent-changed', { detail: { accent: patch.accent } }));
      }
      // Same idea for theme — flip the dark class instantly.
      if (patch.theme && patch.theme !== prev.theme) {
        applyThemeToDOM(patch.theme);
        window.dispatchEvent(new CustomEvent('prim:theme-changed', { detail: { theme: patch.theme } }));
      }
      return next;
    });
    setDirty(true);
  };
  const updateSender = (patch) => {
    setSenderIdentity((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  // Close handler — revert any unsaved live-preview changes (accent or
  // theme) so closing the modal feels safe even after exploring.
  const handleClose = () => {
    if (dirty) {
      if (agentProfile.accent !== originalAccent) {
        applyAccentToDOM(originalAccent);
        window.dispatchEvent(new CustomEvent('prim:accent-changed', { detail: { accent: originalAccent } }));
      }
      if (agentProfile.theme !== originalTheme) {
        applyThemeToDOM(originalTheme);
        window.dispatchEvent(new CustomEvent('prim:theme-changed', { detail: { theme: originalTheme } }));
      }
    }
    onClose?.();
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
      setOriginalAccent(nextAgent.accent); // new baseline — don't revert on close
      setOriginalTheme(nextAgent.theme);
      setDirty(false);
      setSavedFlash(true);
      // Tell the rest of the app (header avatar, etc.) to re-read.
      window.dispatchEvent(new CustomEvent('prim:profile-saved'));
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
        onClick={handleClose}
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
          {/* Top hero strip — uses accent palette so theme picks flow here.
              If the agent uploaded a banner image, it replaces the gradient
              with a darkening overlay so the text + avatar stay readable. */}
          <div
            className="relative bg-accent-gradient px-6 py-5 text-white overflow-hidden"
            style={agentProfile.bannerUrl ? {
              backgroundImage: `linear-gradient(135deg, rgba(15,23,42,0.55), rgba(15,23,42,0.35)), url(${agentProfile.bannerUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            } : undefined}
          >
            {/* Decorative orbs — softened when a banner is set so they don't
                fight with the user's image. */}
            <div className={`absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none ${agentProfile.bannerUrl ? 'opacity-40' : ''}`} />
            <div className={`absolute -bottom-16 -left-8 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none ${agentProfile.bannerUrl ? 'opacity-40' : ''}`} />

            <div className="relative flex items-center gap-4">
              {/* Avatar — uses uploaded photo when set, falls back to initials */}
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 14 }}
                className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/40 flex items-center justify-center text-white text-2xl font-bold shadow-xl overflow-hidden"
              >
                {agentProfile.avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={agentProfile.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : initials}
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
                onClick={handleClose}
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
                return (
                  <button
                    key={s.id}
                    onClick={() => setActive(s.id)}
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition mb-0.5 ${
                      isActive
                        ? 'bg-white text-accent shadow-sm border border-slate-200'
                        : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                    }`}
                  >
                    <Icon size={15} className={isActive ? 'text-accent' : 'text-slate-400'} />
                    <span className="flex-1 text-left">{s.label}</span>
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
                  {active === 'appearance' && (
                    <AppearanceSection
                      agentProfile={agentProfile}
                      updateAgent={updateAgent}
                    />
                  )}
                  {active === 'preferences' && (
                    <PreferencesSection
                      agentProfile={agentProfile}
                      updateAgent={updateAgent}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer — sticky save bar. Subscription is read-only; everything else can be edited. */}
          {!loading && active !== 'subscription' && (
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
        <AvatarUploader
          avatarUrl={agentProfile.avatarUrl}
          initials={initials}
          onChange={(url) => updateAgent({ avatarUrl: url })}
        />
        <div className="text-xs text-slate-500 mt-2 leading-relaxed flex-1">
          Upload a photo to replace the initials avatar. We&apos;ll crop to a square and compress automatically — keeps your profile fast to load.
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
      // 60% opacity when disabled (was 40%) so the tile + text stay
      // readable on dark backgrounds. Cursor still signals it's inactive.
      className={`group relative bg-gradient-to-br ${accentMap[accent]} border rounded-xl p-4 text-left transition disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:border-current`}
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
      {/* slate-700 (not -600) for better contrast against the brand-tinted
          gradient backdrop in both light + dark modes. */}
      <div className="text-xs text-slate-700 leading-snug">{description}</div>
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
 * Appearance — accent palette picker with live preview
 * --------------------------------------------------------------- */
function AppearanceSection({ agentProfile, updateAgent }) {
  const current = agentProfile.accent || 'indigo';
  const currentTheme = agentProfile.theme || 'light';
  return (
    <SectionShell
      title="Appearance"
      description="Pick a theme, an accent palette, and an optional banner. Your choices flow across the PRIM logo, your avatar, the page background, and other branded touches."
    >
      {/* Theme — Light / System / Dark */}
      <div className="mb-6">
        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Theme</div>
        <div className="inline-flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1 gap-1">
          {[
            { id: 'light',  label: 'Light',  icon: Sun },
            { id: 'system', label: 'System', icon: Monitor },
            { id: 'dark',   label: 'Dark',   icon: Moon },
          ].map((opt) => {
            const Icon = opt.icon;
            const isSelected = currentTheme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateAgent({ theme: opt.id })}
                className={`text-sm font-semibold px-4 py-2 rounded-lg transition flex items-center gap-2 ${
                  isSelected
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon size={14} />
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
          {currentTheme === 'system'
            ? 'Follows your operating system setting. Changes automatically when your OS switches.'
            : currentTheme === 'dark'
            ? 'Easier on the eyes for late-night work. Save to lock it in.'
            : 'Bright and crisp. The classic PRIM look.'}
        </p>
      </div>

      {/* Accent palette */}
      <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Accent palette</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {PALETTES.map((p) => {
          const isSelected = current === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => updateAgent({ accent: p.id })}
              className={`group relative rounded-xl border-2 bg-white p-3 text-left transition ${
                isSelected
                  ? 'border-slate-900 shadow-lg'
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
              }`}
              style={isSelected ? {
                borderColor: p.solid,
                boxShadow: `0 10px 25px -10px ${p.solid}66`,
              } : undefined}
            >
              <div
                className="w-full h-16 rounded-lg mb-2 shadow-inner relative overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
              >
                {isSelected && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-white/95 rounded-full p-1.5 shadow-md">
                      <CheckCircle2 size={16} style={{ color: p.solid }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="text-sm font-semibold text-slate-900 leading-tight">{p.name}</div>
              <div className="text-[11px] text-slate-500 leading-snug mt-0.5">{p.description}</div>
            </button>
          );
        })}
      </div>

      {/* Live preview — uses the actual page tint var so it mirrors what
          you'll see behind the modal once you close it. */}
      <div
        className="mt-6 border border-slate-200 rounded-xl p-4 transition-colors"
        style={{ backgroundColor: 'var(--prim-bg-tint)' }}
      >
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Live preview</div>
        <div className="flex items-center gap-4">
          {/* Mini header preview */}
          <div className="flex items-center gap-2 bg-white rounded-lg p-2.5 border border-slate-200 flex-1">
            <PrimAppIcon size={28} className="rounded-md shadow-sm" />
            <div className="text-xs">
              <div className="font-bold text-slate-900 leading-tight">PRIM</div>
              <div className="text-[10px] text-slate-500 leading-tight">Your header</div>
            </div>
          </div>
          {/* Mini button preview */}
          <button
            type="button"
            disabled
            className="bg-accent-gradient text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-accent"
          >
            Primary action
          </button>
        </div>
        <div className="mt-3 text-[10px] text-slate-500 italic">
          The card backdrop above is your page tint — soft and matched to the accent so it never fights with content.
        </div>
      </div>

      <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
        Save changes to lock it in — closing without saving reverts to your current accent.
      </p>

      {/* Banner image — sits below the palette picker so the page flow
          is: pick palette → see preview → personalize the hero. */}
      <div className="mt-8 pt-6 border-t border-slate-200">
        <BannerUploader
          bannerUrl={agentProfile.bannerUrl}
          onChange={(url) => updateAgent({ bannerUrl: url })}
        />
      </div>
    </SectionShell>
  );
}

/* ----------------------------------------------------------------
 * Preferences — language, default lead source, email opt-ins
 * --------------------------------------------------------------- */
function PreferencesSection({ agentProfile, updateAgent }) {
  return (
    <SectionShell
      title="Preferences"
      description="Day-to-day defaults. The PRIM Assistant language used to live inside the chatbot itself — it's centralized here now."
    >
      <div className="space-y-4">
        {/* Language */}
        <PrefRow
          label="PRIM Assistant language"
          description="Drives chatbot replies, voice recognition, and proactive starters."
        >
          <SegmentedControl
            value={agentProfile.language || 'en'}
            onChange={(v) => updateAgent({ language: v })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
        </PrefRow>

        {/* Default lead source */}
        <PrefRow
          label="Default lead source"
          description="Pre-selects this source when you open the lead form. You can always change it per-lead."
        >
          <select
            value={agentProfile.defaultLeadSource || ''}
            onChange={(e) => updateAgent({ defaultLeadSource: e.target.value })}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition min-w-[200px]"
          >
            {LEAD_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </PrefRow>

        {/* Email digest */}
        <PrefRow
          label="Weekly digest email"
          description="Summary of your week — closed deals, CPA, and pipeline movement. Sent Monday mornings."
        >
          <SegmentedControl
            value={agentProfile.emailDigest || 'weekly'}
            onChange={(v) => updateAgent({ emailDigest: v })}
            options={[
              { value: 'weekly', label: 'Weekly' },
              { value: 'never',  label: 'Never' },
            ]}
          />
        </PrefRow>

        {/* Product updates */}
        <PrefRow
          label="Product update emails"
          description="Heads-up when new features ship. ~1-2 emails per month."
        >
          <ToggleSwitch
            checked={agentProfile.productUpdates !== false}
            onChange={(v) => updateAgent({ productUpdates: v })}
          />
        </PrefRow>
      </div>
    </SectionShell>
  );
}

function PrefRow({ label, description, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">{label}</div>
        {description && (
          <div className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">{description}</div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
      {options.map((o) => {
        const isSelected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${
              isSelected
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition ${
        checked ? 'bg-accent-gradient' : 'bg-slate-300'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
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

/* ----------------------------------------------------------------
 * Image uploaders — shared logic for avatar + banner
 * --------------------------------------------------------------- */
function AvatarUploader({ avatarUrl, initials, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await compressForProfile(file, 'avatar');
      onChange(result.dataUrl);
    } catch (e) {
      setError(e?.message || 'Could not process that image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-shrink-0">
      <div className="relative w-20 h-20 group">
        <div className="w-20 h-20 rounded-2xl bg-accent-gradient flex items-center justify-center text-white text-3xl font-bold shadow-accent overflow-hidden">
          {avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : initials}
        </div>

        {/* Edit overlay (camera icon) */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="absolute inset-0 rounded-2xl bg-slate-900/55 opacity-0 group-hover:opacity-100 disabled:opacity-100 flex items-center justify-center text-white transition"
          title={avatarUrl ? 'Change photo' : 'Upload photo'}
        >
          {busy ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 disabled:text-slate-400"
        >
          {avatarUrl ? 'Change' : 'Upload'}
        </button>
        {avatarUrl && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[11px] font-semibold text-slate-500 hover:text-rose-600"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <div className="mt-1 text-[11px] text-rose-700 flex items-center gap-1 max-w-[10rem] leading-snug">
          <AlertTriangle size={10} className="flex-shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

function BannerUploader({ bannerUrl, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await compressForProfile(file, 'banner');
      onChange(result.dataUrl);
    } catch (e) {
      setError(e?.message || 'Could not process that image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
        Profile banner
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        Optional photo for the top of your Profile hub. Wide images work best (16:4 or wider). Falls back to your accent gradient when no banner is set.
      </p>

      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
        {bannerUrl ? (
          <div
            className="w-full h-32"
            style={{
              backgroundImage: `linear-gradient(135deg, rgba(15,23,42,0.45), rgba(15,23,42,0.25)), url(${bannerUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        ) : (
          <div className="w-full h-32 bg-accent-gradient flex items-center justify-center text-white/85 text-xs font-medium">
            No banner — using accent gradient
          </div>
        )}

        {/* Hover overlay actions */}
        <div className="absolute inset-0 bg-slate-900/55 opacity-0 hover:opacity-100 transition flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="bg-white/95 hover:bg-white text-slate-900 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
            {bannerUrl ? 'Replace' : 'Upload'}
          </button>
          {bannerUrl && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="bg-rose-600/95 hover:bg-rose-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {error && (
        <div className="mt-2 text-xs text-rose-700 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </div>
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
