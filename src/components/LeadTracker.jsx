'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calculator, Repeat, CheckSquare, LayoutDashboard, Users, Columns, Upload, Settings, Sparkles, DollarSign, BookOpen, LogOut,
} from 'lucide-react';
import { storage, onStorageError } from '@/lib/storage';
import { deleteAttachment as deleteAttachmentFromIdb } from '@/lib/attachments';
import { mkLead, migrateLead, SEED_LEADS, SEED_INVESTMENTS, SEED_ACTIVITIES } from '@/lib/seed';
import { today, uid, getWeekStart } from '@/lib/utils';
import { isPricedAssociation, NAV_TABS } from '@/lib/constants';
import { TIERS, DEFAULT_ADVANCE_MONTHS, getAdvanceMonthsForDate, currentAdvanceMonths } from '@/lib/commission';

import CpaDashboard from './views/CpaDashboard';
import AssociationsView from './views/AssociationsView';
import ClosedDeals from './views/ClosedDeals';
import Dashboard from './views/Dashboard';
import LeadsView from './views/LeadsView';
import Pipeline from './views/Pipeline';
import UploadView from './views/UploadView';
import PlatformExpensesView from './views/PlatformExpensesView';
import BusinessBooksView from './views/BusinessBooksView';
import LeadForm from './LeadForm';
import InvestmentForm from './InvestmentForm';
import ActivityForm from './ActivityForm';
import ConfirmDialog from './ConfirmDialog';
import Toast from './Toast';
import AdvanceMonthsHistoryEditor from './AdvanceMonthsHistoryEditor';
import { fireConfetti, FadeIn, OrbBackdrop } from './motion/MotionPrimitives';
import { useAuth } from './auth/AuthProvider';
import { motion } from 'framer-motion';

const ICONS = { Calculator, Repeat, CheckSquare, LayoutDashboard, Users, Columns, Upload, DollarSign, BookOpen };

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

// User menu — shows current email + sign-out button. Lives in the header.
function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-slate-600 hover:text-slate-900 p-2 rounded-lg hover:bg-slate-100 transition text-sm"
        title={user.email}
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">
          {(user.email || '?').slice(0, 1).toUpperCase()}
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="text-xs text-slate-500">Signed in as</div>
              <div className="text-sm font-semibold text-slate-900 truncate">{user.email}</div>
            </div>
            <button
              onClick={() => { setOpen(false); signOut(); }}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
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
function ViewMount({ visible, viewKey, children }) {
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  useEffect(() => { if (visible && !hasBeenVisible) setHasBeenVisible(true); }, [visible, hasBeenVisible]);
  if (!hasBeenVisible) return null;
  return (
    <motion.div
      key={viewKey}
      style={{ display: visible ? 'block' : 'none' }}
      // Animate only on first reveal — once mounted, just toggle visibility
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export default function LeadTracker() {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('cpa');
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
  const [tier, setTier] = useState('WA');
  const [toast, setToast] = useState(null);
  const [lastImportBatch, setLastImportBatch] = useState(null);

  // modals
  const [leadForm, setLeadForm] = useState(null);    // lead obj or null
  const [invForm, setInvForm] = useState(null);
  const [actForm, setActForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

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

      const cbRaw = await storage.getItem(CB_KEY);
      setChargebacks(cbRaw ? JSON.parse(cbRaw) : []);

      const ovrRaw = await storage.getItem(OVR_KEY);
      setOverrides(ovrRaw ? JSON.parse(ovrRaw) : []);

      const oaRaw = await storage.getItem(OWN_ADV_KEY);
      setOwnAdvances(oaRaw ? JSON.parse(oaRaw) : []);

      const amRaw = await storage.getItem(AM_KEY);
      setAdvanceMonthsHistory(amRaw ? JSON.parse(amRaw) : []);

      const peRaw = await storage.getItem(PE_KEY);
      setPlatformExpenses(peRaw ? JSON.parse(peRaw) : []);

      const beRaw = await storage.getItem(BE_KEY);
      setBusinessExpenses(beRaw ? JSON.parse(beRaw) : []);
      const biRaw = await storage.getItem(BI_KEY);
      setBusinessIncome(biRaw ? JSON.parse(biRaw) : []);

      setLoaded(true);
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
    } else {
      setLeads(prev => [clean, ...prev]);
      showToast('Lead added');
      if (clean.stage === 'Issued') fireConfetti();
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
  const importLeads = useCallback((newLeads, { batchId, stats } = {}) => {
    if (!newLeads || newLeads.length === 0) return;
    setLeads(prev => [...newLeads, ...prev]);
    setLastImportBatch({
      batchId,
      count: newLeads.length,
      at: new Date().toISOString(),
      stats,
    });
    showToast(`Imported ${newLeads.length} leads`);
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
      const seenExisting = new Set(businessIncome.map(i => `${i.source || ''}|${Number(i.amount).toFixed(2)}|${i.date || ''}`));
      const incomingSeen = new Set();
      const candidates = bonusRows
        .filter(b => Number.isFinite(b.amount) && b.amount > 0)
        .map(b => {
          const periodIso = toIso(b.transactionDate || b._statementPeriod || fallbackPeriod);
          const incomeCategory = b.type === 'RENEWAL_BONUS' ? 'RENEWAL' : 'BONUS';
          const noteParts = [`Auto-imported from statement (${b.type || 'BONUS'})`];
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
          const k = `${e.source}|${Number(e.amount).toFixed(2)}|${e.date}`;
          if (seenExisting.has(k) || incomingSeen.has(k)) return false;
          incomingSeen.add(k);
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

  // Retroactively apply the Advance Months History to all existing leads,
  // using each lead's closedDate to pick the right historical value.
  const applyAdvanceMonthsHistory = () => {
    if (leads.length === 0 || advanceMonthsHistory.length === 0) return;
    setConfirm({
      title: 'Apply history to all existing leads?',
      message: `Every lead's Advance Months will be set to whatever value was active on its close date. Leads without a close date will be left alone. Overrides you made manually on specific leads WILL be overwritten.`,
      onConfirm: () => {
        let changed = 0;
        setLeads(prev => prev.map(l => {
          if (!l.closedDate) return l;
          const active = getAdvanceMonthsForDate(advanceMonthsHistory, l.closedDate, DEFAULT_ADVANCE_MONTHS);
          if (Math.abs((l.advanceMonths || 0) - active) < 0.001) return l;
          changed += 1;
          return { ...l, advanceMonths: active, lastTouch: today() };
        }));
        setConfirm(null);
        setShowSettings(false);
        // small delay so toast appears after modal closes
        setTimeout(() => showToast(`Updated advance months on ${changed} lead${changed !== 1 ? 's' : ''}`), 50);
      },
    });
  };

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
    setLeads(prev => prev.map(l => {
      if (!idSet.has(l.id)) return l;
      const patch = { stage: newStage, lastTouch: today() };
      // Stamp closedDate + (retroactive) association start for any post-close stage
      if (newStage === 'Pending' || newStage === 'Issued') {
        if (!l.closedDate) patch.closedDate = today();
        if (l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = patch.closedDate || today();
        }
      }
      return { ...l, ...patch };
    }));
    showToast(`${ids.length} lead${ids.length !== 1 ? 's' : ''} moved to ${newStage}`);
  }, [showToast]);

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
      return { ...l, ...patch };
    }));
    showToast(`Moved to ${newStage}`);
    if (wasNotIssued) fireConfetti();
  }, [showToast]);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 relative">
      <OrbBackdrop />
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
              className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30"
            >
              <Sparkles size={18} />
            </motion.div>
            <div>
              <h1 className="font-bold text-slate-900 leading-none tracking-tight">PRIM</h1>
              <div className="text-xs text-slate-500">Performance · Revenue · Investment</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <UserMenu />
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
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
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
          />
        </ViewMount>
        <ViewMount visible={view === 'closed'} viewKey="closed">
          <ClosedDeals leads={leads} onEdit={editLead} />
        </ViewMount>
        <ViewMount visible={view === 'dashboard'} viewKey="dashboard">
          <Dashboard leads={leads} />
        </ViewMount>
        <ViewMount visible={view === 'leads'} viewKey="leads">
          <LeadsView leads={leads} onNew={newLead} onEdit={editLead} onDelete={deleteLead} onBulkDelete={bulkDeleteLeads} onBulkStage={bulkStageChange} />
        </ViewMount>
        <ViewMount visible={view === 'pipeline'} viewKey="pipeline">
          <Pipeline leads={leads} onStageChange={changeStage} onEdit={editLead} />
        </ViewMount>
        <ViewMount visible={view === 'platforms'} viewKey="platforms">
          <PlatformExpensesView
            expenses={platformExpenses}
            onAdd={(e) => { setPlatformExpenses(prev => [e, ...prev]); showToast('Entry added'); }}
            onBulkAdd={(rows) => {
              if (!rows?.length) return;
              setPlatformExpenses(prev => [...rows, ...prev]);
              showToast(`Imported ${rows.length} expense${rows.length !== 1 ? 's' : ''}`);
            }}
            onUpdate={(e) => setPlatformExpenses(prev => prev.map(x => x.id === e.id ? e : x))}
            onDelete={(id) => setPlatformExpenses(prev => prev.filter(x => x.id !== id))}
          />
        </ViewMount>
        <ViewMount visible={view === 'books'} viewKey="books">
          <BusinessBooksView
            expenses={businessExpenses}
            income={businessIncome}
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

            {/* My Tier */}
            <div className="mb-5 pb-5 border-b border-slate-200">
              <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">MY CONTRACT TIER</div>
              <div className="grid grid-cols-4 gap-2">
                {TIERS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setTier(t.id); showToast(`Tier set to ${t.id}`); }}
                    className={`rounded-lg py-2 text-sm font-semibold transition border ${tier === t.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                    title={t.label}
                  >
                    {t.id}
                  </button>
                ))}
              </div>
              <div className="text-xs text-slate-500 mt-2">{TIERS.find(t => t.id === tier)?.label} — this drives commission projections on new and existing leads.</div>
            </div>

            {/* Advance Months History */}
            <div className="mb-5 pb-5 border-b border-slate-200">
              <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">ADVANCE MONTHS HISTORY</div>
              <p className="text-xs text-slate-500 mb-3">
                Your advance pay months changes through the year based on taken rate. Log each change here — new leads auto-use the value active on their close date.
              </p>
              <AdvanceMonthsHistoryEditor
                history={advanceMonthsHistory}
                onChange={setAdvanceMonthsHistory}
                onApplyToExistingLeads={applyAdvanceMonthsHistory}
                existingLeadCount={leads.length}
              />
            </div>

            <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">DATA</div>
            <div className="space-y-2">
              <button onClick={() => clearAll('activities')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear activities</button>
              <button onClick={() => clearAll('investments')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear investments</button>
              <button onClick={() => clearAll('platforms')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear platform expenses</button>
              <button onClick={() => clearAll('books')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear business books</button>
              <button onClick={() => clearAll('chargebacks')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear chargebacks</button>
              <button onClick={() => clearAll('overrides')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear overrides</button>
              <button onClick={() => clearAll('leads')} className="w-full text-left border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Clear leads</button>
              <button onClick={() => clearAll('everything')} className="w-full text-left bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm hover:bg-red-100 font-medium">Clear everything</button>
            </div>
          </motion.div>
        </motion.div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
