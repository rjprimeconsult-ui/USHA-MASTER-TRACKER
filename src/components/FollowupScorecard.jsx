'use client';
/**
 * Follow-up performance scorecard. Collapsible panel (matches the top-of-page
 * widget pattern). Read-only analytics from computeFollowupStats.
 * Props: { prospects, stages } — stages = configured stage list (id + label).
 */
import { useMemo, useState } from 'react';
import { BarChart3, ChevronRight, ChevronDown, Target, PhoneCall, CalendarCheck, AlertTriangle } from 'lucide-react';
import { computeFollowupStats } from '@/lib/followupStats.mjs';

const pct = (v) => v == null ? '—' : `${Math.round(v * 100)}%`;
const num1 = (v) => v == null ? '—' : (Math.round(v * 10) / 10).toString();

export default function FollowupScorecard({ prospects = [], stages = [], defaultCollapsed = true }) {
  const stats = useMemo(() => computeFollowupStats(prospects, new Date().toISOString()), [prospects]);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (stats.totalTouches === 0 && stats.activeCount === 0) return null;

  const labelFor = (id) => stages.find(s => s.id === id)?.label || id;
  const showRows = !collapsed;

  const onTimeColor = stats.onTimeRate == null ? 'text-slate-400'
    : stats.onTimeRate >= 0.8 ? 'text-emerald-600'
    : stats.onTimeRate >= 0.5 ? 'text-amber-600' : 'text-rose-600';

  const outcomeEntries = Object.entries(stats.byOutcome).sort((a, b) => b[1] - a[1]);
  const outcomeMax = Math.max(1, ...outcomeEntries.map(([, n]) => n));

  return (
    <div className="premium-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition text-left"
        aria-expanded={showRows}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white flex-shrink-0">
            <BarChart3 size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 leading-tight truncate">Follow-up performance</div>
            <div className="text-[11px] text-slate-500 leading-tight truncate">
              {pct(stats.onTimeRate)} on-time · {pct(stats.connectRate)} connect · {stats.totalTouches} touches
            </div>
          </div>
        </div>
        {showRows ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>

      {showRows && (
        <div className="border-t border-slate-100 p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi Icon={Target} label="On-time follow-up" value={pct(stats.onTimeRate)} valueClass={onTimeColor} sub={`${stats.overdueCount} overdue / ${stats.activeCount} active`} />
            <Kpi Icon={PhoneCall} label="Connect rate" value={pct(stats.connectRate)} sub={`${stats.connects} of ${stats.totalTouches} touches`} />
            <Kpi Icon={CalendarCheck} label="Touches to appt" value={num1(stats.avgTouchesToAppt)} sub="avg before booking" />
            <Kpi Icon={BarChart3} label="Total touches" value={String(stats.totalTouches)} sub="all-time logged" />
          </div>

          {outcomeEntries.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Outcomes</div>
              <div className="space-y-1.5">
                {outcomeEntries.map(([outcome, n]) => (
                  <div key={outcome} className="flex items-center gap-2">
                    <div className="w-28 text-xs text-slate-600 flex-shrink-0">{outcome}</div>
                    <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded" style={{ width: `${(n / outcomeMax) * 100}%` }} />
                    </div>
                    <div className="w-8 text-right text-xs font-semibold text-slate-700">{n}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.byStage.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">By stage</div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left p-2 font-semibold">Stage</th>
                      <th className="text-right p-2 font-semibold">Prospects</th>
                      <th className="text-right p-2 font-semibold">Overdue</th>
                      <th className="text-right p-2 font-semibold">Touches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byStage.map(row => (
                      <tr key={row.stage} className="border-t border-slate-100">
                        <td className="p-2 font-medium text-slate-800">{labelFor(row.stage)}</td>
                        <td className="p-2 text-right text-slate-700">{row.count}</td>
                        <td className={`p-2 text-right font-semibold ${row.overdue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                          {row.overdue > 0 ? <span className="inline-flex items-center gap-1"><AlertTriangle size={11} />{row.overdue}</span> : '0'}
                        </td>
                        <td className="p-2 text-right text-slate-700">{row.touches}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ Icon, label, value, valueClass = 'text-slate-900', sub }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1">
        <Icon size={12} /> {label}
      </div>
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
