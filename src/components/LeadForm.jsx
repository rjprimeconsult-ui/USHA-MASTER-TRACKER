'use client';
import { useState, useEffect, useMemo } from 'react';
import { X, Plus, Trash2, Package, Calculator, Wand2 } from 'lucide-react';
import {
  SOURCES, OWNERS, STAGES, CRMS, CAMPAIGNS, LEAD_CATEGORIES,
  MAIN_PRODUCTS, ASSOCIATION_PLANS, ADDON_PRODUCTS,
  compatibleAssociations, isPricedAssociation, ASSOCIATION_PRICING,
  productPremium,
} from '@/lib/constants';
import { US_STATES, projectCommission, DEFAULT_ADVANCE_MONTHS } from '@/lib/commission';
import { today, fmt2 } from '@/lib/utils';

const Field = ({ label, children, required }) => (
  <div>
    <label className="block text-xs font-medium text-slate-700 mb-1">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export default function LeadForm({ open, lead, tier = 'WA', onSave, onClose, onDelete }) {
  const [form, setForm] = useState(lead);
  const [addonPick, setAddonPick] = useState('');

  useEffect(() => {
    setForm(lead);
    setAddonPick('');
  }, [lead]);

  // Live commission projection — must run every render (hooks rule)
  const projection = useMemo(() => projectCommission({
    mainProduct: form?.mainProduct,
    mainProductPremium: form?.mainProductPremium,
    products: form?.products || [],
    state: form?.state,
    advanceMonths: form?.advanceMonths ?? DEFAULT_ADVANCE_MONTHS,
  }, tier), [form?.mainProduct, form?.mainProductPremium, form?.products, form?.state, form?.advanceMonths, tier]);

  if (!open || !form) return null;
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const onMainChange = (mainProduct) => {
    const compat = compatibleAssociations(mainProduct);
    const keepAssoc = !form.associationPlan || compat.includes(form.associationPlan);
    set({
      mainProduct,
      associationPlan: keepAssoc ? form.associationPlan : '',
    });
  };

  const onAssocChange = (associationPlan) => {
    const patch = { associationPlan };
    // Set association start date retroactively to the close/submission date
    // whenever the deal is already in a post-close state with a priced association
    if ((form.stage === 'Pending' || form.stage === 'Issued')
        && associationPlan && isPricedAssociation(associationPlan) && !form.associationStartDate) {
      patch.associationStartDate = form.closedDate || today();
    }
    set(patch);
  };

  const onStageChange = (stage) => {
    const patch = { stage, lastTouch: today() };
    // When a deal first becomes Submitted, stamp closedDate and (retroactively)
    // the association start date. Issued inherits whatever Submitted already set.
    if (stage === 'Pending' || stage === 'Issued') {
      if (!form.closedDate) patch.closedDate = today();
      if (form.associationPlan && isPricedAssociation(form.associationPlan) && !form.associationStartDate) {
        patch.associationStartDate = patch.closedDate || form.closedDate || today();
      }
    }
    set(patch);
  };

  const commitAddon = () => {
    if (!addonPick) return;
    const addon = ADDON_PRODUCTS.find(p => p.id === addonPick);
    if (!addon) return;
    set({ products: [...form.products, { id: addon.id, premium: addon.premium }] });
    setAddonPick('');
  };

  const removeAddon = (idx) => {
    const next = form.products.slice();
    next.splice(idx, 1);
    set({ products: next });
  };

  const updateAddon = (idx, patch) => {
    const next = form.products.slice();
    next[idx] = { ...next[idx], ...patch };
    set({ products: next });
  };

  const handleSave = () => {
    if (!form.name || !form.name.trim()) {
      alert('Name is required');
      return;
    }
    onSave(form);
  };

  const compat = compatibleAssociations(form.mainProduct);
  // All 5 stages are post-close — always show the closed/sold date
  const showClosedDate = true;

  const addonTotal = (form.products || []).reduce((s, p) => s + (p.premium || 0), 0);
  const totalMonthlyPremium = (form.mainProductPremium || 0) + productPremium(form.associationPlan) + addonTotal;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-40 flex items-center justify-center p-4">
      <div className="bg-white/90 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-auto shadow-2xl shadow-indigo-500/10">
        <div className="sticky top-0 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="text-lg font-semibold text-slate-900">{form._existing ? 'Edit Lead' : 'New Lead'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <Field label="Name" required>
            <input className={inp} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Client full name" />
          </Field>

          {/* Email / Phone / Age */}
          <div className="grid grid-cols-[1fr_1fr_80px] gap-4">
            <Field label="Email">
              <input className={inp} value={form.email} onChange={e => set({ email: e.target.value })} placeholder="client@example.com" />
            </Field>
            <Field label="Phone">
              <input className={inp} value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="(555) 555-5555" />
            </Field>
            <Field label="Age">
              <div className="flex items-stretch gap-1">
                <input
                  type="number"
                  min="0"
                  max="120"
                  className={inp + ' flex-1 min-w-0'}
                  value={form.age || 0}
                  onChange={e => {
                    const n = parseInt(e.target.value, 10) || 0;
                    // When agent enters an exact age, auto-derive the bucket
                    // so taken-rate math stays consistent and the picker UI
                    // reflects the entered value.
                    set({ age: n, ageBucket: n > 0 ? (n > 50 ? 'OVER_50' : 'UNDER_50') : (form.ageBucket || null) });
                  }}
                  title="Enter the exact age, or skip and use the buckets below."
                />
                <button
                  type="button"
                  onClick={() => set({ age: 0, ageBucket: form.ageBucket === 'UNDER_50' ? null : 'UNDER_50' })}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition border ${
                    form.ageBucket === 'UNDER_50' || ((form.age || 0) > 0 && (form.age || 0) <= 50)
                      ? 'bg-slate-100 border-slate-300 text-slate-700'
                      : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'
                  }`}
                  title="Quick pick — use when you don't track exact age. Counts as under 50 for taken-rate math."
                >
                  &lt;50
                </button>
                <button
                  type="button"
                  onClick={() => set({ age: 0, ageBucket: form.ageBucket === 'OVER_50' ? null : 'OVER_50' })}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition border ${
                    form.ageBucket === 'OVER_50' || (form.age || 0) > 50
                      ? 'bg-amber-100 border-amber-300 text-amber-800'
                      : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700'
                  }`}
                  title="Quick pick — use when you don't track exact age. Excluded from taken-rate denominator on UW products (USHA senior-market rule)."
                >
                  &gt;50
                </button>
              </div>
            </Field>
          </div>

          {/* Stage / Source / Owner */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Stage">
              <select className={inp} value={form.stage} onChange={e => onStageChange(e.target.value)}>
                {STAGES.map(o => <option key={o.id}>{o.id}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select className={inp} value={form.source} onChange={e => set({ source: e.target.value })}>
                {SOURCES.map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <select className={inp} value={form.owner} onChange={e => set({ owner: e.target.value })}>
                {OWNERS.map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
          </div>

          {/* Category / CRM / Campaign */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Lead Category">
              <select className={inp} value={form.leadCategory} onChange={e => set({ leadCategory: e.target.value })}>
                {LEAD_CATEGORIES.map(o => <option key={o.id}>{o.id}</option>)}
              </select>
            </Field>
            <Field label="CRM">
              <select className={inp} value={form.crm} onChange={e => set({ crm: e.target.value })}>
                {CRMS.map(o => <option key={o.id}>{o.id}</option>)}
              </select>
            </Field>
            <Field label="Campaign">
              <select className={inp} value={form.campaign} onChange={e => set({ campaign: e.target.value })}>
                {CAMPAIGNS.map(o => <option key={o.id}>{o.id}</option>)}
              </select>
            </Field>
          </div>

          {/* Day Purchased / State / Closed Date */}
          <div className={`grid ${showClosedDate ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
            <Field label="Day Purchased">
              <input type="date" className={inp} value={form.dateAdded} onChange={e => set({ dateAdded: e.target.value })} />
            </Field>
            <Field label="State (affects some rates)">
              <select className={inp} value={form.state || ''} onChange={e => set({ state: e.target.value })}>
                <option value="">— select —</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            {showClosedDate && (
              <Field label="Date Sold / Closed">
                <input type="date" className={inp} value={form.closedDate || ''} onChange={e => set({ closedDate: e.target.value || null })} />
              </Field>
            )}
          </div>

          {/* PRODUCTS / POLICIES ON THIS DEAL */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600 tracking-wider">
              <Package size={14} /> PRODUCTS / POLICIES ON THIS DEAL
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Main Product">
                <select className={`${inp} bg-white`} value={form.mainProduct} onChange={e => onMainChange(e.target.value)}>
                  <option value="">— none —</option>
                  {MAIN_PRODUCTS.map(p => <option key={p.id}>{p.id}</option>)}
                </select>
              </Field>
              <Field label="Main Product Monthly Premium ($)">
                <input
                  type="number"
                  step="0.01"
                  className={`${inp} bg-white`}
                  value={form.mainProductPremium || 0}
                  onChange={e => set({ mainProductPremium: parseFloat(e.target.value) || 0 })}
                  placeholder="e.g. 289.95"
                  disabled={!form.mainProduct}
                />
              </Field>
            </div>

            <Field label="Association Plan">
              <select className={`${inp} bg-white`} value={form.associationPlan} onChange={e => onAssocChange(e.target.value)}>
                <option value="">— none —</option>
                {compat.map(id => {
                  const priced = ASSOCIATION_PRICING[id];
                  return <option key={id} value={id}>{id}{priced ? ` — $${priced.premium}/mo ($${priced.commission} comm)` : ''}</option>;
                })}
              </select>
            </Field>

            <Field label="Add-ons">
              <div className="flex gap-2">
                <select
                  className={`${inp} bg-white flex-1`}
                  value={addonPick}
                  onChange={e => setAddonPick(e.target.value)}
                >
                  <option value="">Add add-on…</option>
                  {ADDON_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
                <button
                  onClick={commitAddon}
                  disabled={!addonPick}
                  className={`px-3 rounded-lg text-sm font-medium flex items-center gap-1 ${addonPick ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-indigo-200 text-white cursor-not-allowed'}`}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
            </Field>

            {form.products.length > 0 && (
              <div className="space-y-2">
                {form.products.map((p, i) => (
                  <div key={i} className="flex gap-2 items-center bg-white border border-slate-200 rounded-lg p-2">
                    <span className="flex-1 text-sm text-slate-700">{p.id}</span>
                    <span className="text-xs text-slate-400">$</span>
                    <input type="number" step="0.01" className="w-24 border border-slate-200 rounded px-2 py-1 text-sm" value={p.premium} onChange={e => updateAddon(i, { premium: parseFloat(e.target.value) || 0 })} />
                    <button onClick={() => removeAddon(i)} className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Pay type toggle */}
            <Field label="Pay type">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => set({ payType: 'advance' })}
                  className={`rounded-lg border p-2 text-left transition ${form.payType === 'advance' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div className={`text-sm font-semibold ${form.payType === 'advance' ? 'text-indigo-900' : 'text-slate-900'}`}>Advance</div>
                  <div className="text-[11px] text-slate-500">Upfront lump-sum payout (monthly × advance months)</div>
                </button>
                <button
                  type="button"
                  onClick={() => set({ payType: 'as_earned' })}
                  className={`rounded-lg border p-2 text-left transition ${form.payType === 'as_earned' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div className={`text-sm font-semibold ${form.payType === 'as_earned' ? 'text-indigo-900' : 'text-slate-900'}`}>As Earned</div>
                  <div className="text-[11px] text-slate-500">No upfront — paid monthly as client pays premium</div>
                </button>
              </div>
            </Field>

            {/* Advance Months — only visible in Advance mode */}
            {form.payType === 'advance' && (
              <Field label="Advance Months">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    className={`${inp} bg-white`}
                    value={form.advanceMonths ?? DEFAULT_ADVANCE_MONTHS}
                    onChange={e => set({ advanceMonths: parseFloat(e.target.value) || 0 })}
                  />
                  <span className="text-xs text-slate-500 whitespace-nowrap">× monthly commission = upfront advance</span>
                </div>
              </Field>
            )}

            <div className="border-t border-slate-200 pt-3 space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-600">Total monthly premium:</span>
                <span className="font-bold text-indigo-600">{fmt2(totalMonthlyPremium)}</span>
              </div>
            </div>

            {/* Commission projection moved to its own tab — your weekly/monthly
                statements remain the source of truth for actual income. Use the
                Calculator tab to explore tier comparisons + commission splits. */}
          </div>

          {/* Price / Advance-or-Monthly */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (lead cost $)">
              <input type="number" step="0.01" className={inp} value={form.leadCost} onChange={e => set({ leadCost: parseFloat(e.target.value) || 0 })} />
            </Field>
            <Field label={form.payType === 'as_earned' ? 'Monthly residual ($)' : 'Advance ($)'}>
              <input type="number" step="0.01" className={inp} value={form.dealValue} onChange={e => set({ dealValue: parseFloat(e.target.value) || 0 })} />
            </Field>
          </div>

          {/* Family members on the policy — protects against partial-issuance
              commission loss. When the primary is declined but the spouse or
              a dependent gets approved, the weekly statement comes back under
              THEIR name. Statement matching looks up all names on the lead. */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-amber-900 tracking-wide">FAMILY MEMBERS ON POLICY</div>
                <div className="text-[11px] text-amber-700 mt-0.5">
                  Spouse + dependents. If the primary is declined but a family member is partially issued,
                  the statement comes back under their name — adding them here makes sure you don&apos;t miss the commission.
                </div>
              </div>
              <button
                type="button"
                onClick={() => set({ dependents: [...(form.dependents || []), { name: '', relationship: 'spouse', dob: '' }] })}
                className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-1.5 flex items-center gap-1 flex-shrink-0"
              >
                <Plus size={12} /> Add
              </button>
            </div>
            {(form.dependents || []).length === 0 ? (
              <div className="text-xs text-amber-700/70 italic">No family members added.</div>
            ) : (
              <div className="space-y-1.5">
                {(form.dependents || []).map((dep, i) => (
                  <div key={i} className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2 py-1.5">
                    <input
                      className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-1 text-sm"
                      placeholder="Full name"
                      value={dep.name || ''}
                      onChange={e => set({
                        dependents: form.dependents.map((d, j) => j === i ? { ...d, name: e.target.value } : d)
                      })}
                    />
                    <select
                      className="border border-slate-200 rounded px-2 py-1 text-xs w-24"
                      value={dep.relationship || 'spouse'}
                      onChange={e => set({
                        dependents: form.dependents.map((d, j) => j === i ? { ...d, relationship: e.target.value } : d)
                      })}
                    >
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="date"
                      className="border border-slate-200 rounded px-2 py-1 text-xs w-36"
                      value={dep.dob || ''}
                      onChange={e => set({
                        dependents: form.dependents.map((d, j) => j === i ? { ...d, dob: e.target.value } : d)
                      })}
                      title="Date of birth (optional)"
                    />
                    <button
                      type="button"
                      onClick={() => set({ dependents: form.dependents.filter((_, j) => j !== i) })}
                      className="text-red-500 hover:bg-red-50 p-1 rounded"
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <Field label="Notes">
            <textarea className={inp} rows="3" value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Anything worth remembering about this lead…" />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-between rounded-b-2xl">
          <div>
            {onDelete && form._existing && (
              <button onClick={() => onDelete(form.id)} className="text-red-600 hover:text-red-700 text-sm font-medium flex items-center gap-1">
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
            <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
              {form._existing ? 'Save Changes' : 'Add Lead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
