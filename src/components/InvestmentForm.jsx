'use client';
import { useState, useEffect } from 'react';
import { X, Trash2, Calendar, Sparkles } from 'lucide-react';
import { getWeekStart, weekRangeLabel, today, fmt, fmt2 } from '@/lib/utils';
import { GlassModal } from './motion/MotionPrimitives';

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
    {children}
  </div>
);
const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export default function InvestmentForm({ open, entry, autoHelper, onSave, onClose, onDelete }) {
  const [form, setForm] = useState(entry);
  const [dateInput, setDateInput] = useState(entry?.weekStart || today());

  useEffect(() => {
    setForm(entry);
    setDateInput(entry?.weekStart || today());
  }, [entry]);

  if (!open || !form) return null;
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const handleDate = (d) => {
    if (!d) return;
    setDateInput(d);
    set({ weekStart: getWeekStart(d) });
  };

  // Earned = auto-synced commissions from Issued deals only.
  // Advances/Paid below are record-keeping fields and don't feed the Earned/Net summary.
  const invested = (form.leadSpend || 0) + (form.crmWeekly || 0) + (form.crmDaily || 0);
  const earned = autoHelper?.commission || 0;
  const net = earned - invested;

  return (
    <GlassModal open maxWidth="max-w-lg" zIndexClass="z-40" className="max-h-[90vh] overflow-auto">
        <div className="px-6 py-4 border-b border-slate-200/60 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-900">{form._existing ? 'Edit Weekly Investment' : 'Log Weekly Investment'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          <Field label="Pick any date in the week">
            <input type="date" className={inp} value={dateInput} onChange={e => handleDate(e.target.value)} />
          </Field>

          {form.weekStart && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 text-sm text-indigo-900 flex items-start gap-2">
              <Calendar size={16} className="mt-0.5 flex-shrink-0" />
              <span>Logs as <b>{weekRangeLabel(form.weekStart)}</b> (weeks run Fri → Thu).</span>
            </div>
          )}

          {autoHelper && autoHelper.deals > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-sm text-emerald-900 flex items-start gap-2">
              <Sparkles size={16} className="mt-0.5 flex-shrink-0" />
              <span>From your Closed Deals: <b>{autoHelper.deals} deal{autoHelper.deals !== 1 ? 's' : ''}</b> — commissions <b>{fmt2(autoHelper.commission)}</b>{typeof autoHelper.leadCosts === 'number' ? <>, lead costs <b>{fmt2(autoHelper.leadCosts)}</b></> : null}.</span>
            </div>
          )}

          {/* INVESTMENTS */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="text-xs font-bold text-slate-500 tracking-wider">INVESTMENTS</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Lead Spend ($)">
                <input type="number" step="0.01" className={`${inp} bg-white`} value={form.leadSpend} onChange={e => set({ leadSpend: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="CRM Weekly ($)">
                <input type="number" step="0.01" className={`${inp} bg-white`} value={form.crmWeekly} onChange={e => set({ crmWeekly: parseFloat(e.target.value) || 0 })} />
              </Field>
            </div>
            <Field label="CRM Daily — total for the week ($)">
              <input type="number" step="0.01" className={`${inp} bg-white`} value={form.crmDaily} onChange={e => set({ crmDaily: parseFloat(e.target.value) || 0 })} />
            </Field>
            <div className="text-xs text-slate-500 flex items-start gap-1.5 pt-1">
              <Sparkles size={12} className="mt-0.5 text-emerald-600 flex-shrink-0" />
              <span>Earnings are pulled automatically from <b>Issued</b> leads closed in this week — no manual entry needed.</span>
            </div>
          </div>

          <Field label="Notes (optional)">
            <textarea className={inp} rows="2" value={form.notes || ''} onChange={e => set({ notes: e.target.value })} />
          </Field>

          {/* Live summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-slate-500">Invested</div>
              <div className="text-xl font-bold text-red-600 mt-0.5">{fmt(invested)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Earned</div>
              <div className="text-xl font-bold text-emerald-700 mt-0.5">{fmt(earned)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Net</div>
              <div className={`text-xl font-bold mt-0.5 ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(net)}</div>
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
            <button onClick={() => onSave(form)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Log Investment</button>
          </div>
        </div>
    </GlassModal>
  );
}
