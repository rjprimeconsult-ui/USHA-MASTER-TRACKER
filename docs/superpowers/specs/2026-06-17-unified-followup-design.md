# Unified Follow-up — design

**Date:** 2026-06-17
**Author:** Meruem (with Juan)
**Status:** Approved — ready for implementation plan
**Scope:** Prospects pipeline only (where Log touch / Send outreach / follow-up reminders live today). Portal Clients are out of scope.

## Why

Prospects have **two independent follow-up timers**:
1. **Cadence engine** (`followupEngine.mjs`) — `prospect.cadence.nextDueAt`, advanced by `logTouch` on any channel; surfaced by **FollowupDueWidget** ("follow-up due").
2. **Outreach email sequence** (`outreachReminders.js`) — driven *only* by `prospect.emailLog` (which outreach emails were sent) + fixed 3-then-5-day gaps; surfaced by **OutreachRemindersWidget** ("emails due").

They don't talk to each other: logging a call/text advances the cadence but leaves "emails due" showing, and sending an email advances the email timer but not the cadence. Agents end up with the same lead nagging them on two separate lists. Juan wants ONE follow-up: any touch — call, text, or email — clears the lead from all follow-up reminders.

## Goals

- One follow-up clock per prospect; any touch (call/text/email) resets it.
- Sending an outreach email counts as a touch (advances the same clock).
- The outreach email sequence becomes the *suggested action* when follow-up is due, not a separate timer/list.
- The lead drops off ALL follow-up reminders after any touch, until the next interval.
- One reminder widget, shown everywhere the two used to appear.

## Non-goals

- No follow-up system on Portal Clients (leads) — prospects only.
- No change to the outreach email *templates/content* (`outreachEmails.js`) — only how/when they're suggested.
- No change to the post-sale auto-send email queue (`postSaleEmails`) — unrelated.

## Design

### 1. One clock = the cadence
`prospect.cadence.nextDueAt` (via `dueStatus`) is the single follow-up timer. `logTouch(prospect, touch, playbook, now)` already advances `stepIndex` and resets `nextDueAt` for any `touch.channel` — no change needed to that core.

### 2. Sending an outreach email logs a touch
Today `SendOutreachEmail` appends to `emailLog` via its `onLogged` callback but does **not** advance the cadence. Change the parent handler (ProspectsView/LeadTracker) so that when an outreach email is sent it BOTH:
- appends the `emailLog` entry (as today — records which outreach step went out), and
- runs `logTouch(prospect, { channel: 'email', outcome: 'sent', note: '<template name>' }, playbook, now)` so the unified clock advances.

So sending Email 2 ≡ logging a call for the follow-up timer.

### 3. Retire the separate "emails due" timer + widget
- Remove the **due/upcoming reminder computation** from `outreachReminders.js` (`getOutreachReminders`) and the **OutreachRemindersWidget** component.
- Keep the step-lookup helpers in `outreachReminders.js`: `parseOutreachStep`, `templateForStep`, `lastSentStep`, and add `nextOutreachStep(prospect)` → `{ step, template } | null` (the next unsent outreach template, or null when all sent). Drop `OUTREACH_CADENCE_DAYS`, `getOutreachReminders`, and the 3/5-day due math.

### 4. Emails become the suggested action in the one widget
**FollowupDueWidget** is the single follow-up list. For each prospect whose cadence is due (`dueStatus` = `due_today`/`overdue`), it shows:
- the prospect + how late,
- **Log touch** (existing), and
- a **Send next email** action when an unsent outreach step remains (`nextStep = lastSentStep + 1`, ≤ number of templates) — opens the existing SendOutreachEmail flow pre-loaded with that template.

Doing either (logging a touch OR sending the email) advances the clock and removes the prospect from the list. When all outreach emails are sent, only "Log touch" shows.

### 5. Timing
Follow-up interval = the existing **cadence playbook** per stage (what `logTouch` already uses). The fixed 3-then-5-day email cadence is retired with the separate list.

### 6. Placement
Mount the unified **FollowupDueWidget** everywhere OutreachRemindersWidget appeared — **CPA Dashboard**, **Dashboard**, **Prospects** — and remove OutreachRemindersWidget from all three (ProspectsView keeps only the unified widget).

## Data model
No new persisted fields. Uses existing `cadence`, `touchLog`, `emailLog`. (An `emailLog` entry + a `touchLog` entry are both written when an outreach email is sent.)

## Components touched
- `src/lib/followupEngine.mjs` — core unchanged (logTouch already channel-agnostic).
- `src/lib/outreachReminders.js` — strip `getOutreachReminders` + 3/5-day math; keep step-lookup helpers and add `nextOutreachStep`.
- `src/components/SendOutreachEmail.jsx` / its parent handler — also log a touch on send.
- `src/components/FollowupDueWidget.jsx` — add the "Send next email" suggested action.
- `src/components/OutreachRemindersWidget.jsx` — removed.
- `src/components/views/ProspectsView.jsx`, `CpaDashboard.jsx`, `Dashboard.jsx` — swap OutreachRemindersWidget → FollowupDueWidget.

## Testing
- `followupEngine.test.mjs` (existing) — logTouch advancing cadence is already covered; add: an `email`-channel touch advances the cadence the same as call/text.
- New/updated `outreachReminders.test.mjs` — `nextOutreachStep`/`lastSentStep` returns the next unsent template; returns none when all sent.
- A combined test: a prospect with Email 1 sent + a later call touch → cadence advanced, no "email due" surfaced (the unified list is cadence-driven, so a call clears it).

## Edge cases
- Outreach not started (no emails sent) + cadence due → widget shows "Send Email 1" as the suggested action.
- All outreach emails sent + cadence still due → "Log touch" only (no email left to suggest).
- Terminal stages (SOLD/LOST) → cadence completes / no follow-up (existing behavior).
- Beta gating: OutreachRemindersWidget was behind the `outreach_emails` beta flag. The unified widget shows follow-ups for everyone; the **Send-email action** stays gated behind `outreach_emails` (non-beta users see Log touch only).
