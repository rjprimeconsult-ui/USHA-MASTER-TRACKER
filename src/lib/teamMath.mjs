/**
 * teamMath.mjs — pure aggregation for the Team Scoreboard. No I/O, no React.
 *
 * Input: members = [{ userId, name, email, bundle }] where bundle holds the
 * per-member stores fetched by /api/team/overview (leads, prospects,
 * prospectSettings, platformExpenses, businessExpenses, …). Arrays may be
 * missing — every reader is defensive.
 *
 * period = { from, to } — ISO YYYY-MM-DD inclusive (already resolved by
 * reports.mjs resolvePeriod; this module does NOT know about presets).
 *
 * Conventions mirrored from the existing app (do not diverge):
 *  - premium/AV/advance + closedDate period filtering: reports.mjs
 *    (buildLeadsSoldReport) — issued deals filtered by closedDate in range,
 *    premium = leadPremium(lead), AV = premium × 12, advance = dealValue.
 *  - closeRate: Dashboard.jsx — issued / (issued + Declined/Not taken/
 *    Withdrawn), here period-filtered for scoreboard consistency.
 *  - accountability: followupStats.computeFollowupStats (dueStatus engine).
 *  - leadSpend: period leads' leadCost + platform_expenses_v1 rows
 *    ({date, amount}) in period + business_expenses_v1 rows whose category
 *    starts with PLATFORM_ in period (the two expense stores are separate;
 *    no double count).
 */

import { leadPremium } from './reports.mjs';
import { computeFollowupStats } from './followupStats.mjs';

// Lead outcome stages (stable app-wide; mirrored from constants.js STAGES —
// not imported to keep this module's import graph pure-.mjs for node:test).
const LOST_LEAD_STAGES = ['Declined', 'Not taken', 'Withdrawn'];

// Fallback prospect stages when a member has no custom prospect settings.
// Mirrors DEFAULT_PROSPECT_STAGES in constants.js (ids/labels/colors stable).
const FALLBACK_PROSPECT_STAGES = [
  { id: 'WEBBY_SET',        label: 'Webby Set',        color: '#0ea5e9' },
  { id: 'WEBBY_CONFIRMED',  label: 'Webby Confirmed',  color: '#fb923c' },
  { id: 'APPOINTMENT_SET',  label: 'Appointment Set',  color: '#3b82f6' },
  { id: 'MISSED_APPT',      label: 'Missed Appt',      color: '#f97316' },
  { id: 'PENDING_DECISION', label: 'Pending Decision', color: '#facc15' },
  { id: 'FOLLOWUP_LATER',   label: 'Follow-up Later',  color: '#a855f7' },
  { id: 'GHOSTED',          label: 'Ghosted',          color: '#9ca3af' },
  { id: 'SOLD',             label: 'Sold',             color: '#10b981' },
  { id: 'LOST',             label: 'Lost',             color: '#ef4444' },
];

const arr = (v) => (Array.isArray(v) ? v : []);

// Inclusive YYYY-MM-DD range check on a date-ish string (mirrors reports.mjs).
function inPeriod(dateStr, period) {
  const d = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= period.from && d <= period.to;
}

/** Per-member production + financial numbers for the period. */
export function memberStats(member, period, now = new Date()) {
  const b = member?.bundle || {};
  const leads = arr(b.leads);
  const prospects = arr(b.prospects).filter(p => p && !p.archivedAt);

  const periodLeads = leads.filter(l => l && inPeriod(l.closedDate, period));
  const issued = periodLeads.filter(l => l.stage === 'Issued');
  const lost = periodLeads.filter(l => LOST_LEAD_STAGES.includes(l.stage));

  const premium = issued.reduce((s, l) => s + leadPremium(l), 0);
  const advance = issued.reduce((s, l) => s + (Number(l.dealValue) || 0), 0);

  const leadCost = periodLeads.reduce((s, l) => s + (Number(l.leadCost) || 0), 0);
  const platformSpend = arr(b.platformExpenses)
    .filter(e => e && inPeriod(e.date, period))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const bizPlatformSpend = arr(b.businessExpenses)
    .filter(e => e && String(e.category || '').startsWith('PLATFORM_') && inPeriod(e.date, period))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const leadSpend = leadCost + platformSpend + bizPlatformSpend;

  const denom = issued.length + lost.length;
  const closeRate = denom > 0 ? (issued.length / denom) * 100 : null;
  const cpa = issued.length > 0 ? leadSpend / issued.length : null;
  const roi = leadSpend > 0 ? advance / leadSpend : null;

  const fu = computeFollowupStats(prospects, now);
  const touchesInPeriod = prospects.reduce((s, p) =>
    s + arr(p.touchLog).filter(t => t && inPeriod(t.at, period)).length, 0);
  const nowIso = now.toISOString();
  const apptsUpcoming = prospects.filter(p => p.appointmentTime && String(p.appointmentTime) > nowIso).length;

  return {
    userId: member.userId,
    name: member.name,
    dealsIssued: issued.length,
    premium,
    av: premium * 12,
    advance,
    leadSpend,
    cpa,
    roi,
    closeRate,
    prospectsActive: prospects.length,
    touchesInPeriod,
    onTimePct: fu.onTimeRate === null ? null : fu.onTimeRate * 100,
    overdueCount: fu.overdueCount,
    apptsUpcoming,
  };
}

/** Aggregate prospect-stage funnel across members (stage id-merged). */
export function teamFunnel(members) {
  const byId = new Map();
  for (const m of members) {
    const b = m?.bundle || {};
    const stages = arr(b.prospectSettings?.stages).length
      ? b.prospectSettings.stages
      : FALLBACK_PROSPECT_STAGES;
    for (const s of stages) {
      if (s?.id && !byId.has(s.id)) byId.set(s.id, { id: s.id, label: s.label || s.id, color: s.color || '#64748b', count: 0 });
    }
    for (const p of arr(b.prospects)) {
      if (!p || p.archivedAt) continue;
      if (!byId.has(p.stage)) byId.set(p.stage, { id: p.stage, label: p.stage, color: '#64748b', count: 0 });
      byId.get(p.stage).count++;
    }
  }
  return [...byId.values()];
}

/** Aggregate lead-stage counts (period-filtered). */
export function teamLeadFunnel(members, period) {
  const counts = {};
  for (const m of members) {
    for (const l of arr(m?.bundle?.leads)) {
      if (!l || !inPeriod(l.closedDate, period)) continue;
      counts[l.stage] = (counts[l.stage] || 0) + 1;
    }
  }
  return Object.entries(counts).map(([id, count]) => ({ id, count }));
}

/**
 * The full scoreboard view-model. The single function TeamView consumes.
 */
export function buildTeamScoreboard(members, period, now = new Date()) {
  const rows = (members || []).map(m => memberStats(m, period, now));

  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const dealsIssued = sum('dealsIssued');
  const advance = sum('advance');
  const leadSpend = sum('leadSpend');
  const withCloseRate = rows.filter(r => r.closeRate !== null);

  const kpis = {
    members: rows.length,
    dealsIssued,
    premium: sum('premium'),
    av: sum('av'),
    advance,
    leadSpend,
    cpa: dealsIssued > 0 ? leadSpend / dealsIssued : null,
    roi: leadSpend > 0 ? advance / leadSpend : null,
    closeRate: withCloseRate.length
      ? withCloseRate.reduce((s, r) => s + r.closeRate, 0) / withCloseRate.length
      : null,
  };

  // Financial flags — simple, explainable v1 rules (spec §4.1).
  const cpas = rows.filter(r => r.cpa !== null).map(r => r.cpa);
  const avgCpa = cpas.length ? cpas.reduce((a, b) => a + b, 0) / cpas.length : null;
  const flags = [];
  for (const r of rows) {
    if (r.roi !== null && r.roi < 2) flags.push({ userId: r.userId, name: r.name, flag: 'ROI below 2x' });
    if (r.dealsIssued === 0 && r.leadSpend > 0) flags.push({ userId: r.userId, name: r.name, flag: 'Lead spend with no production this period' });
    if (avgCpa !== null && cpas.length >= 2 && r.cpa !== null && r.cpa > 1.25 * avgCpa) {
      flags.push({ userId: r.userId, name: r.name, flag: 'CPA above team average' });
    }
  }

  return {
    kpis,
    leaderboard: [...rows].sort((a, b) => b.advance - a.advance),
    funnel: teamFunnel(members || []),
    leadFunnel: teamLeadFunnel(members || [], period),
    accountability: rows.map(r => ({
      userId: r.userId, name: r.name,
      onTimePct: r.onTimePct, overdueCount: r.overdueCount,
      touchesInPeriod: r.touchesInPeriod, apptsUpcoming: r.apptsUpcoming,
    })),
    financial: {
      teamLeadSpend: leadSpend,
      teamAdvance: advance,
      teamProfit: advance - leadSpend,
      flags,
    },
  };
}
