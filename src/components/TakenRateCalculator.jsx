'use client';
import { useId, useMemo, useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Target, TrendingUp, Info, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { TAKEN_STAGES, PENDING_STAGES, NOT_TAKEN_STAGES } from '@/lib/constants';
import { storage } from '@/lib/storage';

const BASE_PERIODS = [
  { id: 'month', label: 'Monthly',  desc: 'Pick any month — historical or current' },
  { id: 'qtd',   label: 'QTD',      desc: 'Quarter to date' },
  { id: 'ytd',   label: 'YTD',      desc: 'Year to date' },
];

// Storage for manually-entered prior-month counts (months that predate the
// agent's PRIM data but still count toward the USHA bonus year). Namespaced
// per calculator (UW vs GI) since they have different windows + numbers.
const PRIORS_KEY = 'taken_rate_priors_v1';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * USHA bonus-year window, ending Oct 31.
 *   - UW (startMonth = 11): Nov (prior year) → Oct (current). Over-50 excluded.
 *   - GI (startMonth = 1):  Jan → Oct only (GI isn't sold Nov–Dec).
 * Returns { startISO, endISO (capped at today), startYm, endYm, endYear }.
 */
function bonusWindow(startMonth, now = new Date()) {
  const m = now.getMonth() + 1; // 1-12
  let endYear = m >= 11 ? now.getFullYear() + 1 : now.getFullYear();
  let startYear = startMonth === 11 ? endYear - 1 : endYear;
  const pad = (n) => String(n).padStart(2, '0');
  let startISO = `${startYear}-${pad(startMonth)}-01`;
  const todayISO = now.toISOString().slice(0, 10);
  // Edge: a Jan-start (GI) window can resolve to a future Jan when viewed in
  // Nov/Dec — fall back to the just-completed bonus year so it isn't empty.
  if (startISO > todayISO) {
    startYear -= 1; endYear -= 1;
    startISO = `${startYear}-${pad(startMonth)}-01`;
  }
  const octEndISO = `${endYear}-10-31`;
  const endISO = todayISO < octEndISO ? todayISO : octEndISO;
  return {
    startISO, endISO,
    startYm: startISO.slice(0, 7),
    endYm: endISO.slice(0, 7),
    endYear,
  };
}

// Every YYYY-MM from startYm..endYm inclusive.
function monthsBetween(startYm, endYm) {
  const out = [];
  let [y, m] = startYm.split('-').map(Number);
  const [ey, em] = endYm.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const emptyPrior = () => ({ taken: 0, notTaken: 0, withdrawn: 0, declined: 0 });
const priorSubmits = (p) => (Number(p.taken) || 0) + (Number(p.notTaken) || 0) + (Number(p.withdrawn) || 0) + (Number(p.declined) || 0);

// "2026-05-15" -> "2026-05"
const ymOf = (iso) => String(iso || '').slice(0, 7);
const todayYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const ymLabel = (ym) => {
  if (!ym || ym.length < 7) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};
const shiftYm = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Does leadDate fall inside the chosen period? `selectedMonth` only used for 'month' mode. */
function inPeriod(iso, period, selectedMonth, now = new Date()) {
  if (!iso) return false;
  if (period === 'month') return ymOf(iso) === selectedMonth;
  const d = new Date(iso + 'T00:00:00');
  if (d.getFullYear() !== now.getFullYear()) return false;
  if (period === 'ytd') return true;
  if (period === 'qtd') {
    const startMonth = Math.floor(now.getMonth() / 3) * 3;
    return d.getMonth() >= startMonth && d.getMonth() <= now.getMonth();
  }
  return false;
}

// Lighten a hex color toward white — used to give the gauge ring a
// top-to-bottom gradient sheen instead of a flat fill.
const lighten = (hex, amt = 0.32) => {
  const h = String(hex || '#10b981').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (c) => Math.round(c + (255 - c) * amt);
  return `#${[L(r), L(g), L(b)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
};

// Colors that match taken-rate performance thresholds
const rateColor = (rate) => {
  if (rate >= 60) return { stroke: '#10b981', text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'On target' };
  if (rate >= 50) return { stroke: '#f59e0b', text: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'Warming up' };
  return                   { stroke: '#ef4444', text: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200',     label: 'Needs work' };
};

export default function TakenRateCalculator({
  leads,
  title = 'Taken Rate Calculator',
  subtitle = 'Issued \u00f7 Total Submitted. Resets each period. 60%+ is the USHA bonus threshold.',
  productFilter = null, // array of main-product IDs to include; null = all
  defaultTarget = 60,
  applyOver50Rule = true, // USHA senior-market rule — applies to UW products; GI has no such exclusion
  // Bonus-year support: set the fiscal-year start month (11 = UW Nov–Oct,
  // 1 = GI Jan–Oct). When set, adds a "Bonus Yr" period + a manual
  // prior-month grid. priorsKey namespaces this calc's saved priors.
  bonusStartMonth = null,
  priorsKey = null,
}) {
  const PERIODS = useMemo(
    () => bonusStartMonth
      ? [...BASE_PERIODS, { id: 'bonusYr', label: 'Bonus Yr', desc: `USHA bonus year (${bonusStartMonth === 11 ? 'Nov–Oct' : 'Jan–Oct'})` }]
      : BASE_PERIODS,
    [bonusStartMonth]
  );
  const [period, setPeriod] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(todayYm());
  const [target, setTarget] = useState(defaultTarget);

  // Manually-entered prior-month counts for the bonus year. Loaded from /
  // saved to storage under PRIORS_KEY, namespaced by priorsKey.
  const [priors, setPriors] = useState({}); // { 'YYYY-MM': {taken,notTaken,withdrawn,declined} }
  const [priorsLoaded, setPriorsLoaded] = useState(false);
  useEffect(() => {
    if (!priorsKey) { setPriorsLoaded(true); return; }
    let alive = true;
    storage.getItem(PRIORS_KEY).then(v => {
      if (!alive) return;
      try { const all = v ? JSON.parse(v) : {}; setPriors(all[priorsKey] || {}); } catch {}
      setPriorsLoaded(true);
    });
    return () => { alive = false; };
  }, [priorsKey]);
  const savePriors = (next) => {
    setPriors(next);
    if (!priorsKey) return;
    storage.getItem(PRIORS_KEY).then(v => {
      let all = {};
      try { all = v ? JSON.parse(v) : {}; } catch {}
      all[priorsKey] = next;
      storage.setItem(PRIORS_KEY, JSON.stringify(all));
    });
  };

  const win = useMemo(
    () => (bonusStartMonth ? bonusWindow(bonusStartMonth) : null),
    [bonusStartMonth]
  );

  // Months that have any closed-date lead, plus current month (always).
  // Sorted newest-first so the dropdown defaults to recent activity.
  const availableMonths = useMemo(() => {
    const set = new Set([todayYm()]);
    for (const l of leads) {
      if (l.closedDate) set.add(ymOf(l.closedDate));
    }
    return Array.from(set).filter(Boolean).sort().reverse();
  }, [leads]);

  const { issued, pending, notTaken, total, rate, breakdown, excludedOver50, priorMonthsApplied } = useMemo(() => {
    const filterSet = productFilter ? new Set(productFilter) : null;
    const isBonus = period === 'bonusYr' && win;
    // For the bonus year, any month the agent entered manually OVERRIDES
    // PRIM's leads for that month (so pre-PRIM months count, and we never
    // double-count a month that's both manually entered and in PRIM).
    const manualMonths = isBonus
      ? Object.keys(priors).filter(ym => ym >= win.startYm && ym <= win.endYm)
      : [];
    const manualSet = new Set(manualMonths);

    const inScope = (iso) => {
      if (isBonus) return iso >= win.startISO && iso <= win.endISO && !manualSet.has(ymOf(iso));
      return inPeriod(iso, period, selectedMonth);
    };

    const scoped = leads.filter(l => {
      if (!l.closedDate) return false;
      if (!inScope(l.closedDate)) return false;
      if (filterSet && !filterSet.has(l.mainProduct)) return false;
      return true;
    });

    let issued = 0, pending = 0, notTaken = 0;
    let excludedOver50 = 0;
    const breakdown = { Issued: 0, Pending: 0, Declined: 0, 'Not taken': 0, Withdrawn: 0 };

    scoped.forEach(l => {
      // USHA senior-market rule applies to UW products only. When enabled,
      // applicants over age 50 are excluded entirely — no numerator/denominator.
      // GI (Health Access III) has no such rule, so this flag is false there.
      // Recognizes both exact age (l.age > 50) and bucket-only entries
      // (l.ageBucket === 'OVER_50') for agents who don't track exact age.
      const isOverFifty = (l.age || 0) > 50 || l.ageBucket === 'OVER_50';
      if (applyOver50Rule && isOverFifty) {
        excludedOver50 += 1;
        return;
      }

      if (TAKEN_STAGES.includes(l.stage))         issued += 1;
      else if (PENDING_STAGES.includes(l.stage))  pending += 1;
      else if (NOT_TAKEN_STAGES.includes(l.stage)) notTaken += 1;
      if (l.stage in breakdown) breakdown[l.stage] += 1;
    });

    // Fold in manually-entered prior months (bonus year only). These are
    // already-final counts (no pending), so they go straight into the
    // numerator/denominator + breakdown.
    let priorMonthsApplied = 0;
    if (isBonus) {
      for (const ym of manualMonths) {
        const p = priors[ym] || emptyPrior();
        const t = Number(p.taken) || 0;
        const nt = Number(p.notTaken) || 0;
        const wd = Number(p.withdrawn) || 0;
        const dc = Number(p.declined) || 0;
        if (t + nt + wd + dc === 0) continue;
        issued += t;
        notTaken += nt + wd + dc;
        breakdown.Issued += t;
        breakdown['Not taken'] += nt;
        breakdown.Withdrawn += wd;
        breakdown.Declined += dc;
        priorMonthsApplied += 1;
      }
    }

    const total = issued + pending + notTaken;
    const rate = total > 0 ? (issued / total) * 100 : 0;

    return { issued, pending, notTaken, total, rate, breakdown, excludedOver50, priorMonthsApplied };
  }, [leads, period, selectedMonth, productFilter, applyOver50Rule, win, priors]);

  const colors = rateColor(rate);
  // Stable unique id for the gauge's <linearGradient> (two calculators
  // render on one page). Strip colons so it is safe in an SVG url(#…).
  const gradId = `gauge-${useId().replace(/:/g, '')}`;

  // Gauge donut: show rate as filled slice with remainder gray
  const gaugeData = [
    { name: 'Rate', value: Math.max(rate, 0.5), color: colors.stroke },
    { name: 'Gap',  value: Math.max(100 - rate, 0.01), color: '#e2e8f0' },
  ];

  // Target math
  // 1) Clean-issue scenario: how many new deals must ALL issue to reach R?
  //    (issued + X) / (total + X) >= R  →  X >= (R*total - issued) / (1 - R)
  const R = target / 100;
  const issuedNeeded = total === 0
    ? null
    : Math.max(0, Math.ceil((R * total - issued) / Math.max(1 - R, 0.0001)));

  // 2) Gap analysis: if your issue rate holds, can you reach R?
  //    Only reachable when currentRate > R. Otherwise — at same rate — the
  //    aggregate asymptotes to currentRate and can never climb to R.
  //
  //    Expressed as an absolute ratio: "out of your next N submitted deals,
  //    M need to issue". Use a 10-deal horizon — a familiar, actionable frame.
  //    Solve: (issued + M) / (total + N) >= R  →  M >= R*(total+N) - issued
  const currentIssueRate = total > 0 ? issued / total : 0;
  const HORIZON = 10;
  const issuesNeededInNext = total === 0
    ? null
    : Math.max(0, Math.ceil(R * (total + HORIZON) - issued));
  const unreachableInHorizon = issuesNeededInNext !== null && issuesNeededInNext > HORIZON;
  // Projected rate if user hits M out of N
  const projectedRate = issuesNeededInNext !== null && !unreachableInHorizon
    ? ((issued + issuesNeededInNext) / (total + HORIZON)) * 100
    : null;

  const barColors = {
    Issued: '#10b981',
    Pending: '#f59e0b',
    Declined: '#ef4444',
    'Not taken': '#64748b',
    Withdrawn: '#a855f7',
  };

  return (
    <div className="premium-card p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent-gradient flex items-center justify-center text-white shadow-md">
            <Target size={15} />
          </div>
          <h3 className="font-bold text-slate-900 text-[15px] tracking-tight">{title}</h3>
        </div>
        <p className="text-xs text-slate-500">{subtitle}</p>
        {/* Period toggle — segmented control, always visible, full width */}
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-1 text-sm w-full max-w-md">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`flex-1 px-3 py-1.5 font-semibold rounded-md transition ${period === p.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white/70 dark:hover:bg-slate-700/60'}`}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Month picker — only visible in Monthly mode. Lets agents look at any
            past month, not just the current one, for historical taken-rate review. */}
        {period === 'month' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSelectedMonth(shiftYm(selectedMonth, -1))}
              className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600"
              title="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm font-semibold min-w-[150px]"
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{ymLabel(m)}{m === todayYm() ? ' (current)' : ''}</option>
              ))}
              {/* Edge case: selectedMonth has no leads AND isn't current — keep it visible */}
              {!availableMonths.includes(selectedMonth) && (
                <option value={selectedMonth}>{ymLabel(selectedMonth)}</option>
              )}
            </select>
            <button
              onClick={() => setSelectedMonth(shiftYm(selectedMonth, 1))}
              disabled={selectedMonth >= todayYm()}
              className="p-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next month"
            >
              <ChevronRight size={14} />
            </button>
            {selectedMonth !== todayYm() && (
              <button
                onClick={() => setSelectedMonth(todayYm())}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Jump to current
              </button>
            )}
          </div>
        )}

        {/* Bonus-year window + manual prior-month grid */}
        {period === 'bonusYr' && win && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2.5">
            <div className="text-[11px] text-indigo-900">
              Bonus year: <b>{ymLabel(win.startYm)} → {ymLabel(win.endYm)}</b>
              {priorMonthsApplied > 0 && <> · {priorMonthsApplied} manual month{priorMonthsApplied !== 1 ? 's' : ''} included</>}
              <div className="text-indigo-700/80 mt-0.5">
                Add any months from <b>before you started using PRIM</b> so your yearly taken rate is complete. A month you enter here replaces PRIM&apos;s data for that month.
              </div>
            </div>

            {/* Existing manual rows */}
            {Object.keys(priors).filter(ym => ym >= win.startYm && ym <= win.endYm).sort().map(ym => {
              const p = priors[ym];
              const num = (field) => (
                <input
                  type="number" min="0" step="1"
                  value={p[field] ?? 0}
                  onChange={e => savePriors({ ...priors, [ym]: { ...p, [field]: Math.max(0, parseInt(e.target.value) || 0) } })}
                  className="w-12 border border-slate-200 rounded px-1 py-0.5 text-xs text-center"
                />
              );
              return (
                <div key={ym} className="flex items-center gap-1.5 flex-wrap bg-white rounded-lg border border-slate-200 px-2 py-1.5">
                  <span className="text-xs font-semibold text-slate-700 w-20">{ymLabel(ym)}</span>
                  <label className="text-[10px] text-slate-500 flex items-center gap-1">Taken {num('taken')}</label>
                  <label className="text-[10px] text-slate-500 flex items-center gap-1">Not taken {num('notTaken')}</label>
                  <label className="text-[10px] text-slate-500 flex items-center gap-1">Withdrawn {num('withdrawn')}</label>
                  <label className="text-[10px] text-slate-500 flex items-center gap-1">Declined {num('declined')}</label>
                  <span className="text-[10px] text-slate-400 ml-1">= {priorSubmits(p)} submits</span>
                  <button
                    onClick={() => { const next = { ...priors }; delete next[ym]; savePriors(next); }}
                    className="ml-auto text-slate-400 hover:text-red-600 p-0.5"
                    title="Remove this prior month"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}

            {/* Add a prior month */}
            {(() => {
              const candidates = monthsBetween(win.startYm, win.endYm).filter(ym => !(ym in priors));
              if (candidates.length === 0) return null;
              return (
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    onChange={e => { if (e.target.value) savePriors({ ...priors, [e.target.value]: emptyPrior() }); }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs"
                  >
                    <option value="">+ Add a prior month…</option>
                    {candidates.map(ym => <option key={ym} value={ym}>{ymLabel(ym)}</option>)}
                  </select>
                  <span className="text-[10px] text-slate-400">Enter the counts USHA shows for that month.</span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Gauge */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative w-44 h-44">
            {/* Outer halo — a soft colored glow that hugs the ring's
                OUTER edge only. Sized to the donut's outer diameter so
                its box-shadow blooms outward and never reaches the
                center where the percentage sits. */}
            <div
              className="absolute rounded-full pointer-events-none"
              style={{ inset: '8px', boxShadow: `0 0 22px 0 ${colors.stroke}55` }}
            />
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lighten(colors.stroke, 0.35)} />
                    <stop offset="100%" stopColor={colors.stroke} />
                  </linearGradient>
                </defs>
                <Pie
                  data={gaugeData}
                  cx="50%"
                  cy="50%"
                  startAngle={90}
                  endAngle={-270}
                  innerRadius={58}
                  outerRadius={80}
                  cornerRadius={5}
                  dataKey="value"
                  stroke="none"
                >
                  {gaugeData.map((d, i) => (
                    <Cell key={i} fill={i === 0 ? `url(#${gradId})` : d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className={`text-3xl font-bold tabular-nums ${colors.text}`}>{rate.toFixed(1)}%</div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5">{issued} of {total}</div>
            </div>
          </div>
          <div
            className={`mt-3 px-3.5 py-1 rounded-full border text-xs font-bold ${colors.bg} ${colors.text} ${colors.border}`}
            style={{ boxShadow: `0 6px 18px -6px ${colors.stroke}55` }}
          >
            {colors.label}
          </div>
        </div>

        {/* Breakdown bars */}
        <div className="lg:col-span-2 space-y-3">
          <div className="text-xs font-bold text-slate-500 tracking-wider">BREAKDOWN</div>
          {Object.entries(breakdown).map(([stage, count]) => {
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={stage} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-slate-700">{stage}</span>
                <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background: barColors[stage],
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.14)',
                    }}
                  />
                </div>
                <span className="w-10 text-right font-medium text-slate-900">{count}</span>
                <span className="w-14 text-right text-xs text-slate-500">{pct.toFixed(1)}%</span>
              </div>
            );
          })}
          {total === 0 && (
            <div className="text-center text-slate-400 text-sm py-4 italic">No deals for this period yet.</div>
          )}
          {excludedOver50 > 0 && (
            <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              <b>{excludedOver50}</b> over-50 applicant{excludedOver50 !== 1 ? 's' : ''} excluded from taken rate per USHA senior-market rule (no positive or negative effect).
            </div>
          )}
        </div>
      </div>

      {/* Target slider */}
      <div className="border-t border-slate-200 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-indigo-600" />
            <span className="text-sm font-semibold text-slate-900">Target Taken Rate:</span>
            <span className="text-lg font-bold text-indigo-600">{target}%</span>
          </div>
          <div className="text-xs text-slate-500">Drag to set</div>
        </div>
        <input
          type="range"
          min="30"
          max="90"
          step="1"
          value={target}
          onChange={e => setTarget(parseInt(e.target.value))}
          className="w-full accent-indigo-600"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 mb-1 uppercase tracking-wide">
              <Info size={12} /> Clean-issue scenario
            </div>
            {total === 0 ? (
              <div className="text-sm text-slate-500 italic">Submit a deal first to see projections.</div>
            ) : rate >= target ? (
              <div className="text-sm text-emerald-700 font-medium">Already at or above target. Keep it up.</div>
            ) : (
              <div className="text-sm text-slate-700">
                Need <span className="text-lg font-bold text-emerald-700">{issuedNeeded}</span> more deal{issuedNeeded !== 1 ? 's' : ''} to <b>all issue</b> to hit {target}%.
              </div>
            )}
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-800 mb-1 uppercase tracking-wide">
              <Info size={12} /> Realistic path to {target}%
            </div>
            {total === 0 ? (
              <div className="text-sm text-slate-500 italic">Need history to project.</div>
            ) : rate >= target ? (
              <div className="text-sm text-indigo-700 font-medium">Already above target — maintain your {(currentIssueRate * 100).toFixed(1)}% pace.</div>
            ) : unreachableInHorizon ? (
              <div className="text-sm text-slate-700">
                Even <b>10 of your next 10</b> being issued wouldn&apos;t reach {target}%.
                Submit more volume and reassess — or aim to issue <b>{issuesNeededInNext}</b> out of the next <b>{issuesNeededInNext}</b> deals.
              </div>
            ) : (
              <div className="text-sm text-slate-700">
                Issue <span className="text-lg font-bold text-indigo-700">{issuesNeededInNext}</span> of your next <span className="text-lg font-bold text-slate-900">10</span> submitted deals and you&apos;ll hit <b>{projectedRate.toFixed(1)}%</b>.
                <div className="text-xs text-slate-500 mt-1">
                  New totals: {issued + issuesNeededInNext} issued of {total + HORIZON} submitted (you&apos;re at {issued} of {total} now).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
