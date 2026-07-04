'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, LifeBuoy, Loader2, Check } from 'lucide-react';
import { TICKET_CATEGORIES } from '@/lib/tickets.mjs';
import { authedFetch } from '@/lib/authedFetch';
import { GlassModal } from './motion/MotionPrimitives';

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

/**
 * Agent-facing "Report an issue" button + modal. Submits a ticket to
 * POST /api/tickets with auto-captured, PHI-free context (current view, last
 * error, app build, user agent, timestamp) plus an optional screenshot.
 */
export default function ReportIssue({ currentView = '' }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('Upload');
  const [customCategory, setCustomCategory] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // ticket id on success
  const [error, setError] = useState('');

  const reset = () => { setCategory('Upload'); setCustomCategory(''); setDescription(''); setFile(null); setError(''); setDone(null); };
  const close = () => { setOpen(false); setTimeout(reset, 200); };

  const submit = async () => {
    setError('');
    if (!description.trim()) { setError('Please describe the problem.'); return; }
    if (category === 'Custom' && !customCategory.trim()) { setError('Please name the issue type.'); return; }
    setBusy(true);
    try {
      let appVersion = '';
      try { const r = await fetch('/api/version'); appVersion = (await r.json())?.version || ''; } catch { /* ignore */ }
      const context = {
        page: currentView || (typeof window !== 'undefined' ? window.location.pathname : ''),
        lastError: (typeof window !== 'undefined' && window.__lastError) || '',
        appVersion,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        ts: new Date().toISOString(),
      };
      const fd = new FormData();
      fd.append('category', category);
      if (category === 'Custom') fd.append('custom_category', customCategory.trim());
      fd.append('description', description.trim());
      fd.append('context', JSON.stringify(context));
      if (file) fd.append('screenshot', file);
      const res = await authedFetch('/api/tickets', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not submit. Please try again.'); setBusy(false); return; }
      setDone(data.id);
    } catch { setError('Could not submit. Please try again.'); }
    setBusy(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Report an issue"
        className="fixed bottom-5 left-5 z-40 flex items-center gap-2 bg-white border border-slate-200 shadow-lg rounded-full px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <LifeBuoy size={16} className="text-indigo-600" /> Report an issue
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <GlassModal open={open} onClose={close} maxWidth="max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Report an issue</h2>
              <button onClick={close} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>

            {done ? (
              <div className="p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3"><Check size={22} /></div>
                <p className="font-semibold text-slate-900">Ticket #{done} received — we&apos;re on it.</p>
                <p className="text-sm text-slate-500 mt-1">You&apos;ll get an email when it&apos;s resolved.</p>
                <button onClick={close} className="mt-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold">Done</button>
              </div>
            ) : (
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
                  <select className={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {category === 'Custom' && (
                  <input className={inp} placeholder="Name the issue type…" maxLength={120} value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} />
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">What happened?</label>
                  <textarea className={inp} rows={4} maxLength={4000} placeholder="Describe the problem and what you expected…" value={description} onChange={(e) => setDescription(e.target.value)} />
                  <p className="text-[11px] text-slate-400 mt-1">Please don&apos;t include client names, medications, diagnoses, or doctor names — just describe the problem.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Screenshot (optional)</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={close} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
                  <button onClick={submit} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60">
                    {busy ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : 'Submit ticket'}
                  </button>
                </div>
              </div>
            )}
        </GlassModal>,
        document.body,
      )}
    </>
  );
}
