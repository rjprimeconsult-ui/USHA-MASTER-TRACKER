'use client';
import { useMemo, memo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Edit2, Trash2, CheckCircle2, Clock, ImageUp } from 'lucide-react';
import { CRMS, CAMPAIGNS, LEAD_CATEGORIES, STAGES, effectiveLeadCategory } from '@/lib/constants';
import { fmt, fmt2, usDate, monthLabel } from '@/lib/utils';
import { Chart3DCard, Pie3D } from '../motion/MotionPrimitives';

// Tailwind utility for the bare-style inline-edit input. Borderless
// until hover, indigo ring on focus. Same pattern Books table uses.
// `truncate` keeps long content from blowing out fixed-width cells.
const inlineCell = 'border border-transparent hover:border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 rounded px-1 py-0.5 bg-transparent w-full text-xs truncate';

const DealPie = ({ data, title }) => (
  <Chart3DCard fadeIn={false} className="!p-3">
    <div className="text-xs font-semibold text-slate-600 mb-1">{title}</div>
    <Pie3D
      data={data}
      outerRadius={55}
      innerRadius={24}
      height={200}
      depth={10}
      tilt={45}
      showLabels
      fontSize={13}
    />
    <div className="text-[10px] space-y-0.5 mt-1">
      {data.map(d => (
        <div key={d.name} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }}></span>
          <span className="text-slate-600 flex-1 truncate">{d.name}</span>
          <span className="text-slate-900 font-medium">{d.value}</span>
        </div>
      ))}
    </div>
  </Chart3DCard>
);

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
  // Inline edit helper — patches a single field on a lead and saves via
  // the parent's onUpdate. No-ops when onUpdate isn't passed (defensive
  // fallback for any caller that doesn't wire it up).
  const patch = (lead, field, value) => {
    if (!onUpdate) return;
    onUpdate({ ...lead, [field]: value });
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

  if (grouped.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Closed Deals Tracker</h1>
            <p className="text-sm text-slate-500 mt-0.5">Pending + Issued deals grouped by month</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 text-center py-16">
          <p className="text-slate-400 mb-4">No closed deals yet — submit a deal from the Leads tab.</p>
          {onImportFromScreenshot && (
            <button onClick={onImportFromScreenshot}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold inline-flex items-center gap-1.5">
              <ImageUp size={14} /> Import from screenshot
            </button>
          )}
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

      {/* Month sections */}
      {grouped.map(([ym, items]) => {
        const issuedItems = items.filter(l => l.stage === 'Issued');
        const totCommission = issuedItems.reduce((s, l) => s + (l.dealValue || 0), 0);
        const totLeadCost = items.reduce((s, l) => s + (l.leadCost || 0), 0);
        const totProfit = totCommission - totLeadCost;

        const crmMap = {};
        items.forEach(l => { crmMap[l.crm] = (crmMap[l.crm] || 0) + 1; });
        const crmData = Object.entries(crmMap).map(([k, v]) => ({
          name: k, value: v, color: CRMS.find(c => c.id === k)?.color || '#94a3b8',
        }));
        const catMap = {};
        items.forEach(l => {
          const cat = effectiveLeadCategory(l);
          catMap[cat] = (catMap[cat] || 0) + 1;
        });
        const catData = Object.entries(catMap).map(([k, v]) => ({
          name: k, value: v, color: LEAD_CATEGORIES.find(c => c.id === k)?.color || '#94a3b8',
        }));

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
                <DealPie data={crmData} title="CRM SOURCE" />
                <DealPie data={catData} title="LEAD TYPE" />
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
                              onChange={(e) => patch(l, 'crm', e.target.value)}
                              title="CRM source"
                            >
                              <option value="">—</option>
                              {CRMS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                            </select>
                          </td>
                          <td className="p-2">
                            <select
                              className={inlineCell}
                              value={l.campaign || ''}
                              onChange={(e) => patch(l, 'campaign', e.target.value)}
                              title="Campaign"
                            >
                              <option value="">—</option>
                              {CAMPAIGNS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
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
