'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calculator, Repeat, CheckSquare, LayoutDashboard, Users, Columns, Upload, Settings, Sparkles, DollarSign, BookOpen, LogOut, UserPlus, User as UserIcon,
} from 'lucide-react';
import { storage, onStorageError } from '@/lib/storage';
import { deleteAttachment as deleteAttachmentFromIdb } from '@/lib/attachments';
import { mkLead, migrateLead, SEED_LEADS, SEED_INVESTMENTS, SEED_ACTIVITIES } from '@/lib/seed';
import { today, uid, getWeekStart } from '@/lib/utils';
import {
  isPricedAssociation,
  NAV_TABS,
  PLATFORM_EXPENSE_CATEGORIES,
  PLATFORM_ID_TO_CATEGORY,
  CATEGORY_TO_PLATFORM_ID,
} from '@/lib/constants';
import { DEFAULT_ADVANCE_MONTHS, currentAdvanceMonths } from '@/lib/commission';
import { dedupLeads } from '@/lib/leadDedup';

import CpaDashboard from './views/CpaDashboard';
import AssociationsView from './views/AssociationsView';
import ClosedDeals from './views/ClosedDeals';
import Dashboard from './views/Dashboard';
import LeadsView from './views/LeadsView';
import Pipeline from './views/Pipeline';
import UploadView from './views/UploadView';
import PlatformExpensesView from './views/PlatformExpensesView';
import BusinessBooksView from './views/BusinessBooksView';
import ProspectsView from './views/ProspectsView';
import CommissionCalculator from './views/CommissionCalculator';
import LeadForm from './LeadForm';
import InvestmentForm from './InvestmentForm';
import ActivityForm from './ActivityForm';
import ConfirmDialog from './ConfirmDialog';
import NoPhiBanner from './NoPhiBanner';
import ImpersonationBanner from './ImpersonationBanner';
import AnnouncementBanner from './AnnouncementBanner';
import AgentChatbot from './AgentChatbot';
import OnboardingWalkthrough from './OnboardingWalkthrough';
import FirstRunWizard from './FirstRunWizard';
import PaywallGate, { TrialBanner } from './PaywallGate';
import ScreenshotImport from './ScreenshotImport';
import AssociationCommissionDetailImport from './AssociationCommissionDetailImport';
import PostSaleEmailSettings from './PostSaleEmailSettings';
import PendingEmailQueueRunner from './PendingEmailQueueRunner';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { loadBundle, findAutoSendTemplate } from '@/lib/postSaleEmails';
import { enqueuePending, cancelAllForLead } from '@/lib/pendingEmailQueue';
import Toast from './Toast';
import Profile from './Profile';
import { loadAgentProfile } from '@/lib/agentProfile';
import { fireConfetti, FadeIn, OrbBackdrop } from './motion/MotionPrimitives';
import { useAuth } from './auth/AuthProvider';
import { motion } from 'framer-motion';

const ICONS = { Calculator, Repeat, CheckSquare, LayoutDashboard, Users, Columns, Upload, DollarSign, BookOpen, UserPlus };

const LEADS_KEY = 'leads_v5';
const LEADS_KEY_V4 = 'leads_v4';
const INV_KEY = 'investments_v2';
const ACT_KEY = 'activities_v1';
const TIER_KEY = 'agent_tier_v1';
const CB_KEY   = 'chargebacks_v1';
const OVR_KEY  = 'overrides_v1';
const OWN_ADV_KEY = 'own_advances_v1';
const AM_KEY   = 'advance_months_history_v1';
const PE_KEY   = 'platform_expenses_v1';
const BE_KEY   = 'business_expenses_v1';
const BI_KEY   = 'business_income_v1';
const PROSPECTS_KEY = 'prospects_v1';
const PROSPECT_SETTINGS_KEY = 'prospect_settings_v1';
// Association Bonus residual book — populated by uploading USHA's
// CommissionDetail.csv. Kept in isolated keys so it never affects
// leads, advances, or Books P&L.
const AB_DETAIL_KEY = 'association_bonus_detail_v1';
const AGENT_RATES_KEY = 'agent_residual_rates_v1';

// User menu — shows current email + Profile + sign-out. Lives in the header.
// Reads the uploaded avatar from user_kv on mount (and re-reads when the
// Profile modal closes, in case the agent just updated it).
function UserMenu({ onOpenProfile, avatarUrl }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition text-sm"
        title={user.email}
      >
        <div className="w-8 h-8 rounded-full bg-accent-gradient flex items-center justify-center text-white text-xs font-bold shadow-md shadow-indigo-500/20 ring-2 ring-white overflow-hidden">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            (user.email || '?').slice(0, 1).toUpperCase()
          )}
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-900/10 z-40 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-br from-indigo-50/60 to-violet-50/60">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Signed in as</div>
              <div className="text-sm font-semibold text-slate-900 truncate">{user.email}</div>
            </div>
            <button
              onClick={() => { setOpen(false); onOpenProfile?.(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-700 text-left transition"
            >
              <UserIcon size={14} /> Profile
              <span className="ml-auto text-[10px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">New</span>
            </button>
            <div className="border-t border-slate-100" />
            <button
              onClick={() => { setOpen(false); signOut(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left transition"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Lazily mount a view the first time it's visible, then keep it mounted but
// hide it via display:none when the active view changes. This preserves all
// internal state (filters, search, sort, scroll, month picker) across tab
// switches without lifting state to LeadTracker.
/**
 * Beta-gated Post-Sale Emails section, rendered inside the main Settings
 * modal. Renders nothing for non-allowlist users so non-beta agents see no
 * UI change. The hook is safe to call here because this component only
 * mounts when the parent Settings modal is open (showSettings === true).
 */
function PostSaleEmailsSection() {
  const { canAccess, loading } = useBetaFeature('post_sale_emails');
  if (loading || !canAccess) return null;
  return (
    <div className="mb-5 pb-5 border-b border-slate-200">
      <div className="text-xs font-bold text-slate-500 tracking-wider mb-3 flex items-center gap-2">
        POST-SALE EMAILS
        <span className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1 rounded font-bold">BETA</span>
      </div>
      <PostSaleEmailSettings />
    </div>
  );
}

function ViewMount({ visible, viewKey, children }) {
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  useEffect(() => { if (visible && !hasBeenVisible) setHasBeenVisible(true); }, [visible, hasBeenVisible]);
  if (!hasBeenVisible) return null;
  // Snappy first-reveal fade (~120ms, opacity only — no Y offset). The
  // earlier 250ms easing + y-translate stacked with the heavy view's
  // own first-render cost, which read as "tab lag." Subsequent visits
  // are instant (display toggle, no re-animation).
  return (
    <motion.div
      key={viewKey}
      style={{ display: visible ? 'block' : 'none', willChange: 'opacity' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export default function LeadTracker() {
  const { user: authUser } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('cpa');
  const [showScreenshotImport, setShowScreenshotImport] = useState(false);
  // Onboarding walkthrough — auto-launches on first sign-in for genuinely
  // new agents (no progress record). Re-launchable from Settings.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showFirstRunWizard, setShowFirstRunWizard] = useState(false);
  // Reflects loadOnboardingProgress().completed — drives the setup
  // checklist's "tier confirmed" task. Synced once on load + after
  // the wizard fires markCompleted.
  const [onboardingCompletedFlag, setOnboardingCompletedFlag] = useState(false);
  // Bridge for the chatbot's open state — used by the onboarding step
  // "Meet the PRIM Assistant" to pop the chat after closing the tour.
  const [chatOpenSignal, setChatOpenSignal] = useState(0);
  // Bridge to open the Books Smart Import wizard after the final step.
  const [smartImportOpenSignal, setSmartImportOpenSignal] = useState(0);
  const [leads, setLeads] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [chargebacks, setChargebacks] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [ownAdvances, setOwnAdvances] = useState([]);
  const [advanceMonthsHistory, setAdvanceMonthsHistory] = useState([]);
  const [platformExpenses, setPlatformExpenses] = useState([]);
  const [businessExpenses, setBusinessExpenses] = useState([]);
  const [businessIncome, setBusinessIncome] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [prospectSettings, setProspectSettings] = useState(null);
  const [tier, setTier] = useState('WA');
  // Association Bonus residual data — loaded from cloud, isolated from leads.
  const [abDetail, setAbDetail] = useState([]);
  const [agentRates, setAgentRates] = useState({});
  const [showAbImport, setShowAbImport] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastImportBatch, setLastImportBatch] = useState(null);

  // modals
  const [leadForm, setLeadForm] = useState(null);    // lead obj or null
  const [invForm, setInvForm] = useState(null);
  const [actForm, setActForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Avatar URL shown in the top-right UserMenu. Refreshed whenever the
  // Profile modal closes so an upload propagates immediately. Listens
  // for the same 'prim:accent-changed' event family so other tabs stay
  // in sync. (Lightweight string — no perf concern.)
  const [headerAvatarUrl, setHeaderAvatarUrl] = useState('');
  useEffect(() => {
    let alive = true;
    loadAgentProfile().then((p) => { if (alive) setHeaderAvatarUrl(p.avatarUrl || ''); });
    const refresh = () => {
      loadAgentProfile().then((p) => { if (alive) setHeaderAvatarUrl(p.avatarUrl || ''); });
    };
    window.addEventListener('prim:profile-saved', refresh);
    return () => {
      alive = false;
      window.removeEventListener('prim:profile-saved', refresh);
    };
  }, []);

  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Wire up storage quota error notifications so the user knows when
  // localStorage is full instead of silently losing saves (typically caused
  // by attaching too many large receipts).
  useEffect(() => {
    onStorageError(({ key }) => {
      const isAttachmentKey = key === BE_KEY || key === BI_KEY;
      const message = isAttachmentKey
        ? 'Storage full — too many large receipt attachments. Delete some old attachments or export your data.'
        : 'Storage full — your last save was not persisted.';
      setToast({ msg: message, kind: 'error' });
      setTimeout(() => setToast(null), 6000);
    });
  }, []);

  // load on mount
  useEffect(() => {
    (async () => {
      let leadsRaw = await storage.getItem(LEADS_KEY);
      if (!leadsRaw) {
        const v4 = await storage.getItem(LEADS_KEY_V4);
        if (v4) {
          try {
            const migrated = JSON.parse(v4).map(migrateLead);
            leadsRaw = JSON.stringify(migrated);
            await storage.setItem(LEADS_KEY, leadsRaw);
          } catch { /* ignore */ }
        }
      }
      // Always run migrateLead on loaded data so stage/product renames are applied
      // idempotently even to leads_v5 records from earlier builds.
      const loadedLeads = (leadsRaw ? JSON.parse(leadsRaw) : SEED_LEADS).map(migrateLead);
      setLeads(loadedLeads);

      const invRaw = await storage.getItem(INV_KEY);
      setInvestments(invRaw ? JSON.parse(invRaw) : SEED_INVESTMENTS);

      const actRaw = await storage.getItem(ACT_KEY);
      setActivities(actRaw ? JSON.parse(actRaw) : SEED_ACTIVITIES);

      const tierRaw = await storage.getItem(TIER_KEY);
      if (tierRaw) setTier(tierRaw);

      // Normalize period strings to ISO + collapse duplicates introduced by
      // an earlier format change (overrides/chargebacks were stored as
      // M/D/YYYY before, switched to YYYY-MM-DD — re-imports created
      // duplicates because the dedup key included the raw format).
      const toIsoPeriod = (s) => {
        if (!s) return '';
        const t = String(s).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
        const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m) {
          let yy = m[3];
          if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
          return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
        }
        return t;
      };
      const normalizeAndDedupe = (rows) => {
        if (!Array.isArray(rows) || rows.length === 0) return rows || [];
        const byKey = new Map();
        for (const r of rows) {
          const period = toIsoPeriod(r.period);
          const key = `${r.policyId || r.id}|${period}|${(r.customer || '').toLowerCase()}|${Number(r.amount || 0).toFixed(2)}`;
          if (!byKey.has(key)) byKey.set(key, { ...r, period });
        }
        return Array.from(byKey.values());
      };

      const cbRaw = await storage.getItem(CB_KEY);
      const cbInitial = cbRaw ? JSON.parse(cbRaw) : [];
      const cbClean = normalizeAndDedupe(cbInitial);
      setChargebacks(cbClean);
      if (cbClean.length !== cbInitial.length || cbClean.some((c, i) => c.period !== cbInitial[i]?.period)) {
        await storage.setItem(CB_KEY, JSON.stringify(cbClean));
      }

      const ovrRaw = await storage.getItem(OVR_KEY);
      const ovrInitial = ovrRaw ? JSON.parse(ovrRaw) : [];
      const ovrClean = normalizeAndDedupe(ovrInitial);
      setOverrides(ovrClean);
      if (ovrClean.length !== ovrInitial.length || ovrClean.some((o, i) => o.period !== ovrInitial[i]?.period)) {
        await storage.setItem(OVR_KEY, JSON.stringify(ovrClean));
      }

      const oaRaw = await storage.getItem(OWN_ADV_KEY);
      const oaInitial = oaRaw ? JSON.parse(oaRaw) : [];
      const oaClean = normalizeAndDedupe(oaInitial);
      setOwnAdvances(oaClean);
      if (oaClean.length !== oaInitial.length || oaClean.some((o, i) => o.period !== oaInitial[i]?.period)) {
        await storage.setItem(OWN_ADV_KEY, JSON.stringify(oaClean));
      }

      const amRaw = await storage.getItem(AM_KEY);
      setAdvanceMonthsHistory(amRaw ? JSON.parse(amRaw) : []);

      const peRaw = await storage.getItem(PE_KEY);
      const peInitial = peRaw ? JSON.parse(peRaw) : [];

      const beRaw = await storage.getItem(BE_KEY);
      let beInitial = beRaw ? JSON.parse(beRaw) : [];

      // Auto-migration (2026-05): platform_expenses_v1 → business_expenses_v1.
      // Platforms used to live in their own isolated store. They now live in
      // Books under dedicated categories (PLATFORM_RINGY / PLATFORM_TEXTDRIP /
      // PLATFORM_VANILLASOFT). The legacy store is kept as a backup.
      //
      // Runs on EVERY load (not flag-gated): dedup keys make it idempotent,
      // so re-running can't double-count. This catches legacy rows that the
      // first pass missed (e.g., a manual entry with `platform: 'TEXTDRIP'`
      // instead of the short code 'TD').
      if (Array.isArray(peInitial) && peInitial.length > 0) {
        // Forgiving platform-name normalizer. Accepts the short codes (TD,
        // VANILLA), the full names (TEXTDRIP, VANILLASOFT), abbreviations
        // (VS), and is whitespace/case insensitive.
        const normalizePlatform = (raw) => {
          const s = String(raw || '').toUpperCase().replace(/\s/g, '');
          if (s === 'RINGY')                         return 'PLATFORM_RINGY';
          if (s === 'TD' || s === 'TEXTDRIP')        return 'PLATFORM_TEXTDRIP';
          if (s === 'VANILLA' || s === 'VANILLASOFT' || s === 'VS') return 'PLATFORM_VANILLASOFT';
          return null;
        };
        // Build a set of (date|amount|category|notes) tuples already present
        // in Books so re-runs of this migration don't duplicate rows.
        const existingKeys = new Set(beInitial.map(e => `${e.date}|${e.amount}|${e.category}|${(e.notes || '').slice(0, 40)}`));
        const migratedRows = [];
        for (const p of peInitial) {
          if (!p) continue;
          const category = normalizePlatform(p.platform);
          if (!category) continue;
          const vendor = p.vendor || `${p.platform} ${p.reason || 'charge'}`.trim();
          const key = `${p.date}|${p.amount}|${category}|${(p.notes || '').slice(0, 40)}`;
          if (existingKeys.has(key)) continue;
          migratedRows.push({
            id: p.id || uid(),
            date: p.date,
            vendor,
            amount: Number(p.amount) || 0,
            category,
            // Preserve the platform-specific sub-classification so the
            // Platforms tab still groups credit-refills vs subscriptions.
            reason: p.reason || 'CREDIT REFILL',
            notes: p.notes || '',
          });
          existingKeys.add(key);
        }
        if (migratedRows.length > 0) {
          beInitial = [...migratedRows, ...beInitial];
          await storage.setItem(BE_KEY, JSON.stringify(beInitial));
          // eslint-disable-next-line no-console
          console.log(`[platform-to-books migration] Recovered ${migratedRows.length} legacy platform row(s) into Books.`);
        }
      }

      // Keep platformExpenses state in sync for any code that still reads
      // it directly (legacy paths). After migration, the Platforms tab and
      // True CPA both read from businessExpenses → these stay until full
      // cleanup.
      setPlatformExpenses(peInitial);
      setBusinessExpenses(beInitial);
      const biRaw = await storage.getItem(BI_KEY);
      setBusinessIncome(biRaw ? JSON.parse(biRaw) : []);

      const prRaw = await storage.getItem(PROSPECTS_KEY);
      const prInitial = prRaw ? JSON.parse(prRaw) : [];
      // One-shot migration: NEW stage was retired. Move any prospect still
      // sitting in NEW to Pending Decision so they land in a real bucket.
      // Also remap legacy free-form policyType strings to the new canonical
      // product codes (PA / PC / SA / HA / WRAP / SUPPY) so the dropdown
      // doesn't render blank.
      const POLICY_TYPE_MIGRATION = {
        'Individual Health': '',  // generic — no canonical match
        'Family Health': '',
        'Short-Term': '',
        'Medicare': '',
        'Dental/Vision': '',
        'Life': '',
        'Other': '',
      };
      let prMigrated = prInitial;
      let migrationCount = 0;
      if (Array.isArray(prInitial)) {
        prMigrated = prInitial.map(p => {
          let next = p;
          if (p.stage === 'NEW') { migrationCount++; next = { ...next, stage: 'PENDING_DECISION' }; }
          if (p.policyType && Object.prototype.hasOwnProperty.call(POLICY_TYPE_MIGRATION, p.policyType)) {
            migrationCount++;
            next = { ...next, policyType: POLICY_TYPE_MIGRATION[p.policyType] };
          }
          return next;
        });
        if (migrationCount > 0) {
          await storage.setItem(PROSPECTS_KEY, JSON.stringify(prMigrated));
        }
      }
      setProspects(prMigrated);

      const psRaw = await storage.getItem(PROSPECT_SETTINGS_KEY);
      let psInitial = psRaw ? JSON.parse(psRaw) : null;
      // Strip the retired NEW stage from saved settings (idempotent)
      if (psInitial?.stages?.some?.(s => s.id === 'NEW')) {
        psInitial = { ...psInitial, stages: psInitial.stages.filter(s => s.id !== 'NEW') };
        await storage.setItem(PROSPECT_SETTINGS_KEY, JSON.stringify(psInitial));
      }
      setProspectSettings(psInitial);

      // Association Bonus residual book (CommissionDetail imports). Best
      // effort — corrupted/missing data should never block app load.
      try {
        const abRaw = await storage.getItem(AB_DETAIL_KEY);
        if (abRaw) {
          const parsed = JSON.parse(abRaw);
          if (Array.isArray(parsed)) setAbDetail(parsed);
        }
        const ratesRaw = await storage.getItem(AGENT_RATES_KEY);
        if (ratesRaw) {
          const parsed = JSON.parse(ratesRaw);
          if (parsed && typeof parsed === 'object') setAgentRates(parsed);
        }
      } catch { /* ignore — feature degrades to baseline rates */ }

      setLoaded(true);

      // Auto-launch the First-Run Wizard for genuinely new agents (no
      // onboarding progress record yet). The 12-step walkthrough lives
      // on as a "Replay tour" option in Settings — see showOnboarding
      // state — but the wizard is what brand-new agents see first.
      // Existing agents who already skipped/completed never get re-prompted.
      try {
        const { loadOnboardingProgress, shouldAutoLaunch } = await import('@/lib/onboarding');
        const progress = await loadOnboardingProgress();
        // Track completion so the Setup Checklist's first task reflects it.
        setOnboardingCompletedFlag(!!progress?.completed);
        if (shouldAutoLaunch(progress)) {
          // Slight delay so the app paints first; wizard appears over a
          // populated UI, not a blank screen.
          setTimeout(() => setShowFirstRunWizard(true), 800);
        }
      } catch { /* setup wizard is optional — never block app load on it */ }
    })();
  }, []);

  // persist
  useEffect(() => { if (loaded) storage.setItem(LEADS_KEY, JSON.stringify(leads)); }, [leads, loaded]);
  useEffect(() => { if (loaded) storage.setItem(INV_KEY, JSON.stringify(investments)); }, [investments, loaded]);
  useEffect(() => { if (loaded) storage.setItem(ACT_KEY, JSON.stringify(activities)); }, [activities, loaded]);
  useEffect(() => { if (loaded) storage.setItem(TIER_KEY, tier); }, [tier, loaded]);
  useEffect(() => { if (loaded) storage.setItem(CB_KEY, JSON.stringify(chargebacks)); }, [chargebacks, loaded]);
  useEffect(() => { if (loaded) storage.setItem(OVR_KEY, JSON.stringify(overrides)); }, [overrides, loaded]);
  useEffect(() => { if (loaded) storage.setItem(OWN_ADV_KEY, JSON.stringify(ownAdvances)); }, [ownAdvances, loaded]);
  useEffect(() => { if (loaded) storage.setItem(AM_KEY, JSON.stringify(advanceMonthsHistory)); }, [advanceMonthsHistory, loaded]);
  useEffect(() => { if (loaded) storage.setItem(PE_KEY, JSON.stringify(platformExpenses)); }, [platformExpenses, loaded]);
  useEffect(() => { if (loaded) storage.setItem(BE_KEY, JSON.stringify(businessExpenses)); }, [businessExpenses, loaded]);
  useEffect(() => { if (loaded) storage.setItem(BI_KEY, JSON.stringify(businessIncome)); }, [businessIncome, loaded]);
  useEffect(() => { if (loaded) storage.setItem(PROSPECTS_KEY, JSON.stringify(prospects)); }, [prospects, loaded]);
  useEffect(() => { if (loaded && prospectSettings) storage.setItem(PROSPECT_SETTINGS_KEY, JSON.stringify(prospectSettings)); }, [prospectSettings, loaded]);
  useEffect(() => { if (loaded) storage.setItem(AB_DETAIL_KEY, JSON.stringify(abDetail)); }, [abDetail, loaded]);
  useEffect(() => { if (loaded) storage.setItem(AGENT_RATES_KEY, JSON.stringify(agentRates)); }, [agentRates, loaded]);

  // Auto-send hook — when a lead's stage transitions to a value that any
  // enabled template is configured to auto-fire on, drop a pending send into
  // the queue. The PendingEmailQueueRunner picks it up, surfaces a 5-min
  // countdown toast with Cancel, then either fires or skips. No-op when the
  // user doesn't have beta access or no template matches the new stage.
  const maybeEnqueueAutoSend = useCallback(async (prevStage, newLead) => {
    if (!newLead?.id || !newLead?.stage || prevStage === newLead.stage) return;
    try {
      const bundle = await loadBundle();
      const template = findAutoSendTemplate(bundle, newLead.stage);
      if (!template) return;
      await enqueuePending({ leadId: newLead.id, templateId: template.id });
    } catch (e) {
      // Don't surface to the user — the queue runner already retries on next tick.
      // eslint-disable-next-line no-console
      console.warn('[auto-send] enqueue failed:', e?.message || e);
    }
  }, []);

  // lead handlers — useCallback'd so memoized views can skip re-render
  const newLead = useCallback(() => setLeadForm(mkLead({
    advanceMonths: currentAdvanceMonths(advanceMonthsHistory, DEFAULT_ADVANCE_MONTHS),
  })), [advanceMonthsHistory]);
  const editLead = useCallback((l) => setLeadForm({ ...l, _existing: true }), []);
  const saveLead = (l) => {
    const clean = { ...l };
    delete clean._existing;
    if (l._existing) {
      const prevLead = leads.find(x => x.id === l.id);
      const nowIssued = clean.stage === 'Issued' && prevLead?.stage !== 'Issued';
      setLeads(prev => prev.map(x => x.id === l.id ? clean : x));
      showToast('Lead updated');
      if (nowIssued) fireConfetti();
      maybeEnqueueAutoSend(prevLead?.stage, clean);
    } else {
      setLeads(prev => [clean, ...prev]);
      showToast('Lead added');
      if (clean.stage === 'Issued') fireConfetti();
      maybeEnqueueAutoSend(null, clean);
    }
    setLeadForm(null);
  };
  const deleteLead = useCallback((id) => {
    setConfirm({
      title: 'Delete lead?',
      message: 'This cannot be undone.',
      onConfirm: () => {
        setLeads(prev => prev.filter(l => l.id !== id));
        setLeadForm(null);
        setConfirm(null);
        showToast('Lead deleted');
        // Cancel any pending auto-send tied to this lead so we don't fire
        // a welcome email after the agent decided to delete the record.
        cancelAllForLead(id).catch(() => {});
      },
    });
  }, [showToast]);

  const bulkDeleteLeads = useCallback((ids, onDone) => {
    if (!ids || ids.length === 0) return;
    setConfirm({
      title: `Delete ${ids.length} lead${ids.length !== 1 ? 's' : ''}?`,
      message: 'This cannot be undone. All selected leads will be permanently removed.',
      onConfirm: () => {
        const idSet = new Set(ids);
        setLeads(prev => prev.filter(l => !idSet.has(l.id)));
        setConfirm(null);
        onDone?.();
        showToast(`${ids.length} lead${ids.length !== 1 ? 's' : ''} deleted`);
      },
    });
  }, [showToast]);

  // Import handlers — append imported leads to existing data, track batchId for undo
  const importLeads = useCallback((newLeads, { batchId, stats, mode = 'skip' } = {}) => {
    if (!newLeads || newLeads.length === 0) return;
    // Universal dedup gate: every lead-creation path runs through here.
    //
    // mode = 'skip'  (default) — drop candidates that match existing leads
    // mode = 'merge'           — patch the matching existing lead with
    //                            non-empty fields from the candidate
    //                            (preserves the original lead's id +
    //                            dateAdded, fills empty fields, concats
    //                            notes, promotes Pending -> final stage).
    setLeads(prev => {
      const { fresh, duplicates, merges } = dedupLeads(newLeads, prev, { merge: mode === 'merge' });
      const mergeById = new Map(merges.map(m => [m.existingId, m.patched]));
      // Apply merges to the existing list, then prepend fresh
      const updated = prev.map(l => mergeById.get(l.id) || l);
      const mergedCount = mergeById.size;
      const skippedCount = duplicates.length - mergedCount;

      setTimeout(() => {
        const bits = [`Imported ${fresh.length} lead${fresh.length !== 1 ? 's' : ''}`];
        if (mergedCount > 0) bits.push(`merged ${mergedCount} into existing`);
        if (skippedCount > 0) bits.push(`skipped ${skippedCount} duplicate${skippedCount !== 1 ? 's' : ''}`);
        showToast(bits.join(' · '));
      }, 0);

      setLastImportBatch({
        batchId,
        count: fresh.length,
        at: new Date().toISOString(),
        stats: { ...(stats || {}), duplicatesSkipped: skippedCount, merged: mergedCount },
      });
      return [...fresh, ...updated];
    });
  }, [showToast]);

  // Apply a parsed Weekly Advance Statement: update matched leads with
  // the summed Net Advance, promote Pending → Issued, and persist chargebacks +
  // overrides (for leader income tracking). Safe to re-apply the same statement
  // — chargeback rows are deduped by policyId, overrides by policyId.
  const applyStatement = useCallback((plan) => {
    if (!plan) { showToast('No statement to apply', 'error'); return; }

    // 1. Advances — update matched leads
    //
    // Promotion rule: only Pending → Issued on match. Final negative stages
    // (Declined / Not taken / Withdrawn) are intentional outcomes — a positive
    // statement row for them usually means "commission was advanced earlier,
    // then clawed back" and is already captured in the Chargebacks panel.
    // Don't silently flip those back to Issued.
    if (plan.matched && plan.matched.length > 0) {
      const byId = new Map();
      plan.matched.forEach(m => { byId.set(m.leadId, m); });
      setLeads(prev => prev.map(l => {
        const m = byId.get(l.id);
        if (!m) return l;
        const patch = { lastTouch: today() };
        // Only overwrite dealValue if the lead is still Pending or already Issued.
        // Don't touch financial numbers on Declined/Not taken/Withdrawn leads.
        if (l.stage === 'Pending' || l.stage === 'Issued') {
          patch.dealValue = Math.round(m.total * 100) / 100;
        }
        if (l.stage === 'Pending') {
          patch.stage = 'Issued';
          if (l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
            patch.associationStartDate = l.closedDate || today();
          }
        }
        return { ...l, ...patch };
      }));
    }

    // 2. Chargebacks — dedup by (policyId + period) so the same policy can
    //    appear in multiple weeks' statements (common when reserve can't
    //    absorb the full pullback in one week).
    // Normalize PDF dates ("M/D/YYYY") to ISO ("YYYY-MM-DD") so downstream
    // KPI filters (which expect ISO) work correctly.
    const toIsoDate = (s) => {
      if (!s) return today();
      const t = String(s).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (m) {
        let yy = m[3];
        if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
        return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      }
      return today();
    };
    const fallbackPeriod = toIsoDate(plan.header?.periodEnd || plan.header?.periodStart || today());
    const rowPeriod = (r) => toIsoDate(r._statementPeriod || fallbackPeriod);
    const cbRows = [
      ...(plan.chargebacksMatched?.flatMap(m => m.rows) || []),
      ...(plan.chargebacksUnmatched?.flatMap(u => u.rows) || []),
      ...(plan.overrideChargebacksByAgent?.flatMap(a => a.rows) || []),
    ];
    if (cbRows.length > 0) {
      setChargebacks(prev => {
        const seen = new Set(prev.map(c => `${c.policyId}|${c.period}`));
        const add = cbRows
          .filter(r => r.policyId)
          .filter(r => !seen.has(`${r.policyId}|${rowPeriod(r)}`))
          .map(r => ({
            id: uid(),
            policyId: r.policyId,
            customer: r.customer,
            writingAgent: r.writingAgent,
            productDesc: r.productDesc,
            amount: Math.abs(r.reserveWithheld),
            appDate: r.appDate,
            effDate: r.effDate,
            period: rowPeriod(r),
            isOwn: r.writingAgent && plan.header?.owner && r.writingAgent.toUpperCase().trim() === plan.header.owner.toUpperCase().trim(),
            importedAt: new Date().toISOString(),
          }));
        return add.length ? [...add, ...prev] : prev;
      });
    }

    // 3a. Own advances — per-row payments to the agent for their own sales.
    //     Dedup by (policyId + period). Used by KPIs to show what was actually
    //     paid in the period instead of summing lead.dealValue (which gets
    //     overwritten on every re-import).
    const ownAdvRows = plan.ownAdvanceRows || [];
    if (ownAdvRows.length > 0) {
      setOwnAdvances(prev => {
        const seen = new Set(prev.map(o => `${o.policyId}|${o.period}`));
        const add = ownAdvRows
          .filter(r => r.policyId)
          .filter(r => !seen.has(`${r.policyId}|${rowPeriod(r)}`))
          .map(r => ({
            id: uid(),
            policyId: r.policyId,
            customer: r.customer,
            writingAgent: r.writingAgent,
            productDesc: r.productDesc,
            amount: r.netAdvance,
            appDate: r.appDate,
            effDate: r.effDate,
            period: rowPeriod(r),
            importedAt: new Date().toISOString(),
          }));
        return add.length ? [...add, ...prev] : prev;
      });
    }

    // 3. Overrides (leader income) — dedup by (policyId + period) too
    const ovrRows = plan.overridesByAgent?.flatMap(a => a.rows) || [];
    if (ovrRows.length > 0) {
      setOverrides(prev => {
        const seen = new Set(prev.map(o => `${o.policyId}|${o.period}`));
        const add = ovrRows
          .filter(r => r.policyId)
          .filter(r => !seen.has(`${r.policyId}|${rowPeriod(r)}`))
          .map(r => ({
            id: uid(),
            policyId: r.policyId,
            customer: r.customer,
            writingAgent: r.writingAgent,
            productDesc: r.productDesc,
            amount: r.netAdvance,
            appDate: r.appDate,
            effDate: r.effDate,
            period: rowPeriod(r),
            importedAt: new Date().toISOString(),
          }));
        return add.length ? [...add, ...prev] : prev;
      });
    }

    // 4. Misc bonuses (PAR / FTA / Association / Production / generic) — push into
    //    Business Income. Dedup by (label + amount + period) so re-uploading the
    //    same statement doesn't double-count.
    //
    //    Statement periods come from PDF as "M/D/YYYY" — we MUST normalize to
    //    YYYY-MM-DD before saving or downstream getWeekStart() will throw.
    const toIso = (s) => {
      if (!s) return today();
      const t = String(s).trim();
      // Already ISO?
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
      // M/D/YYYY or MM/DD/YYYY
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (m) {
        let yy = m[3];
        if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
        return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      }
      return today();
    };
    // Build the candidate bonus entries OUTSIDE the setState updater so we can
    // count them synchronously for the toast. The setState updater can't be
    // used to compute counts because it runs asynchronously.
    const bonusRows = plan.bonusRows || [];
    let bonusAdded = 0;
    if (bonusRows.length > 0) {
      // USHA monthly Account Summary payouts run a month behind: the
      // statement covering 01/01-01/31 (released 02/05) represents
      // DECEMBER's production. We file the income against the production
      // month so the agent's books reflect when the work actually happened
      // — not when the statement was published. Applies to all agents.
      const shiftIsoBackOneMonth = (iso) => {
        if (!iso || typeof iso !== 'string' || iso.length < 10) return iso;
        const [y, m, d] = iso.split('-').map(Number);
        if (!y || !m || !d) return iso;
        const dt = new Date(y, m - 1, d);
        dt.setMonth(dt.getMonth() - 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };

      // Build an index of existing income for fuzzy dedup. Plain key
      // catches exact matches; the date-flexible index catches the case
      // where a previous import landed at a different month (e.g. before
      // the production-month shift was applied) but the source + amount
      // match. Tolerates ±35 days so a Jan-period entry and a Dec-shifted
      // entry of the same statement are treated as duplicates.
      const seenExistingExact = new Set(businessIncome.map(i => `${i.source || ''}|${Number(i.amount).toFixed(2)}|${i.date || ''}`));
      const existingByKey = new Map(); // "source|amount" -> [iso dates]
      for (const i of businessIncome) {
        const k = `${i.source || ''}|${Number(i.amount).toFixed(2)}`;
        if (!existingByKey.has(k)) existingByKey.set(k, []);
        if (i.date) existingByKey.get(k).push(i.date);
      }
      const within35Days = (iso1, iso2) => {
        if (!iso1 || !iso2) return false;
        const d1 = new Date(iso1).getTime();
        const d2 = new Date(iso2).getTime();
        if (!Number.isFinite(d1) || !Number.isFinite(d2)) return false;
        return Math.abs(d1 - d2) <= 35 * 24 * 60 * 60 * 1000;
      };

      const incomingSeen = new Set();
      const candidates = bonusRows
        .filter(b => Number.isFinite(b.amount) && b.amount > 0)
        .map(b => {
          const rawIso = toIso(b.transactionDate || b._statementPeriod || fallbackPeriod);
          // RENEWAL_BONUS = monthly residual (Account Summary payouts);
          // these get shifted back one month for production-month filing.
          // Other bonus types (e.g. one-off contest spiffs from weekly
          // statements) stay on their original date.
          const isMonthlyResidual = b.type === 'RENEWAL_BONUS';
          const periodIso = isMonthlyResidual ? shiftIsoBackOneMonth(rawIso) : rawIso;
          // Monthly Account Summary residuals get their own category. When
          // the Association Bonus column has a value (quarter-end months
          // only) we route to "Monthlies + Association" so the agent can
          // see the quarterly bump separately.
          const assocAmt = Number(b.associationAmount || 0);
          let incomeCategory;
          if (isMonthlyResidual) {
            incomeCategory = assocAmt > 0 ? 'MONTHLIES_PLUS_ASSOC' : 'MONTHLIES';
          } else {
            incomeCategory = 'BONUS';
          }
          const noteParts = [`Auto-imported from statement (${b.type || 'BONUS'})`];
          if (isMonthlyResidual && rawIso !== periodIso) {
            noteParts.push(`Filed against production month (statement period ${rawIso.slice(0, 7)})`);
          }
          if (b.breakdown) noteParts.push(b.breakdown);
          return {
            id: uid(),
            date: periodIso,
            category: incomeCategory,
            amount: b.amount,
            source: b.label || 'Production Bonus',
            notes: noteParts.join(' · '),
            account: '',
            paymentMethod: null,
            attachment: null,
          };
        })
        .filter(e => {
          const exactKey = `${e.source}|${Number(e.amount).toFixed(2)}|${e.date}`;
          if (seenExistingExact.has(exactKey) || incomingSeen.has(exactKey)) return false;
          // Fuzzy: same source + amount within 35 days = duplicate. Catches
          // re-imports of statements that previously landed on a different
          // attribution date (e.g. before the production-month shift).
          const fuzzyKey = `${e.source}|${Number(e.amount).toFixed(2)}`;
          const existingDates = existingByKey.get(fuzzyKey) || [];
          if (existingDates.some(d => within35Days(d, e.date))) return false;
          incomingSeen.add(exactKey);
          return true;
        });
      bonusAdded = candidates.length;
      if (candidates.length > 0) {
        setBusinessIncome(prev => [...candidates, ...prev]);
      }
    }

    const bits = [];
    if (plan.matched?.length)           bits.push(`${plan.matched.length} lead${plan.matched.length !== 1 ? 's' : ''} updated`);
    if (cbRows.length)                  bits.push(`${cbRows.length} chargeback${cbRows.length !== 1 ? 's' : ''} recorded`);
    if (ovrRows.length)                 bits.push(`${ovrRows.length} override row${ovrRows.length !== 1 ? 's' : ''} recorded`);
    if (bonusAdded)                     bits.push(`${bonusAdded} bonus${bonusAdded !== 1 ? 'es' : ''} added to income`);
    showToast(bits.length ? bits.join(' · ') : 'Nothing to apply');
  }, [businessIncome, showToast]);

  // Apply SalesReport gap detector plan: add missing leads + fix stage mismatches
  const applySalesReport = useCallback(({ leadsToAdd = [], stageUpdates = [] } = {}) => {
    if (leadsToAdd.length === 0 && stageUpdates.length === 0) {
      showToast('Nothing to apply', 'error');
      return;
    }
    const stageMap = new Map();
    stageUpdates.forEach(s => stageMap.set(s.leadId, s));
    setLeads(prev => {
      const updated = prev.map(l => {
        const s = stageMap.get(l.id);
        if (!s) return l;
        const patch = { stage: s.newStage, lastTouch: today() };
        if (s.newMainProduct) patch.mainProduct = s.newMainProduct;
        // Stamp association/closedDate if newly issued
        if (s.newStage === 'Issued' && l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = l.closedDate || today();
        }
        return { ...l, ...patch };
      });
      // Tag new leads with import batch for potential undo
      const batchId = `salesreport_${uid()}`;
      const stamped = leadsToAdd.map(l => ({ ...l, importBatchId: batchId, importedAt: new Date().toISOString() }));
      return [...stamped, ...updated];
    });
    const bits = [];
    if (leadsToAdd.length) bits.push(`${leadsToAdd.length} lead${leadsToAdd.length !== 1 ? 's' : ''} added`);
    if (stageUpdates.length) bits.push(`${stageUpdates.length} stage${stageUpdates.length !== 1 ? 's' : ''} fixed`);
    showToast(bits.join(' · '));
  }, [showToast]);

  // Backfill mode — merge patches into existing leads (only fills empty fields)
  const backfillFromExcel = useCallback(({ updates = [] } = {}) => {
    if (updates.length === 0) {
      showToast('No updates to apply', 'error');
      return;
    }
    const byId = new Map();
    updates.forEach(u => byId.set(u.leadId, u.patch));
    setLeads(prev => prev.map(l => {
      const patch = byId.get(l.id);
      if (!patch) return l;
      return { ...l, ...patch, lastTouch: today() };
    }));
    showToast(`Backfilled ${updates.length} lead${updates.length !== 1 ? 's' : ''}`);
  }, [showToast]);

  const undoLastImport = useCallback(() => {
    if (!lastImportBatch) return;
    setConfirm({
      title: `Undo last import?`,
      message: `This will remove ${lastImportBatch.count} leads that were added in the last import. Any other leads you've added or edited stay untouched.`,
      onConfirm: () => {
        setLeads(prev => prev.filter(l => l.importBatchId !== lastImportBatch.batchId));
        setLastImportBatch(null);
        setConfirm(null);
        showToast('Import undone');
      },
    });
  }, [lastImportBatch, showToast]);

  const bulkStageChange = useCallback((ids, newStage) => {
    if (!ids || ids.length === 0 || !newStage) return;
    const idSet = new Set(ids);
    const prevStageById = new Map();
    setLeads(prev => prev.map(l => {
      if (!idSet.has(l.id)) return l;
      prevStageById.set(l.id, l.stage);
      const patch = { stage: newStage, lastTouch: today() };
      // Stamp closedDate + (retroactive) association start for any post-close stage
      if (newStage === 'Pending' || newStage === 'Issued') {
        if (!l.closedDate) patch.closedDate = today();
        if (l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = patch.closedDate || today();
        }
      }
      const next = { ...l, ...patch };
      // Best-effort fire-and-forget auto-send check per affected lead.
      maybeEnqueueAutoSend(l.stage, next);
      return next;
    }));
    showToast(`${ids.length} lead${ids.length !== 1 ? 's' : ''} moved to ${newStage}`);
  }, [showToast, maybeEnqueueAutoSend]);

  const changeStage = useCallback((id, newStage) => {
    let wasNotIssued = false;
    setLeads(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (l.stage !== 'Issued' && newStage === 'Issued') wasNotIssued = true;
      const patch = { stage: newStage, lastTouch: today() };
      // Stamp closedDate + (retroactive) association start for any post-close stage
      if (newStage === 'Pending' || newStage === 'Issued') {
        if (!l.closedDate) patch.closedDate = today();
        if (l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = patch.closedDate || today();
        }
      }
      const next = { ...l, ...patch };
      maybeEnqueueAutoSend(l.stage, next);
      return next;
    }));
    showToast(`Moved to ${newStage}`);
    if (wasNotIssued) fireConfetti();
  }, [showToast, maybeEnqueueAutoSend]);

  // investment handlers
  const newInvestment = useCallback((weekStart) => {
    setInvForm({
      id: uid(),
      weekStart: weekStart || getWeekStart(today()),
      leadSpend: 0, crmWeekly: 0, crmDaily: 0, advances: 0, paid: 0, notes: '',
    });
  }, []);
  // Works for both manual rows (have w.id) and auto-only rows (w.id === null)
  const editInvestment = useCallback((inv) => {
    if (inv.id) {
      setInvForm({ ...inv, _existing: true });
    } else {
      // auto-only row — open a new investment entry pre-filled with this week
      newInvestment(inv.weekStart);
    }
  }, [newInvestment]);
  const saveInvestment = (inv) => {
    const clean = { ...inv };
    delete clean._existing;
    const existingIdx = investments.findIndex(x => x.id === inv.id);
    if (existingIdx >= 0) {
      const next = investments.slice();
      next[existingIdx] = clean;
      setInvestments(next);
      showToast('Week updated');
    } else {
      setInvestments(prev => [clean, ...prev]);
      showToast('Week added');
    }
    setInvForm(null);
  };
  const deleteInvestment = useCallback((id) => {
    setConfirm({
      title: 'Delete week?',
      message: 'This investment entry will be removed.',
      onConfirm: () => {
        setInvestments(prev => prev.filter(x => x.id !== id));
        setInvForm(null);
        setConfirm(null);
        showToast('Deleted');
      },
    });
  }, [showToast]);

  // Delete an auto-only row by reverting the underlying Issued leads to Submitted.
  // (Only Issued deals feed the auto-sync, and Submitted no longer contributes commission.)
  const deleteAutoWeek = useCallback((weekStart) => {
    const affectedLeads = leads.filter(l => l.stage === 'Issued' && l.closedDate && getWeekStart(l.closedDate) === weekStart);
    if (affectedLeads.length === 0) return;
    setConfirm({
      title: 'Remove auto-synced row?',
      message: `This row is auto-generated from ${affectedLeads.length} Issued lead(s) that closed in this week: ${affectedLeads.map(l => l.name).join(', ')}. To remove the row, their stage will be reverted to "Pending" so the commission no longer shows here. The leads themselves stay in your Leads tab.`,
      onConfirm: () => {
        setLeads(prev => prev.map(l => affectedLeads.find(x => x.id === l.id) ? { ...l, stage: 'Pending' } : l));
        setConfirm(null);
        showToast('Row removed (leads reverted to Pending)');
      },
    });
  }, [leads, showToast]);

  // Auto helper for invForm — memoized so we don't scan the full leads array
  // on every parent re-render (was O(n) on every keystroke / toast / view switch).
  const autoHelper = useMemo(() => {
    if (!invForm) return null;
    const week = invForm.weekStart;
    const closed = leads.filter(l => l.stage === 'Issued' && l.closedDate && getWeekStart(l.closedDate) === week);
    return {
      deals: closed.length,
      commission: closed.reduce((s, l) => s + (l.dealValue || 0), 0),
      leadCosts: closed.reduce((s, l) => s + (l.leadCost || 0), 0),
    };
  }, [invForm, leads]);

  // association actions
  const pauseClient = useCallback((id) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, associationStatus: 'paused', associationPauseDate: today() } : l));
    showToast('Association paused');
  }, [showToast]);
  const resumeClient = useCallback((id) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, associationStatus: 'active', associationPauseDate: null } : l));
    showToast('Association resumed');
  }, [showToast]);
  const cancelClient = useCallback((id) => {
    setConfirm({
      title: 'Cancel association?',
      message: 'Recurring commissions will stop. Prior months remain paid. This cannot be undone from the UI.',
      onConfirm: () => {
        setLeads(prev => prev.map(l => l.id === id ? { ...l, associationStatus: 'cancelled', associationEndDate: today() } : l));
        setConfirm(null);
        showToast('Association cancelled');
      },
    });
  }, [showToast]);

  // activity handlers
  const newActivity = useCallback(() => setActForm({
    id: uid(), date: today(), agent: 'You',
    dials: 0, appointments: 0, pitches: 0, closes: 0, notes: '',
  }), []);
  const editActivity = useCallback((a) => setActForm({ ...a, _existing: true }), []);
  const saveActivity = (a) => {
    const clean = { ...a };
    delete clean._existing;
    const idx = activities.findIndex(x => x.id === a.id);
    if (idx >= 0) {
      const next = activities.slice();
      next[idx] = clean;
      setActivities(next);
      showToast('Activity updated');
    } else {
      setActivities(prev => [clean, ...prev]);
      showToast('Activity logged');
    }
    setActForm(null);
  };
  const deleteActivity = useCallback((id) => {
    setConfirm({
      title: 'Delete activity?',
      message: 'This day\u2019s activity entry will be removed.',
      onConfirm: () => {
        setActivities(prev => prev.filter(x => x.id !== id));
        setActForm(null);
        setConfirm(null);
        showToast('Activity deleted');
      },
    });
  }, [showToast]);

  // Stable handlers for view components — wrapping in useCallback so the
  // memoized view components below can skip re-render when only unrelated
  // state changes (toast, modal open/close, view switch).
  const onDeleteChargeback = useCallback((id) => setChargebacks(prev => prev.filter(c => c.id !== id)), []);
  const onAddPlatformExpense = useCallback((e) => { setPlatformExpenses(prev => [e, ...prev]); showToast('Entry added'); }, [showToast]);
  const onBulkAddPlatformExpenses = useCallback((rows) => {
    if (!rows?.length) return;
    setPlatformExpenses(prev => [...rows, ...prev]);
    showToast(`Imported ${rows.length} expense${rows.length !== 1 ? 's' : ''}`);
  }, [showToast]);
  const onUpdatePlatformExpense = useCallback((e) => setPlatformExpenses(prev => prev.map(x => x.id === e.id ? e : x)), []);
  const onDeletePlatformExpense = useCallback((id) => setPlatformExpenses(prev => prev.filter(x => x.id !== id)), []);

  // ---- Unified platform-via-Books wiring (2026-05) ----
  // Platforms now live in business_expenses_v1 with PLATFORM_RINGY /
  // PLATFORM_TEXTDRIP / PLATFORM_VANILLASOFT categories. The Platforms
  // tab still wants to see rows in its old shape ({ platform, reason, ... }),
  // so we expose a derived "view" + writer adapters that translate the
  // legacy shape into Books rows on the way in.
  const platformExpensesAsView = useMemo(() => {
    return (businessExpenses || [])
      .filter(e => PLATFORM_EXPENSE_CATEGORIES.includes(e.category))
      .map(e => ({
        id: e.id,
        date: e.date,
        platform: CATEGORY_TO_PLATFORM_ID[e.category],
        amount: Number(e.amount) || 0,
        reason: e.reason || 'CREDIT REFILL',
        notes: e.notes || '',
        vendor: e.vendor || '',
      }));
  }, [businessExpenses]);

  // Maps the Platforms-tab row shape to a Books expense row.
  const platformRowToBooks = useCallback((p) => ({
    id: p.id || uid(),
    date: p.date || today(),
    vendor: p.vendor || `${p.platform || ''} ${p.reason || 'charge'}`.trim(),
    amount: Math.abs(Number(p.amount) || 0),
    category: PLATFORM_ID_TO_CATEGORY[p.platform] || 'PLATFORM_RINGY',
    reason: p.reason || 'CREDIT REFILL',
    notes: p.notes || '',
  }), []);

  const onAddPlatformViaBooks = useCallback((p) => {
    setBusinessExpenses(prev => [platformRowToBooks(p), ...prev]);
    showToast('Entry added');
  }, [platformRowToBooks, showToast]);

  const onBulkAddPlatformsViaBooks = useCallback((rows) => {
    if (!rows?.length) return;
    const books = rows.map(platformRowToBooks);
    setBusinessExpenses(prev => [...books, ...prev]);
    showToast(`Imported ${rows.length} expense${rows.length !== 1 ? 's' : ''}`);
  }, [platformRowToBooks, showToast]);

  const onUpdatePlatformViaBooks = useCallback((p) => {
    setBusinessExpenses(prev => prev.map(x => x.id === p.id ? { ...x, ...platformRowToBooks(p) } : x));
  }, [platformRowToBooks]);

  const onDeletePlatformViaBooks = useCallback((id) => {
    setBusinessExpenses(prev => prev.filter(x => x.id !== id));
  }, []);

  const onAddBusinessExpense = useCallback((e) => { setBusinessExpenses(prev => [e, ...prev]); showToast('Expense added'); }, [showToast]);
  const onUpdateBusinessExpense = useCallback((e) => setBusinessExpenses(prev => prev.map(x => x.id === e.id ? e : x)), []);
  const onDeleteBusinessExpense = useCallback((id) => {
    setBusinessExpenses(prev => {
      const removed = prev.find(x => x.id === id);
      if (removed?.attachment?.id) deleteAttachmentFromIdb(removed.attachment.id);
      return prev.filter(x => x.id !== id);
    });
  }, []);
  const onBulkAddBusinessExpenses = useCallback((rows) => {
    if (!rows?.length) return;
    setBusinessExpenses(prev => [...rows, ...prev]);
    showToast(`Imported ${rows.length} expense${rows.length !== 1 ? 's' : ''}`);
  }, [showToast]);
  const onAddBusinessIncome = useCallback((e) => { setBusinessIncome(prev => [e, ...prev]); showToast('Income added'); }, [showToast]);
  const onUpdateBusinessIncome = useCallback((e) => setBusinessIncome(prev => prev.map(x => x.id === e.id ? e : x)), []);
  const onDeleteBusinessIncome = useCallback((id) => {
    setBusinessIncome(prev => {
      const removed = prev.find(x => x.id === id);
      if (removed?.attachment?.id) deleteAttachmentFromIdb(removed.attachment.id);
      return prev.filter(x => x.id !== id);
    });
  }, []);
  const onBulkAddBusinessIncome = useCallback((rows) => {
    if (!rows?.length) return;
    setBusinessIncome(prev => [...rows, ...prev]);
    showToast(`Imported ${rows.length} income entr${rows.length !== 1 ? 'ies' : 'y'}`);
  }, [showToast]);
  const onNewInvestmentNoArg = useCallback(() => newInvestment(), [newInvestment]);

  // ----- Prospects handlers -----
  const onAddProspect = useCallback((p) => {
    setProspects(prev => [p, ...prev]);
    showToast('Prospect added');
  }, [showToast]);
  const onUpdateProspect = useCallback((p) => {
    setProspects(prev => prev.map(x => x.id === p.id ? p : x));
  }, []);
  const onDeleteProspect = useCallback((id) => {
    setProspects(prev => prev.filter(x => x.id !== id));
    showToast('Prospect deleted');
  }, [showToast]);
  const onBulkAddProspects = useCallback((rows) => {
    if (!rows?.length) return;
    setProspects(prev => [...rows, ...prev]);
    showToast(`Imported ${rows.length} prospect${rows.length !== 1 ? 's' : ''}`);
  }, [showToast]);
  const onSaveProspectSettings = useCallback((next) => {
    setProspectSettings(next);
    showToast('Prospects settings saved');
  }, [showToast]);
  // Convert a Sold prospect into a new Lead. Pre-fills lead fields from the
  // prospect so the user only has to fill in product/premium details.
  const onConvertProspectToLead = useCallback((p) => {
    // Map prospect policyType (PA/PC/SA/HA/WRAP/SUPPY) to lead mainProduct
    const POLICY_TO_PRODUCT = {
      PA: 'PREMIER ADVANTAGE',
      PC: 'PREMIER CHOICE',
      SA: 'SECURE ADVANTAGE',
      HA: 'HEALTH ACCESS III',
      WRAP: 'ACA WRAP',
      SUPPY: 'SUPPY',
    };
    const newLead = mkLead({
      name: p.name || '',
      phone: p.phone || '',
      email: p.email || '',
      state: p.state || '',
      source: 'Referral',  // closest match — will be editable
      stage: 'Pending',
      closedDate: today(),
      mainProduct: POLICY_TO_PRODUCT[p.policyType] || '',
      notes: [p.situation, p.meds && `Meds: ${p.meds}`].filter(Boolean).join(' · '),
    });
    setLeads(prev => [newLead, ...prev]);
    // Mark prospect as archived + linked
    setProspects(prev => prev.map(x => x.id === p.id ? { ...x, stage: 'SOLD', convertedLeadId: newLead.id, archivedAt: new Date().toISOString() } : x));
    setView('leads');
    showToast('Converted to Lead — finish the details on the Leads tab');
  }, [showToast]);

  const clearAll = (what) => {
    setConfirm({
      title: `Clear ${what}?`,
      message: 'This cannot be undone.',
      onConfirm: async () => {
        if (what === 'leads' || what === 'everything')        { setLeads([]);        await storage.removeItem(LEADS_KEY); }
        if (what === 'investments' || what === 'everything')  { setInvestments([]);  await storage.removeItem(INV_KEY); }
        if (what === 'activities' || what === 'everything')   { setActivities([]);   await storage.removeItem(ACT_KEY); }
        if (what === 'chargebacks' || what === 'everything')  { setChargebacks([]);  await storage.removeItem(CB_KEY); }
        if (what === 'overrides' || what === 'everything')    { setOverrides([]);    await storage.removeItem(OVR_KEY); }
        if (what === 'ownAdvances' || what === 'everything')  { setOwnAdvances([]);  await storage.removeItem(OWN_ADV_KEY); }
        if (what === 'prospects' || what === 'everything')    { setProspects([]);    await storage.removeItem(PROSPECTS_KEY); }
        if (what === 'platforms' || what === 'everything')   { setPlatformExpenses([]); await storage.removeItem(PE_KEY); }
        if (what === 'books' || what === 'everything')       { setBusinessExpenses([]); setBusinessIncome([]); await storage.removeItem(BE_KEY); await storage.removeItem(BI_KEY); }
        if (what === 'everything')                            { setAdvanceMonthsHistory([]); await storage.removeItem(AM_KEY); }
        setConfirm(null);
        setShowSettings(false);
        showToast(`Cleared ${what}`);
      },
    });
  };

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">Loading…</div>;
  }

  // Stats handed to the trial banner so its urgent-day copy can quantify
  // what the agent has built ("Keep your 47 leads + $12K tracked").
  // Cheap one-pass calc; not memoized because the render path is already
  // memo-stable below this point and recomputing each render is fine.
  const trialBannerYear = new Date().getFullYear().toString();
  const trialBannerYtdIncome = businessIncome
    .filter(e => (e.date || '').startsWith(trialBannerYear))
    .reduce((s, e) => s + Number(e.amount || 0), 0)
    + ownAdvances
        .filter(a => (a.period || '').includes(trialBannerYear))
        .reduce((s, a) => s + Number(a.amount || 0), 0);
  const trialBannerYtdExpenses = businessExpenses
    .filter(e => (e.date || '').startsWith(trialBannerYear))
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const trialBannerStats = {
    leadsCount: leads.length,
    ytdNet: trialBannerYtdIncome - trialBannerYtdExpenses,
  };

  // Stats for the Setup Checklist widget on the Dashboard. All derived
  // from existing state — no extra tracking required. The widget hides
  // itself when all 5 tasks complete OR when the agent dismisses it.
  const setupChecklistStats = {
    onboardingCompleted: !!onboardingCompletedFlag,
    leadsCount: leads.length,
    ownAdvancesCount: ownAdvances.length,
    businessExpensesCount: businessExpenses.length,
    businessIncomeCount: businessIncome.length,
    issuedLeadsCount: leads.filter(l => l.stage === 'Issued').length,
  };

  return (
    <PaywallGate>
    <div className="min-h-screen bg-prim-canvas text-slate-900 relative transition-colors duration-300">
      <OrbBackdrop />
      {/* Trial countdown banner (auto-hides for active paid subs).
          Stats give the banner real value-built numbers so the urgent-day
          copy can say "Keep your N leads + $X tracked" instead of a
          generic message. Memoized via useMemo below. */}
      <TrialBanner stats={trialBannerStats} />
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 relative">
        {/* Mesh gradient backdrop — bounded by overflow-hidden on this child wrapper
            so it doesn't leak, but the parent header itself stays overflow-visible
            so dropdowns (UserMenu, etc.) can extend below the header. */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-mesh-luxe opacity-90" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ rotate: -8, scale: 0.9, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
              whileHover={{ rotate: 6, scale: 1.05 }}
              className="w-9 h-9 rounded-lg bg-accent-gradient flex items-center justify-center text-white shadow-lg shadow-indigo-500/30"
            >
              <Sparkles size={18} />
            </motion.div>
            <div>
              <h1 className="font-bold text-slate-900 leading-none tracking-tight">PRIM</h1>
              <div className="text-xs text-slate-500">Performance · Revenue · Investment</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <UserMenu onOpenProfile={() => setShowProfile(true)} avatarUrl={headerAvatarUrl} />
            <button onClick={() => setShowSettings(true)} className="text-slate-500 hover:text-slate-900 p-2 rounded-lg hover:bg-slate-100 transition" title="Settings">
              <Settings size={18} />
            </button>
          </div>
        </div>
        <nav className="relative max-w-7xl mx-auto px-4 overflow-x-auto">
          <div className="flex gap-1 pb-2">
            {NAV_TABS.map(t => {
              const Icon = ICONS[t.icon];
              const active = view === t.id;
              return (
                <button key={t.id} onClick={() => setView(t.id)}
                        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${active ? 'text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {active && (
                    <motion.span
                      layoutId="navPill"
                      className="absolute inset-0 bg-indigo-600 rounded-lg shadow-md shadow-indigo-500/30"
                      style={{ willChange: 'transform' }}
                      transition={{ type: 'spring', stiffness: 600, damping: 38 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <Icon size={14} />
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* Main — lazy-mount views and keep them mounted on subsequent visits.
          This preserves filter / search / sort / month-picker state across tab
          switches (was being lost when AnimatePresence unmounted views). The
          first visit to each view animates in; revisits are instant. */}
      <main className="max-w-7xl mx-auto px-4 py-5">
        <ViewMount visible={view === 'cpa'} viewKey="cpa">
          <CpaDashboard
            leads={leads} investments={investments} activities={activities}
            platformExpenses={platformExpenses}
            businessExpenses={businessExpenses}
            businessIncome={businessIncome}
            chargebacks={chargebacks}
            overrides={overrides}
            ownAdvances={ownAdvances}
            onDeleteChargeback={(id) => setChargebacks(prev => prev.filter(c => c.id !== id))}
            onEditInvestment={editInvestment}
            onDeleteInvestment={deleteInvestment}
            onDeleteAutoWeek={deleteAutoWeek}
            onNewInvestment={() => newInvestment()}
            onNewActivity={newActivity}
            onEditActivity={editActivity}
            onDeleteActivity={deleteActivity}
          />
        </ViewMount>
        <ViewMount visible={view === 'associations'} viewKey="associations">
          <AssociationsView
            leads={leads}
            onEdit={editLead}
            onPause={pauseClient}
            onResume={resumeClient}
            onCancel={cancelClient}
            abDetail={abDetail}
            agentRates={agentRates}
            onOpenImport={() => setShowAbImport(true)}
            onClearResidualBook={() => {
              // Reset the residual book to a clean state. Save effects fire
              // automatically when state changes — both keys get cleared in
              // cloud + local. Leads / advances / Books are untouched.
              setAbDetail([]);
              setAgentRates({});
              showToast('Residual book cleared');
            }}
          />
        </ViewMount>
        <ViewMount visible={view === 'closed'} viewKey="closed">
          <ClosedDeals
            leads={leads}
            onEdit={editLead}
            onUpdate={(l) => {
              // Inline edit handler — merges the patched fields into the
              // matching lead without the modal-save toast/confetti, so
              // typing in the table doesn't spam notifications. The leads
              // state effect persists to storage automatically.
              setLeads(prev => prev.map(x => x.id === l.id ? { ...x, ...l, lastTouch: today() } : x));
            }}
            onDelete={deleteLead}
            onImportFromScreenshot={() => setShowScreenshotImport(true)}
          />
        </ViewMount>
        <ViewMount visible={view === 'dashboard'} viewKey="dashboard">
          <Dashboard
            leads={leads}
            setupStats={setupChecklistStats}
            onSetupAction={(action) => {
              switch (action) {
                case 'openWizard': setShowFirstRunWizard(true); break;
                case 'newLead': newLead(); break;
                case 'goLeads': setView('leads'); break;
                case 'goUpload': setView('upload'); break;
                case 'goBooks': setView('books'); break;
                default: break;
              }
            }}
          />
        </ViewMount>
        <ViewMount visible={view === 'leads'} viewKey="leads">
          <LeadsView leads={leads} onNew={newLead} onEdit={editLead} onDelete={deleteLead} onBulkDelete={bulkDeleteLeads} onBulkStage={bulkStageChange} onNavigate={(v) => setView(v)} />
        </ViewMount>
        <ViewMount visible={view === 'pipeline'} viewKey="pipeline">
          <Pipeline leads={leads} onStageChange={changeStage} onEdit={editLead} onDelete={deleteLead} onNew={newLead} />
        </ViewMount>
        <ViewMount visible={view === 'platforms'} viewKey="platforms">
          <PlatformExpensesView
            expenses={platformExpensesAsView}
            onAdd={onAddPlatformViaBooks}
            onBulkAdd={onBulkAddPlatformsViaBooks}
            onUpdate={onUpdatePlatformViaBooks}
            onDelete={onDeletePlatformViaBooks}
            onBulkAddBooksExpenses={(rows) => {
              if (!rows?.length) return;
              setBusinessExpenses(prev => [...rows, ...prev]);
              showToast(`Also imported ${rows.length} non-platform expense${rows.length !== 1 ? 's' : ''} → Books`);
            }}
            onBulkAddBooksIncome={(rows) => {
              if (!rows?.length) return;
              setBusinessIncome(prev => [...rows, ...prev]);
              showToast(`Also imported ${rows.length} income entr${rows.length !== 1 ? 'ies' : 'y'} → Books`);
            }}
          />
        </ViewMount>
        <ViewMount visible={view === 'prospects'} viewKey="prospects">
          <ProspectsView
            prospects={prospects}
            settings={prospectSettings}
            onAdd={onAddProspect}
            onUpdate={onUpdateProspect}
            onDelete={onDeleteProspect}
            onBulkAdd={onBulkAddProspects}
            onSaveSettings={onSaveProspectSettings}
            onConvertToLead={onConvertProspectToLead}
          />
        </ViewMount>
        <ViewMount visible={view === 'books'} viewKey="books">
          <BusinessBooksView
            expenses={businessExpenses}
            income={businessIncome}
            platformExpenses={platformExpenses}
            leads={leads}
            overrides={overrides}
            ownAdvances={ownAdvances}
            onAddExpense={(e) => { setBusinessExpenses(prev => [e, ...prev]); showToast('Expense added'); }}
            onUpdateExpense={(e) => setBusinessExpenses(prev => prev.map(x => x.id === e.id ? e : x))}
            onDeleteExpense={(id) => {
              const removed = businessExpenses.find(x => x.id === id);
              if (removed?.attachment?.id) deleteAttachmentFromIdb(removed.attachment.id);
              setBusinessExpenses(prev => prev.filter(x => x.id !== id));
            }}
            onBulkAddExpenses={(rows) => {
              if (!rows?.length) return;
              setBusinessExpenses(prev => [...rows, ...prev]);
              showToast(`Imported ${rows.length} expense${rows.length !== 1 ? 's' : ''}`);
            }}
            onAddIncome={(e) => { setBusinessIncome(prev => [e, ...prev]); showToast('Income added'); }}
            onUpdateIncome={(e) => setBusinessIncome(prev => prev.map(x => x.id === e.id ? e : x))}
            onDeleteIncome={(id) => {
              const removed = businessIncome.find(x => x.id === id);
              if (removed?.attachment?.id) deleteAttachmentFromIdb(removed.attachment.id);
              setBusinessIncome(prev => prev.filter(x => x.id !== id));
            }}
            onBulkAddIncome={(rows) => {
              if (!rows?.length) return;
              setBusinessIncome(prev => [...rows, ...prev]);
              showToast(`Imported ${rows.length} income entr${rows.length !== 1 ? 'ies' : 'y'}`);
            }}
            onBulkAddPlatforms={onBulkAddPlatformsViaBooks}
            smartImportOpenSignal={smartImportOpenSignal}
          />
        </ViewMount>
        <ViewMount visible={view === 'calculator'} viewKey="calculator">
          <CommissionCalculator
            defaultTier={tier}
            onSaveDefaultTier={(t) => {
              setTier(t);
              showToast(`Default tier set to ${t}`);
            }}
          />
        </ViewMount>
        <ViewMount visible={view === 'upload'} viewKey="upload">
          <UploadView
            onImport={importLeads}
            onUndoImport={undoLastImport}
            lastImportBatch={lastImportBatch}
            leads={leads}
            onApplyStatement={applyStatement}
            onApplySalesReport={applySalesReport}
            onBackfill={backfillFromExcel}
          />
        </ViewMount>
      </main>

      {/* Footer with copyright + legal links */}
      <footer className="border-t border-slate-200 mt-8 py-5 px-4 text-center text-xs text-slate-500">
        <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1">
          <span>© 2026 R&amp;J Prime Consultancy LLC. All rights reserved.</span>
          <span className="text-slate-300">·</span>
          <a href="/privacy" target="_blank" rel="noopener" className="hover:text-indigo-600">Privacy Policy</a>
          <span className="text-slate-300">·</span>
          <a href="/terms" target="_blank" rel="noopener" className="hover:text-indigo-600">Terms of Service</a>
          <span className="text-slate-300">·</span>
          <span>Built for USHA agents.</span>
        </div>
      </footer>

      {/* Impersonation banner (shown only when admin is signed in as another user) */}
      <ImpersonationBanner />

      {/* What's-new announcements (top of app, dismissed per-user via cloud sync) */}
      <AnnouncementBanner onNavigate={(v) => setView(v)} />

      {/* In-app PRIM assistant (floating chat bubble, bottom right) */}
      <AgentChatbot
        onNavigate={(v) => setView(v)}
        onAction={(action) => {
          // Map chatbot action sentinels onto local UI state.
          switch (action) {
            case 'openSmartImportBooks':
              setView('books');
              setSmartImportOpenSignal(s => s + 1);
              break;
            case 'openSmartImportLeads':
              setView('upload');
              break;
            case 'openScreenshotImport':
              setView('closed');
              setShowScreenshotImport(true);
              break;
            case 'openSettings':
              setShowSettings(true);
              break;
            case 'openPricing':
              if (typeof window !== 'undefined') window.location.href = '/pricing';
              break;
            default:
              // Unknown action — no-op so chatbot CTAs never crash the app.
              break;
          }
        }}
        openSignal={chatOpenSignal}
        buildContext={() => {
          const issuedYTD = leads.filter(l => l.stage === 'Issued' && (l.closedDate || '').startsWith(new Date().getFullYear().toString()));
          const earnedYTD = ownAdvances
            .filter(a => (a.period || '').startsWith(new Date().getFullYear().toString().slice(-2)) || (a.period || '').includes(new Date().getFullYear().toString()))
            .reduce((s, a) => s + Number(a.amount || 0), 0)
            || issuedYTD.reduce((s, l) => s + Number(l.dealValue || 0), 0);
          const overrideYTD = overrides
            .filter(o => (o.period || '').includes(new Date().getFullYear().toString()))
            .reduce((s, o) => s + Number(o.amount || 0), 0);
          const yr = new Date().getFullYear().toString();
          const expensesYTD = businessExpenses
            .filter(e => (e.date || '').startsWith(yr))
            .reduce((s, e) => s + Number(e.amount || 0), 0);
          const booksIncomeYTD = businessIncome
            .filter(e => (e.date || '').startsWith(yr))
            .reduce((s, e) => s + Number(e.amount || 0), 0);
          return {
            email: authUser?.email,
            tier,
            currentView: view,
            leadsCount: leads.length,
            leadsByStage: leads.reduce((acc, l) => {
              acc[l.stage] = (acc[l.stage] || 0) + 1;
              return acc;
            }, {}),
            prospectsCount: prospects.filter(p => !p.archivedAt && !['SOLD', 'LOST'].includes(p.stage)).length,
            kpis: {
              earnedYTD: Math.round(earnedYTD + overrideYTD),
              totalRevenueYTD: Math.round(earnedYTD + overrideYTD + booksIncomeYTD),
              expensesYTD: Math.round(expensesYTD),
              netYTD: Math.round((earnedYTD + overrideYTD + booksIncomeYTD) - expensesYTD),
            },
            recentLeads: leads.slice(0, 8).map(l => ({
              name: l.name,
              stage: l.stage,
              mainProduct: l.mainProduct,
              dealValue: l.dealValue,
            })),
            recentBooksExpenses: businessExpenses.slice(0, 5).map(e => ({
              date: e.date,
              category: e.category,
              amount: e.amount,
              vendor: e.vendor,
            })),
          };
        }}
      />

      {/* One-time no-PHI acknowledgement (gates the app on first sign-in) */}
      <NoPhiBanner />

      {/* Association Bonus residual book — CommissionDetail.csv import.
          Writes to isolated storage keys; never touches leads or P&L. */}
      {showAbImport && (
        <AssociationCommissionDetailImport
          existingRows={abDetail}
          onClose={() => setShowAbImport(false)}
          onCommit={({ rows, rates, addedCount }) => {
            setAbDetail(rows);
            setAgentRates(rates);
            setShowAbImport(false);
            showToast(addedCount > 0
              ? `Imported ${addedCount} new residual row${addedCount !== 1 ? 's' : ''}`
              : 'Already up to date — no new rows added');
          }}
        />
      )}

      {/* Screenshot -> Lead import (USHA portal OCR) */}
      <ScreenshotImport
        open={showScreenshotImport}
        onClose={() => setShowScreenshotImport(false)}
        onCreateLead={(patch) => {
          // Route through importLeads() so screenshot imports get the same
          // universal dedup as every other path. Re-importing the same
          // screenshot for the same customer skips/merges instead of
          // creating a duplicate.
          const newLead = mkLead(patch);
          importLeads([newLead], { batchId: `screenshot_${uid()}`, mode: 'skip' });
          setView('leads');
        }}
      />

      {/* Modals */}
      <LeadForm open={!!leadForm} lead={leadForm} tier={tier} onSave={saveLead} onClose={() => setLeadForm(null)} onDelete={deleteLead} />
      <InvestmentForm open={!!invForm} entry={invForm} autoHelper={autoHelper} onSave={saveInvestment} onClose={() => setInvForm(null)} onDelete={deleteInvestment} />
      <ActivityForm open={!!actForm} entry={actForm} onSave={saveActivity} onClose={() => setActForm(null)} onDelete={deleteActivity} />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        onConfirm={confirm?.onConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* Settings */}
      {showSettings && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-40 flex items-center justify-center p-4"
          onClick={() => setShowSettings(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white/85 backdrop-blur-2xl border border-white/60 shadow-2xl shadow-indigo-500/10 rounded-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">×</button>
            </div>

            {/* Post-Sale Emails (Beta) — hidden for non-allowlist users.
                Lives at the top of the modal so it's discoverable for the
                allowlist agents who use the feature. */}
            <PostSaleEmailsSection />

            {/* Onboarding replays — gives agents a way to re-watch the
                feature tour or re-run the setup wizard after dismissing it. */}
            <div className="mb-5 pb-5 border-b border-slate-200">
              <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">ONBOARDING</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowFirstRunWizard(true);
                  }}
                  className="text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Replay setup wizard
                  <div className="text-[11px] text-slate-500 mt-0.5">4-step new-agent setup flow.</div>
                </button>
                <button
                  onClick={() => {
                    setShowSettings(false);
                    setShowOnboarding(true);
                  }}
                  className="text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Replay feature tour
                  <div className="text-[11px] text-slate-500 mt-0.5">Full 12-step walkthrough of every tab.</div>
                </button>
              </div>
            </div>

            <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">DATA</div>
            <div className="space-y-2">
              <button onClick={() => clearAll('activities')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear activities</button>
              <button onClick={() => clearAll('investments')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear investments</button>
              <button onClick={() => clearAll('platforms')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear platform expenses</button>
              <button onClick={() => clearAll('books')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear business books</button>
              <button onClick={() => clearAll('chargebacks')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear chargebacks</button>
              <button onClick={() => clearAll('overrides')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear overrides</button>
              <button onClick={() => clearAll('prospects')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear prospects</button>
              <button onClick={() => clearAll('leads')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear leads</button>
              <button onClick={() => clearAll('everything')} className="w-full text-left bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm hover:bg-red-100 font-medium">Clear everything</button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Profile hub — personal control center */}
      <Profile open={showProfile} onClose={() => setShowProfile(false)} />

      <Toast toast={toast} />

      {/* Auto-send queue runner — surfaces the 5-min countdown toast(s)
          for any pending post-sale emails and fires them when due.
          No-op for non-beta-access users (the component handles that
          internally). */}
      <PendingEmailQueueRunner
        leads={leads}
        onAuditEntry={(leadId, entry) => {
          setLeads(prev => prev.map(l => l.id === leadId
            ? { ...l, emailLog: [...(l.emailLog || []), entry] }
            : l
          ));
        }}
      />

      {/* First-Run Wizard — auto-launches once per agent (brand new
          accounts). Gets them to first value in ~60 seconds: pick tier,
          choose how to start, see what Books does, jump into the app. */}
      <FirstRunWizard
        open={showFirstRunWizard}
        onClose={() => setShowFirstRunWizard(false)}
        onComplete={async () => {
          try {
            const { markCompleted } = await import('@/lib/onboarding');
            await markCompleted();
            setOnboardingCompletedFlag(true);
          } catch { /* ignore */ }
        }}
        onOpenSmartImport={() => {
          setView('books');
          setSmartImportOpenSignal(s => s + 1);
        }}
        onOpenLeadForm={() => newLead()}
        onNavigate={(v) => setView(v)}
        onOpenChat={() => setChatOpenSignal(s => s + 1)}
      />

      {/* 12-step walkthrough — replay-only from Settings now that the
          First-Run Wizard handles brand-new agents. */}
      <OnboardingWalkthrough
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onNavigate={(v) => setView(v)}
        onOpenChat={() => setChatOpenSignal(s => s + 1)}
        onOpenSmartImport={() => {
          setView('books');
          setSmartImportOpenSignal(s => s + 1);
        }}
      />
    </div>
    </PaywallGate>
  );
}
