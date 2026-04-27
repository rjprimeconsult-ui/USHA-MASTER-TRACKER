'use client';
import { useMemo, memo } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Users, Repeat, TrendingUp, Award, Calendar, Pause, Play, Ban, Edit2 } from 'lucide-react';
import { ASSOCIATION_PRICING, QUARTERS, isPricedAssociation } from '@/lib/constants';
import { fmt, fmt2, usDate, monthsActiveTotal, monthsActiveInQuarter, getCurrentQuarter, getNextQuarter } from '@/lib/utils';
import { TiltCard, CountUp, Stagger, StaggerItem, Chart3DCard } from '../motion/MotionPrimitives';

// Canonical display order — highest tier first. Any plan not in this list
// gets sorted to the bottom alphabetically (so unknown plans always trail).
const TIER_ORDER = [
  'EXECUTIVE DIAMOND',
  'DIAMOND',
  'EMERALD',
  'SAPPHIRE',
  'RUBY',
  'ABC ELITE',
  'ABC EXECUTIVE',
  'ABC ENTREPRENEUR',
];
const tierRank = (plan) => {
  const i = TIER_ORDER.indexOf(plan);
  return i === -1 ? TIER_ORDER.length + 1 : i;
};

// Shimmer gradient class per tier
const TIER_CLASS = {
  'EXECUTIVE DIAMOND': 'tier-executive-diamond',
  'DIAMOND':           'tier-diamond',
  'EMERALD':           'tier-emerald',
  'SAPPHIRE':          'tier-sapphire',
  'RUBY':              'tier-ruby',
  'ABC ELITE':         'tier-abc-elite',
  'ABC EXECUTIVE':     'tier-abc-executive',
  'ABC ENTREPRENEUR':  'tier-abc-entrepreneur',
};
const tierClass = (plan) => TIER_CLASS[plan] || 'tier-default';

// Distinct color per quarter for the bar chart
const QUARTER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

const Kpi = ({ label, numeric, value, isCurrency = true, decimals = 0, sub, grad, Icon }) => {
  const formatNumber = (v) => {
    if (!isCurrency) return Math.round(v).toLocaleString();
    return '$' + (v || 0).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  };
  return (
    <TiltCard className="bg-white rounded-xl p-3 border border-slate-200 shine-on-hover glow-ring cursor-default">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center text-white mb-2 shadow-md`} style={{ transform: 'translateZ(15px)' }}>
        <Icon size={16} />
      </div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>
        {numeric != null ? <CountUp value={numeric} format={formatNumber} /> : value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </TiltCard>
  );
};

const StatusBadge = ({ s }) => {
  const cls = s === 'active' ? 'bg-emerald-100 text-emerald-700'
           : s === 'paused' ? 'bg-amber-100 text-amber-700'
           : 'bg-red-100 text-red-700';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>;
};

function AssociationsView({ leads, onEdit, onPause, onResume, onCancel }) {
  const clients = useMemo(() =>
    leads.filter(l => l.stage === 'Issued' && l.associationPlan && isPricedAssociation(l.associationPlan))
  , [leads]);

  const activeClients = clients.filter(c => c.associationStatus === 'active');
  const pausedClients = clients.filter(c => c.associationStatus === 'paused');
  const cancelledClients = clients.filter(c => c.associationStatus === 'cancelled');

  const monthlyCommission = (c) => ASSOCIATION_PRICING[c.associationPlan]?.commission || 0;
  const activeMonthly = activeClients.reduce((s, c) => s + monthlyCommission(c), 0);
  const yearly = activeMonthly * 12;

  const curQ = getCurrentQuarter();
  const nextQ = getNextQuarter();
  const curQPayout = activeMonthly * curQ.earningMonths.length;
  const nextQPayout = activeMonthly * nextQ.earningMonths.length;

  const year = new Date().getFullYear();
  const quarterData = QUARTERS.map(q => {
    const total = clients.reduce((s, c) => s + (ASSOCIATION_PRICING[c.associationPlan]?.commission || 0) * monthsActiveInQuarter(c, q, year), 0);
    return { name: q.label, value: total, desc: q.desc };
  });

  const byPlan = {};
  activeClients.forEach(c => {
    byPlan[c.associationPlan] ||= { count: 0, commission: 0 };
    byPlan[c.associationPlan].count += 1;
    byPlan[c.associationPlan].commission += monthlyCommission(c);
  });

  return (
    <div className="space-y-5">
      <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StaggerItem><Kpi label="Active Clients" numeric={activeClients.length} isCurrency={false} sub={`${pausedClients.length} paused · ${cancelledClients.length} cancelled`} grad="from-emerald-500 to-green-500" Icon={Users} /></StaggerItem>
        <StaggerItem><Kpi label="Monthly Recurring" numeric={activeMonthly} decimals={2} grad="from-indigo-500 to-blue-500" Icon={Repeat} /></StaggerItem>
        <StaggerItem><Kpi label="Projected Yearly" numeric={yearly} grad="from-violet-500 to-purple-500" Icon={TrendingUp} /></StaggerItem>
        <StaggerItem><Kpi label={`Current ${curQ.label} Payout`} numeric={curQPayout} sub={curQ.desc} grad="from-amber-500 to-orange-500" Icon={Award} /></StaggerItem>
        <StaggerItem><Kpi label={`Next ${nextQ.label} Projected`} numeric={nextQPayout} sub={nextQ.desc} grad="from-cyan-500 to-teal-500" Icon={Calendar} /></StaggerItem>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Chart3DCard className="lg:col-span-2">
          <h3 className="font-semibold text-slate-900 mb-3">Quarterly Payouts ({year})</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={quarterData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => fmt2(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={900}>
                {quarterData.map((_, i) => <Cell key={i} fill={QUARTER_COLORS[i % QUARTER_COLORS.length]} />)}
                <LabelList dataKey="value" position="top" fill="#0f172a" fontSize={11} fontWeight={700} formatter={(v) => v > 0 ? fmt(v) : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart3DCard>

        <Chart3DCard>
          <h3 className="font-semibold text-slate-900 mb-3">By Plan (Active)</h3>
          <div className="space-y-2">
            {Object.entries(byPlan)
              .sort(([a], [b]) => tierRank(a) - tierRank(b) || a.localeCompare(b))
              .map(([plan, d]) => (
                <div key={plan} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                  <span className={`tier-text ${tierClass(plan)}`}>{plan}</span>
                  <span className="text-slate-500">{d.count} · <span className="text-emerald-700 font-medium">{fmt2(d.commission)}/mo</span></span>
                </div>
              ))}
            {Object.keys(byPlan).length === 0 && <div className="text-slate-400 text-sm">No active clients yet.</div>}
          </div>
        </Chart3DCard>
      </div>

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">All Association Clients</h3>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-left p-2">Client</th>
                <th className="text-left p-2">Main Product</th>
                <th className="text-left p-2">Association</th>
                <th className="text-right p-2">Monthly Premium</th>
                <th className="text-right p-2">Monthly Comm</th>
                <th className="text-left p-2">Start Date</th>
                <th className="text-center p-2">Status</th>
                <th className="text-right p-2">Months Active</th>
                <th className="text-right p-2">Total Paid</th>
                <th className="text-right p-2">Projected Annual</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => {
                const p = ASSOCIATION_PRICING[c.associationPlan];
                const months = monthsActiveTotal(c);
                const paid = months * (p?.commission || 0);
                const projAnnual = (c.associationStatus === 'active' ? (p?.commission || 0) * 12 : 0);
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-medium text-slate-900">{c.name}</td>
                    <td className="p-2"><span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">{c.mainProduct || '—'}</span></td>
                    <td className="p-2"><span className={`tier-text ${tierClass(c.associationPlan)} text-xs`}>{c.associationPlan}</span></td>
                    <td className="text-right p-2">{fmt2(p?.premium || 0)}</td>
                    <td className="text-right p-2 text-emerald-700 font-medium">{fmt2(p?.commission || 0)}</td>
                    <td className="p-2">{usDate(c.associationStartDate)}</td>
                    <td className="text-center p-2"><StatusBadge s={c.associationStatus} /></td>
                    <td className="text-right p-2">{months}</td>
                    <td className="text-right p-2">{fmt2(paid)}</td>
                    <td className="text-right p-2 text-emerald-700 font-bold">{fmt(projAnnual)}</td>
                    <td className="text-right p-2">
                      <div className="flex justify-end gap-1">
                        {c.associationStatus === 'active' && (
                          <button onClick={() => onPause(c.id)} title="Pause" className="text-amber-600 hover:bg-amber-50 p-1 rounded"><Pause size={14} /></button>
                        )}
                        {c.associationStatus === 'paused' && (
                          <button onClick={() => onResume(c.id)} title="Resume" className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Play size={14} /></button>
                        )}
                        {c.associationStatus !== 'cancelled' && (
                          <button onClick={() => onCancel(c.id)} title="Cancel" className="text-red-600 hover:bg-red-50 p-1 rounded"><Ban size={14} /></button>
                        )}
                        <button onClick={() => onEdit(c)} title="Edit" className="text-slate-500 hover:bg-slate-100 p-1 rounded"><Edit2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && (
                <tr><td colSpan="11" className="text-center p-8 text-slate-400">No association clients yet. Close a deal with a priced association plan to see it here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default memo(AssociationsView);
