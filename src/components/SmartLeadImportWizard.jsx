'use client';
import { useState, useRef, useEffect } from 'react';
import {
  X, FileText, FileSpreadsheet, Image as ImageIcon, Sparkles,
  Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import {
  STAGES, MAIN_PRODUCTS, ASSOCIATION_PLANS, CRMS, CAMPAIGNS,
  LEAD_CATEGORIES, SOURCES, OWNERS,
} from '@/lib/constants';
import { mkLead } from '@/lib/seed';
import { uid } from '@/lib/utils';
import { dedupLeads } from '@/lib/leadDedup';

const inp = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SmartLeadImportWizard({ open, onClose, onImport, existingLeads = [] }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [edits, setEdits] = useState([]);
  const [skipMask, setSkipMask] = useState(new Set());
  const [defaults, setDefaults] = useState({
    crm: 'RINGY',
    source: 'CRM',
    leadCategory: 'AGED',
    campaign: 'AGED.25',
    owner: 'You',
    leadCost: '',
  });
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setFile(null); setBusy(false); setError(''); setResult(null);
      setEdits([]); setSkipMask(new Set());
    }
  }, [open]);

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
      const res = await fetch('/api/import-leads-ai', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setEdits((data.leads || []).map(l => ({ ...l, _id: uid() })));
      setSkipMask(new Set());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const setEdit = (idx, patch) => setEdits(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const toggleSkip = (idx) => setSkipMask(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const skipAll = () => setSkipMask(new Set(edits.map((_, i) => i)));
  const skipNone = () => setSkipMask(new Set());

  const confirm = () => {
    const today = () => new Date().toISOString().slice(0, 10);
    const batchId = `batch_${uid()}`;
    const candidates = edits.flatMap((l, i) => {
      if (skipMask.has(i)) return [];
      if (!l.name?.trim()) return [];
      return [mkLead({
        _batchId: batchId,
        name: l.name.trim(),
        age: Number(l.age) || 0,
        phone: l.phone || '',
        email: l.email || '',
        state: (l.state || '').toUpperCase().slice(0, 2),
        policyNumber: l.policyNumber || '',
        mainProduct: l.mainProduct || '',
        mainProductPremium: Number(l.mainProductPremium) || 0,
        products: (l.products || []).map(p => ({ id: p, premium: 0 })),
        associationPlan: l.associationPlan || '',
        stage: l.stage || 'Pending',
        closedDate: l.closedDate || (l.stage === 'Issued' ? today() : null),
        dateAdded: l.closedDate || today(),
        payType: l.payType || 'advance',
        crm: l.crm || defaults.crm,
        source: l.source || defaults.source,
        leadCategory: l.leadCategory || defaults.leadCategory,
        campaign: defaults.campaign,
        owner: defaults.owner,
        leadCost: Number(defaults.leadCost) || 0,
        notes: l.notes || '',
      })];
    });
    // Dedup against existing tracker leads + within the batch itself.
    // Note: importLeads() in LeadTracker also re-runs dedup as a backstop,
    // but doing it here too gives the user explicit visibility before import.
    const { fresh, duplicates } = dedupLeads(candidates, existingLeads);
    if (duplicates.length > 0) {
      const proceed = window.confirm(
        `${duplicates.length} of these ${candidates.length} leads already exist in your tracker (matched by policy number, or by name + phone). Skip duplicates and import only the ${fresh.length} new leads?`
      );
      if (!proceed) return;
    }
    onImport(fresh, { batchId, duplicatesSkipped: duplicates.length });
    onClose();
  };

  const counts = edits.reduce((acc, l, i) => {
    if (skipMask.has(i)) acc.skipped++;
    else {
      acc.kept++;
      acc.byStage[l.stage] = (acc.byStage[l.stage] || 0) + 1;
    }
    return acc;
  }, { kept: 0, skipped: 0, byStage: {} });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl max-h-[94vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-violet-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Smart Lead Import</h2>
              <p className="text-xs text-slate-500">Drop any lead file (Excel, CSV, PDF, screenshot) — AI extracts every lead</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!result && (
            <div>
              <input type="file" ref={fileRef} accept=".xlsx,.xls,.csv,.pdf,image/*" onChange={onPick} className="hidden" />
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
                  <div className="text-[11px] text-slate-400 mt-3">XLSX · CSV · PDF · Screenshots (PNG/JPG)</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    {file.name.toLowerCase().match(/\.(pdf)$/) ? <FileText size={20} className="text-red-500" /> :
                      file.name.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/) ? <ImageIcon size={20} className="text-violet-500" /> :
                      <FileSpreadsheet size={20} className="text-emerald-500" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-slate-900 truncate">{file.name}</div>
                      <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <button onClick={() => setFile(null)} className="text-slate-400 hover:text-slate-700 text-xs underline">Change</button>
                  </div>
                  <button onClick={runExtract} disabled={busy}
                    className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30">
                    {busy ? <><Loader2 size={16} className="animate-spin" /> Extracting leads...</> : <><Sparkles size={16} /> Extract with AI</>}
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

          {result && (
            <div className="space-y-3">
              {/* Summary bar */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-emerald-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 text-xs text-emerald-900">
                    <div className="font-semibold">Found {edits.length} leads ({result.summary.format})</div>
                    <div className="mt-0.5">{result.extractedHint}</div>
                  </div>
                  <button onClick={() => { setResult(null); setEdits([]); }}
                    className="text-xs text-emerald-700 hover:text-emerald-900 underline">Try again</button>
                </div>
              </div>

              {/* Stage breakdown */}
              {Object.keys(counts.byStage).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-bold text-slate-500">Keeping:</span>
                  {Object.entries(counts.byStage).map(([stage, n]) => {
                    const s = STAGES.find(x => x.id === stage) || STAGES[0];
                    return (
                      <span key={stage} className={`px-2 py-0.5 rounded ${s.bg} ${s.text} font-semibold`}>
                        {n} {stage}
                      </span>
                    );
                  })}
                  {counts.skipped > 0 && (
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500">{counts.skipped} skipped</span>
                  )}
                </div>
              )}

              {/* Defaults panel */}
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Defaults applied to all imported leads</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">CRM</label>
                    <select className={inp + ' mt-0.5'} value={defaults.crm} onChange={e => setDefaults(d => ({ ...d, crm: e.target.value }))}>
                      {CRMS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Source</label>
                    <select className={inp + ' mt-0.5'} value={defaults.source} onChange={e => setDefaults(d => ({ ...d, source: e.target.value }))}>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Lead Category</label>
                    <select className={inp + ' mt-0.5'} value={defaults.leadCategory} onChange={e => setDefaults(d => ({ ...d, leadCategory: e.target.value }))}>
                      {LEAD_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Campaign</label>
                    <select className={inp + ' mt-0.5'} value={defaults.campaign} onChange={e => setDefaults(d => ({ ...d, campaign: e.target.value }))}>
                      {CAMPAIGNS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Owner</label>
                    <select className={inp + ' mt-0.5'} value={defaults.owner} onChange={e => setDefaults(d => ({ ...d, owner: e.target.value }))}>
                      {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Lead Cost ($)</label>
                    <input type="number" step="0.01" className={inp + ' mt-0.5'}
                      value={defaults.leadCost} onChange={e => setDefaults(d => ({ ...d, leadCost: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
              </div>

              {/* Bulk actions */}
              <div className="flex justify-end gap-2 text-xs">
                <button onClick={skipNone} className="border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold">Include all</button>
                <button onClick={skipAll} className="border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold">Skip all</button>
              </div>

              {/* Leads table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <th className="px-2 py-2 text-center w-8">Keep</th>
                        <th className="px-2 py-2 text-left min-w-[150px]">Name</th>
                        <th className="px-2 py-2 text-left w-20">Age</th>
                        <th className="px-2 py-2 text-left w-36">Phone</th>
                        <th className="px-2 py-2 text-left min-w-[160px]">Email</th>
                        <th className="px-2 py-2 text-left w-14">St</th>
                        <th className="px-2 py-2 text-left w-32">Policy #</th>
                        <th className="px-2 py-2 text-left w-40">Main Product</th>
                        <th className="px-2 py-2 text-right w-20">Premium</th>
                        <th className="px-2 py-2 text-left w-32">Stage</th>
                        <th className="px-2 py-2 text-left w-32">Closed Date</th>
                        <th className="px-2 py-2 text-left w-32">Pay Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edits.map((l, i) => {
                        const skipped = skipMask.has(i);
                        return (
                          <tr key={l._id} className={`border-t border-slate-100 ${skipped ? 'bg-slate-50/60 opacity-40' : 'hover:bg-indigo-50/20'}`}>
                            <td className="px-2 py-1.5 text-center">
                              <input type="checkbox" checked={!skipped} onChange={() => toggleSkip(i)} className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={l.name || ''} onChange={e => setEdit(i, { name: e.target.value })} disabled={skipped} />
                              {l.notes && <div className="text-[10px] text-slate-400 italic mt-0.5 truncate">{l.notes}</div>}
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" className={inp} value={l.age || ''} onChange={e => setEdit(i, { age: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={l.phone || ''} onChange={e => setEdit(i, { phone: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={l.email || ''} onChange={e => setEdit(i, { email: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={l.state || ''} onChange={e => setEdit(i, { state: e.target.value.toUpperCase() })} maxLength={2} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={l.policyNumber || ''} onChange={e => setEdit(i, { policyNumber: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={l.mainProduct || ''} onChange={e => setEdit(i, { mainProduct: e.target.value })} disabled={skipped}>
                                <option value="">—</option>
                                {MAIN_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.01" className={inp + ' text-right'}
                                value={l.mainProductPremium || ''}
                                onChange={e => setEdit(i, { mainProductPremium: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={l.stage || 'Pending'} onChange={e => setEdit(i, { stage: e.target.value })} disabled={skipped}>
                                {STAGES.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="date" className={inp} value={l.closedDate || ''} onChange={e => setEdit(i, { closedDate: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={l.payType || 'advance'} onChange={e => setEdit(i, { payType: e.target.value })} disabled={skipped}>
                                <option value="advance">Advance</option>
                                <option value="as_earned">As Earned</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                      {edits.length === 0 && (
                        <tr><td colSpan="12" className="px-3 py-6 text-center text-slate-400 italic">No leads extracted.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
            <button onClick={confirm} disabled={counts.kept === 0}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Import {counts.kept} lead{counts.kept !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
