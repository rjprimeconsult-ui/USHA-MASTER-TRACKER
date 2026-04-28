'use client';
import { useState, useRef, useEffect } from 'react';
import {
  X, Upload, FileText, FileSpreadsheet, Image as ImageIcon, Sparkles,
  Loader2, CheckCircle2, AlertCircle, Trash2, ArrowRight, RefreshCw,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/constants';
import { uid } from '@/lib/utils';

const inp = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

// Visual mapping for category badges
const expCatById = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c]));
const incCatById = Object.fromEntries(INCOME_CATEGORIES.map(c => [c.id, c]));

function CategoryBadge({ category, direction }) {
  const lookup = direction === 'expense' ? expCatById : incCatById;
  const c = lookup[category];
  if (!c) return <span className="text-xs text-slate-400 italic">{category}</span>;
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block whitespace-nowrap"
      style={{ background: c.color + '22', color: c.color, border: `1px solid ${c.color}44` }}>
      {c.label}
    </span>
  );
}

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
  const [account, setAccount] = useState(defaultAccount);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setFile(null); setBusy(false); setError(''); setResult(null);
      setEdits([]); setSkipMask(new Set()); setAccount(defaultAccount);
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
      const res = await fetch('/api/import-expenses-ai', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setEdits((data.transactions || []).map(t => ({ ...t, id: uid() })));
      setSkipMask(new Set());
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

  const confirm = () => {
    const today = () => new Date().toISOString().slice(0, 10);
    const expenses = [];
    const income = [];
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
    });
    onImport({ expenses, income });
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

  const counts = edits.reduce((acc, t, i) => {
    if (skipMask.has(i)) acc.skipped++;
    else if (t.direction === 'expense') acc.exp++;
    else acc.inc++;
    return acc;
  }, { exp: 0, inc: 0, skipped: 0 });

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
              <p className="text-xs text-slate-500">Drop any expense file — AI figures out the structure</p>
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
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Expenses ({counts.exp})</div>
                  <div className="text-base font-bold text-red-600 mt-0.5">{fmtMoney(liveTotals.expense)}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Income ({counts.inc})</div>
                  <div className="text-base font-bold text-emerald-600 mt-0.5">{fmtMoney(liveTotals.income)}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Skipped ({counts.skipped})</div>
                  <div className="text-base font-bold text-slate-400 mt-0.5">{counts.skipped} rows</div>
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
                            <input className={inp} value={t.vendor || ''} onChange={e => setEdit(i, { vendor: e.target.value })} disabled={skipped} />
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
              disabled={counts.exp + counts.inc === 0}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Import {counts.exp + counts.inc} transaction{counts.exp + counts.inc !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
