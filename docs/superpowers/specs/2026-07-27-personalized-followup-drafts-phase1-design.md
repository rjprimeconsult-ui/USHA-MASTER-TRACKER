# Personalized Follow-up Drafts — Phase 1 Design Spec

**Date:** 2026-07-27
**Status:** Approved by Juan — "Yes, spec Phase 1 only"
**Supersedes:** `2026-07-27-personalized-followup-drafts-design.md` (revisions 1 and 2), withdrawn after two adversarial reviews found 27 defects. See §12.

**Request:** A field agent suggested PRIM's sample follow-up text should be written from each prospect's own notes rather than being the same script for everyone. Juan: *"the whole purpose of this is to create a way that Prim acts intelligently and is able to adapt to each situation properly."*

## 1. Scope

**Phase 1 personalises the follow-up script for the three stages that already have working cadences.** Nothing else.

**In scope:** `PENDING_DECISION`, `FOLLOWUP_LATER`, `MISSED_APPT`.

**Out of scope — deferred to Phase 2:** `WEBBY_SET`, `WEBBY_CONFIRMED`, `APPOINTMENT_SET` and appointment-anchored reminders of any kind. Two review rounds established that an appointment reminder ("at 6 PM tomorrow, show this once") is not a follow-up cadence ("chase until they respond, advancing on each touch"), and that forcing it into `stepIndex` / `completedAt` / `onComplete` / `snoozedUntil` generates a new defect class every revision. Phase 2 will design it as its own surface.

**`GHOSTED`, `SOLD`, `LOST` get nothing**, in either phase.

### 1.1 The hard boundary

**This spec changes no scheduling behaviour whatsoever.** `followupEngine.mjs` gains no new stage, no new step shape, and no edit to `armIfNeeded`, `armCadence`, `logTouch`, `dueStatus`, or `snooze`. The playbook is not merged or versioned. `dueStatus` keeps its signature, so all six of its call sites — including the server-side nightly job at [reminders/route.js:320](../../../src/app/api/reminders/route.js) — are untouched.

Every defect in both withdrawn revisions lived in scheduling. Phase 1 does not go there.

## 2. Problem

`FollowupNextStep` substitutes `{first}`, `{time}`, `{agent}` into a fixed per-stage script ([FollowupNextStep.jsx:13](../../../src/components/FollowupNextStep.jsx)) and nothing else. Every prospect in the same stage at the same step gets **byte-identical text**. Prospects recognise a template.

The material to fix this already exists and agents already produce it — the notes they type when logging a touch, and the SMS threads TextDrip syncs in.

## 3. Decisions (locked with Juan)

| # | Decision |
|---|----------|
| D1 | **Augment, never replace.** The stock script stays. It is never what an *eligible* prospect sees. |
| D2 | Stages: `PENDING_DECISION`, `FOLLOWUP_LATER`, `MISSED_APPT` (§1). |
| D3 | **Eligibility = evidence of a real conversation**: an agent-logged touch with a note, **or** a TextDrip thread with an inbound message. Nothing else. |
| D4 | `situation` is **supporting detail only** — never the reason personalisation is offered. Six writers, no recorded provenance, and importers write filler like `"BENEPATH LEAD"` into it ([import-prospects-ai/route.js:112](../../../src/app/api/import-prospects-ai/route.js)). |
| D5 | **`meds` is never sent.** `situation` is health-scrubbed before leaving the browser; TextDrip threads are summarised and scrubbed, never sent raw. |
| D6 | The AI **always drafts fresh** for eligible prospects. The stock script is a **brief** (purpose + register), not raw material to paraphrase. |
| D7 | **Auto-generate when the follow-up is due** (`overdue` / `due_today`), cached thereafter. For a not-yet-due prospect the agent gets a manual **Personalize** button. This is the "mix of B and C" Juan asked for and it bounds cost to work actually being done. |
| D8 | The drafting call receives **earlier drafts in this sequence** and must not repeat them (§7.4). |
| D9 | The model may return **"insufficient context"** → stock script, no affordance, no retry until inputs change. |
| D10 | Every draft is **editable**. PRIM proposes; the agent owns what goes out. **Nothing auto-sends.** |
| D11 | Drafts live in their own registered storage key, never on the prospect record (§7.1). |

### 3.1 Open decision for Juan — model tier

Default **Haiku 4.5**, consistent with all 8 existing PRIM Claude routes, switchable via `FOLLOWUP_DRAFT_MODEL`. Phase 1 estimate: **~$2–3/month** (23 agents × ~6 drafted follow-ups/day × ~1.2k in / ~150 out). Sonnet would be ~10×. Cheap-and-reversible first. **Not blocking.**

## 4. Architecture

```
src/lib/followupDraftGate.mjs       NEW   eligibility + PHI scrub + source assembly (pure)
src/lib/followupDraftGate.test.mjs  NEW
src/lib/followupDraftCache.mjs      NEW   stepKey, sourceHash, prune (pure)
src/lib/followupDraftCache.test.mjs NEW
src/lib/storage.js                  EDIT  register 'followup_drafts_v1' in APP_KEYS (one line)
src/app/api/followup-draft/route.js NEW   Claude drafting route
src/components/FollowupNextStep.jsx EDIT  draft display, editable box, Personalize/Redo
src/components/views/ProspectsView.jsx EDIT load/save the drafts map, pass down
```

Two pure `.mjs` modules because `npm test` = `node --test src/lib/*.test.mjs` and only dependency-free `.mjs` is importable there. All logic that can be wrong lives in them.

**Baseline:** `npm test` → **506 pass, 0 fail** (verified 2026-07-27). No existing test may change.

## 5. Eligibility gate — `followupDraftGate.mjs`

### 5.1 Touch provenance

| Writer | Signature | Verdict |
|---|---|---|
| `LogTouchSheet` (the agent) | `channel` ∈ `CHANNELS`, `outcome` ∈ `OUTCOMES` (capitalised, [LogTouchSheet.jsx:4](../../../src/components/LogTouchSheet.jsx)) | ✅ **agent** |
| `applyOutreachEmail` ([followupEngine.mjs:206](../../../src/lib/followupEngine.mjs)) | `channel: 'email'` (lowercase), `outcome: 'sent'` | ❌ machine — neither value exists in the constant lists, so this is unambiguous |
| Website-form re-submit ([webforms.mjs:450](../../../src/lib/webforms.mjs)) | `channel: 'Other'`, `outcome: 'Other'`, note begins `Submitted your website form again` | ❌ machine — channel/outcome are legitimate human values, so **only the note prefix distinguishes it** |

Two independent reviews confirmed these are the **only** writers of touch entries in `src/`.

`isAgentTouch(touch)` returns true when `channel` ∈ `CHANNELS` **and** `outcome` ∈ `OUTCOMES` **and** the note does not start with `Submitted your website form again`.

**Going forward**, stamp new touches with `by: 'agent' | 'system'` at creation so future code need not fingerprint. Fingerprints stay for historical rows.

### 5.2 The gate

`isEligible(prospect)` — true when **both**:

1. `prospect.stage` ∈ `{ PENDING_DECISION, FOLLOWUP_LATER, MISSED_APPT }`; and
2. **either** ≥1 agent touch (§5.1) with a non-empty trimmed `note`, **or** `textdripChat.messages` ([textdrip.mjs:329](../../../src/lib/textdrip.mjs)) containing ≥1 message with `direction: 'in'` ([textdrip.mjs:99](../../../src/lib/textdrip.mjs)).

`situation` alone **never** qualifies (D4). This kills the filler class without a length heuristic. Requiring an *inbound* TextDrip message means an outbound-only blast is not mistaken for a conversation.

### 5.3 PHI scrub — `scrubHealth(text)`

Concrete algorithm, because "scan for health language" is not a specification and two engineers would ship two different compliance surfaces.

1. Split `text` into clauses on `/[.;!?\n]+/` and on ` — ` / ` · ` (the separator `buildSituation` uses, [benepath.mjs:150](../../../src/lib/benepath.mjs)).
2. Drop any clause matching `HEALTH_MARKERS` case-insensitively at a word boundary.
3. Re-join the survivors with `'. '`.
4. **If more than half the clauses were dropped, return `''`** — a field that is mostly health has lost its meaning, and the remainder is more likely to mislead than help.

`HEALTH_MARKERS` — three groups, all word-boundary matched:

- **Conditions:** diabetes, diabetic, cancer, asthma, COPD, arthritis, depression, anxiety, pregnant, pregnancy, surgery, chemo, dialysis, HIV, hepatitis, thyroid, blood pressure, cholesterol, heart condition, stroke, seizure, disability, disabled
- **Medication:** mg, mcg, prescription, Rx, medication, medications, meds, pills, insulin, inhaler
- **Care:** doctor, physician, specialist, hospital, diagnosis, diagnosed, treatment, therapy, procedure, biopsy, MRI, oncologist, cardiologist

Applied to `situation` and to the TextDrip summary. **`meds` is not scrubbed — it is never read** (D5).

**This is defence in depth, not the only layer.** A term list cannot be complete. The prompt also bars health references (§7.3 bar 4), and a human reads every message before it sends (D10). Stated plainly so nobody mistakes the scrubber for a compliance guarantee.

### 5.4 Source assembly

`buildDraftSource(prospect)` returns, in this order:

- `firstName`
- `agentNotes` — up to the **3 most recent** agent touches with notes, oldest→newest, each `{ at, outcome, note }`. Three because more dilutes the recent conversation, and the newest note is what the message should hinge on.
- `situation` — `scrubHealth(prospect.situation)`, omitted when empty
- `textdripSummary` — only when there are no agent notes at all. The **6 most recent** messages, `direction` + body, each `scrubHealth`'d, truncated to 800 chars total. Never the raw thread.

## 6. When drafting is triggered (D7)

Inside `FollowupNextStep`, which already receives everything needed:

| `dueStatus` state | Behaviour |
|---|---|
| `overdue`, `due_today` | Eligible → **auto-generate** on mount if no fresh cached draft. Ineligible → stock script, no affordance. |
| `ontrack`, `snoozed` | Eligible → stock script **plus a "Personalize" button**. Ineligible → stock script, no affordance. |
| `done`, `none` | Existing behaviour, unchanged. No draft, no affordance. |

**One in-flight request per prospect**, guarded by a ref so a re-render cannot refire it.

**Lint hazard:** `react-hooks/set-state-in-effect` blocked the CSV export modal build. State must be set from the promise continuation, never synchronously inside the effect body. If the rule still trips, restructure — do **not** disable it.

## 7. Storage, caching, invalidation

### 7.1 `followup_drafts_v1` — a registered key (D11)

**Add `'followup_drafts_v1'` to `APP_KEYS`** ([storage.js:353](../../../src/lib/storage.js)). This is one line and it is not optional:

- `purgeLocalMirror` iterates `APP_KEYS` ([storage.js:59](../../../src/lib/storage.js)). **An unregistered key survives sign-out**, so on a shared browser user B's `cloudGet` returns null, `getItem` falls back to localStorage ([storage.js:261](../../../src/lib/storage.js)), and B is served **A's drafts** — text derived from A's prospect notes and SMS threads — then persists them into B's cloud row. This is the exact incident class documented at [storage.js:43](../../../src/lib/storage.js): *"a new agent's account showed the founder's earned commissions."*
- `prefetch` defaults to `APP_KEYS` ([storage.js:274](../../../src/lib/storage.js)) and batches via a single `.in(list)` query, so registering costs **no extra round-trip**. Leaving it out would cost one serial read per load — the pattern behind the July DB-connection outage.
- `migrateLocalToCloud` ([storage.js:352](../../../src/lib/storage.js)) also iterates `APP_KEYS`.

**Not added to `MERGEABLE_KEYS`.** That set is for arrays of id'd records ([storage.js:176](../../../src/lib/storage.js)); this key holds a plain object map. Last-write-wins is correct here — a draft lost across devices is regenerated on next open, whereas a prospect edit is not recoverable.

**Drafts are never written to the prospect record.** `prospects_v1` merges whole-record newest-wins ([mergeStore.mjs:90](../../../src/lib/mergeStore.mjs)), so caching there would turn *opening* a prospect into a full-record write: edit a phone number on your phone at 10:00, open the same prospect on the laptop at 10:01, and the laptop's draft-write wins on `updatedAt` — **the phone edit is silently gone**.

### 7.2 Shape

```js
// followup_drafts_v1
{ [prospectId]: { text, stepKey, sourceHash, at, previous: [] } }
```

One live draft per prospect. `previous` is capped at **2** entries and exists only to serve D8 (§7.4).

**`stepKey`** = `` `${stage}:${stepIndex}` `` — e.g. `PENDING_DECISION:2`. `stepIndex` is `prospect.cadence.stepIndex`, exactly as `FollowupNextStep` already reads it ([FollowupNextStep.jsx:35](../../../src/components/FollowupNextStep.jsx)).

### 7.3 `sourceHash`

Deterministic, no `JSON.stringify` of an object (key order is not guaranteed). Join with ` `, in this fixed order:

```
stepKey, scrubbedSituation, ...agentNoteTexts(oldest→newest), textdripSummary
```

Hash with **FNV-1a 32-bit**, rendered as 8 hex chars. A draft is stale when the recomputed hash differs — one mechanism covering a new touch, an edited note, and a step advance, rather than three invalidation paths that can each be missed.

A hash collision leaves a stale draft in place. Harmless: the agent sees a slightly dated message, can edit it, and **Redo** forces regeneration unconditionally.

### 7.4 `previous` — the D8 source

When generating for a `stepKey` different from the stored entry's, push the stored `text` onto `previous` (newest first, cap 2) before overwriting. `previous` is what §7.5 sends as "already drafted earlier in this sequence."

This is an honest proxy, not a send log — PRIM does not send, so it cannot know what actually went out. It prevents the common case: step 3's message opening with the same detail step 2's did.

### 7.5 Prune

On load, after both `prospects_v1` and `followup_drafts_v1` are read, drop entries whose prospect id is absent from the loaded list or whose prospect is archived. **Write back only if something was dropped**, so a normal load stays read-only. Prune runs **before** the first draft write, so a stale map can never be re-persisted.

## 8. Drafting route — `POST /api/followup-draft`

Established pattern: Supabase bearer → `requireUserId`, JSON-schema tool call, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30`. **Prospect content is never logged**, on success or error.

**Request:** stock script (the brief), stage, step purpose (`nudge` | `urgency` | `breakup`, derived from step position), `buildDraftSource` output (§5.4), and `previous` (§7.4).

**Response:** `{ text }` **or** `{ insufficient: true }` (D9).

### 8.1 Prompt contract

Framed as **"write the message this moment calls for"** (D6) — never "rewrite the following". Rewrite framing produces paraphrase: the same sentence with one bolted-on clause, which is exactly the templated feel this feature exists to remove.

Hard bars:

1. Keep the step's purpose — a nudge stays a nudge, a breakup stays a breakup. The final step in each stage is a breakup ([followupEngine.mjs:32](../../../src/lib/followupEngine.mjs), [:42](../../../src/lib/followupEngine.mjs), [:60](../../../src/lib/followupEngine.mjs)) and must never come back as a pitch.
2. **Only facts present in the supplied notes.** No inference, no gap-filling. This is the rule that prevents *"hope the new job's going well"* reaching someone who never mentioned a job — the single failure that would destroy an agent's trust in one text.
3. No health references, ever, even if something slipped past the scrubber.
4. **No claims** — no savings, rates, or approval promises. A compliance exposure in R&J Prime's name.
5. Texting length — within one sentence of the stock script.
6. Do not repeat anything in `previous` (D8).
7. Nothing specific worth saying → return `insufficient` rather than padding.

## 9. UI — `FollowupNextStep.jsx`

The card keeps its structure. Additions only; no early returns are added and no existing render path changes, so the four existing stages are unaffected.

- Draft renders in an **editable** textarea (D10) in place of the read-only script block ([FollowupNextStep.jsx:56](../../../src/components/FollowupNextStep.jsx)). Edits persist to the cache and survive re-open.
- Footer gains a provenance line — *"Personalized from your note on Tue, Jul 21"* — plus **Redo**. **Copy** and **Log touch** are unchanged.
- Not-yet-due + eligible → **Personalize** button (D7).
- Ineligible, `insufficient`, or any failure → today's card, unchanged, **no AI call ever made**.

**Dark mode:** the remap table in `globals.css` ([:74-115](../../../src/app/globals.css)) keys on literal escaped class names. **Any** opacity variant absent from it renders unremapped — the trap that produced an invisible hover state on the CSV export modal. It covers `bg-slate-50\/60`, `bg-slate-50\/80`, `bg-slate-900\/40`, `bg-slate-900\/50`, `bg-white\/80|85|90` and no others; this file already carries an unlisted `bg-indigo-50/40` at [:9](../../../src/components/FollowupNextStep.jsx). New markup must use a listed utility or add the variant to the table, and be verified in both themes.

**Team-leader mirror:** `FollowupNextStep` already sits inside `{!readOnly && (` ([ProspectsView.jsx:1166](../../../src/components/views/ProspectsView.jsx)). The guard is pre-satisfied and **must not be widened** — that view renders another agent's prospects.

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Route 5xx / network | Stock script; one quiet retry on next open; never blocking |
| `insufficient` | Stock script; no affordance; cached so it is not re-attempted until `sourceHash` changes |
| Malformed model output | Treated as failure; stock script; **never rendered raw** |
| `ANTHROPIC_API_KEY` missing | Feature silently absent |
| Drafts key unreadable | Stock script; drafting still works, just uncached |
| Auth failure | 401; client falls back to stock script |

Invariant: **every failure path degrades to today's behaviour.** The feature can be entirely broken and PRIM's follow-up system still works exactly as it does now.

## 11. Testing

`npm test` (`node --test src/lib/*.test.mjs`). Baseline **506 pass, 0 fail** — no existing test may change.

**`followupDraftGate.test.mjs`**
- Agent touch with a note → eligible. Empty/whitespace note → not.
- Lowercase `email`/`sent` outreach touch → **not** eligible.
- Website-form re-submit (`Other`/`Other` + note prefix) → **not** eligible.
- TextDrip thread with an inbound message → eligible; outbound-only → not.
- Benepath-written `situation` alone → not eligible.
- `WEBBY_SET` / `APPOINTMENT_SET` / `GHOSTED` / `SOLD` / `LOST` with a valid agent touch → **not** eligible (Phase 1 boundary, asserted directly).
- `scrubHealth`: drops a health clause and keeps its neighbours; returns `''` when >half the clauses are health; leaves clean text byte-identical; `meds` never appears anywhere in `buildDraftSource` output.
- `buildDraftSource`: caps agent notes at 3, oldest→newest; uses TextDrip only when there are no agent notes; truncates the summary.

**`followupDraftCache.test.mjs`**
- `stepKey` format; changes when stage or stepIndex changes.
- `sourceHash` is deterministic across calls and stable under re-ordered object construction; changes when a note is added, a note is edited, situation changes, or stepKey changes.
- `previous` caps at 2, newest first, and only rotates on a stepKey change.
- Prune drops entries for missing and archived prospects, keeps the rest, and reports whether anything was dropped.

**Not unit-testable here:** the route and the JSX — PRIM has no component-test infrastructure. Covered by live browser verification in **both themes** plus code review before merge.

## 12. Security & compliance

- **No PHI** (D5): `meds` never read; `situation` and TextDrip summaries scrubbed (§5.3); the prompt bars health references; a human reads every message. PRIM's no-PHI posture ([NoPhiBanner.jsx](../../../src/components/NoPhiBanner.jsx)) is preserved. The scrubber is explicitly **not** presented as a guarantee.
- **No cross-account leakage** — `followup_drafts_v1` registered in `APP_KEYS` (§7.1).
- **No prospect-record writes on open** (§7.1) — no merge-clobber risk.
- **No auto-send** (D10): drafting is not gated, sending is, and PRIM never sends.
- **No claims** in generated text (§8.1 bar 4).
- Prospect content **never logged** server-side.
- Auth via `requireUserId`.
- Team-leader mirror read-only (§9).
- **Blast capture path untouched.**

## 13. Rollout

1. Branch `followup-personalized-drafts` (already created). TDD the two pure modules first.
2. `npm test` ≥506 pass · `npm run lint` · `npm run build` all green.
3. Live verification in both themes: eligible + due (auto-draft), eligible + not due (Personalize button), ineligible (no affordance), `insufficient`, route failure, edit-persists-on-reopen, Redo, sign-out/sign-in with a second account (drafts must not survive), team-leader mirror.
4. Fresh-context adversarial review against this spec.
5. Juan merges; `/api/version` polled to confirm.
6. Announcement ([announcements.js](../../../src/lib/announcements.js)) — including that **the feature rewards logging touches**: agents who log their conversations get messages that sound like they remember; agents who don't, get the template.

## 14. Why Phase 1 exists

The original spec covered six stages and added appointment-anchored scheduling. Two adversarial reviews found 27 defects across two revisions — 7 critical. Representative:

- The morning-of reminder could never render: once the night-before step went unlogged it pinned permanently, so at 1:30 PM the card read *"confirming our call tomorrow at 2:00 PM"* for a 2 PM appointment.
- PRIM would suggest **Missed Appointment** after appointments that went well, then hand the agent *"we just missed our call — calling now in case you're free!"* to send to someone they had spoken with an hour earlier.
- Revision 1 fixed the `afterDays: undefined` foot-gun in `logTouch` and declared the class handled; `armIfNeeded` and `armCadence` carried it too, and would have persisted backdated overdue dates.

Every one lived in scheduling. Splitting the work removes that surface from Phase 1 entirely (§1.1) and lets the personalisation engine — which none of the 27 defects touched — ship on its own.

Phase 2 will design appointment reminders as what they are: a standalone, time-triggered surface, not a cadence.
