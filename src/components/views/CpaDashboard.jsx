'use client';
import { useMemo, useState, memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from 'recharts';
import { DollarSign, TrendingUp, Percent, Target, Package, Plus, Edit2, Trash2, Phone, Calendar, Presentation, Trophy, Info, Sparkles, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { fmt, fmt2, getWeekStart, weekAgo, weekLabel, weekRangeLabel, usDate } from '@/lib/utils';
import {
  productPremium,
  UNDERWRITTEN_PRODUCTS,
  GI_PRODUCTS,
  TRUE_CPA_BOOK_CATEGORIES,
  PLATFORM_EXPENSE_CATEGORIES,
  CATEGORY_TO_PLATFORM_ID,
} from '@/lib/constants';
import TakenRateCalculator from '../TakenRateCalculator';
import ChargebacksPanel from '../ChargebacksPanel';
import { TiltCard, CountUp, FadeIn, Stagger, StaggerItem, Chart3DCard, fireConfetti } from '../motion/MotionPrimitives';
import { useChartColors } from '@/lib/useIsDark';
import { mergeFunnelTotals } from '@/lib/followupRollup.mjs';
import { computeFollowupStats } from '@/lib/followupStats.mjs';
import OutreachRemindersWidget from '../OutreachRemindersWidget';
import PaymentAlertsWidget from '../PaymentAlertsWidget';

const Kpi = memo(({ label, value, numeric, isCurrency = true, isPercent = false, sub, grad, Icon, onClick, active }) => (
  <TiltCard
    onClick={onClick}
    className={`premium-card p-4 shine-on-hover glow-ring transition-shadow ${onClick ? 'cursor-pointer' : 'cursor-default'} ${active ? 'ring-2 ring-indigo-400/70' : ''}`}
  >
    <div className="flex items-center justify-between mb-3">
      <div
        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white shadow-lg`}
        style={{ transform: 'translateZ(26px)' }}
      >
        <Icon size={18} />
      </div>
    </div>
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div
      className="text-2xl font-extrabold text-slate-900 tracking-tight tabular-nums mt-1"
      style={{ transform: 'translateZ(16px)' }}
    >
      {numeric != null
        ? <CountUp
            value={numeric}
            format={(v) => isPercent
              ? `${v.toFixed(1)}%`
              : (isCurrency ? '$' + Math.round(v).toLocaleString() : Math.round(v).toLocaleString())}
          />
        : value}
    </div>
    {sub && <div className="text-[11px] text-slate-500 mt-1 leading-snug">{sub}</div>}
  </TiltCard>
));
Kpi.displayName = 'Kpi';

function CpaDashboard({ leads, investments, activities, platformExpenses = [], businessExpenses = [], businessIncome = [], chargebacks = [], overrides = [], ownAdvances = [], prospects = [], onOpenProspects, onDeleteChargeback, onEditInvestment, onDeleteInvestment, onDeleteAutoWeek, onNewInvestment, onNewActivity, onEditActivity, onDeleteActivity, onMarkPaymentTaken, onPaymentHeadsUpSent }) {
  const chartColors = useChartColors();
  const [showHowTo, setShowHowTo] = useState(false);
  const thisWeek = getWeekStart(new Date().toISOString().slice(0, 10));

  // Period selector — scopes the 6 KPI cards (other sections keep their own scope)
  const [kpiPeriod, setKpiPeriod] = useState('week'); // 'week' | 'month' | 'ytd' | 'all' | 'custom'
  const [kpiWeekStart, setKpiWeekStart] = useState(thisWeek); // ISO Friday date
  const thisMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const [kpiMonth, setKpiMonth] = useState(thisMonth);     // 'YYYY-MM'
  // Custom range — default to the current month so the inputs aren't empty.
  const [kpiFrom, setKpiFrom] = useState(`${thisMonth}-01`);
  const [kpiTo, setKpiTo]     = useState(new Date().toISOString().slice(0, 10));

  const closedByWeek = useMemo(() => {
    const m = {};
    leads.filter(l => l.stage === 'Issued' && l.closedDate).forEach(l => {
      const w = getWeekStart(l.closedDate);
      (m[w] ||= []).push(l);
    });
    return m;
  }, [leads]);

  // Platform expenses now live in business_expenses_v1 under the
  // PLATFORM_RINGY / PLATFORM_TEXTDRIP / PLATFORM_VANILLASOFT categories
  // (migrated 2026-05). Derive the legacy platform-expense view for
  // anywhere that still bucketed by Friday-week.
  const platformsFromBooks = useMemo(
    () => (businessExpenses || []).filter(e => PLATFORM_EXPENSE_CATEGORIES.includes(e.category)),
    [businessExpenses]
  );

  const platformByWeek = useMemo(() => {
    const m = {};
    platformsFromBooks.forEach(e => {
      if (!e?.date) return;
      const w = getWeekStart(e.date);
      m[w] = (m[w] || 0) + Number(e.amount || 0);
    });
    return m;
  }, [platformsFromBooks]);

  // Earned is driven SOLELY by Issued-lead commissions (the auto-sync).
  // Manual advances/paid in the investment log are tracked for record-keeping
  // but do NOT feed Earned/ROI/Net — otherwise they double-count the same money.
  const weekly = useMemo(() => {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const w = weekAgo(i);
      const inv = investments.find(x => x.weekStart === w);
      const baseInvested = inv ? (inv.leadSpend || 0) + (inv.crmWeekly || 0) + (inv.crmDaily || 0) : 0;
      const platformInvested = platformByWeek[w] || 0;
      const invested = baseInvested + platformInvested;
      const manualEarned = inv ? (inv.advances || 0) + (inv.paid || 0) : 0;
      const autoCloses = closedByWeek[w] || [];
      const autoCommission = autoCloses.reduce((s, l) => s + (l.dealValue || 0), 0);
      const earned = autoCommission; // single source of truth
      weeks.push({ week: w, label: weekLabel(w), invested, earned, auto: autoCommission, autoDeals: autoCloses.length, manualEarned, platformInvested });
    }
    return weeks;
  }, [investments, closedByWeek]);

  const thisWeekRow = weekly[weekly.length - 1];

  // --- KPI scope helpers: return true if a date falls in the selected period ---
  const kpiLabel = useMemo(() => {
    if (kpiPeriod === 'all') return 'All time';
    if (kpiPeriod === 'ytd') return `YTD ${new Date().getFullYear()}`;
    if (kpiPeriod === 'month') {
      const [y, m] = kpiMonth.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    }
    if (kpiPeriod === 'custom') {
      if (!kpiFrom || !kpiTo) return 'Custom range';
      return `${kpiFrom} → ${kpiTo}`;
    }
    return `Week of ${weekRangeLabel(kpiWeekStart)}`;
  }, [kpiPeriod, kpiWeekStart, kpiMonth, kpiFrom, kpiTo]);

  // All KPI math memoized in one block — was running on every parent re-render
  // (modal open/close, toast appear/disappear, ANY state change in LeadTracker).
  // For an agent with 500+ leads this dashboard becomes the slowest screen if
  // these aren't memoized.
  const kpiData = useMemo(() => {
    // Normalize to YYYY-MM-DD. Some legacy entries (chargebacks/overrides
    // imported before the parser-side fix) store dates in M/D/YYYY format —
    // tolerate them here so we don't have to run a data migration.
    const normIso = (s) => {
      if (!s) return '';
      const t = String(s).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (m) {
        let yy = m[3];
        if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
        return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      }
      return '';
    };
    const inPeriod = (rawDate) => {
      const iso = normIso(rawDate);
      if (!iso) return false;
      if (kpiPeriod === 'all') return true;
      if (kpiPeriod === 'ytd') {
        const d = new Date(iso + 'T00:00:00');
        return d.getFullYear() === new Date().getFullYear();
      }
      if (kpiPeriod === 'month') {
        return iso.slice(0, 7) === kpiMonth;
      }
      if (kpiPeriod === 'custom') {
        // YYYY-MM-DD string compare is correct for inclusive range bounds.
        if (!kpiFrom || !kpiTo) return false;
        return iso >= kpiFrom && iso <= kpiTo;
      }
      return getWeekStart(iso) === kpiWeekStart;
    };

    const scopedInvestments = investments.filter(i => inPeriod(i.weekStart));
    const scopedIssued      = leads.filter(l => l.stage === 'Issued' && inPeriod(l.closedDate));
    // Platform spend now lives in Books under PLATFORM_* categories. Sum
    // those for the lead-acquisition slice (Weekly + Platforms).
    const scopedPlatform    = platformsFromBooks
      .filter(e => inPeriod(e.date))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const scopedBaseInvested = scopedInvestments.reduce((s, i) => s + (i.leadSpend || 0) + (i.crmWeekly || 0) + (i.crmDaily || 0), 0);
    // Lead-acquisition slice ONLY (Weekly + Platforms). Used for the legacy
    // "Net" derivation and any place we explicitly want to separate
    // lead-spend from broader per-deal costs.
    const scopedInvestedLeadAcq = scopedBaseInvested + scopedPlatform;

    // Own-sales commission income — sum of per-row personal advances from
    // weekly statements, scoped to the statement period. This reflects what
    // was actually paid in the period.
    //
    // Fallback: if there are no own_advances entries for the period (e.g.,
    // statements not yet imported, or a lead manually marked Issued without
    // a statement), fall back to summing dealValue across issued leads
    // closed in the period — better to show an approximation than $0.
    const scopedOwnAdvanceRows  = ownAdvances.filter(a => inPeriod(a.period));
    const scopedOwnFromStmts    = scopedOwnAdvanceRows.reduce((s, a) => s + Number(a.amount || 0), 0);
    const scopedOwnFromLeads    = scopedIssued.reduce((s, l) => s + (l.dealValue || 0), 0);
    const scopedOwnEarned       = scopedOwnAdvanceRows.length > 0 ? scopedOwnFromStmts : scopedOwnFromLeads;
    const scopedOwnSource       = scopedOwnAdvanceRows.length > 0 ? 'statements' : 'leads';

    // Override commission income — money the agent earns from sub-agents' deals.
    // Each override entry has { amount, period (statement period end date), ... }.
    // We scope by the override's period date, not the policy date.
    const scopedOverrideIncome = overrides
      .filter(o => inPeriod(o.period))
      .reduce((s, o) => s + Number(o.amount || 0), 0);
    const scopedOverrideCount = overrides.filter(o => inPeriod(o.period)).length;

    // Total commission income (own + override) = what the agent's "Earned" really is.
    const scopedEarned          = scopedOwnEarned + scopedOverrideIncome;
    const scopedAutoDealCount   = scopedIssued.length;
    const scopedPremiums = scopedIssued.reduce((s, l) => {
      const addon = (l.products || []).reduce((a, p) => a + (p.premium || 0), 0);
      return s + (l.mainProductPremium || 0) + productPremium(l.associationPlan) + addon;
    }, 0);
    const scopedNet = scopedEarned - scopedInvestedLeadAcq;
    const scopedBusinessExpenses = businessExpenses.filter(e => inPeriod(e.date)).reduce((s, e) => s + Number(e.amount || 0), 0);
    const scopedBusinessIncome   = businessIncome.filter(e => inPeriod(e.date)).reduce((s, e) => s + Number(e.amount || 0), 0);

    // True CPA per agent direction:
    //   Numerator = Weekly Investment (leadSpend + crmWeekly + crmDaily)
    //             + Books LEAD_INVESTMENT + SOFTWARE + PLATFORM_*  (all in Books now)
    //   Denominator = Issued deals
    //
    // The Books-side platform charges (PLATFORM_RINGY / PLATFORM_TEXTDRIP /
    // PLATFORM_VANILLASOFT) are already counted via scopedPlatform above,
    // so we sum the non-platform True-CPA categories here to avoid double.
    const scopedBookLeadInvestment = businessExpenses
      .filter(e => inPeriod(e.date) && e.category === 'LEAD_INVESTMENT')
      .reduce((s, e) => s + Number(e.amount || 0), 0);

    // SOFTWARE category is now CRM-platform-free (those have their own
    // categories). No more vendor-string dedup hack required.
    const scopedBookSoftware = businessExpenses
      .filter(e => inPeriod(e.date) && e.category === 'SOFTWARE')
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const scopedBookSoftwarePlatformOverlap = 0; // legacy field, kept for breakdown panel transparency

    // INVESTED (full per-deal cost basis) = Weekly + Books LI + Books SW + Platforms (in Books).
    // scopedInvestedLeadAcq already includes scopedPlatform; we add the two
    // remaining True-CPA Books categories.
    const scopedTrueCpaBooks = scopedBookLeadInvestment + scopedBookSoftware;
    const scopedInvested = scopedInvestedLeadAcq + scopedTrueCpaBooks;
    const scopedTrueCpaBase = scopedInvested; // alias kept for breakdown panel
    const scopedTrueCpa = scopedAutoDealCount > 0 ? scopedInvested / scopedAutoDealCount : 0;
    const scopedCpa = scopedAutoDealCount > 0 ? scopedInvested / scopedAutoDealCount : 0;

    // ROI uses the same denominator so all per-deal metrics agree:
    //   ROI = (Earned − Invested) ÷ Invested × 100
    const scopedRoi = scopedInvested > 0
      ? ((scopedEarned - scopedInvested) / scopedInvested) * 100
      : 0;

    // True Net "out": Invested already contains every TRUE_CPA_BOOK_CATEGORIES
    // entry (LI + SOFTWARE + the three PLATFORM_*), so exclude those when
    // summing the rest of Books to avoid double-counting.
    const scopedBusinessExpensesNonInvested = businessExpenses
      .filter(e => inPeriod(e.date) && !TRUE_CPA_BOOK_CATEGORIES.includes(e.category))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const scopedTrueNet = (scopedEarned + scopedBusinessIncome) - (scopedInvested + scopedBusinessExpensesNonInvested);

    // Detailed breakdowns for the Invested / Earned / Revenue / TrueNet / ROI panels
    const investmentBreakdown = scopedInvestments.reduce((acc, i) => {
      acc.leadSpend += i.leadSpend || 0;
      acc.crmWeekly += i.crmWeekly || 0;
      acc.crmDaily  += i.crmDaily  || 0;
      return acc;
    }, { leadSpend: 0, crmWeekly: 0, crmDaily: 0 });

    const platformBreakdown = platformsFromBooks
      .filter(e => inPeriod(e.date))
      .reduce((acc, e) => {
        const p = CATEGORY_TO_PLATFORM_ID[e.category] || 'OTHER';
        acc[p] = (acc[p] || 0) + Number(e.amount || 0);
        return acc;
      }, {});

    // Earned breakdown by product. Source must match scopedOwnEarned so the
    // breakdown rows reconcile with the tile total.
    const earnedByProduct = scopedOwnSource === 'statements'
      ? scopedOwnAdvanceRows.reduce((acc, r) => {
          const p = r.productDesc || '— Unknown product —';
          if (!acc[p]) acc[p] = { count: 0, total: 0 };
          acc[p].count += 1;
          acc[p].total += Number(r.amount || 0);
          return acc;
        }, {})
      : scopedIssued.reduce((acc, l) => {
          const p = l.mainProduct || '— No main product —';
          if (!acc[p]) acc[p] = { count: 0, total: 0 };
          acc[p].count += 1;
          acc[p].total += l.dealValue || 0;
          return acc;
        }, {});

    const incomeByCategory = businessIncome
      .filter(e => inPeriod(e.date))
      .reduce((acc, e) => {
        const c = e.category || 'OTHER_INCOME';
        acc[c] = (acc[c] || 0) + Number(e.amount || 0);
        return acc;
      }, {});

    const expensesByCategory = businessExpenses
      .filter(e => inPeriod(e.date))
      .reduce((acc, e) => {
        const c = e.category || 'OTHER_EXPENSE';
        acc[c] = (acc[c] || 0) + Number(e.amount || 0);
        return acc;
      }, {});

    return {
      scopedInvestments, scopedIssued, scopedInvested, scopedInvestedLeadAcq,
      scopedOwnEarned, scopedOverrideIncome, scopedOverrideCount, scopedEarned, scopedAutoDealCount,
      scopedOwnSource, scopedOwnAdvanceRows,
      scopedCpa, scopedRoi, scopedPremiums, scopedNet,
      scopedBusinessExpenses, scopedBusinessExpensesNonInvested, scopedBusinessIncome, scopedTrueNet,
      scopedBaseInvested, scopedPlatform,
      scopedBookLeadInvestment, scopedBookSoftware, scopedBookSoftwarePlatformOverlap, scopedTrueCpaBooks,
      scopedTrueCpaBase, scopedTrueCpa,
      investmentBreakdown, platformBreakdown,
      earnedByProduct, incomeByCategory, expensesByCategory,
      inKpiPeriod: inPeriod,
    };
  }, [leads, investments, platformsFromBooks, businessExpenses, businessIncome, overrides, ownAdvances, kpiPeriod, kpiWeekStart, kpiMonth, kpiFrom, kpiTo]);

  // Destructure once so the rest of the component reads naturally
  const {
    scopedInvestments, scopedIssued, scopedInvested, scopedInvestedLeadAcq,
    scopedOwnEarned, scopedOverrideIncome, scopedOverrideCount, scopedEarned, scopedAutoDealCount,
    scopedOwnSource, scopedOwnAdvanceRows,
    scopedCpa, scopedRoi, scopedPremiums, scopedNet,
    scopedBusinessExpenses, scopedBusinessExpensesNonInvested, scopedBusinessIncome, scopedTrueNet,
    scopedBaseInvested, scopedPlatform,
    scopedBookLeadInvestment, scopedBookSoftware, scopedBookSoftwarePlatformOverlap, scopedTrueCpaBooks,
    scopedTrueCpaBase, scopedTrueCpa,
    investmentBreakdown, platformBreakdown,
    earnedByProduct, incomeByCategory, expensesByCategory,
    inKpiPeriod,
  } = kpiData;

  // Single state — only one breakdown panel open at a time
  const [openBreakdown, setOpenBreakdown] = useState(null); // 'invested' | 'earned' | 'revenue' | 'trueNet' | 'roi' | 'cpa' | 'trueCpa' | null
  const toggleBreakdown = (key) => setOpenBreakdown(prev => prev === key ? null : key);
  const closeBreakdown  = () => setOpenBreakdown(null);

  const activityTotalsAll = useMemo(
    () => mergeFunnelTotals(activities, prospects),
    [activities, prospects]
  );

  const followupStats = useMemo(
    () => computeFollowupStats(prospects, new Date().toISOString()),
    [prospects]
  );

  const sortedActivities = useMemo(
    () => [...activities].sort((a, b) => b.date.localeCompare(a.date)),
    [activities]
  );

  const activityTotals = activityTotalsAll;
  const funnelMax = Math.max(activityTotals.dials, 1);
  const funnelRow = (label, value, Icon, color) => (
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
        <Icon size={14} />
      </div>
      <span className="text-sm w-24 text-slate-700">{label}</span>
      <div className="flex-1 h-5 bg-slate-100 rounded">
        <div className="h-full bg-indigo-500 rounded" style={{ width: `${(value / funnelMax) * 100}%` }} />
      </div>
      <span className="w-12 text-right text-sm font-medium text-slate-900">{value}</span>
    </div>
  );

  const allWeeks = useMemo(() => {
    const merged = {};
    investments.forEach(i => { merged[i.weekStart] = { ...i, autoDeals: 0, autoCommission: 0, platformSpend: 0 }; });
    Object.entries(closedByWeek).forEach(([w, leadsArr]) => {
      merged[w] ||= { id: null, weekStart: w, leadSpend: 0, crmWeekly: 0, crmDaily: 0, advances: 0, paid: 0, notes: '', autoDeals: 0, autoCommission: 0, platformSpend: 0 };
      merged[w].autoDeals = leadsArr.length;
      merged[w].autoCommission = leadsArr.reduce((s, l) => s + (l.dealValue || 0), 0);
    });
    // Merge in any week that has platform spend but no investment row + no closed deals
    Object.entries(platformByWeek).forEach(([w, total]) => {
      merged[w] ||= { id: null, weekStart: w, leadSpend: 0, crmWeekly: 0, crmDaily: 0, advances: 0, paid: 0, notes: '', autoDeals: 0, autoCommission: 0, platformSpend: 0 };
      merged[w].platformSpend = total;
    });
    return Object.values(merged).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }, [investments, closedByWeek, platformByWeek]);

  // Header summary
  const thisWeekCloseCount = (closedByWeek[thisWeek] || []).length;
  const thisWeekCloseSum = (closedByWeek[thisWeek] || []).reduce((s, l) => s + (l.dealValue || 0), 0);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">CPA Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Week of {weekRangeLabel(thisWeek)}
            {thisWeekCloseCount > 0 && (
              <> · <span className="text-slate-700 font-medium">{thisWeekCloseCount} lead{thisWeekCloseCount !== 1 ? 's' : ''} closed worth {fmt(thisWeekCloseSum)}</span></>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowHowTo(v => !v)}
            className="border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <Info size={14} /> How to use {showHowTo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={onNewActivity}
            className="border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <Plus size={14} /> Log Activity
          </button>
          <button
            onClick={onNewInvestment}
            className="bg-indigo-600 text-white rounded-lg px-3 py-2 text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <Plus size={14} /> Log Investment
          </button>
        </div>
      </div>

      {/* Outreach follow-ups (beta) — compact card at the top of CPA so
          the reminder is visible from the default landing view. Clicking
          a row jumps to the Prospects tab; that view's full widget
          surfaces the prospect's detail. */}
      <OutreachRemindersWidget
        prospects={prospects}
        compact
        onOpenProspect={() => onOpenProspects?.()}
      />

      {/* Payment Alerts — deals whose first premium drafts soon. Lets the
          agent give the client a heads-up to keep funds ready and avoid a
          NOT TAKEN (protecting taken rate). */}
      <PaymentAlertsWidget
        leads={leads}
        onMarkTaken={onMarkPaymentTaken}
        onSentHeadsUp={onPaymentHeadsUpSent}
      />

      {/* How to use */}
      {showHowTo && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 text-indigo-900 font-semibold text-sm">
            <Sparkles size={14} /> How to use this dashboard
          </div>
          <ol className="space-y-2 text-sm text-slate-700">
            <li><span className="font-semibold text-indigo-700">1. Start fresh:</span> click the gear icon in the top-right to clear demo data before entering your real numbers.</li>
            <li><span className="font-semibold text-indigo-700">2. Every end of day:</span> Log Activity — dials, appointments, pitches, closes. Works for any date, past or present.</li>
            <li><span className="font-semibold text-indigo-700">3. Every Friday:</span> Log Investment. Weeks run Fri → Thu. Pick any date with the calendar and the app auto-maps to that Friday.</li>
            <li><span className="font-semibold text-indigo-700">4. Backtrack your history:</span> enter any month/year using the date pickers — plug in Jan–Dec in any order.</li>
            <li><span className="font-semibold text-indigo-700">5. Only Issued deals pay:</span> a deal starts as &ldquo;Pending&rdquo; after close. Once underwriting approves it, move it to &ldquo;Issued&rdquo; and it flows into your Earned / ROI / Closed Deals automatically.</li>
          </ol>
        </div>
      )}

      {/* KPI period selector */}
      <div className="premium-card p-3 flex flex-wrap items-center gap-3">
        <div className="text-xs font-bold text-slate-500 tracking-wider">KPI PERIOD</div>
        <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
          <button onClick={() => setKpiPeriod('week')} className={`px-3 py-1.5 font-medium ${kpiPeriod === 'week' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Week</button>
          <button onClick={() => setKpiPeriod('month')} className={`px-3 py-1.5 font-medium border-l border-slate-200 ${kpiPeriod === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Month</button>
          <button onClick={() => setKpiPeriod('ytd')} className={`px-3 py-1.5 font-medium border-l border-slate-200 ${kpiPeriod === 'ytd' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>YTD</button>
          <button onClick={() => setKpiPeriod('all')} className={`px-3 py-1.5 font-medium border-l border-slate-200 ${kpiPeriod === 'all' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>All time</button>
          <button onClick={() => setKpiPeriod('custom')} className={`px-3 py-1.5 font-medium border-l border-slate-200 ${kpiPeriod === 'custom' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Custom</button>
        </div>
        {kpiPeriod === 'week' && (
          <>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const d = new Date(kpiWeekStart + 'T00:00:00');
                  d.setDate(d.getDate() - 7);
                  setKpiWeekStart(getWeekStart(d.toISOString().slice(0, 10)));
                }}
                title="Previous week"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft size={16} />
              </button>
              <input
                type="date"
                value={kpiWeekStart}
                onChange={e => e.target.value && setKpiWeekStart(getWeekStart(e.target.value))}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                title="Pick any date; it snaps to the Fri-Thu week it belongs to."
              />
              <button
                onClick={() => {
                  const d = new Date(kpiWeekStart + 'T00:00:00');
                  d.setDate(d.getDate() + 7);
                  setKpiWeekStart(getWeekStart(d.toISOString().slice(0, 10)));
                }}
                disabled={kpiWeekStart >= thisWeek}
                title="Next week"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              onClick={() => setKpiWeekStart(thisWeek)}
              className="text-xs text-indigo-600 hover:underline"
              disabled={kpiWeekStart === thisWeek}
            >
              Reset to current week
            </button>
          </>
        )}
        {kpiPeriod === 'month' && (
          <>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const [y, m] = kpiMonth.split('-').map(Number);
                  const d = new Date(y, m - 2, 1);
                  setKpiMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                }}
                title="Previous month"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft size={16} />
              </button>
              <input
                type="month"
                value={kpiMonth}
                onChange={e => e.target.value && setKpiMonth(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              />
              <button
                onClick={() => {
                  const [y, m] = kpiMonth.split('-').map(Number);
                  const d = new Date(y, m, 1);
                  setKpiMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                }}
                disabled={kpiMonth >= thisMonth}
                title="Next month"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              onClick={() => setKpiMonth(thisMonth)}
              className="text-xs text-indigo-600 hover:underline"
              disabled={kpiMonth === thisMonth}
            >
              Reset to current month
            </button>
          </>
        )}
        {kpiPeriod === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-500 flex items-center gap-1">
              From
              <input
                type="date"
                value={kpiFrom}
                max={kpiTo || undefined}
                onChange={e => setKpiFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500 flex items-center gap-1">
              To
              <input
                type="date"
                value={kpiTo}
                min={kpiFrom || undefined}
                onChange={e => setKpiTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              />
            </label>
            {kpiFrom && kpiTo && kpiFrom > kpiTo && (
              <span className="text-xs text-rose-600 font-medium">From is after To</span>
            )}
          </div>
        )}
        <span className="ml-auto text-xs text-slate-500">Showing: <b className="text-slate-700">{kpiLabel}</b></span>
      </div>

      <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StaggerItem>
          <Kpi
            label={`Invested (${kpiLabel})`} numeric={scopedInvested}
            sub={openBreakdown === 'invested' ? 'click again to hide' : 'click for breakdown'}
            grad="from-red-500 to-orange-500" Icon={DollarSign}
            onClick={() => toggleBreakdown('invested')}
            active={openBreakdown === 'invested'}
          />
        </StaggerItem>
        <StaggerItem>
          <Kpi
            label={`Earned (${kpiLabel})`} numeric={scopedEarned}
            sub={scopedOverrideIncome > 0
              ? `${fmt(scopedOwnEarned)} own + ${fmt(scopedOverrideIncome)} overrides`
              : (scopedAutoDealCount > 0 ? `${scopedAutoDealCount} issued deal(s)` : null)}
            grad="from-emerald-500 to-green-500" Icon={TrendingUp}
            onClick={() => toggleBreakdown('earned')}
            active={openBreakdown === 'earned'}
          />
        </StaggerItem>
        <StaggerItem>
          <Kpi
            label={`Total Revenue (${kpiLabel})`}
            numeric={scopedEarned + scopedBusinessIncome}
            sub={scopedBusinessIncome > 0 ? `${fmt(scopedEarned)} comm + ${fmt(scopedBusinessIncome)} books` : 'commissions only'}
            grad="from-emerald-500 to-cyan-500" Icon={TrendingUp}
            onClick={() => toggleBreakdown('revenue')}
            active={openBreakdown === 'revenue'}
          />
        </StaggerItem>
        <StaggerItem>
          <Kpi
            label={`True Net (${kpiLabel})`}
            numeric={scopedTrueNet}
            sub={(() => {
              const totalIn  = scopedEarned + scopedBusinessIncome;
              const totalOut = scopedInvested + scopedBusinessExpensesNonInvested;
              if (totalIn === 0 && totalOut === 0) return 'add Books entries';
              return `${fmt(totalIn)} in − ${fmt(totalOut)} out`;
            })()}
            grad={scopedTrueNet >= 0 ? 'from-emerald-600 to-cyan-500' : 'from-rose-600 to-red-500'}
            Icon={Wallet}
            onClick={() => toggleBreakdown('trueNet')}
            active={openBreakdown === 'trueNet'}
          />
        </StaggerItem>
        <StaggerItem>
          <Kpi
            label={`ROI (${kpiLabel})`} numeric={scopedRoi} isCurrency={false} isPercent={true}
            sub={openBreakdown === 'roi' ? 'click again to hide' : 'click for breakdown'}
            grad="from-indigo-500 to-blue-500" Icon={Percent}
            onClick={() => toggleBreakdown('roi')}
            active={openBreakdown === 'roi'}
          />
        </StaggerItem>
        <StaggerItem>
          <Kpi
            label={`True CPA (${kpiLabel})`} numeric={scopedTrueCpa}
            sub={openBreakdown === 'trueCpa' ? 'click again to hide' : 'click for breakdown'}
            grad="from-fuchsia-500 to-purple-600" Icon={Target}
            onClick={() => toggleBreakdown('trueCpa')}
            active={openBreakdown === 'trueCpa'}
          />
        </StaggerItem>
      </Stagger>

      {/* ---------- KPI breakdown panels ---------- */}
      {/* Invested */}
      {openBreakdown === 'invested' && (
        <BreakdownPanel
          title={`Invested Breakdown (${kpiLabel})`}
          subtitle="Full per-deal cost basis — same denominator as True CPA & ROI"
          theme="red"
          Icon={DollarSign}
          onClose={closeBreakdown}
          rows={[
            { label: 'Weekly — Lead Spend',     hint: 'Investment Activity → Lead Spend column',  amount: investmentBreakdown.leadSpend },
            { label: 'Weekly — CRM Weekly',     hint: 'Investment Activity → CRM Wk column',      amount: investmentBreakdown.crmWeekly },
            { label: 'Weekly — CRM Daily',      hint: 'Investment Activity → CRM Day column',     amount: investmentBreakdown.crmDaily },
            ...Object.entries(platformBreakdown).map(([p, amt]) => ({
              label: `Platform — ${p}`,
              hint: 'Platforms tab daily entries',
              amount: amt,
            })),
            { label: 'Books — Lead Investment',    hint: 'LEAD_INVESTMENT category in Books',           amount: scopedBookLeadInvestment },
            { label: 'Books — Software (deduped)', hint: scopedBookSoftwarePlatformOverlap > 0
                ? `SOFTWARE in Books — excludes ${fmt2(scopedBookSoftwarePlatformOverlap)} of TextDrip/Ringy/VanillaSoft already in Platforms`
                : 'SOFTWARE category in Books (Calendly, ChatGPT, etc.)',
              amount: scopedBookSoftware },
          ]}
          excluded={`Other Books expenses (Office Rent, Recruiting, Travel, Vehicle, Meals, Healthcare, Phone/Internet, Coaching, Other) flow into True Net but not into Invested.${scopedBookSoftwarePlatformOverlap > 0 ? ` Plus ${fmt2(scopedBookSoftwarePlatformOverlap)} of TextDrip/Ringy/VanillaSoft from Books SOFTWARE was excluded as Platforms-overlap.` : ''}`}
          totalLabel="Total Invested"
          total={scopedInvested}
        />
      )}
      {/* Earned */}
      {openBreakdown === 'earned' && (
        <BreakdownPanel
          title={`Earned Breakdown (${kpiLabel})`}
          subtitle="Own-sales commissions + override income from sub-agents"
          theme="emerald"
          Icon={TrendingUp}
          onClose={closeBreakdown}
          rows={[
            // Own-sales rows by product
            ...Object.entries(earnedByProduct).map(([prod, { count, total }]) => ({
              label: `Own — ${prod}`,
              hint: scopedOwnSource === 'statements'
                ? `${count} statement row${count !== 1 ? 's' : ''} (personal advance)`
                : `${count} issued deal${count !== 1 ? 's' : ''}`,
              amount: total,
            })),
            // Override income (single combined row)
            ...(scopedOverrideIncome > 0 ? [{
              label: 'Override Income',
              hint: `${scopedOverrideCount} override row${scopedOverrideCount !== 1 ? 's' : ''} from sub-agents' deals (auto-imported from weekly statements)`,
              amount: scopedOverrideIncome,
            }] : []),
          ]}
          totalLabel={scopedOwnSource === 'statements'
            ? `Total Earned (${scopedOwnAdvanceRows.length} own advance row${scopedOwnAdvanceRows.length !== 1 ? 's' : ''} + ${scopedOverrideCount} override row${scopedOverrideCount !== 1 ? 's' : ''})`
            : `Total Earned (${scopedAutoDealCount} own deals + ${scopedOverrideCount} overrides)`}
          total={scopedEarned}
        />
      )}
      {/* Total Revenue */}
      {openBreakdown === 'revenue' && (
        <BreakdownPanel
          title={`Total Revenue Breakdown (${kpiLabel})`}
          subtitle="Lead commissions + everything in Books → Other Income"
          theme="cyan"
          Icon={TrendingUp}
          onClose={closeBreakdown}
          rows={[
            { label: 'Lead Commissions (Earned)', hint: 'From Issued lead dealValue totals', amount: scopedEarned },
            ...Object.entries(incomeByCategory).map(([cat, amt]) => ({
              label: `Books Income — ${cat}`,
              hint: 'From Books → Other Income tab',
              amount: amt,
            })),
          ]}
          totalLabel="Total Revenue"
          total={scopedEarned + scopedBusinessIncome}
        />
      )}
      {/* True Net */}
      {openBreakdown === 'trueNet' && (
        <BreakdownPanel
          title={`True Net Breakdown (${kpiLabel})`}
          subtitle="All money in minus all money out"
          theme="cyan"
          Icon={Wallet}
          onClose={closeBreakdown}
          twoColumn={{
            in: [
              { label: 'Lead Commissions',  amount: scopedEarned },
              { label: 'Books Income',      amount: scopedBusinessIncome },
            ],
            out: [
              { label: 'Invested (per-deal cost: Weekly + Platforms + Books LI + Books SW)', amount: scopedInvested },
              { label: 'Books Expenses (other categories — excludes LI + SW already in Invested)', amount: scopedBusinessExpensesNonInvested },
            ],
            inTotal: scopedEarned + scopedBusinessIncome,
            outTotal: scopedInvested + scopedBusinessExpensesNonInvested,
          }}
          totalLabel="True Net (in − out)"
          total={scopedTrueNet}
        />
      )}
      {/* ROI */}
      {openBreakdown === 'roi' && (
        <BreakdownPanel
          title={`ROI Breakdown (${kpiLabel})`}
          subtitle="Return on per-deal investment (uses same cost basis as True CPA)"
          theme="indigo"
          Icon={Percent}
          onClose={closeBreakdown}
          rows={[
            { label: 'Earned (commissions)',       hint: 'From Issued lead dealValue',                 amount: scopedEarned },
            { label: '− Weekly Investment',        hint: 'Lead Spend + CRM Weekly + CRM Daily',        amount: -scopedBaseInvested },
            { label: '− Platform Expenses',        hint: 'TextDrip + Ringy + VanillaSoft',             amount: -scopedPlatform },
            { label: '− Books Lead Investment',    hint: 'LEAD_INVESTMENT category in Books',          amount: -scopedBookLeadInvestment },
            { label: '− Books Software (deduped)', hint: scopedBookSoftwarePlatformOverlap > 0
                ? `SOFTWARE in Books — excludes ${fmt2(scopedBookSoftwarePlatformOverlap)} of platform overlap`
                : 'SOFTWARE category in Books (Calendly, ChatGPT, etc.)',
              amount: -scopedBookSoftware },
            { label: '= Net profit', hint: 'Earned minus all per-deal costs', amount: scopedEarned - scopedTrueCpaBase, bold: true },
          ]}
          formula={`(${fmt(scopedEarned - scopedTrueCpaBase)} ÷ ${fmt(scopedTrueCpaBase)}) × 100 = ${scopedRoi.toFixed(1)}%`}
          totalLabel="ROI"
          totalDisplay={`${scopedRoi.toFixed(1)}%`}
        />
      )}
      {/* True CPA */}
      {openBreakdown === 'trueCpa' && (
        <BreakdownPanel
          title={`True CPA Breakdown (${kpiLabel})`}
          subtitle="Per-deal cost including direct lead-acquisition + software (deduped vs Platforms)"
          theme="fuchsia"
          Icon={Target}
          onClose={closeBreakdown}
          rows={[
            { label: 'Weekly — Lead Spend',     hint: 'Investment Activity → Lead Spend',           amount: investmentBreakdown.leadSpend },
            { label: 'Weekly — CRM Weekly',     hint: 'Investment Activity → CRM Wk',               amount: investmentBreakdown.crmWeekly },
            { label: 'Weekly — CRM Daily',      hint: 'Investment Activity → CRM Day',              amount: investmentBreakdown.crmDaily },
            { label: 'Platform Expenses',       hint: 'TextDrip + Ringy + VanillaSoft (Platforms tab)', amount: scopedPlatform },
            { label: 'Books — Lead Investment', hint: 'LEAD_INVESTMENT category in Books',          amount: scopedBookLeadInvestment },
            { label: 'Books — Software (other)', hint: scopedBookSoftwarePlatformOverlap > 0
                ? `SOFTWARE in Books — excludes ${fmt2(scopedBookSoftwarePlatformOverlap)} of TextDrip/Ringy/VanillaSoft already in Platforms`
                : 'SOFTWARE category in Books (Calendly, ChatGPT, Canva, etc.)',
              amount: scopedBookSoftware },
          ]}
          formula={`${fmt(scopedTrueCpaBase)} ÷ ${scopedAutoDealCount} deals = ${fmt2(scopedTrueCpa)}`}
          excluded={`Office rent · Recruiting · Travel · Vehicle · Meals · Healthcare · Phone/Internet · Coaching · Other — these are real business expenses but don't scale per-deal so they flow into True Net instead.${scopedBookSoftwarePlatformOverlap > 0 ? ` Plus ${fmt2(scopedBookSoftwarePlatformOverlap)} of TextDrip/Ringy/VanillaSoft from Books SOFTWARE was excluded as Platforms-overlap.` : ''}`}
          totalLabel="True CPA"
          totalDisplay={fmt2(scopedTrueCpa)}
        />
      )}

      {/* Taken Rate Calculators — UW (Premier Adv/Choice, Secure Adv) + GI (Health Access III) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TakenRateCalculator
          leads={leads}
          title="Underwritten Taken Rate"
          subtitle="Premier Advantage, Secure Advantage, Premier Choice \u00b7 Issued \u00f7 submitted to underwriting \u00b7 60%+ target \u00b7 over-50 excluded"
          productFilter={UNDERWRITTEN_PRODUCTS}
          defaultTarget={60}
          applyOver50Rule={true}
          bonusStartMonth={11}
          priorsKey="uw"
        />
        <TakenRateCalculator
          leads={leads}
          title="GI Taken Rate (Guaranteed Issue)"
          subtitle="Health Access III \u00b7 GI plans issue without underwriting review \u00b7 65%+ target \u00b7 all ages count"
          productFilter={GI_PRODUCTS}
          defaultTarget={65}
          applyOver50Rule={false}
          bonusStartMonth={1}
          priorsKey="gi"
        />
      </div>

      {/* Chargebacks */}
      <ChargebacksPanel chargebacks={chargebacks} onDelete={onDeleteChargeback} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Chart3DCard className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-900">Invested vs. Earned — last 8 weeks</h3>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="invested" name="Invested" fill="#ef4444" radius={[4, 4, 0, 0]} animationDuration={900}>
                <LabelList dataKey="invested" position="top" fill={chartColors.label} fontSize={11} fontWeight={700} formatter={(v) => v > 0 ? fmt(v) : ''} />
              </Bar>
              <Bar dataKey="earned" name="Earned" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={900}>
                <LabelList dataKey="earned" position="top" fill={chartColors.label} fontSize={11} fontWeight={700} formatter={(v) => v > 0 ? fmt(v) : ''} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart3DCard>

        <div className="premium-card p-4">
          <h3 className="font-semibold text-slate-900 mb-3">Activity Funnel (all-time)</h3>
          <p className="text-[11px] text-slate-400 mb-2">Includes logged prospect follow-ups (days without a manual entry).</p>
          <div className="space-y-3">
            {funnelRow('Dials', activityTotals.dials, Phone, 'bg-blue-100 text-blue-700')}
            {funnelRow('Appointments', activityTotals.appts, Calendar, 'bg-violet-100 text-violet-700')}
            {funnelRow('Pitches', activityTotals.pitches, Presentation, 'bg-amber-100 text-amber-700')}
            {funnelRow('Closes', activityTotals.closes, Trophy, 'bg-emerald-100 text-emerald-700')}
          </div>
          <button onClick={onNewActivity} className="mt-4 w-full border border-slate-200 rounded-lg py-2 text-sm hover:bg-slate-50 flex items-center justify-center gap-1">
            <Plus size={14} /> Log Activity
          </button>
        </div>

        {(followupStats.totalTouches > 0 || followupStats.activeCount > 0) && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4">
            <h3 className="font-semibold text-slate-900 mb-1">Follow-up performance</h3>
            <p className="text-[11px] text-slate-400 mb-3">From your Prospects follow-up log</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] text-slate-500">On-time</div>
                <div className={`text-xl font-bold ${followupStats.onTimeRate == null ? 'text-slate-400' : followupStats.onTimeRate >= 0.8 ? 'text-emerald-600' : followupStats.onTimeRate >= 0.5 ? 'text-amber-600' : 'text-rose-600'}`}>
                  {followupStats.onTimeRate == null ? '—' : `${Math.round(followupStats.onTimeRate * 100)}%`}
                </div>
                <div className="text-[10px] text-slate-400">{followupStats.overdueCount} overdue</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Connect rate</div>
                <div className="text-xl font-bold text-slate-900">{followupStats.totalTouches ? `${Math.round(followupStats.connectRate * 100)}%` : '—'}</div>
                <div className="text-[10px] text-slate-400">{followupStats.totalTouches} touches</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Touches → appt</div>
                <div className="text-xl font-bold text-slate-900">{followupStats.avgTouchesToAppt == null ? '—' : (Math.round(followupStats.avgTouchesToAppt * 10) / 10)}</div>
                <div className="text-[10px] text-slate-400">avg before booking</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="premium-card">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">Investment Log</h3>
          <button onClick={onNewInvestment} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1">
            <Plus size={14} /> New Week
          </button>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm premium-table">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-left p-2">Week</th>
                <th className="text-right p-2">Lead Spend</th>
                <th className="text-right p-2">CRM Wk</th>
                <th className="text-right p-2">CRM Day</th>
                <th className="text-right p-2" title="TextDrip + Ringy + VanillaSoft credits">Platforms</th>
                <th className="text-right p-2">Auto-synced Advances</th>
                <th className="text-right p-2">Total In</th>
                <th className="text-right p-2">Total Out</th>
                <th className="text-right p-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {allWeeks.map(w => {
                const totIn = w.autoCommission || 0;
                const totOut = (w.leadSpend || 0) + (w.crmWeekly || 0) + (w.crmDaily || 0) + (w.platformSpend || 0);
                return (
                  <tr key={w.weekStart} className="border-t border-slate-100">
                    <td className="p-2 font-medium">
                      {weekRangeLabel(w.weekStart)}
                      {!w.id && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wide">auto</span>}
                    </td>
                    <td className="text-right p-2">{fmt(w.leadSpend)}</td>
                    <td className="text-right p-2">{fmt(w.crmWeekly)}</td>
                    <td className="text-right p-2">{fmt(w.crmDaily)}</td>
                    <td className="text-right p-2">
                      {w.platformSpend > 0 ? (
                        <span className="text-violet-700 font-medium">{fmt(w.platformSpend)}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-right p-2">
                      {w.autoDeals > 0 ? (
                        <span className="text-emerald-700 font-medium">
                          {fmt(w.autoCommission)} <span className="text-xs text-emerald-600">({w.autoDeals})</span>
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-right p-2 font-medium text-emerald-700">{fmt(totIn)}</td>
                    <td className="text-right p-2 font-medium text-red-600">{fmt(totOut)}</td>
                    <td className="text-right p-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => onEditInvestment(w)}
                          title={w.id ? 'Edit this week' : 'Add manual investment entry for this week'}
                          className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => w.id ? onDeleteInvestment(w.id) : onDeleteAutoWeek(w.weekStart)}
                          title={w.id ? 'Delete this week' : 'Remove auto-synced row (reverts Issued leads back to Pending)'}
                          className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {allWeeks.length === 0 && (
                <tr><td colSpan="9" className="text-center p-8 text-slate-400">No investment entries yet — click &ldquo;New Week&rdquo; to start.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity Log */}
      <div className="premium-card">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h3 className="font-semibold text-slate-900">Activity Log</h3>
            <p className="text-xs text-slate-500 mt-0.5">Daily dials, appointments, pitches, closes</p>
          </div>
          <button onClick={onNewActivity} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1">
            <Plus size={14} /> Log Activity
          </button>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm premium-table">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Agent</th>
                <th className="text-right p-2"><span className="inline-flex items-center gap-1"><Phone size={11} /> Dials</span></th>
                <th className="text-right p-2"><span className="inline-flex items-center gap-1"><Calendar size={11} /> Appts</span></th>
                <th className="text-right p-2"><span className="inline-flex items-center gap-1"><Presentation size={11} /> Pitches</span></th>
                <th className="text-right p-2"><span className="inline-flex items-center gap-1"><Trophy size={11} /> Closes</span></th>
                <th className="text-left p-2">Notes</th>
                <th className="text-right p-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedActivities.map(a => (
                <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-2 font-medium">{usDate(a.date)}</td>
                  <td className="p-2 text-slate-700">{a.agent}</td>
                  <td className="text-right p-2">{a.dials}</td>
                  <td className="text-right p-2">{a.appointments}</td>
                  <td className="text-right p-2">{a.pitches}</td>
                  <td className="text-right p-2 text-emerald-700 font-medium">{a.closes}</td>
                  <td className="p-2 text-xs text-slate-500 max-w-xs truncate" title={a.notes}>{a.notes || <span className="text-slate-300">—</span>}</td>
                  <td className="text-right p-2">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => onEditActivity(a)} title="Edit" className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50"><Edit2 size={14} /></button>
                      <button onClick={() => onDeleteActivity(a.id)} title="Delete" className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {activities.length === 0 && (
                <tr><td colSpan="8" className="text-center p-8 text-slate-400">No activity logged yet — click "Log Activity" to add your first day.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default memo(CpaDashboard);

// ---------- Breakdown panel helper ----------
// Renders a styled gradient panel showing a numbered breakdown of a KPI.
// Themes pick the colors; each row is { label, hint?, amount, bold? }.
// twoColumn={{in, out, inTotal, outTotal}} renders an in/out split (True Net).
const THEMES = {
  red:      { bg: 'from-red-50 to-orange-50',         border: 'border-red-200',     header: 'bg-red-50',     text: 'text-red-900',     icon: 'text-red-600',     accent: 'border-red-300',     totalRow: 'from-red-100 to-orange-100',     totalText: 'text-red-900' },
  emerald:  { bg: 'from-emerald-50 to-green-50',      border: 'border-emerald-200', header: 'bg-emerald-50', text: 'text-emerald-900', icon: 'text-emerald-600', accent: 'border-emerald-300', totalRow: 'from-emerald-100 to-green-100',  totalText: 'text-emerald-900' },
  cyan:     { bg: 'from-emerald-50 to-cyan-50',       border: 'border-cyan-200',    header: 'bg-cyan-50',    text: 'text-cyan-900',    icon: 'text-cyan-600',    accent: 'border-cyan-300',    totalRow: 'from-cyan-100 to-emerald-100',   totalText: 'text-cyan-900' },
  indigo:   { bg: 'from-indigo-50 to-blue-50',        border: 'border-indigo-200',  header: 'bg-indigo-50',  text: 'text-indigo-900',  icon: 'text-indigo-600',  accent: 'border-indigo-300',  totalRow: 'from-indigo-100 to-blue-100',    totalText: 'text-indigo-900' },
  violet:   { bg: 'from-violet-50 to-purple-50',      border: 'border-violet-200',  header: 'bg-violet-50',  text: 'text-violet-900',  icon: 'text-violet-600',  accent: 'border-violet-300',  totalRow: 'from-violet-100 to-purple-100',  totalText: 'text-violet-900' },
  fuchsia:  { bg: 'from-fuchsia-50 to-purple-50',     border: 'border-fuchsia-200', header: 'bg-fuchsia-50', text: 'text-fuchsia-900', icon: 'text-fuchsia-600', accent: 'border-fuchsia-300', totalRow: 'from-fuchsia-100 to-purple-100', totalText: 'text-purple-900' },
};

function BreakdownPanel({ title, subtitle, theme = 'indigo', Icon, onClose, rows = [], totalLabel, total, totalDisplay, formula, excluded, twoColumn }) {
  const t = THEMES[theme] || THEMES.indigo;
  const formatAmount = (v) => v < 0 ? `−${fmt2(Math.abs(v))}` : fmt2(v);
  return (
    <div className={`bg-gradient-to-br ${t.bg} border-2 ${t.border} rounded-xl p-5 space-y-3`}>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            {Icon && <Icon size={16} className={t.icon} />}
            {title}
          </h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">Hide ✕</button>
      </div>

      {twoColumn ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Money in */}
          <div className={`bg-white rounded-lg border ${t.border} overflow-hidden`}>
            <div className={`${t.header} ${t.text} text-xs font-bold uppercase tracking-wider px-3 py-2`}>Money In</div>
            <table className="w-full text-sm premium-table">
              <tbody>
                {twoColumn.in.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 text-slate-900">{row.label}</td>
                    <td className="text-right p-2 font-semibold text-emerald-700">{formatAmount(row.amount)}</td>
                  </tr>
                ))}
                <tr className={`border-t-2 ${t.accent} bg-emerald-50/50`}>
                  <td className="p-2 font-bold text-emerald-900">Total In</td>
                  <td className="text-right p-2 font-bold text-emerald-900">{fmt2(twoColumn.inTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Money out */}
          <div className={`bg-white rounded-lg border ${t.border} overflow-hidden`}>
            <div className={`${t.header} ${t.text} text-xs font-bold uppercase tracking-wider px-3 py-2`}>Money Out</div>
            <table className="w-full text-sm premium-table">
              <tbody>
                {twoColumn.out.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="p-2 text-slate-900">{row.label}</td>
                    <td className="text-right p-2 font-semibold text-red-700">{formatAmount(row.amount)}</td>
                  </tr>
                ))}
                <tr className={`border-t-2 ${t.accent} bg-red-50/50`}>
                  <td className="p-2 font-bold text-red-900">Total Out</td>
                  <td className="text-right p-2 font-bold text-red-900">{fmt2(twoColumn.outTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`bg-white rounded-lg border ${t.border} overflow-hidden`}>
          <table className="w-full text-sm premium-table">
            <thead className={`${t.header} ${t.text} text-xs uppercase tracking-wider`}>
              <tr>
                <th className="text-left p-2 font-bold">Source</th>
                <th className="text-left p-2 font-bold">Where it comes from</th>
                <th className="text-right p-2 font-bold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className={`p-2 ${row.bold ? 'font-bold' : 'font-semibold'} text-slate-900`}>{row.label}</td>
                  <td className="p-2 text-xs text-slate-600">{row.hint || '—'}</td>
                  <td className={`text-right p-2 ${row.bold ? 'font-bold' : 'font-semibold'} text-slate-900`}>
                    {row.amount < 0 ? <span className="text-red-700">{formatAmount(row.amount)}</span> : formatAmount(row.amount)}
                  </td>
                </tr>
              ))}
              {(total != null || totalDisplay) && (
                <tr className={`border-t-2 ${t.accent} bg-gradient-to-r ${t.totalRow}`}>
                  <td className={`p-2 font-bold ${t.totalText} text-base`} colSpan={2}>= {totalLabel}</td>
                  <td className={`text-right p-2 font-bold ${t.totalText} text-lg`}>
                    {totalDisplay ?? fmt2(total)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {formula && (
        <div className={`text-xs text-slate-700 bg-white/60 rounded-lg p-2 border ${t.border} font-mono`}>
          <span className="font-semibold not-italic">Formula: </span>{formula}
        </div>
      )}
      {excluded && (
        <div className={`text-xs text-slate-600 bg-white/60 rounded-lg p-2 border ${t.border}`}>
          <span className="font-semibold">Excluded:</span> {excluded}
        </div>
      )}
    </div>
  );
}
