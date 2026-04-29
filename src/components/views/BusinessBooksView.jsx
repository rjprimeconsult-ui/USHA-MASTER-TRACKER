'use client';
import { useMemo, useRef, useState, useEffect, memo } from 'react';
import {
  Plus, Trash2, DollarSign, TrendingUp, TrendingDown, AlertCircle, Calendar,
  Upload, X, Check, Paperclip, Eye, ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle, Wallet, Tag, Settings, Sparkles,
} from 'lucide-react';
import { fmt, fmt2, today, uid } from '@/lib/utils';
import { parseBusinessFile, dedupEntries, classifyExpense } from '@/lib/businessImport';
import { storage } from '@/lib/storage';
import { compressIfImage } from '@/lib/imageCompress';
import { saveAttachment, getAttachment, deleteAttachment } from '@/lib/attachments';
import { useCategoriesAll } from '@/lib/customCategories';
import { vendorMemoryToHints, loadVendorMemory } from '@/lib/vendorMemory';
import { loadUserRubric } from '@/lib/userRubric';
import { TiltCard, CountUp, Stagger, StaggerItem, MoneyCell } from '../motion/MotionPrimitives';
import SmartImportWizard from '../SmartImportWizard';
import CustomCategoryManager from '../CustomCategoryManager';
import AgentSettingsPanel from '../AgentSettingsPanel';

const ACCOUNTS_KEY = 'business_accounts_v1';

const ymOf = (date) => (date || '').slice(0, 7);
const ymLabel = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};

// Pre-compress: images are downscaled + JPEG-recompressed before storing in
// IndexedDB. Cuts a 2MB phone photo to ~150KB without losing receipt
// readability. PDFs pass through unchanged.
//
// The Blob lives in IndexedDB; the entry only stores a lightweight reference
// { id, name, type, sizeBytes }. This keeps localStorage tiny no matter how
// many receipts you attach.
const processAttachment = async (file) => {
  const MAX_INCOMING_BYTES = 12 * 1024 * 1024;
  if (file.size > MAX_INCOMING_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 12MB.`);
  }
  const compressed = await compressIfImage(file);
  // Save to IndexedDB and return only the reference
  const ref = await saveAttachment({
    name: compressed.name,
    type: compressed.type,
    dataUrl: compressed.dataUrl,
  });
  return ref; // { id, name, type, sizeBytes }
};

// Lazy-load attachment dataUrl from IndexedDB when the user clicks to view it.
const loadAttachmentForView = async (attachment) => {
  if (!attachment) return null;
  // Backward compat: old entries stored the dataUrl inline
  if (attachment.dataUrl) return attachment;
  if (!attachment.id) return null;
  const stored = await getAttachment(attachment.id);
  if (!stored) return { ...attachment, missing: true };
  return { ...attachment, dataUrl: stored.dataUrl };
};

function BusinessBooksView({
  expenses, income,
  leads = [], overrides = [], ownAdvances = [],
  onAddExpense, onUpdateExpense, onDeleteExpense, onBulkAddExpenses,
  onAddIncome,  onUpdateIncome,  onDeleteIncome,  onBulkAddIncome,
  onBulkAddPlatforms,
}) {
  const [tab, setTab] = useState('expenses'); // 'expenses' | 'income'
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [viewAttachment, setViewAttachment] = useState(null);
  const [rescanPreview, setRescanPreview] = useState(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiRescanning, setAiRescanning] = useState(false);
  const [aiRescanPreview, setAiRescanPreview] = useState(null); // [{ id, vendor, amount, from, to, picked, confidence, reason }]

  // Merged categories (built-in + user customs). Reloads automatically when
  // the manager modal saves changes.
  const { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES, customMap, reload: reloadCustomCats } = useCategoriesAll();
  const expCat = (id) => EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  const incCat = (id) => INCOME_CATEGORIES.find(c => c.id === id) || INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1];

  // Re-scan all current expense entries through the auto-classifier and find
  // any whose category should change based on the new keyword rules
  // (e.g. "LEADS MARKETPLACE" should be LEAD_INVESTMENT, not MARKETING).
  const runRecategorize = () => {
    const proposals = [];
    for (const e of expenses) {
      const text = `${e.vendor || ''} ${e.notes || ''}`.trim();
      if (!text) continue;
      const suggested = classifyExpense(text);
      if (suggested && suggested !== e.category && suggested !== 'OTHER_EXPENSE') {
        proposals.push({ id: e.id, vendor: e.vendor, amount: e.amount, from: e.category, to: suggested, picked: true });
      }
    }
    setRescanPreview(proposals);
  };
  const togglePick = (id) => {
    setRescanPreview(p => p?.map(x => x.id === id ? { ...x, picked: !x.picked } : x));
  };
  const applyRescan = () => {
    if (!rescanPreview) return;
    const picked = rescanPreview.filter(p => p.picked);
    for (const p of picked) {
      const original = expenses.find(e => e.id === p.id);
      if (original) onUpdateExpense({ ...original, category: p.to });
    }
    setRescanPreview(null);
  };

  // Per-category usage counts for the manager modal — used to warn before
  // delete and to migrate affected rows.
  const expenseUsage = useMemo(() => {
    const m = {};
    for (const e of expenses) m[e.category] = (m[e.category] || 0) + 1;
    return m;
  }, [expenses]);
  const incomeUsage = useMemo(() => {
    const m = {};
    for (const e of income) m[e.category] = (m[e.category] || 0) + 1;
    return m;
  }, [income]);

  // AI bulk re-categorization — sends current rows to /api/recategorize-ai
  // and returns suggested fixes. User reviews and applies selectively.
  const runAiRescan = async () => {
    if (expenses.length === 0 || aiRescanning) return;
    setAiRescanning(true);
    try {
      const [vm, urubric] = await Promise.all([loadVendorMemory(), loadUserRubric()]);
      const vendorHints = vendorMemoryToHints(vm, 60);
      const customCats = [
        ...(customMap.expense || []).map(c => ({ id: c.id, label: c.label, direction: 'expense' })),
        ...(customMap.income  || []).map(c => ({ id: c.id, label: c.label, direction: 'income' })),
      ];
      // Process up to 500 rows (route caps at 500). For bigger backlogs the
      // user can re-run after applying a batch.
      const rows = expenses.slice(0, 500).map(e => ({
        id: e.id,
        vendor: e.vendor || '',
        amount: Number(e.amount) || 0,
        currentDirection: 'expense',
        currentCategory: e.category || 'OTHER_EXPENSE',
      }));
      const res = await fetch('/api/recategorize-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, vendorHints, customCategories: customCats, userRubric: urubric?.expense || '' }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Build the preview — only rows where AI proposed a change
      const proposals = (data.suggestions || []).reduce((acc, s) => {
        const original = expenses.find(e => e.id === s.id);
        if (!original) return acc;
        const proposedCat = s.suggestedCategory;
        if (!proposedCat || proposedCat === original.category) return acc;
        acc.push({
          id: original.id,
          vendor: original.vendor,
          amount: original.amount,
          from: original.category,
          to: proposedCat,
          confidence: s.confidence || 'medium',
          reason: s.reason || '',
          picked: s.confidence !== 'low', // pre-pick high+medium, leave low unchecked
        });
        return acc;
      }, []);
      setAiRescanPreview(proposals);
    } catch (e) {
      alert(`AI re-scan failed: ${e.message || e}`);
    } finally {
      setAiRescanning(false);
    }
  };
  const togglePickAi = (id) => {
    setAiRescanPreview(p => p?.map(x => x.id === id ? { ...x, picked: !x.picked } : x));
  };
  const applyAiRescan = () => {
    if (!aiRescanPreview) return;
    const picked = aiRescanPreview.filter(p => p.picked);
    for (const p of picked) {
      const original = expenses.find(e => e.id === p.id);
      if (original) onUpdateExpense({ ...original, category: p.to });
    }
    setAiRescanPreview(null);
  };

  // When a custom category is deleted with rows still tagged to it, re-tag
  // those rows to the catch-all (OTHER_EXPENSE / OTHER_INCOME).
  const migrateCategoryUsage = (deletedId, fallbackId) => {
    if (tab === 'expenses' || expenseUsage[deletedId]) {
      for (const e of expenses) {
        if (e.category === deletedId) onUpdateExpense({ ...e, category: fallbackId });
      }
    }
    if (tab === 'income' || incomeUsage[deletedId]) {
      for (const e of income) {
        if (e.category === deletedId) onUpdateIncome({ ...e, category: fallbackId });
      }
    }
  };

  // Known account names — auto-grown from imports + manual entries
  const [knownAccounts, setKnownAccounts] = useState([]);
  useEffect(() => {
    let alive = true;
    storage.getItem(ACCOUNTS_KEY).then(v => {
      if (alive && v) {
        try { setKnownAccounts(JSON.parse(v)); } catch {}
      }
    });
    return () => { alive = false; };
  }, []);

  // Merge any account names found in existing entries into the known list
  useEffect(() => {
    const fromEntries = new Set([...expenses, ...income].map(e => e.account).filter(Boolean));
    if (fromEntries.size === 0) return;
    setKnownAccounts(prev => {
      const merged = Array.from(new Set([...prev, ...fromEntries])).sort();
      if (merged.length !== prev.length || merged.some((v, i) => v !== prev[i])) {
        storage.setItem(ACCOUNTS_KEY, JSON.stringify(merged));
        return merged;
      }
      return prev;
    });
  }, [expenses, income]);

  const addAccount = (name) => {
    const n = String(name || '').trim();
    if (!n) return;
    setKnownAccounts(prev => {
      if (prev.includes(n)) return prev;
      const next = [...prev, n].sort();
      storage.setItem(ACCOUNTS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // ---------- Time scope ----------
  const allMonths = useMemo(() => {
    const set = new Set([...expenses, ...income].map(e => ymOf(e.date)).filter(Boolean));
    set.add(ymOf(today()));
    return Array.from(set).sort().reverse();
  }, [expenses, income]);

  const [activeMonth, setActiveMonth] = useState(allMonths[0] || ymOf(today()));

  // ---------- Stats ----------
  const yr = activeMonth.slice(0, 4);
  const yrExpenses = useMemo(() => expenses.filter(e => (e.date || '').startsWith(yr)), [expenses, yr]);
  const yrIncome   = useMemo(() => income.filter(e => (e.date || '').startsWith(yr)), [income, yr]);

  const ytdExpenses = yrExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const ytdBooksIncome = yrIncome.reduce((s, e) => s + Number(e.amount || 0), 0);

  // Commission income for the year — sum statement-derived own advances +
  // overrides for the year. Falls back to leads' dealValue (issued in YR) when
  // there are no ownAdvances entries (e.g., statements not yet imported).
  const inYear = (iso) => String(iso || '').startsWith(yr);
  const ytdOwnFromStmts = useMemo(
    () => ownAdvances.filter(a => inYear(a.period)).reduce((s, a) => s + Number(a.amount || 0), 0),
    [ownAdvances, yr]
  );
  const ytdOwnFromLeads = useMemo(
    () => leads.filter(l => l.stage === 'Issued' && inYear(l.closedDate)).reduce((s, l) => s + Number(l.dealValue || 0), 0),
    [leads, yr]
  );
  const ytdOwnCommissions = ytdOwnFromStmts > 0 ? ytdOwnFromStmts : ytdOwnFromLeads;
  const ytdOverrideIncome = useMemo(
    () => overrides.filter(o => inYear(o.period)).reduce((s, o) => s + Number(o.amount || 0), 0),
    [overrides, yr]
  );
  const ytdCommissions = ytdOwnCommissions + ytdOverrideIncome;

  // Total YTD income shown on the dashboard card = books income + commissions.
  const ytdIncome   = ytdBooksIncome + ytdCommissions;
  // True YTD Net = all income (commissions + books) − all expenses.
  const ytdNet      = ytdIncome - ytdExpenses;

  // Filters for the daily entries table — per-tab so switching keeps each one
  const [filterCategory, setFilterCategory] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const clearFilters = () => { setFilterCategory(''); setFilterVendor(''); setFilterAccount(''); };
  const hasFilters = filterCategory || filterVendor || filterAccount;

  // Apply filters on top of the month filter
  const applyFilters = (rows, vendorKey) => {
    return rows.filter(e => {
      if (filterCategory && e.category !== filterCategory) return false;
      if (filterAccount && (e.account || '') !== filterAccount) return false;
      if (filterVendor) {
        const needle = filterVendor.toLowerCase();
        const hay = `${e[vendorKey] || ''} ${e.notes || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  };

  const monthExpenses = useMemo(
    () => applyFilters(
      expenses.filter(e => ymOf(e.date) === activeMonth).sort((a, b) => a.date.localeCompare(b.date)),
      'vendor'
    ),
    [expenses, activeMonth, filterCategory, filterVendor, filterAccount]
  );
  const monthIncome = useMemo(
    () => applyFilters(
      income.filter(e => ymOf(e.date) === activeMonth).sort((a, b) => a.date.localeCompare(b.date)),
      'source'
    ),
    [income, activeMonth, filterCategory, filterVendor, filterAccount]
  );
  const monthExpTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const monthIncTotal = monthIncome.reduce((s, e) => s + Number(e.amount || 0), 0);

  // Per-category breakdown for active month (current tab)
  const monthByCategory = useMemo(() => {
    const list = tab === 'expenses' ? monthExpenses : monthIncome;
    const cats = tab === 'expenses' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const out = {};
    cats.forEach(c => { out[c.id] = 0; });
    list.forEach(e => {
      out[e.category] = (out[e.category] || 0) + Number(e.amount || 0);
    });
    return out;
  }, [tab, monthExpenses, monthIncome]);

  // ---------- Quick add form ----------
  const [draft, setDraft] = useState({
    date: today(),
    category: 'OFFICE',
    amount: '',
    vendor: '',
    notes: '',
    account: '',
    attachment: null,
  });

  const submitDraft = () => {
    const amt = Number(draft.amount || 0);
    if (!draft.date || amt <= 0) return;
    const base = {
      id: uid(),
      date: draft.date,
      category: draft.category,
      amount: amt,
      notes: draft.notes || '',
      account: draft.account || '',
      paymentMethod: null,
      attachment: draft.attachment || null,
    };
    if (tab === 'expenses') {
      onAddExpense({ ...base, vendor: draft.vendor || '' });
    } else {
      onAddIncome({ ...base, source: draft.vendor || '' });
    }
    if (draft.account) addAccount(draft.account);
    setDraft(d => ({ ...d, amount: '', vendor: '', notes: '', attachment: null }));
  };

  // When tab flips, reset category default to a valid one for that tab
  const flipTab = (t) => {
    setTab(t);
    setDraft(d => ({
      ...d,
      category: t === 'expenses' ? 'OFFICE' : 'BONUS',
      vendor: '',
    }));
  };

  // ---------- Attachment handling ----------
  const attachmentInputRef = useRef(null);
  const handleAttachmentSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const attachment = await processAttachment(file);
      setDraft(d => ({ ...d, attachment }));
    } catch (err) {
      alert(err.message || String(err));
    }
    e.target.value = '';
  };

  // ---------- Bank statement upload ----------
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const { format, expenses: parsedExp, income: parsedInc, detectedAccount } = await parseBusinessFile(file);
      if (format === 'unknown' || format === 'empty') {
        setImportPreview({ error: `Couldn't recognize this file. Expected either a bank/credit-card export (Date / Description / Amount columns) or an agent expense sheet (Month / Date / Item / Cost / Description / Purpose / Card paid with columns).` });
      } else if (parsedExp.length === 0 && parsedInc.length === 0) {
        setImportPreview({ error: 'Read the file but found 0 transactions to import.' });
      } else {
        // For bank statements: stamp every row with the detected account up-front.
        // For Don Julio sheets: each row already has its own account from "Card paid with",
        //   so we leave them alone (mixed-card imports are normal).
        const initialAccount = detectedAccount || '';
        const isMultiAccount = format === 'donjulio';
        const stampAccount = (rows) => rows.map(r =>
          isMultiAccount ? r : { ...r, account: r.account || initialAccount }
        );
        const expWithAcct = stampAccount(parsedExp);
        const incWithAcct = stampAccount(parsedInc);
        const expDup = dedupEntries(expWithAcct, expenses, 'vendor');
        const incDup = dedupEntries(incWithAcct, income, 'source');
        const selected = new Set([...expDup.fresh.map(e => e.id), ...incDup.fresh.map(e => e.id)]);
        setImportPreview({
          format,
          fileName: file.name,
          account: initialAccount,
          detectedAccount,
          isMultiAccount,
          expFresh: expDup.fresh, expDup: expDup.duplicate,
          incFresh: incDup.fresh, incDup: incDup.duplicate,
          selected,
        });
      }
    } catch (err) {
      setImportPreview({ error: `Failed to read file: ${err.message || err}` });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Apply a new account name to all rows in the preview (global picker)
  const setPreviewAccount = (name) => {
    setImportPreview(p => {
      if (!p) return p;
      return {
        ...p,
        account: name,
        expFresh: p.expFresh.map(e => ({ ...e, account: name })),
        incFresh: p.incFresh.map(e => ({ ...e, account: name })),
      };
    });
  };

  const togglePreviewRow = (id) => {
    setImportPreview(p => {
      if (!p?.selected) return p;
      const next = new Set(p.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...p, selected: next };
    });
  };

  const updatePreviewExp = (id, patch) => {
    setImportPreview(p => p ? { ...p, expFresh: p.expFresh.map(e => e.id === id ? { ...e, ...patch } : e) } : p);
  };
  const updatePreviewInc = (id, patch) => {
    setImportPreview(p => p ? { ...p, incFresh: p.incFresh.map(e => e.id === id ? { ...e, ...patch } : e) } : p);
  };

  const commitImport = () => {
    if (!importPreview) return;
    const expToAdd = importPreview.expFresh
      .filter(e => importPreview.selected.has(e.id))
      .map(({ _source, ...e }) => e);
    const incToAdd = importPreview.incFresh
      .filter(e => importPreview.selected.has(e.id))
      .map(({ _source, ...e }) => e);
    if (expToAdd.length) onBulkAddExpenses(expToAdd);
    if (incToAdd.length) onBulkAddIncome(incToAdd);
    // Save the chosen account name so future imports remember it
    if (importPreview.account) addAccount(importPreview.account);
    // Jump to most-recent imported month
    const all = [...expToAdd, ...incToAdd];
    if (all.length) {
      const newest = all.reduce((max, e) => e.date > max ? e.date : max, '');
      if (newest) setActiveMonth(newest.slice(0, 7));
    }
    setImportPreview(null);
  };

  const list = tab === 'expenses' ? monthExpenses : monthIncome;
  const onUpdate = tab === 'expenses' ? onUpdateExpense : onUpdateIncome;
  const onDelete = tab === 'expenses' ? onDeleteExpense : onDeleteIncome;
  const cats = tab === 'expenses' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const vendorKey = tab === 'expenses' ? 'vendor' : 'source';
  const monthTotal = tab === 'expenses' ? monthExpTotal : monthIncTotal;

  return (
    <div className="space-y-5">
      {/* Top stat strip — YTD income, YTD expenses, True Net, Active month */}
      <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StaggerItem>
          <TiltCard className="bg-white rounded-xl border border-slate-200 p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center gap-2">
              <ArrowUpCircle size={16} className="text-emerald-600" />
              <div className="text-xs font-bold text-slate-500 tracking-wider">YTD INCOME</div>
            </div>
            <div className="mt-2 text-lg font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>
              <CountUp value={ytdIncome} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />
            </div>
            <div className="text-[11px] text-slate-500">
              {ytdCommissions > 0
                ? `${fmt2(ytdCommissions)} commissions + ${fmt2(ytdBooksIncome)} other`
                : 'all income for the year'}
            </div>
          </TiltCard>
        </StaggerItem>
        <StaggerItem>
          <TiltCard className="bg-white rounded-xl border border-slate-200 p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center gap-2">
              <ArrowDownCircle size={16} className="text-red-500" />
              <div className="text-xs font-bold text-slate-500 tracking-wider">YTD EXPENSES</div>
            </div>
            <div className="mt-2 text-lg font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>
              <CountUp value={ytdExpenses} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />
            </div>
            <div className="text-[11px] text-slate-500">deductible business out</div>
          </TiltCard>
        </StaggerItem>
        <StaggerItem>
          <TiltCard className="bg-white rounded-xl border border-slate-200 p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center gap-2">
              <Wallet size={16} className={ytdNet >= 0 ? 'text-emerald-600' : 'text-red-500'} />
              <div className="text-xs font-bold text-slate-500 tracking-wider">NET (YTD)</div>
            </div>
            <div className="mt-2 text-lg font-bold" style={{ color: ytdNet >= 0 ? '#10b981' : '#ef4444', transform: 'translateZ(10px)' }}>
              {ytdNet >= 0
                ? <CountUp value={ytdNet} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />
                : <>−<CountUp value={Math.abs(ytdNet)} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} /></>}
            </div>
            <div className="text-[11px] text-slate-500">all income − all expenses</div>
          </TiltCard>
        </StaggerItem>
        <StaggerItem>
          <TiltCard className="bg-white rounded-xl border border-slate-200 p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-amber-600" />
              <div className="text-xs font-bold text-slate-500 tracking-wider">{ymLabel(activeMonth)}</div>
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-sm" style={{ transform: 'translateZ(10px)' }}>
              <span className="font-bold text-emerald-600">+{fmt2(monthIncTotal)}</span>
              <span className="text-slate-300">·</span>
              <span className="font-bold text-red-500">−{fmt2(monthExpTotal)}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">in vs out this month</div>
          </TiltCard>
        </StaggerItem>
      </Stagger>

      {/* Upload from file */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Upload size={18} />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Upload bank statement OR existing expense sheet</div>
              <div className="text-xs text-slate-600">
                Works with: bank/credit-card CSV exports (Date / Description / Amount) AND the agent expense sheet format (Month / Date / Item / Cost / Description / Purpose / Card paid with). Auto-classifies and pre-fills accounts.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSmartImport(true)}
              className="bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2 shadow-md shadow-indigo-500/30"
              title="Drop any expense file (XLSX, CSV, or PDF) — AI parses + categorizes everything"
            >
              ✨ Smart Import (AI)
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2"
            >
              <Upload size={14} />
              {importing ? 'Reading…' : 'Classic Import'}
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} className="hidden" />
        </div>
      </div>

      {/* Smart import (AI-powered) modal */}
      <SmartImportWizard
        open={showSmartImport}
        onClose={() => setShowSmartImport(false)}
        defaultAccount={knownAccounts[0] || ''}
        onImport={({ expenses, income, platforms }) => {
          if (expenses.length) onBulkAddExpenses(expenses);
          if (income.length) onBulkAddIncome(income);
          if (platforms?.length && onBulkAddPlatforms) onBulkAddPlatforms(platforms);
          const all = [...(expenses || []), ...(income || []), ...(platforms || [])];
          if (all.length > 0) {
            const newest = all.reduce((max, e) => e.date > max ? e.date : max, '');
            if (newest) setActiveMonth(newest.slice(0, 7));
          }
        }}
      />

      {/* Manage custom categories modal */}
      <CustomCategoryManager
        open={showCategoryManager}
        onClose={() => setShowCategoryManager(false)}
        direction={tab === 'expenses' ? 'expense' : 'income'}
        usageCounts={tab === 'expenses' ? expenseUsage : incomeUsage}
        onMigrate={migrateCategoryUsage}
        onChanged={() => reloadCustomCats()}
      />

      {/* Agent settings panel */}
      <AgentSettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* AI re-scan preview modal */}
      {aiRescanPreview && (
        <AiRescanPreview
          proposals={aiRescanPreview}
          onTogglePick={togglePickAi}
          onApply={applyAiRescan}
          onClose={() => setAiRescanPreview(null)}
          expCat={expCat}
        />
      )}

      {/* Tab toggle + utilities row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="bg-white rounded-xl border border-slate-200 p-1 inline-flex">
          <button
            onClick={() => flipTab('expenses')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${tab === 'expenses' ? 'bg-red-500 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <ArrowDownCircle size={14} className="inline mr-1.5 -mt-0.5" />
            Expenses ({expenses.length})
          </button>
          <button
            onClick={() => flipTab('income')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${tab === 'income' ? 'bg-emerald-500 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <ArrowUpCircle size={14} className="inline mr-1.5 -mt-0.5" />
            Other Income ({income.length})
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === 'expenses' && expenses.length > 0 && (
            <>
              <button
                onClick={runRecategorize}
                className="text-xs text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline"
                title="Re-scan vendor names against keyword rules and propose category fixes (deterministic — fast and free)"
              >
                Re-scan (rules)
              </button>
              <button
                onClick={runAiRescan}
                disabled={aiRescanning}
                className="text-xs text-violet-700 hover:text-violet-900 flex items-center gap-1 border border-violet-200 hover:border-violet-400 bg-white rounded-lg px-2.5 py-1 transition disabled:opacity-50"
                title="Re-classify every expense using the latest AI rubric + your vendor memory + your custom categories"
              >
                <Sparkles size={12} /> {aiRescanning ? 'Re-scanning…' : 'Re-scan with AI'}
              </button>
            </>
          )}
          <button
            onClick={() => setShowCategoryManager(true)}
            className="text-xs text-violet-700 hover:text-violet-900 flex items-center gap-1 border border-violet-200 hover:border-violet-400 bg-white rounded-lg px-2.5 py-1 transition"
            title="Add or edit your own custom categories"
          >
            <Tag size={12} /> Manage categories
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs text-slate-700 hover:text-slate-900 flex items-center gap-1 border border-slate-200 hover:border-slate-400 bg-white rounded-lg px-2.5 py-1 transition"
            title="My Rubric, Import History, Vendor Memory, AI cost"
          >
            <Settings size={12} /> Settings
          </button>
        </div>
      </div>

      {/* Per-category cards for active month */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cats.map(c => {
          const total = monthByCategory[c.id] || 0;
          return (
            <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                <div className="text-[11px] font-bold text-slate-500 tracking-wider truncate">{c.label}</div>
              </div>
              <div className="text-base font-bold text-slate-900">{fmt2(total)}</div>
            </div>
          );
        })}
      </div>

      {/* Quick add */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={16} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-900">
            Add {tab === 'expenses' ? 'expense' : 'income'} entry
          </h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-8 gap-2">
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Date</label>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft(d => ({ ...d, date: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Category</label>
            <select
              value={draft.category}
              onChange={(e) => setDraft(d => ({ ...d, category: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            >
              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Amount</label>
            <MoneyCell
              value={draft.amount}
              onChange={(v) => setDraft(d => ({ ...d, amount: v }))}
              width="w-full"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">{tab === 'expenses' ? 'Vendor' : 'Source'}</label>
            <input
              type="text"
              placeholder={tab === 'expenses' ? 'e.g. Office Depot' : 'e.g. Bonus check'}
              value={draft.vendor}
              onChange={(e) => setDraft(d => ({ ...d, vendor: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Account</label>
            <input
              type="text"
              list="known-accounts"
              placeholder="e.g. Chase"
              value={draft.account}
              onChange={(e) => setDraft(d => ({ ...d, account: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
            <datalist id="known-accounts">
              {knownAccounts.map(a => <option key={a} value={a} />)}
            </datalist>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Notes</label>
            <input
              type="text"
              placeholder="(optional)"
              value={draft.notes}
              onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Receipt</label>
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 truncate flex items-center gap-1"
            >
              <Paperclip size={12} />
              {draft.attachment ? draft.attachment.name.slice(0, 14) + (draft.attachment.name.length > 14 ? '…' : '') : 'Attach…'}
            </button>
            <input
              ref={attachmentInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleAttachmentSelect}
              className="hidden"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={submitDraft}
              disabled={!draft.amount || Number(draft.amount) <= 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* Daily entries table */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-900">{ymLabel(activeMonth)} — {tab === 'expenses' ? 'Expenses' : 'Income'}</h3>
          <div className="flex items-center gap-2">
            <select
              value={activeMonth}
              onChange={(e) => setActiveMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm"
            >
              {allMonths.map(m => <option key={m} value={m}>{ymLabel(m)}</option>)}
            </select>
            <span className="text-xs text-slate-500">
              {list.length} entr{list.length === 1 ? 'y' : 'ies'} · {fmt2(monthTotal)}
            </span>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap text-xs">
          <span className="text-slate-500 font-bold uppercase tracking-wider">Filter:</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 text-xs"
          >
            <option value="">All categories</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input
            type="text"
            placeholder={`${tab === 'expenses' ? 'Vendor' : 'Source'} contains…`}
            value={filterVendor}
            onChange={(e) => setFilterVendor(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 text-xs w-48"
          />
          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 text-xs"
          >
            <option value="">All accounts</option>
            {knownAccounts.map(a => <option key={a} value={a}>{a}</option>)}
            <option value="" disabled>—</option>
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-indigo-700 hover:text-indigo-900 underline-offset-2 hover:underline">
              Clear filters
            </button>
          )}
          {hasFilters && (
            <span className="text-slate-500 ml-auto">
              {list.length} of {tab === 'expenses' ? expenses.filter(e => ymOf(e.date) === activeMonth).length : income.filter(e => ymOf(e.date) === activeMonth).length} entries match
            </span>
          )}
        </div>
        {list.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            <AlertCircle className="mx-auto mb-2" size={20} />
            No {tab === 'expenses' ? 'expenses' : 'income'} yet for {ymLabel(activeMonth)}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Amount</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">{tab === 'expenses' ? 'Vendor' : 'Source'}</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Account</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Notes</th>
                  <th className="py-2 px-2 w-16 text-xs font-bold text-slate-500 uppercase tracking-wider">Receipt</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(e => {
                  const c = tab === 'expenses' ? expCat(e.category) : incCat(e.category);
                  return (
                    <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-2">
                        <input
                          type="date"
                          value={e.date}
                          onChange={(ev) => onUpdate({ ...e, date: ev.target.value })}
                          className="border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-sm bg-transparent"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={e.category}
                          onChange={(ev) => onUpdate({ ...e, category: ev.target.value })}
                          className={`text-xs px-2 py-1 rounded font-semibold ${c.badge} border-0`}
                        >
                          {cats.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <MoneyCell
                          value={e.amount}
                          onChange={(v) => onUpdate({ ...e, amount: v })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={e[vendorKey] || ''}
                          onChange={(ev) => onUpdate({ ...e, [vendorKey]: ev.target.value })}
                          placeholder="—"
                          className="w-full border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-sm bg-transparent"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          list="known-accounts"
                          value={e.account || ''}
                          onChange={(ev) => onUpdate({ ...e, account: ev.target.value })}
                          placeholder="—"
                          title={e.paymentMethod ? `Payment method: ${e.paymentMethod}` : ''}
                          className="w-28 border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-xs text-slate-700 bg-transparent"
                        />
                        {e.paymentMethod && (
                          <div className="text-[9px] text-slate-400 leading-none mt-0.5">{e.paymentMethod}</div>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={e.notes || ''}
                          onChange={(ev) => onUpdate({ ...e, notes: ev.target.value })}
                          placeholder="—"
                          className="w-full border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-xs text-slate-600 bg-transparent"
                        />
                      </td>
                      <td className="py-2 px-2">
                        {e.attachment ? (
                          <button
                            onClick={async () => setViewAttachment(await loadAttachmentForView(e.attachment))}
                            className="text-indigo-600 hover:bg-indigo-50 p-1 rounded inline-flex items-center gap-1 text-xs"
                            title={e.attachment.name}
                          >
                            <Eye size={14} />
                          </button>
                        ) : (
                          <RowAttachmentButton entry={e} onUpdate={onUpdate} />
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button
                          onClick={() => onDelete(e.id)}
                          className="text-slate-400 hover:text-red-600 transition"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="py-2 px-2 text-xs text-slate-500 uppercase tracking-wider" colSpan={2}>Month total</td>
                  <td className="py-2 px-2 text-right text-slate-900">{fmt2(monthTotal)}</td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Attachment viewer modal */}
      {viewAttachment && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setViewAttachment(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white/95 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl shadow-indigo-500/10"
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div className="text-sm font-medium text-slate-700 truncate">{viewAttachment.name}</div>
              <button onClick={() => setViewAttachment(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-auto p-4 flex items-center justify-center bg-slate-50">
              {viewAttachment.missing ? (
                <div className="text-sm text-slate-500 italic py-12 text-center">
                  Attachment file is missing. It may have been lost in a previous storage failure.
                </div>
              ) : viewAttachment.type?.startsWith('image/') ? (
                <img src={viewAttachment.dataUrl} alt={viewAttachment.name} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
              ) : (
                <iframe src={viewAttachment.dataUrl} title={viewAttachment.name} className="w-full h-[70vh] rounded-lg" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Re-scan categories preview modal */}
      {rescanPreview && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setRescanPreview(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white/95 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl shadow-indigo-500/10">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div>
                <h2 className="font-semibold text-slate-900">Re-scan categories</h2>
                <div className="text-xs text-slate-500 mt-0.5">
                  {rescanPreview.length === 0
                    ? 'No re-categorization needed — all entries match current rules.'
                    : `Found ${rescanPreview.length} entr${rescanPreview.length === 1 ? 'y' : 'ies'} that should move to a more specific category.`}
                </div>
              </div>
              <button onClick={() => setRescanPreview(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="overflow-auto p-5 flex-1">
              {rescanPreview.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-8">All entries are categorized correctly.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs">
                      <th className="py-2 px-2 w-8"></th>
                      <th className="py-2 px-2 font-bold text-slate-500 uppercase tracking-wider">Vendor</th>
                      <th className="py-2 px-2 font-bold text-slate-500 uppercase tracking-wider text-right">Amount</th>
                      <th className="py-2 px-2 font-bold text-slate-500 uppercase tracking-wider">From</th>
                      <th className="py-2 px-2 font-bold text-slate-500 uppercase tracking-wider">→ To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rescanPreview.map(p => {
                      const fromCat = expCat(p.from);
                      const toCat   = expCat(p.to);
                      return (
                        <tr key={p.id} className={`border-b border-slate-100 ${p.picked ? '' : 'opacity-40'}`}>
                          <td className="py-2 px-2">
                            <input type="checkbox" checked={p.picked} onChange={() => togglePick(p.id)} className="w-4 h-4" />
                          </td>
                          <td className="py-2 px-2 text-slate-900 truncate max-w-[200px]" title={p.vendor}>{p.vendor || '—'}</td>
                          <td className="py-2 px-2 text-right font-semibold text-slate-700">{fmt2(p.amount)}</td>
                          <td className="py-2 px-2"><span className={`text-[11px] px-2 py-0.5 rounded font-bold ${fromCat.badge}`}>{fromCat.label}</span></td>
                          <td className="py-2 px-2"><span className={`text-[11px] px-2 py-0.5 rounded font-bold ${toCat.badge}`}>{toCat.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50/80 rounded-b-2xl">
              <button onClick={() => setRescanPreview(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button>
              {rescanPreview.length > 0 && (
                <button
                  onClick={applyRescan}
                  disabled={!rescanPreview.some(p => p.picked)}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2"
                >
                  <Check size={14} /> Apply {rescanPreview.filter(p => p.picked).length} change{rescanPreview.filter(p => p.picked).length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import preview modal */}
      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          knownAccounts={knownAccounts}
          onSetAccount={setPreviewAccount}
          onClose={() => setImportPreview(null)}
          onToggle={togglePreviewRow}
          onUpdateExp={updatePreviewExp}
          onUpdateInc={updatePreviewInc}
          onCommit={commitImport}
        />
      )}
    </div>
  );
}

export default memo(BusinessBooksView);

// ---------- Row-level attach button (for entries that don't have one yet) ----------
function RowAttachmentButton({ entry, onUpdate }) {
  const ref = useRef(null);
  const onPick = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const attachment = await processAttachment(file);
      onUpdate({ ...entry, attachment });
    } catch (err) {
      alert(err.message || String(err));
    }
    ev.target.value = '';
  };
  return (
    <>
      <button
        onClick={() => ref.current?.click()}
        className="text-slate-400 hover:text-indigo-600 p-1 rounded inline-flex items-center text-xs"
        title="Attach receipt"
      >
        <Paperclip size={14} />
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" onChange={onPick} className="hidden" />
    </>
  );
}

// ---------- Import preview modal (split: expenses + income) ----------
function ImportPreviewModal({ preview, knownAccounts = [], onSetAccount, onClose, onToggle, onUpdateExp, onUpdateInc, onCommit }) {
  const expSelected = preview.expFresh?.filter(e => preview.selected.has(e.id)) || [];
  const incSelected = preview.incFresh?.filter(e => preview.selected.has(e.id)) || [];
  const totalSel = expSelected.length + incSelected.length;
  const totalFresh = (preview.expFresh?.length || 0) + (preview.incFresh?.length || 0);
  const totalDup   = (preview.expDup?.length    || 0) + (preview.incDup?.length    || 0);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white/95 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-6xl w-full max-h-[90vh] flex flex-col shadow-2xl shadow-indigo-500/10"
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200 gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-slate-900">Review {preview.format === 'donjulio' ? 'expense sheet' : 'bank statement'} import</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {preview.error ? 'Failed' : <>
                {preview.fileName && <span className="font-mono text-[11px] text-slate-400">{preview.fileName}</span>}
                {preview.fileName && ' · '}
                {totalFresh} new · {totalDup} duplicate
              </>}
            </div>
          </div>
          {!preview.error && !preview.isMultiAccount && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase font-bold text-slate-500 tracking-wider">Account / Card</label>
              <input
                type="text"
                list="preview-known-accounts"
                value={preview.account || ''}
                onChange={(e) => onSetAccount(e.target.value)}
                placeholder={preview.detectedAccount || 'e.g. Chase Sapphire'}
                className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-48"
              />
              <datalist id="preview-known-accounts">
                {knownAccounts.map(a => <option key={a} value={a} />)}
              </datalist>
              {preview.detectedAccount && preview.account === preview.detectedAccount && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">auto-detected</span>
              )}
            </div>
          )}
          {!preview.error && preview.isMultiAccount && (
            <div className="text-xs text-slate-500">
              Each row uses its own card from the &ldquo;Card paid with&rdquo; column.
            </div>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="overflow-auto p-5 flex-1">
          {preview.error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
              <div className="flex items-center gap-2 font-semibold mb-1"><AlertCircle size={16} /> Couldn&rsquo;t process file</div>
              <div>{preview.error}</div>
            </div>
          ) : (
            <div className="space-y-6">
              {preview.expFresh.length > 0 && (
                <PreviewSection
                  title={`Expenses (${preview.expFresh.length})`}
                  rows={preview.expFresh}
                  cats={EXPENSE_CATEGORIES}
                  selected={preview.selected}
                  onToggle={onToggle}
                  onUpdate={onUpdateExp}
                  vendorKey="vendor"
                  vendorLabel="Vendor"
                  amountColor="text-red-600"
                />
              )}
              {preview.incFresh.length > 0 && (
                <PreviewSection
                  title={`Income (${preview.incFresh.length})`}
                  rows={preview.incFresh}
                  cats={INCOME_CATEGORIES}
                  selected={preview.selected}
                  onToggle={onToggle}
                  onUpdate={onUpdateInc}
                  vendorKey="source"
                  vendorLabel="Source"
                  amountColor="text-emerald-600"
                />
              )}
              {totalFresh === 0 && (
                <div className="text-center py-8 text-slate-400 text-sm">
                  All {totalDup} entries are already in your books.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50/80 backdrop-blur-sm rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">Cancel</button>
          {!preview.error && totalFresh > 0 && (
            <button
              onClick={onCommit}
              disabled={totalSel === 0}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2"
            >
              <Check size={14} />
              Import {totalSel} {totalSel === 1 ? 'entry' : 'entries'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewSection({ title, rows, cats, selected, onToggle, onUpdate, vendorKey, vendorLabel, amountColor }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="py-2 px-2 w-8"></th>
            <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
            <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
            <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Amount</th>
            <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">{vendorLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => {
            const checked = selected.has(e.id);
            return (
              <tr key={e.id} className={`border-b border-slate-100 ${checked ? '' : 'opacity-40'}`}>
                <td className="py-2 px-2">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(e.id)} className="w-4 h-4" />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="date"
                    value={e.date}
                    onChange={(ev) => onUpdate(e.id, { date: ev.target.value })}
                    className="border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-sm bg-transparent"
                  />
                </td>
                <td className="py-2 px-2">
                  <select
                    value={e.category}
                    onChange={(ev) => onUpdate(e.id, { category: ev.target.value })}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                  >
                    {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </td>
                <td className={`py-2 px-2 text-right font-semibold ${amountColor}`}>
                  <MoneyCell
                    value={e.amount}
                    onChange={(v) => onUpdate(e.id, { amount: v })}
                    className={amountColor}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={e[vendorKey] || ''}
                    onChange={(ev) => onUpdate(e.id, { [vendorKey]: ev.target.value })}
                    className="w-full border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-xs text-slate-600 bg-transparent"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// AI re-scan preview — modal that lists proposed category changes from
// /api/recategorize-ai. User toggles which to apply. Confidence-aware:
// "low" suggestions start unchecked; "high" / "medium" start checked.
function AiRescanPreview({ proposals, onTogglePick, onApply, onClose, expCat }) {
  const pickedCount = proposals.filter(p => p.picked).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-violet-50 to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">AI re-scan preview</h2>
              <p className="text-xs text-slate-500">{proposals.length} proposed change{proposals.length !== 1 ? 's' : ''} · {pickedCount} picked</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {proposals.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              <Check className="mx-auto mb-2 text-emerald-500" size={28} />
              Every expense looks correctly categorized. Nothing to change.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                  <th className="px-2 py-2 w-8 text-center">Apply</th>
                  <th className="px-2 py-2 text-left">Vendor</th>
                  <th className="px-2 py-2 text-right w-20">Amount</th>
                  <th className="px-2 py-2 text-left w-32">From</th>
                  <th className="px-2 py-2 text-left w-32">To</th>
                  <th className="px-2 py-2 text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => {
                  const fromCat = expCat(p.from);
                  const toCat = expCat(p.to);
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={p.picked} onChange={() => onTogglePick(p.id)} className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-semibold text-slate-900 truncate">{p.vendor}</div>
                        {p.confidence === 'low' && (
                          <span className="text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded px-1 py-0.5 inline-block mt-0.5">⚠ Low confidence</span>
                        )}
                        {p.confidence === 'medium' && (
                          <span className="text-[9px] font-bold uppercase bg-sky-100 text-sky-800 border border-sky-300 rounded px-1 py-0.5 inline-block mt-0.5">Medium</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-700">${Number(p.amount || 0).toFixed(2)}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block whitespace-nowrap" style={{ background: fromCat.color + '22', color: fromCat.color, border: `1px solid ${fromCat.color}44` }}>
                          {fromCat.label}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block whitespace-nowrap" style={{ background: toCat.color + '22', color: toCat.color, border: `1px solid ${toCat.color}44` }}>
                          {toCat.label}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500 text-[11px] italic">{p.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-100 bg-white px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          {proposals.length > 0 && (
            <button onClick={onApply} disabled={pickedCount === 0} className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
              <Check size={14} /> Apply {pickedCount} change{pickedCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
