# Personalized Follow-up Drafts + Appointment Reminders — Design Spec

**Date:** 2026-07-27
**Status:** Approved by Juan (verbal, via brainstorming) — "All right sounds good write the spec and let's execute." **Revision 2** after adversarial review (see §14).
**Request:** A field agent suggested PRIM's sample follow-up text should be written from each prospect's own notes rather than being the same script for everyone. Juan: *"the whole purpose of this is to create a way that Prim acts intelligently and is able to adapt to each situation properly."*

## 1. Problem

PRIM's follow-up scripts are a fixed playbook: stage → `steps[]`, each `{ afterDays, channel, script }` ([followupEngine.mjs:22](../../../src/lib/followupEngine.mjs)). `FollowupNextStep` substitutes `{first}`, `{time}`, `{agent}` ([FollowupNextStep.jsx:13](../../../src/components/FollowupNextStep.jsx)) and nothing else. Every prospect in the same stage at the same step gets **byte-identical text**. Prospects recognise a template.

Two structural gaps sit behind this:

1. **Three of the six stages Juan named have no follow-up sequence at all.** The playbook covers only `MISSED_APPT`, `PENDING_DECISION`, `FOLLOWUP_LATER`, `GHOSTED`. For `WEBBY_SET` / `WEBBY_CONFIRMED` / `APPOINTMENT_SET`, `playbookForStage` returns `[]`, so `FollowupNextStep` renders nothing ([line 24](../../../src/components/FollowupNextStep.jsx)) and no cadence is armed ([followupEngine.mjs:108](../../../src/lib/followupEngine.mjs)). PRIM has a 5-step sequence for chasing someone *after* they no-show and **nothing that helps prevent the no-show**.
2. **The cadence engine cannot schedule relative to an appointment.** Every step is `afterDays`, counted forward from stage entry or the last touch via `addDaysIso` ([followupEngine.mjs:89](../../../src/lib/followupEngine.mjs)). The string `appointmentTime` does not appear in the engine.

## 2. Decisions (locked with Juan)

| # | Decision |
|---|----------|
| D1 | **Augment, never replace.** The stock script remains the fallback. It is never what an *eligible* prospect sees. |
| D2 | Stages in scope (6): `WEBBY_SET`, `WEBBY_CONFIRMED`, `APPOINTMENT_SET`, `MISSED_APPT`, `PENDING_DECISION`, `FOLLOWUP_LATER`. **`GHOSTED`, `SOLD`, `LOST` get nothing.** |
| D3 | The three appointment stages get **new two-touch sequences**: evening before + ~2h before, both **anchored on `appointmentTime`**. |
| D4 | **Unconfirmed** (`WEBBY_SET`, `APPOINTMENT_SET`) → ask to confirm. **Confirmed** (`WEBBY_CONFIRMED`) → remind and add value, **ask nothing**. Re-asking a confirmed prospect hands back a booking already won. |
| D5 | The **morning-of message is assumptive in all three** appointment stages, including unconfirmed ones. |
| D6 | **No usable `appointmentTime` → PRIM stays silent.** No cadence, no card, no draft. See §4.2 — "usable" excludes date-only values. |
| D7 | Drafts are generated **on first open of an eligible due prospect**, then cached. Not on every render, not batch-prepared. |
| D8 | **Eligibility gate = evidence of a real conversation**: an agent-logged touch with a note, **or** a genuine TextDrip SMS thread with an inbound message. Nothing else. |
| D9 | `situation` is **supporting detail only** — never the reason personalisation is offered. Six writers, no recorded provenance. |
| D10 | **`meds` is never sent to the model.** `situation` is health-scanned before leaving the browser. TextDrip threads are summarised and scrubbed, never sent raw. |
| D11 | The AI **always drafts fresh** for eligible prospects. The stock script is a **brief** (purpose + register), *not* raw material to paraphrase. |
| D12 | The drafting call receives **what was already sent earlier in this sequence** and must not repeat it. |
| D13 | The model may return **"insufficient context"** → stock script, no affordance. |
| D14 | Every draft is **editable**. PRIM proposes; the agent owns what goes out. **Nothing auto-sends.** |
| D15 | Appointment steps **advance on time, not on logged touches** — implemented via reconciliation (§4.4), not read-time derivation. |
| D16 | **Cadence state is STORED in the existing `cadence` fields, anchored on `appointmentTime`.** Superseded revision 1's read-time derivation. See §14.1. |
| D17 | Drafts are stored in a **separate `followup_drafts_v1` key**, never on the prospect record. See §14.2. |

### 2.1 Open decision for Juan — model tier

Defaulting to **Haiku 4.5**, consistent with all 8 existing PRIM Claude routes, switchable via `FOLLOWUP_DRAFT_MODEL`.

| Model | Est. monthly cost¹ |
|---|---|
| **Haiku 4.5** (default) | ~$4 |
| Sonnet | ~$47 |

¹ 23 agents × ~10 drafted follow-ups/day × ~1.5k in / ~150 out tokens. Cheap-and-reversible first. **Not blocking the build.**

## 3. Architecture

```
src/lib/apptCadence.mjs             NEW   appointment anchoring + reconciliation (pure, node --test)
src/lib/apptCadence.test.mjs        NEW   validator, anchor math, DST, reconcile, ordering
src/lib/followupDraftGate.mjs       NEW   eligibility + PHI scrub + source assembly (pure)
src/lib/followupDraftGate.test.mjs  NEW   agent-vs-machine touch, TextDrip, scrubber
src/lib/followupDraftStore.js       NEW   followup_drafts_v1 read/write/prune
src/lib/followupEngine.mjs          EDIT  3 new stages; appt-aware arm/logTouch; unconditional playbook merge
src/lib/followupEngine.test.mjs     EDIT  regression + new-stage coverage
src/app/api/followup-draft/route.js NEW   Claude drafting route
src/components/FollowupNextStep.jsx EDIT  early-return on 'none'; draft display; Redo; editable box
src/components/views/ProspectsView.jsx EDIT import the canonical appointment validator (§4.2)
src/components/views/CpaDashboard.jsx  EDIT pass `playbook` to FollowupDueWidget
src/components/views/Dashboard.jsx     EDIT pass `playbook` to FollowupDueWidget
src/components/LeadTracker.jsx      EDIT  reconcile on load/sync/update; playbook merge
```

Two new pure `.mjs` modules because `npm test` = `node --test src/lib/*.test.mjs` and only dependency-free `.mjs` is importable there.

**`dueStatus` keeps its current signature.** Revision 1 proposed adding a `playbook` parameter; review found six call sites, not three — including [reminders/route.js:320](../../../src/app/api/reminders/route.js), a server-side nightly job that never loads `followup_playbook_v1` and structurally could not supply one. Storing real due dates in `cadence` (D16) means every existing consumer keeps working untouched.

## 4. Appointment-anchored cadence

### 4.1 Step shape

A step has **either** `afterDays` (existing) **or** `anchor` (new). Never both.

```js
{ anchor: 'evening_before', atHour: 18, channel: 'Text', script: '...' }
{ anchor: 'hours_before',   hours: 2,   channel: 'Text', script: '...' }
```

`atHour` must stay outside 02:00–03:59: a local wall-clock time inside a spring-forward gap does not exist and is silently shifted. Enforced by a unit test over the shipped playbook, not left to reviewer memory.

### 4.2 What counts as a usable appointment time (D6)

**Canonical validator lives in `apptCadence.mjs` and is exported.** `ProspectsView`'s two private copies (`formatAppt` [:50](../../../src/components/views/ProspectsView.jsx), `apptDate` [:66](../../../src/components/views/ProspectsView.jsx)) are replaced by imports so display and scheduling cannot drift. Revision 1 claimed they shared a validator; they could not — both are unexported, in a `'use client'` file that imports lucide-react.

Two distinct verdicts:

- **`displayable`** — current behaviour: contains a digit, contains one of `[-/T:]`, parses, year ≥ 2000. Used for the appointment column. Unchanged.
- **`schedulable`** — displayable **AND carries an explicit time-of-day**.

The second is new and load-bearing. Date-only values are an explicitly supported shape ([import-prospects-ai/route.js:153](../../../src/app/api/import-prospects-ai/route.js) — *"ISO 8601 datetime or YYYY-MM-DD or empty"*). `new Date('2026-08-14')` parses as **UTC midnight**, which is `Aug 13, 8:00 PM` in Eastern. Scheduling off that would mark the sequence complete a day early, anchor `evening_before` to Aug 12, and render `{apptTime}` as **"8:00 PM"** — which §7.2 bar 7 instructs the model to copy verbatim. The agent would send a client a confirmation for the wrong day at the wrong time.

**Date-only is `displayable` but not `schedulable`.** No cadence, no card, no draft.

### 4.3 Anchor math — local time

Timezone is the sharpest edge in this spec. "6 PM the day before" must mean 6 PM in the **agent's local evening**. The engine already solves this in `reminderPresetAt` ([followupEngine.mjs:243](../../../src/lib/followupEngine.mjs)) by constructing from local components. **Follow that pattern; do not add a second approach.**

```
evening_before: new Date(apptY, apptMo, apptD - 1, atHour, 0, 0, 0)
hours_before:   new Date(apptMs - hours * 3600000)
```

`new Date(y, mo, d-1, …)` handles month/year rollover natively and resolves local wall-clock through the zone's rules for that date. Implementations must **sort computed due times ascending** rather than trusting array order.

### 4.4 Reconciliation — `reconcileApptCadence(prospect, steps, now)`

Pure. Returns the `cadence` object to store, or `null` when the stage is not appointment-anchored.

1. Not `schedulable` (§4.2) → `{ stepIndex: 0, nextDueAt: null, snoozedUntil: preserved, completedAt: null }` → `dueStatus` reports `'none'`.
2. `now >= appointmentTime` → `completedAt = appointmentTime` → `'done'`. The sequence closes when the appointment arrives.
3. Otherwise compute all step due times (§4.3), sort ascending. A step is **satisfied** when `touchLog` contains an agent touch (§6.1) with `at` inside `[stepDue, nextStepDue)`. `stepIndex` = the first unsatisfied step; `nextDueAt` = its due time. All satisfied → `completedAt = now`.

Because `nextDueAt` is written as a real absolute timestamp, **every existing consumer works unchanged** — `dueStatus`, `FollowupDueWidget`, `computeFollowupStats`, `ProspectsView`'s `isOverdueFollowup`/`FollowupDot`, and the nightly `reminders` route. `snoozedUntil` is preserved, so the Snooze buttons ([FollowupNextStep.jsx:65](../../../src/components/FollowupNextStep.jsx)) keep working. `completedAt` is genuinely set, so the `onComplete` handoff to `MISSED_APPT` via `suggestStageAfterTouch` ([followupEngine.mjs:339](../../../src/lib/followupEngine.mjs)) actually fires.

**No fake-overdue pile:** the first armed `nextDueAt` for a future appointment is the evening before — in the future. Past appointments reconcile straight to `done`. Nothing is ever backdated, so revision 1's one-time migration is unnecessary for the reason it was proposed.

### 4.5 The `afterDays: undefined` foot-gun — all three sites

`addDaysIso(iso, undefined)` returns `iso` unchanged, because `Number(undefined || 0)` is `0` and `setUTCDate(+0)` is a no-op ([followupEngine.mjs:89](../../../src/lib/followupEngine.mjs)). Three functions compute due dates from `steps[i].afterDays`, each guarded by `if (steps.length === 0) return …` — **a guard that stops firing the moment the new stages have steps**:

| Site | Line | Currently yields | Consequence if unfixed |
|---|---|---|---|
| `armIfNeeded` | [:115](../../../src/lib/followupEngine.mjs) | `nextDueAt = stageEnteredAt` | Backdated overdue on every load, persisted |
| `armCadence` | [:131](../../../src/lib/followupEngine.mjs) | `nextDueAt = now` | See §4.6 |
| `logTouch` | [:192](../../../src/lib/followupEngine.mjs) | `nextDueAt = now` | Reminder re-fires immediately |

**All three must route appointment stages through `reconcileApptCadence` instead.** Revision 1 addressed only `logTouch` and then asserted no backdated date could exist — false, and the exact failure mode that shipped in the taken-rate work: one site checked, the class declared handled.

### 4.6 Regression this prevents: "Booked appt → Appointment Set"

`suggestStageAfterTouch` suggests `APPOINTMENT_SET` on outcome `'Booked appt'` ([followupEngine.mjs:332](../../../src/lib/followupEngine.mjs)). Accepting it calls `armCadence` ([LeadTracker.jsx:1589](../../../src/components/LeadTracker.jsx)). Today `APPOINTMENT_SET` has no steps, so `nextDueAt` is `null` and the prospect leaves the due list. With steps but without §4.5, `armCadence` would set `nextDueAt = now` — an agent books an appointment for next Tuesday and the prospect **immediately** shows "Due today", a coloured `FollowupDot`, and a line in that night's reminder email. Reconciliation gives the correct answer: the evening before next Tuesday.

### 4.7 When reconciliation runs

[LeadTracker.jsx:646](../../../src/components/LeadTracker.jsx) (load), [:754](../../../src/components/LeadTracker.jsx) (cloud sync), `onAddProspect`, `applyStageSuggestion`, after `logTouch`, and — **new** — `applyProspectUpdate` for **any** change to an appointment-stage prospect, not only stage changes ([LeadTracker.jsx:1579](../../../src/components/LeadTracker.jsx)). That last one is what makes a reschedule re-anchor.

Once written, a future `nextDueAt` needs no further reconciliation: `dueStatus` compares it to `now` on every render. Reconciliation exists to *set* correct dates, not to keep time.

**Honest limit:** `FollowupDueWidget` memoizes on `[prospects]` and computes `now` inside the memo ([FollowupDueWidget.jsx:24](../../../src/components/FollowupDueWidget.jsx)). A step coming due at 18:00 while the tab sits open appears on the next re-render, not at the stroke of 18:00. This is pre-existing for all stages and is **not** fixed here; revision 1 wrongly claimed the staleness class was eliminated.

### 4.8 Playbook merge

Saved playbooks load in preference to the default ([LeadTracker.jsx:642](../../../src/components/LeadTracker.jsx)), so a stored `followup_playbook_v1` would never receive the new stages. **Merge unconditionally on every load**: for each stage in `DEFAULT_PLAYBOOK.stages` absent from the saved playbook, add it; never overwrite an existing stage. No version gate — nothing reads `DEFAULT_PLAYBOOK.version`, so a bump would be inert and misleading.

## 5. The six new stock scripts

New token **`{apptTime}`** → time only, e.g. `2:00 PM`. Existing `{time}` renders `Thu, 2:00 PM` ([FollowupNextStep.jsx:16](../../../src/components/FollowupNextStep.jsx)) and is **unchanged**, so none of the 18 existing scripts shift.

**`WEBBY_SET`** — scheduled, not confirmed. `onComplete: 'MISSED_APPT'`.

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

No question appears in any morning-of slot (D5); `WEBBY_CONFIRMED` contains no question at all (D4).

## 6. Eligibility gate — `followupDraftGate.mjs`

### 6.1 Touch provenance

| Writer | Signature | Verdict |
|---|---|---|
| `LogTouchSheet` (the agent) | `channel` ∈ `CHANNELS`, `outcome` ∈ `OUTCOMES` (capitalised) | ✅ **agent** |
| `applyOutreachEmail` ([followupEngine.mjs:206](../../../src/lib/followupEngine.mjs)) | `channel: 'email'` (lowercase), `outcome: 'sent'` | ❌ machine — neither value exists in the constant lists |
| Website-form re-submit ([webforms.mjs:450](../../../src/lib/webforms.mjs)) | `channel: 'Other'`, `outcome: 'Other'`, note begins `Submitted your website form again` | ❌ machine — **only the note prefix distinguishes it** |

Confirmed complete by review: these are the only writers of touch entries in `src/`.

**Going forward**, stamp new touches with `by: 'agent' | 'system'` at creation. Fingerprints remain for historical rows.

### 6.2 The gate

Eligible when **both** hold:

1. `stage` ∈ the six (D2); and
2. **either** ≥1 agent touch (§6.1) with a non-empty `note`, **or** `textdripChat.messages` ([textdrip.mjs:329](../../../src/lib/textdrip.mjs)) containing ≥1 message with `direction: 'in'` ([textdrip.mjs:95](../../../src/lib/textdrip.mjs)).

`situation` alone **never** qualifies (D9), permanently killing the "BENEPATH LEAD" filler class ([import-prospects-ai/route.js:112](../../../src/app/api/import-prospects-ai/route.js)) without a length heuristic. Requiring an *inbound* message means an outbound-only blast is not mistaken for a conversation.

### 6.3 PHI scrub (D10)

Applied **in the browser, before the request leaves**:

- `meds` — absent from the payload entirely. Not scrubbed, not summarised.
- `situation` — health-language scan; matched spans dropped, surrounding context preserved.
- TextDrip messages — reduced to a short summary with the same scan, never sent raw.

Defence in depth, not the only layer: the prompt also forbids health references (§7.2), and a human reads every message (D14).

## 7. Drafting route, storage, caching

### 7.1 `POST /api/followup-draft`

Established pattern: Supabase bearer → `requireUserId`, JSON-schema tool call, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. **Prospect content is never logged**, in success or error paths.

Request: stock script (the brief), stage, confirmed flag, step purpose, scrubbed context, already-sent messages this sequence (D12), first name, `{apptTime}`.
Response: `{ text }` **or** `{ insufficient: true }` (D13).

### 7.2 Prompt contract

Framed as **"write the message this moment calls for"** (D11) — never "rewrite the following". Rewrite framing yields paraphrase: the same sentence with one bolted-on clause, precisely the templated feel this feature exists to remove.

Hard bars:

1. Keep the step's purpose — a confirm stays a confirm, a breakup stays a breakup.
2. Never re-open a confirmed appointment.
3. **Only facts present in the supplied notes.** No inference, no gap-filling. This prevents "hope the new job's going well" reaching someone who never mentioned a job.
4. No health references, ever.
5. **No claims** — no savings, rates, or approval promises. A compliance exposure in R&J Prime's name.
6. Texting length — within a sentence of the stock script.
7. Copy `{apptTime}` exactly.
8. Do not repeat anything in the already-sent list (D12).
9. Nothing specific worth saying → return `insufficient` rather than padding.

### 7.3 Draft storage — separate key (D17)

**Drafts are NOT stored on the prospect record.** `prospects_v1` is in `MERGEABLE_KEYS` ([storage.js:176](../../../src/lib/storage.js)) and `mergeArrayStores` resolves same-id conflicts by **whole-record newest-wins** on `updatedAt` ([mergeStore.mjs:56](../../../src/lib/mergeStore.mjs)), stamped whenever a record's object reference changes ([mergeStore.mjs:70](../../../src/lib/mergeStore.mjs)).

Caching on the prospect would turn *opening* one into a full-record write. Concrete data loss: an agent edits a phone number on their phone at 10:00; at 10:01 opens the same prospect on their laptop, drafting fires and caches, the laptop record wins on `updatedAt`, **the phone edit is gone**. Today, opening a prospect is a pure read.

Instead, `followup_drafts_v1` — a standalone key, id-keyed:

```js
{ [prospectId]: { text, stepKey, sourceHash, at } }
```

One entry per prospect, overwritten — never a history. Not added to `MERGEABLE_KEYS`: drafts are cheap to regenerate, so last-write-wins across devices is acceptable, whereas prospect records are not. Entries for archived or deleted prospects are pruned on load.

`sourceHash` covers the agent notes, scrubbed situation, `appointmentTime`, and `stepKey`. Stale when the recomputed hash differs — one mechanism covering a new touch, an edited note, a reschedule, and a step advance, rather than four invalidation paths that can each be missed.

## 8. UI — `FollowupNextStep.jsx`

- **Early return on `state === 'none'`** (before the `STATE_STYLE` lookup). `'none'` is not a key in `STATE_STYLE` ([FollowupNextStep.jsx:6](../../../src/components/FollowupNextStep.jsx)), so today it would silently fall back to `ontrack` styling and render the stock script with no due label — violating D6's "no card". The existing `steps.length === 0` early return ([:24](../../../src/components/FollowupNextStep.jsx)) stops firing once the new stages have steps.
- Step index comes from the reconciled `cadence.stepIndex`, so both this card and `FollowupDueWidget`'s "Next: {channel}" line ([FollowupDueWidget.jsx:78](../../../src/components/FollowupDueWidget.jsx)) show the right step. Revision 1 computed the current step and never delivered it to the render path, which would have pinned every card at "Step 1 of 2" — showing *"Confirming our online review tomorrow"* two hours before the appointment.
- Eligible + due + no fresh cached draft → generate on open (D7), brief inline loading state.
- Draft renders in an **editable** textarea (D14); edits persist to the cache.
- Footer: provenance (*"Personalized from your note on Tue, Jul 21"*), **Redo**, **Copy**, **Log touch**.
- Ineligible or `insufficient` → stock script, no affordance, **no AI call ever made**.

**Dark mode:** the remap table in `globals.css` ([:74-112](../../../src/app/globals.css)) keys on literal escaped class names and covers only `bg-slate-50\/60` and `bg-slate-50\/80`. **Any** opacity variant outside that table is unremapped — not just `/70`. Both files edited here already carry unremapped ones (`bg-indigo-50/40` [FollowupNextStep.jsx:9](../../../src/components/FollowupNextStep.jsx), `hover:bg-rose-50/40` [FollowupDueWidget.jsx:88](../../../src/components/FollowupDueWidget.jsx)). New markup must either use a listed utility or add the variant to the table, and be verified in both themes.

**Team-leader mirror:** `FollowupNextStep` already sits inside `{!readOnly && (` ([ProspectsView.jsx:1166](../../../src/components/views/ProspectsView.jsx)) — the guard is pre-satisfied. It must not be widened.

**`FollowupDueWidget` playbook prop:** passed from `ProspectsView` ([:1693](../../../src/components/views/ProspectsView.jsx)) but **not** from `CpaDashboard` ([:514](../../../src/components/views/CpaDashboard.jsx)) or `Dashboard` ([:183](../../../src/components/views/Dashboard.jsx)) — the default landing views. Without it the widget lists the prospect but omits the channel line. Both must pass it.

## 9. Explicitly out of scope

- Auto-sending. Nothing sends (D14).
- Personalisation for `GHOSTED` / `SOLD` / `LOST` (D2).
- A playbook-editor UI.
- Backfilling provenance onto historical `situation` values — the information was never recorded (D9).
- Batch/overnight pre-generation (D7).
- Changing the 18 existing scripts or the `{time}` token.
- Fixing the pre-existing `useMemo` staleness in `FollowupDueWidget` (§4.7).
- Threading a per-agent playbook into `teamMath` (§11 note).
- **Any change to the blast capture path.**

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Route 5xx / network | Stock script; one quiet retry on next open; never blocking |
| Model returns `insufficient` | Stock script; no affordance; cached so it is not re-attempted until inputs change |
| Malformed model output | Treated as failure; stock script; **never rendered raw** |
| `ANTHROPIC_API_KEY` missing | Feature silently absent |
| Not `schedulable` (§4.2) | No cadence, no card (D6) |
| Auth failure | 401; client falls back to stock script |

Invariant: **every failure path degrades to today's behaviour.**

## 11. Testing

`npm test` (`node --test src/lib/*.test.mjs`). Baseline before any change: **506 pass, 0 fail**.

**`apptCadence.test.mjs`** — heaviest coverage:
- `schedulable` vs `displayable`: `2026-08-14` (date-only) is displayable, **not** schedulable; `2026-08-14T14:00` is both. Plus the existing reject set (empty, no digits, no separator, unparseable, pre-2000).
- `evening_before` across month and year rollover, and a **DST boundary in both directions**; midnight-adjacent appointments (00:30) where both steps land on the prior day and ordering must hold.
- Shipped playbook assertion: no `atHour` in 02:00–03:59 (§4.1).
- Past appointment → `done`; appointment exactly `now` → `done`.
- Reconcile: unsatisfied step 0 → `stepIndex 0`; agent touch inside step 0's window → `stepIndex 1`; touch outside the window → no advance; all satisfied → `completedAt`; `snoozedUntil` preserved across reconciliation.

**`followupDraftGate.test.mjs`**:
- Agent touch with a note → eligible. Empty note → not.
- Lowercase `email`/`sent` outreach touch → **not** eligible.
- Website-form re-submit (`Other`/`Other` + note prefix) → **not** eligible.
- TextDrip thread with an inbound message → eligible; outbound-only → not.
- Benepath-written `situation` alone → not eligible.
- Out-of-scope stage with a valid agent touch → not eligible.
- Scrubber: `meds` never present in output; health spans removed with surrounding context preserved.

**`followupEngine.test.mjs`** — regression:
- All 506 existing tests still pass; `afterDays` behaviour untouched.
- **`armIfNeeded` on an appointment stage does not write a backdated `nextDueAt`** (§4.5).
- **`armCadence` on `APPOINTMENT_SET` does not yield `nextDueAt = now`** — the §4.6 "Booked appt" regression, asserted directly.
- `logTouch` on an appointment stage produces a reconciled, not day-based, `nextDueAt`.
- `completedAt` is set when the final appointment step is satisfied, so `suggestStageAfterTouch` reaches its `onComplete` branch.
- Playbook merge adds missing stages unconditionally and never overwrites.

**Not unit-testable here:** the route and the JSX — PRIM has no component-test infrastructure. Covered by live browser verification in **both themes** before merge, plus code review.

**Note (out of scope, §9):** `computeFollowupStats` is also called by `teamMath.mjs:83` over another agent's prospects, where the leader's playbook is the wrong one. Because `dueStatus` keeps its signature (§3), this path is unaffected by this change — recorded so it is not mistaken for a new defect.

## 12. Security & compliance

- **No PHI** (D10): `meds` never leaves the browser; `situation` and TextDrip threads scrubbed; the prompt forbids health references; a human reads every message. PRIM's no-PHI posture ([NoPhiBanner.jsx](../../../src/components/NoPhiBanner.jsx)) is preserved.
- **No auto-send** (D14): drafting is not gated, sending is, and PRIM never sends.
- **No claims** in generated text (§7.2 bar 5).
- Prospect content **never logged** server-side.
- Auth via `requireUserId`.
- Team-leader mirror read-only (§8).
- **No prospect-record writes on open** (§7.3) — no merge-clobber risk.
- Blast capture path untouched.

## 13. Rollout

1. Branch `followup-personalized-drafts`; TDD the two pure modules first.
2. `npm test` (≥506 pass) + `npm run lint` + `npm run build` green.
3. Live verification in both themes: eligible prospect, ineligible prospect, `insufficient`, route failure, reschedule invalidation, date-only appointment, "Booked appt → Appointment Set", team-leader mirror.
4. Fresh-context adversarial review against this spec.
5. Juan merges; `/api/version` polled to confirm.
6. Announcement ([announcements.js](../../../src/lib/announcements.js)) — including that **the feature rewards logging touches**: agents who log their conversations get messages that sound like they remember; agents who don't, get the template.

## 14. Revision history

### 14.1 Revision 2 — stored cadence replaces read-time derivation

Revision 1 derived appointment schedules at read time and stored nothing. Adversarial review found the approach fought the existing engine in five places:

- `dueStatus` has **six** call sites, not three — including [reminders/route.js:320](../../../src/app/api/reminders/route.js), a server-side nightly job with no access to the playbook. The nightly anti-no-show email could not have worked.
- `armIfNeeded` [:115](../../../src/lib/followupEngine.mjs) and `armCadence` [:131](../../../src/lib/followupEngine.mjs) carry the same `afterDays: undefined` foot-gun as `logTouch`. Revision 1 fixed one and asserted no backdated date could be persisted — **false**.
- `snoozedUntil` was never read, silently killing the Snooze buttons.
- `completedAt` was never set, making every new stage's `onComplete: 'MISSED_APPT'` handoff dead config.
- The computed step index never reached the render path; every card would have been pinned at step 1.

Storing reconciled dates in the existing `cadence` fields resolves all five, requires no `dueStatus` signature change, and still avoids the fake-overdue pile — because the anchor is the appointment (future), not `stageEnteredAt` (past).

### 14.2 Revision 2 — drafts moved off the prospect record

Revision 1 cached the draft on the prospect. `prospects_v1` merges whole-record newest-wins ([mergeStore.mjs:56](../../../src/lib/mergeStore.mjs)), so opening a prospect on a second device would have overwritten unsynced edits made on the first. Drafts now live in `followup_drafts_v1` (§7.3).

### 14.3 Revision 2 — other corrections

Date-only `appointmentTime` (§4.2); the `'none'` state rendering a card (§8); the canonical validator being unexportable from `ProspectsView` (§4.2); `FollowupDueWidget` missing its `playbook` prop on both dashboards (§8); the inert `version` bump (§4.8); the dark-mode rule being narrower than the actual trap (§8); and citation drift throughout.
