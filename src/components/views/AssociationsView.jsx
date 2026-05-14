'use client';
import { useMemo, useState, memo } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Users, Repeat, TrendingUp, Award, Calendar, Pause, Play, Ban, Edit2, Upload, Database, FileText, Trash2 } from 'lucide-react';
import { ASSOCIATION_PRICING, QUARTERS, isPricedAssociation } from '@/lib/constants';
import { fmt, fmt2, usDate, monthsActiveTotal, monthsActiveInQuarter, getCurrentQuarter, getNextQuarter } from '@/lib/utils';
import {
  getAgentResidualRateTagged,
  netEarned,
  activeBook,
  periodTotals,
  ytdTotal,
  estimateYtdFromSnapshot,
  buildBookIndex,
  latestPeriodOf,
  matchLeadToBook,
  aggregateByPolicy,
} from '@/lib/associationResiduals';
import { TiltCard, CountUp, Stagger, StaggerItem, Chart3DCard } from '../motion/MotionPrimitives';
import { useChartColors } from '@/lib/useIsDark';

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

function AssociationsView({
  leads,
  onEdit,
  onPause,
  onResume,
  onCancel,
  // New: residual tracking from CommissionDetail.csv
  abDetail = [],          // imported residual rows (isolated storage)
  agentRates = {},        // derived per-plan effective rates
  onOpenImport,           // opens the CommissionDetail uploader
  onClearResidualBook,    // resets the residual book + agent rates
}) {
  const chartColors = useChartColors();
  const clients = useMemo(() =>
    leads.filter(l => l.stage === 'Issued' && l.associationPlan && isPricedAssociation(l.associationPlan))
  , [leads]);

  const activeClients = clients.filter(c => c.associationStatus === 'active');
  const pausedClients = clients.filter(c => c.associationStatus === 'paused');
  const cancelledClients = clients.filter(c => c.associationStatus === 'cancelled');

  // Build the name index ONCE per render-cycle. Lookups are O(1) afterward,
  // so per-client matching during the table render stays cheap even with
  // 200+ clients.
  const bookIndex   = useMemo(() => buildBookIndex(abDetail), [abDetail]);
  const latestPer   = useMemo(() => latestPeriodOf(abDetail), [abDetail]);
  const hasBookData = abDetail && abDetail.length > 0;

  // Per-client lookup that returns BOTH the truth (when the name matched a
  // CommissionDetail row) AND a projection fallback. The UI uses `source`
  // to badge each row honestly:
  //   exact      — pulled from CSV, real rate Julio currently earns
  //   projected  — agent-tier rate (most recent contract bump applied)
  //   baseline   — no agent data, USHA default contract rate
  //   ambiguous  — duplicate name in the book; falls back to projection
  const rateInfo = (planId) => getAgentResidualRateTagged(planId, agentRates);
  const clientResidual = (c) => {
    const m = hasBookData ? matchLeadToBook(c, bookIndex, latestPer) : { matched: false };
    const ri = rateInfo(c.associationPlan);
    if (m.matched && m.currentMonthly != null) {
      return {
        monthly: m.currentMonthly,
        totalPaid: m.totalPaid,
        source: 'exact',
        active: m.active,
        policyId: m.policyId,
      };
    }
    if (m.ambiguous) {
      return {
        monthly: ri.rate,
        totalPaid: null,
        source: 'ambiguous',
        active: null,
        policyId: null,
      };
    }
    return {
      monthly: ri.rate,
      totalPaid: null,
      source: ri.source, // 'agent' | 'baseline' | 'unknown'
      active: null,
      policyId: null,
    };
  };

  // Aggregations derived from imported CommissionDetail rows.
  const carrierBook   = useMemo(() => activeBook(abDetail), [abDetail]);
  const carrierTrend  = useMemo(() => periodTotals(abDetail), [abDetail]);
  const carrierYtd    = useMemo(() => ytdTotal(abDetail), [abDetail]);
  const carrierTotal  = useMemo(() => netEarned(abDetail), [abDetail]);
  const carrierYtdEst = useMemo(() => estimateYtdFromSnapshot(abDetail), [abDetail]);
  const fullBook      = useMemo(() => aggregateByPolicy(abDetail), [abDetail]);

  // Run-rate: when CSV is imported, the carrier book is the truth (every
  // customer regardless of whether they're tracked as a PRIM lead). Otherwise
  // fall back to summing PRIM-tracked leads.
  const leadsActiveMonthly = activeClients.reduce((s, c) => s + clientResidual(c).monthly, 0);
  const activeMonthly = hasBookData ? carrierBook.monthly : leadsActiveMonthly;
  const activeCount = hasBookData ? carrierBook.count : activeClients.length;
  const yearly = activeMonthly * 12;
  const hasAgentRates = Object.keys(agentRates || {}).length > 0;
  // We have "actual YTD" when the agent has uploaded every month from
  // January through the latest period. Otherwise we fall back to the
  // one-snapshot estimate so they always see a YTD-ish number.
  const periodsImported = useMemo(() => new Set(abDetail.map(r => r.period).filter(Boolean)), [abDetail]);
  const hasFullYtd = (() => {
    if (!carrierYtd.year || carrierYtd.total === 0) return false;
    const month = carrierBook.period ? Number(carrierBook.period.split('-')[1]) : 0;
    if (!month) return false;
    for (let m = 1; m <= month; m++) {
      const key = `${carrierYtd.year}-${String(m).padStart(2, '0')}`;
      if (!periodsImported.has(key)) return false;
    }
    return true;
  })();

  // Reconciliation badge: how many clients matched to the book?
  const matchStats = useMemo(() => {
    if (!hasBookData) return null;
    let exact = 0, ambiguous = 0, unmatched = 0;
    for (const c of clients) {
      const r = clientResidual(c);
      if (r.source === 'exact') exact++;
      else if (r.source === 'ambiguous') ambiguous++;
      else unmatched++;
    }
    return { exact, ambiguous, unmatched, total: clients.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, hasBookData, abDetail, agentRates]);

  const curQ = getCurrentQuarter();
  const nextQ = getNextQuarter();
  const curQPayout = activeMonthly * curQ.earningMonths.length;
  const nextQPayout = activeMonthly * nextQ.earningMonths.length;

  const year = new Date().getFullYear();
  // When CSV is imported, all charts use the full carrier book (every active
  // subscriber, not just PRIM-tracked leads). Without CSV we fall back to the
  // PRIM-leads-only computation so the page still renders meaningfully.
  const quarterData = hasBookData
    ? QUARTERS.map(q => ({ name: q.label, value: activeMonthly * q.earningMonths.length, desc: q.desc }))
    : QUARTERS.map(q => ({
        name: q.label,
        value: clients.reduce((s, c) => s + clientResidual(c).monthly * monthsActiveInQuarter(c, q, year), 0),
        desc: q.desc,
      }));

  const byPlan = {};
  if (hasBookData) {
    // From the carrier book — every active subscriber, accurate per-tier.
    for (const [planId, info] of Object.entries(carrierBook.byPlan || {})) {
      byPlan[planId] = { count: info.count, commission: info.monthly };
    }
  } else {
    // Fallback: PRIM-tracked leads only.
    activeClients.forEach(c => {
      byPlan[c.associationPlan] ||= { count: 0, commission: 0 };
      byPlan[c.associationPlan].count += 1;
      byPlan[c.associationPlan].commission += clientResidual(c).monthly;
    });
  }

  return (
    <div className="space-y-5">
      {/* CommissionDetail import + agent-rate banner. Always visible at the top
          so the agent always has a one-click path to refresh their residual book. */}
      <CommissionDetailPanel
        abDetail={abDetail}
        agentRates={agentRates}
        carrierBook={carrierBook}
        carrierYtd={carrierYtd}
        carrierTotal={carrierTotal}
        carrierYtdEst={carrierYtdEst}
        hasFullYtd={hasFullYtd}
        hasAgentRates={hasAgentRates}
        matchStats={matchStats}
        onOpenImport={onOpenImport}
        onClearResidualBook={onClearResidualBook}
      />

      {abDetail.length > 0 && carrierTrend.length > 0 && (
        <Chart3DCard>
          <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-indigo-500" />
            Monthly residual paid (from CommissionDetail)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={carrierTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis dataKey="period" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => fmt2(v)} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]} fill="#6366f1" animationDuration={700}>
                <LabelList dataKey="total" position="top" fill={chartColors.label} fontSize={10} fontWeight={700} formatter={(v) => v > 0 ? fmt(v) : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-500 mt-2">
            Net of reversals. Upload prior-month CommissionDetail files to extend the trend back further.
          </p>
        </Chart3DCard>
      )}

      <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StaggerItem>
          <Kpi
            label="Active Clients"
            numeric={activeCount}
            isCurrency={false}
            sub={hasBookData
              ? (carrierBook.period ? `as of ${carrierBook.period}` : 'from CommissionDetail')
              : `${pausedClients.length} paused · ${cancelledClients.length} cancelled`}
            grad="from-emerald-500 to-green-500"
            Icon={Users}
          />
        </StaggerItem>
        <StaggerItem><Kpi label="Monthly Recurring" numeric={activeMonthly} decimals={2} grad="from-indigo-500 to-blue-500" Icon={Repeat} /></StaggerItem>
        <StaggerItem><Kpi label="Projected Yearly" numeric={yearly} grad="from-violet-500 to-purple-500" Icon={TrendingUp} /></StaggerItem>
        <StaggerItem>
          <Kpi
            label={hasBookData
              ? (hasFullYtd ? `${carrierYtd.year} YTD Earned` : `${carrierYtdEst.year || carrierYtd.year || ''} YTD Est.`)
              : `Current ${curQ.label} Payout`}
            numeric={hasBookData
              ? (hasFullYtd ? carrierYtd.total : carrierYtdEst.estimatedTotal)
              : curQPayout}
            decimals={2}
            sub={hasBookData
              ? (hasFullYtd ? 'actual · net of reversals' : `est. · ${carrierYtdEst.monthsCovered} mo × current rates`)
              : curQ.desc}
            grad="from-amber-500 to-orange-500"
            Icon={Award}
          />
        </StaggerItem>
        <StaggerItem><Kpi label={`Next ${nextQ.label} Projected`} numeric={nextQPayout} sub={nextQ.desc} grad="from-cyan-500 to-teal-500" Icon={Calendar} /></StaggerItem>
      </Stagger>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Chart3DCard className="lg:col-span-2">
          <h3 className="font-semibold text-slate-900 mb-3">Quarterly Payouts ({year})</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={quarterData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v) => fmt2(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={900}>
                {quarterData.map((_, i) => <Cell key={i} fill={QUARTER_COLORS[i % QUARTER_COLORS.length]} />)}
                <LabelList dataKey="value" position="top" fill={chartColors.label} fontSize={11} fontWeight={700} formatter={(v) => v > 0 ? fmt(v) : ''} />
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

      {hasBookData ? (
        <ResidualBookTable
          fullBook={fullBook}
          leads={leads}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />
      ) : (
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
                const r = clientResidual(c);
                const months = monthsActiveTotal(c);
                // Total Paid: prefer real sum from CSV; fall back to months × projection rate.
                const paid = r.totalPaid != null ? r.totalPaid : months * r.monthly;
                const projAnnual = (c.associationStatus === 'active' ? r.monthly * 12 : 0);
                return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 font-medium text-slate-900">{c.name}</td>
                    <td className="p-2"><span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">{c.mainProduct || '—'}</span></td>
                    <td className="p-2"><span className={`tier-text ${tierClass(c.associationPlan)} text-xs`}>{c.associationPlan}</span></td>
                    <td className="text-right p-2">{fmt2(p?.premium || 0)}</td>
                    <td className="text-right p-2 text-emerald-700 font-medium">
                      {fmt2(r.monthly)}
                      <ResidualSourceBadge source={r.source} />
                    </td>
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
      )}
    </div>
  );
}

/**
 * Unified Residual Book table — shown only when CSV is imported.
 *
 * Rows: every customer in the carrier book (full 187, not just the 34
 * tracked as PRIM leads). Each row carries a "Tracked in PRIM" flag
 * derived from a name match against the leads array. When matched, the
 * action buttons (Pause/Resume/Cancel/Edit) appear; otherwise they're
 * hidden because there's no lead object to act on.
 *
 * Filter dropdown lets the agent narrow to: All / Tracked in PRIM /
 * Not tracked yet — handy for spotting which CSV customers should be
 * created as leads in PRIM.
 */
function ResidualBookTable({ fullBook, leads, onEdit, onPause, onResume, onCancel }) {
  const [filter, setFilter] = useState('all'); // 'all' | 'tracked' | 'untracked'
  const [search, setSearch] = useState('');

  // Build a name → lead map for "Tracked in PRIM" detection. Keyed
  // identically to how the residual matcher normalizes names.
  const leadByName = useMemo(() => {
    const m = new Map();
    for (const l of leads) {
      const k = normalizeNameKeyForRow(l.name);
      if (k && !m.has(k)) m.set(k, l);
    }
    return m;
  }, [leads]);

  const enriched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fullBook
      .map(p => {
        const lead = leadByName.get(normalizeNameKeyForRow(p.customer)) || null;
        return { ...p, lead };
      })
      .filter(p => {
        if (filter === 'tracked' && !p.lead) return false;
        if (filter === 'untracked' && p.lead) return false;
        if (q && !p.customer.toLowerCase().includes(q) && !(p.planId || '').toLowerCase().includes(q)) return false;
        return true;
      });
  }, [fullBook, leadByName, filter, search]);

  const totalMonthly = enriched.reduce((s, p) => s + (p.currentMonthly || 0), 0);
  const totalPaidAll = enriched.reduce((s, p) => s + (p.totalPaid || 0), 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Full Residual Book</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Every active subscriber from your CommissionDetail — including customers not tracked as leads in PRIM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or plan…"
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-40"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All ({fullBook.length})</option>
            <option value="tracked">Tracked in PRIM</option>
            <option value="untracked">Not tracked yet</option>
          </select>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left p-2">Customer</th>
              <th className="text-left p-2">Plan / Product</th>
              <th className="text-left p-2">Sign-up</th>
              <th className="text-right p-2">Months in book</th>
              <th className="text-right p-2">Monthly</th>
              <th className="text-right p-2">Total paid</th>
              <th className="text-center p-2">Status</th>
              <th className="text-right p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map(p => (
              <tr key={p.policyId} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2 font-medium text-slate-900">{p.customer || '—'}</td>
                <td className="p-2">
                  {p.planId
                    ? <span className={`tier-text ${tierClass(p.planId)} text-xs`}>{p.planId}</span>
                    : <span className="text-xs text-slate-400" title={p.productLabel}>{p.productLabel || 'unknown'}</span>}
                </td>
                <td className="p-2">{usDate(p.effectiveDate)}</td>
                <td className="text-right p-2">{p.monthsInBook}</td>
                <td className="text-right p-2 text-emerald-700 font-medium">{p.active ? fmt2(p.currentMonthly) : <span className="text-slate-400">—</span>}</td>
                <td className="text-right p-2">{fmt2(p.totalPaid)}</td>
                <td className="text-center p-2">
                  {p.lead
                    ? <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">In PRIM</span>
                    : <span className="inline-block px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">Not tracked</span>}
                </td>
                <td className="text-right p-2">
                  {p.lead ? (
                    <div className="flex justify-end gap-1">
                      {p.lead.associationStatus === 'active' && (
                        <button onClick={() => onPause(p.lead.id)} title="Pause" className="text-amber-600 hover:bg-amber-50 p-1 rounded"><Pause size={14} /></button>
                      )}
                      {p.lead.associationStatus === 'paused' && (
                        <button onClick={() => onResume(p.lead.id)} title="Resume" className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Play size={14} /></button>
                      )}
                      {p.lead.associationStatus !== 'cancelled' && (
                        <button onClick={() => onCancel(p.lead.id)} title="Cancel" className="text-red-600 hover:bg-red-50 p-1 rounded"><Ban size={14} /></button>
                      )}
                      <button onClick={() => onEdit(p.lead)} title="Edit" className="text-slate-500 hover:bg-slate-100 p-1 rounded"><Edit2 size={14} /></button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {enriched.length === 0 && (
              <tr><td colSpan="8" className="text-center p-8 text-slate-400">No customers match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center justify-between">
        <span>{enriched.length} of {fullBook.length} customer{fullBook.length !== 1 ? 's' : ''}</span>
        <span>
          Monthly: <span className="font-semibold text-slate-900">{fmt2(totalMonthly)}</span> ·
          Total paid: <span className="font-semibold text-slate-900">{fmt2(totalPaidAll)}</span>
        </span>
      </div>
    </div>
  );
}

// Inline name-key helper used by the residual book table — duplicated from
// associationResiduals to avoid an import cycle in the React module graph.
function normalizeNameKeyForRow(name) {
  if (!name || typeof name !== 'string') return null;
  let s = name.toLowerCase().trim();
  s = s.replace(/['’`.,]/g, '');
  s = s.replace(/[-_/]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/\s+(jr|sr|ii|iii|iv|2nd|3rd|4th)$/i, '').trim();
  if (!s) return null;
  const parts = s.split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Top-of-page panel that surfaces the agent's residual book health and
 * gives one-click access to upload a fresh CommissionDetail.csv.
 *
 * Two modes:
 *  - Empty state: "Upload your CommissionDetail.csv to unlock accurate
 *    per-tier rates" + a single CTA.
 *  - Loaded state: shows active subscribers, monthly run-rate, YTD net,
 *    derived rate badges per tier — plus a "Re-import / extend history"
 *    button so the user can keep adding monthly files.
 */
function CommissionDetailPanel({
  abDetail,
  agentRates,
  carrierBook,
  carrierYtd,
  carrierTotal,
  carrierYtdEst,
  hasFullYtd,
  hasAgentRates,
  matchStats,
  onOpenImport,
  onClearResidualBook,
}) {
  const hasData = abDetail && abDetail.length > 0;

  if (!hasData) {
    return (
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-white shadow flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-indigo-600" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">Upload your CommissionDetail.csv to unlock accurate residuals</div>
            <p className="text-sm text-slate-600 mt-0.5">
              The projections below use the baseline contract rate. Upload your USHA CommissionDetail
              export to derive your <em>actual</em> per-tier rate (Executive Diamond, Diamond, etc.) and
              see your full residual book history.
            </p>
          </div>
        </div>
        <button
          onClick={onOpenImport}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2 flex-shrink-0"
        >
          <Upload size={14} /> Upload CSV
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-900">Residual book (from CommissionDetail)</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {onClearResidualBook && abDetail && abDetail.length > 0 && (
            <button
              onClick={() => {
                if (confirm(`Clear all ${abDetail.length} residual rows and derived rates? You'll need to re-upload your CommissionDetail.csv. Leads, advances, and Books are NOT affected.`)) {
                  onClearResidualBook();
                }
              }}
              className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
              title="Reset the residual book — useful if duplicates accumulated from multiple imports"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
          <button
            onClick={onOpenImport}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          >
            <Upload size={12} /> Add another month
          </button>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 mb-3">
        Imported {abDetail.length.toLocaleString()} rows · {periodsCovered(abDetail)} · all-time net <span className="font-semibold text-slate-700">{fmt2(carrierTotal)}</span>
      </div>

      {hasAgentRates && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-indigo-900 mb-1.5">Your contract rates (derived from your latest data)</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-xs">
            {Object.entries(agentRates)
              .sort(([, a], [, b]) => (b.currentRate || 0) - (a.currentRate || 0))
              .map(([planId, info]) => (
                <div key={planId} className="flex items-center justify-between border-b border-indigo-100 pb-1 last:border-0">
                  <span className="text-indigo-900 font-medium">{planId}</span>
                  <span className="font-mono text-emerald-700 font-semibold">{fmt2(info.currentRate)}/mo</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Reconciliation strip — what % of PRIM clients lined up with the CSV.
          Helps agents spot their data quality (typos, missing leads, churned
          customers still marked Active) at a glance. */}
      {matchStats && matchStats.total > 0 && (
        <div className="mt-3 flex items-center gap-3 text-xs flex-wrap">
          <span className="text-slate-500 font-semibold">Reconciliation:</span>
          <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-1 rounded">
            <span className="font-bold">{matchStats.exact}</span> exact match
            <span className="text-emerald-600">({matchStats.total > 0 ? Math.round(matchStats.exact / matchStats.total * 100) : 0}%)</span>
          </span>
          {matchStats.unmatched > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-700 px-2 py-1 rounded" title="In your tracker but not found in the imported CommissionDetail. Either: (1) you haven't imported the period that covers them, (2) they churned, or (3) the lead's name doesn't match the carrier's spelling.">
              <span className="font-bold">{matchStats.unmatched}</span> projected
            </span>
          )}
          {matchStats.ambiguous > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 rounded" title="Same name appears multiple times in your residual book. Auto-match would risk pulling the wrong rate, so we fall back to projection.">
              <span className="font-bold">{matchStats.ambiguous}</span> ambiguous
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tiny source-of-truth badge shown next to each per-client monthly rate.
 * Tells the user at a glance whether the dollar figure is exact (pulled
 * from their CommissionDetail upload) or estimated (projection from the
 * agent's contract rate or USHA baseline).
 */
function ResidualSourceBadge({ source }) {
  if (source === 'exact') {
    return (
      <span className="ml-1 text-[9px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1 rounded" title="Pulled directly from your CommissionDetail upload — exact rate this customer pays you">
        EXACT
      </span>
    );
  }
  if (source === 'agent') {
    return (
      <span className="ml-1 text-[9px] uppercase tracking-wide bg-indigo-100 text-indigo-700 px-1 rounded" title="Estimated from your current contract rate. Upload a CommissionDetail with this customer in it to see their exact rate.">
        PROJECTED
      </span>
    );
  }
  if (source === 'ambiguous') {
    return (
      <span className="ml-1 text-[9px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1 rounded" title="Multiple customers with this name in your residual book — couldn't auto-resolve. Showing projection instead.">
        AMBIGUOUS
      </span>
    );
  }
  // baseline / unknown
  return (
    <span className="ml-1 text-[9px] uppercase tracking-wide bg-slate-100 text-slate-600 px-1 rounded" title="USHA baseline contract rate. Upload your CommissionDetail to enable agent-tier-aware rates.">
      BASELINE
    </span>
  );
}

// "Apr-26" or "Jan–Apr 2026" depending on whether one or many periods imported.
function periodsCovered(rows) {
  if (!rows || rows.length === 0) return '';
  const periods = [...new Set(rows.map(r => r.period).filter(Boolean))].sort();
  if (periods.length === 0) return '';
  if (periods.length === 1) return periods[0];
  return `${periods[0]} → ${periods[periods.length - 1]}`;
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-slate-900 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default memo(AssociationsView);
