import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamScoreboard, memberStats, teamFunnel, teamLeadFunnel, buildBranchRows } from './teamMath.mjs';

const PERIOD = { from: '2026-06-01', to: '2026-06-30' };
const NOW = new Date('2026-06-15T12:00:00Z');

// Builders
const lead = (over = {}) => ({
  stage: 'Issued', closedDate: '2026-06-10', dealValue: 1000, leadCost: 100,
  mainProductPremium: 400, products: [], ...over,
});
const member = (userId, bundle, name = userId) => ({ userId, name, email: `${userId}@x.com`, bundle });

// ---------- memberStats ----------

test('one member with known numbers computes exactly', () => {
  const m = member('A', {
    leads: [
      lead(),                                              // issued, in period
      lead({ dealValue: 500, leadCost: 50, mainProductPremium: 100 }),
      lead({ stage: 'Declined', dealValue: 0 }),           // lost, in period
      lead({ closedDate: '2026-05-20' }),                  // OUT of period
    ],
    prospects: [],
    platformExpenses: [{ date: '2026-06-05', amount: 200 }, { date: '2026-05-05', amount: 999 }],
    businessExpenses: [
      { date: '2026-06-06', amount: 60, category: 'PLATFORM_RINGY' },
      { date: '2026-06-06', amount: 500, category: 'OFFICE_RENT' },   // not platform
    ],
  });
  const s = memberStats(m, PERIOD, NOW);
  assert.equal(s.dealsIssued, 2);
  assert.equal(s.premium, 500);            // 400 + 100
  assert.equal(s.av, 6000);                // 500 × 12
  assert.equal(s.advance, 1500);
  // leadSpend: leadCost in period (100+50+100 declined) + 200 platform + 60 PLATFORM_ biz
  assert.equal(s.leadSpend, 250 + 200 + 60);
  assert.equal(s.cpa, 510 / 2);
  assert.equal(Math.round(s.roi * 100) / 100, Math.round((1500 / 510) * 100) / 100);
  assert.equal(Math.round(s.closeRate), 67); // 2 of 3 decided
});

test('cpa/roi/closeRate are null-safe with no production or spend', () => {
  const s = memberStats(member('A', { leads: [] }), PERIOD, NOW);
  assert.equal(s.dealsIssued, 0);
  assert.equal(s.cpa, null);
  assert.equal(s.roi, null);
  assert.equal(s.closeRate, null);
});

test('missing bundle arrays never throw', () => {
  const s = memberStats(member('A', {}), PERIOD, NOW);
  assert.equal(s.advance, 0);
  assert.equal(s.prospectsActive, 0);
});

test('touchesInPeriod counts only in-period touches; archived prospects excluded', () => {
  const m = member('A', {
    prospects: [
      { stage: 'PENDING_DECISION', touchLog: [{ at: '2026-06-10T10:00:00Z' }, { at: '2026-04-01T10:00:00Z' }] },
      { stage: 'GHOSTED', archivedAt: '2026-06-01', touchLog: [{ at: '2026-06-11T10:00:00Z' }] },
    ],
  });
  const s = memberStats(m, PERIOD, NOW);
  assert.equal(s.touchesInPeriod, 1);
});

test('apptsUpcoming counts only future appointments', () => {
  const m = member('A', {
    prospects: [
      { stage: 'APPOINTMENT_SET', appointmentTime: '2026-06-20T15:00' },
      { stage: 'APPOINTMENT_SET', appointmentTime: '2026-06-01T15:00' }, // past
    ],
  });
  assert.equal(memberStats(m, PERIOD, NOW).apptsUpcoming, 1);
});

// ---------- aggregation ----------

test('team KPIs sum across members', () => {
  const sb = buildTeamScoreboard([
    member('A', { leads: [lead()] }),
    member('B', { leads: [lead({ dealValue: 2000, leadCost: 300 })] }),
  ], PERIOD, NOW);
  assert.equal(sb.kpis.members, 2);
  assert.equal(sb.kpis.dealsIssued, 2);
  assert.equal(sb.kpis.advance, 3000);
  assert.equal(sb.kpis.leadSpend, 400);
  assert.equal(sb.kpis.cpa, 200);
  assert.equal(sb.kpis.roi, 7.5);
});

test('empty team produces a clean zero scoreboard (no crash)', () => {
  const sb = buildTeamScoreboard([], PERIOD, NOW);
  assert.equal(sb.kpis.members, 0);
  assert.equal(sb.kpis.cpa, null);
  assert.deepEqual(sb.leaderboard, []);
  assert.deepEqual(sb.financial.flags, []);
});

test('leaderboard sorts by advance desc', () => {
  const sb = buildTeamScoreboard([
    member('LOW', { leads: [lead({ dealValue: 100 })] }),
    member('HIGH', { leads: [lead({ dealValue: 9000 })] }),
  ], PERIOD, NOW);
  assert.equal(sb.leaderboard[0].userId, 'HIGH');
});

// ---------- funnel ----------

test('prospect funnel merges stages across members and excludes archived', () => {
  const ms = [
    member('A', { prospects: [{ stage: 'PENDING_DECISION' }, { stage: 'SOLD' }] }),
    member('B', { prospects: [{ stage: 'PENDING_DECISION' }, { stage: 'GHOSTED', archivedAt: 'x' }] }),
  ];
  const funnel = teamFunnel(ms);
  const pending = funnel.find(f => f.id === 'PENDING_DECISION');
  assert.equal(pending.count, 2);
  const ghosted = funnel.find(f => f.id === 'GHOSTED');
  assert.equal(ghosted.count, 0); // archived excluded; stage row still present
});

test('unknown custom stage still lands in the funnel', () => {
  const funnel = teamFunnel([member('A', { prospects: [{ stage: 'MY_CUSTOM' }] })]);
  assert.equal(funnel.find(f => f.id === 'MY_CUSTOM').count, 1);
});

test('lead funnel is period-filtered', () => {
  const lf = teamLeadFunnel([
    member('A', { leads: [lead(), lead({ stage: 'Pending' }), lead({ closedDate: '2025-01-01' })] }),
  ], PERIOD);
  assert.equal(lf.find(x => x.id === 'Issued').count, 1);
  assert.equal(lf.find(x => x.id === 'Pending').count, 1);
});

// ---------- financial flags ----------

test('flag: ROI below 2x fires and does not fire', () => {
  const sb = buildTeamScoreboard([
    member('BAD', { leads: [lead({ dealValue: 150, leadCost: 100 })] }),   // roi 1.5
    member('GOOD', { leads: [lead({ dealValue: 900, leadCost: 100 })] }),  // roi 9
  ], PERIOD, NOW);
  const flags = sb.financial.flags.map(f => `${f.userId}:${f.flag}`);
  assert.ok(flags.includes('BAD:ROI below 2x'));
  assert.ok(!flags.includes('GOOD:ROI below 2x'));
});

test('flag: lead spend with no production', () => {
  const sb = buildTeamScoreboard([
    member('SPENDER', { leads: [lead({ stage: 'Pending', leadCost: 400, dealValue: 0 })] }),
  ], PERIOD, NOW);
  assert.ok(sb.financial.flags.some(f => f.userId === 'SPENDER' && /no production/i.test(f.flag)));
});

test('flag: CPA above team average needs ≥2 members with CPA', () => {
  const solo = buildTeamScoreboard([member('A', { leads: [lead({ leadCost: 900 })] })], PERIOD, NOW);
  assert.ok(!solo.financial.flags.some(f => /CPA above/i.test(f.flag)));

  const duo = buildTeamScoreboard([
    member('CHEAP', { leads: [lead({ leadCost: 100, dealValue: 1000 })] }),
    member('PRICEY', { leads: [lead({ leadCost: 1000, dealValue: 5000 })] }),
  ], PERIOD, NOW);
  assert.ok(duo.financial.flags.some(f => f.userId === 'PRICEY' && /CPA above/i.test(f.flag)));
});

test('financial totals: profit = advance − leadSpend', () => {
  const sb = buildTeamScoreboard([member('A', { leads: [lead()] })], PERIOD, NOW);
  assert.equal(sb.financial.teamProfit, 1000 - 100);
});

// ---------- buildBranchRows (tree-first leaderboard) ----------
// The exact scenario from Juan: FSL Alexis → FTA Gustavo → Agent Denzel.

const ORG_LINKS = [
  { uplineId: 'ALEXIS', downlineId: 'GUSTAVO' },
  { uplineId: 'GUSTAVO', downlineId: 'DENZEL' },
];
const ORG_MEMBERS = [
  member('GUSTAVO', { leads: [lead({ dealValue: 1000, leadCost: 100 })] }, 'Gustavo Villa'),
  member('DENZEL',  { leads: [lead({ dealValue: 500, leadCost: 50 })] }, 'Denzel'),
];

test('Alexis sees ONE row for Gustavo with branch totals (Gustavo + Denzel combined)', () => {
  const rows = buildBranchRows(ORG_MEMBERS, ORG_LINKS, 'ALEXIS', PERIOD, NOW);
  assert.equal(rows.length, 1);                  // one direct report → one row
  const g = rows[0];
  assert.equal(g.userId, 'GUSTAVO');
  assert.equal(g.name, 'Gustavo Villa');
  assert.equal(g.teamSize, 2);                   // Gustavo + Denzel
  assert.equal(g.dealsIssued, 2);                // both deals roll up
  assert.equal(g.advance, 1500);                 // 1000 + 500
  assert.equal(g.leadSpend, 150);                // 100 + 50
});

test('Gustavo (as viewer) sees Denzel as a leaf row (teamSize 1, own numbers only)', () => {
  const rows = buildBranchRows(ORG_MEMBERS, ORG_LINKS, 'GUSTAVO', PERIOD, NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, 'DENZEL');
  assert.equal(rows[0].teamSize, 1);
  assert.equal(rows[0].advance, 500);
});

test('branch rows: multiple direct reports each get their own branch totals', () => {
  const links = [...ORG_LINKS, { uplineId: 'ALEXIS', downlineId: 'SOLO' }];
  const ms = [...ORG_MEMBERS, member('SOLO', { leads: [lead({ dealValue: 200, leadCost: 20 })] }, 'Solo Agent')];
  const rows = buildBranchRows(ms, links, 'ALEXIS', PERIOD, NOW);
  assert.equal(rows.length, 2);
  const solo = rows.find(r => r.userId === 'SOLO');
  assert.equal(solo.teamSize, 1);
  assert.equal(solo.advance, 200);
  const g = rows.find(r => r.userId === 'GUSTAVO');
  assert.equal(g.advance, 1500); // unaffected by the sibling branch
});

test('branch rows: member bundle missing from members[] is skipped, not crashed', () => {
  const rows = buildBranchRows([ORG_MEMBERS[0]], ORG_LINKS, 'ALEXIS', PERIOD, NOW);
  assert.equal(rows[0].teamSize, 1);   // Denzel's bundle absent → branch counts what it has
  assert.equal(rows[0].advance, 1000);
});

test('branch rows: empty org yields empty rows', () => {
  assert.deepEqual(buildBranchRows([], [], 'NOBODY', PERIOD, NOW), []);
});
