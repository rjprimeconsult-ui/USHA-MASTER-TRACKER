'use client';
import { useState, useEffect } from 'react';
import { X, Trash2, Info } from 'lucide-react';
import { OWNERS } from '@/lib/constants';

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
    {children}
  </div>
);

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export default function ActivityForm({ open, entry, onSave, onClose, onDelete }) {
  const [form, setForm] = useState(entry);

  useEffect(() => { setForm(entry); }, [entry]);

  if (!open || !form) return null;
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const dialsPerClose = form.closes > 0 ? Math.round(form.dials / form.closes) : null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-40 flex items-center justify-center p-4">
      <div className="bg-white/90 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto shadow-2xl shadow-indigo-500/10">
        <div className="px-6 py-4 border-b border-slate-200/60 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-900">{form._existing ? 'Edit Daily Activity' : 'Log Daily Activity'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 text-sm text-indigo-900 flex items-start gap-2">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>Pick any date — past, present, or historical. Backfill Jan–Dec at will.</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Date">
              <input type="date" className={inp} value={form.date} onChange={e => set({ date: e.target.value })} />
            </Field>
            <Field label="Agent">
              <select className={inp} value={form.agent} onChange={e => set({ agent: e.target.value })}>
                {OWNERS.map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>

            <Field label="Dials / Calls">
              <input type="number" min="0" className={inp} value={form.dials} onChange={e => set({ dials: parseInt(e.target.value) || 0 })} />
            </Field>
            <Field label="Appointments Set">
              <input type="number" min="0" className={inp} value={form.appointments} onChange={e => set({ appointments: parseInt(e.target.value) || 0 })} />
            </Field>

            <Field label="Pitches / Presentations">
              <input type="number" min="0" className={inp} value={form.pitches} onChange={e => set({ pitches: parseInt(e.target.value) || 0 })} />
            </Field>
            <Field label="Closes">
              <input type="number" min="0" className={inp} value={form.closes} onChange={e => set({ closes: parseInt(e.target.value) || 0 })} />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <textarea className={inp} rows="3" value={form.notes || ''} onChange={e => set({ notes: e.target.value })} />
          </Field>

          {/* Dials per Close card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">Dials per Close</div>
            <div className="text-3xl font-bold text-indigo-600">
              {dialsPerClose !== null ? dialsPerClose : <span className="text-slate-300">—</span>}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-between bg-slate-50 rounded-b-2xl">
          <div>
            {onDelete && form._existing && (
              <button onClick={() => onDelete(form.id)} className="text-red-600 text-sm font-medium flex items-center gap-1 hover:text-red-700">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
            <button onClick={() => onSave(form)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Log Activity</button>
          </div>
        </div>
      </div>
    </div>
  );
}
