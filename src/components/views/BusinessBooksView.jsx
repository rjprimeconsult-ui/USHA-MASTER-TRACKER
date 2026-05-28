'use client';
import { useMemo, useRef, useState, useEffect, memo } from 'react';
import {
  Plus, Trash2, DollarSign, TrendingUp, TrendingDown, AlertCircle, Calendar,
  Upload, X, Check, Paperclip, Eye, ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle, Wallet, Tag, Settings, Sparkles, Lock, Unlock,
} from 'lucide-react';
import { fmt, fmt2, today, uid } from '@/lib/utils';
import { parseBusinessFile, dedupEntries, classifyExpense } from '@/lib/businessImport';
import { storage } from '@/lib/storage';
import { compressIfImage } from '@/lib/imageCompress';
import { saveAttachment, getAttachment, deleteAttachment } from '@/lib/attachments';
import { useCategoriesAll } from '@/lib/customCategories';
import { PLATFORM_EXPENSE_CATEGORIES } from '@/lib/constants';
import { vendorMemoryToHints, loadVendorMemory } from '@/lib/vendorMemory';
import { loadUserRubric } from '@/lib/userRubric';
import { useClosedPeriods } from '@/lib/closedPeriods';
import { TiltCard, CountUp, Stagger, StaggerItem, MoneyCell } from '../motion/MotionPrimitives';
import SmartImportWizard from '../SmartImportWizard';
import CustomCategoryManager from '../CustomCategoryManager';
import AgentSettingsPanel from '../AgentSettingsPanel';
import EmptyState from '../EmptyState';
import { authedFetch } from '@/lib/authedFetch';

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
  platformExpenses = [],
  leads = [], overrides = [], ownAdvances = [],
  onAddExpense, onUpdateExpense, onDeleteExpense, onBulkAddExpenses,
  onAddIncome,  onUpdateIncome,  onDeleteIncome,  onBulkAddIncome,
  onBulkAddPlatforms,
  smartImportOpenSignal = 0,
}) {
  const [tab, setTab] = useState('expenses'); // 'expenses' | 'income'
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [viewAttachment, setViewAttachment] = useState(null);
  const [rescanPreview, setRescanPreview] = useState(null);
  const [showSmartImport, setShowSmartImport] = useState(false);

  // External "open" trigger from the onboarding walkthrough's final step.
  // Each increment of smartImportOpenSignal pops the wizard.
  useEffect(() => {
    if (smartImportOpenSignal > 0) setShowSmartImport(true);
  }, [smartImportOpenSignal]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiRescanning, setAiRescanning] = useState(false);
  const [aiRescanProgress, setAiRescanProgress] = useState({ done: 0, total: 0 });
  const [aiRescanPreview, setAiRescanPreview] = useState(null); // [{ id, vendor, amount, from, to, picked, confidence, reason }]
  // Bulk-select state — IDs of rows the user has checked. Cleared when
  // the user switches tabs / months so a stale Set never deletes the
  // wrong row in a different view.
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Merged categories (built-in + user customs). Reloads automatically when
  // the manager modal saves changes.
  const { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES, customMap, reload: reloadCustomCats } = useCategoriesAll();
  const expCat = (id) => EXPENSE_CATEGORIES.find(c => c.id === id) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  const incCat = (id) => INCOME_CATEGORIES.find(c => c.id === id) || INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1];

  // Closed-period state — books-side only here; PlatformExpensesView owns
  // its own platforms close/reopen UI.
  const { isClosed: isPeriodClosed, close: closeBookMonth, reopen: reopenBookMonth } = useClosedPeriods();

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

  // AI bulk re-categorization — chunks all expenses into 100-row batches,
  // calls /api/recategorize-ai sequentially with progress reporting, and
  // collects every proposed change into a single review modal.
  //
  // Why batch on the client side:
  //   - 500-row single calls timed out at the Vercel function boundary
  //   - Smaller batches stay well under output-token caps (~3K out per 100)
  //   - Progress updates feel responsive and let users abort if it stalls
  //   - System-prompt caching means batches 2..N cost ~10% of batch 1
  const RESCAN_BATCH_SIZE = 100;

  const runAiRescan = async () => {
    if (expenses.length === 0 || aiRescanning) return;

    // Soft cap with confirmation when the backlog is huge — gives the user
    // a chance to back out before incurring 10+ AI calls.
    if (expenses.length > 300) {
      const ok = window.confirm(
        `Re-scanning ${expenses.length} expenses with AI. ` +
        `This will run in batches of ${RESCAN_BATCH_SIZE} (about ${Math.ceil(expenses.length / RESCAN_BATCH_SIZE)} calls, ` +
        `~10-30 seconds each). Estimated cost: under $0.05 total. Continue?`
      );
      if (!ok) return;
    }

    setAiRescanning(true);
    setAiRescanProgress({ done: 0, total: expenses.length });

    try {
      const [vm, urubric] = await Promise.all([loadVendorMemory(), loadUserRubric()]);
      const vendorHints = vendorMemoryToHints(vm, 60);
      const customCats = [
        ...(customMap.expense || []).map(c => ({ id: c.id, label: c.label, direction: 'expense' })),
        ...(customMap.income  || []).map(c => ({ id: c.id, label: c.label, direction: 'income' })),
      ];
      const rubricText = urubric?.expense || '';

      const allRows = expenses.map(e => ({
        id: e.id,
        vendor: e.vendor || '',
        amount: Number(e.amount) || 0,
        currentDirection: 'expense',
        currentCategory: e.category || 'OTHER_EXPENSE',
      }));

      const allSuggestions = [];
      for (let i = 0; i < allRows.length; i += RESCAN_BATCH_SIZE) {
        const chunk = allRows.slice(i, i + RESCAN_BATCH_SIZE);
        const res = await authedFetch('/api/recategorize-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: chunk,
            vendorHints,
            customCategories: customCats,
            userRubric: rubricText,
          }),
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch {
          if (res.status === 504 || /timeout|gateway/i.test(text)) {
            throw new Error(`Batch ${Math.floor(i / RESCAN_BATCH_SIZE) + 1} timed out. Try fewer expenses at a time.`);
          }
          throw new Error(`Server returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

        if (Array.isArray(data.suggestions)) allSuggestions.push(...data.suggestions);
        setAiRescanProgress({ done: Math.min(i + RESCAN_BATCH_SIZE, allRows.length), total: allRows.length });
      }

      // Build the preview — only rows where AI proposed a change
      const proposals = allSuggestions.reduce((acc, s) => {
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

      if (proposals.length === 0) {
        alert(`AI re-scanned ${allRows.length} expense${allRows.length !== 1 ? 's' : ''} — every category looks correct. Nothing to change.`);
      } else {
        setAiRescanPreview(proposals);
      }
    } catch (e) {
      alert(`AI re-scan failed: ${e.message || e}`);
    } finally {
      setAiRescanning(false);
      setAiRescanProgress({ done: 0, total: 0 });
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

  // Platforms (Ringy / TextDrip / VanillaSoft) live in Books now under their
  // own categories (PLATFORM_RINGY / PLATFORM_TEXTDRIP / PLATFORM_VANILLASOFT).
  // We surface their subtotal alongside the YTD/month tiles for transparency,
  // but the underlying total is ALREADY in ytdExpenses / monthExpTotal —
  // don't double-subtract them anywhere.
  const ytdPlatformExpenses = useMemo(
    () => yrExpenses
      .filter(e => PLATFORM_EXPENSE_CATEGORIES.includes(e.category))
      .reduce((s, e) => s + Number(e.amount || 0), 0),
    [yrExpenses]
  );
  const monthPlatformTotal = useMemo(
    () => expenses
      .filter(e => ymOf(e.date) === activeMonth && PLATFORM_EXPENSE_CATEGORIES.includes(e.category))
      .reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses, activeMonth]
  );

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
  // True YTD Net = all income − all Books expenses. Platforms now live IN
  // Books (PLATFORM_* categories) so they're already inside ytdExpenses.
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
  const monthBooksIncTotal = monthIncome.reduce((s, e) => s + Number(e.amount || 0), 0);

  // True monthly P&L pieces — same definition as YTD but scoped to the
  // active month, so the "in vs out this month" card matches the YTD card.
  const monthOwnFromStmts = useMemo(
    () => ownAdvances.filter(a => ymOf(a.period) === activeMonth).reduce((s, a) => s + Number(a.amount || 0), 0),
    [ownAdvances, activeMonth]
  );
  const monthOwnFromLeads = useMemo(
    () => leads.filter(l => l.stage === 'Issued' && ymOf(l.closedDate) === activeMonth).reduce((s, l) => s + Number(l.dealValue || 0), 0),
    [leads, activeMonth]
  );
  const monthOwnCommissions = monthOwnFromStmts > 0 ? monthOwnFromStmts : monthOwnFromLeads;
  const monthOverrideIncome = useMemo(
    () => overrides.filter(o => ymOf(o.period) === activeMonth).reduce((s, o) => s + Number(o.amount || 0), 0),
    [overrides, activeMonth]
  );
  const monthCommissions = monthOwnCommissions + monthOverrideIncome;
  // True monthly income = books income + statement advances + overrides
  const monthIncTotal = monthBooksIncTotal + monthCommissions;
  // True monthly net = income − books expenses − platforms expenses
  // Platforms now live in Books, so monthExpTotal already includes them.
  const monthNet = monthIncTotal - monthExpTotal;

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
    // Block adds whose date falls in a closed period — same rule that applies
    // to Smart Import and per-row edits.
    if (isPeriodClosed('books', draft.date)) {
      alert(`${ymLabel(ymOf(draft.date))} is closed for editing. Reopen it before adding entries.`);
      return;
    }
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

  // When tab flips, reset category default to a valid one for that tab.
  // Also clear bulk-select so a stale Set from the other tab can't bulk-delete.
  const flipTab = (t) => {
    setTab(t);
    setSelectedIds(new Set());
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

  // Files queued for handoff to the Smart Import wizard when classic
  // mode receives a PDF (or other AI-only format).
  const [pendingAiFiles, setPendingAiFiles] = useState(null);

  // ---------- Bank statement upload ----------
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // PDFs go straight to Smart Import (AI) — classic XLSX/CSV parsing
    // can't read them. Handoff is automatic so the agent doesn't have
    // to know which mode handles which format.
    const isPdf = file.name.toLowerCase().endsWith('.pdf') ||
                  (file.type === 'application/pdf');
    if (isPdf) {
      setPendingAiFiles([file]);
      setShowSmartImport(true);
      e.target.value = '';
      return;
    }
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
  // Table-footer total reflects the rows ACTUALLY in the table (Books income
  // entries only). The "in vs out this month" card uses monthIncTotal which
  // includes statement advances + overrides — those don't live in this table.
  const monthTotal = tab === 'expenses' ? monthExpTotal : monthBooksIncTotal;

  // Bulk-select: visible rows that are checked, plus convenience helpers.
  // selectedIds may also contain IDs from other months/filters that were
  // checked and then filtered out — we count and act on the visible-and-
  // checked intersection so "Select all" never silently bulk-deletes
  // hidden rows.
  const visibleIds = list.map(e => e.id);
  const visibleSelectedCount = visibleIds.filter(id => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const toggleRowSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        // Uncheck all visible (preserve any from other views)
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const bulkDeleteSelected = () => {
    // Skip rows in closed months — they're read-only by design.
    const toDelete = visibleIds.filter(id => {
      if (!selectedIds.has(id)) return false;
      const row = list.find(e => e.id === id);
      return row && !isPeriodClosed('books', row.date);
    });
    const skippedClosed = visibleIds.filter(id => {
      if (!selectedIds.has(id)) return false;
      const row = list.find(e => e.id === id);
      return row && isPeriodClosed('books', row.date);
    }).length;

    if (toDelete.length === 0) {
      if (skippedClosed > 0) {
        alert(`All selected rows are in closed months. Reopen the month first.`);
      }
      return;
    }
    const noun = tab === 'expenses' ? 'expense' : 'income entry';
    const ok = window.confirm(
      `Delete ${toDelete.length} ${noun}${toDelete.length !== 1 ? (tab === 'expenses' ? 's' : 'ies').replace('ys', 'ies') : ''}?` +
      (skippedClosed > 0 ? ` (${skippedClosed} row${skippedClosed !== 1 ? 's' : ''} in closed months will be skipped.)` : '') +
      ` This can't be undone.`
    );
    if (!ok) return;
    for (const id of toDelete) onDelete(id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of toDelete) next.delete(id);
      return next;
    });
  };

  // ---------- Duplicate cleanup ----------
  // Scans ALL rows in the current tab for duplicate groups and returns the
  // ids of the extras (everything beyond one richest copy per group).
  //   - PLATFORM_* rows: grouped by (date | amount | category) — the same
  //     charge can arrive from the platform CSV and the bank statement with
  //     different vendor/account/notes.
  //   - All other rows: grouped by (date | amount | category | vendor |
  //     notes-first-80) — only true content-identicals collapse.
  // Within each group the RICHEST row (most metadata: account, notes,
  // receipt) is kept; the rest are flagged for removal. Rows in closed
  // months are never touched.
  const computeDuplicateIds = () => {
    const rows = tab === 'expenses' ? expenses : income;
    const vendorField = tab === 'expenses' ? 'vendor' : 'source';
    const PLATFORM_CATS = new Set(['PLATFORM_RINGY', 'PLATFORM_TEXTDRIP', 'PLATFORM_VANILLASOFT']);
    const platformKey = (e) => [e.date || '', Number(e.amount || 0).toFixed(2), e.category || ''].join('|');
    const strictKey = (e) => [
      e.date || '', Number(e.amount || 0).toFixed(2), e.category || '',
      String(e[vendorField] || '').trim().toLowerCase(),
      String(e.notes || '').trim().toLowerCase().slice(0, 80),
    ].join('|');
    const keyOf = (e) => PLATFORM_CATS.has(e.category) ? platformKey(e) : strictKey(e);
    const richness = (r) => {
      let s = 0;
      if ((r.account || '').trim()) s += 3;
      if ((r.notes || '').trim()) s += 2;
      if (r.attachment || r.receipt) s += 4;
      return s;
    };
    const groups = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const toRemove = [];
    let skippedClosed = 0;
    for (const grp of groups.values()) {
      if (grp.length < 2) continue;
      const sorted = [...grp].sort((a, b) => richness(b) - richness(a));
      for (const r of sorted.slice(1)) {
        if (isPeriodClosed('books', r.date)) { skippedClosed++; continue; }
        toRemove.push(r.id);
      }
    }
    return { toRemove, skippedClosed };
  };

  const dupCount = useMemo(
    () => computeDuplicateIds().toRemove.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, income, tab]
  );

  const cleanDuplicates = () => {
    const { toRemove, skippedClosed } = computeDuplicateIds();
    if (toRemove.length === 0) {
      alert(skippedClosed > 0
        ? `Found ${skippedClosed} duplicate(s), but they're all in closed months. Reopen those months to clean them.`
        : 'No duplicates found. ✓');
      return;
    }
    const noun = tab === 'expenses' ? 'expense' : 'income';
    const ok = window.confirm(
      `Found ${toRemove.length} duplicate ${noun} row${toRemove.length !== 1 ? 's' : ''} ` +
      `(keeping one copy of each — the one with the most detail).` +
      (skippedClosed > 0 ? ` ${skippedClosed} more are in closed months and will be skipped.` : '') +
      `\n\nRemove them? This can't be undone.`
    );
    if (!ok) return;
    for (const id of toRemove) onDelete(id);
    alert(`Removed ${toRemove.length} duplicate ${noun} row${toRemove.length !== 1 ? 's' : ''}.`);
  };

  return (
    <div className="space-y-5">
      {/* Top stat strip — YTD income, YTD expenses, True Net, Active month */}
      <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StaggerItem>
          <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
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
          <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center gap-2">
              <ArrowDownCircle size={16} className="text-red-500" />
              <div className="text-xs font-bold text-slate-500 tracking-wider">YTD EXPENSES</div>
            </div>
            <div className="mt-2 text-lg font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>
              <CountUp value={ytdExpenses} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />
            </div>
            <div className="text-[11px] text-slate-500">
              deductible business out
              {ytdPlatformExpenses > 0 && (
                <span title="Platforms (Ringy/TextDrip/VanillaSoft) are tracked separately and feed True CPA. Total YTD spend = Books + Platforms.">
                  {' '}· <span className="text-indigo-600 font-semibold">+ {fmt2(ytdPlatformExpenses)} Platforms</span>
                </span>
              )}
            </div>
          </TiltCard>
        </StaggerItem>
        <StaggerItem>
          <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
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
          <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-amber-600" />
              <div className="text-xs font-bold text-slate-500 tracking-wider">{ymLabel(activeMonth)}</div>
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-sm" style={{ transform: 'translateZ(10px)' }}>
              <span className="font-bold text-emerald-600" title={
                `Books income: ${fmt2(monthBooksIncTotal)}` +
                (monthOwnCommissions > 0 ? ` · Advances: ${fmt2(monthOwnCommissions)}` : '') +
                (monthOverrideIncome > 0 ? ` · Overrides: ${fmt2(monthOverrideIncome)}` : '')
              }>+{fmt2(monthIncTotal)}</span>
              <span className="text-slate-300">·</span>
              <span className="font-bold text-red-500" title={
                `All Books expenses: ${fmt2(monthExpTotal)}` +
                (monthPlatformTotal > 0 ? ` (of which Platforms: ${fmt2(monthPlatformTotal)})` : '')
              }>−{fmt2(monthExpTotal)}</span>
              <span className="text-slate-300">=</span>
              <span className={`font-bold ${monthNet >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {monthNet >= 0 ? '+' : '−'}{fmt2(Math.abs(monthNet))}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              in − out this month (incl. advances + platforms)
            </div>
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
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={handleFileSelect} className="hidden" />
        </div>
      </div>

      {/* Smart import (AI-powered) modal */}
      <SmartImportWizard
        open={showSmartImport}
        onClose={() => { setShowSmartImport(false); setPendingAiFiles(null); }}
        defaultAccount={knownAccounts[0] || ''}
        initialFiles={pendingAiFiles}
        onImport={({ expenses: importedExp, income: importedInc, platforms: importedPlat }) => {
          // Filter out rows whose date falls in a closed period — books vs
          // platforms checked against their own kind.
          const skip = { books: 0, platforms: 0, dup: 0 };

          // MULTISET dedup against EXISTING rows in Books.
          //
          // Why multiset (count-based) instead of set (presence-based):
          // an agent can legitimately have TWO identical charges on the
          // same day (e.g. two $529.32 "PwP AMERICAN EXPRS" travel charges,
          // both real, both offset by one points credit). A presence-based
          // dedup would let the FIRST import add only one of them, and
          // would block the agent from ever importing the second. Counting
          // occurrences fixes this: we only skip an incoming row if Books
          // ALREADY HAS at least as many copies of that key as we've seen
          // so far in this batch. Re-importing the same file is still fully
          // caught (existing counts match the file's counts), but a file
          // that legitimately contains twins imports both.
          //
          // Key strategy is category-aware:
          //  • PLATFORM_* rows: loose key (date | amount | category) —
          //    the same charge can arrive from the platform CSV and the
          //    bank statement with different vendor/account/notes.
          //  • All other rows: strict 5-field key.
          const PLATFORM_CATS = new Set(['PLATFORM_RINGY', 'PLATFORM_TEXTDRIP', 'PLATFORM_VANILLASOFT']);
          const platformKey = (e) => [
            e.date || '',
            Number(e.amount || 0).toFixed(2),
            e.category || '',
          ].join('|');
          const strictKey = (e, vendorField = 'vendor') => [
            e.date || '',
            Number(e.amount || 0).toFixed(2),
            e.category || '',
            String(e[vendorField] || '').trim().toLowerCase(),
            String(e.notes || '').trim().toLowerCase().slice(0, 80),
          ].join('|');
          const keyOf = (e, vendorField = 'vendor') =>
            PLATFORM_CATS.has(e.category) ? platformKey(e) : strictKey(e, vendorField);

          // Build COUNT maps of existing rows (how many of each key exist).
          const countMap = (rows, vendorField) => {
            const m = new Map();
            for (const e of rows) {
              const k = keyOf(e, vendorField);
              m.set(k, (m.get(k) || 0) + 1);
            }
            return m;
          };
          const expenseBudget = countMap(expenses || [], 'vendor');
          const incomeBudget  = countMap(income || [], 'source');

          // A row is a duplicate only while there is "remaining budget" of
          // existing copies to match against. Each match consumes one unit
          // of budget; once exhausted, further identical rows import fresh.
          const consumeDup = (budget, key) => {
            const remaining = budget.get(key) || 0;
            if (remaining > 0) { budget.set(key, remaining - 1); return true; }
            return false;
          };

          const okExpenses = (importedExp || []).filter(r => {
            if (isPeriodClosed('books', r.date)) { skip.books++; return false; }
            if (consumeDup(expenseBudget, keyOf(r, 'vendor'))) { skip.dup++; return false; }
            return true;
          });
          const okIncome = (importedInc || []).filter(r => {
            if (isPeriodClosed('books', r.date)) { skip.books++; return false; }
            if (consumeDup(incomeBudget, keyOf(r, 'source'))) { skip.dup++; return false; }
            return true;
          });
          const okPlatforms = (importedPlat || []).filter(r => {
            // Platforms now live inside Books — check the unified 'books'
            // bucket so a single reopen click works for both.
            if (isPeriodClosed('books', r.date)) { skip.platforms++; return false; }
            // Platform dups share the expense budget (same storage).
            if (consumeDup(expenseBudget, keyOf(r, 'vendor'))) { skip.dup++; return false; }
            return true;
          });
          if (okExpenses.length) onBulkAddExpenses(okExpenses);
          if (okIncome.length) onBulkAddIncome(okIncome);
          if (okPlatforms.length && onBulkAddPlatforms) onBulkAddPlatforms(okPlatforms);
          const all = [...okExpenses, ...okIncome, ...okPlatforms];
          if (all.length > 0) {
            const newest = all.reduce((max, e) => e.date > max ? e.date : max, '');
            if (newest) setActiveMonth(newest.slice(0, 7));
          }
          if (skip.books + skip.platforms + skip.dup > 0) {
            const parts = [];
            if (skip.books) parts.push(`${skip.books} books row${skip.books !== 1 ? 's' : ''} in closed months`);
            if (skip.platforms) parts.push(`${skip.platforms} platforms row${skip.platforms !== 1 ? 's' : ''} in closed months`);
            if (skip.dup) parts.push(`${skip.dup} duplicate${skip.dup !== 1 ? 's' : ''} already in Books`);
            alert(`Skipped ${parts.join(' · ')}.`);
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
        <div className="premium-card p-1 inline-flex">
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
                title="Re-classify every expense using the latest AI rubric + your vendor memory + your custom categories. Runs in batches of 100. Cost: under $0.05 typical."
              >
                <Sparkles size={12} />
                {aiRescanning
                  ? (aiRescanProgress.total > 0
                      ? `Re-scanning ${aiRescanProgress.done}/${aiRescanProgress.total}…`
                      : 'Re-scanning…')
                  : 'Re-scan with AI'}
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
            <div key={c.id} className="premium-card p-3">
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
      <div className="premium-card p-4">
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
              disabled={!draft.amount || Number(draft.amount) <= 0 || isPeriodClosed('books', draft.date)}
              title={isPeriodClosed('books', draft.date) ? `${ymLabel(ymOf(draft.date))} is closed — reopen to add` : ''}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition flex items-center justify-center gap-1"
            >
              {isPeriodClosed('books', draft.date) ? <><Lock size={12} /> Locked</> : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* Daily entries table */}
      <div className="premium-card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            {ymLabel(activeMonth)} — {tab === 'expenses' ? 'Expenses' : 'Income'}
            {isPeriodClosed('books', activeMonth) && (
              <span title="This month is closed for editing" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5">
                <Lock size={10} /> Closed
              </span>
            )}
          </h3>
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
            {isPeriodClosed('books', activeMonth) ? (
              <button
                onClick={async () => {
                  if (window.confirm(`Reopen ${ymLabel(activeMonth)} for editing? You'll be able to add/edit/delete entries again.`)) {
                    await reopenBookMonth('books', activeMonth);
                  }
                }}
                title="Reopen this month for editing"
                className="text-xs flex items-center gap-1 border border-amber-300 hover:border-amber-500 hover:bg-amber-50 text-amber-800 rounded-lg px-2.5 py-1 transition"
              >
                <Unlock size={12} /> Reopen month
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (window.confirm(`Close ${ymLabel(activeMonth)}? Adds, edits, deletes, and Smart Imports for this month will be blocked. You can reopen it any time.`)) {
                    await closeBookMonth('books', activeMonth);
                  }
                }}
                title="Lock this month so Smart Imports and edits can't change it"
                className="text-xs flex items-center gap-1 border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 rounded-lg px-2.5 py-1 transition"
              >
                <Lock size={12} /> Close month
              </button>
            )}
          </div>
        </div>

        {/* Closed-month banner */}
        {isPeriodClosed('books', activeMonth) && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
            <Lock size={13} className="flex-shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">{ymLabel(activeMonth)} is closed for editing.</span> Smart Import will skip rows with dates in this month, and per-row edit / delete / bulk-delete are disabled. Click <span className="font-semibold">Reopen month</span> above to make changes.
            </div>
          </div>
        )}

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
          {/* Clean duplicates — scans ALL rows in this tab (every month) for
              identical entries and removes the extras after confirmation.
              Highlighted when duplicates exist. */}
          {dupCount > 0 && (
            <button
              onClick={cleanDuplicates}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition"
              title="Remove duplicate rows (keeps one copy of each)"
            >
              <Sparkles size={12} /> Clean {dupCount} duplicate{dupCount !== 1 ? 's' : ''}
            </button>
          )}
          {hasFilters && (
            <span className="text-slate-500 ml-auto">
              {list.length} of {tab === 'expenses' ? expenses.filter(e => ymOf(e.date) === activeMonth).length : income.filter(e => ymOf(e.date) === activeMonth).length} entries match
            </span>
          )}
        </div>
        {/* Bulk-action bar — shows when any visible row is checked */}
        {visibleSelectedCount > 0 && (
          <div className="mb-3 bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-slate-700">
              <span className="font-bold text-slate-900">{visibleSelectedCount}</span> {tab === 'expenses' ? 'expense' : 'income entry'}{visibleSelectedCount !== 1 ? (tab === 'expenses' ? 's' : 'ies').replace('ys', 'ies') : ''} selected
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearSelection}
                className="text-xs text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
              >
                Clear
              </button>
              <button
                onClick={bulkDeleteSelected}
                className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1 text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Trash2 size={12} /> Delete {visibleSelectedCount} selected
              </button>
            </div>
          </div>
        )}
        {list.length === 0 ? (
          <EmptyState
            icon={tab === 'expenses' ? TrendingDown : TrendingUp}
            title={`No ${tab === 'expenses' ? 'expenses' : 'income'} yet for ${ymLabel(activeMonth)}`}
            message={
              tab === 'expenses'
                ? 'Smart Import reads bank statements, credit-card exports, or expense sheets — auto-categorizes everything in seconds. Or add an entry by hand below.'
                : 'Track Books income alongside your commissions for a true monthly P&L. Add an entry below, or use Smart Import to bring in deposit statements.'
            }
            actions={[
              { label: 'Smart Import', onClick: () => setShowSmartImport(true), icon: Sparkles },
            ]}
            compact
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm premium-table">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 px-2 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                      onChange={toggleSelectAllVisible}
                      title={allVisibleSelected ? 'Unselect all visible' : 'Select all visible'}
                      className="accent-indigo-600 w-4 h-4 cursor-pointer"
                    />
                  </th>
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
              {/* Keyed tbody forces a clean remount when filter changes —
                  guards against React reusing stale row DOM nodes from a
                  previous filter (which was causing Ringy rows to linger
                  after switching to another category). */}
              <tbody key={`${tab}|${activeMonth}|${filterCategory}|${filterVendor}|${filterAccount}`}>
                {list.map((e, idx) => {
                  const c = tab === 'expenses' ? expCat(e.category) : incCat(e.category);
                  const isSelected = selectedIds.has(e.id);
                  // Per-row read-only when this entry's date falls in a closed period
                  const rowLocked = isPeriodClosed('books', e.date);
                  const lockedUpdate = (patch) => {
                    if (rowLocked) {
                      alert(`This row is in a closed month. Reopen it before editing.`);
                      return;
                    }
                    onUpdate(patch);
                  };
                  // Composite key — defense in depth against any duplicate
                  // entry IDs in the underlying data.
                  return (
                    <tr key={`${e.id}|${idx}`} className={`border-b border-slate-100 ${rowLocked ? 'bg-amber-50/30' : isSelected ? 'bg-rose-50/40' : 'hover:bg-slate-50'}`}>
                      <td className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelected(e.id)}
                          disabled={rowLocked}
                          className="accent-indigo-600 w-4 h-4 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={rowLocked ? 'Closed month — reopen to select' : ''}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="date"
                          value={e.date}
                          onChange={(ev) => lockedUpdate({ ...e, date: ev.target.value })}
                          readOnly={rowLocked}
                          className={`border border-transparent rounded px-1 py-0.5 text-sm bg-transparent ${rowLocked ? 'text-slate-400 cursor-not-allowed' : 'hover:border-slate-200'}`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={e.category}
                          onChange={(ev) => lockedUpdate({ ...e, category: ev.target.value })}
                          disabled={rowLocked}
                          className={`text-xs px-2 py-1 rounded font-semibold ${c.badge} border-0 ${rowLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {cats.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <MoneyCell
                          value={e.amount}
                          onChange={(v) => lockedUpdate({ ...e, amount: v })}
                          disabled={rowLocked}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={e[vendorKey] || ''}
                          onChange={(ev) => lockedUpdate({ ...e, [vendorKey]: ev.target.value })}
                          readOnly={rowLocked}
                          placeholder="—"
                          className={`w-full border border-transparent rounded px-1 py-0.5 text-sm bg-transparent ${rowLocked ? 'text-slate-400 cursor-not-allowed' : 'hover:border-slate-200'}`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          list="known-accounts"
                          value={e.account || ''}
                          onChange={(ev) => lockedUpdate({ ...e, account: ev.target.value })}
                          onBlur={(ev) => {
                            // Datalist picks don't always fire the input
                            // event in every browser (Chrome quirk on
                            // mouse-click selection), so the controlled
                            // value can snap back to blank. Commit on
                            // blur as a safety net.
                            const next = ev.target.value || '';
                            if (!rowLocked && next !== (e.account || '')) {
                              lockedUpdate({ ...e, account: next });
                            }
                          }}
                          readOnly={rowLocked}
                          placeholder="—"
                          title={rowLocked ? 'Closed month — reopen to edit' : (e.paymentMethod ? `Payment method: ${e.paymentMethod}` : '')}
                          className={`w-28 border border-transparent rounded px-1 py-0.5 text-xs bg-transparent ${rowLocked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 hover:border-slate-200'}`}
                        />
                        {e.paymentMethod && (
                          <div className="text-[9px] text-slate-400 leading-none mt-0.5">{e.paymentMethod}</div>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={e.notes || ''}
                          onChange={(ev) => lockedUpdate({ ...e, notes: ev.target.value })}
                          onBlur={(ev) => {
                            // Safety net for any browser quirk where the
                            // controlled value can desync — commit on blur
                            // if the typed value differs from state.
                            const next = ev.target.value || '';
                            if (!rowLocked && next !== (e.notes || '')) {
                              lockedUpdate({ ...e, notes: next });
                            }
                          }}
                          readOnly={rowLocked}
                          placeholder="—"
                          className={`w-full border border-transparent rounded px-1 py-0.5 text-xs bg-transparent ${rowLocked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 hover:border-slate-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200'}`}
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
                          !rowLocked && <RowAttachmentButton entry={e} onUpdate={onUpdate} />
                        )}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {rowLocked ? (
                          <Lock size={12} className="text-amber-500 inline" title="Closed month — reopen to delete" />
                        ) : (
                          <button
                            onClick={() => onDelete(e.id)}
                            className="text-slate-400 hover:text-red-600 transition"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="py-2 px-2 text-xs text-slate-500 uppercase tracking-wider" colSpan={3}>Month total</td>
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
                <table className="w-full text-sm premium-table">
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
          expenseCategories={EXPENSE_CATEGORIES}
          incomeCategories={INCOME_CATEGORIES}
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
function ImportPreviewModal({ preview, knownAccounts = [], expenseCategories = [], incomeCategories = [], onSetAccount, onClose, onToggle, onUpdateExp, onUpdateInc, onCommit }) {
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
                  cats={expenseCategories}
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
                  cats={incomeCategories}
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
      <table className="w-full text-sm premium-table">
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
            <table className="w-full text-xs premium-table">
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
