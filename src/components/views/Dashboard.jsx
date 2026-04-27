'use client';
import { useMemo, useState, memo } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Users, Target, DollarSign, TrendingUp, CheckCircle2, Percent, MapPin } from 'lucide-react';
import { STAGES, SOURCES, LEAD_CATEGORIES, CRMS, effectiveLeadCategory } from '@/lib/constants';
import { fmt } from '@/lib/utils';
import { Chart3DCard, TiltCard, Stagger, StaggerItem, Pie3D } from '../motion/MotionPrimitives';

const Kpi = ({ label, value, grad, Icon }) => (
  <TiltCard className="bg-white rounded-xl p-3 border border-slate-200 shine-on-hover glow-ring cursor-default">
    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center text-white mb-2 shadow-md`} style={{ transform: 'translateZ(15px)' }}>
      <Icon size={16} />
    </div>
    <div className="text-xs text-slate-500">{label}</div>
    <div className="text-xl font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>{value}</div>
  </TiltCard>
);

/**
 * For the "By Source" breakdown, we want "CRM" source leads broken down by
 * which CRM they came from (RINGY / VANILLA / TEXTDRIP / GOOGLE). Non-CRM
 * sources (Referral, Website, Facebook, etc.) stay as-is.
 *
 * Label format for CRM sources: "CRM · RINGY"
 */
function effectiveSource(lead) {
  const src = lead.source || 'Other';
  if (src === 'CRM') {
    const crm = lead.crm || 'Unknown';
    return `CRM · ${crm}`;
  }
  return src;
}

// Color map for the merged source list
const SOURCE_COLORS = {
  'Website':  '#6366f1',
  'Referral': '#a855f7',
  'Facebook': '#3b82f6',
  'Google':   '#f59e0b',
  'LinkedIn': '#0ea5e9',
  'Cold Call': '#64748b',
  'Event':    '#14b8a6',
  'Dialer':   '#f97316',
  'Other':    '#94a3b8',
  // CRM subcategories use the CRM table color
};
function sourceColor(label) {
  if (label in SOURCE_COLORS) return SOURCE_COLORS[label];
  // CRM · XYZ → pull color from CRMS constant
  const m = label.match(/^CRM · (.+)$/);
  if (m) {
    const crm = CRMS.find(c => c.id === m[1]);
    if (crm) return crm.color;
  }
  return '#6366f1';
}

function Dashboard({ leads }) {
  const [stateMetric, setStateMetric] = useState('deals'); // 'deals' | 'issued' | 'advance'

  const total = leads.length;
  const won = leads.filter(l => l.stage === 'Issued');
  const lost = leads.filter(l => l.stage === 'Declined' || l.stage === 'Not taken' || l.stage === 'Withdrawn');
  const openLeads = leads.filter(l => l.stage === 'Pending');
  const revenue = won.reduce((s, l) => s + (l.dealValue || 0), 0);
  const avgDeal = won.length > 0 ? revenue / won.length : 0;
  const closeRate = (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : 0;

  const byMonth = useMemo(() => {
    const m = {};
    won.forEach(l => {
      if (!l.closedDate) return;
      const ym = l.closedDate.slice(0, 7);
      m[ym] = (m[ym] || 0) + (l.dealValue || 0);
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ month: k, revenue: v }));
  }, [won]);

  const stageData = STAGES.map(s => ({ name: s.id, value: leads.filter(l => l.stage === s.id).length, color: s.color }));

  // Source (with CRM breakdown)
  const sourceData = useMemo(() => {
    const m = {};
    for (const l of leads) {
      const key = effectiveSource(l);
      m[key] = (m[key] || 0) + 1;
    }
    return Object.entries(m)
      .map(([name, count]) => ({ name, count, color: sourceColor(name) }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Category breakdown (AGED / SHARED / REFERRAL / etc.)
  const categoryData = useMemo(() => {
    const m = {};
    for (const l of leads) {
      const cat = effectiveLeadCategory(l);
      m[cat] = (m[cat] || 0) + 1;
    }
    return Object.entries(m)
      .map(([name, count]) => {
        const cat = LEAD_CATEGORIES.find(c => c.id === name);
        return { name, count, color: cat?.color || '#94a3b8' };
      })
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // By state — for each 2-letter state code count total deals, Issued count, and advance sum.
  // Leads with no state are bucketed as "—".
  const stateData = useMemo(() => {
    const m = {};
    for (const l of leads) {
      const st = l.state || '—';
      if (!m[st]) m[st] = { state: st, deals: 0, issued: 0, advance: 0 };
      m[st].deals += 1;
      if (l.stage === 'Issued') {
        m[st].issued += 1;
        m[st].advance += l.dealValue || 0;
      }
    }
    return Object.values(m).filter(x => x.deals > 0);
  }, [leads]);

  // Metric config for the toggle
  const stateMetricConfig = {
    deals:   { label: 'Total deals',   key: 'deals',   color: '#6366f1', format: (v) => v.toString() },
    issued:  { label: 'Issued only',   key: 'issued',  color: '#10b981', format: (v) => v.toString() },
    advance: { label: 'Advance paid',  key: 'advance', color: '#8b5cf6', format: (v) => fmt(v) },
  };

  // Distinct color per state — deterministic so the same state always gets the same color.
  // Palette is 24 well-spaced hues; states are hashed into it by their 2-letter code.
  const STATE_PALETTE = [
    '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6',
    '#ef4444', '#14b8a6', '#f97316', '#3b82f6', '#a855f7', '#22c55e',
    '#eab308', '#d946ef', '#0ea5e9', '#84cc16', '#dc2626', '#0d9488',
    '#7c3aed', '#e11d48', '#2563eb', '#65a30d', '#db2777', '#9333ea',
  ];
  const stateColor = (code) => {
    if (!code || code === '—') return '#94a3b8'; // grey for missing state
    let hash = 0;
    for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) & 0x7fffffff;
    return STATE_PALETTE[hash % STATE_PALETTE.length];
  };
  const activeMetric = stateMetricConfig[stateMetric];
  const stateChartData = useMemo(
    () => [...stateData].sort((a, b) => (b[activeMetric.key] || 0) - (a[activeMetric.key] || 0)),
    [stateData, activeMetric.key]
  );
  const stateTotals = useMemo(() => ({
    totalStates: stateData.filter(x => x.state !== '—').length,
    totalDeals:  stateData.reduce((s, x) => s + x.deals, 0),
    totalIssued: stateData.reduce((s, x) => s + x.issued, 0),
    totalAdvance: stateData.reduce((s, x) => s + x.advance, 0),
    topState:    stateData.filter(x => x.state !== '—').sort((a, b) => b[activeMetric.key] - a[activeMetric.key])[0],
  }), [stateData, activeMetric.key]);

  return (
    <div className="space-y-5">
      <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StaggerItem><Kpi label="Total Leads" value={total} grad="from-indigo-500 to-blue-500" Icon={Users} /></StaggerItem>
        <StaggerItem><Kpi label="Open Leads" value={openLeads.length} grad="from-sky-500 to-cyan-500" Icon={Target} /></StaggerItem>
        <StaggerItem><Kpi label="Won" value={won.length} grad="from-emerald-500 to-green-500" Icon={CheckCircle2} /></StaggerItem>
        <StaggerItem><Kpi label="Revenue" value={fmt(revenue)} grad="from-violet-500 to-purple-500" Icon={DollarSign} /></StaggerItem>
        <StaggerItem><Kpi label="Avg Deal" value={fmt(avgDeal)} grad="from-amber-500 to-orange-500" Icon={TrendingUp} /></StaggerItem>
        <StaggerItem><Kpi label="Close Rate" value={closeRate.toFixed(0) + '%'} grad="from-teal-500 to-emerald-500" Icon={Percent} /></StaggerItem>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Chart3DCard className="lg:col-span-2">
          <h3 className="font-semibold mb-3 text-slate-900">Revenue by Month</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} animationDuration={900} />
            </LineChart>
          </ResponsiveContainer>
        </Chart3DCard>

        <Chart3DCard>
          <h3 className="font-semibold mb-3 text-slate-900">By Stage</h3>
          <Pie3D
            data={stageData}
            outerRadius={70}
            innerRadius={30}
            height={260}
            depth={14}
            tilt={48}
            showLabels
            fontSize={15}
          />
          <div className="text-[10px] grid grid-cols-2 gap-1 mt-2">
            {stageData.map(d => (
              <div key={d.name} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }}></span>
                <span className="text-slate-600">{d.name} ({d.value})</span>
              </div>
            ))}
          </div>
        </Chart3DCard>
      </div>

      {/* By Category + By Source side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Chart3DCard>
          <h3 className="font-semibold mb-3 text-slate-900">By Lead Category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={categoryData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="name" fontSize={11} width={100} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={900}>
                {categoryData.map((d, i) => <Cell key={i} fill={d.color} />)}
                <LabelList dataKey="count" position="right" fill="#0f172a" fontSize={13} fontWeight={700} offset={8} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart3DCard>

        <Chart3DCard>
          <h3 className="font-semibold mb-3 text-slate-900">By Source (CRM breakdown)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sourceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" fontSize={11} />
              <YAxis type="category" dataKey="name" fontSize={11} width={110} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={900}>
                {sourceData.map((d, i) => <Cell key={i} fill={d.color} />)}
                <LabelList dataKey="count" position="right" fill="#0f172a" fontSize={13} fontWeight={700} offset={8} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart3DCard>
      </div>

      {/* By State — hottest markets */}
      <Chart3DCard>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-indigo-600" />
              <h3 className="font-semibold text-slate-900">Deals by State</h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Your hottest markets by deal volume, conversion, or commission</p>
          </div>
          {/* Metric toggle */}
          <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
            {Object.entries(stateMetricConfig).map(([id, cfg]) => (
              <button
                key={id}
                onClick={() => setStateMetric(id)}
                className={`px-3 py-1.5 font-medium ${stateMetric === id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {stateChartData.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-6 italic">No state data yet — add State to your leads to populate this chart.</div>
        ) : (
          <>
            {/* Quick summary pills */}
            <div className="flex flex-wrap gap-2 text-sm mb-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-slate-500">States:</span>{' '}
                <span className="font-bold text-slate-900">{stateTotals.totalStates}</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-slate-500">Total Issued:</span>{' '}
                <span className="font-bold text-emerald-700">{stateTotals.totalIssued}</span>
              </div>
              <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-slate-500">Total Advance:</span>{' '}
                <span className="font-bold text-violet-700">{fmt(stateTotals.totalAdvance)}</span>
              </div>
              {stateTotals.topState && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-slate-500">Hottest:</span>{' '}
                  <span className="font-bold text-indigo-700">{stateTotals.topState.state} ({activeMetric.format(stateTotals.topState[activeMetric.key])})</span>
                </div>
              )}
            </div>

            <ResponsiveContainer width="100%" height={Math.max(220, stateChartData.length * 22)}>
              <BarChart data={stateChartData} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  fontSize={11}
                  tickFormatter={(v) => stateMetric === 'advance' ? fmt(v) : v}
                />
                <YAxis type="category" dataKey="state" fontSize={11} width={50} interval={0} />
                <Tooltip
                  formatter={(v) => activeMetric.format(v)}
                  labelFormatter={(label) => `State: ${label}`}
                />
                <Bar dataKey={activeMetric.key} radius={[0, 4, 4, 0]} animationDuration={900}>
                  {stateChartData.map((d, i) => <Cell key={i} fill={stateColor(d.state)} />)}
                  <LabelList
                    dataKey={activeMetric.key}
                    position="right"
                    fill="#0f172a"
                    fontSize={13}
                    fontWeight={700}
                    offset={8}
                    formatter={(v) => activeMetric.format(v)}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </Chart3DCard>
    </div>
  );
}

export default memo(Dashboard);
