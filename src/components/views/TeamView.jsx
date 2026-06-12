'use client';
/**
 * TeamView — the "View My Team" tab (Team tier).
 *
 * Three layers (spec §4):
 *  ① Team Scoreboard — KPI strip, leaderboard, pipeline funnel,
 *    accountability, financial health — aggregated over the leader's
 *    ACTIVE downline subtree (scope toggle: whole downline vs direct).
 *  ② Drill-down — read-only mirror of any downline member's PRIM
 *    (existing views with readOnly), hierarchy-aware with breadcrumbs.
 *  ③ Roster — one-step invite by email, pending/active status, remove.
 *
 * All data arrives via the authorized /api/team/* endpoints (every read is
 * audit-logged server-side). This component never touches another user's
 * data except through those endpoints, and never mutates it at all.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, UserPlus, Crown, TrendingUp, DollarSign, Target, Percent,
  ChevronRight, Eye, AlertTriangle, Clock, X, RefreshCw, Trophy,
  LayoutDashboard, BookOpen, Columns, Calculator, ArrowLeft, Send,
} from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { resolvePeriod } from '@/lib/reports.mjs';
import { buildTeamScoreboard, buildBranchRows } from '@/lib/teamMath.mjs';
import { fmt, fmt2 } from '@/lib/utils';
import { CountUp, Stagger, StaggerItem, TiltCard } from '../motion/MotionPrimitives';
import Dashboard from './Dashboard';
import ProspectsView from './ProspectsView';
import LeadsView from './LeadsView';
import BusinessBooksView from './BusinessBooksView';
import PlatformExpensesView from './PlatformExpensesView';
import CpaDashboard from './CpaDashboard';
import { defaultProspectSettings } from '@/lib/prospects';

const PRESETS = [
  { id: 'thisMonth',   label: 'This Month' },
  { id: 'lastMonth',   label: 'Last Month' },
  { id: 'thisQuarter', label: 'This Quarter' },
  { id: 'ytd',         label: 'YTD' },
];

const LEADERBOARD_SORTS = [
  { id: 'advance',     label: 'Production $' },
  { id: 'dealsIssued', label: 'Deals' },
  { id: 'closeRate',   label: 'Close rate' },
  { id: 'touchesInPeriod', label: 'Activity' },
];

const noop = () => {};

async function getBearer() {
  if (!supabaseConfigured()) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  } catch { return null; }
}

async function teamFetch(url, options = {}) {
  const token = await getBearer();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

const money = (v) => (v === null || v === undefined ? '—' : fmt2(v));
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

// ---------- KPI tile ----------
function Kpi({ label, value, format, Icon, grad }) {
  const isNull = value === null || value === undefined;
  return (
    <TiltCard className="premium-card p-3 shine-on-hover glow-ring cursor-default">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center text-white mb-2 shadow-md`}>
        <Icon size={16} />
      </div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl kpi-num text-slate-900">
        {isNull ? '—' : <CountUp value={value} {...(format ? { format } : {})} />}
      </div>
    </TiltCard>
  );
}

// ---------- Roster panel ----------
function RosterPanel({ roster, onInvite, onRemove, inviting }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    const result = await onInvite(email.trim());
    if (result?.error) setMsg(result.error);
    else {
      setMsg(result?.already ? `Already ${result.already === 'active' ? 'on your team' : 'invited'}` : 'Invite sent — they\'ll see it in PRIM');
      setEmail('');
    }
  };

  return (
    <div className="premium-card p-4">
      <h3 className="font-semibold text-slate-900 mb-1 flex items-center">
        <span className="section-accent" />Your roster
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Invite your direct reports by email. They must accept before you can see anything.
      </p>
      <form onSubmit={submit} className="flex gap-2 flex-wrap mb-2">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="agent@email.com"
          className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={inviting}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
        >
          {inviting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />} Invite
        </button>
      </form>
      {msg && <div className="text-xs text-indigo-600 font-medium mb-2">{msg}</div>}

      {roster.length > 0 && (
        <div className="divide-y divide-slate-100">
          {roster.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-400 truncate">{r.email}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  r.status === 'active' ? 'bg-emerald-100 text-emerald-700'
                  : r.status === 'pending' ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-500'
                }`}>
                  {r.status}
                </span>
                <button
                  onClick={() => onRemove(r)}
                  className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                  title={r.status === 'pending' ? 'Cancel invite' : 'Remove from team'}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Funnel bars ----------
function FunnelBars({ funnel }) {
  const rows = funnel.filter(f => f.count > 0);
  const max = Math.max(1, ...rows.map(f => f.count));
  if (rows.length === 0) {
    return <div className="text-sm text-slate-400 italic py-4 text-center">No active prospects on the team yet.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map(f => (
        <div key={f.id} className="flex items-center gap-2">
          <div className="w-36 text-xs font-semibold text-slate-600 truncate text-right">{f.label}</div>
          <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
            <div
              className="h-full rounded-md transition-all"
              style={{ width: `${(f.count / max) * 100}%`, background: f.color, minWidth: 6 }}
            />
          </div>
          <div className="w-8 text-sm kpi-num text-slate-900 text-right">{f.count}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Member drill-down (read-only mirror) ----------
const MIRROR_TABS = [
  { id: 'overview',  label: 'Overview',        icon: LayoutDashboard },
  { id: 'prospects', label: 'Prospects',       icon: UserPlus },
  { id: 'leads',     label: 'Book of Business', icon: Users },
  { id: 'books',     label: 'Books',           icon: BookOpen },
  { id: 'platforms', label: 'Platforms',       icon: DollarSign },
  { id: 'cpa',       label: 'CPA',             icon: Calculator },
];

function MemberMirror({ data, onDrill }) {
  const [tab, setTab] = useState('overview');
  const b = data.bundle || {};
  const leads = Array.isArray(b.leads) ? b.leads : [];
  const prospects = Array.isArray(b.prospects) ? b.prospects : [];
  const businessExpenses = Array.isArray(b.businessExpenses) ? b.businessExpenses : [];
  const businessIncome = Array.isArray(b.businessIncome) ? b.businessIncome : [];
  const platformExpenses = Array.isArray(b.platformExpenses) ? b.platformExpenses : [];
  const overrides = Array.isArray(b.overrides) ? b.overrides : [];
  const chargebacks = Array.isArray(b.chargebacks) ? b.chargebacks : [];
  const ownAdvances = Array.isArray(b.ownAdvances) ? b.ownAdvances : [];
  const abDetail = Array.isArray(b.abDetail) ? b.abDetail : [];
  const activities = Array.isArray(b.activities) ? b.activities : [];
  const prospectSettings = b.prospectSettings || defaultProspectSettings();

  // Platforms analytics view derives from Books platform-category expenses,
  // mirroring LeadTracker's platformExpensesAsView (legacy store + PLATFORM_*
  // business expenses normalized to {date, amount, platform}).
  const platformsAsView = useMemo(() => {
    const fromBooks = businessExpenses
      .filter(e => String(e?.category || '').startsWith('PLATFORM_'))
      .map(e => ({ ...e, platform: String(e.category).replace('PLATFORM_', '') }));
    return [...platformExpenses, ...fromBooks];
  }, [businessExpenses, platformExpenses]);

  return (
    <div className="space-y-4">
      {/* Mirror sub-nav */}
      <div className="premium-card p-2 flex gap-1 flex-wrap">
        {MIRROR_TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* This member's own team (sub-leaders) — keep drilling down */}
      {data.reports?.length > 0 && (
        <div className="premium-card p-4">
          <h3 className="font-semibold text-slate-900 mb-2 flex items-center">
            <span className="section-accent" />{data.name}&apos;s team ({data.reports.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.reports.map(r => (
              <button
                key={r.userId}
                onClick={() => onDrill(r)}
                className="border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5"
              >
                {r.hasReports ? <Crown size={13} className="text-indigo-500" /> : <Users size={13} className="text-slate-400" />}
                {r.name}
                <ChevronRight size={13} className="text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <Dashboard leads={leads} prospects={prospects} readOnly onOpenProspects={() => setTab('prospects')} />
      )}
      {tab === 'prospects' && (
        <ProspectsView
          prospects={prospects}
          settings={prospectSettings}
          readOnly
          onAdd={noop} onUpdate={noop} onDelete={noop} onBulkAdd={noop}
          onSaveSettings={noop} onConvertToLead={noop} onLogTouch={noop}
          onSnoozeProspect={noop} onApplyStageSuggestion={noop} onResolveReminder={noop}
        />
      )}
      {tab === 'leads' && (
        <LeadsView leads={leads} readOnly onNew={noop} onEdit={noop} onDelete={noop} onBulkDelete={noop} onBulkStage={noop} onNavigate={noop} />
      )}
      {tab === 'books' && (
        <BusinessBooksView
          expenses={businessExpenses} income={businessIncome} platformExpenses={platformExpenses}
          leads={leads} overrides={overrides} ownAdvances={ownAdvances} abDetail={abDetail}
          readOnly
          onAddExpense={noop} onUpdateExpense={noop} onDeleteExpense={noop} onBulkAddExpenses={noop}
          onAddIncome={noop} onUpdateIncome={noop} onDeleteIncome={noop} onBulkAddIncome={noop}
          onBulkAddPlatforms={noop}
        />
      )}
      {tab === 'platforms' && (
        <PlatformExpensesView expenses={platformsAsView} onJumpToBooks={() => setTab('books')} />
      )}
      {tab === 'cpa' && (
        <CpaDashboard
          leads={leads} investments={[]} activities={activities}
          platformExpenses={platformExpenses} businessExpenses={businessExpenses}
          businessIncome={businessIncome} chargebacks={chargebacks}
          overrides={overrides} ownAdvances={ownAdvances} prospects={prospects}
          readOnly
          onOpenProspects={() => setTab('prospects')}
          onDeleteChargeback={noop} onEditInvestment={noop} onDeleteInvestment={noop}
          onDeleteAutoWeek={noop} onNewInvestment={noop} onNewActivity={noop}
          onEditActivity={noop} onDeleteActivity={noop}
          onMarkPaymentTaken={noop} onPaymentHeadsUpSent={noop}
        />
      )}
    </div>
  );
}

// ---------- Main view ----------
export default function TeamView({ showToast = () => {} }) {
  const [roster, setRoster] = useState([]);
  const [members, setMembers] = useState([]);
  const [links, setLinks] = useState([]);       // active org edges within my subtree
  const [leaderId, setLeaderId] = useState(null); // me — root of the tree
  // Leaderboard list mode. 'tree' (default): one row per DIRECT report with
  // whole-branch totals (Juan's Alexis→Gustavo→Denzel logic — an FTA's row
  // includes their agents). 'flat': every individual in the org, ranked.
  // The KPI strip is ALWAYS the whole organization regardless of this mode.
  const [listMode, setListMode] = useState('tree');
  const [presetId, setPresetId] = useState('thisMonth');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [sortBy, setSortBy] = useState('advance');

  // Drill-down: stack of { userId, name } + cache of fetched member payloads
  const [drillStack, setDrillStack] = useState([]);
  const [drillData, setDrillData] = useState(() => new Map());
  const [drillLoading, setDrillLoading] = useState(false);

  const period = useMemo(() => resolvePeriod(presetId, new Date()), [presetId]);

  const loadRoster = useCallback(async () => {
    try {
      const { roster: r } = await teamFetch('/api/team/roster');
      setRoster(r || []);
    } catch (e) { setError(e.message); }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Always the whole downline: the KPI strip is org-wide, and the tree
      // list groups it client-side — no refetch when switching list modes.
      const res = await teamFetch('/api/team/overview?scope=all');
      setMembers(res.members || []);
      setLinks(res.links || []);
      setLeaderId(res.leaderId || null);
    } catch (e) {
      setError(e.message);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoster(); }, [loadRoster]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  const scoreboard = useMemo(
    () => buildTeamScoreboard(members, period),
    [members, period],
  );

  const sortedLeaderboard = useMemo(() => {
    // tree mode: one row per direct report, whole-branch totals.
    // flat mode: every individual in the org.
    const rows = listMode === 'tree' && leaderId
      ? buildBranchRows(members, links, leaderId, period)
      : [...scoreboard.leaderboard];
    rows.sort((a, b) => (Number(b[sortBy]) || 0) - (Number(a[sortBy]) || 0));
    return rows;
  }, [listMode, leaderId, members, links, period, scoreboard.leaderboard, sortBy]);

  const handleInvite = async (email) => {
    setInviting(true);
    try {
      const res = await teamFetch('/api/team/invite', { method: 'POST', body: JSON.stringify({ email }) });
      await loadRoster();
      return res;
    } catch (e) {
      return { error: e.message };
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (r) => {
    const verb = r.status === 'pending' ? 'Cancel the invite to' : 'Remove';
    if (!confirm(`${verb} ${r.name}? ${r.status === 'active' ? 'You will immediately lose access to their data.' : ''}`)) return;
    try {
      await teamFetch('/api/team/remove', { method: 'POST', body: JSON.stringify({ memberId: r.id }) });
      showToast(`${r.status === 'pending' ? 'Invite canceled' : 'Removed from team'}`);
      // Drop ALL cached drill bundles + close any open drill-down: access was
      // just revoked, so no stale member data may remain reachable in memory.
      setDrillStack([]);
      setDrillData(new Map());
      await loadRoster();
      await loadOverview();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const drillInto = async (target) => {
    setDrillLoading(true);
    try {
      let data = drillData.get(target.userId);
      if (!data) {
        data = await teamFetch(`/api/team/agent/${target.userId}`);
        setDrillData(prev => new Map(prev).set(target.userId, data));
      }
      setDrillStack(prev => [...prev, { userId: target.userId, name: data.name || target.name }]);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDrillLoading(false);
    }
  };

  const current = drillStack.length ? drillData.get(drillStack[drillStack.length - 1].userId) : null;
  const activeCount = roster.filter(r => r.status === 'active').length;

  // ---------- Drill-down mode ----------
  if (current) {
    return (
      <div className="space-y-4">
        {/* Breadcrumb + read-only banner */}
        <div className="premium-card p-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm flex-wrap">
            <button
              onClick={() => setDrillStack([])}
              className="font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              <ArrowLeft size={14} /> My Team
            </button>
            {drillStack.map((d, i) => (
              <span key={d.userId} className="flex items-center gap-1.5">
                <ChevronRight size={13} className="text-slate-400" />
                {i < drillStack.length - 1 ? (
                  <button
                    onClick={() => setDrillStack(prev => prev.slice(0, i + 1))}
                    className="font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    {d.name}
                  </button>
                ) : (
                  <span className="font-bold text-slate-900">{d.name}</span>
                )}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
            <Eye size={12} /> Viewing {drillStack[drillStack.length - 1].name} — read only
          </div>
        </div>
        <MemberMirror data={current} onDrill={drillInto} />
      </div>
    );
  }

  // ---------- Scoreboard mode ----------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center">
            <span className="section-accent" />View My Team
          </h1>
          <p className="text-sm text-slate-500">
            {members.length} member{members.length !== 1 ? 's' : ''} across your organization · {period.label} · every view is access-logged
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Period presets */}
          <div className="flex flex-wrap bg-slate-100 rounded-lg p-1 gap-1 text-sm">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPresetId(p.id)}
                className={`px-3 py-1.5 font-semibold rounded-md transition ${
                  presetId === p.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800 flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="premium-card p-3 space-y-2">
              <div className="skeleton w-8 h-8 rounded-lg" />
              <div className="skeleton h-3 w-14 rounded" />
              <div className="skeleton h-5 w-16 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state — brand-new leader */}
      {!loading && members.length === 0 && !error && (
        <div className="premium-card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white mx-auto mb-3 shadow-lg shadow-indigo-500/30">
            <Users size={26} />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Build your team</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Invite your first agent below. Once they accept, their production, pipeline,
            and financials roll up here — and you can open their PRIM read-only.
          </p>
        </div>
      )}

      {/* ① KPI strip */}
      {!loading && members.length > 0 && (
        <>
          <Stagger className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <StaggerItem><Kpi label="Members" value={scoreboard.kpis.members} grad="from-indigo-500 to-blue-500" Icon={Users} /></StaggerItem>
            <StaggerItem><Kpi label="Deals Issued" value={scoreboard.kpis.dealsIssued} grad="from-emerald-500 to-green-500" Icon={Trophy} /></StaggerItem>
            <StaggerItem><Kpi label="Premium /mo" value={scoreboard.kpis.premium} format={fmt} grad="from-violet-500 to-purple-500" Icon={DollarSign} /></StaggerItem>
            <StaggerItem><Kpi label="Team AV" value={scoreboard.kpis.av} format={fmt} grad="from-fuchsia-500 to-pink-500" Icon={TrendingUp} /></StaggerItem>
            <StaggerItem><Kpi label="Advance" value={scoreboard.kpis.advance} format={fmt} grad="from-emerald-500 to-teal-500" Icon={DollarSign} /></StaggerItem>
            <StaggerItem><Kpi label="Avg CPA" value={scoreboard.kpis.cpa} format={fmt2} grad="from-amber-500 to-orange-500" Icon={Target} /></StaggerItem>
            <StaggerItem><Kpi label="Blended ROI" value={scoreboard.kpis.roi} format={(v) => v.toFixed(1) + 'x'} grad="from-sky-500 to-cyan-500" Icon={TrendingUp} /></StaggerItem>
            <StaggerItem><Kpi label="Close Rate" value={scoreboard.kpis.closeRate} format={(v) => v.toFixed(0) + '%'} grad="from-teal-500 to-emerald-500" Icon={Percent} /></StaggerItem>
          </Stagger>

          {/* ① Leaderboard */}
          <div className="premium-card overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2 flex-wrap">
              <h3 className="font-semibold text-slate-900 flex items-center">
                <span className="section-accent" />{listMode === 'tree' ? 'Your team' : 'Everyone in your organization'}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Tree (default): one row per direct report, whole-branch
                    totals. Flat: every individual, org-wide ranking. */}
                <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 text-xs">
                  <button onClick={() => setListMode('tree')}
                    className={`px-2.5 py-1 font-semibold rounded transition ${listMode === 'tree' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                    By team
                  </button>
                  <button onClick={() => setListMode('flat')}
                    className={`px-2.5 py-1 font-semibold rounded transition ${listMode === 'flat' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                    Everyone
                  </button>
                </div>
                <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 text-xs">
                  {LEADERBOARD_SORTS.map(s => (
                    <button key={s.id} onClick={() => setSortBy(s.id)}
                      className={`px-2.5 py-1 font-semibold rounded transition ${sortBy === s.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm premium-table" style={{ minWidth: 760 }}>
                <thead className="bg-slate-50 text-slate-600 text-xs">
                  <tr>
                    <th className="text-left p-2 pl-4">#</th>
                    <th className="text-left p-2">Member</th>
                    <th className="text-right p-2">Deals</th>
                    <th className="text-right p-2">Premium</th>
                    <th className="text-right p-2">AV</th>
                    <th className="text-right p-2">Advance</th>
                    <th className="text-right p-2">CPA</th>
                    <th className="text-right p-2">ROI</th>
                    <th className="text-right p-2">Close</th>
                    <th className="text-right p-2 pr-4">Touches</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.map((r, i) => (
                    <tr key={r.userId} onClick={() => drillInto(r)}
                        className="cursor-pointer" title={`Open ${r.name} (read-only)`}>
                      <td className="p-2 pl-4 font-bold text-slate-400">
                        {i === 0 ? <Crown size={15} className="text-amber-500" /> : i + 1}
                      </td>
                      <td className="p-2 font-semibold text-slate-900">
                        <span className="flex items-center gap-1.5">
                          {r.name}
                          {r.teamSize > 1 && (
                            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              title={`This branch includes ${r.teamSize - 1} ${r.teamSize - 1 === 1 ? 'person' : 'people'} under ${r.name} — numbers are the whole branch combined`}>
                              +{r.teamSize - 1} team
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="p-2 text-right kpi-num">{r.dealsIssued}</td>
                      <td className="p-2 text-right kpi-num">{fmt(r.premium)}</td>
                      <td className="p-2 text-right kpi-num text-indigo-700">{fmt(r.av)}</td>
                      <td className="p-2 text-right kpi-num text-emerald-700 font-semibold">{fmt(r.advance)}</td>
                      <td className="p-2 text-right kpi-num">{money(r.cpa)}</td>
                      <td className="p-2 text-right kpi-num">{r.roi === null ? '—' : r.roi.toFixed(1) + 'x'}</td>
                      <td className="p-2 text-right kpi-num">{pct(r.closeRate)}</td>
                      <td className="p-2 pr-4 text-right kpi-num">{r.touchesInPeriod}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ① Funnel + Accountability side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="premium-card p-4">
              <h3 className="font-semibold text-slate-900 mb-3 flex items-center">
                <span className="section-accent" />Team pipeline
              </h3>
              <FunnelBars funnel={scoreboard.funnel} />
            </div>
            <div className="premium-card p-4">
              <h3 className="font-semibold text-slate-900 mb-3 flex items-center">
                <span className="section-accent" />Accountability
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm premium-table" style={{ minWidth: 420 }}>
                  <thead className="bg-slate-50 text-slate-600 text-xs">
                    <tr>
                      <th className="text-left p-2">Member</th>
                      <th className="text-right p-2">On-time</th>
                      <th className="text-right p-2">Overdue</th>
                      <th className="text-right p-2">Touches</th>
                      <th className="text-right p-2">Appts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreboard.accountability.map(a => (
                      <tr key={a.userId}>
                        <td className="p-2 font-medium text-slate-900">{a.name}</td>
                        <td className={`p-2 text-right kpi-num ${a.onTimePct !== null && a.onTimePct < 60 ? 'text-rose-600 font-semibold' : ''}`}>{pct(a.onTimePct)}</td>
                        <td className={`p-2 text-right kpi-num ${a.overdueCount > 0 ? 'text-rose-600 font-semibold' : ''}`}>{a.overdueCount}</td>
                        <td className="p-2 text-right kpi-num">{a.touchesInPeriod}</td>
                        <td className="p-2 text-right kpi-num">{a.apptsUpcoming}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ① Financial health */}
          <div className="premium-card p-4">
            <h3 className="font-semibold text-slate-900 mb-1 flex items-center">
              <span className="section-accent" />Financial health
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Lead spend vs production across the team — spot bad buying decisions early.
            </p>
            <div className="flex gap-2 text-sm flex-wrap mb-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-slate-500">Lead spend: </span>
                <span className="font-bold text-red-600 kpi-num">{fmt2(scoreboard.financial.teamLeadSpend)}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-slate-500">Advance: </span>
                <span className="font-bold text-emerald-700 kpi-num">{fmt2(scoreboard.financial.teamAdvance)}</span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-slate-500">Profit: </span>
                <span className={`font-bold kpi-num ${scoreboard.financial.teamProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {fmt2(scoreboard.financial.teamProfit)}
                </span>
              </div>
            </div>
            {scoreboard.financial.flags.length > 0 ? (
              <div className="space-y-1.5">
                {scoreboard.financial.flags.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-rose-50/60 border border-rose-200 rounded-lg px-3 py-1.5">
                    <AlertTriangle size={14} className="text-rose-500 flex-shrink-0" />
                    <span className="font-semibold text-slate-900">{f.name}</span>
                    <span className="text-rose-700">{f.flag}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-emerald-700 font-medium">✓ No financial flags this period.</div>
            )}
          </div>
        </>
      )}

      {drillLoading && (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> Opening member…
        </div>
      )}

      {/* ③ Roster */}
      <RosterPanel roster={roster} onInvite={handleInvite} onRemove={handleRemove} inviting={inviting} />
    </div>
  );
}
