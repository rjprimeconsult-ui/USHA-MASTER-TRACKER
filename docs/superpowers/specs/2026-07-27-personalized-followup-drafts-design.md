# Personalized Follow-up Drafts + Appointment Reminders — Design Spec

**Date:** 2026-07-27
**Status:** Approved by Juan (verbal, via brainstorming) — "All right sounds good write the spec and let's execute."
**Request:** A field agent suggested PRIM's sample follow-up text should be written from each prospect's own notes rather than being the same script for everyone. Juan: *"the whole purpose of this is to create a way that Prim acts intelligently and is able to adapt to each situation properly."*

## 1. Problem

PRIM's follow-up scripts are a fixed playbook: stage → `steps[]`, each `{ afterDays, channel, script }` ([followupEngine.mjs:22](../../../src/lib/followupEngine.mjs)). `FollowupNextStep` substitutes `{first}`, `{time}`, `{agent}` ([FollowupNextStep.jsx:13](../../../src/components/FollowupNextStep.jsx)) and nothing else. Every prospect in the same stage at the same step gets **byte-identical text**. Prospects recognise a template.

Two structural gaps sit behind this:

1. **Three of the six stages Juan named have no follow-up sequence at all.** The playbook covers only `MISSED_APPT`, `PENDING_DECISION`, `FOLLOWUP_LATER`, `GHOSTED`. For `WEBBY_SET` / `WEBBY_CONFIRMED` / `APPOINTMENT_SET`, `playbookForStage` returns `[]`, so `FollowupNextStep` renders nothing ([line 24](../../../src/components/FollowupNextStep.jsx)) and no cadence is ever armed ([followupEngine.mjs:107](../../../src/lib/followupEngine.mjs)). PRIM has a 5-step sequence for chasing someone *after* they no-show and **nothing that helps prevent the no-show**.
2. **The cadence engine cannot schedule relative to an appointment.** Every step is `afterDays`, counted forward from stage entry or the last touch via `addDaysIso` ([followupEngine.mjs:89](../../../src/lib/followupEngine.mjs)). The string `appointmentTime` does not appear in the engine. A naive `afterDays: 1` confirmation fires 1 day after stage entry — possibly nine days early, possibly after the appointment already happened.

## 2. Decisions (locked with Juan)

| # | Decision |
|---|----------|
| D1 | **Augment, never replace.** The stock script remains the fallback. It is never what an *eligible* prospect sees. |
| D2 | Stages in scope (6): `WEBBY_SET`, `WEBBY_CONFIRMED`, `APPOINTMENT_SET`, `MISSED_APPT`, `PENDING_DECISION`, `FOLLOWUP_LATER`. **`GHOSTED`, `SOLD`, `LOST` get nothing.** |
| D3 | The three appointment stages get **new two-touch sequences**: evening before + ~2h before, both **anchored on `appointmentTime`**. |
| D4 | **Unconfirmed** (`WEBBY_SET`, `APPOINTMENT_SET`) → ask to confirm. **Confirmed** (`WEBBY_CONFIRMED`) → remind and add value, **ask nothing**. Re-asking a confirmed prospect hands back a booking already won. |
| D5 | The **morning-of message is assumptive in all three** appointment stages, including unconfirmed ones. Two hours out, "are we still on?" invites a cancellation rather than gathering information. |
| D6 | **No valid `appointmentTime` → PRIM stays silent.** No cadence, no card, no draft. |
| D7 | Drafts are generated **on first open of an eligible due prospect**, then **cached on the prospect**. Not on every render, not batch-prepared. |
| D8 | **Eligibility gate = evidence of a real conversation**: an agent-logged touch with a note, **or** a genuine TextDrip SMS thread. Nothing else opens the door. |
| D9 | `situation` is **supporting detail only** — it may supply a fact the draft leans on, but it can **never** be the reason personalisation is offered. There is no provenance on that field (six writers, none recorded), so it cannot be trusted as evidence of a conversation. |
| D10 | **`meds` is never sent to the model.** `situation` is health-scanned before it leaves the browser. TextDrip threads are summarised and health-scrubbed before use. |
| D11 | The AI **always drafts fresh** for eligible prospects. The stock script is a **brief** (purpose + register), *not* raw material to paraphrase. Prompt framing is "write the message this moment calls for", not "rewrite this". |
| D12 | The drafting call receives **what was already sent earlier in this sequence** and must not repeat it. |
| D13 | The model may return **"insufficient context"**. When it does, PRIM shows the stock script and offers no Personalize affordance — identical to having no notes. |
| D14 | Every draft is **editable** before sending. PRIM proposes; the agent owns what goes out. **Nothing auto-sends.** |
| D15 | Appointment-anchored steps **advance on time, not on logged touches** (see §4.3). The appointment does not wait for paperwork. |

### 2.1 Decision changed during spec-writing — REVIEW REQUIRED

**D16 — Appointment cadence state is *derived*, not stored. The one-time forward-arming migration described in the verbal design is no longer needed and is dropped.**

In the verbal design (Part 2) the plan was to arm cadences for the three new stages, plus a one-time migration arming forward from *today* so agents would not inherit a backdated overdue pile from `stageEnteredAt`.

Deriving the schedule from `appointmentTime` + `touchLog` at read time removes that problem at the source:

- Appointment in the **past** → sequence complete → never due, never shown.
- Appointment in the **future** → first becomes due the evening before.
- **No valid** `appointmentTime` → no cadence at all (D6).

There is no window in which a stale or backdated due date can exist, because no due date is persisted. **The "47 fake overdues on deploy day" risk is eliminated rather than mitigated**, no migration runs, no new fields are written to `prospects_v1`, and the staleness class of bug (a step going stale while the app sits open) cannot occur.

Net effect on what Juan approved: strictly better. The due list still grows — prospects appear the evening before their appointment — but it grows *forward* only.

### 2.2 Open decision for Juan — model tier

Defaulting to **Haiku 4.5**, consistent with all 8 existing PRIM Claude routes, switchable by one env var.

| Model | Est. monthly cost¹ | Note |
|---|---|---|
| **Haiku 4.5** (default) | ~$4 | Consistent with the rest of PRIM |
| Sonnet | ~$47 | Better prose; this is text agents send to clients |

¹ Assumes 23 agents × ~10 drafted follow-ups/day × ~1.5k in / ~150 out tokens. Cheap-and-reversible first: if agents report drafts reading flat, flip `FOLLOWUP_DRAFT_MODEL`. **Flagged for Juan — not blocking the build.**

## 3. Architecture

```
src/lib/apptCadence.mjs            NEW   appointment-anchored scheduling (pure, node --test)
src/lib/apptCadence.test.mjs       NEW   anchor math, DST, past-appt, ordering
src/lib/followupDraftGate.mjs      NEW   eligibility + PHI scrub + source assembly (pure)
src/lib/followupDraftGate.test.mjs NEW   agent-vs-machine touch, TextDrip, scrubber
src/lib/followupEngine.mjs         EDIT  new stages + appt-aware dueStatus/logTouch + playbook v2 merge
src/lib/followupEngine.test.mjs    EDIT  regression + new-stage coverage
src/app/api/followup-draft/route.js NEW  Claude drafting route
src/components/FollowupNextStep.jsx EDIT draft display, Redo, editable box
src/components/LeadTracker.jsx     EDIT  re-arm on appointmentTime change; playbook merge; thread playbook to stats
src/lib/followupStats.mjs          EDIT  accept playbook (dueStatus signature)
```

Two new pure `.mjs` modules because `npm test` = `node --test src/lib/*.test.mjs` and only dependency-free `.mjs` is importable there. All fragile logic lives in them.

## 4. Appointment-anchored cadence

### 4.1 Step shape

Existing steps are unchanged. Appointment steps use a new, mutually-exclusive anchor:

```js
{ anchor: 'evening_before', atHour: 18, channel: 'Text', script: '...' }
{ anchor: 'hours_before',   hours: 2,   channel: 'Text', script: '...' }
```

A step has **either** `afterDays` (existing behaviour) **or** `anchor` (new). Never both.

### 4.2 Anchor math — local time, following `reminderPresetAt`

Timezone is the sharpest edge in this spec. "6 PM the day before" must mean 6 PM in the **agent's local evening**, not UTC; a UTC implementation fires reminders at 2 AM for half the country. The engine already solves this correctly in `reminderPresetAt` ([followupEngine.mjs:243](../../../src/lib/followupEngine.mjs)) by constructing dates from local components. **Follow that pattern; do not introduce a second approach.**

```
evening_before: new Date(apptY, apptMo, apptD - 1, atHour, 0, 0, 0)
hours_before:   new Date(apptMs - hours * 3600000)
```

`new Date(y, mo, d - 1, ...)` handles month/year rollover natively. DST is handled because the components are local.

### 4.3 Derived schedule (D15, D16)

For a prospect in an appointment stage, given `appointmentTime` and the stage's steps:

1. **Invalid or missing `appointmentTime`** → `{ state: 'none' }`. Validity uses the same hard validator as the appointment column ([ProspectsView.jsx:49](../../../src/components/views/ProspectsView.jsx)) — must contain a digit and a date separator, parse to a real date, and have year ≥ 2000 — so the scheduler and the display never disagree about what counts as an appointment.
2. **`now >= appointmentTime`** → `{ state: 'done' }`. The sequence closes when the appointment arrives. No "confirming tomorrow" sitting at 12 days overdue.
3. Otherwise compute each step's absolute due time; the **current step is the last one whose due time has passed**. If none has passed, the sequence is `ontrack` with `nextDueAt` = the first step's due time.
4. **Step satisfaction:** a step is satisfied if `touchLog` contains an agent touch with `at` inside that step's window `[stepDue, nextStepDue)`. A satisfied current step renders as handled with the next due time shown, so the agent is not nagged for work already done.

Step ordering is guaranteed for all realistic appointment times: for an appointment at 00:30, `evening_before` is the prior day 18:00 and `hours_before(2)` is 22:30 the prior day — still ordered. Implementations must **sort computed due times ascending** rather than trusting array order, and tests must cover the midnight-adjacent case.

### 4.4 `dueStatus` signature change

`dueStatus(prospect, now)` → `dueStatus(prospect, now, playbook)`. `playbook` is **optional**; when absent the function behaves exactly as today, so no call site breaks silently. Appointment-stage derivation requires it (the anchors live in the steps).

Call sites to update: [FollowupNextStep.jsx:26](../../../src/components/FollowupNextStep.jsx), [FollowupDueWidget.jsx:28](../../../src/components/FollowupDueWidget.jsx) (both already receive `playbook` as a prop), and `computeFollowupStats(prospects, now)` ([followupStats.mjs:11](../../../src/lib/followupStats.mjs)), which must gain a `playbook` param threaded from its caller.

### 4.5 `logTouch` must not compute day-based due dates for appointment steps

`logTouch` currently sets `nextDueAt = addDaysIso(now, steps[nextIndex].afterDays)` ([followupEngine.mjs:192](../../../src/lib/followupEngine.mjs)). For an appointment step `afterDays` is `undefined`, and `Number(undefined || 0)` is `0` — silently producing `nextDueAt = now`. **This is a live foot-gun the moment the new stages exist.**

For appointment stages, `logTouch` records the touch and clears `snoozedUntil` but **does not write `nextDueAt` or `stepIndex`** — the schedule is derived (§4.3). Everything else is unchanged.

### 4.6 Reschedule re-arms

`applyProspectUpdate` re-arms only when the **stage** changes ([LeadTracker.jsx:1579](../../../src/components/LeadTracker.jsx)). Because appointment scheduling is derived, a rescheduled appointment self-corrects on the next render with no re-arm needed — but the **cached draft must be invalidated** (§7), since it quotes the old time.

### 4.7 Playbook v2 merge

Saved playbooks load in preference to the default: `rawPlaybook ? JSON.parse(rawPlaybook) : DEFAULT_PLAYBOOK` ([LeadTracker.jsx:642](../../../src/components/LeadTracker.jsx)). Any user with a stored `followup_playbook_v1` would therefore **never receive the three new stages**. (No playbook-editor UI exists in the repo, so saved playbooks are expected to be rare or absent — but the merge is required for correctness regardless.)

Bump `DEFAULT_PLAYBOOK.version` to `2`. On load, merge: for every stage in `DEFAULT_PLAYBOOK.stages` absent from the saved playbook, add it. Never overwrite a stage the user already has.

## 5. The six new stock scripts

New token **`{apptTime}`** → time only, e.g. `2:00 PM`. The existing `{time}` renders `Thu, 2:00 PM` ([FollowupNextStep.jsx:16](../../../src/components/FollowupNextStep.jsx)), which reads as machine output inside "tomorrow at …". **`{time}` is unchanged** so none of the 18 existing scripts shift.

**`WEBBY_SET`** — scheduled, not yet confirmed. `onComplete: 'MISSED_APPT'`.

| Step | Message |
|---|---|
| `evening_before` 18:00 · Text | Hi {first}! Confirming our online review tomorrow at {apptTime} — does that still work on your end? Just reply yes and I'll send the link over. |
| `hours_before` 2 · Text | Hi {first}, we're set for {apptTime} today. I'll send the link a few minutes before — anything you'd like me to have ready? |

**`WEBBY_CONFIRMED`** — confirmed. Remind, add value, ask nothing (D4). `onComplete: 'MISSED_APPT'`.

| Step | Message |
|---|---|
| `evening_before` 18:00 · Text | Looking forward to our online review tomorrow at {apptTime}, {first}! I'll send the link about 10 minutes before so it's right at the top of your texts. |
| `hours_before` 2 · Text | Hi {first} — we're on for {apptTime} today. Sending the link shortly. See you then! |

**`APPOINTMENT_SET`** — booked, confirmation unknown; treated as unconfirmed. `onComplete: 'MISSED_APPT'`.

| Step | Message |
|---|---|
| `evening_before` 18:00 · Text | Hi {first}! Just confirming our call tomorrow at {apptTime} — still good on your end? |
| `hours_before` 2 · Text | Hi {first}, looking forward to our call at {apptTime} today. Talk soon! |

Note none of these contain a question in the morning-of slot (D5), and `WEBBY_CONFIRMED` contains no question at all (D4).

## 6. Eligibility gate — `followupDraftGate.mjs`

### 6.1 Touch provenance

| Writer | Signature | Verdict |
|---|---|---|
| `LogTouchSheet` (the agent) | `channel` ∈ `CHANNELS`, `outcome` ∈ `OUTCOMES` (capitalised) | ✅ **agent** |
| `applyOutreachEmail` ([followupEngine.mjs:206](../../../src/lib/followupEngine.mjs)) | `channel: 'email'` (lowercase), `outcome: 'sent'` | ❌ machine — neither value exists in the constant lists, so this is an unambiguous fingerprint |
| Website-form re-submit ([webforms.mjs:448](../../../src/lib/webforms.mjs)) | `channel: 'Other'`, `outcome: 'Other'`, note begins `Submitted your website form again` | ❌ machine — channel/outcome are legitimate human values, so **only the note prefix distinguishes it** |

**Going forward**, stamp new touches with `by: 'agent' | 'system'` at creation so future code does not depend on fingerprinting. Fingerprints remain for historical rows and must stay.

### 6.2 The gate

A prospect is eligible when **both** hold:

1. `stage` ∈ the six (D2); and
2. **either** at least one agent touch (§6.1) with a non-empty `note`, **or** a genuine TextDrip thread — `textdripChat.messages` non-empty ([textdrip.mjs:328](../../../src/lib/textdrip.mjs)) — containing at least one inbound message.

A `situation` alone **never** qualifies (D9), which permanently kills the "BENEPATH LEAD" class of filler ([import-prospects-ai/route.js:112](../../../src/app/api/import-prospects-ai/route.js)) without needing a length heuristic. Requiring an *inbound* TextDrip message means an outbound-only blast is not mistaken for a conversation.

### 6.3 PHI scrub (D10)

Applied **in the browser, before the request leaves**:

- `meds` — never included. Not scrubbed, not summarised: absent from the payload entirely.
- `situation` — health-language scan; matched spans are dropped rather than the whole field, so non-health context survives.
- TextDrip messages — reduced to a short context summary with the same scan applied, never sent raw. Raw threads are prospect-written and unfiltered, and prospects volunteer clinical detail freely.

The scrubber is pure and unit-tested against the actual patterns PRIM's importers produce. It is a **defence-in-depth layer, not the only one** — the prompt also forbids health references (§7.2), and a human reads every message before it sends (D14).

## 7. Drafting route and caching

### 7.1 `POST /api/followup-draft`

Follows the established pattern of PRIM's 8 Claude routes: Supabase bearer → `requireUserId`, JSON-schema tool call, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. **Prospect content is never logged** — no notes, no drafts, no message bodies, in success or error paths.

Request carries the stock script (the brief), stage, confirmed/unconfirmed flag, step purpose, scrubbed context, prior messages already sent this sequence (D12), first name, and `{apptTime}`.

Response: `{ text }` **or** `{ insufficient: true }` (D13).

### 7.2 Prompt contract

Framed as **"write the message this moment calls for"** (D11) — never "rewrite the following". The stock script is supplied as *purpose and register*. Rewrite framing yields paraphrase: the same sentence with one bolted-on clause, which is precisely the templated feel this feature exists to remove.

Hard bars:

1. Keep the step's purpose — a confirm stays a confirm, a breakup stays a breakup.
2. Never re-open a confirmed appointment — no question that can be answered "can we move it?"
3. **Only facts present in the supplied notes.** No inference, no extrapolation, no plausible gap-filling. This is the rule that prevents "hope the new job's going well" reaching someone who never mentioned a job.
4. No health references, ever.
5. **No claims** — no savings, rates, or approval promises. An unconstrained model drifts into promises, and those are a compliance exposure in R&J Prime's name.
6. Texting length — within a sentence of the stock script.
7. Copy `{apptTime}` exactly; never restate or round it.
8. Do not repeat anything in the already-sent list (D12).
9. Nothing specific worth saying → return `insufficient` rather than padding.

### 7.3 Cache

One draft per prospect, **overwritten** — never a history. All prospects live in a single `prospects_v1` key ([storage.js:178](../../../src/lib/storage.js)) read on every app load, so a per-prospect draft log would inflate the hot path.

```js
draft: { text, stepKey, sourceHash, at }
```

`sourceHash` covers the agent notes, scrubbed situation, `appointmentTime`, and `stepKey`. A draft is stale when the recomputed hash differs — which covers a new touch, an edited note, a reschedule, and a step advance in one mechanism rather than four separate invalidation paths that can each be missed. **Stale ⇒ regenerate on next open.**

## 8. UI — `FollowupNextStep.jsx`

The existing card keeps its structure. Changes:

- Eligible + due + no fresh cached draft → generate on open (D7), with a brief inline loading state.
- Draft renders in an **editable** textarea (D14); edits persist to the cache so they survive a re-open.
- Footer: provenance line (*"Personalized from your note on Tue, Jul 21"*), **Redo**, **Copy**, **Log touch**.
- Ineligible, or `insufficient` → today's stock script, **no Personalize affordance, no AI call ever made**.
- Failure → stock script plus a quiet retry (§10).

**Dark mode:** the remap table in `globals.css` keys on exact class names, so `/70`-suffixed opacity variants (`hover:bg-slate-50/70`, `border-slate-200/70`) are **not** remapped — the trap that produced an invisible hover state on the CSV export modal. New markup must avoid `/70` suffixes and be verified in both themes.

**Team-leader mirror:** `ProspectsView` renders another agent's data in read-only mode. The draft affordance must sit behind the same `!readOnly` guard used for the CSV export button, so a team leader never triggers drafting against an agent's prospects.

## 9. Explicitly out of scope

- Auto-sending. Nothing sends; the agent copies (D14).
- Personalisation for `GHOSTED` / `SOLD` / `LOST` (D2).
- A playbook-editor UI.
- Backfilling provenance onto historical `situation` values — impossible, the information was never recorded (D9).
- Batch/overnight pre-generation (D7).
- Changing the 18 existing scripts or the `{time}` token.
- **Any change to the blast capture path** — untouched, as always.

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Route 5xx / network | Stock script shown; one quiet retry on next open; never a blocking error |
| Model returns `insufficient` | Stock script; no affordance; cached so it is not re-attempted until inputs change |
| Malformed model output | Treated as failure; stock script; **never rendered raw** |
| `ANTHROPIC_API_KEY` missing | Feature silently absent; PRIM behaves exactly as today |
| Invalid `appointmentTime` | No cadence, no card (D6) |
| Auth failure | 401; client falls back to stock script |

The invariant: **every failure path degrades to today's behaviour.** The feature can be entirely broken and PRIM's follow-up system still works exactly as it does now.

## 11. Testing

`npm test` (`node --test src/lib/*.test.mjs`) — dependency-free `.mjs` only.

**`apptCadence.test.mjs`** — heaviest coverage, since timezone is the top risk:
- `evening_before` across month and year rollover; across a **DST boundary in both directions**; midnight-adjacent appointments (00:30) where the two steps land on the same prior day and ordering must hold.
- `hours_before` ordering vs `evening_before` for early-morning appointments.
- Past appointment → `done`. Appointment exactly `now` → `done`.
- Invalid `appointmentTime` shapes → `none`, using the same rejects as `formatAppt` (empty, no digits, no separator, unparseable, pre-2000 epoch fallback).
- Step satisfaction from a touch inside the window; a touch outside it does not satisfy.

**`followupDraftGate.test.mjs`**:
- Agent touch with a note → eligible.
- Lowercase `email`/`sent` outreach touch → **not** eligible.
- Website-form re-submit touch (`Other`/`Other` + note prefix) → **not** eligible.
- Agent touch with an empty note → not eligible.
- TextDrip thread with an inbound message → eligible; outbound-only → not.
- Benepath-written `situation` alone → not eligible.
- Out-of-scope stage with a valid agent touch → not eligible.
- Scrubber: `meds` never present in output; health spans removed from `situation` with surrounding context preserved.

**`followupEngine.test.mjs`** — regression:
- All existing tests still pass (`afterDays` behaviour untouched).
- `dueStatus` without `playbook` behaves exactly as before.
- `logTouch` on an appointment stage does **not** write `nextDueAt` (§4.5 foot-gun).
- Playbook v2 merge adds missing stages and never overwrites existing ones.

**Not unit-testable here:** the route and the JSX. PRIM has no component-test infrastructure — the same structural gap flagged during the taken-rate work. Covered by live browser verification in **both themes** before merge, plus code review.

## 12. Security & compliance

- **No PHI** (D10): `meds` never leaves the browser; `situation` and TextDrip threads scrubbed; the prompt forbids health references; a human reads every message. PRIM's no-PHI posture ([NoPhiBanner.jsx](../../../src/components/NoPhiBanner.jsx)) is preserved.
- **No auto-send** (D14) — the standing hard gate on actions that reach a real person is respected: drafting is not gated, sending is, and PRIM never sends.
- **No claims** in generated text (§7.2 bar 5).
- Prospect content is **never logged** server-side.
- Auth via `requireUserId`, consistent with every other AI route.
- Team-leader mirror is read-only (§8).
- The blast capture path is untouched.

## 13. Rollout

1. Branch `followup-personalized-drafts`; TDD the two pure modules first.
2. `npm test` + `npm run lint` + `npm run build` green.
3. Live verification in both themes: eligible prospect, ineligible prospect, `insufficient`, route failure, reschedule invalidation, team-leader mirror.
4. Fresh-context adversarial review against this spec.
5. Juan merges; `/api/version` polled to confirm the deploy.
6. Announcement (`src/lib/announcements.js`) — including that **the feature rewards logging touches**: agents who log their conversations get messages that sound like they remember; agents who don't, get the template.
