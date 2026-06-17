# Unified Follow-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make any logged touch (call/text/email) — including sending an outreach email — advance ONE follow-up clock per prospect, and retire the separate "emails due" list so a touch clears the lead from all follow-up reminders.

**Architecture:** The cadence engine (`followupEngine.mjs`, `prospect.cadence.nextDueAt`) is the single follow-up timer; `logTouch` already advances it for any channel. We add `applyOutreachEmail()` so sending an outreach email both records the email and logs an `email` touch (advancing the cadence). The standalone `OutreachRemindersWidget` ("emails due") is removed; the cadence-driven `FollowupDueWidget` becomes the one reminder list shown on Prospects, Dashboard, and CPA Dashboard. The prospect detail still auto-selects the next outreach email (via the kept `nextTemplateIdForProspect`), so the email recommendation is one tap from the list.

**Tech Stack:** Next.js 16 / React 19, plain ES modules, `node --test`, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-17-unified-followup-design.md`

**Scope note:** Prospects pipeline only. `outreachReminders.js` keeps `nextTemplateIdForProspect` (powers the detail's template auto-select); `getOutreachReminders` becomes unused dead code after the widget is removed — left in place to avoid touching the template-selection dependency chain.

---

## File structure

- `src/lib/followupEngine.mjs` — add `applyOutreachEmail(prospect, entry, playbook, now)` (pure: append emailLog + log an `email` touch). Core `logTouch` unchanged.
- `src/lib/followupEngine.test.mjs` — tests for `applyOutreachEmail` + an `email`-channel-touch characterization test.
- `src/components/LeadTracker.jsx` — `logProspectOutreachEmail` handler (uses `applyOutreachEmail`); pass to ProspectsView; pass nothing new to dashboards beyond `prospects`/`onOpenProspects` (already there).
- `src/components/views/ProspectsView.jsx` — detail's `SendOutreachEmail.onLogged` → new handler; remove OutreachRemindersWidget import + mount.
- `src/components/FollowupDueWidget.jsx` — tolerate a missing `playbook` (so it can mount on dashboards without plumbing the playbook).
- `src/components/views/Dashboard.jsx`, `src/components/views/CpaDashboard.jsx` — swap OutreachRemindersWidget → FollowupDueWidget; remove the OutreachRemindersWidget import.
- `src/components/OutreachRemindersWidget.jsx` — deleted.

---

## Task 1: `applyOutreachEmail` engine helper

**Files:**
- Modify: `src/lib/followupEngine.mjs` (append export, after `logTouch`)
- Test: `src/lib/followupEngine.test.mjs`

- [ ] **Step 1: Write the failing tests (append to `src/lib/followupEngine.test.mjs`)**

```js
// --- applyOutreachEmail: sending an outreach email is also a touch ----------
import { applyOutreachEmail, logTouch as engineLogTouch, dueStatus } from './followupEngine.mjs';

// A minimal 2-step playbook for the prospect's stage so the cadence can advance.
const PB = { stages: { NEW: { steps: [{ afterDays: 0, channel: 'call' }, { afterDays: 3, channel: 'text' }] } } };

test('applyOutreachEmail: records the email AND advances the cadence', () => {
  const now = '2026-06-17T12:00:00.000Z';
  const prospect = { id: 'p1', stage: 'NEW', emailLog: [], touchLog: [], cadence: { stepIndex: 0, nextDueAt: now, snoozedUntil: null, completedAt: null } };
  const entry = { templateId: 'phc-outreach-1-initial', name: 'Email 1 — Initial outreach', sentAt: now, kind: 'outreach' };
  const out = applyOutreachEmail(prospect, entry, PB, now);
  // email recorded
  assert.equal(out.emailLog.length, 1);
  assert.equal(out.emailLog[0].templateId, 'phc-outreach-1-initial');
  // counted as a touch
  assert.equal(out.touchLog.length, 1);
  assert.equal(out.touchLog[0].channel, 'email');
  // cadence advanced off "due now" (stepIndex moved or completed)
  assert.notEqual(out.cadence.stepIndex, 0);
  assert.equal(out.lastContact, '2026-06-17');
});

test('an email-channel touch advances the cadence exactly like a call', () => {
  const now = '2026-06-17T12:00:00.000Z';
  const base = { id: 'p2', stage: 'NEW', touchLog: [], cadence: { stepIndex: 0, nextDueAt: now, snoozedUntil: null, completedAt: null } };
  const byCall = engineLogTouch(base, { channel: 'call' }, PB, now).prospect;
  const byEmail = engineLogTouch(base, { channel: 'email' }, PB, now).prospect;
  assert.equal(byEmail.cadence.stepIndex, byCall.cadence.stepIndex);
  assert.equal(byEmail.cadence.nextDueAt, byCall.cadence.nextDueAt);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: FAIL — `applyOutreachEmail is not a function` (the email-touch test should already pass).

- [ ] **Step 3: Implement (append to `src/lib/followupEngine.mjs`, after `logTouch`)**

```js
/**
 * Sending an outreach email is also a follow-up touch. Records the email in
 * emailLog AND advances the single cadence clock (channel 'email'), so the
 * prospect drops off the unified follow-up list just like a logged call/text.
 * Pure — returns the updated prospect.
 */
export function applyOutreachEmail(prospect, entry, playbook, now) {
  const withEmail = { ...prospect, emailLog: [...(prospect.emailLog || []), entry] };
  const note = entry?.name || entry?.templateName || 'Outreach email';
  const { prospect: advanced } = logTouch(withEmail, { channel: 'email', outcome: 'sent', note }, playbook, now);
  return { ...advanced, lastContact: now.slice(0, 10) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test src/lib/followupEngine.test.mjs`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followupEngine.mjs src/lib/followupEngine.test.mjs
git commit -m "followupEngine: applyOutreachEmail — sending an outreach email logs a touch"
```

---

## Task 2: Wire the email-send handler in LeadTracker

**Files:**
- Modify: `src/components/LeadTracker.jsx` (import; add handler near `logProspectTouch` ~line 1548; pass prop to ProspectsView ~line 2184)

- [ ] **Step 1: Extend the followupEngine import**

Find the import (line ~43):
```js
  ensureFollowupFields, armIfNeeded, armCadence, logTouch as engineLogTouch, snooze as engineSnooze, suggestStageAfterTouch,
```
Add `applyOutreachEmail` to that destructured import:
```js
  ensureFollowupFields, armIfNeeded, armCadence, logTouch as engineLogTouch, snooze as engineSnooze, suggestStageAfterTouch, applyOutreachEmail,
```

- [ ] **Step 2: Add the handler (after `logProspectTouch`, ~line 1558)**

```js
  // Sending an outreach email records it AND advances the unified follow-up
  // clock (it counts as a touch), so the prospect clears off the follow-up list.
  const logProspectOutreachEmail = useCallback((prospectId, entry) => {
    const now = new Date().toISOString();
    setProspects(prev => prev.map(p =>
      p.id === prospectId ? applyOutreachEmail(p, entry, followupPlaybook, now) : p
    ));
  }, [followupPlaybook]);
```

- [ ] **Step 3: Pass it to ProspectsView**

Find the `<ProspectsView ... onLogTouch={logProspectTouch}` mount (~line 2184) and add the prop:
```jsx
            onLogTouch={logProspectTouch}
            onOutreachEmailSent={logProspectOutreachEmail}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles (prop unused until Task 3 — fine).

- [ ] **Step 5: Commit**

```bash
git add src/components/LeadTracker.jsx
git commit -m "LeadTracker: logProspectOutreachEmail (email send advances follow-up clock)"
```

---

## Task 3: ProspectsView — use the handler + remove the emails-due widget

**Files:**
- Modify: `src/components/views/ProspectsView.jsx` (detail onLogged ~1209-1217; component prop list; OutreachRemindersWidget import + mount ~1615)

- [ ] **Step 1: Accept the new prop**

In the `ProspectsView` function's prop destructuring, add `onOutreachEmailSent` alongside the other handlers (e.g. next to `onLogTouch` / `onProspectUpdate`). Example shape:
```jsx
export default function ProspectsView({ /* …existing props…, */ onOutreachEmailSent, /* … */ }) {
```

- [ ] **Step 2: Route the outreach send through it (replace lines ~1209-1217)**

```jsx
            <SendOutreachEmail
              prospect={prospect}
              onLogged={(entry) => onOutreachEmailSent?.(prospect.id, entry)}
            />
```

- [ ] **Step 3: Remove the OutreachRemindersWidget mount (delete lines ~1607-1623, the comment block + `<OutreachRemindersWidget ... />`)**

Delete the entire block:
```jsx
      {/* Outreach EMAIL follow-ups (beta) … */}
      <OutreachRemindersWidget
        prospects={prospects}
        title="Emails due"
        onOpenProspect={(id) => {
          const p = prospects.find(x => x.id === id);
          if (p) onView(p);
        }}
      />
```
(The `FollowupDueWidget` mount directly above it stays — it's now the single follow-up list.)

- [ ] **Step 4: Remove the now-unused import**

Delete: `import OutreachRemindersWidget from '../OutreachRemindersWidget';`

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: compiles, no "OutreachRemindersWidget is not defined".

- [ ] **Step 6: Commit**

```bash
git add src/components/views/ProspectsView.jsx
git commit -m "Prospects: outreach send advances follow-up; remove separate emails-due widget"
```

---

## Task 4: FollowupDueWidget tolerates a missing playbook

So it can mount on the dashboards (which don't have the playbook) without extra plumbing. The playbook is only used for the optional "Next: <channel>" hint.

**Files:**
- Modify: `src/components/FollowupDueWidget.jsx:78`

- [ ] **Step 1: Guard the playbook lookup (replace line 78)**

```jsx
            const steps = playbook ? playbookForStage(playbook, p.stage) : [];
```
(Everything else stays — when `steps` is empty, `channel` is undefined and the "Next:" line is already conditionally hidden.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src/components/FollowupDueWidget.jsx
git commit -m "FollowupDueWidget: make playbook optional (mountable on dashboards)"
```

---

## Task 5: Swap the widget on Dashboard + CPA Dashboard

**Files:**
- Modify: `src/components/views/Dashboard.jsx` (import; mount ~184-189)
- Modify: `src/components/views/CpaDashboard.jsx` (import; mount ~442-447)

- [ ] **Step 1: Dashboard — swap import**

Replace `import OutreachRemindersWidget from '../OutreachRemindersWidget';` with:
```jsx
import FollowupDueWidget from '../FollowupDueWidget';
```

- [ ] **Step 2: Dashboard — swap the mount (replace the `{!readOnly && (<OutreachRemindersWidget .../>)}` block ~183-189)**

```jsx
      {!readOnly && (
        <FollowupDueWidget
          prospects={prospects}
          onOpenProspect={() => onOpenProspects?.()}
        />
      )}
```

- [ ] **Step 3: CpaDashboard — swap import**

Replace `import OutreachRemindersWidget from '../OutreachRemindersWidget';` with:
```jsx
import FollowupDueWidget from '../FollowupDueWidget';
```

- [ ] **Step 4: CpaDashboard — swap the mount (replace the `{!readOnly && (<OutreachRemindersWidget .../>)}` block ~441-447)**

```jsx
      {!readOnly && (
        <FollowupDueWidget
          prospects={prospects}
          onOpenProspect={() => onOpenProspects?.()}
        />
      )}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: compiles. (If either file had no other use of the old import, the swap removes it cleanly.)

- [ ] **Step 6: Commit**

```bash
git add src/components/views/Dashboard.jsx src/components/views/CpaDashboard.jsx
git commit -m "Dashboards: show unified follow-up list (replace emails-due widget)"
```

---

## Task 6: Delete the OutreachRemindersWidget component

**Files:**
- Delete: `src/components/OutreachRemindersWidget.jsx`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "OutreachRemindersWidget" src/ ; echo "exit: $?"`
Expected: no matches (grep exits 1). If any remain, fix them before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/OutreachRemindersWidget.jsx
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git commit -m "Remove OutreachRemindersWidget — replaced by the unified follow-up list"
```

---

## Task 7: Full verification + deploy

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all pass (existing + the new followupEngine tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Confirm live**

`git rev-parse --short HEAD`, then poll `https://www.primtracker.com/api/version` until it returns that SHA.

---

## Self-review

**Spec coverage:**
- One clock (cadence) → unchanged core; Task 1 confirms email = touch. ✓
- Sending an outreach email logs a touch → Tasks 1–3 (`applyOutreachEmail` + wiring). ✓
- Retire separate "emails due" timer + widget → Tasks 3, 5, 6 (mounts removed, component deleted). `getOutreachReminders` left as dead code (noted) — the user-facing list is gone. ✓
- Emails as the suggested action → preserved in the prospect detail (`nextTemplateIdForProspect` kept; opening a due prospect auto-selects the next email), one tap from the list — matches how "emails due" already routed. ✓ (No inline Send button in the row; flagged to Juan.)
- Timing = cadence playbook → inherent (cadence is the only timer now). ✓
- Shown everywhere emails-due was → Tasks 3, 5 (Prospects keeps FollowupDueWidget; Dashboard + CPA now mount it). ✓
- Beta gating → FollowupDueWidget (follow-up list) shown to all (correct — it's core, not beta); the Send-email action stays gated inside SendOutreachEmail in the detail. ✓
- Tests → Task 1. ✓

**Placeholder scan:** none — every step has concrete code/commands. Line-number anchors are approximate ("~line N"); the executor matches on the quoted code.

**Type/name consistency:** `applyOutreachEmail(prospect, entry, playbook, now)` defined in Task 1, called in Task 2's `logProspectOutreachEmail`, exposed as ProspectsView prop `onOutreachEmailSent` (Tasks 2–3), consumed by `SendOutreachEmail.onLogged(entry)`. Consistent.

**Deviation flagged:** spec point 4 mentioned a "Send button alongside Log touch" in the widget row; this plan keeps the recommendation in the prospect detail (auto-selected next email), one tap from the list — same UX the old emails-due widget had, and lower risk. Confirm with Juan if an inline Send button in the list is wanted.
