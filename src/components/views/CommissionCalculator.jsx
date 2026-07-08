'use client';
import { useState, useRef, useMemo } from 'react';
import {
  Calculator, Sparkles, Trash2, RefreshCw, Users, DollarSign, Image as ImageIcon,
  Loader2, Info, AlertCircle, ChevronRight, Plus, X,
} from 'lucide-react';
import {
  TIERS, projectCommission, stateOptions, DEFAULT_ADVANCE_MONTHS,
} from '@/lib/commission';
import { MAIN_PRODUCTS, ADDON_PRODUCTS, ASSOCIATION_PLANS } from '@/lib/constants';
import { fmt2 } from '@/lib/utils';
import { extractDealFromImage } from '@/lib/screenshotExtract';

/**
 * Standalone Commission Calculator
 *
 * Educational/exploratory tool — never writes to leads, books, or platforms.
 * Three blocks:
 *   1. Deal inputs (manual or screenshot-prefilled)
 *   2. Tier comparison — same deal across WA / CA / FTA / FSL side-by-side
 *   3. Commission splitter — 70/30 / 50/50 / custom for paying out a
 *      qualifying agent
 *
 * The agent's saved tier (`agent_tier_v1`) is the default for the "selected
 * tier" pick, but they can change it freely here without touching the saved
 * value. That's why we accept `defaultTier` as a prop instead of reading
 * storage directly.
 */

const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

// ----- Initial state helper -----
const makeBlankDeal = (defaultTier = 'WA') => ({
  state: '',
  mainProduct: 'PREMIER ADVANTAGE',
  mainProductPremium: 0,
  associationPlan: '',
  products: [], // [{ id, premium }]
  payType: 'advance',  // 'advance' | 'as_earned'
  advanceMonths: DEFAULT_ADVANCE_MONTHS,
  selectedTier: defaultTier,
});

// ----- Splitter presets -----
const SPLIT_PRESETS = [
  { id: 'none',  label: 'No split',         yours: 100, theirs: 0 },
  { id: '70_30', label: '70 / 30 (closer)', yours: 70,  theirs: 30 },
  { id: '50_50', label: '50 / 50',          yours: 50,  theirs: 50 },
  { id: '30_70', label: '30 / 70 (qualifier)', yours: 30, theirs: 70 },
];

export default function CommissionCalculator({ defaultTier = 'WA', onSaveDefaultTier }) {
  const [deal, setDeal] = useState(() => makeBlankDeal(defaultTier));
  const [splitId, setSplitId] = useState('none');
  const [customSplit, setCustomSplit] = useState(70); // your % for "custom"
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');
  const fileRef = useRef(null);

  const set = (patch) => setDeal(d => ({ ...d, ...patch }));

  // ----- Math: project across every tier -----
  const tierResults = useMemo(() => {
    return TIERS.map(t => {
      const r = projectCommission({
        mainProduct: deal.mainProduct,
        mainProductPremium: Number(deal.mainProductPremium) || 0,
        products: deal.products,
        state: deal.state,
        advanceMonths: Number(deal.advanceMonths) || DEFAULT_ADVANCE_MONTHS,
      }, t.id);
      return { tier: t, ...r, annual: r.monthlyCommission * 12 };
    });
  }, [deal]);

  const selectedResult = tierResults.find(r => r.tier.id === deal.selectedTier) || tierResults[0];

  // ----- Math: splitter -----
  const splitYourPct = splitId === 'custom' ? Number(customSplit) || 0
    : (SPLIT_PRESETS.find(p => p.id === splitId)?.yours ?? 100);
  const splitTheirPct = 100 - splitYourPct;

  const totalForSplit = deal.payType === 'advance'
    ? selectedResult?.advancePayout || 0
    : (selectedResult?.monthlyCommission || 0) * 12;
  const yourShare = totalForSplit * (splitYourPct / 100);
  const theirShare = totalForSplit * (splitTheirPct / 100);

  // ----- Add-on management -----
  const availableAddons = ADDON_PRODUCTS.filter(p => !deal.products.some(x => x.id === p.id));
  const [pendingAddon, setPendingAddon] = useState('');

  const addAddon = () => {
    if (!pendingAddon) return;
    const def = ADDON_PRODUCTS.find(p => p.id === pendingAddon);
    set({
      products: [...deal.products, { id: pendingAddon, premium: def?.premium || 0 }],
    });
    setPendingAddon('');
  };
  const removeAddon = (id) => {
    set({ products: deal.products.filter(p => p.id !== id) });
  };
  const updateAddonPremium = (id, premium) => {
    set({
      products: deal.products.map(p => p.id === id ? { ...p, premium: Number(premium) || 0 } : p),
    });
  };

  // ----- Screenshot pre-fill -----
  const handleScreenshot = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setScreenshotBusy(true); setScreenshotError('');
    try {
      const { parsed } = await extractDealFromImage(f);
      // Pre-fill from extraction without clobbering tier selection
      const patch = {};
      if (parsed.mainProduct) patch.mainProduct = parsed.mainProduct;
      if (parsed.mainProductPremium) patch.mainProductPremium = parsed.mainProductPremium;
      if (parsed.state) patch.state = parsed.state;
      if (parsed.associationPlan) patch.associationPlan = parsed.associationPlan;
      if (Array.isArray(parsed.products) && parsed.products.length > 0) {
        patch.products = parsed.products.map(p => ({
          id: p.id,
          premium: Number(p.premium) || (ADDON_PRODUCTS.find(a => a.id === p.id)?.premium || 0),
        }));
      }
      set(patch);
    } catch (err) {
      setScreenshotError('Couldn’t read screenshot: ' + (err.message || 'unknown error'));
    } finally {
      setScreenshotBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const reset = () => {
    setDeal(makeBlankDeal(deal.selectedTier));
    setSplitId('none');
  };

  // ----- Render -----
  const totalMonthlyPremium =
    Number(deal.mainProductPremium || 0) +
    deal.products.reduce((s, p) => s + Number(p.premium || 0), 0);

  return (
    <div className="space-y-5">
      {/* Header + disclaimer */}
      <div className="bg-gradient-to-br from-indigo-50 via-violet-50 to-pink-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg flex-shrink-0">
          <Calculator size={18} />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-900">Commission Calculator</h2>
          <p className="text-xs text-slate-600 mt-0.5 flex items-start gap-1">
            <Info size={12} className="mt-0.5 flex-shrink-0 text-indigo-600" />
            <span>Educational tool — projections here <b>do not</b> affect any lead, book, or statement. Real commissions come from your weekly/monthly statements. Use this to compare tiers and play out splits without touching your data.</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ===== Left: deal inputs ===== */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <DollarSign size={16} className="text-emerald-600" /> Deal inputs
            </h3>
            <div className="flex items-center gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleScreenshot}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={screenshotBusy}
                title="Drop a USHA portal screenshot — AI fills in the deal fields"
                className="text-xs flex items-center gap-1 border border-violet-200 hover:border-violet-400 hover:bg-violet-50 text-violet-700 rounded-lg px-2.5 py-1 transition disabled:opacity-50"
              >
                {screenshotBusy ? <Loader2 size={11} className="animate-spin" /> : <ImageIcon size={11} />}
                Import screenshot
              </button>
              <button
                onClick={reset}
                title="Clear all inputs"
                className="text-xs flex items-center gap-1 border border-slate-200 hover:border-slate-400 bg-white text-slate-600 rounded-lg px-2.5 py-1 transition"
              >
                <RefreshCw size={11} /> Reset
              </button>
            </div>
          </div>

          {screenshotError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex items-center gap-1.5">
              <AlertCircle size={12} /> {screenshotError}
            </div>
          )}

          {/* State + Tier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">State</label>
              <select className={inp} value={deal.state} onChange={e => set({ state: e.target.value })}>
                <option value="">— pick —</option>
                {stateOptions(deal.state).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pay type</label>
              <select className={inp} value={deal.payType} onChange={e => set({ payType: e.target.value })}>
                <option value="advance">Advance (lump-sum upfront)</option>
                <option value="as_earned">As Earned (monthly residual)</option>
              </select>
            </div>
          </div>

          {/* Main product */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Main product</label>
              <select className={inp} value={deal.mainProduct} onChange={e => set({ mainProduct: e.target.value })}>
                {MAIN_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Main premium ($/mo)</label>
              <input type="number" step="0.01" className={inp}
                value={deal.mainProductPremium}
                onChange={e => set({ mainProductPremium: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>

          {/* Association plan */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Association plan</label>
            <select className={inp} value={deal.associationPlan} onChange={e => set({ associationPlan: e.target.value })}>
              <option value="">— none —</option>
              {ASSOCIATION_PLANS.map(p => <option key={p.id} value={p.id}>{p.id} {p.premium > 0 ? `— $${p.premium.toFixed(2)}/mo` : ''}</option>)}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">Association is its own monthly stream — not included in tier-rate math here.</p>
          </div>

          {/* Add-ons */}
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Add-ons</label>
            <div className="flex gap-2">
              <select className={inp + ' flex-1'} value={pendingAddon} onChange={e => setPendingAddon(e.target.value)}>
                <option value="">{availableAddons.length === 0 ? 'All add-ons added' : 'Add an add-on…'}</option>
                {availableAddons.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
              </select>
              <button
                onClick={addAddon}
                disabled={!pendingAddon}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-semibold flex items-center gap-1"
              >
                <Plus size={14} /> Add
              </button>
            </div>
            {deal.products.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {deal.products.map(p => (
                  <div key={p.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                    <div className="flex-1 text-sm font-medium text-slate-900 truncate">{p.id}</div>
                    <div className="text-xs text-slate-500">$</div>
                    <input
                      type="number"
                      step="0.01"
                      value={p.premium}
                      onChange={e => updateAddonPremium(p.id, e.target.value)}
                      className="w-20 border border-slate-200 rounded px-1.5 py-0.5 text-sm text-right"
                    />
                    <button onClick={() => removeAddon(p.id)} className="text-slate-400 hover:text-red-600 p-1">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advance months — only relevant when payType=advance */}
          {deal.payType === 'advance' && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Advance months <span className="text-slate-400">(typical: 7.5 — your contract may differ)</span>
              </label>
              <input type="number" step="0.5" className={inp + ' max-w-[150px]'}
                value={deal.advanceMonths}
                onChange={e => set({ advanceMonths: parseFloat(e.target.value) || DEFAULT_ADVANCE_MONTHS })}
              />
            </div>
          )}

          {/* Live total */}
          <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-sm">
            <span className="text-slate-600">Total monthly premium:</span>
            <span className="font-bold text-indigo-600">{fmt2(totalMonthlyPremium)}</span>
          </div>
        </div>

        {/* ===== Right: tier comparison ===== */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Sparkles size={16} className="text-violet-600" /> Compare across contract tiers
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              {deal.selectedTier !== defaultTier && onSaveDefaultTier && (
                <button
                  onClick={() => onSaveDefaultTier(deal.selectedTier)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md px-2 py-1 text-[10px] uppercase tracking-wide transition"
                  title={`Save ${deal.selectedTier} as your default tier`}
                >
                  Save as my default
                </button>
              )}
              <span>
                <b className="text-slate-700">{defaultTier}</b> is your saved default
              </span>
            </div>
          </div>
          <div className="overflow-x-auto -mx-4 px-4 scroll-fade-x">
            <table className="w-full text-sm premium-table">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-200">
                  <th className="py-2 px-2 text-left">Tier</th>
                  <th className="py-2 px-2 text-right">Monthly</th>
                  <th className="py-2 px-2 text-right">Annual</th>
                  <th className="py-2 px-2 text-right">{deal.payType === 'advance' ? `Advance (${deal.advanceMonths}mo)` : 'Residual'}</th>
                </tr>
              </thead>
              <tbody>
                {tierResults.map((r) => {
                  const isSelected = r.tier.id === deal.selectedTier;
                  const isDefault = r.tier.id === defaultTier;
                  return (
                    <tr
                      key={r.tier.id}
                      onClick={() => set({ selectedTier: r.tier.id })}
                      className={`border-b border-slate-100 cursor-pointer transition ${isSelected ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}`}
                    >
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1.5">
                          {isSelected && <ChevronRight size={12} className="text-indigo-600" />}
                          <div>
                            <div className="font-semibold text-slate-900">{r.tier.id}</div>
                            <div className="text-[10px] text-slate-500">
                              {r.tier.label}
                              {isDefault && <span className="ml-1 text-indigo-600 font-bold">· yours</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">{fmt2(r.monthlyCommission)}</td>
                      <td className="py-2 px-2 text-right">{fmt2(r.annual)}</td>
                      <td className="py-2 px-2 text-right">
                        <span className={isSelected ? 'font-bold text-emerald-700' : 'text-slate-700'}>
                          {deal.payType === 'advance' ? fmt2(r.advancePayout) : fmt2(r.monthlyCommission)}
                          {deal.payType === 'as_earned' && <span className="text-[10px] text-slate-400">/mo</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Selected-tier breakdown */}
          {selectedResult && selectedResult.breakdown.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Breakdown — {selectedResult.tier.id} · {deal.payType === 'advance' ? 'Advance' : 'As Earned'}
              </div>
              {selectedResult.breakdown.map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-3 text-xs">
                  <span className="text-slate-700 truncate">{b.label}</span>
                  <span className="text-slate-500">
                    {fmt2(b.premium)}/mo × {(b.rate * 100).toFixed(2)}% = {fmt2(b.monthly)}/mo
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== Splitter ===== */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Users size={16} className="text-amber-600" /> Commission split
          </h3>
          <span className="text-[10px] text-slate-500">
            Use this when paying out an agent who qualified the lead.
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SPLIT_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setSplitId(p.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition ${splitId === p.id ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'}`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setSplitId('custom')}
            className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition ${splitId === 'custom' ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'}`}
          >
            Custom
          </button>
          {splitId === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={customSplit}
                onChange={e => setCustomSplit(Number(e.target.value))}
                className="w-32 accent-amber-600"
              />
              <span className="text-xs font-bold text-slate-700 min-w-[60px]">{customSplit} / {100 - customSplit}</span>
            </div>
          )}
        </div>

        {splitId !== 'none' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            <SplitCard
              label="Total commission"
              sub={deal.payType === 'advance' ? `Advance @ ${deal.selectedTier}` : `Annual @ ${deal.selectedTier}`}
              amount={totalForSplit}
              accent="text-slate-900"
              bg="bg-slate-50 border-slate-200"
            />
            <SplitCard
              label="Your share"
              sub={`${splitYourPct}%`}
              amount={yourShare}
              accent="text-emerald-700"
              bg="bg-emerald-50 border-emerald-200"
            />
            <SplitCard
              label="Partner share"
              sub={`${splitTheirPct}% (qualifier)`}
              amount={theirShare}
              accent="text-amber-700"
              bg="bg-amber-50 border-amber-200"
            />
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic">
            No split applied — pick a preset above to model paying out an agent who qualified the lead.
          </div>
        )}

        {splitId !== 'none' && (
          <div className="text-[11px] text-slate-500 italic flex items-start gap-1 pt-1">
            <Info size={10} className="mt-0.5 flex-shrink-0" />
            <span>
              Calculator-only. To actually record the partner share as a real expense, head to Books → add an entry with category <span className="font-semibold">Agent Payout / Split Commission</span>.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SplitCard({ label, sub, amount, accent, bg }) {
  return (
    <div className={`border rounded-xl p-3 ${bg}`}>
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent}`}>{fmt2(amount)}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}
