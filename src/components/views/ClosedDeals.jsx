'use client';
import { useMemo, memo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Edit2, CheckCircle2, Clock } from 'lucide-react';
import { CRMS, LEAD_CATEGORIES, STAGES, effectiveLeadCategory } from '@/lib/constants';
import { fmt, fmt2, usDate, monthLabel } from '@/lib/utils';
import { Chart3DCard, Pie3D } from '../motion/MotionPrimitives';

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

function ClosedDeals({ leads, onEdit }) {
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
        <div className="bg-white rounded-xl border border-slate-200 text-center py-16 text-slate-400">
          No closed deals yet — submit a deal from the Leads tab.
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
        <div className="flex gap-2 text-sm">
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
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 p-4">
              <div className="lg:col-span-3 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs">
                    <tr>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Stage</th>
                      <th className="text-left p-2">Products</th>
                      <th className="text-left p-2">Day Purchased</th>
                      <th className="text-left p-2">Date Sold</th>
                      <th className="text-left p-2">CRM</th>
                      <th className="text-left p-2">Campaign</th>
                      <th className="text-right p-2">Lead Cost</th>
                      <th className="text-right p-2">Advance</th>
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
                          <td className="p-2 font-medium">{l.name}</td>
                          <td className="p-2"><StageBadge stage={l.stage} /></td>
                          <td className="p-2 text-xs text-slate-600 max-w-xs truncate" title={prods}>{prods}</td>
                          <td className="p-2 text-xs">{usDate(l.dateAdded)}</td>
                          <td className="p-2 text-xs">{usDate(l.closedDate)}</td>
                          <td className="p-2 text-xs">{l.crm}</td>
                          <td className="p-2 text-xs">{l.campaign}</td>
                          <td className="text-right p-2 text-red-600">{fmt2(l.leadCost)}</td>
                          <td className={`text-right p-2 font-medium ${isIssued ? 'text-emerald-700' : 'text-slate-300'}`}>
                            {isIssued ? fmt(l.dealValue) : <span className="italic text-xs">pending</span>}
                          </td>
                          <td className={`text-right p-2 font-medium ${isIssued ? (profit >= 0 ? 'text-emerald-700' : 'text-red-600') : 'text-slate-300'}`}>
                            {isIssued ? fmt(profit) : '—'}
                          </td>
                          <td className="text-right p-2">
                            <button onClick={() => onEdit(l)} className="text-slate-400 hover:text-indigo-600"><Edit2 size={14} /></button>
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                <DealPie data={crmData} title="CRM SOURCE" />
                <DealPie data={catData} title="LEAD TYPE" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(ClosedDeals);
