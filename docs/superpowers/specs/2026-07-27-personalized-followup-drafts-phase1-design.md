# Personalized Follow-up Drafts — Phase 1 Design Spec

**Date:** 2026-07-27
**Status:** Approved by Juan — "Yes, spec Phase 1 only". **Revision 2** after adversarial review (see §15).
**Supersedes:** `2026-07-27-personalized-followup-drafts-design.md` (withdrawn — see §14).

**Request:** A field agent suggested PRIM's sample follow-up text should be written from each prospect's own notes rather than being the same script for everyone. Juan: *"the whole purpose of this is to create a way that Prim acts intelligently and is able to adapt to each situation properly."*

## 1. Scope

**In scope:** `PENDING_DECISION`, `FOLLOWUP_LATER`, `MISSED_APPT`.

Four stages have working cadences — those three plus `GHOSTED` ([followupEngine.mjs:54](../../../src/lib/followupEngine.mjs)). **`GHOSTED` is excluded by Juan's decision**, not by capability: it did not appear in the stages he named, and a prospect who has stopped responding is a re-engagement problem worth designing separately.

**Out of scope — Phase 2:** `WEBBY_SET`, `WEBBY_CONFIRMED`, `APPOINTMENT_SET` and appointment-anchored reminders of any kind. Two review rounds established that an appointment reminder ("at 6 PM tomorrow, show this once") is not a follow-up cadence ("chase until they respond, advancing on each touch"). Phase 2 will design it as its own surface.

**`SOLD` / `LOST`:** never.

### 1.1 The hard boundary

**This spec changes no scheduling behaviour.** `followupEngine.mjs` gains no new stage, no new step shape, and **no edit of any kind** — not `armIfNeeded`, `armCadence`, `logTouch`, `dueStatus`, `snooze`, or `DEFAULT_PLAYBOOK`. The playbook is not merged or versioned. `dueStatus` keeps its signature, so all six call sites — including the server-side nightly job at [reminders/route.js:320](../../../src/app/api/reminders/route.js) — are untouched.

Revision 1 breached this with a "stamp new touches with `by: 'agent' | 'system'`" line. Touch creation lives inside `logTouch` ([followupEngine.mjs:157](../../../src/lib/followupEngine.mjs)), and `applyOutreachEmail` routes its machine touch through the same function ([:206](../../../src/lib/followupEngine.mjs)) — so the stamp would require a `logTouch` signature change. **The stamp is removed from Phase 1.** Provenance is determined by fingerprint (§5.1), which two reviews confirmed is unambiguous.

## 2. Problem

`FollowupNextStep` substitutes `{first}`, `{time}`, `{agent}` into a fixed per-stage script ([FollowupNextStep.jsx:13](../../../src/components/FollowupNextStep.jsx)) and nothing else. Every prospect in the same stage at the same step gets **byte-identical text**.

The material to fix this already exists and agents already produce it: the notes they type when logging a touch, and the SMS threads TextDrip syncs in.

## 3. Decisions (locked with Juan)

| # | Decision |
|---|----------|
| D1 | **Augment, never replace.** The stock script stays as the fallback. |
| D2 | Stages: `PENDING_DECISION`, `FOLLOWUP_LATER`, `MISSED_APPT` (§1). |
| D3 | **Eligibility = evidence of a real conversation**: an agent-logged touch with a note, **or** a TextDrip thread with a genuine inbound reply. |
| D4 | `situation` is **supporting detail only** — never the reason personalisation is offered. |
| D5 | **`meds` is never read.** All free text that leaves the browser — agent notes, `situation`, TextDrip — passes through `redactHealth` first (§5.3). |
| D6 | The AI **always drafts fresh**. The stock script is a **brief** (purpose + register), not raw material to paraphrase. |
| D7 | **Auto-generate when due** (`overdue` / `due_today`), cached thereafter. Not-yet-due → manual **Personalize** button. |
| D8 | The drafting call receives **earlier drafts in this sequence** and must not repeat them. |
| D9 | The model may return **"insufficient context"** → stock script, no affordance, no retry until inputs change. |
| D10 | Every draft is **editable**, and **Copy copies what is on screen** (§9.1). Nothing auto-sends. |
| D11 | Drafts live in their own **registered** storage key, never on the prospect record (§7.1). |
| D12 | **Opted-out prospects are never drafted for** (§5.5). |

### 3.1 Open decision for Juan — model tier

Default **Haiku 4.5** (all 8 existing PRIM Claude routes use `claude-haiku-4-5`), switchable via `FOLLOWUP_DRAFT_MODEL`. Estimate **~$3–5/month** including Redo and re-open retries (§8.3 caps both). Sonnet ≈10×. **Not blocking.**

## 4. Architecture

```
src/lib/followupDraftGate.mjs       NEW   eligibility + redaction + source assembly (pure)
src/lib/followupDraftGate.test.mjs  NEW
src/lib/followupDraftCache.mjs      NEW   stepKey, sourceHash, rotation, prune (pure)
src/lib/followupDraftCache.test.mjs NEW
src/lib/storage.js                  EDIT  register 'followup_drafts_v1' in APP_KEYS (one line)
src/app/api/followup-draft/route.js NEW   Claude drafting route
src/components/FollowupNextStep.jsx EDIT  hook-safe restructure; draft UI; Copy fix
src/components/LeadTracker.jsx      EDIT  load/prune/save the drafts map; pass down
src/components/views/ProspectsView.jsx EDIT thread drafts props through to the card
```

**`LeadTracker.jsx` owns the drafts map, not `ProspectsView`.** `ProspectsView` contains **zero** references to `storage` — `prospects` arrives as a prop ([ProspectsView.jsx:1388](../../../src/components/views/ProspectsView.jsx)). `LeadTracker` is where `prospects_v1` is read ([:145](../../../src/components/LeadTracker.jsx)), where the playbook loads ([:641](../../../src/components/LeadTracker.jsx)), and where `storage.prefetch()` is called ([:367](../../../src/components/LeadTracker.jsx)) — so it is the only place the §7.5 prune can be sequenced against a `prospects_v1` load. Revision 1 assigned this to `ProspectsView` and would have stranded the builder.

Two pure `.mjs` modules because `npm test` = `node --test src/lib/*.test.mjs` and only dependency-free `.mjs` is importable there.

**Baseline:** `npm test` → **506 pass, 0 fail** (verified 2026-07-27, twice). No existing test may change.

## 5. Eligibility and source assembly — `followupDraftGate.mjs`

### 5.1 Touch provenance

| Writer | Signature | Verdict |
|---|---|---|
| `LogTouchSheet` (the agent) | `channel` ∈ `CHANNELS`, `outcome` ∈ `OUTCOMES` (capitalised, [LogTouchSheet.jsx:4](../../../src/components/LogTouchSheet.jsx)) | ✅ **agent** |
| `applyOutreachEmail` ([followupEngine.mjs:206](../../../src/lib/followupEngine.mjs)) | `channel: 'email'` (lowercase), `outcome: 'sent'` | ❌ machine — neither value exists in the constant lists |
| Website-form re-submit ([webforms.mjs:450](../../../src/lib/webforms.mjs)) | `channel: 'Other'`, `outcome: 'Other'`, note begins `Submitted your website form again` | ❌ machine — **only the note prefix distinguishes it** |

Three independent reviews confirmed these are the **only** writers of touch entries in `src/`.

`isAgentTouch(t)` = `CHANNELS.includes(t.channel) && OUTCOMES.includes(t.outcome) && !String(t.note||'').startsWith('Submitted your website form again')`.

**Known, accepted false negative:** the website-form re-submit note embeds the prospect's own fresh message ([webforms.mjs:445](../../../src/lib/webforms.mjs)) — genuinely useful material that this rule discards. Accepted for Phase 1 because the prefix is the only available discriminator and a form submission is not a conversation with the agent. Recorded so it is not rediscovered as a bug.

### 5.2 The gate

`isEligible(prospect)` — true when **all** of:

1. `stage` ∈ `{ PENDING_DECISION, FOLLOWUP_LATER, MISSED_APPT }`;
2. not opted out (§5.5); and
3. **either** ≥1 agent touch (§5.1) with a non-empty trimmed `note`, **or** a genuine inbound TextDrip reply (§5.4).

`situation` alone **never** qualifies (D4) — this kills the `"BENEPATH LEAD"` filler class ([import-prospects-ai/route.js:112](../../../src/app/api/import-prospects-ai/route.js)) without a length heuristic.

### 5.3 `redactHealth(text)` — span redaction, not clause deletion

Applied to **every** free-text field that leaves the browser: agent notes, `situation`, and TextDrip bodies. Revision 1 applied it only to `situation` and TextDrip, leaving the *primary eligibility field* — the agent's note — unfiltered. That was the most serious defect in revision 1 and this is its fix.

**Design constraint that drove the rewrite:** revision 1 deleted whole clauses and returned `''` when more than half were dropped. Run against this codebase's own extractor output — *"Wants family coverage starting Sept 1, budget around $400/mo, worried about keeping her current doctor, husband is self-employed"* ([extract-conversation/route.js:32](../../../src/app/api/textdrip/extract-conversation/route.js) produces exactly this comma-joined shape) — the word `doctor` destroyed the entire field. In health insurance, *"wants to keep her current doctor"* is a **network objection**, the single most useful personalization fact an agent can have. A filter that deletes it makes the feature worse than the template it replaces.

**Algorithm:** replace matched spans with `[health detail removed]`. Never delete a clause. Never return `''` for a field that had non-health content.

Patterns, all case-insensitive and word-boundary anchored:

- **Dosages:** `/\b\d+\s?(mg|mcg|ml|iu)\b/` and the 1–3 words preceding them (catches *"takes Metformin 500mg"*).
- **Diagnosis phrasing:** `/\b(diagnosed with|suffers from|being treated for|history of)\s+[^,.;!?]{1,40}/`
- **Named conditions:** diabetes, diabetic, cancer, chemo, dialysis, HIV, hepatitis, COPD, asthma, seizure, stroke, `heart (condition|attack|disease)`, thyroid, `blood pressure`, cholesterol, insulin, inhaler, oncologist, cardiologist, biopsy, `lab results`, prescription, `Rx`
- **PRIM's own health fields:** `/\bExpectant:\s*\w+/` and `/\bTobacco:\s*\w+/` — `buildSituation` writes both into `situation` ([benepath.mjs:167](../../../src/lib/benepath.mjs)), so PRIM's own importer is a PHI source.

**Deliberately NOT matched**, because in this domain they are sales context, not clinical detail: `doctor`, `physician`, `specialist`, `hospital` (network questions), `procedure` (enrollment), `anxiety`/`depression` used about cost, `disability` (income source), `treatment`, `therapy`, `medication`/`meds` as a bare category word.

**Honest limit, stated in the spec so nobody mistakes it for a guarantee:** a pattern list cannot be complete, and this one is deliberately tuned to preserve sales context. The real controls are PRIM's no-PHI policy ([NoPhiBanner.jsx](../../../src/components/NoPhiBanner.jsx)) telling agents not to type clinical detail, the total exclusion of `meds`, the prompt bar (§8.2 bar 3), and a human reading every message before it sends. `redactHealth` is a backstop, not the control.

### 5.4 TextDrip inbound test

`normalizeMessage` sets `direction: chat.type === 'receiver' ? 'out' : 'in'` ([textdrip.mjs:99](../../../src/lib/textdrip.mjs)) — **`'in'` is the fall-through**, so a renamed API field, a malformed row, or a new message type all read as inbound. Testing `direction === 'in'` alone would make every synced prospect eligible on a TextDrip schema change.

**Require `m.direction === 'in' && m.isDrip !== true` AND a non-empty trimmed body.** `isDrip` ([textdrip.mjs:104](../../../src/lib/textdrip.mjs)) marks automated campaign sends; drip copy is not a conversation.

### 5.5 Opt-out gate (D12)

An inbound `STOP` is still an inbound message, so §5.2's TextDrip branch would otherwise make an opted-out prospect eligible — and D7 would auto-draft a personalized solicitation for them and present a Copy button. **Ineligible when** any inbound TextDrip body, trimmed and uppercased, equals one of `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, or when a touch outcome is `Not interested`.

Informational compliance flag, not legal advice — flagged for human review per the standing rule.

### 5.6 `buildDraftSource(prospect)`

Returns, in this fixed order — **every text field already passed through `redactHealth`**:

- `firstName`
- `agentNotes` — the **3 most recent** agent touches with notes, oldest→newest, each `{ at, outcome, note: redactHealth(note) }`
- `situation` — `redactHealth(prospect.situation)`, omitted when empty
- `missedApptTime` — **only** for `MISSED_APPT`, whose steps 0–1 reference `{time}` ([followupEngine.mjs:28](../../../src/lib/followupEngine.mjs)). Supplied explicitly so §8.2 bar 2 ("only facts present in the supplied notes") is not violated by a fact the merged script already carries.
- `textdripSummary` — **only when `agentNotes` is empty.** The 6 most recent qualifying messages (§5.4), `direction` + `redactHealth(body)`, truncated to 800 chars total. Never the raw thread.

`meds` is never read.

## 6. When drafting fires (D7)

| `dueStatus` state | Eligible | Ineligible |
|---|---|---|
| `overdue`, `due_today` | **Auto-generate** if no fresh cache entry | Stock script, no affordance |
| `ontrack`, `snoozed` | Stock script + **Personalize** button | Stock script, no affordance |
| `done`, `none` | Existing behaviour, unchanged | Unchanged |

### 6.1 Firing must be bounded by `sourceHash`, not by "in flight"

`FollowupNextStep` declares `now = new Date().toISOString()` as a **default parameter** ([FollowupNextStep.jsx:21](../../../src/components/FollowupNextStep.jsx)) and its only mount site does not pass one ([ProspectsView.jsx:1168](../../../src/components/views/ProspectsView.jsx)) — so `now`, and therefore `status`, is a **fresh object on every render**. An effect keyed on either re-runs continuously; an in-flight-only guard clears the moment the promise settles, so the next render fires again and the resulting `setState` re-renders. That is an unbounded billed loop.

**Required:** a module-level `Map` keyed `` `${prospectId}:${sourceHash}` `` recording `pending | done | failed`, **persisting after completion**. The effect must depend on `sourceHash` and `prospect.id` only — never on `now` or `status` identity. The parent passes a `now` that is stable for the mount.

### 6.2 Hooks must sit above the existing early returns

Two early returns already sit between render start and the point where `status` exists: `if (steps.length === 0) return null` ([:24](../../../src/components/FollowupNextStep.jsx)) and the `done` branch ([:27](../../../src/components/FollowupNextStep.jsx)) — and `status` is only computed at [:26](../../../src/components/FollowupNextStep.jsx), *after* the first one.

A `useEffect`/`useRef` placed where `status` is available sits after a conditional return. That fails `react-hooks/rules-of-hooks` at build; if it slipped through, an agent logging the final touch would flip `status.state` to `'done'`, drop the hook count, and React would throw *"Rendered fewer hooks than expected"* — taking down the whole prospect drawer.

**Required structure:** split the component — an outer shell that computes `steps`/`status` and keeps the existing early returns, and an inner component holding all draft state and hooks, rendered only on the paths that need it. This is the same restructure that unblocked `ExportProspectsModal`; it also gives reset-on-open for free via unmount/remount. **Do not disable the lint rule.**

## 7. Storage, caching, invalidation

### 7.1 `followup_drafts_v1` — a registered key (D11)

**Add `'followup_drafts_v1'` to `APP_KEYS`** ([storage.js:353](../../../src/lib/storage.js)). One line, not optional:

- `purgeLocalMirror` iterates `APP_KEYS` ([storage.js:59](../../../src/lib/storage.js)), fired from `ensureLocalOwner` on the **next user's sign-in** ([storage.js:67](../../../src/lib/storage.js)). An unregistered key survives; user B's `cloudGet` returns null, `getItem` falls back to localStorage ([storage.js:261](../../../src/lib/storage.js)), and **B is served A's drafts** — then persists them into B's cloud row. Exactly the incident class documented at [storage.js:43](../../../src/lib/storage.js): *"a new agent's account showed the founder's earned commissions."*
- `prefetch` defaults to `APP_KEYS` ([storage.js:274](../../../src/lib/storage.js)) and batches via one `.in(list)` query, so registration costs **no extra round-trip**.
- `migrateLocalToCloud` ([storage.js:379](../../../src/lib/storage.js)) also iterates `APP_KEYS`.
- `inspectStorage` ([storage.js:403](../../../src/lib/storage.js)) iterates it too but gates on `Array.isArray(parsed) && parsed.length > 0`, so an object map is invisible to the "upload your local data" prompt. Harmless — drafts are regenerable and should not drive a migration prompt. Recorded so it is not filed as a bug.

**Not added to `MERGEABLE_KEYS`** ([storage.js:176](../../../src/lib/storage.js)) — that set is for arrays of id'd records; this is a plain object map. Last-write-wins is correct: a lost draft regenerates, a lost prospect edit does not.

**Never written to the prospect record.** `prospects_v1` merges whole-record newest-wins ([mergeStore.mjs:59](../../../src/lib/mergeStore.mjs)), so caching there would turn *opening* a prospect into a full-record write — edit a phone number on your phone at 10:00, open the same prospect on the laptop at 10:01, and the laptop write wins on `updatedAt`; **the phone edit is gone**.

**Write amplification:** the whole map is rewritten on every draft save. Draft generation is bounded by §6.1, but the editable textarea (§9) must **debounce persistence at 800 ms** and flush on blur/unmount — otherwise every keystroke rewrites the map to Supabase.

### 7.2 Shape

```js
// followup_drafts_v1
{ [prospectId]: { status, text, edited, stepKey, sourceHash, at, attempts, previous: [] } }
```

- **`status`**: `'ok' | 'insufficient' | 'failed'`. Revision 1 had no such field, so `insufficient` was indistinguishable from "never tried" — and because the drawer unmounts and remounts on every open ([ProspectsView.jsx:1108](../../../src/components/views/ProspectsView.jsx)), a prospect the model declines would have been re-billed on **every single open, forever**.
- **`edited`**: `true` once the agent modifies the textarea. Suppresses regeneration so an agent's own wording is never overwritten.
- **`attempts`**: increments on `failed`; **cap 2** per `sourceHash` (§8.3).
- **`stepKey`** = `` `${stage}:${clampedStepIndex}` ``, where `clampedStepIndex` is `Math.min(cadence?.stepIndex || 0, steps.length - 1)` — **the clamped value the card actually renders** ([FollowupNextStep.jsx:35](../../../src/components/FollowupNextStep.jsx)). Raw and clamped agree today but diverge if a user shortens a stage in the customisable playbook ([LeadTracker.jsx:641](../../../src/components/LeadTracker.jsx)), which would key the draft to a step the card is not showing.
- **`previous`**: cap 2, newest first (§7.4).

### 7.3 `sourceHash`

Join with `' '` (a separator that cannot occur in the inputs — a space join makes `["a","b c"]` and `["a b","c"]` collide), in this fixed order:

```
stepKey, redactedSituation, ...agentNotes.map(n => `${n.at}|${n.outcome}|${n.note}`), textdripSummary
```

`at` and `outcome` are included because both are **sent to the model** (§5.6): two touches with identical note text but different outcomes produce different prompts and must produce different hashes. Hash with **FNV-1a 32-bit**, 8 hex chars.

A collision leaves a stale draft in place — harmless; the agent can edit, and **Redo** forces regeneration.

### 7.4 `previous` — rotate BEFORE the request

When generating for a `stepKey` different from the stored entry's, push the stored `text` onto `previous` (newest first, cap 2) **and send the updated `previous` in that same request.**

Revision 1 rotated on write-back, so at step 3 the model was shown step 1's draft and never step 2's — the most recent and by far the likeliest to be echoed. That inverted D8's stated purpose.

An agent-`edited` draft rotates in as-is. That is correct — it is what the agent actually intended to send — and it is safe, because `redactHealth` already ran on the inputs and the model is instructed not to repeat it, not to mine it.

### 7.5 Prune

In `LeadTracker`, after both `prospects_v1` and `followup_drafts_v1` are read, drop entries whose prospect id is absent from the loaded list or whose prospect is archived. **Write back only if something was dropped.** Prune runs **before** any draft write, so a stale map is never re-persisted.

## 8. Drafting route — `POST /api/followup-draft`

Established pattern: Supabase bearer → `requireUserId`, JSON-schema tool call, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30`. **Prospect content is never logged**, on success or error.

**Request:** `brief` (§8.1), `stepPurpose` (§8.1), `buildDraftSource` output (§5.6), `previous` (§7.4), and `rejected` (§8.3).
**Response:** `{ text }` **or** `{ insufficient: true }`.

### 8.1 The brief and the step purpose

**The brief is the `mergeScript`-rendered script**, not the raw one — `{first}`/`{agent}`/`{time}` already substituted ([FollowupNextStep.jsx:13](../../../src/components/FollowupNextStep.jsx)). Sending raw tokens invites the model to echo `Hi {first}` into a draft that renders straight into the textarea, and the agent copies a literal placeholder.

**The route must reject any draft containing `/\{[a-z]+\}/i`** and treat it as a malformed response (§10).

Note `agentName` is currently `''` at the mount site ([ProspectsView.jsx:1956](../../../src/components/views/ProspectsView.jsx)), so `{agent}` merges to *"your agent"*. Phase 1 does not change this; the model is told not to invent a signature.

**`stepPurpose` — explicit per-stage mapping.** Revision 1 said "derived from step position" without giving the derivation, and asserted every stage's final step is a breakup. **False for `FOLLOWUP_LATER`**, whose final step is *"monthly check-in! Any change in your situation…"* with `onComplete: 'FOLLOWUP_LATER'` ([followupEngine.mjs:46](../../../src/lib/followupEngine.mjs)) — it loops to itself. Labelling it `breakup` would tell the model never to re-open a conversation whose entire job is to re-open it.

| Stage | Steps | Purpose by index |
|---|---|---|
| `MISSED_APPT` | 5 | 0–1 `reschedule_urgent` · 2–3 `reschedule` · 4 `breakup` |
| `PENDING_DECISION` | 5 | 0–1 `clarify` · 2–3 `urgency` · 4 `breakup` |
| `FOLLOWUP_LATER` | 4 | 0–2 `check_in` · 3 `check_in` |

`FOLLOWUP_LATER` has **no breakup step**. The mapping is data in `followupDraftGate.mjs`, asserted against the live playbook by a test so a playbook edit cannot silently desynchronise it.

### 8.2 Prompt contract

Framed as **"write the message this moment calls for"** (D6) — never "rewrite the following". Rewrite framing produces paraphrase: the same sentence with one bolted-on clause, exactly the templated feel this feature exists to remove.

Hard bars:

1. Keep the step's purpose (§8.1). A `breakup` never comes back as a pitch; a `check_in` never comes back as a goodbye.
2. **Only facts present in the supplied source.** No inference, no gap-filling. This prevents *"hope the new job's going well"* reaching someone who never mentioned a job — the single failure that would destroy an agent's trust in one text.
3. No health references, ever, even if something passed the redactor.
4. **No claims** — no savings, rates, or approval promises. A compliance exposure in R&J Prime's name.
5. Texting length — within one sentence of the brief.
6. Do not repeat anything in `previous` (D8) or `rejected` (§8.3).
7. No `{placeholder}` tokens; no invented signature.
8. Nothing specific worth saying → return `insufficient` rather than padding.

### 8.3 Redo and retry caps

**Redo** sends the displayed draft as `rejected` — otherwise the model gets byte-identical inputs and returns a near-identical message to an agent who clicked Redo *because* they disliked it. `rejected` accumulates within a `sourceHash`, **capped at 3**; beyond that Redo is disabled with *"Try editing it directly."*

**Failure retry** is capped at `attempts: 2` per `sourceHash` (§7.2). Together these bound the worst case to 5 calls per prospect per step, which is what §3.1 costs.

## 9. UI — `FollowupNextStep.jsx`

Restructured per §6.2. Additions only on the draft path; the ineligible path renders exactly today's card.

### 9.1 Copy must copy what is on screen (D10)

`copy()` writes `text` ([:45](../../../src/components/FollowupNextStep.jsx)), which is `mergeScript(step.script, …)` ([:37](../../../src/components/FollowupNextStep.jsx)) — **the stock template**. Left unchanged, PRIM would render a personalized draft, the agent would click **Copy script**, and paste the byte-identical template this feature exists to eliminate. Every draft silently discarded at the moment of use.

**Copy must write the current textarea value when a draft is displayed**, and the stock script otherwise. Verified explicitly in §13.

### 9.2 Rest of the card

- Draft renders in an **editable** textarea replacing the read-only block ([:56](../../../src/components/FollowupNextStep.jsx)). Edits set `edited: true` and persist debounced (§7.1).
- Provenance line: **`Personalized from your note on <date of the newest agent note>`**, or **`Personalized from the SMS conversation`** when the source was the TextDrip branch (§5.6). Nothing else.
- **Redo** next to Copy, subject to §8.3.
- Not-yet-due + eligible → **Personalize** button in place of auto-generation.
- Ineligible, `insufficient`, or failure → today's card, unchanged, **no AI call**.

**Dark mode:** the remap table in `globals.css` ([:74-115](../../../src/app/globals.css)) keys on literal escaped class names and covers only `bg-slate-50\/60|80`, `bg-slate-900\/40|50`, `bg-white\/80|85|90`. **Any** other opacity variant renders unremapped — the trap behind the invisible hover state on the CSV export modal. This file already carries an unlisted `bg-indigo-50/40` ([:9](../../../src/components/FollowupNextStep.jsx)). New markup uses a listed utility or adds the variant, and is verified in both themes.

**Team-leader mirror:** `FollowupNextStep` is mounted at exactly one site ([ProspectsView.jsx:1168](../../../src/components/views/ProspectsView.jsx)) inside `{!readOnly && (` ([:1166](../../../src/components/views/ProspectsView.jsx)); the other `ProspectsView` mount ([TeamView.jsx:301](../../../src/components/views/TeamView.jsx)) passes `readOnly`. The guard is pre-satisfied and **must not be widened**.

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Route 5xx / network | Stock script; `status: 'failed'`, `attempts++`; retry on next open until `attempts` hits 2 |
| `insufficient` | Stock script; `status: 'insufficient'`; **never re-attempted** until `sourceHash` changes |
| Draft contains a `{token}` or is empty | Malformed → treated as failure; **never rendered raw** |
| `ANTHROPIC_API_KEY` missing | Feature silently absent |
| Drafts key unreadable | Drafting still works, uncached |
| Auth failure | 401; stock script |

Invariant: **every failure path degrades to today's behaviour.**

## 11. Testing

`npm test`. Baseline **506 pass, 0 fail** — no existing test may change.

**`followupDraftGate.test.mjs`**
- Agent touch with a note → eligible; empty/whitespace note → not.
- Lowercase `email`/`sent` outreach touch → not eligible.
- Website-form re-submit → not eligible.
- TextDrip: genuine inbound → eligible; outbound-only → not; **`isDrip: true` inbound only → not**; empty bodies → not.
- **Opt-out:** inbound `STOP` / `stop ` / `UNSUBSCRIBE` → not eligible; `Not interested` outcome → not eligible.
- `WEBBY_SET`, `APPOINTMENT_SET`, `GHOSTED`, `SOLD`, `LOST` with a valid agent touch → **not eligible** (Phase 1 boundary, asserted directly).
- `redactHealth`: `"takes Metformin 500mg"` redacted; `"wants to keep her current doctor"` **preserved verbatim**; `"Expectant: Yes"` and `"Tobacco: Yes"` redacted; the full comma-joined extractor sentence from §5.3 keeps all four non-health facts; clean text returned byte-identical; **never returns `''` for input with non-health content**.
- `buildDraftSource`: `meds` never appears in the output for any input; agent notes capped at 3, oldest→newest, each redacted; TextDrip used only when there are no agent notes; `missedApptTime` present only for `MISSED_APPT`.
- `stepPurpose` mapping matches the live `DEFAULT_PLAYBOOK` step counts, and `FOLLOWUP_LATER` has no `breakup`.

**`followupDraftCache.test.mjs`**
- `stepKey` uses the **clamped** index; changes with stage or index.
- `sourceHash` deterministic across calls; `["a","b c"]` vs `["a b","c"]` hash **differently**; changes when a note is added, edited, its outcome changes, situation changes, or stepKey changes.
- `previous` rotates **before** the request, caps at 2, newest first, and does **not** rotate on same-stepKey Redo.
- `attempts` cap and `rejected` cap enforced.
- Prune drops missing and archived prospects, keeps the rest, reports whether anything changed.

**Not unit-testable here:** the route and the JSX — PRIM has no component-test infrastructure. Covered by live verification (§13) and code review.

## 12. Security & compliance

- **No PHI** (D5): `meds` never read; **every** free-text field redacted before the network call, including agent notes; prompt bar 3; a human reads every message. `redactHealth` is explicitly a backstop, not the control (§5.3).
- **No cross-account leakage** — `followup_drafts_v1` registered in `APP_KEYS` (§7.1).
- **No opted-out contact** (§5.5) — informational compliance flag, for human review.
- **No prospect-record writes on open** (§7.1).
- **No auto-send** (D10): drafting is not gated, sending is, and PRIM never sends.
- **No claims** in generated text (§8.2 bar 4).
- Prospect content **never logged** server-side.
- Auth via `requireUserId`. Team-leader mirror read-only (§9.2).
- **Blast capture path untouched.**

## 13. Rollout

1. Branch `followup-personalized-drafts` (created). TDD the two pure modules first.
2. `npm test` ≥506 pass · `npm run lint` · `npm run build` all green.
3. Live verification, **both themes**: eligible+due auto-draft · eligible+not-due Personalize · ineligible (no affordance) · **Copy returns the draft, not the template** · edit persists across close/reopen · Redo differs from the original · `insufficient` not re-billed on reopen · route failure stops after 2 attempts · sign out, sign in as a second account, **confirm no drafts carry over** · team-leader mirror shows no affordance.
4. Fresh-context adversarial review against this spec.
5. Juan merges; `/api/version` polled to confirm.
6. Announcement ([announcements.js](../../../src/lib/announcements.js)) — including that **the feature rewards logging touches**.

## 14. Why Phase 1 exists

The original spec covered six stages and added appointment-anchored scheduling. Two adversarial reviews found 27 defects across two revisions, 7 critical — the morning-of reminder could never render; PRIM would suggest *Missed Appointment* after appointments that went well; revision 1 fixed the `afterDays: undefined` foot-gun in one of three sites and declared the class handled.

Every one lived in scheduling. Phase 1 removes that surface entirely (§1.1).

## 15. Revision 2 — what the third review changed

| Defect | Fix |
|---|---|
| Agent notes — the primary eligibility field — sent **unscrubbed**; §12's "No PHI" was false | `redactHealth` applied to every free-text field (§5.3, §5.6) |
| **Copy copied the stock template**, silently discarding every draft at the moment of use | §9.1 |
| Storage assigned to `ProspectsView`, which has no storage layer | `LeadTracker` owns it (§4) |
| "One in-flight request" guard could not bound firing; `now` is a fresh object every render | `sourceHash`-keyed persistent guard (§6.1) |
| No cache slot for `insufficient`/`failed`; drawer remounts on every open → re-billed forever | `status` + `attempts` (§7.2) |
| `by:` touch stamp required a `logTouch` signature change, breaching §1.1 | Removed (§1.1) |
| `FOLLOWUP_LATER`'s final step called a breakup (it is a check-in that loops); step-purpose derivation undefined | Explicit mapping table (§8.1) |
| `previous` rotated after the request → the most recent draft never sent | Rotate before (§7.4) |
| Clause-deletion scrubber destroyed *"wants to keep her current doctor"* — a network objection, not PHI | Span redaction, no clause deletion, no `''` (§5.3) |
| `Expectant:` / `Tobacco:` from PRIM's own importer passed through | Added to patterns (§5.3) |
| `direction: 'in'` is the fall-through default; drip blasts counted as conversation | Strict test + `isDrip` filter (§5.4) |
| Inbound `STOP` made an opted-out prospect eligible | Opt-out gate (§5.5) |
| Hooks would land after two existing early returns → build failure or a drawer crash | Outer/inner split (§6.2) |
| Redo unbounded and specified to return the same output | `rejected` list + caps (§8.3) |
| Raw-vs-merged brief undefined; model could emit `{first}` | Merged brief + token rejection (§8.1) |
| "Three stages have working cadences" — four do; §9 said "four existing stages" | Corrected (§1) |
| Citation drift: `storage.js:352`, `mergeStore.mjs:90`, `benepath.mjs:150` | Corrected to `:379`, `:59`, `:167` |
