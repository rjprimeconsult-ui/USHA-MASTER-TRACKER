'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  X, Upload, FileText, FileSpreadsheet, Image as ImageIcon, Sparkles,
  Loader2, CheckCircle2, AlertCircle, Trash2, ArrowRight, RefreshCw, Brain, Eye,
} from 'lucide-react';
import { PLATFORMS, PLATFORM_REASONS } from '@/lib/constants';
import { uid } from '@/lib/utils';
import {
  loadVendorMemory, saveVendorMemory, lookupVendor, recordVendor, vendorMemoryToHints,
} from '@/lib/vendorMemory';
import { useCategoriesAll } from '@/lib/customCategories';
import { loadUserRubric } from '@/lib/userRubric';
import { recordImport } from '@/lib/importHistory';
import { authedFetch } from '@/lib/authedFetch';

const inp = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

function fmtMoney(v) {
  return '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export default function SmartImportWizard({ open, onClose, onImport, defaultAccount = '', initialFiles = null }) {
  // Bulk-mode: array of files queued for extraction. The wizard processes
  // them one at a time and merges transactions/platforms across all of
  // them into a single review table.
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, currentName: '' });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { transactions, summary, extractedHint, usage }
  const [edits, setEdits] = useState([]); // editable copy of transactions
  const [skipMask, setSkipMask] = useState(new Set()); // indices to exclude
  const [platformEdits, setPlatformEdits] = useState([]); // editable copy of platform expenses
  const [platformSkipMask, setPlatformSkipMask] = useState(new Set());
  const [account, setAccount] = useState(defaultAccount);
  const [vendorMemory, setVendorMemory] = useState({});
  const [rememberedSet, setRememberedSet] = useState(new Set()); // edits-array indices that came from memory
  const [rememberedPlatformSet, setRememberedPlatformSet] = useState(new Set());
  const [previewMode, setPreviewMode] = useState(false); // true = "Test extract" without committing
  const [showLowConfFirst, setShowLowConfFirst] = useState(false);
  const [userRubric, setUserRubric] = useState('');
  // Tracks which row indices have had their category/direction edited by
  // the user during this session — drives the green "Will remember" hint
  // so the user sees at-a-glance which corrections will get saved to
  // vendor memory on Import.
  const [editedRows, setEditedRows] = useState(new Set());
  const [editedPlatformRows, setEditedPlatformRows] = useState(new Set());
  const fileRef = useRef(null);

  // Merged categories (built-in + user customs) — stays in sync with the
  // Books tab so user-added buckets show up here automatically.
  const { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES, customMap } = useCategoriesAll();

  // Load vendor memory + user rubric when the wizard opens — keeps both
  // fresh after every confirm cycle.
  useEffect(() => {
    if (open) {
      loadVendorMemory().then(setVendorMemory).catch(() => setVendorMemory({}));
      loadUserRubric().then(r => setUserRubric(r?.expense || '')).catch(() => setUserRubric(''));
    }
  }, [open]);

  // Pre-load files when the wizard is opened with `initialFiles` set.
  // Used by classic importers to hand off PDF uploads to AI mode without
  // forcing the user to re-pick the file.
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) {
      setFiles(Array.from(initialFiles));
    }
  }, [open, initialFiles]);

  useEffect(() => {
    if (!open) {
      setFiles([]); setBusy(false); setError(''); setResult(null);
      setEdits([]); setSkipMask(new Set()); setPlatformEdits([]); setPlatformSkipMask(new Set());
      setRememberedSet(new Set()); setRememberedPlatformSet(new Set());
      setEditedRows(new Set()); setEditedPlatformRows(new Set());
      setBulkProgress({ done: 0, total: 0, currentName: '' });
      setAccount(defaultAccount);
    }
  }, [open, defaultAccount]);

  // Indices of `edits` rendered in display order. Low-confidence rows go
  // to the top when the user toggles "Review low-confidence first" so
  // they review the AI's least-sure guesses without scrolling.
  // MUST be declared BEFORE any early return — Rules of Hooks.
  const sortedEditIndices = useMemo(() => {
    const idx = edits.map((_, i) => i);
    if (!showLowConfFirst) return idx;
    const rank = (c) => (c === 'low' ? 0 : c === 'medium' ? 1 : 2);
    return idx.sort((a, b) => rank(edits[a]?.confidence) - rank(edits[b]?.confidence));
  }, [edits, showLowConfFirst]);

  if (!open) return null;

  const onPick = (e) => {
    const fs = Array.from(e.target.files || []);
    if (fs.length === 0) return;
    // Append to existing queue so users can pick from multiple folders
    setFiles(prev => [...prev, ...fs]);
    setError(''); setResult(null);
    // Reset the input so picking the same file twice still triggers onChange
    if (fileRef.current) fileRef.current.value = '';
  };
  const onDrop = (e) => {
    e.preventDefault();
    const fs = Array.from(e.dataTransfer.files || []);
    if (fs.length > 0) {
      setFiles(prev => [...prev, ...fs]);
      setError(''); setResult(null);
    }
  };
  const removeFile = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const runExtract = async () => {
    if (files.length === 0) return;
    setBusy(true); setError('');
    setBulkProgress({ done: 0, total: files.length, currentName: files[0].name });

    // Pre-render shared form fields ONCE — they're identical across files
    const hints = vendorMemoryToHints(vendorMemory, 60);
    const customCats = [
      ...(customMap.expense || []).map(c => ({ id: c.id, label: c.label, direction: 'expense' })),
      ...(customMap.income  || []).map(c => ({ id: c.id, label: c.label, direction: 'income' })),
    ];

    // Per-file extraction — runs one fetch + parse and records the result.
    // Pure function (no shared mutable state), so concurrent calls are safe.
    const extractOne = async (file) => {
      const form = new FormData();
      form.append('file', file);
      if (hints.length > 0) form.append('vendorHints', JSON.stringify(hints));
      if (customCats.length > 0) form.append('customCategories', JSON.stringify(customCats));
      if (userRubric && userRubric.trim()) form.append('userRubric', userRubric.trim());

      try {
        const res = await authedFetch('/api/import-expenses-ai', { method: 'POST', body: form });
        const rawText = await res.text();
        let data;
        try { data = JSON.parse(rawText); }
        catch {
          if (res.status === 504 || /timeout|gateway/i.test(rawText)) {
            throw new Error('Server timed out (file took longer than 5 minutes).');
          }
          throw new Error(`Non-JSON response (HTTP ${res.status}): ${rawText.slice(0, 150)}`);
        }
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return { ok: true, file, data };
      } catch (e) {
        return { ok: false, file, error: e.message || String(e) };
      }
    };

    // Worker-pool concurrency. Anthropic Tier 1 handles ~50 RPM easily, so
    // 4 concurrent extractions is comfortable while giving a 4x speedup
    // over sequential. Bigger pools risk rate-limit churn for marginal gain.
    // Results array is index-aligned with `files` so we preserve upload order.
    const CONCURRENCY = 4;
    const results = new Array(files.length);
    let nextIdx = 0;
    let completed = 0;

    const runWorker = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= files.length) return;
        const r = await extractOne(files[idx]);
        results[idx] = r;
        completed++;
        // Show whichever file is currently next-to-claim as a hint
        setBulkProgress({
          done: completed,
          total: files.length,
          currentName: nextIdx < files.length ? files[nextIdx].name : '',
        });
      }
    };

    try {
      // Launch the pool. Promise.all resolves once every worker drains the
      // queue. If a worker throws we still want the others to finish, but
      // extractOne already swallows per-file errors into { ok: false }.
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => runWorker())
      );

      // Aggregate in original upload order so the review table matches
      // the queue the user dropped.
      const allTxs = [];
      const allPlats = [];
      const remembered = new Set();
      const rememberedPlat = new Set();
      const perFileSummaries = [];
      const perFileErrors = [];
      let aggInputTokens = 0, aggCachedRead = 0, aggOutput = 0;

      for (const r of results) {
        if (!r) continue; // guard — shouldn't happen
        if (!r.ok) {
          perFileErrors.push({ filename: r.file.name, error: r.error });
          try {
            await recordImport({
              kind: 'expenses-error',
              filename: r.file.name, size: r.file.size || 0,
              counts: {}, error: r.error,
            });
          } catch {}
          continue;
        }
        const { file, data } = r;
        const sourceTag = files.length > 1 ? `[${file.name}]` : '';

        (data.transactions || []).forEach((t) => {
          const id = uid();
          const mem = lookupVendor(vendorMemory, t.vendor);
          let row;
          if (mem && mem.direction !== 'platform') {
            remembered.add(allTxs.length);
            row = { ...t, id, direction: mem.direction || t.direction, category: mem.category || t.category };
          } else {
            row = { ...t, id };
          }
          if (sourceTag) row.notes = [row.notes, sourceTag].filter(Boolean).join(' ');
          allTxs.push(row);
        });

        (data.platformExpenses || []).forEach((p) => {
          const id = uid();
          const mem = lookupVendor(vendorMemory, p.vendor || p.notes);
          let row;
          if (mem && mem.direction === 'platform' && mem.platformId) {
            rememberedPlat.add(allPlats.length);
            row = { ...p, id, platformId: mem.platformId };
          } else {
            row = { ...p, id };
          }
          if (sourceTag) row.notes = [row.notes, sourceTag].filter(Boolean).join(' ');
          allPlats.push(row);
        });

        if (data.usage) {
          aggInputTokens += data.usage.inputTokens || 0;
          aggCachedRead  += data.usage.cachedReadTokens || 0;
          aggOutput      += data.usage.outputTokens || 0;
        }
        perFileSummaries.push({
          filename: file.name,
          transactions: data.transactions?.length || 0,
          platforms: data.platformExpenses?.length || 0,
          summary: data.summary,
        });

        try {
          await recordImport({
            kind: previewMode ? 'expenses-preview' : 'expenses',
            filename: file.name, size: file.size || 0,
            counts: {
              transactions: data.transactions?.length || 0,
              platforms: data.platformExpenses?.length || 0,
            },
            usage: data.usage,
            fingerprint: data.fingerprint,
            durationMs: data.durationMs,
            raw: { transactions: data.transactions, platformExpenses: data.platformExpenses, summary: data.summary },
          });
        } catch {}
      }

      setBulkProgress({ done: files.length, total: files.length, currentName: '' });

      // If every single file failed, surface a single error. Otherwise we
      // continue with whatever did extract.
      if (allTxs.length === 0 && allPlats.length === 0 && perFileErrors.length === files.length) {
        const firstErr = perFileErrors[0];
        throw new Error(`All ${files.length} file${files.length !== 1 ? 's' : ''} failed. First error: ${firstErr.error}`);
      }

      const aggregateResult = {
        transactions: allTxs,
        platformExpenses: allPlats,
        summary: {
          format: files.length > 1 ? `bulk (${files.length} files)` : (perFileSummaries[0]?.summary?.format || 'unknown'),
          totalExpenses: 0,
          totalIncome: 0,
        },
        extractedHint: files.length > 1
          ? `Processed ${perFileSummaries.length} of ${files.length} file${files.length !== 1 ? 's' : ''}` +
            (perFileErrors.length > 0 ? ` · ${perFileErrors.length} failed (see import history)` : '')
          : (perFileSummaries[0] ? `Processed ${perFileSummaries[0].filename}` : ''),
        usage: {
          inputTokens: aggInputTokens,
          cachedReadTokens: aggCachedRead,
          outputTokens: aggOutput,
        },
        perFileErrors,
      };

      setResult(aggregateResult);
      setEdits(allTxs);
      setPlatformEdits(allPlats);
      setRememberedSet(remembered);
      setRememberedPlatformSet(rememberedPlat);
      setSkipMask(new Set());
      setPlatformSkipMask(new Set());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const setEdit = (idx, patch) => {
    setEdits(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
    // Track manual category/direction edits so we can show "Will remember"
    if ('category' in patch || 'direction' in patch) {
      setEditedRows(prev => { const next = new Set(prev); next.add(idx); return next; });
    }
  };
  const toggleSkip = (idx) => setSkipMask(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const skipAll = () => setSkipMask(new Set(edits.map((_, i) => i)));
  const skipNone = () => setSkipMask(new Set());

  // Platform-row equivalents
  const setPlatformEdit = (idx, patch) => {
    setPlatformEdits(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
    if ('platformId' in patch || 'reason' in patch) {
      setEditedPlatformRows(prev => { const next = new Set(prev); next.add(idx); return next; });
    }
  };
  const togglePlatformSkip = (idx) => setPlatformSkipMask(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const platformSkipAll = () => setPlatformSkipMask(new Set(platformEdits.map((_, i) => i)));
  const platformSkipNone = () => setPlatformSkipMask(new Set());

  const confirm = () => {
    const today = () => new Date().toISOString().slice(0, 10);
    const expenses = [];
    const income = [];
    // Build up vendor-memory updates as we go so future imports inherit
    // every category the user confirmed in this session.
    let memoryNext = { ...vendorMemory };

    edits.forEach((t, i) => {
      if (skipMask.has(i)) return;
      const base = {
        id: uid(),
        date: t.date || today(),
        amount: Math.abs(Number(t.amount) || 0),
        notes: t.notes || '',
        account: account || '',
        paymentMethod: null,
        attachment: null,
      };
      if (t.direction === 'expense') {
        expenses.push({ ...base, category: t.category || 'OTHER_EXPENSE', vendor: t.vendor || '' });
      } else {
        income.push({ ...base, category: t.category || 'OTHER_INCOME', source: t.vendor || '' });
      }
      // Record vendor memory only when we have something useful to remember
      if (t.vendor) {
        memoryNext = recordVendor(memoryNext, {
          vendor: t.vendor,
          direction: t.direction,
          category: t.category || (t.direction === 'expense' ? 'OTHER_EXPENSE' : 'OTHER_INCOME'),
        });
      }
    });

    // Platform rows go to a separate destination — same shape as
    // PlatformExpensesView's onAdd entries.
    const platforms = [];
    platformEdits.forEach((p, i) => {
      if (platformSkipMask.has(i)) return;
      platforms.push({
        id: uid(),
        date: p.date || today(),
        platform: p.platformId,  // 'TD' | 'RINGY' | 'VANILLA'
        amount: Math.abs(Number(p.amount) || 0),
        reason: p.reason || 'CREDIT REFILL',
        notes: [p.vendor && `From: ${p.vendor}`, p.notes].filter(Boolean).join(' · '),
        // Apply the "Account / Card (applied to all)" field to platform
        // rows too — they used to import with no account, forcing the
        // agent to set it by hand on every row.
        account: account || '',
        vendor: p.vendor || '',
      });
      if (p.vendor && p.platformId) {
        memoryNext = recordVendor(memoryNext, {
          vendor: p.vendor,
          direction: 'platform',
          platformId: p.platformId,
        });
      }
    });

    // Persist learning before we close — fire-and-forget; storage adapter
    // mirrors to localStorage so a network blip can't drop it.
    saveVendorMemory(memoryNext);

    onImport({ expenses, income, platforms });
    onClose();
  };

  // Totals across what's NOT skipped
  const liveTotals = edits.reduce((acc, t, i) => {
    if (skipMask.has(i)) return acc;
    const amt = Math.abs(Number(t.amount) || 0);
    if (t.direction === 'expense') acc.expense += amt;
    else acc.income += amt;
    return acc;
  }, { expense: 0, income: 0 });

  const platformTotal = platformEdits.reduce((acc, p, i) => {
    if (platformSkipMask.has(i)) return acc;
    return acc + Math.abs(Number(p.amount) || 0);
  }, 0);

  const counts = edits.reduce((acc, t, i) => {
    if (skipMask.has(i)) acc.skipped++;
    else if (t.direction === 'expense') acc.exp++;
    else acc.inc++;
    return acc;
  }, { exp: 0, inc: 0, skipped: 0 });
  const platformCounts = platformEdits.reduce((acc, _p, i) => {
    if (platformSkipMask.has(i)) acc.skipped++; else acc.kept++;
    return acc;
  }, { kept: 0, skipped: 0 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-violet-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Smart Import</h2>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                Drop any expense file — AI figures out the structure
                {Object.keys(vendorMemory).length > 0 && (
                  <span title={`${Object.keys(vendorMemory).length} vendor categories remembered from past imports`} className="inline-flex items-center gap-1 bg-violet-100 text-violet-700 border border-violet-300 rounded px-1.5 py-0.5 text-[10px] font-bold">
                    <Brain size={10} /> {Object.keys(vendorMemory).length} remembered
                  </span>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Step 1: Drop file(s) — supports multi-file bulk uploads */}
          {!result && (
            <div>
              <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv,.pdf" multiple onChange={onPick} className="hidden" />
              {files.length === 0 ? (
                <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30 rounded-xl p-12 text-center cursor-pointer transition">
                  <div className="flex items-center justify-center gap-4 mb-4">
                    <FileSpreadsheet size={32} className="text-slate-300" />
                    <FileText size={32} className="text-slate-300" />
                    <ImageIcon size={32} className="text-slate-300" />
                  </div>
                  <div className="text-sm font-semibold text-slate-700">Drop one or more files here</div>
                  <div className="text-xs text-slate-500 mt-1">or click to browse</div>
                  <div className="text-[11px] text-slate-400 mt-3">XLSX · CSV · PDF (text or scanned image) — drag multiple bank statements at once</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    {files.map((f, idx) => (
                      <div key={`${f.name}-${idx}`} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-3">
                        {f.name.toLowerCase().endsWith('.pdf') ? <FileText size={18} className="text-red-500 flex-shrink-0" /> : <FileSpreadsheet size={18} className="text-emerald-500 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-900 truncate">{f.name}</div>
                          <div className="text-[11px] text-slate-500">{(f.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <button onClick={() => removeFile(idx)} disabled={busy} className="text-slate-400 hover:text-red-600 disabled:opacity-30 p-1"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => fileRef.current?.click()} disabled={busy}
                    onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
                    className="w-full border border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/40 disabled:opacity-50 rounded-lg py-2 text-xs text-slate-600 font-semibold transition">
                    + Add more files (or drop here)
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => { setPreviewMode(false); runExtract(); }} disabled={busy}
                      className="flex-1 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30">
                      {busy && !previewMode
                        ? <><Loader2 size={16} className="animate-spin" />
                            {bulkProgress.total > 1
                              ? `Extracting ${bulkProgress.done + 1}/${bulkProgress.total}…`
                              : 'Extracting...'}
                          </>
                        : <><Sparkles size={16} /> Extract {files.length > 1 ? `${files.length} files` : 'with AI'}</>}
                    </button>
                    <button onClick={() => { setPreviewMode(true); runExtract(); }} disabled={busy}
                      title="Run extraction without committing — useful to test if a file parses cleanly before you import it"
                      className="bg-white hover:bg-slate-50 disabled:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl px-4 py-3 font-semibold flex items-center justify-center gap-2">
                      {busy && previewMode ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                      Preview
                    </button>
                  </div>
                  {busy && bulkProgress.total > 1 && bulkProgress.currentName && (
                    <div className="text-[11px] text-slate-500 text-center truncate">
                      Currently processing: <span className="font-semibold">{bulkProgress.currentName}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-400 text-center">
                    {files.length > 1
                      ? `${files.length} files queued — they'll be processed sequentially (5-15s each). All transactions merge into one review table.`
                      : 'First call usually takes 5-15 seconds. Use Preview to test extraction without importing.'}
                  </p>
                </div>
              )}
              {error && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold">Extraction failed</div>
                    <div className="text-xs mt-0.5">{error}</div>
                    {/ANTHROPIC_API_KEY/.test(error) && (
                      <div className="text-xs mt-2">Add `ANTHROPIC_API_KEY` to Vercel env vars and redeploy.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Review extracted transactions */}
          {result && (
            <div className="space-y-3">
              {/* Summary bar */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-emerald-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-xs text-emerald-900">
                    <div className="font-semibold">Found {edits.length} transactions ({result.summary.format})</div>
                    <div className="mt-0.5">{result.extractedHint}</div>
                  </div>
                  <button onClick={() => { setResult(null); setEdits([]); }}
                    className="text-xs text-emerald-700 hover:text-emerald-900 underline">Try again</button>
                </div>
              </div>

              {/* Per-file failures during bulk extraction */}
              {result.perFileErrors?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
                  <div className="font-semibold flex items-center gap-1.5 mb-1">
                    <AlertCircle size={13} /> {result.perFileErrors.length} file{result.perFileErrors.length !== 1 ? 's' : ''} failed during bulk extraction
                  </div>
                  <ul className="ml-5 list-disc space-y-0.5">
                    {result.perFileErrors.map((e, i) => (
                      <li key={i}><span className="font-semibold">{e.filename}</span>: {e.error}</li>
                    ))}
                  </ul>
                  <div className="mt-2 text-[10px] text-amber-700">The other files extracted successfully — review and import the rest below.</div>
                </div>
              )}

              {/* Live totals */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Books Expenses ({counts.exp})</div>
                  <div className="text-base font-bold text-red-600 mt-0.5">{fmtMoney(liveTotals.expense)}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Books Income ({counts.inc})</div>
                  <div className="text-base font-bold text-emerald-600 mt-0.5">{fmtMoney(liveTotals.income)}</div>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Platforms ({platformCounts.kept})</div>
                  <div className="text-base font-bold text-indigo-700 mt-0.5">{fmtMoney(platformTotal)}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Skipped</div>
                  <div className="text-base font-bold text-slate-400 mt-0.5">{counts.skipped + platformCounts.skipped} rows</div>
                </div>
              </div>

              {/* Account override + bulk actions */}
              <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Account / Card (applied to all)</label>
                  <input className={inp + ' mt-0.5 !text-sm'} value={account} onChange={e => setAccount(e.target.value)}
                    placeholder="e.g. Chase Business Debit, Amex Personal" />
                </div>
                <div className="flex gap-1.5 self-end">
                  <button onClick={skipNone} className="text-xs border border-slate-200 hover:bg-slate-50 px-2 py-1.5 rounded-lg">Include all</button>
                  <button onClick={skipAll} className="text-xs border border-slate-200 hover:bg-slate-50 px-2 py-1.5 rounded-lg">Skip all</button>
                </div>
              </div>

              {/* Platform expenses (Ringy / TextDrip / VanillaSoft) — populated separately */}
              {platformEdits.length > 0 && (
                <div className="bg-gradient-to-br from-indigo-50/40 to-violet-50/40 border border-indigo-200 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-between">
                    <span>Platforms (Ringy / TextDrip / VanillaSoft)</span>
                    <div className="flex gap-1.5">
                      <button onClick={platformSkipNone} className="bg-white/15 hover:bg-white/25 rounded px-2 py-0.5 text-[10px] font-semibold normal-case">Include all</button>
                      <button onClick={platformSkipAll} className="bg-white/15 hover:bg-white/25 rounded px-2 py-0.5 text-[10px] font-semibold normal-case">Skip all</button>
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-indigo-50">
                      <tr className="text-[10px] uppercase tracking-wider text-indigo-700 font-bold">
                        <th className="px-2 py-2 text-center w-8">Keep</th>
                        <th className="px-2 py-2 text-left w-28">Date</th>
                        <th className="px-2 py-2 text-left w-32">Platform</th>
                        <th className="px-2 py-2 text-left">Description</th>
                        <th className="px-2 py-2 text-right w-24">Amount</th>
                        <th className="px-2 py-2 text-left w-44">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformEdits.map((p, i) => {
                        const skipped = platformSkipMask.has(i);
                        return (
                          <tr key={p.id} className={`border-t border-indigo-100 ${skipped ? 'bg-slate-50/60 opacity-40' : 'hover:bg-indigo-50/40'}`}>
                            <td className="px-2 py-1.5 text-center">
                              <input type="checkbox" checked={!skipped} onChange={() => togglePlatformSkip(i)} className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="date" className={inp} value={p.date || ''} onChange={e => setPlatformEdit(i, { date: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={p.platformId} disabled={skipped}
                                onChange={e => setPlatformEdit(i, { platformId: e.target.value })}>
                                {PLATFORMS.map(pl => <option key={pl.id} value={pl.id}>{pl.label}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1 flex-wrap">
                                <input className={inp + ' flex-1 min-w-[120px]'} value={p.vendor || ''} onChange={e => setPlatformEdit(i, { vendor: e.target.value })} disabled={skipped} />
                                {rememberedPlatformSet.has(i) && (
                                  <span title="Routed to this platform from your past corrections" className="text-[9px] font-bold uppercase bg-violet-100 text-violet-700 border border-violet-300 rounded px-1 py-0.5 flex items-center gap-0.5 whitespace-nowrap">
                                    <Brain size={9} /> Remembered
                                  </span>
                                )}
                                {editedPlatformRows.has(i) && !skipped && (
                                  <span title="Your platform routing will be saved to vendor memory on Import" className="text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 rounded px-1 py-0.5 whitespace-nowrap">
                                    ✓ Will remember
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.01" className={inp + ' text-right'} value={p.amount || ''}
                                onChange={e => setPlatformEdit(i, { amount: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={p.reason || 'CREDIT REFILL'} disabled={skipped}
                                onChange={e => setPlatformEdit(i, { reason: e.target.value })}>
                                {PLATFORM_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Transactions table — with confidence-based ordering toggle */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Books transactions
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showLowConfFirst}
                      onChange={e => setShowLowConfFirst(e.target.checked)}
                      className="accent-amber-600 w-3.5 h-3.5"
                    />
                    Review low-confidence rows first
                  </label>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                      <th className="px-2 py-2 text-center w-8">Keep</th>
                      <th className="px-2 py-2 text-left w-28">Date</th>
                      <th className="px-2 py-2 text-left">Vendor / Description</th>
                      <th className="px-2 py-2 text-right w-24">Amount</th>
                      <th className="px-2 py-2 text-center w-20">Direction</th>
                      <th className="px-2 py-2 text-left w-44">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEditIndices.map(i => {
                      const t = edits[i];
                      if (!t) return null; // defensive: edits could have shrunk while sort ran
                      const skipped = skipMask.has(i);
                      const cats = t.direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
                      return (
                        <tr key={t.id} className={`border-t border-slate-100 ${skipped ? 'bg-slate-50/60 opacity-40' : 'hover:bg-indigo-50/20'}`}>
                          <td className="px-2 py-1.5 text-center">
                            <input type="checkbox" checked={!skipped} onChange={() => toggleSkip(i)} className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="date" className={inp} value={t.date || ''} onChange={e => setEdit(i, { date: e.target.value })} disabled={skipped} />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <input className={inp + ' flex-1 min-w-[120px]'} value={t.vendor || ''} onChange={e => setEdit(i, { vendor: e.target.value })} disabled={skipped} />
                              {rememberedSet.has(i) && (
                                <span title="Categorized from your past corrections" className="text-[9px] font-bold uppercase bg-violet-100 text-violet-700 border border-violet-300 rounded px-1 py-0.5 flex items-center gap-0.5 whitespace-nowrap">
                                  <Brain size={9} /> Remembered
                                </span>
                              )}
                              {!rememberedSet.has(i) && t.confidence === 'low' && (
                                <span title="AI is guessing — please double-check" className="text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded px-1 py-0.5 whitespace-nowrap">
                                  ⚠ Review
                                </span>
                              )}
                              {!rememberedSet.has(i) && t.confidence === 'medium' && (
                                <span title="AI confidence: medium" className="text-[9px] font-bold uppercase bg-sky-100 text-sky-800 border border-sky-300 rounded px-1 py-0.5 whitespace-nowrap">
                                  Medium
                                </span>
                              )}
                              {editedRows.has(i) && !skipped && (
                                <span title="Your correction will be saved to vendor memory on Import — next month's file with the same vendor gets this category automatically" className="text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 rounded px-1 py-0.5 whitespace-nowrap">
                                  ✓ Will remember
                                </span>
                              )}
                            </div>
                            {t.notes && <div className="text-[10px] text-slate-400 italic mt-0.5 truncate">{t.notes}</div>}
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="0.01" className={inp + ' text-right'} value={t.amount || ''}
                              onChange={e => setEdit(i, { amount: e.target.value })} disabled={skipped} />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <select className={inp} value={t.direction} disabled={skipped}
                              onChange={e => {
                                const dir = e.target.value;
                                // When flipping direction, reset to a sensible default category
                                const def = dir === 'expense' ? 'OTHER_EXPENSE' : 'OTHER_INCOME';
                                setEdit(i, { direction: dir, category: def });
                              }}>
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select className={inp} value={t.category || ''} disabled={skipped}
                              onChange={e => setEdit(i, { category: e.target.value })}>
                              {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                    {edits.length === 0 && (
                      <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-400 italic">No transactions extracted.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Cost telemetry */}
              {result.usage && (
                <div className="text-[11px] text-slate-400 text-right">
                  AI cost: {result.usage.inputTokens.toLocaleString()} input + {result.usage.outputTokens.toLocaleString()} output tokens
                  {result.usage.cachedReadTokens > 0 && ` (${result.usage.cachedReadTokens.toLocaleString()} cached)`}
                  {' '}≈ ${((result.usage.inputTokens * 1 + result.usage.outputTokens * 5 + result.usage.cachedReadTokens * 0.1) / 1000000).toFixed(4)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="border border-slate-200 hover:bg-slate-100 bg-white px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
          {result && previewMode && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
              <Eye size={13} /> <b>Preview mode</b> — extraction looks good? Click "Re-run as final" to import.
            </div>
          )}
          {result && previewMode && (
            <button onClick={() => { setPreviewMode(false); runExtract(); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
              <RefreshCw size={14} /> Re-run as final
            </button>
          )}
          {result && !previewMode && (
            <button onClick={confirm}
              disabled={counts.exp + counts.inc + platformCounts.kept === 0}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Import {counts.exp + counts.inc} books{platformCounts.kept > 0 ? ` + ${platformCounts.kept} platform${platformCounts.kept !== 1 ? 's' : ''}` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
