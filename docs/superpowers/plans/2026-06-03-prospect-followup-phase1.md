# Prospect Follow-up System — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core follow-up loop in the Prospects mini-CRM: a per-stage playbook, a touch-by-touch activity log, and an auto-pilot cadence that sets the next-touch due date, advances when a touch is logged, and nudges agents when they fall behind.

**Architecture:** All cadence logic lives in one pure, dependency-free ESM module (`src/lib/followupEngine.mjs`) tested with `node --test`. The prospect record gains follow-up fields; `LeadTracker.jsx` owns the playbook settings + handlers; `ProspectsView.jsx` renders the next-step card, the Log-touch sheet, the merged activity timeline, and a kanban status dot. The TODAY panel's overdue logic switches from the crude 5-day rule to the engine.

**Tech Stack:** Next.js 16 / React 19, Tailwind 4, lucide-react, framer-motion, `node:test` for pure libs. Spec: `docs/superpowers/specs/2026-06-03-prospect-followup-system-design.md`.

**Phase 1 boundary (intentional):** Cadences are implemented for the four *chase* stages — `MISSED_APPT`, `PENDING_DECISION`, `FOLLOWUP_LATER`, `GHOSTED`. The appointment-reminder stages (`WEBBY_SET`, `WEBBY_CONFIRMED`, `APPOINTMENT_SET`) keep relying on the existing `appointmentTime` reminders; their time-anchored cadences (day-before / 1h-before) come in Phase 2. Terminal stages (`SOLD`, `LOST`) have no cadence.

---

## File Structure

**Create:**
- `src/lib/followupEngine.mjs` — enums (`CHANNELS`, `OUTCOMES`), `DEFAULT_PLAYBOOK`, `FOLLOWUP_PLAYBOOK_KEY`, `FOLLOWUP_DEFAULTS`, and pure functions: `playbookForStage`, `ensureFollowupFields`, `armCadence`, `logTouch`, `dueStatus`, `snooze`.
- `src/lib/followupEngine.test.mjs` — node:test coverage for every function.
- `src/components/LogTouchSheet.jsx` — the channel/outcome/note capture modal.
- `src/components/FollowupNextStep.jsx` — the next-step card (script + Copy + Log touch button) shown in the prospect detail bubble.
- `src/components/FollowupTimeline.jsx` — merged touchLog + emailLog reverse-chron timeline.

**Modify:**
- `src/lib/prospects.js` — `newProspect` spreads `FOLLOWUP_DEFAULTS`.
- `src/components/LeadTracker.jsx` — load `followup_playbook_v1`, migrate prospects on load, arm cadence on stage change, add `logProspectTouch` / `snoozeProspect` handlers, pass playbook + handlers to `ProspectsView`.
- `src/components/views/ProspectsView.jsx` — mount the next-step card + timeline in the detail bubble, wire the Log-touch sheet, add the kanban status dot, switch `isOverdueFollowup` to engine `dueStatus`.

---

## Task 1: Engine scaffold — enums, playbook, defaults

**Files:**
- Create: `src/lib/followupEngine.mjs`
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/followupEngine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS, OUTCOMES, DEFAULT_PLAYBOOK, FOLLOWUP_PLAYBOOK_KEY,
  FOLLOWUP_DEFAULTS, playbookForStage,
} from './followupEngine.mjs';

test('enums and key are exported', () => {
  assert.deepEqual(CHANNELS, ['Call', 'Text', 'Email', 'Voicemail', 'Other']);
  assert.deepEqual(OUTCOMES, ['No answer', 'Left VM', 'Connected', 'Booked appt', 'Not interested', 'Other']);
  assert.equal(FOLLOWUP_PLAYBOOK_KEY, 'followup_playbook_v1');
});

test('FOLLOWUP_DEFAULTS shape is non-destructive defaults', () => {
  assert.deepEqual(FOLLOWUP_DEFAULTS.touchLog, []);
  assert.equal(FOLLOWUP_DEFAULTS.stageEnteredAt, null);
  assert.deepEqual(FOLLOWUP_DEFAULTS.cadence, { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null });
});

test('DEFAULT_PLAYBOOK has the four chase stages with steps', () => {
  for (const id of ['MISSED_APPT', 'PENDING_DECISION', 'FOLLOWUP_LATER', 'GHOSTED']) {
    const stage = DEFAULT_PLAYBOOK.stages[id];
    assert.ok(Array.isArray(stage.steps) && stage.steps.length > 0, `${id} has steps`);
    for (const s of stage.steps) {
      assert.equal(typeof s.afterDays, 'number');
      assert.ok(CHANNELS.includes(s.channel));
      assert.equal(typeof s.script, 'string');
    }
  }
});

test('playbookForStage returns steps for a chase stage and [] for terminal/unknown', () => {
  assert.ok(playbookForStage(DEFAULT_PLAYBOOK, 'GHOSTED').length >= 1);
  assert.deepEqual(playbookForStage(DEFAULT_PLAYBOOK, 'SOLD'), []);
  assert.deepEqual(playbookForStage(DEFAULT_PLAYBOOK, 'NOPE'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: FAIL — `Cannot find module './followupEngine.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/followupEngine.mjs
/**
 * Prospect follow-up engine — pure, dependency-free cadence logic.
 * Imported by both client components and node:test. No DOM/Next imports.
 *
 * A "playbook" maps a stage id -> { steps: [{ afterDays, channel, script }], onComplete }.
 * `afterDays` = days after the previous action (stage entry for step 0,
 * last logged touch thereafter). `onComplete` = suggested stage when the
 * final (breakup) step is logged.
 */

export const CHANNELS = ['Call', 'Text', 'Email', 'Voicemail', 'Other'];
export const OUTCOMES = ['No answer', 'Left VM', 'Connected', 'Booked appt', 'Not interested', 'Other'];

export const FOLLOWUP_PLAYBOOK_KEY = 'followup_playbook_v1';

// Non-destructive defaults merged onto any prospect lacking follow-up fields.
export const FOLLOWUP_DEFAULTS = {
  touchLog: [],
  stageEnteredAt: null,
  cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
};

export const DEFAULT_PLAYBOOK = {
  version: 1,
  stages: {
    MISSED_APPT: {
      onComplete: 'GHOSTED',
      steps: [
        { afterDays: 0, channel: 'Call', script: "Hi {first}, we just missed our call set for {time} — calling now in case you're free!" },
        { afterDays: 0, channel: 'Text', script: "Hi {first}, sorry we missed each other at {time}! Life gets busy — want me to grab another quick slot today or tomorrow?" },
        { afterDays: 1, channel: 'Call', script: "Following up on rescheduling your coverage review, {first}. I have a couple of openings — what works better, morning or afternoon?" },
        { afterDays: 3, channel: 'Text', script: "Hey {first}, still happy to find you the right plan when you're ready. Want me to text you 2 times to pick from?" },
        { afterDays: 7, channel: 'Text', script: "Hi {first}, I haven't been able to reconnect so I'll pause for now. Whenever you're ready, I'm one text away. — {agent}" },
      ],
    },
    PENDING_DECISION: {
      onComplete: 'FOLLOWUP_LATER',
      steps: [
        { afterDays: 1, channel: 'Text', script: "Hi {first}! Just checking in on the options we went over — any questions I can clear up so you feel 100% confident?" },
        { afterDays: 2, channel: 'Call', script: "Hi {first}, wanted to walk through any last questions on the plan and help you lock in your start date. Got 5 minutes?" },
        { afterDays: 4, channel: 'Text', script: "Hey {first}, checking in — the sooner we set it up the sooner you're covered. Want me to send the enrollment link?" },
        { afterDays: 7, channel: 'Call', script: "Hi {first}, rates and availability can change month to month — let's get you protected before anything shifts. Free now?" },
        { afterDays: 10, channel: 'Text', script: "Hi {first}, I'll set this aside for now so I'm not crowding you. When you're ready to move forward, just reply and I'll pick right back up. — {agent}" },
      ],
    },
    FOLLOWUP_LATER: {
      onComplete: 'FOLLOWUP_LATER',
      steps: [
        { afterDays: 3, channel: 'Text', script: "Hi {first}! Circling back as promised — has anything changed with your coverage timing?" },
        { afterDays: 7, channel: 'Call', script: "Hey {first}, checking in to see if now's a better time to look at your options. Quick call?" },
        { afterDays: 14, channel: 'Text', script: "Hi {first}, still here whenever you're ready. Want me to send a quick quote to look over on your own time?" },
        { afterDays: 30, channel: 'Call', script: "Hi {first}, monthly check-in! Any change in your situation that makes coverage a priority now?" },
      ],
    },
    GHOSTED: {
      onComplete: 'LOST',
      steps: [
        { afterDays: 1, channel: 'Text', script: "Hi {first}, lost you for a sec! Still want me to finish putting your options together?" },
        { afterDays: 2, channel: 'Voicemail', script: "Hi {first}, it's {agent} — left you a quick voicemail with next steps on your coverage. Call or text me back anytime." },
        { afterDays: 4, channel: 'Text', script: "Hey {first}, trying you one more way — even a quick 'not now' helps me know how to help. 😊" },
        { afterDays: 7, channel: 'Text', script: "Hi {first}, I haven't heard back so I'll close your file for now. If your coverage needs change, I'm one text away. — {agent}" },
      ],
    },
  },
};

export function playbookForStage(playbook, stageId) {
  const stage = playbook?.stages?.[stageId];
  return Array.isArray(stage?.steps) ? stage.steps : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs
git commit -m "feat(followup): engine scaffold — enums, default playbook, defaults"
```

---

## Task 2: `ensureFollowupFields` — non-destructive migration

**Files:**
- Modify: `src/lib/followupEngine.mjs`
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/followupEngine.test.mjs
import { ensureFollowupFields } from './followupEngine.mjs';

test('ensureFollowupFields backfills missing fields without clobbering existing', () => {
  const bare = { id: 'p1', stage: 'GHOSTED', createdAt: '2026-05-01T00:00:00.000Z' };
  const out = ensureFollowupFields(bare, '2026-06-03T12:00:00.000Z');
  assert.deepEqual(out.touchLog, []);
  assert.deepEqual(out.cadence, { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null });
  // stageEnteredAt backfills from createdAt when missing
  assert.equal(out.stageEnteredAt, '2026-05-01T00:00:00.000Z');
});

test('ensureFollowupFields leaves an already-migrated prospect untouched', () => {
  const p = {
    id: 'p2', stage: 'GHOSTED', createdAt: '2026-05-01T00:00:00.000Z',
    stageEnteredAt: '2026-05-10T00:00:00.000Z',
    touchLog: [{ id: 't', at: '2026-05-11T00:00:00.000Z', channel: 'Call', outcome: 'No answer', note: '' }],
    cadence: { stepIndex: 2, nextDueAt: '2026-05-15T00:00:00.000Z', snoozedUntil: null, completedAt: null },
  };
  const out = ensureFollowupFields(p, '2026-06-03T12:00:00.000Z');
  assert.equal(out.stageEnteredAt, '2026-05-10T00:00:00.000Z');
  assert.equal(out.touchLog.length, 1);
  assert.equal(out.cadence.stepIndex, 2);
});

test('ensureFollowupFields uses now when no createdAt exists', () => {
  const out = ensureFollowupFields({ id: 'p3', stage: 'PENDING_DECISION' }, '2026-06-03T12:00:00.000Z');
  assert.equal(out.stageEnteredAt, '2026-06-03T12:00:00.000Z');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: FAIL — `ensureFollowupFields is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to src/lib/followupEngine.mjs
export function ensureFollowupFields(prospect, now) {
  const p = { ...prospect };
  if (!Array.isArray(p.touchLog)) p.touchLog = [];
  if (!p.cadence || typeof p.cadence !== 'object') {
    p.cadence = { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null };
  } else {
    p.cadence = {
      stepIndex: Number(p.cadence.stepIndex) || 0,
      nextDueAt: p.cadence.nextDueAt ?? null,
      snoozedUntil: p.cadence.snoozedUntil ?? null,
      completedAt: p.cadence.completedAt ?? null,
    };
  }
  if (!p.stageEnteredAt) p.stageEnteredAt = prospect.createdAt || now;
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs
git commit -m "feat(followup): ensureFollowupFields migration"
```

---

## Task 3: `armCadence` — entering a stage sets the first due date

**Files:**
- Modify: `src/lib/followupEngine.mjs`
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/followupEngine.test.mjs
import { armCadence, DEFAULT_PLAYBOOK as PB } from './followupEngine.mjs';

test('armCadence sets stageEnteredAt and nextDueAt from step 0 afterDays', () => {
  const p = { id: 'a', stage: 'PENDING_DECISION', touchLog: [], cadence: FOLLOWUP_DEFAULTS.cadence };
  const out = armCadence(p, PB, '2026-06-03T12:00:00.000Z');
  assert.equal(out.stageEnteredAt, '2026-06-03T12:00:00.000Z');
  assert.equal(out.cadence.stepIndex, 0);
  assert.equal(out.cadence.completedAt, null);
  // PENDING_DECISION step 0 is afterDays:1 -> due 2026-06-04T12:00
  assert.equal(out.cadence.nextDueAt, '2026-06-04T12:00:00.000Z');
});

test('armCadence on a terminal stage clears the cadence (no due date)', () => {
  const p = { id: 'b', stage: 'SOLD', touchLog: [], cadence: { stepIndex: 3, nextDueAt: '2026-01-01T00:00:00.000Z', snoozedUntil: null, completedAt: null } };
  const out = armCadence(p, PB, '2026-06-03T12:00:00.000Z');
  assert.equal(out.cadence.nextDueAt, null);
  assert.equal(out.cadence.stepIndex, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: FAIL — `armCadence is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to src/lib/followupEngine.mjs

// Add N days to an ISO timestamp, preserving time-of-day. Returns ISO.
function addDaysIso(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString();
}

export function armCadence(prospect, playbook, now) {
  const p = { ...prospect, stageEnteredAt: now };
  const steps = playbookForStage(playbook, p.stage);
  if (steps.length === 0) {
    p.cadence = { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null };
    return p;
  }
  p.cadence = {
    stepIndex: 0,
    nextDueAt: addDaysIso(now, steps[0].afterDays),
    snoozedUntil: null,
    completedAt: null,
  };
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs
git commit -m "feat(followup): armCadence on stage entry"
```

---

## Task 4: `logTouch` — append touch, advance step, signal completion

**Files:**
- Modify: `src/lib/followupEngine.mjs`
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/followupEngine.test.mjs
import { logTouch } from './followupEngine.mjs';

test('logTouch appends a touch and advances to the next due date', () => {
  let p = armCadence({ id: 'c', stage: 'GHOSTED', touchLog: [], cadence: FOLLOWUP_DEFAULTS.cadence }, PB, '2026-06-03T12:00:00.000Z');
  // GHOSTED steps afterDays: [1,2,4,7]; armed nextDue = +1 day
  const r = logTouch(p, { channel: 'Text', outcome: 'No answer', note: 'no reply' }, PB, '2026-06-04T15:00:00.000Z');
  assert.equal(r.prospect.touchLog.length, 1);
  assert.equal(r.prospect.touchLog[0].channel, 'Text');
  assert.equal(r.prospect.touchLog[0].outcome, 'No answer');
  assert.equal(r.prospect.touchLog[0].at, '2026-06-04T15:00:00.000Z');
  assert.ok(r.prospect.touchLog[0].id); // generated
  // advanced to step 1; next due = touch time + step1.afterDays(2) = 2026-06-06T15:00
  assert.equal(r.prospect.cadence.stepIndex, 1);
  assert.equal(r.prospect.cadence.nextDueAt, '2026-06-06T15:00:00.000Z');
  assert.equal(r.suggestedStage, null);
});

test('logTouch on the final step completes the cadence and suggests onComplete stage', () => {
  let p = armCadence({ id: 'd', stage: 'GHOSTED', touchLog: [], cadence: FOLLOWUP_DEFAULTS.cadence }, PB, '2026-06-03T12:00:00.000Z');
  p.cadence.stepIndex = 3; // last GHOSTED step (index 3 of 4)
  const r = logTouch(p, { channel: 'Text', outcome: 'No answer', note: '' }, PB, '2026-06-10T12:00:00.000Z');
  assert.equal(r.prospect.touchLog.length, 1);
  assert.ok(r.prospect.cadence.completedAt);
  assert.equal(r.prospect.cadence.nextDueAt, null);
  assert.equal(r.suggestedStage, 'LOST');
});

test('logTouch on a no-cadence stage still records the touch, no due date', () => {
  const p = { id: 'e', stage: 'SOLD', touchLog: [], cadence: FOLLOWUP_DEFAULTS.cadence, stageEnteredAt: '2026-06-01T00:00:00.000Z' };
  const r = logTouch(p, { channel: 'Call', outcome: 'Connected', note: 'welcome call' }, PB, '2026-06-03T12:00:00.000Z');
  assert.equal(r.prospect.touchLog.length, 1);
  assert.equal(r.prospect.cadence.nextDueAt, null);
  assert.equal(r.suggestedStage, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: FAIL — `logTouch is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to src/lib/followupEngine.mjs

function makeId() {
  try { return globalThis.crypto.randomUUID(); }
  catch { return 'tch_' + Math.abs(Date.now()).toString(36); }
}

/**
 * Record a touch. Returns { prospect, suggestedStage }.
 * - Appends { id, at, channel, outcome, note } to touchLog.
 * - Advances cadence.stepIndex; sets next nextDueAt = at + nextStep.afterDays.
 * - If the logged step was the last, sets completedAt, clears nextDueAt,
 *   and returns the playbook's onComplete stage as suggestedStage.
 */
export function logTouch(prospect, touch, playbook, now) {
  const p = { ...prospect, touchLog: [...(prospect.touchLog || [])], cadence: { ...prospect.cadence } };
  p.touchLog.push({
    id: makeId(),
    at: now,
    channel: touch.channel,
    outcome: touch.outcome,
    note: touch.note || '',
  });

  const steps = playbookForStage(playbook, p.stage);
  let suggestedStage = null;

  if (steps.length === 0) {
    p.cadence.nextDueAt = null;
    p.cadence.snoozedUntil = null;
    return { prospect: p, suggestedStage };
  }

  const loggedIndex = Math.min(Number(p.cadence.stepIndex) || 0, steps.length - 1);
  const nextIndex = loggedIndex + 1;
  p.cadence.snoozedUntil = null; // logging clears any snooze

  if (nextIndex >= steps.length) {
    p.cadence.completedAt = now;
    p.cadence.nextDueAt = null;
    suggestedStage = playbook.stages[p.stage]?.onComplete || null;
    if (suggestedStage === p.stage) suggestedStage = null; // FOLLOWUP_LATER loops on itself; don't suggest
  } else {
    p.cadence.stepIndex = nextIndex;
    p.cadence.nextDueAt = addDaysIso(now, steps[nextIndex].afterDays);
  }
  return { prospect: p, suggestedStage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs
git commit -m "feat(followup): logTouch advances cadence + suggests stage on complete"
```

---

## Task 5: `dueStatus` + `snooze`

**Files:**
- Modify: `src/lib/followupEngine.mjs`
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/followupEngine.test.mjs
import { dueStatus, snooze } from './followupEngine.mjs';

const base = (over) => ({ id: 'x', stage: 'GHOSTED', touchLog: [], cadence: { stepIndex: 0, nextDueAt: '2026-06-04T12:00:00.000Z', snoozedUntil: null, completedAt: null }, ...over });

test('dueStatus: ontrack when due in the future', () => {
  const s = dueStatus(base(), '2026-06-03T12:00:00.000Z');
  assert.equal(s.state, 'ontrack');
  assert.equal(s.daysLate, 0);
});

test('dueStatus: due_today within the due calendar day', () => {
  const s = dueStatus(base(), '2026-06-04T08:00:00.000Z');
  assert.equal(s.state, 'due_today');
});

test('dueStatus: overdue with daysLate', () => {
  const s = dueStatus(base(), '2026-06-07T12:00:00.000Z');
  assert.equal(s.state, 'overdue');
  assert.equal(s.daysLate, 3);
});

test('dueStatus: snoozed suppresses until snoozedUntil passes', () => {
  const p = base({ cadence: { stepIndex: 0, nextDueAt: '2026-06-04T12:00:00.000Z', snoozedUntil: '2026-06-09T12:00:00.000Z', completedAt: null } });
  assert.equal(dueStatus(p, '2026-06-07T12:00:00.000Z').state, 'snoozed');
  assert.equal(dueStatus(p, '2026-06-10T12:00:00.000Z').state, 'overdue');
});

test('dueStatus: done when completedAt set; none when no cadence', () => {
  assert.equal(dueStatus(base({ cadence: { stepIndex: 4, nextDueAt: null, snoozedUntil: null, completedAt: '2026-06-10T00:00:00.000Z' } }), '2026-06-11T00:00:00.000Z').state, 'done');
  assert.equal(dueStatus({ id: 'y', stage: 'SOLD', cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null } }, '2026-06-11T00:00:00.000Z').state, 'none');
});

test('snooze sets snoozedUntil now + days', () => {
  const out = snooze(base(), 3, '2026-06-04T12:00:00.000Z');
  assert.equal(out.cadence.snoozedUntil, '2026-06-07T12:00:00.000Z');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: FAIL — `dueStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// add to src/lib/followupEngine.mjs

function dayKey(iso) { return new Date(iso).toISOString().slice(0, 10); }

/**
 * Returns { state, daysLate, nextDueAt }.
 * state: 'none' (no cadence) | 'done' | 'snoozed' | 'overdue' | 'due_today' | 'ontrack'
 */
export function dueStatus(prospect, now) {
  const c = prospect?.cadence || {};
  if (c.completedAt) return { state: 'done', daysLate: 0, nextDueAt: null };
  if (!c.nextDueAt) return { state: 'none', daysLate: 0, nextDueAt: null };
  if (c.snoozedUntil && new Date(now) < new Date(c.snoozedUntil)) {
    return { state: 'snoozed', daysLate: 0, nextDueAt: c.nextDueAt };
  }
  const nowMs = new Date(now).getTime();
  const dueMs = new Date(c.nextDueAt).getTime();
  if (dayKey(now) === dayKey(c.nextDueAt)) return { state: 'due_today', daysLate: 0, nextDueAt: c.nextDueAt };
  if (nowMs > dueMs) {
    const daysLate = Math.floor((nowMs - dueMs) / 86400000);
    return { state: 'overdue', daysLate, nextDueAt: c.nextDueAt };
  }
  return { state: 'ontrack', daysLate: 0, nextDueAt: c.nextDueAt };
}

export function snooze(prospect, days, now) {
  return { ...prospect, cadence: { ...prospect.cadence, snoozedUntil: addDaysIso(now, days) } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: PASS (all engine tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs
git commit -m "feat(followup): dueStatus + snooze"
```

---

## Task 6: Prospect record gains follow-up fields

**Files:**
- Modify: `src/lib/prospects.js` (the `newProspect` factory, ~lines 34-64)

- [ ] **Step 1: Add the import and spread defaults**

At the top of `src/lib/prospects.js`, add the import next to the existing imports:

```js
import { FOLLOWUP_DEFAULTS } from './followupEngine.mjs';
```

In `newProspect`, add the follow-up fields into the returned object, right before `...overrides`:

```js
    convertedLeadId: null,
    // --- follow-up system (Phase 1) ---
    touchLog: [],
    stageEnteredAt: new Date().toISOString(),
    cadence: { ...FOLLOWUP_DEFAULTS.cadence },
    ...overrides,
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx --no-install next build`
Expected: build completes; `src/lib/prospects.js` and its importers compile (the `.mjs` import resolves under webpack/turbopack).

- [ ] **Step 3: Commit**

```bash
git add src/lib/prospects.js
git commit -m "feat(followup): newProspect seeds follow-up fields"
```

---

## Task 7: LeadTracker — load playbook, migrate prospects, handlers, arm on stage change

**Files:**
- Modify: `src/components/LeadTracker.jsx`

Reference points (verify current line numbers before editing):
- Prospects state + load (search `prospects_v1`, the prospects `useState`, and the load `useEffect`).
- The prospect save/update handler (search where a prospect is edited/moved — the kanban drag or `ProspectForm` save).
- The `<ProspectsView ... />` mount (search `ProspectsView`).

- [ ] **Step 1: Import the engine + playbook key**

Add near the other `@/lib` imports:

```js
import {
  FOLLOWUP_PLAYBOOK_KEY, DEFAULT_PLAYBOOK,
  ensureFollowupFields, armCadence, logTouch as engineLogTouch, snooze as engineSnooze,
} from '@/lib/followupEngine.mjs';
```

- [ ] **Step 2: Add playbook state + load it; migrate prospects on load**

Add a state hook next to the prospects state:

```js
const [followupPlaybook, setFollowupPlaybook] = useState(DEFAULT_PLAYBOOK);
```

In the load `useEffect` where `prospects_v1` is read and `setProspects(...)` is called, wrap the loaded array through migration, and load the playbook:

```js
const nowIso = new Date().toISOString();
const rawProspects = await storage.getItem('prospects_v1');
const loadedProspects = rawProspects ? JSON.parse(rawProspects) : [];
setProspects(loadedProspects.map(p => ensureFollowupFields(p, nowIso)));

const rawPlaybook = await storage.getItem(FOLLOWUP_PLAYBOOK_KEY);
setFollowupPlaybook(rawPlaybook ? JSON.parse(rawPlaybook) : DEFAULT_PLAYBOOK);
```

> If the existing code reads `prospects_v1` via a shared loader, apply the `.map(ensureFollowupFields)` at the point `setProspects` receives the array. Keep the existing persistence `useEffect` for `prospects_v1` unchanged — the migrated fields persist on next save.

- [ ] **Step 3: Arm cadence when a prospect's stage changes**

Find the handler that updates a prospect (stage move / form save). Wrap stage transitions so entering a new stage re-arms. Add this helper inside the component:

```js
const applyProspectUpdate = useCallback((updated) => {
  setProspects(prev => prev.map(p => {
    if (p.id !== updated.id) return p;
    const stageChanged = updated.stage && updated.stage !== p.stage;
    return stageChanged
      ? armCadence(updated, followupPlaybook, new Date().toISOString())
      : updated;
  }));
}, [followupPlaybook]);
```

Route the existing prospect-edit/move save through `applyProspectUpdate` (replace the direct `setProspects` call in that handler). For kanban drag-to-stage, call `applyProspectUpdate({ ...prospect, stage: newStageId })`.

- [ ] **Step 4: Add logTouch + snooze handlers**

```js
const logProspectTouch = useCallback((prospectId, touch) => {
  const now = new Date().toISOString();
  let suggestion = null;
  setProspects(prev => prev.map(p => {
    if (p.id !== prospectId) return p;
    const r = engineLogTouch(p, touch, followupPlaybook, now);
    suggestion = r.suggestedStage;
    // keep legacy lastContact in sync so existing widgets stay accurate
    return { ...r.prospect, lastContact: now.slice(0, 10) };
  }));
  return suggestion; // Phase 2 will surface this; Phase 1 ignores it
}, [followupPlaybook]);

const snoozeProspect = useCallback((prospectId, days) => {
  const now = new Date().toISOString();
  setProspects(prev => prev.map(p => p.id === prospectId ? engineSnooze(p, days, now) : p));
}, []);
```

- [ ] **Step 5: Pass new props to ProspectsView**

On the `<ProspectsView ... />` mount, add:

```jsx
  playbook={followupPlaybook}
  onLogTouch={logProspectTouch}
  onSnoozeProspect={snoozeProspect}
```

- [ ] **Step 6: Verify the build compiles**

Run: `npx --no-install next build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/LeadTracker.jsx
git commit -m "feat(followup): wire playbook load, migration, arm-on-stage-change, touch/snooze handlers"
```

---

## Task 8: LogTouchSheet component

**Files:**
- Create: `src/components/LogTouchSheet.jsx`

- [ ] **Step 1: Implement the sheet**

```jsx
'use client';
import { useState } from 'react';
import { X, Phone, MessageSquare, Mail, Voicemail, MoreHorizontal } from 'lucide-react';
import { CHANNELS, OUTCOMES } from '@/lib/followupEngine.mjs';

const CHANNEL_ICON = { Call: Phone, Text: MessageSquare, Email: Mail, Voicemail, Other: MoreHorizontal };

/**
 * Capture a single follow-up touch: channel + outcome + optional note.
 * onSave({ channel, outcome, note }) is called; parent persists via the engine.
 */
export default function LogTouchSheet({ open, prospectName, defaultChannel = 'Call', onSave, onClose }) {
  const [channel, setChannel] = useState(defaultChannel);
  const [outcome, setOutcome] = useState('No answer');
  const [note, setNote] = useState('');
  if (!open) return null;

  const save = () => { onSave({ channel, outcome, note: note.trim() }); setNote(''); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">Log follow-up</h3>
            {prospectName && <p className="text-xs text-slate-500">{prospectName}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Channel</div>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(c => {
                const Icon = CHANNEL_ICON[c] || MoreHorizontal;
                const active = c === channel;
                return (
                  <button key={c} onClick={() => setChannel(c)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                    <Icon size={14} /> {c}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Outcome</div>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map(o => {
                const active = o === outcome;
                return (
                  <button key={o} onClick={() => setOutcome(o)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Note (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500}
              placeholder="What happened / next angle…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          </div>
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700">Save touch</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx --no-install next build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/LogTouchSheet.jsx
git commit -m "feat(followup): LogTouchSheet capture modal"
```

---

## Task 9: FollowupNextStep card + FollowupTimeline

**Files:**
- Create: `src/components/FollowupNextStep.jsx`
- Create: `src/components/FollowupTimeline.jsx`

- [ ] **Step 1: Implement FollowupNextStep**

```jsx
'use client';
import { Copy, Check, Clock, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { playbookForStage, dueStatus } from '@/lib/followupEngine.mjs';

const STATE_STYLE = {
  overdue:   { cls: 'border-rose-200 bg-rose-50',    chip: 'bg-rose-100 text-rose-700' },
  due_today: { cls: 'border-amber-200 bg-amber-50',  chip: 'bg-amber-100 text-amber-800' },
  ontrack:   { cls: 'border-indigo-200 bg-indigo-50/40', chip: 'bg-indigo-100 text-indigo-700' },
  snoozed:   { cls: 'border-slate-200 bg-slate-50',  chip: 'bg-slate-100 text-slate-600' },
};

function mergeScript(script, prospect, agentName) {
  const first = (prospect.name || '').trim().split(/\s+/)[0] || 'there';
  const time = prospect.appointmentTime
    ? new Date(prospect.appointmentTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : 'our scheduled time';
  return String(script).replace(/{first}/g, first).replace(/{agent}/g, agentName || 'your agent').replace(/{time}/g, time);
}

export default function FollowupNextStep({ prospect, playbook, agentName, onLogTouch, now = new Date().toISOString() }) {
  const [copied, setCopied] = useState(false);
  const steps = playbookForStage(playbook, prospect.stage);
  if (steps.length === 0) return null;

  const status = dueStatus(prospect, now);
  if (status.state === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-sm text-emerald-800">
        <CheckCircle2 size={16} /> Follow-up sequence complete for this stage.
      </div>
    );
  }

  const idx = Math.min(prospect.cadence?.stepIndex || 0, steps.length - 1);
  const step = steps[idx];
  const text = mergeScript(step.script, prospect, agentName);
  const style = STATE_STYLE[status.state] || STATE_STYLE.ontrack;
  const dueLabel = status.state === 'overdue' ? `${status.daysLate}d overdue`
    : status.state === 'due_today' ? 'Due today'
    : status.state === 'snoozed' ? 'Snoozed'
    : status.nextDueAt ? `Due ${new Date(status.nextDueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div className={`rounded-xl border p-3 ${style.cls}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Clock size={14} /> Step {idx + 1} of {steps.length} · {step.channel}
        </div>
        {dueLabel && <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.chip}`}>{dueLabel}</span>}
      </div>
      <div className="text-sm text-slate-700 bg-white/70 border border-white rounded-lg p-2.5 whitespace-pre-wrap">{text}</div>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={copy} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy script'}
        </button>
        <button onClick={onLogTouch} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-sm font-bold">
          Log touch
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement FollowupTimeline**

```jsx
'use client';
import { Phone, MessageSquare, Mail, Voicemail, MoreHorizontal, Send } from 'lucide-react';

const CHANNEL_ICON = { Call: Phone, Text: MessageSquare, Email: Mail, Voicemail, Other: MoreHorizontal };
const OUTCOME_CLS = {
  'Connected': 'bg-emerald-100 text-emerald-700',
  'Booked appt': 'bg-indigo-100 text-indigo-700',
  'Not interested': 'bg-rose-100 text-rose-700',
  'No answer': 'bg-slate-100 text-slate-600',
  'Left VM': 'bg-amber-100 text-amber-800',
  'Other': 'bg-slate-100 text-slate-600',
};

function rel(at) {
  const ms = Date.now() - new Date(at).getTime();
  const d = Math.floor(ms / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Merge manual touches + auto outreach emails into one reverse-chron list. */
export default function FollowupTimeline({ touchLog = [], emailLog = [] }) {
  const items = [
    ...touchLog.map(t => ({ kind: 'touch', at: t.at, channel: t.channel, outcome: t.outcome, note: t.note })),
    ...emailLog.map(e => ({ kind: 'email', at: e.sentAt || e.at, label: e.name || `Email ${e.step ?? ''}`.trim() })),
  ].filter(i => i.at).sort((a, b) => new Date(b.at) - new Date(a.at));

  if (items.length === 0) return <div className="text-xs text-slate-400 italic">No follow-up activity yet.</div>;

  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        if (it.kind === 'email') {
          return (
            <div key={i} className="flex items-start gap-2 text-sm">
              <div className="w-6 h-6 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0"><Send size={12} /></div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-800">{it.label}</span>
                <span className="text-slate-400"> · sent {rel(it.at)}</span>
              </div>
            </div>
          );
        }
        const Icon = CHANNEL_ICON[it.channel] || MoreHorizontal;
        return (
          <div key={i} className="flex items-start gap-2 text-sm">
            <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0"><Icon size={12} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-slate-800">{it.channel}</span>
                {it.outcome && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${OUTCOME_CLS[it.outcome] || OUTCOME_CLS.Other}`}>{it.outcome}</span>}
                <span className="text-slate-400 text-xs">{rel(it.at)}</span>
              </div>
              {it.note && <div className="text-xs text-slate-500 mt-0.5">{it.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx --no-install next build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/FollowupNextStep.jsx src/components/FollowupTimeline.jsx
git commit -m "feat(followup): next-step card + activity timeline components"
```

---

## Task 10: Wire next-step card, timeline, and Log-touch sheet into ProspectsView detail bubble

**Files:**
- Modify: `src/components/views/ProspectsView.jsx`

Reference points:
- The detail bubble component (search the read-only "detail bubble"; the sections `Primary Information`, `Pipeline Activity`, the `Outreach activity` block around the `emailLog` render).
- The `ProspectsView` props signature (search `function ProspectsView` / its destructured props) and the `viewing` state (the read-only detail bubble state, search `const [viewing, setViewing]`).

- [ ] **Step 1: Imports + accept new props**

Add imports at the top of `ProspectsView.jsx`:

```js
import FollowupNextStep from '@/components/FollowupNextStep';
import FollowupTimeline from '@/components/FollowupTimeline';
import LogTouchSheet from '@/components/LogTouchSheet';
```

Add `playbook`, `onLogTouch`, `onSnoozeProspect` to the `ProspectsView` props destructuring (default `playbook = { stages: {} }`).

- [ ] **Step 2: Add Log-touch sheet state in the detail-bubble component**

In the component that renders the detail bubble (the one receiving the `prospect` being `viewing`), add:

```js
const [logOpen, setLogOpen] = useState(false);
```

Thread `playbook`, `onLogTouch`, `agentName` down to this component from `ProspectsView` props (pass them where the bubble is rendered). `agentName` can come from existing profile/display-name available in ProspectsView; if none is readily available, pass `''` (the script falls back to "your agent").

- [ ] **Step 3: Render the next-step card at the TOP of the bubble body**

Immediately inside the scrollable body (before `Primary Information`), add:

```jsx
<div className="mb-3">
  <FollowupNextStep
    prospect={prospect}
    playbook={playbook}
    agentName={agentName}
    onLogTouch={() => setLogOpen(true)}
  />
</div>
```

- [ ] **Step 4: Replace the email-only "Outreach activity" section with the merged timeline**

Find the block:

```jsx
{Array.isArray(prospect.emailLog) && prospect.emailLog.length > 0 && (
  <DetailSection title="Outreach activity">
    <OutreachLogList log={prospect.emailLog} />
  </DetailSection>
)}
```

Replace it with:

```jsx
<DetailSection title="Follow-up activity">
  <FollowupTimeline touchLog={prospect.touchLog} emailLog={prospect.emailLog} />
</DetailSection>
```

- [ ] **Step 5: Mount the LogTouchSheet and wire save**

Near the end of the detail-bubble JSX (inside its root), add:

```jsx
<LogTouchSheet
  open={logOpen}
  prospectName={prospect.name}
  defaultChannel={(playbook?.stages?.[prospect.stage]?.steps?.[prospect.cadence?.stepIndex || 0]?.channel) || 'Call'}
  onSave={(touch) => onLogTouch?.(prospect.id, touch)}
  onClose={() => setLogOpen(false)}
/>
```

- [ ] **Step 6: Verify the build + manual check**

Run: `npx --no-install next build`
Expected: PASS.
Manual: `npm run dev` → open Prospects → open a prospect in `PENDING_DECISION`/`GHOSTED` → confirm the next-step card shows a script + due chip, Copy works, Log touch opens the sheet, saving adds a timeline entry and advances the step.

- [ ] **Step 7: Commit**

```bash
git add src/components/views/ProspectsView.jsx
git commit -m "feat(followup): next-step card + merged timeline + log-touch sheet in prospect detail"
```

---

## Task 11: Kanban status dot + engine-driven overdue in TODAY panel

**Files:**
- Modify: `src/components/views/ProspectsView.jsx`

Reference points:
- `isOverdueFollowup(p)` (~line 103) and `TodayPanel` (~line 110, its `overdue` filter ~line 115).
- The kanban card render (search where a prospect card is rendered in a column).

- [ ] **Step 1: Replace `isOverdueFollowup` with the engine**

Add import:

```js
import { dueStatus } from '@/lib/followupEngine.mjs';
```

Replace the body of `isOverdueFollowup`:

```js
function isOverdueFollowup(p) {
  if (['SOLD', 'LOST'].includes(p.stage)) return false;
  const s = dueStatus(p, new Date().toISOString());
  return s.state === 'overdue' || s.state === 'due_today';
}
```

(Leave the `TodayPanel` `overdue` filter using `isOverdueFollowup` as-is — it now reflects the playbook.)

- [ ] **Step 2: Add a status dot to the kanban card**

Add a small helper near the top of the file:

```jsx
function FollowupDot({ prospect }) {
  const s = dueStatus(prospect, new Date().toISOString());
  const map = {
    overdue:   { c: 'bg-rose-500',    t: 'Follow-up overdue' },
    due_today: { c: 'bg-amber-500',   t: 'Follow-up due today' },
    ontrack:   { c: 'bg-emerald-500', t: 'On track' },
    snoozed:   { c: 'bg-slate-300',   t: 'Snoozed' },
  };
  const m = map[s.state];
  if (!m) return null; // 'none' / 'done'
  return <span title={m.t} className={`inline-block w-2 h-2 rounded-full ${m.c}`} />;
}
```

In the kanban card JSX, render `<FollowupDot prospect={p} />` next to the prospect name (e.g. just before or after the name span).

- [ ] **Step 3: Verify the build + manual check**

Run: `npx --no-install next build`
Expected: PASS.
Manual: confirm cards show a colored dot; an overdue prospect appears in the TODAY panel's OVERDUE FOLLOW-UPS.

- [ ] **Step 4: Commit**

```bash
git add src/components/views/ProspectsView.jsx
git commit -m "feat(followup): kanban status dot + engine-driven overdue"
```

---

## Task 12: Daily reminders cron reads the engine

**Files:**
- Modify: `src/app/api/reminders/route.js`

Reference points:
- The prospect follow-up section of the cron (search where prospects + `lastContact` / stale logic builds the follow-up portion of the email/push).

- [ ] **Step 1: Import the engine + compute overdue from cadence**

Add at the top:

```js
import { dueStatus } from '@/lib/followupEngine.mjs';
```

In the prospects follow-up section, build the overdue list from `dueStatus` instead of the date-difference heuristic:

```js
const overdueFollowups = (prospects || [])
  .filter(p => !p.archivedAt && !['SOLD', 'LOST'].includes(p.stage))
  .map(p => ({ p, s: dueStatus(p, new Date().toISOString()) }))
  .filter(x => x.s.state === 'overdue' || x.s.state === 'due_today')
  .sort((a, b) => (b.s.daysLate || 0) - (a.s.daysLate || 0));
```

Use `overdueFollowups` to render the follow-up lines in the email/push body (prospect name + `${x.s.daysLate}d overdue` or `due today`). Keep HIPAA in mind: name only, no health/policy detail.

- [ ] **Step 2: Verify the build compiles**

Run: `npx --no-install next build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/reminders/route.js
git commit -m "feat(followup): daily reminders use playbook due dates"
```

---

## Task 13: Full verification + push

- [ ] **Step 1: Run all lib tests**

Run: `node --test src/lib/followupEngine.test.mjs src/lib/paymentAlerts.test.mjs src/lib/reports.test.mjs src/lib/leadDedup.test.mjs src/lib/mergeStore.test.mjs src/lib/duplicateResolver.test.mjs`
Expected: all PASS.

- [ ] **Step 2: Full build**

Run: `npx --no-install next build`
Expected: PASS.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Manual smoke (production or dev)**
  - New prospect → has follow-up fields; entering a stage shows the next-step card with a due chip.
  - Log a touch → timeline updates, step advances, next due date moves out.
  - Move a prospect to Ghosted → cadence re-arms from step 1.
  - Overdue prospect → red dot on card + appears in TODAY panel + next daily email.

---

## Self-Review notes (addressed)

- **Spec coverage:** playbook (Task 1), log/timeline (Tasks 8-10), auto-pilot arm/advance/due/snooze (Tasks 3-5,7,11), nudge integration (Tasks 11-12), migration (Task 2,7), kanban dot (Task 11). Smart-outcome stage suggestion is surfaced by `logTouch`'s `suggestedStage` return but intentionally **not acted on** in Phase 1 (deferred to Phase 2) — `logProspectTouch` returns it for later.
- **Funnel rollup** (spec §5) is Phase 2 — not in this plan by design.
- **Type consistency:** engine functions return shapes used consistently (`logTouch` → `{ prospect, suggestedStage }`; `dueStatus` → `{ state, daysLate, nextDueAt }`). `FOLLOWUP_PLAYBOOK_KEY` used in Task 7 matches Task 1.
- **Time-anchored appt cadences** (Webby/Appointment) intentionally excluded from Phase 1 (documented boundary).
