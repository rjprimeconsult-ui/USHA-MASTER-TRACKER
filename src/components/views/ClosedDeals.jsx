'use client';
import { useMemo, memo, useState, useId } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from 'recharts';
import { Edit2, Trash2, CheckCircle2, Clock, ImageUp, ArrowLeft, MousePointer2, Trophy, BarChart3, ChevronDown } from 'lucide-react';
import EmptyState from '../EmptyState';
import { CRMS, CAMPAIGNS, LEAD_CATEGORIES, STAGES, effectiveLeadCategory } from '@/lib/constants';
import { fmt, fmt2, usDate, monthLabel } from '@/lib/utils';
import { useLeadOptionsAll, addCustomLeadOption, ADD_CUSTOM_VALUE } from '@/lib/customLeadOptions';

// Tailwind utility for the bare-style inline-edit input. Borderless
// until hover, indigo ring on focus. Same pattern Books table uses.
// `truncate` keeps long content from blowing out fixed-width cells.
const inlineCell = 'border border-transparent hover:border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5 bg-transparent w-full text-xs truncate';

// Lighten a hex color toward white by a percentage. Used to build the
// per-slice radial gradients so each slice has subtle depth without the
// dated 3D-extrusion look.
function lighten(hex, pct = 0.25) {
  const h = String(hex || '#94a3b8').replace('#', '');
  const r = parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16);
  const g = parseInt(h.length === 3 ? h[1] + h[1] : h.slice(2, 4), 16);
  const b = parseInt(h.length === 3 ? h[2] + h[2] : h.slice(4, 6), 16);
  const lr = Math.round(r + (255 - r) * pct);
  const lg = Math.round(g + (255 - g) * pct);
  const lb = Math.round(b + (255 - b) * pct);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

// Build the CRM Source donut data from a list of leads — counts per
// CRM, sorted desc, colored from the CRMS table. Items without a CRM
// bucket as "— Unassigned" so they don't silently vanish.
function buildCrmData(items) {
  const crmMap = {};
  items.forEach(l => {
    const k = l.crm || '— Unassigned';
    crmMap[k] = (crmMap[k] || 0) + 1;
  });
  return Object.entries(crmMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      name: k, value: v,
      color: CRMS.find(c => c.id === k)?.color || '#94a3b8',
    }));
}

// Build the Lead Type donut data — counts per top-level lead category
// (AGED, SHARED, REFERRAL, …), sorted desc, colored from LEAD_CATEGORIES.
function buildCatData(items) {
  const catMap = {};
  items.forEach(l => {
    const cat = effectiveLeadCategory(l);
    catMap[cat] = (catMap[cat] || 0) + 1;
  });
  return Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      name: k, value: v,
      color: LEAD_CATEGORIES.find(c => c.id === k)?.color || '#94a3b8',
    }));
}

// activeShape renderer: when a slice is hovered, render an enlarged
// version with a subtle outer ring so the focused slice pops without
// distorting the whole chart layout.
function renderActiveSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke="#fff"
        strokeWidth={2}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 11}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={payload?.color || fill}
        opacity={0.35}
      />
    </g>
  );
}

// Modern donut chart — flat 2D, gradient slices, center total, side
// legend with bars + percentages. Optional onSliceClick enables
// drill-down (used by the LEAD TYPE chart to drop into campaigns).
function LeadAnalyticsDonut({
  data,
  title,
  subtitle,
  totalLabel = 'TOTAL',
  onSliceClick,
  onBack,
  emptyMessage = 'No data yet',
}) {
  const [hovered, setHovered] = useState(null);
  const total = useMemo(() => data.reduce((s, d) => s + (d.value || 0), 0), [data]);
  // Stable unique id for the per-slice <radialGradient> defs. useId is
  // render-pure (unlike Math.random); strip colons so it stays safe
  // inside SVG url(#…) references.
  const id = `donut${useId().replace(/:/g, '')}`;
  const isClickable = !!onSliceClick;

  if (!data.length || total === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm h-full">
        <div className="flex items-center justify-between mb-1">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</div>
            {subtitle && <div className="text-[10px] text-slate-400 mt-0.5">{subtitle}</div>}
          </div>
          {onBack && (
            <button onClick={onBack} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold">
              <ArrowLeft size={11} /> Back
            </button>
          )}
        </div>
        <div className="text-center py-8 text-slate-400 text-xs">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</div>
          {subtitle && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{subtitle}</div>}
        </div>
        {onBack && (
          <button onClick={onBack} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold flex-shrink-0">
            <ArrowLeft size={11} /> Back
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-3 flex-1">
        {/* Donut */}
        <div className="relative flex items-center justify-center">
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <defs>
                {data.map((d, i) => (
                  <radialGradient key={i} id={`${id}-grad-${i}`} cx="50%" cy="50%" r="65%" fx="35%" fy="35%">
                    <stop offset="0%" stopColor={lighten(d.color, 0.35)} />
                    <stop offset="100%" stopColor={d.color} />
                  </radialGradient>
                ))}
              </defs>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={2}
                cornerRadius={4}
                stroke="#fff"
                strokeWidth={2}
                activeIndex={hovered ?? undefined}
                activeShape={renderActiveSlice}
                onMouseEnter={(_, i) => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={isClickable ? ((entry) => onSliceClick(entry?.payload || entry)) : undefined}
                style={isClickable ? { cursor: 'pointer' } : undefined}
                isAnimationActive
                animationDuration={650}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={`url(#${id}-grad-${i})`} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: 'rgba(15,23,42,0.95)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 11,
                  padding: '6px 10px',
                  color: '#fff',
                }}
                itemStyle={{ color: '#fff' }}
                formatter={(value, name) => [`${value} (${total ? Math.round((value / total) * 100) : 0}%)`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-2xl font-bold text-slate-900 leading-none">{total}</div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">{totalLabel}</div>
          </div>
        </div>

        {/* Legend */}
        <div className="space-y-1.5 self-center w-full overflow-hidden">
          {data.map((d, i) => {
            const pct = total ? (d.value / total) * 100 : 0;
            const isHovered = hovered === i;
            return (
              <button
                key={d.name}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={isClickable ? () => onSliceClick(d) : undefined}
                disabled={!isClickable}
                className={`w-full text-left flex items-center gap-2 rounded-md px-1.5 py-1 transition ${
                  isClickable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'
                } ${isHovered ? 'bg-slate-50' : ''}`}
                title={isClickable ? `Click to see ${d.name} campaigns` : undefined}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: d.color, boxShadow: `0 0 0 2px ${d.color}22` }}
                />
                <span className="text-[11px] text-slate-700 font-medium flex-1 truncate">{d.name}</span>
                <span className="text-[11px] text-slate-900 font-bold tabular-nums">{d.value}</span>
                <span className="text-[10px] text-slate-400 tabular-nums w-8 text-right">{pct.toFixed(0)}%</span>
              </button>
            );
          })}
        </div>
      </div>

      {isClickable && (
        <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <MousePointer2 size={10} /> Click any slice to drill into campaigns
        </div>
      )}
    </div>
  );
}

const StageBadge = ({ stage }) => {
  const s = STAGES.find(x => x.id === stage) || STAGES[0];
  const Icon = stage === 'Issued' ? CheckCircle2 : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      <Icon size={10} />
      {stage}
    </span>
  );
};

function ClosedDeals({ leads, onEdit, onUpdate, onDelete, onImportFromScreenshot }) {
  // Per-agent custom options for CRM + Campaign (inline editable here).
  const { crms: ALL_CRMS, campaigns: ALL_CAMPAIGNS, reload: reloadLeadOptions } = useLeadOptionsAll();

  // Drill-down state for the LEAD TYPE chart, keyed by month (YM string).
  // Click a category slice → store the category here so that month's pie
  // swaps to the campaign breakdown for those leads. Click "Back" to
  // clear it for that month.
  const [drillByMonth, setDrillByMonth] = useState({});
  const drillInto = (ym, category) => setDrillByMonth(p => ({ ...p, [ym]: category }));
  const drillOut  = (ym) => setDrillByMonth(p => { const n = { ...p }; delete n[ym]; return n; });

  // "Big Picture" panel — collapsible QTD / YTD breakdowns pinned above
  // the month sections. Closed by default; bigRange picks which window.
  const [showBigPicture, setShowBigPicture] = useState(false);
  const [bigRange, setBigRange] = useState('ytd'); // 'qtd' | 'ytd'

  // Inline edit helper — patches a single field on a lead and saves via
  // the parent's onUpdate. No-ops when onUpdate isn't passed (defensive
  // fallback for any caller that doesn't wire it up).
  const patch = (lead, field, value) => {
    if (!onUpdate) return;
    onUpdate({ ...lead, [field]: value });
  };

  // When the user picks "+ Add custom..." in a dropdown, prompt for a
  // value, save to their custom-options list, then patch the row.
  const promptCustom = async (lead, field, fieldOnLead) => {
    const label = field === 'crms' ? 'CRM' : 'Campaign';
    const v = window.prompt(`Add custom ${label}:`);
    const trimmed = String(v || '').trim();
    if (!trimmed) return;
    await addCustomLeadOption(field, trimmed);
    await reloadLeadOptions();
    patch(lead, fieldOnLead, trimmed);
  };
  // Show Submitted + Issued (pending + paid deals)
  const visible = useMemo(() =>
    leads.filter(l => (l.stage === 'Issued' || l.stage === 'Pending') && l.closedDate)
  , [leads]);

  const totals = useMemo(() => {
    const issued = visible.filter(l => l.stage === 'Issued');
    return {
      deals: visible.length,
      issuedCount: issued.length,
      pendingCount: visible.length - issued.length,
      totalLeadCost: visible.reduce((s, l) => s + (l.leadCost || 0), 0),
      totalCommission: issued.reduce((s, l) => s + (l.dealValue || 0), 0),
      totalProfit: issued.reduce((s, l) => s + (l.dealValue || 0) - (l.leadCost || 0), 0),
    };
  }, [visible]);

  const grouped = useMemo(() => {
    const m = {};
    visible.forEach(l => {
      const ym = l.closedDate.slice(0, 7);
      (m[ym] ||= []).push(l);
    });
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  // QTD + YTD windows relative to today. QTD = deals closed in the
  // current calendar quarter; YTD = deals closed in the current year.
  // Both count Issued + Pending, matching the per-month pie charts.
  const bigPicture = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const curQuarter = Math.floor(now.getMonth() / 3); // 0-3
    const ytdItems = visible.filter(l => (l.closedDate || '').slice(0, 4) === String(year));
    const qtdItems = ytdItems.filter(l => {
      const m = parseInt((l.closedDate || '').slice(5, 7), 10);
      return Number.isFinite(m) && Math.floor((m - 1) / 3) === curQuarter;
    });
    return {
      quarterLabel: `Q${curQuarter + 1} ${year}`,
      yearLabel: `${year} YTD`,
      qtd: { items: qtdItems, crm: buildCrmData(qtdItems), cat: buildCatData(qtdItems) },
      ytd: { items: ytdItems, crm: buildCrmData(ytdItems), cat: buildCatData(ytdItems) },
    };
  }, [visible]);

  const bigActive = bigRange === 'qtd' ? bigPicture.qtd : bigPicture.ytd;
  const bigActiveLabel = bigRange === 'qtd' ? bigPicture.quarterLabel : bigPicture.yearLabel;

  if (grouped.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Closed Deals Tracker</h1>
            <p className="text-sm text-slate-500 mt-0.5">Pending + Issued deals grouped by month</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200">
          <EmptyState
            icon={Trophy}
            title="No closed deals yet"
            message="When you mark a lead as Pending or Issued, it lands here grouped by month — with full breakdowns of premium, advance, and association residuals. Snap a portal screenshot to add your first one."
            actions={onImportFromScreenshot ? [
              { label: 'Import from screenshot', onClick: onImportFromScreenshot, icon: ImageUp },
            ] : []}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Closed Deals Tracker</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="text-emerald-700 font-medium">{totals.issuedCount} Issued</span>
            {totals.pendingCount > 0 && <> · <span className="text-amber-700 font-medium">{totals.pendingCount} Pending</span></>}
            {' '}· Pending deals show but don&apos;t contribute advance until Issued.
          </p>
        </div>
        <div className="flex gap-2 text-sm flex-wrap">
          {onImportFromScreenshot && (
            <button onClick={onImportFromScreenshot}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-2 font-semibold flex items-center gap-1.5">
              <ImageUp size={14} /> Import from screenshot
            </button>
          )}
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-500">Deals: </span>
            <span className="font-bold text-slate-900">{totals.deals}</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-500">Lead cost: </span>
            <span className="font-bold text-red-600">{fmt2(totals.totalLeadCost)}</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-500">Advance: </span>
            <span className="font-bold text-emerald-700">{fmt2(totals.totalCommission)}</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
            <span className="text-slate-500">Profit: </span>
            <span className="font-bold text-emerald-700">{fmt2(totals.totalProfit)}</span>
          </div>
        </div>
      </div>

      {/* Big Picture — collapsible QTD / YTD breakdowns */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowBigPicture(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <BarChart3 size={16} className="text-indigo-600 flex-shrink-0" />
            <span className="font-bold text-slate-900 text-sm">Big Picture — QTD &amp; YTD</span>
            <span className="text-xs text-slate-400">
              See how your sources and lead types perform over the quarter and the year
            </span>
          </div>
          <ChevronDown
            size={18}
            className={`text-slate-400 flex-shrink-0 transition-transform ${showBigPicture ? 'rotate-180' : ''}`}
          />
        </button>

        {showBigPicture && (
          <div className="px-4 pb-4 border-t border-slate-100">
            {/* QTD / YTD toggle */}
            <div className="flex items-center gap-3 flex-wrap pt-4 pb-3">
              <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
                <button
                  onClick={() => setBigRange('qtd')}
                  className={`px-3 py-1.5 font-medium ${bigRange === 'qtd' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {bigPicture.quarterLabel}
                </button>
                <button
                  onClick={() => setBigRange('ytd')}
                  className={`px-3 py-1.5 font-medium ${bigRange === 'ytd' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {bigPicture.yearLabel}
                </button>
              </div>
              <span className="text-xs text-slate-500">
                {bigActive.items.length} deal{bigActive.items.length !== 1 ? 's' : ''} in this window
              </span>
            </div>

            {/* Donuts — CRM Source + Lead Type for the selected window */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LeadAnalyticsDonut
                title="CRM Source"
                subtitle={`${bigActiveLabel} · ${bigActive.items.length} deal${bigActive.items.length !== 1 ? 's' : ''}`}
                totalLabel="Deals"
                data={bigActive.crm}
                emptyMessage="No deals in this window yet"
              />
              <LeadAnalyticsDonut
                title="Lead Type"
                subtitle={`${bigActiveLabel} · ${bigActive.items.length} deal${bigActive.items.length !== 1 ? 's' : ''}`}
                totalLabel="Deals"
                data={bigActive.cat}
                emptyMessage="No deals in this window yet"
              />
            </div>
          </div>
        )}
      </div>

      {/* Month sections */}
      {grouped.map(([ym, items]) => {
        const issuedItems = items.filter(l => l.stage === 'Issued');
        const totCommission = issuedItems.reduce((s, l) => s + (l.dealValue || 0), 0);
        const totLeadCost = items.reduce((s, l) => s + (l.leadCost || 0), 0);
        const totProfit = totCommission - totLeadCost;

        // CRM source + Lead Type breakdowns for this month. Lead Type
        // drills into campaigns when a slice is clicked (see below).
        const crmData = buildCrmData(items);
        const catData = buildCatData(items);

        // When a category is drilled into for THIS month, build the
        // campaign breakdown for just those leads. Inherit the parent
        // category's color as a base, lightened across slices so the
        // sub-pie reads as part of the same family.
        const drilledCategory = drillByMonth[ym] || null;
        const drilledItems = drilledCategory
          ? items.filter(l => effectiveLeadCategory(l) === drilledCategory)
          : [];
        const campaignMap = {};
        drilledItems.forEach(l => {
          const k = l.campaign || '— No campaign';
          campaignMap[k] = (campaignMap[k] || 0) + 1;
        });
        const baseColor = LEAD_CATEGORIES.find(c => c.id === drilledCategory)?.color || '#6366f1';
        const campaignData = Object.entries(campaignMap)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v], i, arr) => {
            // Pull the campaign's own color when defined; otherwise
            // shade a tint of the parent category color so all sub-slices
            // visually belong together.
            const campaignDef = CAMPAIGNS.find(c => c.id === k);
            const fallback = lighten(baseColor, 0.15 + (i / Math.max(arr.length - 1, 1)) * 0.45);
            return { name: k, value: v, color: campaignDef?.color || fallback };
          });

        return (
          <div key={ym} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-yellow-300 px-4 py-1.5 font-bold text-slate-900 text-sm tracking-wider border-b-2 border-yellow-500">
              {monthLabel(ym)} · {items.length} DEAL{items.length !== 1 ? 'S' : ''}
              {issuedItems.length !== items.length && (
                <> ({issuedItems.length} issued, {items.length - issuedItems.length} pending)</>
              )}
              {totCommission > 0 && <> · {fmt(totCommission)} ADVANCE</>}
            </div>
            <div className="p-4 space-y-4">
              {/* Charts moved ABOVE the table so the table can use full width.
                  Editable columns need real estate to render dropdowns + dates
                  without clipping. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <LeadAnalyticsDonut
                  title="CRM Source"
                  subtitle={`${items.length} deal${items.length !== 1 ? 's' : ''} this month`}
                  totalLabel="Deals"
                  data={crmData}
                />
                {drilledCategory ? (
                  <LeadAnalyticsDonut
                    title={`${drilledCategory} Campaigns`}
                    subtitle={`${drilledItems.length} ${drilledCategory} deal${drilledItems.length !== 1 ? 's' : ''} broken down by campaign`}
                    totalLabel={drilledCategory}
                    data={campaignData}
                    onBack={() => drillOut(ym)}
                    emptyMessage="No campaign data for these leads"
                  />
                ) : (
                  <LeadAnalyticsDonut
                    title="Lead Type"
                    subtitle="Click any slice to drill into campaigns"
                    totalLabel="Deals"
                    data={catData}
                    onSliceClick={(slice) => drillInto(ym, slice.name)}
                  />
                )}
              </div>
              <div className="overflow-x-auto">
                {/* min-w forces horizontal scroll when needed instead of
                    squeezing columns into illegible slivers. */}
                <table className="text-sm" style={{ minWidth: '1180px', width: '100%' }}>
                  <thead className="bg-slate-50 text-slate-600 text-xs">
                    <tr>
                      <th className="text-left p-2 sticky left-0 bg-slate-50 z-10" style={{ minWidth: '160px' }}>Name</th>
                      <th className="text-left p-2" style={{ minWidth: '110px' }}>Stage</th>
                      <th className="text-left p-2" style={{ minWidth: '180px' }}>Products</th>
                      <th className="text-left p-2" style={{ minWidth: '130px' }}>Policy #</th>
                      <th className="text-left p-2" style={{ minWidth: '120px' }}>Day Purchased</th>
                      <th className="text-left p-2" style={{ minWidth: '120px' }}>Date Sold</th>
                      <th className="text-left p-2" style={{ minWidth: '110px' }}>CRM</th>
                      <th className="text-left p-2" style={{ minWidth: '160px' }}>Campaign</th>
                      <th className="text-right p-2" style={{ minWidth: '90px' }}>Lead Cost</th>
                      <th className="text-right p-2" style={{ minWidth: '100px' }}>Advance</th>
                      <th className="text-right p-2">Profit</th>
                      <th className="text-right p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(l => {
                      const isIssued = l.stage === 'Issued';
                      const profit = isIssued ? (l.dealValue || 0) - (l.leadCost || 0) : 0;
                      const prods = [l.mainProduct, l.associationPlan, ...(l.products || []).map(p => p.id)].filter(Boolean).join(', ') || '—';
                      return (
                        <tr key={l.id} className={`border-t border-slate-100 ${isIssued ? 'hover:bg-slate-50' : 'bg-amber-50/30 hover:bg-amber-50'}`}>
                          <td className={`p-2 font-medium sticky left-0 z-10 ${isIssued ? 'bg-white' : 'bg-amber-50/30'}`}>
                            <input
                              className={inlineCell + ' font-medium text-sm'}
                              value={l.name || ''}
                              onChange={(e) => patch(l, 'name', e.target.value)}
                              placeholder="—"
                              title="Click to edit"
                            />
                          </td>
                          <td className="p-2">
                            {/* Stage uses StageBadge for non-edit display, switches
                                to a select on click. Keeping the badge as a select
                                styled to match keeps the table compact. */}
                            <select
                              value={l.stage}
                              onChange={(e) => patch(l, 'stage', e.target.value)}
                              className={`text-xs font-medium px-2 py-0.5 rounded border-transparent hover:border-slate-300 focus:border-indigo-400 cursor-pointer ${(STAGES.find(s => s.id === l.stage) || STAGES[0]).bg} ${(STAGES.find(s => s.id === l.stage) || STAGES[0]).text}`}
                              title="Change stage"
                            >
                              {STAGES.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                            </select>
                          </td>
                          <td className="p-2 text-xs text-slate-600 max-w-xs truncate" title={prods}>
                            {/* Products stay read-only here — pencil icon opens
                                the full LeadForm modal where the product picker
                                with premiums lives. */}
                            {prods}
                          </td>
                          <td className="p-2">
                            <input
                              className={inlineCell + ' font-mono'}
                              value={l.policyNumber || ''}
                              onChange={(e) => patch(l, 'policyNumber', e.target.value)}
                              placeholder="—"
                              title="Policy number (editable)"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="date"
                              className={inlineCell}
                              value={l.dateAdded || ''}
                              onChange={(e) => patch(l, 'dateAdded', e.target.value)}
                              title="When the lead was purchased"
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="date"
                              className={inlineCell}
                              value={l.closedDate || ''}
                              onChange={(e) => patch(l, 'closedDate', e.target.value)}
                              title="When the deal was sold / submitted"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              className={inlineCell}
                              value={l.crm || ''}
                              onChange={(e) => {
                                if (e.target.value === ADD_CUSTOM_VALUE) {
                                  promptCustom(l, 'crms', 'crm');
                                  return;
                                }
                                patch(l, 'crm', e.target.value);
                              }}
                              title="CRM source"
                            >
                              <option value="">—</option>
                              {ALL_CRMS.map(c => (
                                <option key={c.id} value={c.id}>{c.id}{c.custom ? ' ★' : ''}</option>
                              ))}
                              <option value={ADD_CUSTOM_VALUE}>+ Add custom…</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <select
                              className={inlineCell}
                              value={l.campaign || ''}
                              onChange={(e) => {
                                if (e.target.value === ADD_CUSTOM_VALUE) {
                                  promptCustom(l, 'campaigns', 'campaign');
                                  return;
                                }
                                patch(l, 'campaign', e.target.value);
                              }}
                              title="Campaign"
                            >
                              <option value="">—</option>
                              {ALL_CAMPAIGNS.map(c => (
                                <option key={c.id} value={c.id}>{c.id}{c.custom ? ' ★' : ''}</option>
                              ))}
                              <option value={ADD_CUSTOM_VALUE}>+ Add custom…</option>
                            </select>
                          </td>
                          <td className="text-right p-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className={inlineCell + ' text-right text-red-600'}
                              value={l.leadCost ?? 0}
                              onChange={(e) => patch(l, 'leadCost', parseFloat(e.target.value) || 0)}
                              title="Lead cost"
                            />
                          </td>
                          <td className={`text-right p-2 font-medium`}>
                            {isIssued ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className={inlineCell + ' text-right text-emerald-700 font-medium'}
                                value={l.dealValue ?? 0}
                                onChange={(e) => patch(l, 'dealValue', parseFloat(e.target.value) || 0)}
                                title="Advance amount"
                              />
                            ) : (
                              <span className="italic text-xs text-slate-300">pending</span>
                            )}
                          </td>
                          <td className={`text-right p-2 font-medium ${isIssued ? (profit >= 0 ? 'text-emerald-700' : 'text-red-600') : 'text-slate-300'}`}>
                            {isIssued ? fmt(profit) : '—'}
                          </td>
                          <td className="text-right p-2">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => onEdit(l)} title="Open full editor (products, association, notes, etc.)" className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50"><Edit2 size={14} /></button>
                              {onDelete && (
                                <button
                                  onClick={() => { if (confirm(`Delete deal for ${l.name || '(unnamed)'}? This can't be undone.`)) onDelete(l.id); }}
                                  title="Delete"
                                  className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                                ><Trash2 size={14} /></button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 text-xs font-medium">
                    <tr>
                      <td colSpan="7" className="p-2 text-right text-slate-600">MONTH TOTALS (Issued only):</td>
                      <td className="text-right p-2 text-red-600">{fmt2(totLeadCost)}</td>
                      <td className="text-right p-2 text-emerald-700">{fmt(totCommission)}</td>
                      <td className={`text-right p-2 ${totProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(totProfit)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(ClosedDeals);
