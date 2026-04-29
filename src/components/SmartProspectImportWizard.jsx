'use client';
import { useState, useRef, useEffect } from 'react';
import {
  X, FileText, FileSpreadsheet, Image as ImageIcon, Sparkles,
  Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import {
  PROSPECT_SOURCES, PROSPECT_CRMS, PROSPECT_POLICY_TYPES,
} from '@/lib/constants';
import { newProspect, prospectDedupKey } from '@/lib/prospects';

const inp = 'w-full border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500';

export default function SmartProspectImportWizard({ open, onClose, onImport, stages = [], existingProspects = [] }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [edits, setEdits] = useState([]);
  const [skipMask, setSkipMask] = useState(new Set());
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
      // Agent rubric overlay
      try {
        const { loadUserRubric } = await import('@/lib/userRubric');
        const r = await loadUserRubric();
        if (r?.prospect && r.prospect.trim()) form.append('userRubric', r.prospect.trim());
      } catch {}
      const res = await fetch('/api/import-prospects-ai', { method: 'POST', body: form });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch {
        if (res.status === 504 || /timeout|gateway/i.test(rawText)) {
          throw new Error('Server timed out (>5 min). Try splitting the file.');
        }
        throw new Error(`Server returned non-JSON (HTTP ${res.status}). Snippet: ${rawText.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Audit trail
      try {
        const { recordImport } = await import('@/lib/importHistory');
        await recordImport({
          kind: 'prospects',
          filename: file?.name || 'upload',
          size: file?.size || 0,
          counts: { prospects: data.prospects?.length || 0 },
          usage: data.usage,
          durationMs: data.durationMs,
          raw: { prospects: data.prospects, summary: data.summary },
        });
      } catch {}
      setResult(data);
      // Pre-skip rows that already exist in the user's prospects (by phone/email/name)
      const existingKeys = new Set(existingProspects.map(prospectDedupKey));
      const initialEdits = (data.prospects || []).map((p, i) => ({ ...p, _idx: i }));
      const initialSkipped = new Set();
      initialEdits.forEach((p, i) => {
        if (existingKeys.has(prospectDedupKey(p))) initialSkipped.add(i);
      });
      setEdits(initialEdits);
      setSkipMask(initialSkipped);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const setEdit = (idx, patch) => setEdits(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  const toggleSkip = (idx) => setSkipMask(prev => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });
  const skipAll = () => setSkipMask(new Set(edits.map((_, i) => i)));
  const skipNone = () => setSkipMask(new Set());

  const confirm = () => {
    const newProspects = edits.flatMap((p, i) => {
      if (skipMask.has(i)) return [];
      if (!p.name?.trim()) return [];
      return [newProspect({
        name: p.name.trim(),
        phone: p.phone || '',
        email: p.email || '',
        state: (p.state || '').toUpperCase().slice(0, 2),
        zip: p.zip || '',
        timezone: p.timezone || '',
        indvOrFamily: p.indvOrFamily || 'Indv',
        dobs: p.dobs || '',
        income: p.income || '',
        quoteSize: p.quoteSize || '',
        policyType: p.policyType || '',
        meds: p.meds || '',
        situation: p.situation || '',
        startDate: p.startDate || '',
        source: p.source || '',
        referrer: p.referrer || '',
        crm: p.crm || 'None',
        stage: p.stage || (stages[0]?.id || 'PENDING_DECISION'),
        appointmentTime: p.appointmentTime || '',
        nextSteps: p.nextSteps || '',
        lastContact: p.lastContact || '',
      })];
    });
    onImport(newProspects, { duplicatesSkipped: edits.length - newProspects.length });
    onClose();
  };

  const counts = edits.reduce((acc, p, i) => {
    if (skipMask.has(i)) acc.skipped++;
    else {
      acc.kept++;
      acc.byStage[p.stage] = (acc.byStage[p.stage] || 0) + 1;
    }
    return acc;
  }, { kept: 0, skipped: 0, byStage: {} });

  // Available stages to pick from in the dropdown — uses the user's
  // configured stages so renames stay consistent.
  const stageOptions = stages.length > 0 ? stages : [
    { id: 'WEBBY_SET', label: 'Webby Set' },
    { id: 'WEBBY_CONFIRMED', label: 'Webby Confirmed' },
    { id: 'APPOINTMENT_SET', label: 'Appointment Set' },
    { id: 'MISSED_APPT', label: 'Missed Appt' },
    { id: 'PENDING_DECISION', label: 'Pending Decision' },
    { id: 'FOLLOWUP_LATER', label: 'Follow-up Later' },
    { id: 'GHOSTED', label: 'Ghosted' },
    { id: 'SOLD', label: 'Sold' },
    { id: 'LOST', label: 'Lost' },
  ];

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
              <h2 className="text-lg font-bold text-slate-900">Smart Prospect Import</h2>
              <p className="text-xs text-slate-500">Drop any pipeline file (Excel, CSV, PDF, screenshot) — AI extracts every prospect</p>
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
                  <div className="text-sm font-semibold text-slate-700">Drop a pipeline file here</div>
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
                    {busy ? <><Loader2 size={16} className="animate-spin" /> Extracting prospects...</> : <><Sparkles size={16} /> Extract with AI</>}
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
                    <div className="font-semibold">Found {edits.length} prospects ({result.summary.format})</div>
                    <div className="mt-0.5">
                      {result.extractedHint}
                      {counts.skipped > 0 && (
                        <span className="ml-2 text-amber-700 font-semibold">
                          · Pre-skipped {counts.skipped} that already exist in your tracker
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => { setResult(null); setEdits([]); }}
                    className="text-xs text-emerald-700 hover:text-emerald-900 underline">Try again</button>
                </div>
              </div>

              {/* Stage breakdown */}
              {Object.keys(counts.byStage).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-bold text-slate-500">Importing:</span>
                  {Object.entries(counts.byStage).map(([stageId, n]) => {
                    const s = stageOptions.find(x => x.id === stageId) || { label: stageId, color: '#64748b' };
                    return (
                      <span key={stageId} className="px-2 py-0.5 rounded font-semibold text-[11px]"
                        style={{ background: (s.color || '#64748b') + '22', color: s.color || '#64748b' }}>
                        {n} {s.label || stageId}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Bulk actions */}
              <div className="flex justify-end gap-2 text-xs">
                <button onClick={skipNone} className="border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold">Include all</button>
                <button onClick={skipAll} className="border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold">Skip all</button>
              </div>

              {/* Prospects table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                        <th className="px-2 py-2 text-center w-8">Keep</th>
                        <th className="px-2 py-2 text-left min-w-[140px]">Name</th>
                        <th className="px-2 py-2 text-left w-36">Phone</th>
                        <th className="px-2 py-2 text-left min-w-[160px]">Email</th>
                        <th className="px-2 py-2 text-left w-14">St</th>
                        <th className="px-2 py-2 text-left w-32">Stage</th>
                        <th className="px-2 py-2 text-left w-32">Source</th>
                        <th className="px-2 py-2 text-left w-44">Appointment</th>
                        <th className="px-2 py-2 text-right w-24">Quote</th>
                        <th className="px-2 py-2 text-left min-w-[200px]">Situation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edits.map((p, i) => {
                        const skipped = skipMask.has(i);
                        return (
                          <tr key={p._idx} className={`border-t border-slate-100 ${skipped ? 'bg-slate-50/60 opacity-40' : 'hover:bg-indigo-50/20'}`}>
                            <td className="px-2 py-1.5 text-center">
                              <input type="checkbox" checked={!skipped} onChange={() => toggleSkip(i)} className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={p.name || ''} onChange={e => setEdit(i, { name: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={p.phone || ''} onChange={e => setEdit(i, { phone: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={p.email || ''} onChange={e => setEdit(i, { email: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={p.state || ''} onChange={e => setEdit(i, { state: e.target.value.toUpperCase() })} maxLength={2} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={p.stage || ''} onChange={e => setEdit(i, { stage: e.target.value })} disabled={skipped}>
                                {stageOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <select className={inp} value={p.source || ''} onChange={e => setEdit(i, { source: e.target.value })} disabled={skipped}>
                                <option value="">—</option>
                                {PROSPECT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="datetime-local" className={inp} value={p.appointmentTime || ''} onChange={e => setEdit(i, { appointmentTime: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp + ' text-right'} value={p.quoteSize || ''} onChange={e => setEdit(i, { quoteSize: e.target.value })} disabled={skipped} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input className={inp} value={p.situation || ''} onChange={e => setEdit(i, { situation: e.target.value })} disabled={skipped}
                                title={p.situation} />
                            </td>
                          </tr>
                        );
                      })}
                      {edits.length === 0 && (
                        <tr><td colSpan="10" className="px-3 py-6 text-center text-slate-400 italic">No prospects extracted.</td></tr>
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
              <CheckCircle2 size={14} /> Import {counts.kept} prospect{counts.kept !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
