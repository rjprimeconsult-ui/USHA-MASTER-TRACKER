'use client';
import { useMemo, useState, useEffect, memo } from 'react';
import { DollarSign, TrendingUp, Calendar, ChevronLeft, ChevronRight, BookOpen, Info } from 'lucide-react';
import { PLATFORMS } from '@/lib/constants';
import { fmt, fmt2, today } from '@/lib/utils';
import { storage } from '@/lib/storage';
import { TiltCard, CountUp, Stagger, StaggerItem } from '../motion/MotionPrimitives';

const BUDGET_KEY = 'platform_budget_v1';

// "2026-01-15" → "2026-01"
const ymOf = (date) => (date || '').slice(0, 7);
// "2026-01" → "January 2026"
const ymLabel = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};
// Days in a YYYY-MM
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

/**
 * Platforms view — READ-ONLY analytics dashboard.
 *
 * After the 2026 unification, platform charges (Ringy / TextDrip / VanillaSoft)
 * are stored as PLATFORM_* categories inside Books. ALL entry, edit, and
 * import flows happen in the Books tab. This view derives its data from
 * Books and visualizes it: KPIs, per-platform cards, spend distribution
 * pie charts (active month + YTD), and a multi-year history strip.
 *
 * Removing the entry surface here is the structural fix for the
 * recurring duplicate-import bug class — only one tab can write platform
 * data, so the same charge can never get double-recorded across views.
 *
 * The legacy onAdd/onUpdate/onDelete/onBulkAdd props are still accepted
 * for backwards compat with the parent's wiring, but never invoked.
 */
function PlatformExpensesView({ expenses, onJumpToBooks }) {
  // Default current month (or whatever month has data, fall back to today)
  const allMonths = useMemo(() => {
    const set = new Set(expenses.map(e => ymOf(e.date)));
    set.add(ymOf(today()));
    return Array.from(set).filter(Boolean).sort().reverse();
  }, [expenses]);

  const [activeMonth, _setActiveMonth] = useState(allMonths[0] || ymOf(today()));
  const [stripYear, setStripYear] = useState(() => (allMonths[0] || ymOf(today())).slice(0, 4));
  const setActiveMonth = (ym) => {
    _setActiveMonth(ym);
    if (typeof ym === 'string' && ym.length >= 4) setStripYear(ym.slice(0, 4));
  };

  // Budget persists to storage so it survives tab navigation + multi-device.
  const [budget, setBudget] = useState(4000);
  useEffect(() => {
    let alive = true;
    storage.getItem(BUDGET_KEY).then(v => {
      if (alive && v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) setBudget(n);
      }
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    storage.setItem(BUDGET_KEY, String(budget));
  }, [budget]);

  // ----------- Derived data -----------
  const monthExpenses = useMemo(
    () => expenses.filter(e => ymOf(e.date) === activeMonth),
    [expenses, activeMonth]
  );

  // Per-platform totals for active month
  const monthByPlatform = useMemo(() => {
    const out = {};
    PLATFORMS.forEach(p => { out[p.id] = 0; });
    monthExpenses.forEach(e => {
      out[e.platform] = (out[e.platform] || 0) + Number(e.amount || 0);
    });
    return out;
  }, [monthExpenses]);

  const monthTotal = useMemo(
    () => Object.values(monthByPlatform).reduce((a, b) => a + b, 0),
    [monthByPlatform]
  );

  // Previous-month total (for the month-total diff sub-label)
  const prevMonth = useMemo(() => {
    const [y, m] = activeMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [activeMonth]);
  const prevTotal = useMemo(
    () => expenses.filter(e => ymOf(e.date) === prevMonth).reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses, prevMonth]
  );

  const weeksInMonth = useMemo(() => {
    const days = daysInMonth(activeMonth);
    return Math.max(1, days / 7);
  }, [activeMonth]);

  // YTD + projected annual (run-rate × 12)
  const yearStats = useMemo(() => {
    const yr = activeMonth.slice(0, 4);
    const yrExpenses = expenses.filter(e => (e.date || '').startsWith(yr));
    const ytdTotal = yrExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const monthSet = new Set(yrExpenses.map(e => ymOf(e.date)));
    const monthsLogged = monthSet.size || 1;
    const monthlyAvg = ytdTotal / monthsLogged;
    return { ytdTotal, monthsLogged, projected: monthlyAvg * 12 };
  }, [expenses, activeMonth]);

  // YTD per-platform totals — feeds the second pie chart
  const ytdByPlatform = useMemo(() => {
    const yr = activeMonth.slice(0, 4);
    const out = {};
    PLATFORMS.forEach(p => { out[p.id] = 0; });
    expenses.forEach(e => {
      if (!(e.date || '').startsWith(yr)) return;
      out[e.platform] = (out[e.platform] || 0) + Number(e.amount || 0);
    });
    return out;
  }, [expenses, activeMonth]);

  const remaining = budget - monthTotal;

  // Years that have any expense data (sorted ascending)
  const yearsWithData = useMemo(() => {
    const set = new Set(expenses.map(e => (e.date || '').slice(0, 4)).filter(Boolean));
    set.add(activeMonth.slice(0, 4));
    set.add(stripYear);
    return Array.from(set).sort();
  }, [expenses, activeMonth, stripYear]);

  // 12-month stacked history for the selected stripYear. Each month
  // carries a per-platform breakdown so the strip can render as a
  // stacked column chart (one colored segment per platform).
  const monthHistory = useMemo(() => {
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${stripYear}-${String(m).padStart(2, '0')}`;
      const byPlatform = {};
      PLATFORMS.forEach(p => { byPlatform[p.id] = 0; });
      let total = 0;
      for (const e of expenses) {
        if (ymOf(e.date) !== ym) continue;
        const amt = Number(e.amount || 0);
        byPlatform[e.platform] = (byPlatform[e.platform] || 0) + amt;
        total += amt;
      }
      out.push({ ym, total, byPlatform });
    }
    return out;
  }, [expenses, stripYear]);
  const maxHistory = useMemo(() => Math.max(1, ...monthHistory.map(m => m.total)), [monthHistory]);
  const stripYearTotal = useMemo(() => monthHistory.reduce((s, m) => s + m.total, 0), [monthHistory]);

  return (
    <div className="space-y-5">
      {/* Read-only banner */}
      <div className="premium-card p-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Info size={16} className="text-indigo-500 flex-shrink-0" />
          <div className="text-xs text-slate-600">
            Platform charges are managed in <b className="text-slate-900">Books</b> under the Ringy / TextDrip / VanillaSoft categories.
            This page is your visual dashboard.
          </div>
        </div>
        {onJumpToBooks && (
          <button
            onClick={onJumpToBooks}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold transition flex items-center gap-1.5 flex-shrink-0"
          >
            <BookOpen size={13} />
            Open Books
          </button>
        )}
      </div>

      {/* Top stat strip — YTD, Projected annual, Month total, Monthly budget */}
      <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StaggerItem>
          <Stat
            icon={<DollarSign size={16} className="text-emerald-600" />}
            label="YTD spent"
            numeric={yearStats.ytdTotal}
            sub={`${yearStats.monthsLogged} month${yearStats.monthsLogged !== 1 ? 's' : ''} logged`}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            icon={<TrendingUp size={16} className="text-indigo-600" />}
            label="Projected annual"
            numeric={yearStats.projected}
            decimals={0}
            sub={yearStats.monthsLogged < 2
              ? `Run-rate × 12 · rough (only ${yearStats.monthsLogged} mo logged)`
              : `Run-rate × 12 · ${yearStats.monthsLogged} mo avg`}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            icon={<Calendar size={16} className="text-amber-600" />}
            label={`${ymLabel(activeMonth)} total`}
            numeric={monthTotal}
            sub={prevTotal > 0
              ? `${monthTotal - prevTotal >= 0 ? '+' : ''}${fmt(monthTotal - prevTotal)} vs prev month`
              : 'no prev month data'}
          />
        </StaggerItem>
        <StaggerItem>
          <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-500 tracking-wider">MONTHLY BUDGET</div>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value || 0))}
                onClick={(e) => e.stopPropagation()}
                className="w-24 text-right border border-slate-200 rounded px-2 py-0.5 text-sm font-semibold"
              />
            </div>
            <div className="mt-2 text-lg font-bold" style={{ color: remaining >= 0 ? '#10b981' : '#ef4444', transform: 'translateZ(10px)' }}>
              {remaining >= 0
                ? <CountUp value={remaining} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />
                : <>−<CountUp value={Math.abs(remaining)} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} /></>}
            </div>
            <div className="text-[11px] text-slate-500">
              {remaining >= 0 ? 'remaining this month' : 'over budget'}
            </div>
          </TiltCard>
        </StaggerItem>
      </Stagger>

      {/* Per-platform month cards */}
      <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PLATFORMS.map(p => {
          const total = monthByPlatform[p.id] || 0;
          const weekly = total / weeksInMonth;
          const entries = monthExpenses.filter(e => e.platform === p.id).length;
          return (
            <StaggerItem key={p.id}>
              <TiltCard className="premium-card p-4 shine-on-hover glow-ring cursor-default">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                    <div className="font-semibold text-slate-900">{p.label}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${p.badge}`} style={{ transform: 'translateZ(15px)' }}>{p.id}</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1" style={{ transform: 'translateZ(12px)' }}>
                  <CountUp
                    value={total}
                    format={(v) => '$' + (v || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                  />
                </div>
                <div className="text-xs text-slate-500">
                  {fmt2(weekly)} / week avg · {entries} entries
                </div>
              </TiltCard>
            </StaggerItem>
          );
        })}
      </Stagger>

      {/* Spend distribution — two pie charts (active month + YTD) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DistributionPie
          title={`${ymLabel(activeMonth)} · Spend distribution`}
          subtitle={monthTotal > 0 ? fmt2(monthTotal) + ' total' : 'No platform spend this month'}
          totals={monthByPlatform}
          grandTotal={monthTotal}
        />
        <DistributionPie
          title={`${activeMonth.slice(0, 4)} YTD · Spend distribution`}
          subtitle={yearStats.ytdTotal > 0 ? fmt2(yearStats.ytdTotal) + ' total' : 'No platform spend YTD'}
          totals={ytdByPlatform}
          grandTotal={yearStats.ytdTotal}
        />
      </div>

      {/* Multi-year history strip — read-only, click any month to jump */}
      <div className="premium-card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStripYear(String(Number(stripYear) - 1))}
              className="p-1 rounded hover:bg-slate-100 text-slate-600"
              title="Previous year"
            >
              <ChevronLeft size={16} />
            </button>
            <select
              value={stripYear}
              onChange={(e) => setStripYear(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm font-semibold"
            >
              {yearsWithData.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              onClick={() => setStripYear(String(Number(stripYear) + 1))}
              className="p-1 rounded hover:bg-slate-100 text-slate-600"
              title="Next year"
            >
              <ChevronRight size={16} />
            </button>
            <div className="text-xs text-slate-500 ml-2">
              {fmt2(stripYearTotal)} total · click any month
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Legend */}
            <div className="flex items-center gap-3">
              {PLATFORMS.map(p => (
                <div key={p.id} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
                  <span className="text-[11px] text-slate-500">{p.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Jump to:</span>
              <select
                value={activeMonth}
                onChange={(e) => {
                  setActiveMonth(e.target.value);
                  setStripYear(e.target.value.slice(0, 4));
                }}
                className="border border-slate-200 rounded-lg px-2 py-1 text-sm"
              >
                {allMonths.map(m => <option key={m} value={m}>{ymLabel(m)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Stacked column chart — one column per month, each segmented by
            platform (TextDrip / Ringy / VanillaSoft) using brand colors.
            Column height is proportional to that month's grand total vs the
            year's peak month. Click any column to jump the active month. */}
        <div className="grid grid-cols-12 gap-1.5 h-44 items-end">
          {monthHistory.map(m => {
            const colHeightPct = (m.total / maxHistory) * 100;
            const active = m.ym === activeMonth;
            const empty = m.total === 0;
            // Order segments bottom→top in PLATFORMS order for stable stacking.
            const segments = PLATFORMS
              .map(p => ({ ...p, amount: m.byPlatform[p.id] || 0 }))
              .filter(s => s.amount > 0);
            const tooltip = empty
              ? `${ymLabel(m.ym)}: no spend`
              : `${ymLabel(m.ym)}: ${fmt2(m.total)}\n` +
                segments.map(s => `${s.label}: ${fmt2(s.amount)}`).join('\n');
            return (
              <button
                key={m.ym}
                onClick={() => setActiveMonth(m.ym)}
                className="flex flex-col items-center gap-1 h-full justify-end group"
                title={tooltip}
              >
                {/* the column track fills the available height; the inner
                    stack occupies a % of it equal to this month's share of
                    the peak. */}
                <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                  {empty ? (
                    <div
                      className={`w-full rounded transition ${active ? 'bg-indigo-200' : 'bg-slate-100 group-hover:bg-slate-200'}`}
                      style={{ height: '3px' }}
                    />
                  ) : (
                    <div
                      className={`w-full flex flex-col-reverse overflow-hidden rounded-t transition ${active ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-transparent' : ''}`}
                      style={{ height: `${Math.max(4, colHeightPct)}%` }}
                    >
                      {segments.map((s, i) => {
                        const segPct = (s.amount / m.total) * 100;
                        return (
                          <div
                            key={s.id}
                            className="w-full transition group-hover:opacity-90"
                            style={{
                              height: `${segPct}%`,
                              background: s.color,
                              // subtle separator between stacked segments
                              boxShadow: i > 0 ? 'inset 0 1px 0 rgba(15,23,42,0.25)' : 'none',
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={`text-[9px] ${active ? 'text-indigo-700 font-bold' : empty ? 'text-slate-400' : 'text-slate-500'}`}>
                  {m.ym.slice(5, 7)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(PlatformExpensesView);

// ============================================================
// KPI tile
// ============================================================
function Stat({ icon, label, value, numeric, decimals = 2, isCurrency = true, sub, tilt = true }) {
  const formatNumber = (v) => {
    if (!isCurrency) return Math.round(v).toLocaleString();
    return '$' + (v || 0).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  };
  const Inner = (
    <>
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-xs font-bold text-slate-500 tracking-wider">{label}</div>
      </div>
      <div className="mt-2 text-lg font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>
        {numeric != null ? <CountUp value={numeric} format={formatNumber} /> : value}
      </div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </>
  );
  return tilt ? (
    <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
      {Inner}
    </TiltCard>
  ) : (
    <div className="premium-card p-3">{Inner}</div>
  );
}

// ============================================================
// DistributionPie — SVG donut showing % spend per platform
//
// Renders three colored arcs whose sweep angles are proportional to each
// platform's total. A center label shows the grand total. A legend on
// the right shows each platform's $ and %.
//
// When grandTotal is 0, renders a muted "empty" donut so the layout
// stays consistent (no jarring placeholder card).
// ============================================================
function DistributionPie({ title, subtitle, totals, grandTotal }) {
  // Build slices in PLATFORMS order (TextDrip, Ringy, VanillaSoft) so
  // colors stay stable across the active-month and YTD donuts.
  const slices = PLATFORMS.map(p => ({
    id: p.id,
    label: p.label,
    color: p.color,
    amount: totals[p.id] || 0,
    pct: grandTotal > 0 ? ((totals[p.id] || 0) / grandTotal) * 100 : 0,
  }));

  const size = 140;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  // Compute the dasharray offset for each slice so they butt up against
  // each other (no gaps, no overlaps). When grandTotal is 0, all slices
  // are zero-length and we draw a single muted track instead.
  let cumulative = 0;
  const arcs = slices.map(s => {
    const length = (s.pct / 100) * circ;
    const offset = -cumulative; // negative because SVG strokes draw clockwise from 12 o'clock
    cumulative += length;
    return {
      ...s,
      dashArray: `${length} ${circ - length}`,
      dashOffset: offset,
    };
  });

  return (
    <div className="premium-card p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-xs font-bold text-slate-500 tracking-wider uppercase">{title}</div>
          <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-5 flex-wrap">
        {/* Donut SVG */}
        <div className="relative flex-shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* base muted track — visible only when no data */}
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke="#1e2538"
              strokeWidth={stroke}
              opacity={grandTotal > 0 ? 0 : 1}
            />
            {/* slices — drawn rotated -90° so they start at 12 o'clock */}
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              {arcs.map(a => (
                a.amount > 0 ? (
                  <circle
                    key={a.id}
                    cx={cx} cy={cy} r={r}
                    fill="none"
                    stroke={a.color}
                    strokeWidth={stroke}
                    strokeDasharray={a.dashArray}
                    strokeDashoffset={a.dashOffset}
                    style={{ transition: 'stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease' }}
                  />
                ) : null
              ))}
            </g>
          </svg>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total</div>
            <div className="text-sm font-bold text-slate-900 leading-tight">
              {grandTotal > 0 ? fmt2(grandTotal) : '$0.00'}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-1.5 min-w-[160px]">
          {slices.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="font-semibold text-slate-700 truncate">{s.label}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-slate-500 tabular-nums">{fmt2(s.amount)}</span>
                <span className="font-bold text-slate-900 tabular-nums w-12 text-right">
                  {s.pct.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
