'use client';
import { useState, useRef, useEffect } from 'react';
import {
  X, Upload, FileText, FileSpreadsheet, Image as ImageIcon, Sparkles,
  Loader2, CheckCircle2, AlertCircle, Trash2, ArrowRight, RefreshCw, Brain,
} from 'lucide-react';
import { PLATFORMS, PLATFORM_REASONS } from '@/lib/constants';
import { uid } from '@/lib/utils';
import {
  loadVendorMemory, saveVendorMemory, lookupVendor, recordVendor, vendorMemoryToHints,
} from '@/lib/vendorMemory';
import { useCategoriesAll } from '@/lib/customCategories';

const inp = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

function fmtMoney(v) {
  return '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export default function SmartImportWizard({ open, onClose, onImport, defaultAccount = '' }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
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
  const fileRef = useRef(null);

  // Merged categories (built-in + user customs) — stays in sync with the
  // Books tab so user-added buckets show up here automatically.
  const { expense: EXPENSE_CATEGORIES, income: INCOME_CATEGORIES, customMap } = useCategoriesAll();

  // Load vendor memory when the wizard opens — keeps it fresh after every
  // confirm cycle.
  useEffect(() => {
    if (open) loadVendorMemory().then(setVendorMemory).catch(() => setVendorMemory({}));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setFile(null); setBusy(false); setError(''); setResult(null);
      setEdits([]); setSkipMask(new Set()); setPlatformEdits([]); setPlatformSkipMask(new Set());
      setRememberedSet(new Set()); setRememberedPlatformSet(new Set());
      setAccount(defaultAccount);
    }
  }, [open, defaultAccount]);

  if (!open) return null;

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setError(''); setResult(null);
  };
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setError(''); setResult(null); }
  };

  const runExtract = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      // Send the user's confirmed vendor->category map so the AI mimics their
      // bookkeeping style on similar new vendors.
      const hints = vendorMemoryToHints(vendorMemory, 60);
      if (hints.length > 0) form.append('vendorHints', JSON.stringify(hints));
      // Send custom categories so the AI can route into them when a vendor
      // matches a user-defined bucket. Only id + label needed server-side.
      const customCats = [
        ...(customMap.expense || []).map(c => ({ id: c.id, label: c.label, direction: 'expense' })),
        ...(customMap.income  || []).map(c => ({ id: c.id, label: c.label, direction: 'income' })),
      ];
      if (customCats.length > 0) form.append('customCategories', JSON.stringify(customCats));

      const res = await fetch('/api/import-expenses-ai', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Pre-fill rows from vendor memory: when a row's vendor was previously
      // confirmed by the user, override the AI's guess with the user's pick.
      const remembered = new Set();
      const rememberedPlat = new Set();
      const txs = (data.transactions || []).map((t, i) => {
        const id = uid();
        const mem = lookupVendor(vendorMemory, t.vendor);
        if (mem && mem.direction !== 'platform') {
          remembered.add(i);
          return { ...t, id, direction: mem.direction || t.direction, category: mem.category || t.category };
        }
        return { ...t, id };
      });
      const plats = (data.platformExpenses || []).map((p, i) => {
        const id = uid();
        const mem = lookupVendor(vendorMemory, p.vendor || p.notes);
        if (mem && mem.direction === 'platform' && mem.platformId) {
          rememberedPlat.add(i);
          return { ...p, id, platformId: mem.platformId };
        }
        return { ...p, id };
      });

      setResult(data);
      setEdits(txs);
      setPlatformEdits(plats);
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

  const setEdit = (idx, patch) => setEdits(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
  const toggleSkip = (idx) => setSkipMask(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const skipAll = () => setSkipMask(new Set(edits.map((_, i) => i)));
  const skipNone = () => setSkipMask(new Set());

  // Platform-row equivalents
  const setPlatformEdit = (idx, patch) => setPlatformEdits(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
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
          {/* Step 1: Drop file */}
          {!result && (
            <div>
              <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv,.pdf" onChange={onPick} className="hidden" />
              {!file ? (
                <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/30 rounded-xl p-12 text-center cursor-pointer transition">
                  <div className="flex items-center justify-center gap-4 mb-4">
                    <FileSpreadsheet size={32} className="text-slate-300" />
                    <FileText size={32} className="text-slate-300" />
                    <ImageIcon size={32} className="text-slate-300" />
                  </div>
                  <div className="text-sm font-semibold text-slate-700">Drop a file here</div>
                  <div className="text-xs text-slate-500 mt-1">or click to browse</div>
                  <div className="text-[11px] text-slate-400 mt-3">XLSX · CSV · PDF (text or scanned image)</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    {file.name.toLowerCase().endsWith('.pdf') ? <FileText size={20} className="text-red-500" /> : <FileSpreadsheet size={20} className="text-emerald-500" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">{file.name}</div>
                      <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button onClick={() => { setFile(null); }} className="text-slate-400 hover:text-slate-700 text-xs underline">Change</button>
                  </div>
                  <button onClick={runExtract} disabled={busy}
                    className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30">
                    {busy ? <><Loader2 size={16} className="animate-spin" /> Extracting transactions...</> : <><Sparkles size={16} /> Extract with AI</>}
                  </button>
                  <p className="text-[11px] text-slate-400 text-center">First call usually takes 5-15 seconds depending on file size.</p>
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
                              <div className="flex items-center gap-1">
                                <input className={inp + ' flex-1'} value={p.vendor || ''} onChange={e => setPlatformEdit(i, { vendor: e.target.value })} disabled={skipped} />
                                {rememberedPlatformSet.has(i) && (
                                  <span title="Routed to this platform from your past corrections" className="text-[9px] font-bold uppercase bg-violet-100 text-violet-700 border border-violet-300 rounded px-1 py-0.5 flex items-center gap-0.5 whitespace-nowrap">
                                    <Brain size={9} /> Remembered
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

              {/* Transactions table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                    {edits.map((t, i) => {
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
                            <div className="flex items-center gap-1">
                              <input className={inp + ' flex-1'} value={t.vendor || ''} onChange={e => setEdit(i, { vendor: e.target.value })} disabled={skipped} />
                              {rememberedSet.has(i) && (
                                <span title="Categorized from your past corrections" className="text-[9px] font-bold uppercase bg-violet-100 text-violet-700 border border-violet-300 rounded px-1 py-0.5 flex items-center gap-0.5 whitespace-nowrap">
                                  <Brain size={9} /> Remembered
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
          {result && (
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
