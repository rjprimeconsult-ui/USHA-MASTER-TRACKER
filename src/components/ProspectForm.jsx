'use client';
import { useState, useEffect } from 'react';
import { X, Trash2, ArrowRight, Calendar } from 'lucide-react';
import {
  PROSPECT_SOURCES, PROSPECT_CRMS, PROSPECT_POLICY_TYPES,
} from '@/lib/constants';
import { US_STATES } from '@/lib/commission';
import { timezoneFromState, QUOTE_PRODUCTS } from '@/lib/prospects';
import { formatPhoneInput, formatCurrencyInput, formatDobInput, toDateTimeLocalInput, uid } from '@/lib/utils';
import { MoneyCell } from './motion/MotionPrimitives';

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

// ---- Quotes editor ----
// A prospect can hold multiple labeled quotes (e.g. PA $1,200.00 · PC $950.00).
// Each row = { id, product, amount }. Product is a dropdown of preset plan codes
// (or a custom typed code); amount uses MoneyCell so it always renders $0,000.00.
function QuoteRow({ row, onChange, onRemove }) {
  const presetMatch = QUOTE_PRODUCTS.some(p => p.code === row.product);
  const [customMode, setCustomMode] = useState(!!row.product && !presetMatch);
  const showCustom = customMode || (!!row.product && !presetMatch);

  return (
    <div className="flex items-center gap-2">
      {showCustom ? (
        <input
          className={inp + ' flex-1'}
          value={row.product || ''}
          onChange={e => onChange({ product: e.target.value })}
          placeholder="Plan code (e.g. PA)"
          autoFocus
        />
      ) : (
        <select
          className={inp + ' flex-1'}
          value={row.product || ''}
          onChange={e => {
            if (e.target.value === '__custom__') { setCustomMode(true); onChange({ product: '' }); }
            else onChange({ product: e.target.value });
          }}
        >
          <option value="">Plan…</option>
          {QUOTE_PRODUCTS.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
      )}
      <MoneyCell value={row.amount} onChange={(amount) => onChange({ amount })} width="w-36" />
      <button
        type="button"
        onClick={onRemove}
        className="text-slate-400 hover:text-red-600 p-1 flex-shrink-0"
        title="Remove quote"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function QuotesEditor({ quotes, legacyQuote, onChange, onClearLegacy }) {
  const rows = Array.isArray(quotes) ? quotes : [];
  const update = (id, patch) => onChange(rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { id: uid(), product: '', amount: 0 }]);
  const remove = (id) => onChange(rows.filter(r => r.id !== id));

  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">Quotes</label>
      {rows.length > 0 && (
        <div className="space-y-2 mb-2">
          {rows.map(r => (
            <QuoteRow key={r.id} row={r} onChange={(patch) => update(r.id, patch)} onRemove={() => remove(r.id)} />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg px-2 py-1"
      >
        + Add quote
      </button>
      {/* Legacy free-text quote (pre-structured-quotes records / AI imports).
          Shown so it's never stranded; clearing it once re-entered as a row. */}
      {legacyQuote && rows.length === 0 && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span>Existing quote: <span className="font-semibold text-slate-700">{legacyQuote}</span></span>
          <button type="button" onClick={onClearLegacy} className="text-slate-400 hover:text-red-600 underline">clear</button>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children, required }) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-1">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

// Normalize fields the form's native pickers can't otherwise display.
// appointmentTime: datetime-local renders any non-"YYYY-MM-DDTHH:mm" value as
// blank, so a malformed stored value could neither be seen nor cleared — the
// old value silently survived every save. Anything the list can display
// (lenient Date parse) normalizes successfully; true garbage becomes ''.
const normalizeForForm = (p) =>
  p ? { ...p, appointmentTime: toDateTimeLocalInput(p.appointmentTime) } : p;

export default function ProspectForm({ open, prospect, stages, customFields = [], onSave, onClose, onDelete, onConvertToLead }) {
  const [form, setForm] = useState(normalizeForForm(prospect));
  const [customSource, setCustomSource] = useState(!!prospect?.source && !PROSPECT_SOURCES.includes(prospect.source));

  useEffect(() => { setForm(normalizeForForm(prospect)); }, [prospect]);

  if (!open || !form) return null;

  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  // Custom lead-source: show a free-text input when the source isn't one of
  // the presets (or the agent explicitly picks "Custom…"). (customSource state
  // is declared with the other hooks above, before the early return.)
  const sourceIsCustom = customSource || (!!form.source && !PROSPECT_SOURCES.includes(form.source));
  const setCustom = (id, val) => setForm(f => ({ ...f, custom: { ...(f.custom || {}), [id]: val } }));

  const onStateChange = (state) => {
    set({ state, timezone: form.timezone || timezoneFromState(state) });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name?.trim() && !form.phone?.trim()) {
      alert('Name or phone is required.');
      return;
    }
    // Drop empty quote rows (no plan and no amount) so we never store blanks.
    const cleanQuotes = (form.quotes || []).filter(q => q && (q.product || Number(q.amount) > 0));
    onSave({ ...form, quotes: cleanQuotes });
  };

  const isSold = form.stage === 'SOLD';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md overlay-fade">
      <div className="bg-white/85 backdrop-blur-2xl border border-white/60 rounded-2xl shadow-2xl shadow-indigo-500/10 modal-pop w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {form.id && form.createdAt ? 'Edit Prospect' : 'New Prospect'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSold ? 'Mark sold to convert into a Lead.' : 'Track a prospect through your pipeline.'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" required>
              <input className={inp} value={form.name || ''} onChange={e => set({ name: e.target.value })} placeholder="John Doe" />
            </Field>
            <Field label="Phone" required>
              <input className={inp} value={form.phone || ''} onChange={e => set({ phone: formatPhoneInput(e.target.value) })} placeholder="(305) 555-1234" inputMode="tel" />
            </Field>
            <Field label="Email">
              <input type="email" className={inp} value={form.email || ''} onChange={e => set({ email: e.target.value })} placeholder="john@example.com" />
            </Field>
            <Field label="DOB(s)">
              <input className={inp} value={form.dobs || ''} onChange={e => set({ dobs: formatDobInput(e.target.value) })} placeholder="MM/DD/YYYY  (just type 01021962; comma-separate for family)" inputMode="numeric" />
            </Field>
          </div>

          {/* Location + classification */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="State">
              <select className={inp} value={form.state || ''} onChange={e => onStateChange(e.target.value)}>
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="ZIP">
              <input className={inp} value={form.zip || ''} onChange={e => set({ zip: e.target.value })} placeholder="33179" />
            </Field>
            <Field label="Time Zone">
              <input className={inp} value={form.timezone || ''} onChange={e => set({ timezone: e.target.value })} placeholder="ET / CT / MT / PT" />
            </Field>
            <Field label="Indv / Family">
              <select className={inp} value={form.indvOrFamily || 'Indv'} onChange={e => set({ indvOrFamily: e.target.value })}>
                <option value="Indv">Individual</option>
                <option value="Family">Family</option>
                <option value="Small Bizz">Small Bizz</option>
                <option value="Employer 5-10">Employer 5-10</option>
              </select>
            </Field>
          </div>

          {/* Numbers */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Income">
              <input className={inp} value={form.income || ''} onChange={e => set({ income: formatCurrencyInput(e.target.value) })} placeholder="$75,000" inputMode="numeric" />
            </Field>
            <Field label="Policy Type">
              <select className={inp} value={form.policyType || ''} onChange={e => set({ policyType: e.target.value })}>
                <option value="">—</option>
                {PROSPECT_POLICY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>

          {/* Quotes — multiple labeled plan quotes, auto-currency-formatted */}
          <QuotesEditor
            quotes={form.quotes}
            legacyQuote={form.quoteSize}
            onChange={(quotes) => set({ quotes })}
            onClearLegacy={() => set({ quoteSize: '' })}
          />

          {/* Source + CRM + Stage */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Lead Source">
              <select className={inp}
                value={sourceIsCustom ? '__custom__' : (form.source || '')}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '__custom__') { setCustomSource(true); set({ source: '' }); }
                  else { setCustomSource(false); set({ source: v }); }
                }}>
                <option value="">—</option>
                {PROSPECT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
            </Field>
            {sourceIsCustom && (
              <Field label="Custom source">
                <input className={inp} value={form.source || ''} onChange={e => set({ source: e.target.value })}
                  placeholder="Type your own source" autoFocus />
              </Field>
            )}
            {form.source === 'Referral' && (
              <Field label="Referrer">
                <input className={inp} value={form.referrer || ''} onChange={e => set({ referrer: e.target.value })} placeholder="Name of referrer" />
              </Field>
            )}
            <Field label="Lead Vendor">
              <input className={inp} value={form.leadVendor || ''} onChange={e => set({ leadVendor: e.target.value })}
                placeholder="e.g. Benepath · paid, Julio Fernandez Leads · exclusive" />
            </Field>
            <Field label="CRM">
              <select className={inp} value={form.crm || 'None'} onChange={e => set({ crm: e.target.value })}>
                {PROSPECT_CRMS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Stage">
              <select className={inp} value={form.stage || 'NEW'} onChange={e => set({ stage: e.target.value })}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          </div>

          {/* Workflow */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Appointment Date + Time">
              <input type="datetime-local" className={inp} value={form.appointmentTime || ''} onChange={e => set({ appointmentTime: e.target.value })} />
            </Field>
            <Field label="Last Contact">
              <input type="date" className={inp} value={form.lastContact || ''} onChange={e => set({ lastContact: e.target.value })} />
            </Field>
            <Field label="Desired Start Date">
              <input type="date" className={inp} value={form.startDate || ''} onChange={e => set({ startDate: e.target.value })} />
            </Field>
          </div>

          {/* Long-text */}
          <div className="grid grid-cols-1 gap-3">
            <Field label="Health Notes">
              <input
                className={inp}
                value={form.meds || ''}
                onChange={e => set({ meds: e.target.value })}
                placeholder="General impressions only — e.g. 'has health concerns'. NO medication names or diagnoses."
              />
            </Field>
            <Field label="Situation / Notes">
              <textarea className={inp} rows={2} value={form.situation || ''} onChange={e => set({ situation: e.target.value })} placeholder="Anything that helps you remember the conversation" />
            </Field>
            <Field label="Next Steps">
              <input className={inp} value={form.nextSteps || ''} onChange={e => set({ nextSteps: e.target.value })} placeholder="e.g. Call back Tue 3pm with quote" />
            </Field>
          </div>

          {/* Custom fields (configured per agent) */}
          {customFields.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              {customFields.map(cf => {
                const v = form.custom?.[cf.id] ?? '';
                if (cf.type === 'dropdown') {
                  return (
                    <Field key={cf.id} label={cf.label}>
                      <select className={inp} value={v} onChange={e => setCustom(cf.id, e.target.value)}>
                        <option value="">—</option>
                        {(cf.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                  );
                }
                return (
                  <Field key={cf.id} label={cf.label}>
                    <input
                      type={cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text'}
                      className={inp}
                      value={v}
                      onChange={e => setCustom(cf.id, e.target.value)}
                    />
                  </Field>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-200">
            <div className="flex gap-2">
              {onDelete && form.createdAt && (
                <button type="button" onClick={() => { if (confirm('Delete this prospect?')) onDelete(form.id); }}
                  className="text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {isSold && onConvertToLead && (
                <button type="button" onClick={() => onConvertToLead(form)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5">
                  <ArrowRight size={14} /> Save & Convert to Lead
                </button>
              )}
              <button type="button" onClick={onClose}
                className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">
                Cancel
              </button>
              <button type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold">
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
