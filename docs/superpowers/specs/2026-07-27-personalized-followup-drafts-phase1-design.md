# Personalized Follow-up Drafts — Phase 1 Design Spec

**Date:** 2026-07-27
**Status:** Approved by Juan. **Revision 3** — data-handling posture set to match PRIM's existing precedent (§5.3), after four adversarial reviews. See §14.
**Supersedes:** `2026-07-27-personalized-followup-drafts-design.md` (withdrawn).

**Request:** A field agent suggested PRIM's sample follow-up text should be written from each prospect's own notes rather than being the same script for everyone. Juan: *"the whole purpose of this is to create a way that Prim acts intelligently and is able to adapt to each situation properly."*

## 1. Scope

**In scope:** `PENDING_DECISION`, `FOLLOWUP_LATER`, `MISSED_APPT`.

Four stages have working cadences — those three plus `GHOSTED` ([followupEngine.mjs:54](../../../src/lib/followupEngine.mjs)). **`GHOSTED` is excluded by Juan's decision**, not by capability.

**Out of scope — Phase 2:** `WEBBY_SET`, `WEBBY_CONFIRMED`, `APPOINTMENT_SET`, and appointment-anchored reminders of any kind. Two review rounds established that an appointment reminder ("at 6 PM tomorrow, show this once") is not a follow-up cadence ("chase until they respond, advancing on each touch"). Phase 2 designs it as its own surface.

**`SOLD` / `LOST`:** never.

### 1.1 The hard boundary

**This spec changes no scheduling behaviour and makes no edit to `followupEngine.mjs`** — not `armIfNeeded`, `armCadence`, `logTouch`, `dueStatus`, `snooze`, or `DEFAULT_PLAYBOOK`. The playbook is not merged or versioned. `dueStatus` keeps its signature, so all six call sites — including the nightly server job at [reminders/route.js:320](../../../src/app/api/reminders/route.js) — are untouched.

Everything this spec needs is already exported: `CHANNELS` ([:11](../../../src/lib/followupEngine.mjs)), `OUTCOMES` ([:12](../../../src/lib/followupEngine.mjs)), `DEFAULT_PLAYBOOK` ([:22](../../../src/lib/followupEngine.mjs)), `playbookForStage` ([:66](../../../src/lib/followupEngine.mjs)), `dueStatus` ([:217](../../../src/lib/followupEngine.mjs)). Confirmed by review.

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
| D5 | **`meds` is never read.** Other prospect free text is sent as-is, matching PRIM's existing precedent; the health constraint governs the **output** (§5.3). |
| D6 | The AI **always drafts fresh**. The stock script is a **brief** (purpose + register), not raw material to paraphrase. |
| D7 | **Auto-generate when due** (`overdue` / `due_today`), cached thereafter. Not-yet-due → manual **Personalize** button. |
| D8 | The drafting call receives **earlier drafts in this sequence** and must not repeat them. |
| D9 | The model may return **"insufficient context"** → stock script, no affordance, no retry until inputs change. |
| D10 | Every draft is **editable**, and **Copy copies what is on screen** (§9.1). Nothing auto-sends. |
| D11 | Drafts live in their own **registered** storage key, never on the prospect record (§7.1). |
| D12 | **Opted-out prospects are never drafted for** (§5.4). |

### 3.1 Open decision for Juan — model tier

Default **Haiku 4.5** (all 8 existing PRIM Claude routes use `claude-haiku-4-5`), switchable via `FOLLOWUP_DRAFT_MODEL`. Estimate **~$3–5/month** with the §8.3 caps applied. Sonnet ≈10×. **Not blocking.**

## 4. Architecture

```
src/lib/followupDraftGate.mjs       NEW   eligibility + source assembly (pure)
src/lib/followupDraftGate.test.mjs  NEW
src/lib/followupDraftCache.mjs      NEW   stepKey, sourceHash, rotation, prune (pure)
src/lib/followupDraftCache.test.mjs NEW
src/lib/storage.js                  EDIT  register 'followup_drafts_v1' in APP_KEYS (one line)
src/app/api/followup-draft/route.js NEW   Claude drafting route
src/components/FollowupNextStep.jsx EDIT  outer/inner split; draft UI; Copy fix
src/components/LeadTracker.jsx      EDIT  load/prune/save the drafts map; pass down
src/components/views/ProspectsView.jsx EDIT thread drafts props through to the card
```

**`LeadTracker.jsx` owns the drafts map.** `ProspectsView` contains **zero** references to `storage` — `prospects` arrives as a prop. `LeadTracker` reads `prospects_v1` ([:609](../../../src/components/LeadTracker.jsx)), loads the playbook ([:641](../../../src/components/LeadTracker.jsx)), and calls `storage.prefetch()` ([:367](../../../src/components/LeadTracker.jsx)) — the only place the §7.5 prune can be sequenced against a `prospects_v1` load.

Two pure `.mjs` modules because `npm test` = `node --test src/lib/*.test.mjs` and only dependency-free `.mjs` is importable there.

**Baseline:** `npm test` → **506 pass, 0 fail** (verified four times). No existing test may change.

## 5. Eligibility and source assembly — `followupDraftGate.mjs`

### 5.1 Touch provenance

| Writer | Signature | Verdict |
|---|---|---|
| `LogTouchSheet` (the agent) | `channel` ∈ `CHANNELS`, `outcome` ∈ `OUTCOMES` (capitalised, [LogTouchSheet.jsx:4](../../../src/components/LogTouchSheet.jsx)) | ✅ **agent** |
| `applyOutreachEmail` ([followupEngine.mjs:203](../../../src/lib/followupEngine.mjs)) | `channel: 'email'` (lowercase), `outcome: 'sent'` | ❌ machine — neither value exists in the constant lists |
| Website-form re-submit ([webforms.mjs:445](../../../src/lib/webforms.mjs)) | `channel: 'Other'`, `outcome: 'Other'`, note begins `Submitted your website form again` | ❌ machine — **only the note prefix distinguishes it** |

Four independent reviews confirmed these are the only writers of touch entries in `src/`.

```js
export const WEBFORM_TOUCH_PREFIX = 'Submitted your website form again';
export const isAgentTouch = (t) =>
  CHANNELS.includes(t?.channel) &&
  OUTCOMES.includes(t?.outcome) &&
  !String(t?.note || '').startsWith(WEBFORM_TOUCH_PREFIX);
```

`WEBFORM_TOUCH_PREFIX` is exported so the literal exists once. It is duplicated from [webforms.mjs:445-446](../../../src/lib/webforms.mjs) rather than imported, to keep this module's dependency surface at zero. (`webforms.mjs` is itself dependency-free and importable, so a direct import would also work — the duplication is a style choice, not a necessity.) **A test asserts the two strings match**, so a rename cannot silently reclassify machine touches as agent touches.

**Known, accepted false negative:** the website-form note embeds the prospect's own fresh message — useful material this rule discards. Accepted for Phase 1; the prefix is the only discriminator, and a form submission is not a conversation with the agent.

### 5.2 The gate

`isEligible(prospect)` — true when **all** of:

1. `stage` ∈ `{ PENDING_DECISION, FOLLOWUP_LATER, MISSED_APPT }`;
2. not opted out (§5.4); and
3. **either** ≥1 agent touch (§5.1) with a non-empty trimmed `note`, **or** ≥1 genuine inbound TextDrip reply — a message in `prospect.textdripChat.messages` with `direction === 'in'` **and** `isDrip !== true` **and** a non-empty trimmed `body`.

`situation` alone **never** qualifies (D4) — this kills the `"BENEPATH LEAD"` filler class ([import-prospects-ai/route.js:112](../../../src/app/api/import-prospects-ai/route.js)) without a length heuristic.

**Why the strict TextDrip test:** `normalizeMessage` sets `direction: chat.type === 'receiver' ? 'out' : 'in'` ([textdrip.mjs:99](../../../src/lib/textdrip.mjs)) — **`'in'` is the fall-through**, so a renamed API field or a malformed row reads as inbound. `isDrip` ([textdrip.mjs:102](../../../src/lib/textdrip.mjs)) marks automated campaign sends; drip copy is not a conversation.

The source field is `prospect.textdripChat.messages`, populated by the TextDrip sync ([textdrip.mjs:329](../../../src/lib/textdrip.mjs)). It is **not** in `newProspect()` ([prospects.js:75](../../../src/lib/prospects.js)) — it exists only on synced prospects, so all reads must be optional-chained.

### 5.3 Data handling — matching PRIM's existing precedent (D5)

**`meds` is never read.** It is the designated health field; excluding it is unambiguous and free.

**All other prospect free text — touch notes, `situation`, TextDrip bodies — is sent to the model as-is.** No redaction pass.

This is a deliberate reversal of revisions 1 and 2, made by Juan, and it aligns Phase 1 with what PRIM already does. [`/api/textdrip/extract-conversation`](../../../src/app/api/textdrip/extract-conversation/route.js) has been posting **entire raw SMS threads** to Anthropic in production for months. Its PHI control is a prompt instruction telling the model to keep health notes general ([route.js:33](../../../src/app/api/textdrip/extract-conversation/route.js) and the PHI GUIDANCE block at [:39-41](../../../src/app/api/textdrip/extract-conversation/route.js)) — not a filter on the way in.

Two review rounds established that a regex filter cannot work here anyway. Run against real strings, it destroyed *"history of shopping around every year"*, *"the prescription drug rider"*, and *"wants to run it by his cardiologist first"* — all sales context — while passing *"She takes Metformin daily"*, *"she is pregnant, due in March"*, and *"wife has MS"* untouched. In health insurance the clinical vocabulary **is** the sales vocabulary, so any filter strong enough to catch PHI shreds the material that makes a draft worth reading.

**The health constraint therefore governs the output** (§8.2 bar 3), which is the only place the exposure is real: the outbound message reaching a client's phone. Combined with `meds` exclusion, PRIM's no-PHI policy telling agents not to type clinical detail ([NoPhiBanner.jsx](../../../src/components/NoPhiBanner.jsx)), and a human reading every message before sending.

**Stated plainly so it is not mistaken for something stronger.** Prospect free text leaves the browser unfiltered. The *filtering posture* is the one PRIM already operates under — but the **scope is genuinely wider**, and calling it "no new exposure" would be false:

| | `extract-conversation` (today) | This route |
|---|---|---|
| Frequency | **Once per prospect**, on first import only — never on updates or re-syncs ([route.js:5-6](../../../src/app/api/textdrip/extract-conversation/route.js)) | Per prospect **per cadence step**, plus Redo |
| Fields | SMS bodies only | SMS bodies **plus agent-typed touch notes and `situation`** — a field class that has never left the browser |

So: same posture, broader surface. Not a guarantee that no health text reaches the API. Juan made this call knowingly after a filter was shown to destroy sales context while passing real PHI; it is recorded here as a decision, not as a property of the system.

### 5.4 Opt-out gate (D12)

An inbound `STOP` is still an inbound message, so §5.2's TextDrip branch would otherwise make an opted-out prospect eligible — and D7 would auto-draft a solicitation for them with a Copy button.

**Ineligible when either:**

- any inbound TextDrip body, uppercased and stripped of surrounding punctuation and whitespace, matches an opt-out **keyword** — `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPT OUT`, `OPTOUT` — under this rule: the body **equals** the keyword, **or** the body starts with the keyword followed by a non-letter **and is ≤ 20 characters long**; **or**
- any touch outcome is `Not interested`.

**Why the length bound.** Bare prefix matching over-fires on ordinary replies that happen to start with a keyword, and these are exactly the messages a hot prospect sends: *"End of the month works for me"*, *"Cancel my appointment Tuesday, can we move it?"*, *"Quit my job so I need my own plan now"*, *"Stopped by your office today, call me"*. Each would silently and permanently disable the feature for that prospect, with nothing in the UI explaining why. Real opt-outs are short and terse — `STOP`, `Stop please`, `stop texting me` all clear 20 characters; sentences do not. The `-ed`/`-all` case is handled by requiring a non-letter after the keyword, so `Stopped` is not `STOP`.

Direction of error is deliberate: an unrecognised opt-out is a compliance risk, but a false positive is silent feature death on the agent's best leads, and the length bound is what keeps the two apart.

**Known limit:** `normalizeConversation` keeps only the 50 most recent messages ([textdrip.mjs:128](../../../src/lib/textdrip.mjs)), so an older opt-out is invisible to this check. PRIM has no SMS suppression store — `emailSuppression.mjs` is email-only, server-side, and needs an admin client, and all three in-scope stages are Call/Text only ([followupEngine.mjs:28-51](../../../src/lib/followupEngine.mjs) contains zero Email steps). This gate is the only available signal, not a bypass of a better one.

Informational compliance flag, not legal advice — flagged for human review per the standing rule.

### 5.5 `buildDraftSource(prospect)`

Returns, in this fixed order:

- `firstName`
- `agentNotes` — the **3 most recent** agent touches with notes, oldest→newest, each `{ at, outcome, note }`
- `situation` — omitted when empty
- `missedApptTime` — **only** for `MISSED_APPT`, whose steps 0–1 reference `{time}` ([followupEngine.mjs:28](../../../src/lib/followupEngine.mjs)). Supplied explicitly so §8.2 bar 2 is not violated by a fact the merged brief already carries. **Value:** the same string `mergeScript` produces for `{time}` ([FollowupNextStep.jsx:15-17](../../../src/components/FollowupNextStep.jsx)) — `toLocaleString` with `{ weekday: 'short', hour: 'numeric', minute: '2-digit' }` — so the brief and the source can never disagree. When `appointmentTime` is absent `mergeScript` yields `"our scheduled time"`; in that case **omit the field entirely** rather than sending that placeholder as if it were a fact.
- `textdripSummary` — **only when `agentNotes` is empty.** The 6 most recent qualifying messages (§5.2), each rendered `direction` + `body`.
  - **Order: oldest→newest**, matching `agentNotes`. `normalizeConversation` stores **newest-first** ([textdrip.mjs:118-128](../../../src/lib/textdrip.mjs) sorts descending then slices), so the array must be reversed. `extract-conversation` has to do the same ([route.js:63-64](../../../src/app/api/textdrip/extract-conversation/route.js)); a reversed transcript reads as a backwards conversation.
  - **Truncation: 800 chars of the joined string, dropping whole messages from the OLDEST end** until it fits. Never a mid-word cut — a half-sentence is worse than one fewer message, and this string feeds `sourceHash`, so the rule must be deterministic.

`meds` is never read. On an ineligible prospect (no agent notes, no qualifying TextDrip messages) the function returns `firstName` and `situation` only; callers never reach it, but it must not throw.

## 6. When drafting fires (D7)

| `dueStatus` state | Eligible | Ineligible |
|---|---|---|
| `overdue`, `due_today` | **Auto-generate** when `shouldRegenerate` (§7.4) says so | Stock script, no affordance |
| `ontrack`, `snoozed` | Stock script + **Personalize** button | Stock script, no affordance |
| `done`, `none` | Existing behaviour, unchanged | Unchanged |

### 6.1 Firing is bounded by the persisted cache, not by a module Map

`FollowupNextStep` declares `now = new Date().toISOString()` as a **default parameter** ([FollowupNextStep.jsx:21](../../../src/components/FollowupNextStep.jsx)) and its mount site does not pass one ([ProspectsView.jsx:1168](../../../src/components/views/ProspectsView.jsx)) — so `now`, and therefore `status`, is a **fresh object on every render**. An effect keyed on either re-runs continuously; an in-flight-only guard clears when the promise settles, so the next render fires again and its `setState` re-renders. That is an unbounded billed loop.

**Two separate mechanisms, deliberately:**

- **Terminal state is the persisted cache** (§7.2 `status` + `attempts`). It survives unmount, reload, and device change, and it is what §10's retry policy reads. A module-level Map cannot hold this — it would make `attempts` unreachable, because a `failed` key would short-circuit the effect before the retry counter was ever consulted.
- **In-flight de-duplication is a module-level `Set`** of `` `${prospectId}:${sourceHash}` ``, added before the request. Its real job is **re-entrancy**, not concurrent mounts — §9.2 establishes there is exactly one mount site, so two simultaneous mounts of one prospect are unreachable in a single tab.

The effect depends on `[prospect.id, sourceHash]` only — **never** on `now` or `status` identity.

**Abort — and the ordering that makes or breaks it.** The drawer closes on a single overlay click ([ProspectsView.jsx:1111](../../../src/components/views/ProspectsView.jsx)) and its children unmount ([:1087](../../../src/components/views/ProspectsView.jsx)). The request carries an `AbortController` aborted in the effect cleanup.

The `Set` entry **must be deleted synchronously in the cleanup**, not only in the request's `finally`. A `finally` runs on a later microtask, so under React StrictMode — on by default for App Router in dev, and this repo sets no `reactStrictMode` override in `next.config.mjs` — the sequence is: effect runs and adds the key → cleanup fires synchronously and aborts → effect re-runs *in the same commit*, sees the key still present, and **skips** → the `finally` clears the key with nothing left to trigger a retry, because the deps did not change. Result: **auto-generation never fires at all in development**, and in production the same hole opens on a `h1 → h2 → h1` hash round-trip inside one in-flight window. Delete in the cleanup; the `finally` is a backstop for the non-unmount path.

An aborted request writes **nothing** to the cache — the prospect is simply un-drafted and generates on next open. It must never leave a `pending` marker, because nothing would clear it.

**`now` must be memoised** as `useMemo(() => new Date().toISOString(), [prospect?.id, open])` in the parent. A bare `[]` freezes it for the whole session — `ProspectDetail` itself never unmounts ([:1083](../../../src/components/views/ProspectsView.jsx)) — which would stale the due chip and the trigger until a page reload.

### 6.2 Component structure

Two early returns already sit between render start and the point where `status` exists: `if (steps.length === 0) return null` ([:24](../../../src/components/FollowupNextStep.jsx)) and the `done` branch ([:27](../../../src/components/FollowupNextStep.jsx)) — and `status` is only computed at [:26](../../../src/components/FollowupNextStep.jsx), *after* the first. A hook placed where `status` is available sits after a conditional return: `react-hooks/rules-of-hooks` fails the build, and if it slipped through, an agent logging the final touch would flip `status.state` to `'done'`, drop the hook count, and React would throw *"Rendered fewer hooks than expected"*, taking down the prospect drawer.

**Required split — stated precisely, because reviews found the previous wording left Copy unbuildable:**

- **`FollowupNextStep` (outer)** — computes `steps`, `status`, `idx`, `step`, `dueLabel`, and the merged brief. Keeps both existing early returns. Holds **no** hooks. Renders `<FollowupCard key={prospect.id} … />`.
- **`FollowupCard` (inner)** — receives those as props and owns **the entire card body** (today's [:48-73](../../../src/components/FollowupNextStep.jsx)) plus **all** hooks: `copied`, the draft text, `edited`, the generate effect, and `copy()`. The card body is **moved, not duplicated** — the ineligible path renders the same component with no draft, which is byte-identical to today's output.

`copy()` lives in the inner component, so it can read the live textarea value (§9.1). `key={prospect.id}` guarantees state resets between prospects; today that is also implied by `viewing` passing through `null` ([:1529](../../../src/components/views/ProspectsView.jsx)), but the codebase already had to fix this exact class explicitly ([:1086](../../../src/components/views/ProspectsView.jsx) — *"so a suggestion from one prospect can never be applied to another"*), and the key costs one attribute.

**Do not disable the lint rule.**

`style` is computed in the outer component alongside `status` — `STATE_STYLE[status.state] || STATE_STYLE.ontrack` ([FollowupNextStep.jsx:38](../../../src/components/FollowupNextStep.jsx)) — and passed down; the card body consumes it at [:49](../../../src/components/FollowupNextStep.jsx) and [:54](../../../src/components/FollowupNextStep.jsx).

**One accepted lint warning.** The effect's deps are `[prospect.id, sourceHash]` while the §6 table gates firing on `status.state` — a deliberate stale-closure read, since depending on `status` identity is the loop this section exists to prevent. `react-hooks/exhaustive-deps` will warn. `eslint.config.mjs` inherits `eslint-config-next/core-web-vitals`, which sets that rule to **warn**, so `npm run lint` still exits 0. Leave the warning; do not silence it with a disable comment, and do not "fix" it by adding `status` to the deps.

### 6.3 Prop contract

The drafts map lives in `LeadTracker` (§4) and the textarea lives in `FollowupCard`, so writes travel up through `ProspectsView` → `ProspectDetail`. Named here because "thread props through" is not a specification:

```
LeadTracker
  state:  followupDrafts            // the whole map
  passes: followupDrafts            (object, may be {})
          onSaveDraft(prospectId, entry)   // merges one entry, persists the map

ProspectsView -> ProspectDetail -> FollowupNextStep -> FollowupCard
  draft        = followupDrafts[prospect.id] ?? null
  onSaveDraft  = (entry) => onSaveDraft(prospect.id, entry)
```

`onSaveDraft` performs the whole-map write, so §7.2's persist policy is enforced in one place rather than at every call site.

**Persisting the edit on unmount requires a ref.** A naive `useEffect(() => () => onSaveDraft({ ...entry, text }), [])` captures `text` from the first render and writes the *pre-edit* value, silently discarding the agent's changes. Hold the live value in a ref updated on every change and read the ref in the cleanup.

## 7. Storage, caching, invalidation

### 7.1 `followup_drafts_v1` — a registered key (D11)

**Add `'followup_drafts_v1'` to `APP_KEYS`** ([storage.js:353](../../../src/lib/storage.js)). One line, not optional:

- `purgeLocalMirror` iterates `APP_KEYS` ([storage.js:60](../../../src/lib/storage.js)), fired from `ensureLocalOwner` on the **next user's sign-in** ([storage.js:67](../../../src/lib/storage.js)). An unregistered key survives; user B's `cloudGet` returns null, `getItem` falls back to localStorage ([storage.js:261](../../../src/lib/storage.js)), and **B is served A's drafts**, then persists them into B's cloud row. Exactly the incident documented at [storage.js:43](../../../src/lib/storage.js): *"a new agent's account showed the founder's earned commissions."*
- `prefetch` defaults to `APP_KEYS` ([storage.js:274](../../../src/lib/storage.js)) and batches via one `.in(list)` query — registration costs **no extra round-trip**.
- `migrateLocalToCloud` ([storage.js:379](../../../src/lib/storage.js)) also iterates it.
- `inspectStorage` ([storage.js:403](../../../src/lib/storage.js)) iterates it but gates on `Array.isArray(parsed)`, so an object map is invisible to the "upload your local data" prompt. Harmless and correct — drafts should not drive a migration prompt. Recorded so it is not filed as a bug.

**Not added to `MERGEABLE_KEYS`** ([storage.js:176](../../../src/lib/storage.js)) — that set is for arrays of id'd records; this is an object map.

**Never written to the prospect record.** `prospects_v1` merges whole-record newest-wins ([mergeStore.mjs:59](../../../src/lib/mergeStore.mjs)), so caching there would turn *opening* a prospect into a full-record write — edit a phone number on your phone at 10:00, open the same prospect on the laptop at 10:01, and the laptop write wins on `updatedAt`; **the phone edit is gone**.

### 7.2 Shape and write policy

```js
// followup_drafts_v1
{ [prospectId]: { status, text, edited, stepKey, sourceHash, at, attempts, previous, rejected } }
```

| Field | Meaning |
|---|---|
| `status` | `'ok' \| 'insufficient' \| 'failed'`. Without it, `insufficient` is indistinguishable from "never tried" — and because the drawer's children unmount on every close ([ProspectsView.jsx:1087](../../../src/components/views/ProspectsView.jsx)), a declined prospect would be **re-billed on every open, forever**. |
| `text` | The current draft. |
| `edited` | `true` once the agent modifies the textarea. See §7.4. |
| `stepKey` | `` `${stage}:${clampedStepIndex}` ``, `clampedStepIndex = Math.min(cadence?.stepIndex \|\| 0, steps.length - 1)` — **the value the card actually renders** ([FollowupNextStep.jsx:35](../../../src/components/FollowupNextStep.jsx)). |
| `sourceHash` | §7.3. |
| `attempts` | Increments on `failed`; **cap 2** per `sourceHash`. |
| `previous` | Cap **2**, newest first (§7.4). |
| `rejected` | Cap **3**, drafts the agent hit Redo on (§8.3). **Persisted**, not component state — otherwise the cap resets on every drawer close and Redo is unbounded across opens. |

**Write policy — persist on blur and unmount, never per keystroke.** The key is non-mergeable, so `setItem` takes the plain path ([storage.js:322](../../../src/lib/storage.js)): a full `localSet` plus a full JSONB upsert of the **entire map**. At full occupancy of this section's own caps — `text` ~200 B + `previous` 2x + `rejected` 3x + keys and JSON overhead — an entry is **~1.3-1.5 KB**, so an agent with 300 prospects carries **~400 KB**. Debouncing keystrokes would upload that whole map repeatedly through an editing session; debouncing changes frequency, not payload. Hold in-progress text in component state; write once when the textarea blurs or the component unmounts.

**Two-tab caveat:** last-write-wins means tab B's map write can erase drafts tab A created, and neither tab regenerates them because both hold a terminal cache entry in memory. Accepted for Phase 1 — the loss is a stock script until reload, and multi-tab use of the same prospect is rare. Recorded rather than silently assumed.

### 7.3 `sourceHash`

Join with the **NUL separator, written in source as String.fromCharCode(0), i.e. code point U+0000** — never as a literal control character. (Revision 2 embedded a raw NUL byte in this document; git reclassified the file as binary and the prose read as though it mandated a space join, which the §11 test forbids.) A space join would let `["a","b c"]` and `["a b","c"]` collide.

Order:

```
stepKey, firstName, situation, missedApptTime,
...agentNotes.map(n => `${n.at}|${n.outcome}|${n.note}`), textdripSummary
```

**The rule is: everything `buildDraftSource` sends is hashed.** Anything sent but unhashed produces a stale draft that survives a change the agent can see. `at` and `outcome` are hashed because both reach the model. `firstName` and `missedApptTime` were omitted in an earlier draft of this spec — the consequence is that correcting a misspelled name, or fixing the appointment time on a `MISSED_APPT` prospect, would leave the cached draft in place and the agent would copy a message addressed to *"Jonh"* citing the old slot. That is exactly what §8.2 bar 2 exists to prevent, arriving through the cache instead of the model.

Hash with **FNV-1a 32-bit**, 8 hex chars.

A collision leaves a stale draft in place — harmless; the agent can edit, and Redo forces regeneration.

### 7.4 Regeneration, `edited`, and `previous`

**This section is NORMATIVE.** It defines a single function, `shouldRegenerate(cached, stepKey, sourceHash)`, living in `followupDraftCache.mjs`. §6's trigger table and §10's retry policy both defer to it — a builder must not re-derive the firing condition from either. Earlier revisions stated the condition three different ways in three sections, which left `attempts` unreachable from the one that called itself the rule.

Logging a touch advances `stepIndex` ([followupEngine.mjs:191](../../../src/lib/followupEngine.mjs)) on every step **except the last**, where `completedAt` is set and `stepIndex` is left alone ([:185-189](../../../src/lib/followupEngine.mjs)). The normal cycle is draft → edit → log touch → new `stepKey` **and** new `sourceHash`.

In precedence order:

1. **`status === 'insufficient'` and `sourceHash` unchanged** → never regenerate. This is the branch that stops a declined prospect being re-billed on every drawer open (D9).
2. **`status === 'failed'` and `sourceHash` unchanged** → regenerate **iff `attempts < 2`**. This is the only path that consumes `attempts`; without it the counter increments once and is never read.
3. **`stepKey` changed** → regenerate, **even when `edited` is true**. The agent's edit belonged to the previous step; carrying it forward would show step 2's heading above step 1's message. Before the request, push the stored `text` onto `previous` (newest first, cap 2) and **send the updated `previous` in that same request** — an earlier revision rotated on write-back, so at step 3 the model saw step 1's draft and never step 2's, inverting D8's purpose. Reset `attempts` and `rejected` to empty.
4. **`sourceHash` changed, `stepKey` did not** (e.g. `situation` edited) → regenerate **only when `edited` is false**. An agent's own wording is never overwritten in place. `previous` does **not** rotate. Reset `attempts` and `rejected`.
5. **Otherwise** → serve the cache.

*(Rule 3's condition is strictly narrower than rule 4's — `stepKey` is the first segment of `sourceHash`, so a `stepKey` change always changes the hash. The ordering is what distinguishes them; rule 3 is not unreachable.)*

### 7.5 Prune

In `LeadTracker`, after both `prospects_v1` and `followup_drafts_v1` are read, drop entries whose prospect id is absent from the loaded list, whose prospect has a non-null `archivedAt` ([LeadTracker.jsx:1966](../../../src/components/LeadTracker.jsx)), or whose prospect is in `SOLD` / `LOST` (§1 — never drafted for, so a leftover entry is dead weight). **Write back only if something was dropped.** Prune runs **before** any draft write.

## 8. Drafting route — `POST /api/followup-draft`

Established pattern: Supabase bearer → `requireUserId` ([apiAuth.js:40](../../../src/lib/apiAuth.js)), JSON-schema tool call, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30`. **Prospect content is never logged**, on success or error.

**Request:** `brief` (§8.1), `stepPurpose` (§8.1), `buildDraftSource` output (§5.5), `previous` (§7.4), `rejected` (§8.3).
**Response:** `{ text }` **or** `{ insufficient: true }`.

No server-side rate limiting, consistent with all 8 existing PRIM AI routes. Client-side caps (§8.3) bound the spend.

### 8.1 The brief and the step purpose

**The brief is the `mergeScript`-rendered script** ([FollowupNextStep.jsx:13](../../../src/components/FollowupNextStep.jsx)), not the raw one — sending raw tokens invites the model to echo `Hi {first}` into a draft that renders straight into the textarea, and the agent copies a literal placeholder. **The route rejects any draft matching `/\{[a-z]+\}/i`** as malformed (§10).

`agentName` is currently `''` at the mount site ([ProspectsView.jsx:1956](../../../src/components/views/ProspectsView.jsx)), so `{agent}` merges to *"your agent"*. Phase 1 does not change this; the model is told not to invent a signature.

**`stepPurpose` — explicit mapping, data in `followupDraftGate.mjs`:**

| Stage | Steps | Purpose by index |
|---|---|---|
| `MISSED_APPT` | 5 | 0–1 `reschedule_urgent` · 2–3 `reschedule` · 4 `breakup` |
| `PENDING_DECISION` | 5 | 0–1 `clarify` · 2–3 `urgency` · 4 `breakup` |
| `FOLLOWUP_LATER` | 4 | 0–3 `check_in` |

**`FOLLOWUP_LATER` has no breakup step** — its final step is *"monthly check-in! Any change in your situation…"* with `onComplete: 'FOLLOWUP_LATER'` ([followupEngine.mjs:46](../../../src/lib/followupEngine.mjs)), a self-loop. Labelling it `breakup` would instruct the model never to re-open a conversation whose entire job is to re-open it.

**Out-of-range fallback:** any index beyond the table maps to the stage's **last** listed purpose. The playbook is read from storage ([LeadTracker.jsx:641](../../../src/components/LeadTracker.jsx)) so `steps.length` is not guaranteed, and an `undefined` purpose leaves §8.2 bar 1 with no content. A test asserts the table matches the live `DEFAULT_PLAYBOOK` step counts.

*(Note: there is no playbook-editor UI — `setFollowupPlaybook` is called once, on load. The clamp and fallback are defensive, not responses to an existing feature.)*

### 8.2 Prompt contract

Framed as **"write the message this moment calls for"** (D6) — never "rewrite the following". Rewrite framing produces paraphrase: the same sentence with one bolted-on clause, exactly the templated feel this feature exists to remove.

Hard bars:

1. Keep the step's purpose (§8.1). A `breakup` never comes back as a pitch; a `check_in` never comes back as a goodbye.
2. **Only facts present in the supplied source.** No inference, no gap-filling. This prevents *"hope the new job's going well"* reaching someone who never mentioned a job — the single failure that would destroy an agent's trust in one text.
3. **Never reference health, medical conditions, medications, or treatment**, even when the source notes contain them. Refer to coverage needs in general terms only. **This is the controlling PHI boundary** (§5.3) and it governs what reaches a client's phone.
4. **No claims** — no savings, rates, or approval promises. A compliance exposure in R&J Prime's name.
5. Texting length — within one sentence of the brief.
6. Do not repeat anything in `previous` (D8) or `rejected` (§8.3).
7. No `{placeholder}` tokens; no invented signature.
8. Nothing specific worth saying → return `insufficient` rather than padding.

### 8.3 Redo and retry caps

**Redo** sends the displayed draft as `rejected` — otherwise the model receives identical inputs and returns a near-identical message to an agent who clicked Redo *because* they disliked it. `rejected` accumulates within a `sourceHash`, **capped at 3**; beyond that Redo is disabled with *"Try editing it directly."*

**Failure retry** is capped at `attempts: 2` per `sourceHash`. Together these bound the worst case to 5 calls per prospect per step.

## 9. UI — `FollowupNextStep.jsx`

Restructured per §6.2. The ineligible path renders exactly today's card.

### 9.1 Copy must copy what is on screen (D10)

`copy()` writes `text` ([:45](../../../src/components/FollowupNextStep.jsx)), which is `mergeScript(step.script, …)` ([:37](../../../src/components/FollowupNextStep.jsx)) — **the stock template**. Left unchanged, PRIM would render a personalized draft, the agent would click **Copy script**, and paste the byte-identical template this feature exists to eliminate. Every draft silently discarded at the moment of use.

**Copy writes the live textarea value when a draft is displayed, and the stock script otherwise.** `copy()` therefore lives in the inner component (§6.2). Verified explicitly in §13.

Review confirmed this is the only such path: `mergeScript` exists only in this file, no send path consumes `step.script`, and `FollowupDueWidget` reads only `channel` ([:79](../../../src/components/FollowupDueWidget.jsx)).

### 9.2 The rest of the card

- Draft renders in an **editable** textarea replacing the read-only block ([:56](../../../src/components/FollowupNextStep.jsx)). Edits set `edited: true` and persist on blur/unmount (§7.2).
- Provenance line: **`Personalized from your note on <date of the newest agent note>`**, or **`Personalized from the SMS conversation`** when the source was the TextDrip branch (§5.5).
- **Redo** next to Copy, subject to §8.3.
- Not-yet-due + eligible → **Personalize** button in place of auto-generation.
- Ineligible, `insufficient`, or failure → today's card, unchanged, **no AI call**.

**Dark mode:** the remap table in `globals.css` ([:105-115](../../../src/app/globals.css)) keys on literal escaped class names and covers only `bg-slate-50\/60|80`, `bg-slate-900\/40|50`, `bg-white\/80|85|90`. **Any** other opacity variant renders unremapped — the trap behind the invisible hover state on the CSV export modal. This file already carries an unlisted `bg-indigo-50/40` ([:9](../../../src/components/FollowupNextStep.jsx)). New markup uses a listed utility or adds the variant, and is verified in both themes.

**Team-leader mirror:** `FollowupNextStep` is mounted at exactly one site ([ProspectsView.jsx:1168](../../../src/components/views/ProspectsView.jsx)) inside `{!readOnly && (` ([:1166](../../../src/components/views/ProspectsView.jsx)); the other `ProspectsView` mount ([TeamView.jsx:301](../../../src/components/views/TeamView.jsx)) passes `readOnly`. Pre-satisfied; **must not be widened**.

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Route 5xx / network | Stock script; `status: 'failed'`, `attempts++`; retried per §7.4 rule 2 (until `attempts` reaches 2) |
| Aborted (drawer closed mid-request) | **Nothing written**; in-flight entry cleared in `finally`; regenerates on next open (§6.1) |
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
- Website-form re-submit → not eligible; `WEBFORM_TOUCH_PREFIX` matches the literal in `webforms.mjs`.
- TextDrip: genuine inbound → eligible; outbound-only → not; `isDrip: true` only → not; empty bodies → not; missing `textdripChat` → not (no throw).
- **Opt-out — both directions.** Not eligible: `STOP`, `STOP.`, `Stop please`, `stop texting me`, `UNSUBSCRIBE`, `opt out`, and a `Not interested` outcome. **Still eligible** (the over-match cases §5.4's length bound exists to protect): `"End of the month works for me"`, `"Cancel my appointment Tuesday, can we move it?"`, `"Quit my job so I need my own plan now"`, `"Stopped by your office today, call me"`. A test that only checks a keyword mid-sentence does not cover this — the failure is sentence-*initial*.
- `WEBBY_SET`, `APPOINTMENT_SET`, `GHOSTED`, `SOLD`, `LOST` with a valid agent touch → **not eligible** (Phase 1 boundary).
- `buildDraftSource`: `meds` never appears in the output for any input; notes capped at 3, oldest→newest; TextDrip used only when there are no agent notes; `missedApptTime` present only for `MISSED_APPT`.
- `stepPurpose`: matches the live `DEFAULT_PLAYBOOK` step counts; `FOLLOWUP_LATER` has no `breakup`; out-of-range index returns the stage's last purpose.

**`followupDraftCache.test.mjs`**
- `stepKey` uses the **clamped** index; changes with stage or index.
- `sourceHash` deterministic; `["a","b c"]` vs `["a b","c"]` hash **differently**; changes when a note is added, edited, its outcome changes, situation changes, or stepKey changes. **No literal NUL byte in the source file** — asserted by reading the module's own bytes.
- **`sourceHash` covers everything `buildDraftSource` sends** — asserted structurally, not case-by-case: mutate each field of a source object in turn and require the hash to change every time. This is the check that would have caught `firstName` and `missedApptTime` being sent but not hashed, and it stays correct if a field is added later.
- `shouldRegenerate` (§7.4), all five rules: `insufficient` + same hash → **no** call; `failed` + same hash + `attempts < 2` → regenerates; `failed` + same hash + `attempts === 2` → **no** call; stepKey changed + `edited: true` → regenerates **and** rotates `previous`, resetting `attempts`/`rejected`; sourceHash changed + `edited: true` → does **not** regenerate; sourceHash changed + not edited → regenerates without rotating; nothing changed → cache served.
- `previous` caps at 2 newest-first; `rejected` caps at 3; `attempts` caps at 2; all three reset on a stepKey or sourceHash change.
- Prune drops missing and archived prospects, keeps the rest, reports whether anything changed.

**Not unit-testable here:** the route and the JSX — PRIM has no component-test infrastructure. Covered by live verification (§13) and code review.

## 12. Security & compliance

- **Health data** (D5, §5.3): `meds` never read. Other prospect free text is sent unfiltered — **the same posture `/api/textdrip/extract-conversation` has operated under in production for months**, applied consistently. The controlling boundary is the output bar (§8.2 bar 3), backed by PRIM's no-PHI policy and a human reading every message. Deliberately **not** claimed as a guarantee that no health text reaches the API.
- **No cross-account leakage** — `followup_drafts_v1` registered in `APP_KEYS` (§7.1).
- **No opted-out contact** (§5.4) — informational compliance flag, for human review.
- **No prospect-record writes on open** (§7.1).
- **No auto-send** (D10): drafting is not gated, sending is, and PRIM never sends.
- **No claims** in generated text (§8.2 bar 4).
- Prospect content **never logged** server-side.
- Auth via `requireUserId`. Team-leader mirror read-only (§9.2).
- **Blast capture path untouched.**

## 13. Rollout

1. Branch `followup-personalized-drafts` (created). TDD the two pure modules first.
2. `npm test` ≥506 pass · `npm run lint` · `npm run build` all green.
3. Live verification, **both themes**: eligible+due auto-draft · eligible+not-due Personalize · ineligible (no affordance) · **Copy returns the draft, not the template** · edit persists across close/reopen · logging a touch regenerates over an edited draft · Redo differs from the original and disables after 3 · `insufficient` not re-billed on reopen · route failure stops after 2 attempts · close the drawer mid-request, reopen, confirm it regenerates · sign out, sign in as a second account, **confirm no drafts carry over** · team-leader mirror shows no affordance.
4. Fresh-context adversarial review against this spec.
5. Juan merges; `/api/version` polled to confirm.
6. Announcement ([announcements.js](../../../src/lib/announcements.js)) — including that **the feature rewards logging touches**: agents who log their conversations get messages that sound like they remember; agents who don't, get the template.

## 14. History

The original spec covered six stages and added appointment-anchored scheduling. **Four adversarial review rounds, ~40 defects.**

- **Rounds 1–2** (combined spec, withdrawn): every defect lived in scheduling. The morning-of reminder could never render; PRIM would suggest *Missed Appointment* after appointments that went well; revision 1 fixed the `afterDays: undefined` foot-gun at one of three sites and declared the class handled. → Split: appointment reminders deferred to Phase 2.
- **Round 3** (Phase 1 rev 1): `Copy` copied the stock template, discarding every draft at the moment of use. Agent notes — the primary eligibility field — were sent unscrubbed while the spec claimed otherwise.
- **Round 4** (Phase 1 rev 2): the redactor destroyed sales context (*"the prescription drug rider"*) while passing real PHI (*"she is pregnant, due in March"*). Verdict NOT BUILDABLE.

**Revision 3** resolves it by decision rather than by code: PRIM already sends raw SMS threads to Anthropic and constrains the output by prompt. Phase 1 now matches that posture (§5.3), which removes the entire defect class that dominated rounds 3 and 4.

Also carried in from round 4: `rejected` persisted rather than component state; terminal state in the cache with in-flight de-duplication separate, so `attempts` is reachable and an aborted request leaves no stuck marker; the §7.4 regeneration matrix stated explicitly; persist-on-blur instead of a debounce; the `U+0000` separator written as an escape sequence rather than a literal byte; opt-out matching by prefix; the `stepPurpose` out-of-range fallback; `key={prospect.id}`; the `now` memo keyed on `[prospect?.id, open]`; `prospect.textdripChat.messages` named as the source field; and corrected citations.
