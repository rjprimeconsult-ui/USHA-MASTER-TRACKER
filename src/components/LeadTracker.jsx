'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Calculator, Repeat, CheckSquare, LayoutDashboard, Users, Columns, Upload, Settings, Sparkles, DollarSign, BookOpen, LogOut, UserPlus, User as UserIcon, FileText, Merge, Send,
} from 'lucide-react';
import { PrimAppIcon } from '@/components/PrimLogo';
import { storage, onStorageError } from '@/lib/storage';
import { deleteAttachment as deleteAttachmentFromIdb } from '@/lib/attachments';
import { mkLead, migrateLead } from '@/lib/seed';
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
import { buildSalesReportPatch } from '@/lib/salesreport';
import { stampUpdatedAt, mergeArrayStores, sameRecords } from '@/lib/mergeStore.mjs';
import { subscribeUserKv } from '@/lib/realtimeSync';

import CpaDashboard from './views/CpaDashboard';
import AssociationsView from './views/AssociationsView';
import ClosedDeals from './views/ClosedDeals';
import Dashboard from './views/Dashboard';
import LeadsView from './views/LeadsView';
import Pipeline from './views/Pipeline';
import UploadView from './views/UploadView';
import PlatformExpensesView from './views/PlatformExpensesView';
import BusinessBooksView from './views/BusinessBooksView';
import ReportsView from './views/ReportsView';
import ProspectsView from './views/ProspectsView';
import CommissionCalculator from './views/CommissionCalculator';
import BlastsView from './views/BlastsView';
import { normalizeBlastPayload, upsertBlast, normPlatform } from '@/lib/blastLog.mjs';
import DuplicateResolver from './DuplicateResolver';
import { findDuplicateGroups, enumeratePairs, shouldSkipPair } from '@/lib/duplicateResolver.mjs';
import { nameKey, buildAdvancePatch } from '@/lib/statement';
import StatementManager from './StatementManager';
import { statementsInRange, isStatementIncome } from '@/lib/statementManager.mjs';
import {
  FOLLOWUP_PLAYBOOK_KEY, DEFAULT_PLAYBOOK,
  ensureFollowupFields, armIfNeeded, armCadence, logTouch as engineLogTouch, snooze as engineSnooze, suggestStageAfterTouch, applyOutreachEmail,
  resolveTouchReminder,
} from '@/lib/followupEngine.mjs';
import LeadForm from './LeadForm';
import InvestmentForm from './InvestmentForm';
import ActivityForm from './ActivityForm';
import ConfirmDialog from './ConfirmDialog';
import NoPhiBanner from './NoPhiBanner';
import ImpersonationBanner from './ImpersonationBanner';
import AnnouncementBanner from './AnnouncementBanner';
import UpdateBanner from './UpdateBanner';
import AgentChatbot from './AgentChatbot';
import OnboardingWalkthrough from './OnboardingWalkthrough';
import OnboardingFlow from './OnboardingFlow';
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
import TextDripReviewModal from './TextDripReviewModal';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { classifyImport, mapToProspect, mergeConversationIntoProspect } from '@/lib/textdrip.mjs';
import AppSkeleton from './AppSkeleton';
import { useSubscription } from '@/lib/subscription';
import { TeamInviteBanner } from './TeamMembership';
import nextDynamic from 'next/dynamic';

// Lazy-load the Team leader view — only Team-tier leaders ever see it, so
// its bundle (scoreboard + mirror plumbing) stays out of everyone else's app.
const TeamView = nextDynamic(() => import('./views/TeamView'), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-400 p-4">Loading team…</div>,
});

const ICONS = { Calculator, Repeat, CheckSquare, LayoutDashboard, Users, Columns, Upload, DollarSign, BookOpen, UserPlus, FileText, Send };

// Normalise an AI-returned datetime to the "YYYY-MM-DDTHH:mm" form that
// <input type="datetime-local"> requires (handles space-separated, seconds, zone).
function toDateTimeLocal(s) {
  if (!s) return '';
  const m = String(s).trim().replace(' ', 'T').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m ? m[1] : '';
}

const LEADS_KEY = 'leads_v5';
const LEADS_KEY_V4 = 'leads_v4';
const INV_KEY = 'investments_v2';
const ACT_KEY = 'activities_v1';
const TIER_KEY = 'agent_tier_v1';
const CB_KEY   = 'chargebacks_v1';
const OVR_KEY  = 'overrides_v1';
const OWN_ADV_KEY = 'own_advances_v1';
const BLAST_KEY = 'blast_log_v1';

// Map a row from the blast_counters table (atomic Ringy native capture) into the
// display shape BlastsView expects. Kept separate from blast_log_v1 (manual /
// skill entries) so the accurate DB counter is never overwritten by app state.
function counterToBlast(r) {
  // The counter PK stores run_date as the UTC day (server-stamped). For display
  // and Today/Last-7 bucketing, convert the real instant (first_at) to the
  // viewer's LOCAL calendar day so an evening blast in a western timezone shows
  // on the day the agent actually ran it — not the next UTC day. The UTC run_date
  // is still kept in _native for the delete PK match.
  const d = new Date(r.first_at || r.last_at);
  const valid = !Number.isNaN(d.getTime());
  const p = (n) => String(n).padStart(2, '0');
  // Bucket/display day AND send time both derive from the real start instant
  // (first_at), converted to the viewer's local timezone. sendTime = when the
  // blast started (HH:MM) — useful for time-of-day analytics later.
  const localDate = valid ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` : r.run_date;
  const localTime = valid ? `${p(d.getHours())}:${p(d.getMinutes())}` : '';
  return {
    id: `bc:${r.run_date}:${r.platform}:${r.tag}`,
    runDate: localDate,
    platform: r.platform,
    campaignOrTag: r.tag,
    contacts: r.contacts,
    rangeStart: r.range_start || '', rangeEnd: r.range_end || '', sendTime: localTime, numbersUsed: '', notes: r.notes || '',
    source: 'auto',
    createdAt: r.first_at,
    lastAt: r.last_at,
    _native: { run_date: r.run_date, platform: r.platform, tag: r.tag },
  };
}
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
  // Team-tier gate for the "View My Team" tab. Client-side filter only — the
  // /api/team/* endpoints enforce the real entitlement server-side.
  const { profile: subProfile } = useSubscription();
  const teamEntitled = !!(subProfile?.is_admin || subProfile?.subscription_tier === 'team');
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
  const [blasts, setBlasts] = useState([]);
  const [nativeBlasts, setNativeBlasts] = useState([]); // Ringy atomic counters (blast_counters table)
  const [advanceMonthsHistory, setAdvanceMonthsHistory] = useState([]);
  const [platformExpenses, setPlatformExpenses] = useState([]);
  const [businessExpenses, setBusinessExpenses] = useState([]);
  const [businessIncome, setBusinessIncome] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [prospectSettings, setProspectSettings] = useState(null);
  // Newest-wins stamping for the co-edited stores (multi-session safety):
  // prev* = the array as of the last persist (for change detection by ref);
  // *Ts   = id → last updatedAt stamp, so only the record actually edited gets
  // a fresh timestamp. Seeded at load so the first save doesn't stamp the world.
  const prevLeadsRef = useRef([]);
  const leadTsRef = useRef(new Map());
  const prevProspectsRef = useRef([]);
  const prospectTsRef = useRef(new Map());
  // When a change arrives via realtime (another session saved), we apply it to
  // state but must NOT re-stamp/re-save it (that would bump timestamps and echo
  // back out). These flags tell the next persist to skip exactly once.
  const skipNextLeadsSaveRef = useRef(false);
  const skipNextProspectsSaveRef = useRef(false);
  const [followupPlaybook, setFollowupPlaybook] = useState(DEFAULT_PLAYBOOK);
  const [tier, setTier] = useState('WA');
  // Association Bonus residual data — loaded from cloud, isolated from leads.
  const [abDetail, setAbDetail] = useState([]);
  const [agentRates, setAgentRates] = useState({});
  const [showAbImport, setShowAbImport] = useState(false);
  const [toast, setToast] = useState(null);
  const [lastImportBatch, setLastImportBatch] = useState(null);

  // Duplicate resolver — modal open state + a derived count of unreviewed
  // same-name pairs, used to drive the persistent banner.
  const [showDupResolver, setShowDupResolver] = useState(false);

  // TextDrip review modal state
  const [tdReviewItems, setTdReviewItems] = useState([]);  // { contact, matchedProspect }[]
  const [showTdReview, setShowTdReview] = useState(false);

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
      // Real (signed-in) accounts start EMPTY — never seeded with demo data.
      // Previously an empty cloud fell back to SEED_LEADS/SEED_INVESTMENTS/
      // SEED_ACTIVITIES, which (a) showed every brand-new agent fake leads
      // ("William Stolte" etc.) and (b) persisted that fake data to their
      // cloud, contaminating their real CPA / revenue / ROI numbers until
      // they hunted it down and deleted it. New paying customers must see a
      // clean, empty tracker. The First-Run Wizard is a tour overlay and
      // works fine over an empty UI.
      // Always run migrateLead on loaded data so stage/product renames are
      // applied idempotently even to leads_v5 records from earlier builds.
      const loadedLeads = (leadsRaw ? JSON.parse(leadsRaw) : []).map(migrateLead);
      setLeads(loadedLeads);
      // Seed the newest-wins baseline so the first auto-save after load doesn't
      // stamp every record (which would make this session's whole list "newest").
      prevLeadsRef.current = loadedLeads;

      const invRaw = await storage.getItem(INV_KEY);
      setInvestments(invRaw ? JSON.parse(invRaw) : []);

      const actRaw = await storage.getItem(ACT_KEY);
      setActivities(actRaw ? JSON.parse(actRaw) : []);

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

      const blastRaw = await storage.getItem(BLAST_KEY);
      const blastParsed = blastRaw ? JSON.parse(blastRaw) : [];
      // Ringy is now owned exclusively by the atomic blast_counters table. Purge
      // any legacy Ringy rows from blast_log_v1 — broken pre-migration auto rows
      // (the ones that logged 119 of 2,000) AND any old skill-POST Ringy rows —
      // so they can't double-count against the counter. One-time, self-healing.
      const blastClean = blastParsed.filter(b => normPlatform(b?.platform) !== 'Ringy');
      setBlasts(blastClean);
      if (blastClean.length !== blastParsed.length) {
        storage.setItem(BLAST_KEY, JSON.stringify(blastClean));
      }

      // Ringy native blast counters live in their own table (atomic increments).
      // Read-only here; the webhook is the sole writer. Graceful before migration.
      if (supabaseConfigured()) {
        try {
          const { data: bc, error: bcErr } = await supabase.from('blast_counters').select('*');
          if (!bcErr && Array.isArray(bc)) setNativeBlasts(bc.map(counterToBlast));
        } catch { /* table not migrated yet — ignore */ }
      }

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

        // CRITICAL: erase the legacy store IMMEDIATELY after migration so
        // it can't re-inject the same rows on subsequent loads. The bug
        // this fixes: agent deletes platform-category rows from Books to
        // clean up duplicates, refreshes, and on next load the migration
        // re-adds those rows because they're still in peInitial. Result:
        // "my cleanup didn't save" + permanent duplicate situation.
        //
        // We clear PE_KEY here (not via the setPlatformExpenses useEffect,
        // which races with `loaded` becoming true). The state is then
        // initialised to [] below.
        await storage.removeItem(PE_KEY);
      }

      // One-shot ID collision repair.
      //
      // Old uid() (Math.random based, 8 chars) could collide. When two rows
      // share an id, React's keyed selection breaks: clicking a checkbox
      // marks selectedIds.has(thatId) true, which renders BOTH rows as
      // checked. Same bug also breaks per-row update/delete callbacks.
      //
      // Heal: any row whose id collides with an earlier row gets a fresh
      // collision-proof UUID. Idempotent — no collisions = no writes.
      try {
        const seenIds = new Set();
        let repaired = 0;
        beInitial = beInitial.map(row => {
          if (!row || !row.id || seenIds.has(row.id)) {
            const next = { ...(row || {}), id: uid() };
            seenIds.add(next.id);
            repaired++;
            return next;
          }
          seenIds.add(row.id);
          return row;
        });
        if (repaired > 0) {
          await storage.setItem(BE_KEY, JSON.stringify(beInitial));
          // eslint-disable-next-line no-console
          console.log(`[Books id-repair] Re-issued ${repaired} colliding id(s) on load.`);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Books id-repair] failed', e);
      }

      // NOTE: content-based auto-dedup on load was REMOVED (2026-05-28).
      //
      // It could not distinguish a true duplicate (same content, different
      // id, created by a re-import) from a LEGITIMATE TWIN (same content,
      // different id, two real charges — e.g. two identical $529.32
      // "PwP AMERICAN EXPRS" travel charges on the same day, both offset
      // by a single points credit). Collapsing by content silently ate
      // the agent's real second charge, AND would eat it again every time
      // they re-added it by hand. Net harm > net good now that:
      //   - the legacy platform-store re-injection bug is fixed
      //   - uid() is collision-proof (crypto.randomUUID)
      //   - Smart Import dedups against existing data at import time
      //     (multiset — see BusinessBooksView onImport), which is the
      //     correct place to prevent re-import duplicates
      // The ID-collision repair above stays (it only re-issues colliding
      // ids; it never deletes rows). Any genuine historical duplicates the
      // agent wants gone are removed via manual bulk-select/delete.

      // Legacy `platformExpenses` state is retired. PlatformsView reads
      // from `platformExpensesAsView` (derived from businessExpenses), so
      // there is no longer a second source of truth. We keep the state
      // declared as [] purely to avoid breaking any stray legacy reads
      // until the next refactor pass.
      setPlatformExpenses([]);
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
      const rawPlaybook = await storage.getItem(FOLLOWUP_PLAYBOOK_KEY);
      const pb = rawPlaybook ? JSON.parse(rawPlaybook) : DEFAULT_PLAYBOOK;
      setFollowupPlaybook(pb);

      const nowIso = new Date().toISOString();
      const armedProspects = prMigrated.map(p => armIfNeeded(ensureFollowupFields(p, nowIso), pb));
      setProspects(armedProspects);
      prevProspectsRef.current = armedProspects; // seed newest-wins baseline (see leads above)

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
  useEffect(() => {
    if (!loaded) return;
    if (skipNextLeadsSaveRef.current) { skipNextLeadsSaveRef.current = false; prevLeadsRef.current = leads; return; }
    // Stamp only the records this session actually edited, then persist. The
    // newest-wins merge uses these stamps so a stale second session can't
    // clobber another session's recent edit (e.g. a logged touch).
    const stamped = stampUpdatedAt(prevLeadsRef.current, leads, leadTsRef.current, new Date().toISOString());
    prevLeadsRef.current = leads;
    storage.setItem(LEADS_KEY, JSON.stringify(stamped));
  }, [leads, loaded]);
  useEffect(() => { if (loaded) storage.setItem(INV_KEY, JSON.stringify(investments)); }, [investments, loaded]);
  useEffect(() => { if (loaded) storage.setItem(ACT_KEY, JSON.stringify(activities)); }, [activities, loaded]);
  useEffect(() => { if (loaded) storage.setItem(TIER_KEY, tier); }, [tier, loaded]);
  useEffect(() => { if (loaded) storage.setItem(CB_KEY, JSON.stringify(chargebacks)); }, [chargebacks, loaded]);
  useEffect(() => { if (loaded) storage.setItem(OVR_KEY, JSON.stringify(overrides)); }, [overrides, loaded]);
  useEffect(() => { if (loaded) storage.setItem(OWN_ADV_KEY, JSON.stringify(ownAdvances)); }, [ownAdvances, loaded]);
  useEffect(() => { if (loaded) storage.setItem(AM_KEY, JSON.stringify(advanceMonthsHistory)); }, [advanceMonthsHistory, loaded]);
  useEffect(() => { if (loaded) storage.setItem(BLAST_KEY, JSON.stringify(blasts)); }, [blasts, loaded]);
  // [retired 2026-05-26] platform_expenses_v1 is no longer a source of
  // truth — PlatformsView reads from businessExpenses via the
  // platformExpensesAsView memo. The legacy store is cleared during
  // load-time migration and is never written to again. Leaving the
  // platformExpenses state declared (initialised to []) for backwards
  // compat with any straggler readers until the next refactor pass.
  useEffect(() => { if (loaded) storage.setItem(BE_KEY, JSON.stringify(businessExpenses)); }, [businessExpenses, loaded]);
  useEffect(() => { if (loaded) storage.setItem(BI_KEY, JSON.stringify(businessIncome)); }, [businessIncome, loaded]);
  useEffect(() => {
    if (!loaded) return;
    if (skipNextProspectsSaveRef.current) { skipNextProspectsSaveRef.current = false; prevProspectsRef.current = prospects; return; }
    const stamped = stampUpdatedAt(prevProspectsRef.current, prospects, prospectTsRef.current, new Date().toISOString());
    prevProspectsRef.current = prospects;
    storage.setItem(PROSPECTS_KEY, JSON.stringify(stamped));
  }, [prospects, loaded]);

  // Live multi-session sync: when another browser on this account saves, pull
  // the change in and newest-wins-merge it (no manual refresh). Debounced;
  // applies only real changes (sameRecords), and skips the echo re-save.
  // Inert until Supabase Realtime is enabled on user_kv (see realtimeSync.js).
  useEffect(() => {
    if (!loaded || !authUser?.id) return;
    let timer = null;
    const pending = new Set();
    const flush = async () => {
      const keys = [...pending]; pending.clear();
      for (const key of keys) {
        try {
          const raw = await storage.getItem(key);
          if (key === LEADS_KEY) {
            const cloud = raw ? JSON.parse(raw).map(migrateLead) : [];
            setLeads(prev => {
              const merged = mergeArrayStores(prev, cloud) || prev;
              if (sameRecords(merged, prev)) return prev;
              skipNextLeadsSaveRef.current = true;
              return merged;
            });
          } else if (key === PROSPECTS_KEY) {
            const nowIso = new Date().toISOString();
            const cloud = (raw ? JSON.parse(raw) : [])
              .map(p => armIfNeeded(ensureFollowupFields(p, nowIso), followupPlaybook));
            setProspects(prev => {
              const merged = mergeArrayStores(prev, cloud) || prev;
              if (sameRecords(merged, prev)) return prev;
              skipNextProspectsSaveRef.current = true;
              return merged;
            });
          }
        } catch { /* ignore a single bad reload */ }
      }
    };
    const unsub = subscribeUserKv(authUser.id, [LEADS_KEY, PROSPECTS_KEY], (key) => {
      pending.add(key);
      clearTimeout(timer);
      timer = setTimeout(flush, 400);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [loaded, authUser?.id, followupPlaybook]);
  useEffect(() => { if (loaded && prospectSettings) storage.setItem(PROSPECT_SETTINGS_KEY, JSON.stringify(prospectSettings)); }, [prospectSettings, loaded]);
  useEffect(() => { if (loaded) storage.setItem(AB_DETAIL_KEY, JSON.stringify(abDetail)); }, [abDetail, loaded]);
  useEffect(() => { if (loaded) storage.setItem(AGENT_RATES_KEY, JSON.stringify(agentRates)); }, [agentRates, loaded]);

  // How many unreviewed duplicate-name pairs exist right now. Drives the
  // banner that surfaces above the main views.
  const dupPairCount = useMemo(() => {
    let count = 0;
    for (const g of findDuplicateGroups(leads || [], nameKey)) {
      for (const p of enumeratePairs(g)) {
        if (!shouldSkipPair(p.a, p.b)) count++;
      }
    }
    return count;
  }, [leads]);

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

  // ---- Payment Alerts lifecycle (protects Taken Rate) ----
  // "Taken" = the first premium drafted successfully → clear the alert.
  const markPaymentTaken = useCallback((id) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, paymentConfirmedAt: new Date().toISOString() } : l));
    showToast('Marked as taken — alert cleared');
  }, [showToast]);
  // Stamp when the agent sends the client heads-up (row shows "messaged",
  // stays until marked Taken).
  const markPaymentHeadsUpSent = useCallback((id) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, paymentHeadsUpSentAt: new Date().toISOString() } : l));
  }, []);

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

    // 1. Advances — write the advance to EVERY matched lead.
    //
    // The matched-customers preview already promises "These will update the
    // existing leads" and shows the New Advance for ALL matches — including
    // leads sitting in Not taken / Declined / Withdrawn (the stage is usually
    // just stale; the statement is ground truth that money was paid). Earlier
    // this was gated to Pending/Issued only, which silently dropped those
    // advances. buildAdvancePatch keeps the Pending → Issued promotion but never
    // auto-flips negative stages, and Issued-revenue KPIs gate on stage, so an
    // advance on a negative-stage lead can't inflate revenue.
    if (plan.matched && plan.matched.length > 0) {
      const byId = new Map();
      plan.matched.forEach(m => { byId.set(m.leadId, m); });
      setLeads(prev => prev.map(l => {
        const m = byId.get(l.id);
        if (!m) return l;
        const patch = buildAdvancePatch(l, m.total, today(), m.estimatedAV || 0);
        if (patch.stage === 'Issued' && l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = l.closedDate || today();
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
            fromStatement: true,
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

    // DEDUP GATE (root cause #2 of the 2026-06-01 duplicate explosion).
    // This path used to prepend `leadsToAdd` raw — no duplicate guard —
    // unlike importLeads(). Re-running the gap upload, or it overlapping
    // the Excel historical, stacked leads unbounded. Run the additions
    // through the SAME dedup engine importLeads uses (skip mode), against
    // the current book, so the same person can never be re-added.
    const { fresh, duplicates } = dedupLeads(leadsToAdd, leads, { merge: false });

    const batchId = `salesreport_${uid()}`;
    const stamped = fresh.map(l => ({ ...l, importBatchId: batchId, importedAt: new Date().toISOString() }));

    setLeads(prev => {
      const updated = prev.map(l => {
        const s = stageMap.get(l.id);
        if (!s) return l;
        // Merge ALL detected corrections — stage, main product, new policy
        // numbers, and premium — not just stage. Complete policy numbers are
        // what let weekly-statement advances attach to the right client.
        const patch = { ...buildSalesReportPatch(l, s.issues || []), lastTouch: today() };
        // Stamp association/closedDate if newly issued
        if (patch.stage === 'Issued' && l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = l.closedDate || today();
        }
        return { ...l, ...patch };
      });
      return [...stamped, ...updated];
    });
    const bits = [];
    if (fresh.length) bits.push(`${fresh.length} lead${fresh.length !== 1 ? 's' : ''} added`);
    if (duplicates.length) bits.push(`${duplicates.length} duplicate${duplicates.length !== 1 ? 's' : ''} skipped`);
    if (stageUpdates.length) bits.push(`${stageUpdates.length} stage${stageUpdates.length !== 1 ? 's' : ''} fixed`);
    showToast(bits.join(' · ') || 'Nothing to apply');
  }, [showToast, leads]);

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

  // Replace `winner` with merged record and delete `loser`. Single
  // setLeads call so the persist effect fires once and the merge-on-save
  // logic in storage.js sees a consistent state.
  const handleDupMerge = useCallback((mergedWinner, loser) => {
    setLeads(prev => prev
      .filter(l => l.id !== loser.id)
      .map(l => (l.id === mergedWinner.id ? mergedWinner : l)));
  }, [setLeads]);

  // Tag `newerLead` as a repeat of `olderLeadId`. Stamp dedupReviewedAt
  // on both so the pair doesn't reappear.
  const handleDupTagRepeated = useCallback((newerLead, olderLeadId) => {
    const now = new Date().toISOString();
    setLeads(prev => prev.map(l => {
      if (l.id === newerLead.id) {
        return { ...l, previousLeadId: olderLeadId, dedupReviewedAt: now };
      }
      if (l.id === olderLeadId) {
        return { ...l, dedupReviewedAt: now };
      }
      return l;
    }));
  }, [setLeads]);

  // Stamp dedupReviewedAt on both leads so the pair is excluded next time.
  const handleDupDismiss = useCallback((a, b) => {
    const now = new Date().toISOString();
    setLeads(prev => prev.map(l => {
      if (l.id === a.id || l.id === b.id) {
        return { ...l, dedupReviewedAt: now };
      }
      return l;
    }));
  }, [setLeads]);

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

  const deleteStatementRange = useCallback((from, to) => {
    const sel = statementsInRange({ ownAdvances, overrides, chargebacks, businessIncome }, from, to);
    setOwnAdvances(prev => prev.filter(r => !sel.ownIds.has(r.id)));
    setOverrides(prev => prev.filter(r => !sel.overrideIds.has(r.id)));
    setChargebacks(prev => prev.filter(r => !sel.chargebackIds.has(r.id)));
    setBusinessIncome(prev => prev.filter(r => !sel.monthlyIds.has(r.id)));
    showToast('Deleted statements in range');
  }, [ownAdvances, overrides, chargebacks, businessIncome, showToast]);

  const deleteStatementWeek = useCallback((period) => {
    const p = String(period).slice(0, 10);
    setOwnAdvances(prev => prev.filter(r => String(r.period).slice(0, 10) !== p));
    setOverrides(prev => prev.filter(r => String(r.period).slice(0, 10) !== p));
    setChargebacks(prev => prev.filter(r => String(r.period).slice(0, 10) !== p));
    showToast(`Deleted week ${p}`);
  }, [showToast]);

  const deleteStatementMonth = useCallback((month) => {
    const m = String(month).slice(0, 7);
    setBusinessIncome(prev => prev.filter(r => !(isStatementIncome(r) && String(r.date).slice(0, 7) === m)));
    showToast(`Deleted payouts for ${m}`);
  }, [showToast]);

  const deleteStatementRow = useCallback((store, id) => {
    if (store === 'own')             setOwnAdvances(prev => prev.filter(r => r.id !== id));
    else if (store === 'override')   setOverrides(prev => prev.filter(r => r.id !== id));
    else if (store === 'chargeback') setChargebacks(prev => prev.filter(r => r.id !== id));
    else if (store === 'income')     setBusinessIncome(prev => prev.filter(r => r.id !== id));
  }, []);

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
    // Carry the account/card through from the import wizard so platform
    // charges land pre-tagged with the card they were paid on (e.g.
    // "American Express") instead of blank.
    account: p.account || '',
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
  const applyProspectUpdate = useCallback((updated) => {
    setProspects(prev => prev.map(p => {
      if (p.id !== updated.id) return p;
      const stageChanged = updated.stage && updated.stage !== p.stage;
      return stageChanged
        ? armCadence(updated, followupPlaybook, new Date().toISOString())
        : updated;
    }));
  }, [followupPlaybook]);

  const applyStageSuggestion = useCallback((prospectId, stage) => {
    setProspects(prev => prev.map(p => {
      if (p.id !== prospectId) return p;
      return armCadence({ ...p, stage }, followupPlaybook, new Date().toISOString());
    }));
  }, [followupPlaybook]);

  const onAddProspect = useCallback((p) => {
    setProspects(prev => [armIfNeeded(p, followupPlaybook), ...prev]);
    showToast('Prospect added');
  }, [followupPlaybook, showToast]);
  const onUpdateProspect = useCallback((p) => {
    applyProspectUpdate(p);
  }, [applyProspectUpdate]);
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

  const logProspectTouch = useCallback((prospectId, touch) => {
    const now = new Date().toISOString();
    let suggestion = null;
    setProspects(prev => prev.map(p => {
      if (p.id !== prospectId) return p;
      const r = engineLogTouch(p, touch, followupPlaybook, now);
      suggestion = suggestStageAfterTouch(r.prospect, { ...touch }, followupPlaybook);
      return { ...r.prospect, lastContact: now.slice(0, 10) };
    }));
    return suggestion;
  }, [followupPlaybook]);

  // Sending an outreach email records it AND advances the unified follow-up
  // clock (it counts as a touch), so the prospect clears off the follow-up list.
  const logProspectOutreachEmail = useCallback((prospectId, entry) => {
    const now = new Date().toISOString();
    setProspects(prev => prev.map(p =>
      p.id === prospectId ? applyOutreachEmail(p, entry, followupPlaybook, now) : p
    ));
  }, [followupPlaybook]);

  const snoozeProspect = useCallback((prospectId, days) => {
    const now = new Date().toISOString();
    setProspects(prev => prev.map(p => p.id === prospectId ? engineSnooze(p, days, now) : p));
  }, []);

  const resolveProspectReminder = useCallback((prospectId, touchId) => {
    const now = new Date().toISOString();
    setProspects(prev => prev.map(p => p.id === prospectId ? resolveTouchReminder(p, touchId, now) : p));
  }, []);

  // ---- TextDrip sync ----
  const syncTextDripInner = useCallback(async (syncPayload) => {
    // syncPayload can be provided directly (from the TextDripSettings card inside
    // ProspectsView) or undefined (from the Sync button in ProspectsView header,
    // which calls syncTextDrip() without arguments).
    // When called without a payload we need to fetch status first to get defaultStage.
    const nowIso = new Date().toISOString();

    // Helper: get bearer token
    const getBearer = async () => {
      if (!supabaseConfigured()) return null;
      try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token || null;
      } catch { return null; }
    };
    const authedPost = async (url) => {
      const token = await getBearer();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    };
    const authedGet = async (url) => {
      const token = await getBearer();
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    };

    // Only treat the argument as a sync payload if it actually looks like one
    // (the Settings card passes the /api/textdrip/sync response; the header
    // button passes nothing — and must never pass e.g. a click event that
    // would silently no-op the import).
    let payload = (syncPayload && Array.isArray(syncPayload.contacts)) ? syncPayload : null;
    let defaultStage = 'PENDING_DECISION';

    try {
      // If no payload provided, do the sync call ourselves
      if (!payload) {
        // First get status for defaultStage
        let statusData;
        try {
          statusData = await authedGet('/api/textdrip/status');
          defaultStage = statusData.defaultStage || 'PENDING_DECISION';
        } catch { /* proceed with default */ }

        try {
          payload = await authedPost('/api/textdrip/sync');
        } catch (e) {
          showToast(e.message || 'TextDrip sync failed', 'error');
          return { error: true, summary: e.message || 'TextDrip sync failed' };
        }
      } else {
        // payload was passed in (from TextDripSettings card's onSyncDone)
        // get defaultStage from a quick status check
        try {
          const s = await authedGet('/api/textdrip/status');
          defaultStage = s.defaultStage || 'PENDING_DECISION';
        } catch { /* proceed with default */ }
      }
    } catch (e) {
      showToast(e.message || 'TextDrip sync failed', 'error');
      return { error: true, summary: e.message || 'TextDrip sync failed' };
    }

    const { contacts = [], scanned = 0 } = payload || {};

    if (contacts.length === 0) {
      // Scan ran but no contact carried the import tag. Tells the agent to
      // check the tag name in Settings / that the lead is actually tagged.
      const summary = `Scanned ${scanned} recent conversation${scanned !== 1 ? 's' : ''} · no contacts have that tag`;
      showToast(`TextDrip: ${summary}`);
      return { summary };
    }

    // Layer B: bounded-concurrency AI extraction helper (creates only)
    const extractConversation = async (messages) => {
      try {
        const token = await getBearer();
        const res = await fetch('/api/textdrip/extract-conversation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ messages }),
        });
        if (!res.ok) return null;
        return await res.json().catch(() => null);
      } catch {
        return null;
      }
    };

    const runExtractionBatch = async (items, concurrency = 4) => {
      const results = new Map(); // prospect.id → ai fields
      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const settled = await Promise.allSettled(
          chunk.map(async ({ prospect, messages }) => {
            const fields = await extractConversation(messages);
            return { id: prospect.id, fields };
          })
        );
        for (const s of settled) {
          if (s.status === 'fulfilled' && s.value.fields) {
            results.set(s.value.id, s.value.fields);
          }
        }
      }
      return results;
    };

    let created = 0;
    let updated = 0;
    const reviewItems = [];
    // Collect newly-created prospects for Layer B extraction
    const createdProspects = [];

    // Read current prospects to classify
    setProspects(prevProspects => {
      const toCreate = [];
      const toUpdate = [];

      for (const contact of contacts) {
        const classification = classifyImport(contact, prevProspects);
        if (classification.action === 'create') {
          // Pass contact.timezone (computed by server from state via timezoneFromState)
          const newP = mapToProspect(contact, defaultStage, contact.conversation, nowIso, contact.timezone);
          toCreate.push(newP);
          // Track for Layer B AI extraction (first import only)
          createdProspects.push({ prospect: newP, messages: contact.conversation?.messages || [] });
          created++;
        } else if (classification.action === 'update') {
          const matched = prevProspects.find(p => p.id === classification.matchId);
          if (matched) {
            toUpdate.push(mergeConversationIntoProspect(matched, contact, nowIso));
            updated++;
          }
        } else {
          // review
          const matched = prevProspects.find(p => p.id === classification.matchId);
          if (matched) {
            reviewItems.push({ contact, matchedProspect: matched });
          }
        }
      }

      // Apply creates + updates in one atomic state update
      const updateById = new Map(toUpdate.map(p => [p.id, p]));
      const withUpdates = prevProspects.map(p => updateById.get(p.id) || p);
      return [...toCreate, ...withUpdates];
    });

    // Show review modal if needed
    if (reviewItems.length > 0) {
      setTdReviewItems(reviewItems);
      setShowTdReview(true);
    }

    // Toast (initial)
    const bits = [];
    if (created > 0) bits.push(`Imported ${created}`);
    if (updated > 0) bits.push(`updated ${updated}`);
    if (reviewItems.length > 0) bits.push(`${reviewItems.length} to review`);
    // contacts WERE tag-matched but all dedup to existing prospects — say so
    // explicitly so "nothing happened" reads as "already in PRIM," not a failure.
    if (bits.length === 0) bits.push(`${contacts.length} tagged contact${contacts.length !== 1 ? 's' : ''} · already in PRIM`);
    const summary = bits.join(' · ');
    showToast(summary);

    // Layer B: AI extraction for newly-created prospects only (cost control)
    const extractionTargets = createdProspects.filter(c => c.messages.length > 0);
    if (extractionTargets.length > 0) {
      showToast(`Extracting details from ${extractionTargets.length} new conversation${extractionTargets.length !== 1 ? 's' : ''}…`);
      const aiResults = await runExtractionBatch(extractionTargets);

      if (aiResults.size > 0) {
        setProspects(prev => prev.map(p => {
          const fields = aiResults.get(p.id);
          if (!fields) return p;
          // Fill only empty fields (never overwrite)
          const patch = {};
          if (!p.situation     && fields.situation)     patch.situation     = fields.situation;
          if (!p.meds          && fields.meds)          patch.meds          = fields.meds;
          if (!p.appointmentTime && toDateTimeLocal(fields.appointmentTime)) patch.appointmentTime = toDateTimeLocal(fields.appointmentTime);
          if (!p.dobs          && fields.dobs)          patch.dobs          = fields.dobs;
          if (p.indvOrFamily === 'Indv' && fields.indvOrFamily === 'Family') patch.indvOrFamily = 'Family';
          if (!p.quoteSize     && fields.quoteSize)     patch.quoteSize     = fields.quoteSize;
          return Object.keys(patch).length > 0 ? { ...p, ...patch } : p;
        }));
      }
    }

    // Summary for callers that render the outcome inline (TextDripSettings
    // card) — same text as the toast.
    return { created, updated, review: reviewItems.length, summary };
  }, [showToast]);

  // Re-entrancy guard: a sync takes ~15-60s, so an impatient second click
  // (or the header button + Settings card used together) must never start an
  // overlapping scan — that doubled wait times and confused results.
  const tdSyncBusy = useRef(false);
  const syncTextDrip = useCallback(async (syncPayload) => {
    if (tdSyncBusy.current) {
      showToast('TextDrip sync already running — hang tight');
      return { summary: 'Sync already running…' };
    }
    tdSyncBusy.current = true;
    try {
      return await syncTextDripInner(syncPayload);
    } finally {
      tdSyncBusy.current = false;
    }
  }, [syncTextDripInner, showToast]);

  // Apply TextDrip review choices (merge/skip)
  const handleTdReviewResolve = useCallback((results) => {
    const nowIso = new Date().toISOString();
    const mergeItems = results.filter(r => r.action === 'merge');
    if (mergeItems.length === 0) { setShowTdReview(false); return; }

    setProspects(prev => {
      let next = [...prev];
      for (const item of mergeItems) {
        next = next.map(p => {
          if (p.id !== item.matchedProspect.id) return p;
          return mergeConversationIntoProspect(p, item.contact, nowIso);
        });
      }
      return next;
    });
    setShowTdReview(false);
    showToast(`Applied ${mergeItems.length} merge${mergeItems.length !== 1 ? 's' : ''} from TextDrip`);
  }, [showToast]);

  // On-demand: re-run AI extraction on a prospect's stored TextDrip thread and
  // fill EMPTY fields only (situation/health/appointment/family). Lets agents
  // pull details onto already-imported prospects without deleting + re-syncing.
  const extractProspectFromTexts = useCallback(async (prospectId) => {
    const target = prospects.find(p => p.id === prospectId);
    const messages = target?.textdripChat?.messages || [];
    if (!messages.length) { showToast('No TextDrip conversation on this prospect'); return; }
    showToast('Extracting details from texts…');
    let fields = null;
    try {
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData?.session?.access_token;
      const res = await fetch('/api/textdrip/extract-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages }),
      });
      if (res.ok) {
        fields = await res.json().catch(() => null);
      } else {
        const errBody = await res.json().catch(() => ({}));
        showToast(`Extract failed (${res.status}): ${String(errBody.error || 'unknown').slice(0, 90)}`, 'error');
        return;
      }
    } catch (e) {
      showToast(`Extract error: ${String(e?.message || e).slice(0, 90)}`, 'error');
      return;
    }
    if (!fields) { showToast('Could not extract details — try again', 'error'); return; }
    // datetime-local inputs need "YYYY-MM-DDTHH:mm" — normalize whatever the AI returned.
    const appt = toDateTimeLocal(fields.appointmentTime);
    let filledAny = false;
    setProspects(prev => prev.map(p => {
      if (p.id !== prospectId) return p;
      const patch = {};
      if (!p.situation && fields.situation) patch.situation = fields.situation;
      if (!p.meds && fields.meds) patch.meds = fields.meds;
      if (!p.appointmentTime && appt) patch.appointmentTime = appt;
      if (!p.dobs && fields.dobs) patch.dobs = fields.dobs;
      if (p.indvOrFamily === 'Indv' && fields.indvOrFamily === 'Family') patch.indvOrFamily = 'Family';
      if (!p.quoteSize && fields.quoteSize) patch.quoteSize = fields.quoteSize;
      filledAny = Object.keys(patch).length > 0;
      return filledAny ? { ...p, ...patch } : p;
    }));
    showToast(filledAny ? 'Details extracted from texts ✓' : 'No new details found in the conversation');
  }, [prospects, showToast]);

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

  // Friendly labels for the confirm dialog + toast (the raw `what` keys are
  // camelCase / internal).
  const CLEAR_LABELS = {
    leads: 'Portal Clients', investments: 'weekly investments', activities: 'activities',
    chargebacks: 'chargebacks', overrides: 'overrides', ownAdvances: 'advances',
    prospects: 'prospects', platforms: 'platforms', books: 'Books (expenses + income)',
    everything: 'everything',
    income: 'advances & commissions (from statements)',
  };
  const clearAll = (what) => {
    const label = CLEAR_LABELS[what] || what;
    setConfirm({
      title: `Clear ${label}?`,
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
        // Income-side cleanup: own advances (statement commissions) +
        // overrides + Books income — for fixing a leaked/contaminated
        // account without touching leads or expenses.
        if (what === 'income') {
          setOwnAdvances([]);   await storage.removeItem(OWN_ADV_KEY);
          setOverrides([]);     await storage.removeItem(OVR_KEY);
          setBusinessIncome([]); await storage.removeItem(BI_KEY);
        }
        setConfirm(null);
        setShowSettings(false);
        showToast(`Cleared ${label}`);
      },
    });
  };

  if (!loaded) {
    // Premium boot skeleton — the app shell shimmers into place instead of
    // a blank "Loading…" flash. Pure presentation (AppSkeleton has no logic).
    return <AppSkeleton />;
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
        <div className="relative max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ rotate: -8, scale: 0.9, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
              whileHover={{ rotate: 6, scale: 1.05 }}
              className="rounded-lg shadow-lg shadow-indigo-500/30"
            >
              <PrimAppIcon size={36} />
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
        <nav className="relative max-w-screen-2xl mx-auto px-4 overflow-x-auto">
          <div className="flex gap-1 pb-2">
            {NAV_TABS.filter(t => t.id !== 'team' || teamEntitled).map(t => {
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

      {dupPairCount > 0 && (
        <div className="max-w-screen-2xl mx-auto px-4 pt-3">
          <div className="premium-card flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-accent-gradient flex items-center justify-center text-white">
                <Merge size={14} />
              </div>
              <div className="text-sm">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {dupPairCount} potential duplicate{dupPairCount === 1 ? '' : 's'} to review
                </span>
                <span className="text-slate-500 ml-2">
                  Merge import artifacts or tag a returning client.
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowDupResolver(true)}
              className="bg-accent-gradient text-white rounded-lg px-3 py-1.5 text-xs font-bold shadow-accent hover:opacity-95"
            >
              Review now
            </button>
          </div>
        </div>
      )}

      {/* Main — lazy-mount views and keep them mounted on subsequent visits.
          This preserves filter / search / sort / month-picker state across tab
          switches (was being lost when AnimatePresence unmounted views). The
          first visit to each view animates in; revisits are instant. */}
      <main className="max-w-screen-2xl mx-auto px-4 py-5">
        {/* Pending team invite — one-tap consent, visible on every tab.
            Renders nothing when there's no invite. */}
        <TeamInviteBanner showToast={showToast} />

        <ViewMount visible={view === 'team' && teamEntitled} viewKey="team">
          <TeamView showToast={showToast} />
        </ViewMount>
        <ViewMount visible={view === 'cpa'} viewKey="cpa">
          <CpaDashboard
            leads={leads} investments={investments} activities={activities}
            platformExpenses={platformExpenses}
            businessExpenses={businessExpenses}
            businessIncome={businessIncome}
            chargebacks={chargebacks}
            overrides={overrides}
            ownAdvances={ownAdvances}
            prospects={prospects}
            onOpenProspects={() => setView('prospects')}
            onDeleteChargeback={(id) => setChargebacks(prev => prev.filter(c => c.id !== id))}
            onEditInvestment={editInvestment}
            onDeleteInvestment={deleteInvestment}
            onDeleteAutoWeek={deleteAutoWeek}
            onNewInvestment={() => newInvestment()}
            onNewActivity={newActivity}
            onEditActivity={editActivity}
            onDeleteActivity={deleteActivity}
            onMarkPaymentTaken={markPaymentTaken}
            onPaymentHeadsUpSent={markPaymentHeadsUpSent}
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
            onMarkPaymentTaken={markPaymentTaken}
            onPaymentHeadsUpSent={markPaymentHeadsUpSent}
          />
        </ViewMount>
        <ViewMount visible={view === 'dashboard'} viewKey="dashboard">
          <Dashboard
            leads={leads}
            prospects={prospects}
            onOpenProspects={() => setView('prospects')}
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
          {/* Platforms is now a READ-ONLY analytics dashboard derived from
              Books. The write-side props (onAdd/onUpdate/etc.) are gone —
              all entry happens in the Books tab. The "Open Books" button
              jumps the user to that tab so they can add/edit platform
              charges in one click. */}
          <PlatformExpensesView
            expenses={platformExpensesAsView}
            onJumpToBooks={() => setView('books')}
          />
        </ViewMount>
        <ViewMount visible={view === 'blasts'} viewKey="blasts">
          <BlastsView
            blasts={[...nativeBlasts, ...blasts]}
            onDelete={(id) => {
              if (String(id).startsWith('bc:')) {
                const row = nativeBlasts.find(b => b.id === id);
                setNativeBlasts(prev => prev.filter(b => b.id !== id));
                if (row && supabaseConfigured()) {
                  supabase.from('blast_counters').delete()
                    .eq('run_date', row._native.run_date)
                    .eq('platform', row._native.platform)
                    .eq('tag', row._native.tag)
                    .then(({ error }) => {
                      // DB delete failed (RLS/expired session/network) — restore
                      // the row so the UI stays truthful instead of reappearing on reload.
                      if (error) setNativeBlasts(prev => prev.some(b => b.id === id) ? prev : [...prev, row]);
                    });
                }
              } else {
                setBlasts(prev => prev.filter(b => b.id !== id));
              }
            }}
            onAdd={(form) => setBlasts(prev => upsertBlast(prev, normalizeBlastPayload(form), new Date().toISOString()).list)}
            onEdit={(id, form) => {
              if (String(id).startsWith('bc:')) {
                // Auto-captured Ringy row → correct it in the blast_counters table.
                const row = nativeBlasts.find(b => b.id === id);
                if (!row) return;
                const contacts = parseInt(String(form.contacts).replace(/[^0-9]/g, ''), 10) || 0;
                const newTag = String(form.campaignOrTag || '').trim();
                const newNotes = String(form.notes || '');
                const newRangeStart = String(form.rangeStart || '').trim();
                const newRangeEnd = String(form.rangeEnd || '').trim();
                const optimistic = {
                  ...row, contacts, campaignOrTag: newTag, notes: newNotes,
                  rangeStart: newRangeStart, rangeEnd: newRangeEnd,
                  id: `bc:${row._native.run_date}:${row._native.platform}:${newTag}`,
                  _native: { ...row._native, tag: newTag },
                };
                setNativeBlasts(prev => prev.map(b => (b.id === id ? optimistic : b)));
                if (supabaseConfigured()) {
                  supabase.from('blast_counters')
                    .update({ contacts, tag: newTag, notes: newNotes, range_start: newRangeStart, range_end: newRangeEnd })
                    .eq('run_date', row._native.run_date)
                    .eq('platform', row._native.platform)
                    .eq('tag', row._native.tag)
                    .then(({ error }) => {
                      if (error) {
                        setNativeBlasts(prev => prev.map(b => (b.id === optimistic.id ? row : b)));
                        alert('Could not save the edit. For Ringy rows, make sure the blast-counters edit migration has been run in Supabase.');
                      }
                    });
                }
              } else {
                // Manual / skill row → update in place in blast_log_v1, preserving
                // id/createdAt/source and the one field the form doesn't expose (numbersUsed).
                setBlasts(prev => prev.map(b => {
                  if (b.id !== id) return b;
                  const n = normalizeBlastPayload({ ...form, runDate: form.runDate || b.runDate });
                  return { ...b, runDate: n.runDate, platform: n.platform, campaignOrTag: n.campaignOrTag, contacts: n.contacts, sendTime: n.sendTime, rangeStart: n.rangeStart, rangeEnd: n.rangeEnd, notes: n.notes };
                }));
              }
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
            playbook={followupPlaybook}
            onLogTouch={logProspectTouch}
            onOutreachEmailSent={logProspectOutreachEmail}
            onSnoozeProspect={snoozeProspect}
            onApplyStageSuggestion={applyStageSuggestion}
            onResolveReminder={resolveProspectReminder}
            onSyncTextDrip={syncTextDrip}
            onExtractFromTexts={extractProspectFromTexts}
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
            abDetail={abDetail}
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
        <ViewMount visible={view === 'reports'} viewKey="reports">
          <ReportsView
            leads={leads}
            overrides={overrides}
            chargebacks={chargebacks}
            businessExpenses={businessExpenses}
            abDetail={abDetail}
            businessIncome={businessIncome}
            ownAdvances={ownAdvances}
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
        </div>
        <div className="mt-2 max-w-2xl mx-auto text-[11px] text-slate-400 leading-relaxed">
          PRIM™ is an independent tool and is not affiliated with, endorsed by, or sponsored by USHEALTH Advisors (USHA). For informational purposes only — not tax, financial, or legal advice. Figures are estimates; verify against your official statements.
        </div>
      </footer>

      {/* Impersonation banner (shown only when admin is signed in as another user) */}
      <ImpersonationBanner />

      {/* What's-new announcements (top of app, dismissed per-user via cloud sync) */}
      <AnnouncementBanner onNavigate={(v) => setView(v)} />

      {/* New-deployment prompt (bottom bar, appears when this tab is on a stale build) */}
      <UpdateBanner />

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
      <DuplicateResolver
        open={showDupResolver}
        onClose={() => setShowDupResolver(false)}
        leads={leads}
        onMerge={handleDupMerge}
        onTagRepeated={handleDupTagRepeated}
        onDismissPair={handleDupDismiss}
      />
      <TextDripReviewModal
        open={showTdReview}
        items={tdReviewItems}
        onResolve={handleTdReviewResolve}
        onClose={() => setShowTdReview(false)}
      />
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

            <div className="mb-4">
              <div className="text-sm font-bold text-slate-900 mb-2">Uploaded statements</div>
              <StatementManager
                ownAdvances={ownAdvances}
                overrides={overrides}
                chargebacks={chargebacks}
                businessIncome={businessIncome}
                onDeleteRange={deleteStatementRange}
                onDeleteWeek={deleteStatementWeek}
                onDeleteMonth={deleteStatementMonth}
                onDeleteRow={deleteStatementRow}
              />
            </div>

            <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">DATA</div>
            <div className="space-y-2">
              <button onClick={() => clearAll('leads')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear Portal Clients</button>
              <button onClick={() => clearAll('prospects')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear prospects</button>
              <button onClick={() => clearAll('books')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear Books (expenses + income)</button>
              <button onClick={() => clearAll('income')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear advances &amp; commissions (from statements)</button>
              <button onClick={() => clearAll('chargebacks')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear chargebacks</button>
              <button onClick={() => clearAll('overrides')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear overrides</button>
              <button onClick={() => clearAll('activities')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear activities</button>
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

      {/* First-run onboarding — the must-finish, interactive teach flow.
          Auto-launches once per brand-new agent (same first-run gate as
          before) and is replayable from Settings. Step 1 persists
          theme / accent / display name to the real agent profile. The
          tour, Platforms, and Smart Import panels are a scripted sample. */}
      <OnboardingFlow
        open={showFirstRunWizard}
        onComplete={async () => {
          try {
            const { markCompleted } = await import('@/lib/onboarding');
            await markCompleted();
            setOnboardingCompletedFlag(true);
          } catch { /* ignore */ }
          setShowFirstRunWizard(false);
        }}
        onSkip={async () => {
          try {
            const { markSkipped } = await import('@/lib/onboarding');
            await markSkipped();
          } catch { /* ignore */ }
          setShowFirstRunWizard(false);
        }}
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
