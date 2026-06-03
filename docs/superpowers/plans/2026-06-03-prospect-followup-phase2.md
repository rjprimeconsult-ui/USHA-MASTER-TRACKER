# Prospect Follow-up System — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Layer "smart" behavior onto the Phase 1 follow-up loop: outcome→stage suggestions after logging a touch, a snooze control, breakup prompts at cadence end, and rolling logged touches into the dashboard Activity Funnel (non-destructively).

**Architecture:** New pure logic added to `src/lib/followupEngine.mjs` (suggestions) and a new pure `src/lib/followupRollup.mjs` (funnel derivation), both `node:test` covered. The suggestion surfaces as a non-blocking chip in the prospect detail bubble; accepting it changes the stage (which re-arms the cadence via the existing `applyProspectUpdate`). The funnel rollup is a **display-only merge** computed in `CpaDashboard` from `prospects` + `activities` — it NEVER writes to `activities_v1`.

**Tech Stack:** Next.js 16 / React 19, Tailwind, lucide-react, `node:test`. Spec: `docs/superpowers/specs/2026-06-03-prospect-followup-system-design.md` (§5). Builds on Phase 1 (merged).

**Guard rule for the funnel rollup (important):** manual activity entries are the source of truth. Follow-up-derived counts only fill days that have NO manual activity entry. This prevents double-counting and never overwrites a number the agent typed. Read-only: storage is untouched.

---

## File Structure

**Create:**
- `src/lib/followupRollup.mjs` — `followupDailyActivity(prospects)` → `{ 'YYYY-MM-DD': { dials, appointments } }`; `mergeFunnelTotals(activities, prospects)` → `{ dials, appts, pitches, closes }` with manual-day-wins guard.
- `src/lib/followupRollup.test.mjs` — tests.

**Modify:**
- `src/lib/followupEngine.mjs` — add `consecutiveNoAnswer(prospect)` and `suggestStageAfterTouch(prospectAfterLog, lastTouch, playbook)`.
- `src/lib/followupEngine.test.mjs` — add tests for the two new functions.
- `src/components/LeadTracker.jsx` — `logProspectTouch` returns the richer suggestion; add `applyStageSuggestion(prospectId, stage)` (reuses `applyProspectUpdate`).
- `src/components/FollowupNextStep.jsx` — add a Snooze control (3d / 7d).
- `src/components/views/ProspectsView.jsx` — capture the suggestion after save, show a non-blocking chip with Accept/Dismiss; pass `onSnooze` to the next-step card; pass `applyStageSuggestion`.
- `src/components/views/CpaDashboard.jsx` — funnel totals use `mergeFunnelTotals(activities, prospects)`; add a one-line caption noting follow-up touches are included.

---

## Task 1: Engine — `consecutiveNoAnswer` + `suggestStageAfterTouch`

**Files:**
- Modify: `src/lib/followupEngine.mjs`
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write failing tests** (append to `followupEngine.test.mjs`; add the two names to the existing import line)

```js
import { consecutiveNoAnswer, suggestStageAfterTouch } from './followupEngine.mjs';

const withTouches = (stage, outcomes) => ({
  id: 'z', stage,
  touchLog: outcomes.map((o, i) => ({ id: 't' + i, at: `2026-06-0${i + 1}T12:00:00.000Z`, channel: 'Call', outcome: o, note: '' })),
  cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
});

test('consecutiveNoAnswer counts trailing No answer / Left VM touches', () => {
  assert.equal(consecutiveNoAnswer(withTouches('GHOSTED', ['Connected', 'No answer', 'No answer'])), 2);
  assert.equal(consecutiveNoAnswer(withTouches('GHOSTED', ['No answer', 'No answer', 'No answer'])), 3);
  assert.equal(consecutiveNoAnswer(withTouches('GHOSTED', ['No answer', 'Connected'])), 0);
  assert.equal(consecutiveNoAnswer({ touchLog: [] }), 0);
});

test('suggestStageAfterTouch: Booked appt -> APPOINTMENT_SET', () => {
  const p = withTouches('PENDING_DECISION', ['Booked appt']);
  const r = suggestStageAfterTouch(p, { outcome: 'Booked appt' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'APPOINTMENT_SET');
  assert.ok(/appoint/i.test(r.reason));
});

test('suggestStageAfterTouch: Not interested -> LOST', () => {
  const p = withTouches('PENDING_DECISION', ['Not interested']);
  const r = suggestStageAfterTouch(p, { outcome: 'Not interested' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'LOST');
});

test('suggestStageAfterTouch: 3rd consecutive No answer (not already Ghosted) -> GHOSTED', () => {
  const p = withTouches('PENDING_DECISION', ['No answer', 'No answer', 'No answer']);
  const r = suggestStageAfterTouch(p, { outcome: 'No answer' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'GHOSTED');
});

test('suggestStageAfterTouch: already Ghosted with 3 no-answers does NOT re-suggest Ghosted', () => {
  const p = withTouches('GHOSTED', ['No answer', 'No answer', 'No answer']);
  const r = suggestStageAfterTouch(p, { outcome: 'No answer' }, DEFAULT_PLAYBOOK);
  // not a Ghosted suggestion (may be null or a breakup suggestion if completed; here cadence not completed -> null)
  assert.equal(r, null);
});

test('suggestStageAfterTouch: cadence just completed -> playbook onComplete (breakup)', () => {
  const p = { id: 'b', stage: 'MISSED_APPT', touchLog: [{ id: 't', at: '2026-06-09T00:00:00.000Z', channel: 'Text', outcome: 'No answer', note: '' }], cadence: { stepIndex: 4, nextDueAt: null, snoozedUntil: null, completedAt: '2026-06-09T00:00:00.000Z' } };
  const r = suggestStageAfterTouch(p, { outcome: 'No answer' }, DEFAULT_PLAYBOOK);
  assert.equal(r.stage, 'GHOSTED'); // MISSED_APPT onComplete
});

test('suggestStageAfterTouch: no rule matches -> null', () => {
  const p = withTouches('PENDING_DECISION', ['Connected']);
  const r = suggestStageAfterTouch(p, { outcome: 'Connected' }, DEFAULT_PLAYBOOK);
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd /c/dev/usha-master-tracker && node --test src/lib/followupEngine.test.mjs` → `consecutiveNoAnswer is not a function`.

- [ ] **Step 3: Implement** (add to `followupEngine.mjs`)

```js
const NO_CONTACT_OUTCOMES = new Set(['No answer', 'Left VM']);

/** Count trailing consecutive no-contact touches (No answer / Left VM). */
export function consecutiveNoAnswer(prospect) {
  const log = Array.isArray(prospect?.touchLog) ? prospect.touchLog : [];
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (NO_CONTACT_OUTCOMES.has(log[i].outcome)) n++;
    else break;
  }
  return n;
}

/**
 * After a touch is logged, suggest a stage move (or null). Priority:
 *   1. Booked appt   -> APPOINTMENT_SET
 *   2. Not interested -> LOST
 *   3. 3+ consecutive no-contact touches (and not already GHOSTED) -> GHOSTED
 *   4. cadence just completed -> playbook onComplete (breakup)
 * `prospect` is the post-log prospect; `lastTouch` is the touch just logged.
 * Never suggests the prospect's current stage.
 */
export function suggestStageAfterTouch(prospect, lastTouch, playbook) {
  const cur = prospect?.stage;
  const mk = (stage, reason) => (stage && stage !== cur ? { stage, reason } : null);

  if (lastTouch?.outcome === 'Booked appt') return mk('APPOINTMENT_SET', 'They booked — move to Appointment Set?');
  if (lastTouch?.outcome === 'Not interested') return mk('LOST', 'Not interested — move to Lost?');

  if (cur !== 'GHOSTED' && consecutiveNoAnswer(prospect) >= 3) {
    return mk('GHOSTED', 'No contact 3 times in a row — consider Ghosted?');
  }

  if (prospect?.cadence?.completedAt) {
    const onComplete = playbook?.stages?.[cur]?.onComplete;
    return mk(onComplete, 'Follow-up sequence finished — move them along?');
  }
  return null;
}
```

- [ ] **Step 4: Run, expect PASS** — `cd /c/dev/usha-master-tracker && node --test src/lib/followupEngine.test.mjs`.

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs && git commit -m "feat(followup): suggestStageAfterTouch + consecutiveNoAnswer"
```

---

## Task 2: Rollup library — `followupDailyActivity` + `mergeFunnelTotals`

**Files:**
- Create: `src/lib/followupRollup.mjs`
- Test: `src/lib/followupRollup.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// src/lib/followupRollup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followupDailyActivity, mergeFunnelTotals } from './followupRollup.mjs';

const prospect = (touches) => ({ id: 'p', touchLog: touches });

test('followupDailyActivity: each attempt = 1 dial; Booked appt = 1 appointment', () => {
  const ps = [
    prospect([
      { at: '2026-06-01T10:00:00.000Z', channel: 'Call', outcome: 'No answer' },
      { at: '2026-06-01T14:00:00.000Z', channel: 'Text', outcome: 'Connected' },
      { at: '2026-06-02T09:00:00.000Z', channel: 'Call', outcome: 'Booked appt' },
    ]),
  ];
  const map = followupDailyActivity(ps);
  assert.deepEqual(map['2026-06-01'], { dials: 2, appointments: 0 });
  assert.deepEqual(map['2026-06-02'], { dials: 1, appointments: 1 });
});

test('mergeFunnelTotals: manual day wins; follow-up fills empty days', () => {
  const activities = [
    { date: '2026-06-01', dials: 20, appointments: 3, pitches: 2, closes: 1 },
  ];
  const ps = [
    prospect([
      { at: '2026-06-01T10:00:00.000Z', channel: 'Call', outcome: 'No answer' }, // ignored (manual day wins)
      { at: '2026-06-02T09:00:00.000Z', channel: 'Call', outcome: 'Booked appt' }, // counted (no manual entry 06-02)
    ]),
  ];
  const t = mergeFunnelTotals(activities, ps);
  // 06-01 from manual: 20 dials, 3 appts, 2 pitches, 1 close
  // 06-02 from follow-up: +1 dial, +1 appt
  assert.deepEqual(t, { dials: 21, appts: 4, pitches: 2, closes: 1 });
});

test('mergeFunnelTotals: no prospects = pure manual totals', () => {
  const activities = [{ date: '2026-06-01', dials: 5, appointments: 1, pitches: 1, closes: 0 }];
  assert.deepEqual(mergeFunnelTotals(activities, []), { dials: 5, appts: 1, pitches: 1, closes: 0 });
});

test('mergeFunnelTotals: empty everything = zeros', () => {
  assert.deepEqual(mergeFunnelTotals([], []), { dials: 0, appts: 0, pitches: 0, closes: 0 });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd /c/dev/usha-master-tracker && node --test src/lib/followupRollup.test.mjs`.

- [ ] **Step 3: Implement**

```js
// src/lib/followupRollup.mjs
/**
 * Non-destructive rollup of logged follow-up touches into the dashboard
 * Activity Funnel. NEVER writes storage — pure derivation for display.
 *
 * Guard: manual `activities_v1` entries are the source of truth. Follow-up
 * counts only fill days that have NO manual entry, so a day is never
 * double-counted and a typed-in number is never overwritten.
 *
 * Mapping: each logged touch (any channel) = 1 dial; a 'Booked appt'
 * outcome also = 1 appointment. Pitches/closes are NOT inferred.
 */

function dayKey(iso) { return new Date(iso).toISOString().slice(0, 10); }

/** Map of 'YYYY-MM-DD' -> { dials, appointments } derived from touch logs. */
export function followupDailyActivity(prospects) {
  const map = {};
  for (const p of prospects || []) {
    for (const t of (p.touchLog || [])) {
      if (!t.at) continue;
      const k = dayKey(t.at);
      if (!map[k]) map[k] = { dials: 0, appointments: 0 };
      map[k].dials += 1;
      if (t.outcome === 'Booked appt') map[k].appointments += 1;
    }
  }
  return map;
}

/**
 * Funnel totals merging manual activities with follow-up-derived activity.
 * Returns { dials, appts, pitches, closes }. Manual day wins.
 */
export function mergeFunnelTotals(activities, prospects) {
  const manualDays = new Set((activities || []).map(a => a.date));
  const totals = (activities || []).reduce((acc, x) => ({
    dials: acc.dials + (x.dials || 0),
    appts: acc.appts + (x.appointments || 0),
    pitches: acc.pitches + (x.pitches || 0),
    closes: acc.closes + (x.closes || 0),
  }), { dials: 0, appts: 0, pitches: 0, closes: 0 });

  const daily = followupDailyActivity(prospects);
  for (const [day, c] of Object.entries(daily)) {
    if (manualDays.has(day)) continue; // manual entry wins for that day
    totals.dials += c.dials;
    totals.appts += c.appointments;
  }
  return totals;
}
```

- [ ] **Step 4: Run, expect PASS** — `cd /c/dev/usha-master-tracker && node --test src/lib/followupRollup.test.mjs`.

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/lib/followupRollup.mjs src/lib/followupRollup.test.mjs && git commit -m "feat(followup): non-destructive funnel rollup lib"
```

---

## Task 3: LeadTracker — richer suggestion + apply-stage handler

**Files:**
- Modify: `src/components/LeadTracker.jsx`

- [ ] **Step 1: Extend the engine import** to include `suggestStageAfterTouch`:
Find the existing `from '@/lib/followupEngine.mjs'` import and add `suggestStageAfterTouch` to it.

- [ ] **Step 2: Make `logProspectTouch` return the richer suggestion.** Locate the existing `logProspectTouch` useCallback. Replace its body so it computes the suggestion from the post-log prospect using the engine (keep the `lastContact` sync and the `engineLogTouch` call):

```js
const logProspectTouch = useCallback((prospectId, touch) => {
  const now = new Date().toISOString();
  let suggestion = null;
  setProspects(prev => prev.map(p => {
    if (p.id !== prospectId) return p;
    const r = engineLogTouch(p, touch, followupPlaybook, now);
    suggestion = suggestStageAfterTouch(r.prospect, { ...touch }, followupPlaybook);
    return { ...r.prospect, lastContact: now.slice(0, 10) };
  }));
  return suggestion; // { stage, reason } | null
}, [followupPlaybook]);
```

- [ ] **Step 3: Add `applyStageSuggestion`** (reuses the existing `applyProspectUpdate`, which re-arms the cadence on stage change). Place it after `applyProspectUpdate`:

```js
const applyStageSuggestion = useCallback((prospectId, stage) => {
  setProspects(prev => prev.map(p => {
    if (p.id !== prospectId) return p;
    return armCadence({ ...p, stage }, followupPlaybook, new Date().toISOString());
  }));
}, [followupPlaybook]);
```

- [ ] **Step 4: Pass `onApplyStageSuggestion={applyStageSuggestion}`** to `<ProspectsView ... />` (keep existing props, including `onSnoozeProspect` already added in Phase 1).

- [ ] **Step 5: Build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 6: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/LeadTracker.jsx && git commit -m "feat(followup): richer touch suggestion + applyStageSuggestion handler"
```

---

## Task 4: FollowupNextStep — Snooze control

**Files:**
- Modify: `src/components/FollowupNextStep.jsx`

- [ ] **Step 1: Accept an `onSnooze` prop and render Snooze buttons.** Change the component signature to include `onSnooze`, and add a snooze row under the action buttons (only when not done and a due date exists). Add `Clock`/`BellOff` from lucide if needed (import `BellOff`).

Replace the action-buttons block (the `<div className="flex items-center gap-2 mt-2">...</div>` containing Copy + Log touch) so it is followed by a snooze row:

```jsx
      <div className="flex items-center gap-2 mt-2">
        <button onClick={copy} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy script'}
        </button>
        <button onClick={onLogTouch} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-sm font-bold">
          Log touch
        </button>
      </div>
      {onSnooze && (
        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
          <BellOff size={12} /> Snooze:
          <button onClick={() => onSnooze(3)} className="font-semibold text-slate-600 hover:text-slate-900 underline">3 days</button>
          <button onClick={() => onSnooze(7)} className="font-semibold text-slate-600 hover:text-slate-900 underline">1 week</button>
        </div>
      )}
```

Update the import line to include `BellOff`:
```js
import { Copy, Check, Clock, CheckCircle2, BellOff } from 'lucide-react';
```
And the signature:
```js
export default function FollowupNextStep({ prospect, playbook, agentName, onLogTouch, onSnooze, now = new Date().toISOString() }) {
```

- [ ] **Step 2: Build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 3: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/FollowupNextStep.jsx && git commit -m "feat(followup): snooze control on next-step card"
```

---

## Task 5: ProspectsView — suggestion chip + wire snooze

**Files:**
- Modify: `src/components/views/ProspectsView.jsx`

Reference: `ProspectDetail` signature (line ~896), the `logOpen` state, the `FollowupNextStep` render, the `LogTouchSheet` `onSave`, and `ProspectsView`'s prop destructuring + the `<ProspectDetail .../>` mount.

- [ ] **Step 1: Accept `onApplyStageSuggestion` in `ProspectsView` props** (next to `onLogTouch`, `onSnoozeProspect`). Thread `onApplyStageSuggestion` and `onSnoozeProspect` into `<ProspectDetail .../>` as `onApplyStageSuggestion` and `onSnooze`.

- [ ] **Step 2: Extend `ProspectDetail` signature** to include `onApplyStageSuggestion`, `onSnooze`. Add suggestion state:
```js
const [suggestion, setSuggestion] = useState(null); // { stage, reason } | null
```

- [ ] **Step 3: Capture the suggestion on save.** Change the `LogTouchSheet` `onSave` to use the return value of `onLogTouch`:
```jsx
        onSave={(touch) => { const s = onLogTouch?.(prospect.id, touch); if (s) setSuggestion(s); }}
```

- [ ] **Step 4: Pass `onSnooze` to the next-step card:**
```jsx
  <FollowupNextStep
    prospect={prospect}
    playbook={playbook}
    agentName={agentName}
    onLogTouch={() => setLogOpen(true)}
    onSnooze={(days) => onSnooze?.(prospect.id, days)}
  />
```

- [ ] **Step 5: Render the suggestion chip** directly under the next-step card (inside the same `mb-3` wrapper area or right after it). Use the stage label from `settings.stages`:
```jsx
{suggestion && (
  <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 p-3 flex items-center gap-2">
    <Sparkles size={15} className="text-violet-600 flex-shrink-0" />
    <div className="flex-1 text-sm text-slate-700">{suggestion.reason}</div>
    <button
      onClick={() => { onApplyStageSuggestion?.(prospect.id, suggestion.stage); setSuggestion(null); onClose?.(); }}
      className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap">
      Move to {settings.stages.find(s => s.id === suggestion.stage)?.label || suggestion.stage}
    </button>
    <button onClick={() => setSuggestion(null)} className="text-slate-400 hover:text-slate-700 text-xs font-semibold px-2">Dismiss</button>
  </div>
)}
```
Ensure `Sparkles` is imported from lucide-react in this file (add if missing). After accepting, `onClose()` closes the detail so the kanban reflects the moved card; the parent state already updated.

- [ ] **Step 6: Build + manual check** — `cd /c/dev/usha-master-tracker && npx --no-install next build`. Manual: log a touch with "Booked appt" → violet chip "They booked — move to Appointment Set?" → clicking moves the card; Snooze 3 days hides the due nudge.

- [ ] **Step 7: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/views/ProspectsView.jsx && git commit -m "feat(followup): outcome->stage suggestion chip + snooze wiring in detail"
```

---

## Task 6: CpaDashboard — funnel rollup (display-only)

**Files:**
- Modify: `src/components/views/CpaDashboard.jsx` (the `activityTotalsAll` useMemo, ~line 344)

- [ ] **Step 1: Import the rollup:**
```js
import { mergeFunnelTotals } from '@/lib/followupRollup.mjs';
```

- [ ] **Step 2: Replace `activityTotalsAll`** to merge follow-up touches (component already receives `prospects`):
```js
const activityTotalsAll = useMemo(
  () => mergeFunnelTotals(activities, prospects),
  [activities, prospects]
);
```
(Delete the old reduce; `mergeFunnelTotals` returns the same `{ dials, appts, pitches, closes }` shape, so downstream `funnelMax`, `funnelRow`, and `activityTotals` are unchanged.)

- [ ] **Step 3: Add a one-line caption** under the "Activity Funnel (all-time)" heading so the number's source is clear. Find the funnel heading `<h3 ...>Activity Funnel (all-time)</h3>` and add right after it:
```jsx
<p className="text-[11px] text-slate-400 mb-2">Includes logged prospect follow-ups (days without a manual entry).</p>
```

- [ ] **Step 4: Build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/views/CpaDashboard.jsx && git commit -m "feat(followup): roll logged touches into the dashboard Activity Funnel (display-only, manual-wins)"
```

---

## Task 7: Verify, merge, announce

- [ ] **Step 1: Full lib tests**
`cd /c/dev/usha-master-tracker && node --test src/lib/followupEngine.test.mjs src/lib/followupRollup.test.mjs src/lib/paymentAlerts.test.mjs src/lib/reports.test.mjs src/lib/leadDedup.test.mjs src/lib/mergeStore.test.mjs src/lib/duplicateResolver.test.mjs`
Expected: all PASS.

- [ ] **Step 2: Full build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 3: Final review** (controller dispatches a code reviewer over `main..HEAD`).

- [ ] **Step 4: Merge to main** (per finishing-a-development-branch, user chooses) and push.

- [ ] **Step 5: Announce (standing rule — BOTH):**
  - Add an entry to the TOP of `ANNOUNCEMENTS` in `src/lib/announcements.js` (id `2026-06-03-followup-smart`, emoji 🎯, title e.g. "Follow-ups got smarter", body covering suggestions + snooze + funnel rollup, cta Open Prospects). Commit (untagged).
  - Push an `[announce]`-tagged empty commit for Slack.

---

## Self-Review notes (addressed)
- **Spec §5 coverage:** outcome→stage suggestions (Task 1,3,5), snooze UI (Task 4,5), breakup prompt (Task 1 onComplete branch surfaced as suggestion), funnel rollup with double-count guard (Task 2,6). ✓
- **Non-destructive funnel:** rollup never writes `activities_v1`; manual-day-wins guard tested. ✓
- **Type consistency:** `suggestStageAfterTouch` → `{ stage, reason } | null` used identically in LeadTracker + ProspectsView; `mergeFunnelTotals` → `{ dials, appts, pitches, closes }` matches existing funnel consumers. ✓
- **Re-arm on accept:** `applyStageSuggestion` calls `armCadence`, consistent with Phase 1 stage-change behavior. ✓
