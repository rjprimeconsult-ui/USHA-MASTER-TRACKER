# Prospect Follow-up System — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the follow-up **analytics scorecard** — the numbers agents can't see themselves: on-time %, connect rate, touches-to-appointment, outcomes breakdown, and per-stage stall points. A full panel on the Prospects view + a compact summary tile on the CPA Dashboard.

**Architecture:** All math in a new pure `src/lib/followupStats.mjs` (imports `dueStatus` from the existing engine; `node:test` covered). A presentational `FollowupScorecard.jsx` renders the full panel; a tiny inline tile is added to `CpaDashboard`. Read-only — no storage writes.

**Tech Stack:** Next.js 16 / React 19, Tailwind, lucide-react, `node:test`. Spec: `docs/superpowers/specs/2026-06-03-prospect-followup-system-design.md` (§6). Builds on Phases 1 & 2 (merged).

**Metric definitions (locked for v1, all-time):**
- **On-time %** — snapshot: of prospects with an *active* cadence (has a `nextDueAt`, not completed, stage not SOLD/LOST), the share whose `dueStatus` is NOT `overdue` (snoozed counts as handled/on-time). `null` when there are no active cadences.
- **Connect rate** — connects ÷ attempts, where a connect = a touch with outcome `Connected` or `Booked appt`; attempts = all logged touches.
- **Avg touches-to-appointment** — for prospects with at least one `Booked appt` touch, the count of touches up to and including the first `Booked appt`, averaged. `null` when none.
- **Outcomes breakdown** — count per outcome across all touches.
- **By stage** — per stage: prospect count, overdue count, total touches (reveals stalls).

---

## File Structure

**Create:**
- `src/lib/followupStats.mjs` — `computeFollowupStats(prospects, now)`.
- `src/lib/followupStats.test.mjs` — tests.
- `src/components/FollowupScorecard.jsx` — the full panel (collapsible).

**Modify:**
- `src/components/views/ProspectsView.jsx` — mount `<FollowupScorecard>` (collapsed by default) under the top widgets.
- `src/components/views/CpaDashboard.jsx` — a compact "Follow-up" summary tile (on-time % + connect rate + touches).

---

## Task 1: Stats library

**Files:**
- Create: `src/lib/followupStats.mjs`
- Test: `src/lib/followupStats.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// src/lib/followupStats.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowupStats } from './followupStats.mjs';

const t = (at, outcome, channel = 'Call') => ({ id: at, at, channel, outcome, note: '' });

// helper to build a prospect
const P = (stage, cadence, touches = []) => ({ id: Math.random().toString(36).slice(2), stage, cadence, touchLog: touches });

const NOW = '2026-06-10T12:00:00.000Z';
const cad = (nextDueAt, completedAt = null, snoozedUntil = null) => ({ stepIndex: 0, nextDueAt, snoozedUntil, completedAt });

test('empty input → safe zeros / nulls', () => {
  const s = computeFollowupStats([], NOW);
  assert.equal(s.totalTouches, 0);
  assert.equal(s.connectRate, 0);
  assert.equal(s.onTimeRate, null);
  assert.equal(s.avgTouchesToAppt, null);
  assert.equal(s.activeCount, 0);
  assert.equal(s.overdueCount, 0);
  assert.deepEqual(s.byOutcome, {});
  assert.deepEqual(s.byStage, []);
});

test('totalTouches + byOutcome + connectRate', () => {
  const ps = [
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-01T10:00:00.000Z', 'No answer'), t('2026-06-02T10:00:00.000Z', 'Connected')]),
    P('PENDING_DECISION', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-03T10:00:00.000Z', 'Booked appt')]),
  ];
  const s = computeFollowupStats(ps, NOW);
  assert.equal(s.totalTouches, 3);
  assert.deepEqual(s.byOutcome, { 'No answer': 1, 'Connected': 1, 'Booked appt': 1 });
  // connects = Connected + Booked appt = 2; attempts = 3
  assert.equal(Math.round(s.connectRate * 100), 67);
});

test('onTimeRate: active = has nextDueAt & not completed & not terminal; overdue lowers it', () => {
  const ps = [
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z')),       // ontrack (future) → active, on-time
    P('PENDING_DECISION', cad('2026-06-05T12:00:00.000Z')), // overdue → active, not on-time
    P('FOLLOWUP_LATER', cad('2026-06-20T12:00:00.000Z', null, '2026-06-30T12:00:00.000Z')), // snoozed → active, on-time
    P('SOLD', cad(null)),                                 // terminal → not active
    P('WEBBY_SET', cad(null)),                            // no cadence → not active
  ];
  const s = computeFollowupStats(ps, NOW);
  assert.equal(s.activeCount, 3);
  assert.equal(s.overdueCount, 1);
  // on-time = (3 active - 1 overdue) / 3 = 0.666...
  assert.equal(Math.round(s.onTimeRate * 100), 67);
});

test('avgTouchesToAppt: touches up to & incl first Booked appt, averaged over prospects that booked', () => {
  const ps = [
    // booked on 3rd touch
    P('APPOINTMENT_SET', cad(null), [t('2026-06-01T10:00:00.000Z', 'No answer'), t('2026-06-02T10:00:00.000Z', 'No answer'), t('2026-06-03T10:00:00.000Z', 'Booked appt'), t('2026-06-04T10:00:00.000Z', 'Connected')]),
    // booked on 1st touch
    P('APPOINTMENT_SET', cad(null), [t('2026-06-01T10:00:00.000Z', 'Booked appt')]),
    // never booked → excluded
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-01T10:00:00.000Z', 'No answer')]),
  ];
  const s = computeFollowupStats(ps, NOW);
  // (3 + 1) / 2 = 2
  assert.equal(s.avgTouchesToAppt, 2);
});

test('byStage: count, overdue, touches per stage; excludes archived', () => {
  const ps = [
    P('GHOSTED', cad('2026-06-05T12:00:00.000Z'), [t('2026-06-01T10:00:00.000Z', 'No answer')]), // overdue
    P('GHOSTED', cad('2026-06-20T12:00:00.000Z'), [t('2026-06-02T10:00:00.000Z', 'Connected')]), // ontrack
    { ...P('GHOSTED', cad('2026-06-05T12:00:00.000Z')), archivedAt: '2026-06-01T00:00:00.000Z' }, // archived → excluded
  ];
  const s = computeFollowupStats(ps, NOW);
  const g = s.byStage.find(x => x.stage === 'GHOSTED');
  assert.equal(g.count, 2);
  assert.equal(g.overdue, 1);
  assert.equal(g.touches, 2);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd /c/dev/usha-master-tracker && node --test src/lib/followupStats.test.mjs`.

- [ ] **Step 3: Implement**

```js
// src/lib/followupStats.mjs
/**
 * Follow-up analytics — pure, read-only derivation for the scorecard.
 * Imports dueStatus from the engine to classify active/overdue.
 *
 * All-time stats over a prospect list. See plan for metric definitions.
 */
import { dueStatus } from './followupEngine.mjs';

const CONNECT_OUTCOMES = new Set(['Connected', 'Booked appt']);
const TERMINAL = new Set(['SOLD', 'LOST']);

export function computeFollowupStats(prospects, now) {
  const list = (prospects || []).filter(p => !p.archivedAt);

  let totalTouches = 0;
  let connects = 0;
  const byOutcome = {};

  let activeCount = 0;
  let overdueCount = 0;

  const apptTouchCounts = [];
  const stageMap = {}; // stage -> { count, overdue, touches }

  for (const p of list) {
    const touches = Array.isArray(p.touchLog) ? p.touchLog : [];
    totalTouches += touches.length;

    let firstApptIdx = -1;
    touches.forEach((t, i) => {
      if (t.outcome) byOutcome[t.outcome] = (byOutcome[t.outcome] || 0) + 1;
      if (CONNECT_OUTCOMES.has(t.outcome)) connects++;
      if (firstApptIdx === -1 && t.outcome === 'Booked appt') firstApptIdx = i;
    });
    if (firstApptIdx !== -1) apptTouchCounts.push(firstApptIdx + 1);

    // active / overdue (snapshot via dueStatus)
    const s = dueStatus(p, now);
    const isActive = !TERMINAL.has(p.stage) && (s.state === 'ontrack' || s.state === 'due_today' || s.state === 'overdue' || s.state === 'snoozed');
    if (isActive) {
      activeCount++;
      if (s.state === 'overdue') overdueCount++;
    }

    // by stage
    if (!stageMap[p.stage]) stageMap[p.stage] = { stage: p.stage, count: 0, overdue: 0, touches: 0 };
    stageMap[p.stage].count++;
    stageMap[p.stage].touches += touches.length;
    if (s.state === 'overdue') stageMap[p.stage].overdue++;
  }

  const attempts = totalTouches;
  const connectRate = attempts > 0 ? connects / attempts : 0;
  const onTimeRate = activeCount > 0 ? (activeCount - overdueCount) / activeCount : null;
  const avgTouchesToAppt = apptTouchCounts.length > 0
    ? apptTouchCounts.reduce((a, b) => a + b, 0) / apptTouchCounts.length
    : null;

  const byStage = Object.values(stageMap).sort((a, b) => b.overdue - a.overdue || b.count - a.count);

  return {
    totalTouches,
    connects,
    connectRate,
    byOutcome,
    activeCount,
    overdueCount,
    onTimeRate,
    avgTouchesToAppt,
    byStage,
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `cd /c/dev/usha-master-tracker && node --test src/lib/followupStats.test.mjs`.

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/lib/followupStats.mjs src/lib/followupStats.test.mjs && git commit -m "feat(followup): analytics stats lib + tests"
```

---

## Task 2: FollowupScorecard component

**Files:**
- Create: `src/components/FollowupScorecard.jsx`

- [ ] **Step 1: Implement**

```jsx
'use client';
/**
 * Follow-up performance scorecard. Collapsible panel (matches the top-of-page
 * widget pattern). Read-only analytics from computeFollowupStats.
 *
 * Props: { prospects, stages } — stages is the configured stage list
 * (id + label) for resolving the by-stage table labels.
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
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
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
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi Icon={Target} label="On-time follow-up" value={pct(stats.onTimeRate)} valueClass={onTimeColor} sub={`${stats.overdueCount} overdue / ${stats.activeCount} active`} />
            <Kpi Icon={PhoneCall} label="Connect rate" value={pct(stats.connectRate)} sub={`${stats.connects} of ${stats.totalTouches} touches`} />
            <Kpi Icon={CalendarCheck} label="Touches to appt" value={num1(stats.avgTouchesToAppt)} sub="avg before booking" />
            <Kpi Icon={BarChart3} label="Total touches" value={String(stats.totalTouches)} sub="all-time logged" />
          </div>

          {/* Outcomes breakdown */}
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

          {/* By stage */}
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
```

- [ ] **Step 2: Build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 3: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/FollowupScorecard.jsx && git commit -m "feat(followup): FollowupScorecard panel component"
```

---

## Task 3: Mount the scorecard on ProspectsView

**Files:**
- Modify: `src/components/views/ProspectsView.jsx`

Reference: the top-widgets cluster — `<FollowupDueWidget .../>`, `<OutreachRemindersWidget title="Emails due" .../>`, `<CalendarPanel .../>` (search `FollowupDueWidget`). `cfg.stages` is the configured stage list (search `cfg.stages` / `stages={cfg.stages}`). `visible` / `prospects` arrays exist.

- [ ] **Step 1: Import**
```js
import FollowupScorecard from '@/components/FollowupScorecard';
```

- [ ] **Step 2: Mount it** right AFTER the `<CalendarPanel ... />` block (so the action widgets stay on top and the analytics sit just below them, collapsed by default):
```jsx
{prospects.length > 0 && (
  <FollowupScorecard prospects={prospects} stages={cfg.stages} />
)}
```
(Use `prospects` — the full list — for all-time stats, not the filtered `visible`. Confirm `cfg.stages` is the correct stages reference used elsewhere in this file; if the variable is named differently, use that.)

- [ ] **Step 3: Build + manual check** — `cd /c/dev/usha-master-tracker && npx --no-install next build`. Manual: a "Follow-up performance" collapsible panel appears under the calendar; expanding shows KPIs, outcomes bars, and the by-stage table.

- [ ] **Step 4: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/views/ProspectsView.jsx && git commit -m "feat(followup): mount performance scorecard on Prospects"
```

---

## Task 4: CPA Dashboard summary tile

**Files:**
- Modify: `src/components/views/CpaDashboard.jsx`

Reference: the Activity Funnel card (search `Activity Funnel (all-time)`). `prospects` is already a prop.

- [ ] **Step 1: Import**
```js
import { computeFollowupStats } from '@/lib/followupStats.mjs';
```

- [ ] **Step 2: Compute stats** near the other `useMemo`s (e.g. just after `activityTotalsAll`):
```js
const followupStats = useMemo(
  () => computeFollowupStats(prospects, new Date().toISOString()),
  [prospects]
);
```

- [ ] **Step 3: Render a compact tile** directly BELOW the Activity Funnel card's content (inside the same funnel card, after the funnel rows + the "Log Activity" button, OR as its own small block right after the funnel card — pick whichever keeps JSX valid; prefer adding right after the funnel card's closing tag). Add this block:
```jsx
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
```
Place it so it sits near the Activity Funnel card in the dashboard layout (right after that card). Ensure the surrounding JSX (grid/flex container) still has valid structure — if the funnel card is inside a grid column, add this tile in the same column right after it.

- [ ] **Step 4: Build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/views/CpaDashboard.jsx && git commit -m "feat(followup): follow-up performance tile on CPA Dashboard"
```

---

## Task 5: Verify, merge, announce

- [ ] **Step 1: Full lib tests**
`cd /c/dev/usha-master-tracker && node --test src/lib/followupStats.test.mjs src/lib/followupEngine.test.mjs src/lib/followupRollup.test.mjs src/lib/paymentAlerts.test.mjs src/lib/reports.test.mjs src/lib/leadDedup.test.mjs src/lib/mergeStore.test.mjs src/lib/duplicateResolver.test.mjs`
Expected: all PASS.

- [ ] **Step 2: Full build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 3: Final review** (controller dispatches a code reviewer over `main..HEAD`).

- [ ] **Step 4: Merge to main + push** (per finishing-a-development-branch; user chooses).

- [ ] **Step 5: Announce (standing rule — BOTH):**
  - Add an entry to the TOP of `ANNOUNCEMENTS` in `src/lib/announcements.js` (id `2026-06-03-followup-analytics`, emoji 📊, title e.g. "See your follow-up game", body covering on-time %, connect rate, touches-to-appt, by-stage, cta Open Prospects). Commit (untagged).
  - Push an `[announce]`-tagged empty commit for Slack.

---

## Self-Review notes (addressed)
- **Spec §6 coverage:** on-time % (Task 1), connect rate, touches-to-appt, outcomes breakdown, by-stage (Task 1); full panel on Prospects (Tasks 2-3); dashboard summary tile (Task 4). ✓
- **Read-only:** stats never write storage; both surfaces compute live from `prospects`. ✓
- **Type consistency:** `computeFollowupStats` returns one object shape used by both `FollowupScorecard` and the dashboard tile (`onTimeRate`, `connectRate`, `avgTouchesToAppt`, `totalTouches`, `connects`, `overdueCount`, `activeCount`, `byOutcome`, `byStage`). ✓
- **Edge cases:** empty input → zeros/nulls tested; on-time `null` when no active cadences; avg `null` when no bookings; UI renders `—` for nulls. ✓
- **Stages label resolution:** scorecard receives `cfg.stages`; dashboard tile shows aggregates only (no stage labels needed). ✓
