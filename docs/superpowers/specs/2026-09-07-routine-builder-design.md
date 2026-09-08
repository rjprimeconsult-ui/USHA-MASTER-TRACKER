# Routine Builder — design

**Date:** 2026-09-07 · **Rev 5 (2026-09-08)** — adds the **live layer** (operator decision
2026-09-08, one build): real appointments and live follow-up names from Prospects,
collision splitting with afternoon-preferred make-up slots, owed time that expires and is
counted, yesterday's miss, and a weekly look-back. Rev 4 was the standalone routine after
three review rounds; rev 5 **reverses rev 4's decision 1** and has not yet been reviewed.
· **Operator decisions (Juan):** blocks ARE wired to live Prospects data (2026-09-08,
supersedes "standalone") · one routine, the same every day — a discipline, not day-types
· permanent top-level view + one PRIM starter routine + Blank · web-push at block time ·
palette (C) on a clock timeline (A) with checkboxes (B); phone = step list · scheduler =
Supabase pg_cron every minute · PWA manifest + iPhone install strip in v1 · all paid tiers
from day one · every day active by default · appointments appear automatically, plus
manual attach · follow-up stages agent-configurable · collisions split the block and
offer a make-up slot preferring the afternoon; no room → a note; expires at midnight and is
counted · UI must read clean and professional. · **Provenance:** 12-agent design
workflow, three 3-lens spec reviews (rev 1–4), and a 6-agent UI design/critique workflow
for the live layer (three designs, three critics; the restraint design won with two grafts).

## 1. Problem

Agents — especially new ones — have no structure inside PRIM for *how* to run a day.
The follow-up cadence engine (`src/lib/followupEngine.mjs`) answers "who do I chase
next"; nothing answers "what am I doing from 8:30 to 10:30." Routine is that surface:
an agent lays out one fixed daily routine as blocks, PRIM lays today's real commitments
over it, shows what is now and next, nudges at block time, and — when an appointment
eats routine time — makes the loss visible and offers to recover it. It is deliberately
a standalone time-triggered surface (the repo's 2026-07-28 lesson: never bolt time-of-
day scheduling onto the cadence engine); it *reads* prospects, it never advances them.

## 2. Scope

**In:** the Routine view (desktop clock timeline + phone step list, one render path);
the block palette; one starter routine + Blank; per-day checkbox/skip done-state; per-
agent timezone; the minute scheduler (route + claim table + pg_cron, one bounded retry)
for **block reminders and appointment reminders**; **the live layer** — today's
appointments overlaid automatically from Prospects (+ manual attach), live follow-up
names inside the follow-up block from agent-selected stages, collision → split → owed
time → afternoon-preferred make-up offer → note → expires and is counted, yesterday's
miss, a weekly look-back; PWA manifest + iOS install strip; feature flag; tests in both
lanes; a live pass with hard gates.

**Out (v1), reasons in §14:** multiple/per-weekday routines; per-block weekday chips;
side-by-side overlap rendering; block Duplicate; mobile Move up/down; day-bounds
settings; template append; a second install strip in Profile; streaks or completion
percentages; email fallback; cross-tab live sync; inactivity auto-pause; a daily push
cap; **auto-checking anything from prospect activity** (logging a touch stays the
agent's job — a name leaves the follow-up list only when the data says so); live names
inside the dial block; a "Call" button or phone number on any block; owed time rolling
into the next day; **any edit to `src/app/api/reminders/route.js`**.

## 3. Architecture in one paragraph

The client stores three per-user documents in `user_kv` (blocks, per-day records,
settings incl. IANA timezone and the follow-up stage selection) and *reads* two
existing ones (`prospects_v1`, `prospect_settings_v1`). At render time a pure
`composeDay()` lays today's appointments over the routine, splits any routine block an
appointment overlaps, computes displaced minutes, and produces the timeline geometry,
the NOW state, and the owed-time offer. A CRON_SECRET-gated `GET /api/routine/tick`,
called every minute by `pg_cron` + `pg_net`, resolves each entitled agent's block
starts and appointment times to UTC instants in that agent's zone, claims due
reminders atomically in `routine_push_log`, sends one name-free web push per item, and
stamps the result. Done-state, owed records, make-up blocks, and yesterday's
acknowledgement live in the per-day array and simply stop applying at local midnight;
the weekly view is derived from the last seven days of that array. iPhone agents
receive push only once PRIM is installed to the Home Screen; v1 ships the manifest.

## 4. Data model & storage

All keys are **JSON documents in the `user_kv` `jsonb` column**; the client `storage`
adapter speaks strings, the cloud row holds parsed JSON, a server read gets it parsed
(legacy rows may hold a string; §6b.1). New keys are **registered in `APP_KEYS`**
(`src/lib/storage.js`); the two arrays are in **`MERGEABLE_KEYS`** (newest-wins per
id via `mergeStore.mjs`). Because merge-on-save resurrects records deleted by another
still-open session (`mergeStore.mjs:34-36`, and `ViewMount` keeps the view mounted),
**nothing in these arrays is hard-deleted — deletes are tombstones retained through
every save.** Guarantee: a delete on one device is not resurrected in the cloud by
another device's next save; the other device sees it on refresh. Key literals live in
`src/lib/routineKeys.mjs` (no imports) — including `PROSPECTS_KEY = 'prospects_v1'` and
`PROSPECT_SETTINGS_KEY = 'prospect_settings_v1'` (today a `const` inside
`LeadTracker.jsx:149`; the tick route needs the literal, so it is duplicated here with
a comment, not imported from a component).

### 4a. `routine_blocks_v1` — the routine (array)

```json
{ "id": "blk_k3f9x2q", "name": "Dial block", "paletteId": "dial", "category": "dial",
  "startMin": 510, "durationMin": 120,
  "remind": { "enabled": true, "minutesBefore": 5 },
  "prospectId": null, "note": "", "deletedAt": null, "createdAt": "…", "updatedAt": "…" }
```
Ids from **`routineModel.uid()`** (`'blk_' + 7 base36`; not `utils.uid()`, which is a
UUID). Minutes after local midnight, snapped to 5; duration 10–720; `startMin +
durationMin ≤ 1440`; ≤ 60 live blocks. `prospectId` is set only on an `appt`-category
block by **manual attach** (§7h.1); an attached block renders as an appointment. Delete
= `deletedAt` + bump `updatedAt`; un-delete = `deletedAt: null` + bump.

`sanitizeBlocks(blocks)` → the persistable array (retains tombstones, prunes those
older than 7 days, dedupes newest-wins, clamps/snaps, whitelists `category` ∈ `dial,
followup, text, appt, review, admin, learn, break, custom`, sorts, runs
`resolveOverlaps` on the live subset). **`liveBlocks(blocks)`** = sanitized minus
tombstones — what the canvas, NOW card, and tick use. **`resolveOverlaps(live)`**: the
later-`updatedAt` block moves to the next free gap; equal stamps → greater `id` moves;
no gap → shrink to the largest free gap ≥ 10 min; none → tombstone + toast "No room for
<name>"; > 60 live → newest-`createdAt` extras tombstoned. Two live blocks never share
a `startMin`. The routine itself is **never modified by appointments** — splitting is
a render-time projection (§7h.3), which is what lets tomorrow start clean.

### 4b. `routine_day_v1` — per-LOCAL-day records (array, mergeable, 7-day retention)

One array, discriminated by `kind`, all with `id`, `day`, `updatedAt`:

| kind | id | fields | meaning |
|---|---|---|---|
| `done` | `day\|blockId` | `blockId, status: done\|skipped\|cleared, at` | checkbox / Skip today; `cleared` = unchecked tombstone |
| `held` | `day\|appt\|prospectId` | `prospectId, at` | the appointment's checkbox ("Held", §7h.1) |
| `owed` | `day\|owed` | `minutes, offeredStartMin\|null, status: offered\|accepted\|skipped\|expired` | one summed record per day (collisions sum, §7h.3) |
| `makeup` | `day\|makeup\|n` | `startMin, durationMin, category, name` | a **today-only** block created by accepting the offer; never written to the routine |
| `ack` | `day\|ack` | — | yesterday's-miss line dismissed today |

Pruned on save to the last 7 local days (`addDays(today, −7)`). `done`/`held` writes
are immediate, never debounced. At local midnight nothing runs: an `owed` record whose
`day` is no longer today with `status` ≠ `accepted` **is** an expired record — §7h.5's
weekly derivation treats it as such; a `makeup` for a past day is simply not today's.

### 4c. `routine_settings_v1` — object, last-write-wins

```json
{ "version": 1, "timezone": "America/Chicago", "timezoneMode": "auto",
  "remindersEnabled": true, "defaultMinutesBefore": 5,
  "activeDays": [0,1,2,3,4,5,6],
  "followupStages": ["MISSED_APPT","FOLLOWUP_LATER","PENDING_DECISION"],
  "followupStagesSeeded": false, "lastReplacedBackup": null }
```
`activeDays`: ints 0–6, **0 = Sunday** (JS `getDay`; `localWeekday()` matches; chip
labels share the constant); every day by default; `[]` allowed (header "All days off").
**`followupStages`**: the stage ids that feed the follow-up block, chosen from the
agent's own `prospect_settings_v1.stages` (custom stages included — e.g. one account's
"Try to Reengage/Get interest back"). **Seeding on first open** (`followupStagesSeeded
=== false`): the three defaults above **plus any stage whose label matches
`/express|interest|re-?engage/i`**, then the flag flips — so an agent with an
"Expressed Interest" custom stage starts with it selected, and an agent without one
loses nothing. Ids no longer present in `stages[]` are ignored at read time (never
deleted, so a renamed-back stage reappears). `sanitizeSettings` as rev 4 plus:
`followupStages` → unique strings, unknown ids kept. `lastReplacedBackup` backs the
10-second Replace undo. Canvas bounds derive from blocks (§7c), not stored.

### 4d. `routine_push_log` — Postgres table (server-only)

```sql
create table public.routine_push_log (
  user_id uuid not null, fire_key text not null, block_id text not null,
  local_day date not null, fire_at_utc timestamptz not null,
  status text not null default 'claimed',   -- claimed | sent | failed
  attempts int not null default 1, sent_at timestamptz, error text,
  created_at timestamptz not null default now(),
  primary key (user_id, fire_key));
create index routine_push_log_created_idx on public.routine_push_log (created_at);
alter table public.routine_push_log enable row level security;  -- no policies: service role only
```
`block_id` carries a block id **or** `appt:<prospectId>`. A table, not a `user_kv` key:
`migrateLocalToCloud` (`storage.js:385-400`) would overwrite a mirrored ledger and
re-arm sent reminders.

### 4e. Prospects — read-only inputs

`prospects_v1` is an **array** of prospect records (`stage`, `appointmentTime` ISO
string, `archivedAt`, `lastContact` `YYYY-MM-DD`, `cadence`, `name`, `id`);
`prospect_settings_v1` is `{ stages: [{ id, label, color }], customFields }`. Both are
already loaded by `LeadTracker` and passed down as props (`prospects`,
`prospectSettings`); RoutineView receives them like `FollowupDueWidget` does, plus
`onOpenProspect(id)`. **Nothing in Routine writes to either key.** Server-side, the tick
reads `prospects_v1` exactly as `reminders/route.js:259-263` does — but evaluates
"today" in the agent's zone (`localDayKey`), never the cron's server-local `isToday`.

## 5. Timezone

Unchanged from rev 4: `routine_settings_v1.timezone` (IANA), captured from
`Intl.DateTimeFormat().resolvedOptions().timeZone` (guarded), shown as a header chip,
`auto` re-detects with a toast, `manual` pins. `src/lib/tz.mjs`: `isValidTimeZone`,
`offsetMinutesAt`, `localDayKey`, `localWeekday` (0 = Sunday), `localMinuteOfDay`,
`addDays`, `zonedTimeToUtc` (spring gap → forward; fall overlap → first; mismatch →
`utc1`). **Only a block's start minute goes through `zonedTimeToUtc`; reminder and end
are instant offsets.** Appointment instants come from `Date.parse(appointmentTime)`
(already absolute); their local minute-of-day for the timeline is
`localMinuteOfDay(instant, tz)`. Invalid/missing zone → reminders skipped, chip says
so; the zone is part of every `fire_key`.

## 6. Scheduler

### 6a. Trigger
`pg_cron` + `pg_net` every minute, by operator decision; `vercel.json` keeps only the
daily reminders cron and a tripwire forbids sub-daily entries. The schedule command is a
DO block that raises if the Vault secret is null (runtime), preceded by the same check
at schedule time — exactly rev 4 §6a's SQL.

### 6b. Route: `src/app/api/routine/tick/route.js`
`runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`; auth copied from
`reminders/route.js:245-249`. Pure core `src/lib/routineTick.mjs`, clock injected.
Constants: `LOOKAHEAD_SEC=45`, `GRACE_MIN=10`, `COOLDOWN_MIN=15`, `STALE_CLAIM_MIN=2`,
`LOG_WINDOW_MIN=60`, `APPT_LEAD_MIN=5`.

0. VAPID unset → `200 { skipped:'push_not_configured' }`.
1. **Load**: `user_kv` rows for `routine_blocks_v1`, `routine_settings_v1`,
   `push_subscriptions_v1`, **and `prospects_v1`**; `routine_push_log` (≤ 60 min,
   indexed by `user_id`); `profiles` with the 8-column select from
   `email/send/route.js:146`. Every read checks `error`. Values arrive parsed; legacy
   strings via `try { JSON.parse } catch { null }`; bad shapes → empty, `bad_shape`,
   never abort. Blocks/settings sanitized; the tick works on `liveBlocks`. Prospects
   filtered to `!archivedAt && appointmentTime` (a manual-attach block has no
   `appointmentTime` — it is a routine block and reminds as one).
2. **Skips, in order, first match, counted once**: `not_entitled`
   (`canAccessBetaFeature('routine_builder', profile).canAccess !== true`),
   `disabled`, `bad_tz`, `no_subs` (without claiming).
3. **Candidates — today only** (`localDayKey(now, tz)`; a previous-day pass is
   provably dead). Two kinds:
   - **Routine blocks** with `remind.enabled` and today's weekday in `activeDays`:
     `startAt = zonedTimeToUtc(today, startMin, tz)`, `endAt = startAt + durationMin·60k`,
     `fireAt = max(startAt − minutesBefore·60k, zonedTimeToUtc(today, 0, tz))`.
     **Split awareness:** if an appointment overlaps the block such that the block's
     first surviving segment starts *later* than `startMin` (the appointment ate the
     head, §7h.3), `startAt` is that segment's start — the reminder fires for the time
     the agent will actually work. `fire_key = ${blockId}|${today}|${fireMin}|${tz}`.
   - **Appointments**: **the same pure `todaysAppointments(prospects, tz, now)` the
     timeline uses (§7h.1)** — `!archivedAt`, stage ∈ {WEBBY_SET, WEBBY_CONFIRMED,
     APPOINTMENT_SET}, `appointmentTime` in today — so the tick and the timeline can
     never disagree about what is an appointment. For each: `startAt =
     Date.parse(appointmentTime)`, `endAt = startAt + 30 min`
     (ASSUMPTION — prospects carry no duration; 30 is the palette default for
     `inperson`), `fireAt = startAt − 5 min`, `block_id = appt:${prospectId}`, `fire_key
     = appt|${prospectId}|${today}|${fireMin}|${tz}`. Appointments ignore `activeDays`
     (a booked appointment on a day off still matters) and have no per-item toggle;
     `remindersEnabled=false` silences them with everything else.
   **Due iff `fireAt ≤ now + 45 s` AND `now < startAt + 10 min` AND `now < endAt`.**
   Aged-out reminders are never fired, never stamped. **Cooldown on fire instants**:
   skip iff a row for the same `(user_id, block_id)` with a different `fire_key`,
   status `claimed|sent`, and `|candidate.fireAt − row.fire_at_utc| ≤ 15 min`.
4. **Claim before send** — unchanged: `upsert(rows, { onConflict:'user_id,fire_key',
   ignoreDuplicates:true }).select('fire_key')` [LIKELY RETURNING-only-inserted; live-
   gated]. Overlapping ticks split the set; moved blocks and zone changes re-arm.
5. **Send — one push per item, never coalesced.** Routine copy: `N = round(|startAt −
   now|/60k)`; `N===0` → "Dial block starts now"; pre-start → "starts in N min"; after →
   "started N min ago"; body "8:30–10:00 · then Break at 10:30"; `tag:'routine-'+blockId`.
   **Appointment copy is fixed and name-free: title "PRIM", body "Appointment in 5
   min" (or "Appointment starts now" / "Appointment started N min ago"), `tag:
   'appt-'+prospectId`** — no name, no stage, nothing about the prospect reaches a lock
   screen. `url: appUrl()+'/?view=routine'`. `src/lib/pushServer.js` is derived from
   `reminders/route.js:26-55, 379-386` (that route untouched) and **returns `{
   sentCount, dead, failures:[{endpoint,statusCode,message}] }`**; `pruneDeadSubs`
   re-selects before writing and checks `error` (`prune_failed`).
6. **Stamp** as rev 4: `sent`; retryable failure → `failed` attempts 1; `all_subs_dead`
   → `failed` attempts 1 (retryable within grace); non-retryable 4xx → `failed`
   attempts 2, never retried. One CAS retry for `failed`/stale-`claimed` rows.
7. Housekeeping at minute 7; response JSON counts every outcome, now including
   `appts_due`, `appts_sent`.

### 6c. Failure modes, on record
All rev 4 cases hold (moves absorbed within 15 min, re-arm beyond; zone change
re-arms; tombstone wins the merge; sanitize-on-read heals two-tab overlaps; PK claim;
aged-out storms impossible; stale claim re-claimed; instants across DST). New:
appointment time edited in Prospects → new `fireMin` → new key → re-arms (cooldown
absorbs a ≤ 15-min nudge); prospect moved off the three appointment stages (to
Pending Decision, Sold, Lost, …) → **it leaves both the timeline and the tick at once**,
because both call the same `todaysAppointments()` — a leftover `appointmentTime` on a
non-appointment stage never pushes; moved back → it reappears and, if its reminder
minute is still ahead, re-arms; a block whose head is eaten reminds for the surviving
segment; an appointment with no push subscription is a `no_subs` skip like any other.

## 7. UI

### 7a. View & header
`src/components/views/RoutineView.jsx` — props `{ showToast, prospects,
prospectSettings, onOpenProspect }`. Owns the three documents, the `loaded` guard,
a 30-second clock (paused when hidden), saves (drag/resize/keyboard/delete/checkbox/
settings immediate; editor text fields 400 ms debounce, flushed on close), timezone
capture, entitlement (§9), `devicePushOn` (async `isPushEnabled()` on mount / after
`enablePush()` / on `visibilitychange`), **one render path** via
`useMediaQuery('(min-width: 768px)')` — `<Timeline/>` or `<MobileRoutineList/>` under a
shared `<NowCard/>`, so clocks and drag hooks mount once — and **`composeDay()`**
(§7h.3), recomputed on the clock tick and whenever blocks, day records, or prospects
change. `RoutineHeader`: title, timezone chip, **Bell = `settings.remindersEnabled`**
(turning ON with `devicePushOn===false` calls `enablePush()` first), settings gear →
`RoutineSettingsSheet` (timezone, default reminder lead, active-day chips, **follow-up
stages** — a checklist of the agent's `stages[]` with the selected ids checked —
"Start over from a template"). The strip, not the Bell, reflects device status.

### 7b. NOW card — `NowCard.jsx`
Sticky premium-card; category tile left (gradient for `appt`), primary action right,
2 px accent progress bar. `nowState()` → `{ phase: upFirst|now|free|dayDone, behind:
block|null }` over the **composed** day (segments and appointments are timeline items
like any other). Phases as rev 4; the current item may be an appointment ("NOW · 10:00
– 10:30 / Maria Delgado / 12 min left · then Break at 10:30", checkbox labeled *Held*).
**Below the bar, exactly one 11 px meta line**, first match wins, no icon, no
background: (1) **live make-up offer** — "30m of dial time displaced." in
`text-slate-500` then a text button "Add 2:00–2:30" (weight 600, accent) " · " "Skip"
(weight 500, slate-400); (2) the **running-behind** chip; (3) **static owed** — "30m
owed" (slate-400, non-interactive) after Skip or when no slot exists; (4) **yesterday's
miss** — "Yesterday · 45m follow-up unfinished" (slate-400) with a 12 px × in a 20 px
(44 px on phone) hit target. Copy variants: "…dialing unfinished" / "…follow-up
unfinished" / both → "Yesterday · 1h 10m unfinished". Minutes ≥ 60 render "1h 25m".
Below the meta line, the **reminder strip** cases as rev 4 (reminders off → install
strip → blocked → device off → bad tz → all days off).

### 7c. Timeline (desktop) — `Timeline.jsx`, `TimelineBlock.jsx`
Geometry (`routineLayout.mjs`): `PX_PER_MIN=2`, `SNAP_MIN=5`, `DEFAULT_START=360`,
`DEFAULT_END=1260`, bounds derived from **composed** items. Routine block: tint
`hex+'1F'` light / `hex+'33'` dark (inline hex — `globals.css` remaps only four hues),
3 px left stripe, `role="button" tabIndex=0`, checkbox 18 px, title 12 px/500, second
row (≥ 44 px) time range + bell + reminder minute, 6 px resize handle. **Type scale is
PRIM's: 10 / 11 / 12 / 14 px — no 13 px anywhere.** Drag/resize via
`usePointerDrag.js` (pointer capture, 4 px threshold, Escape cancels, no dependency):
move slides to the nearest free gap else revert + toast; resize clamps to the next
item's start; palette drag-in ghosts; palette click adds at the next free slot ≥
default duration at/after now else toast "No room today"; click empty time (spec
addition) → "+ 10:15" pill → editor. **Segments and appointments are not draggable**;
dragging a split block's first segment drags the underlying routine block. Keyboard as
rev 4; single-delete undo = RoutineView-local 5 s toast, un-tombstone on Undo. Every
commit → `sanitizeBlocks` → save. **Density tiers** (graft): `full` = the current and
next items (all rows); `compact` = every other future item (title + time only);
`spent` = past items (title only, opacity 0.55, checked state shown). Names (§7h.2)
render in `full` only.

### 7d. Palette — `routinePalette.mjs`, `BlockPalette.jsx`
As rev 4 (10 entries, `defaultMin`, `defaultRemind` — `break` off; `appt` hex
`#8b5cf6`; NowCard may render the accent gradient for `appt` only). New blocks get
`remind = { enabled: palette.defaultRemind, minutesBefore: settings.defaultMinutesBefore }`.

### 7e. Templates — `routineTemplates.mjs`
**One starter routine + Blank** (operator: every day is the same discipline, not day
types). **Starter — "Agent day"**: 08:00 Morning review 30 · 08:30 Dial block 120
"Fresh leads first. Aim for 40 dials." · 10:30 Break 15 · 10:45 Text blast + replies 30
· 11:15 Follow-up queue 75 · 12:30 Lunch (break, 45, no reminder) · 13:15 Dial block 120
"Callbacks + aged leads" · 15:15 Break 15 · 15:30 Follow-up queue 60 · 16:30 Apps &
underwriting 45 · 17:15 Day wrap-up (review, 15) "Log every touch. Set tomorrow's top
3." — collision-free, no midnight crossing (test-pinned). Template entries carry
`paletteId, name?, startMin, durationMin?, note?, remind?`; `instantiateTemplate(t, {
now, defaultMinutesBefore })` fills the rest. **`applyTemplate(existing, template, {
replace=false, now, defaultMinutesBefore })` → `{ blocks, backup }`** exactly as rev 4
(non-empty + !replace → unchanged; empty → seeded; replace → old live blocks tombstoned
+ backup; Undo re-sanitizes `backup` with bumped stamps). Empty state: two cards.
Replace: ConfirmDialog + 10-second Undo.

### 7f. Editor & mobile
`BlockEditorSheet.jsx` (desktop popover per DateTimePicker's pattern; phone `GlassModal`
from `src/components/motion/MotionPrimitives.jsx:358`, `sheet`): name ≤ 60, palette,
start, duration, reminder lead (off/0/5/10/15), note ≤ 200 with the tray hint, and —
for `appt` blocks — **Attach prospect** (§7h.1). **Phone list** (`MobileRoutineList.jsx`):
shared NowCard, rows with 4 px stripe / time column / title / bell / 28 px right-thumb
checkbox, rose now-divider, "+ Add block" FAB → `PaletteSheet`; row tap → editor;
long-press → Skip today / Delete. Appointment and follow-up rows per §7h.

### 7g. Done-state
As rev 4 (`blockVisualState`: future/current/past × done/skipped/unchecked/cleared).
Segments of one split block share one `done` record (the block's id). An appointment's
checkbox writes a `held` record.

### 7h. The live layer — winning design: restraint (no new containers) + two grafts

**7h.1 Appointments.** `todaysAppointments(prospects, tz, now)` (pure,
`routineLive.mjs`): prospects with `!archivedAt`, `stage ∈ {WEBBY_SET,
WEBBY_CONFIRMED, APPOINTMENT_SET}`, and `appointmentTime` whose `localDayKey` is today
→ `{ prospectId, name, startMin: localMinuteOfDay, durationMin: 30, confirmed: stage
!== 'WEBBY_SET' }`. Plus **manually attached** `appt` blocks (`prospectId` set) — the
editor's "Attach prospect" is a native `<select>` (the app's existing select styling)
listing today's un-attached prospects in those three stages first, then the rest
alphabetically, first option "— none —"; selecting converts the block in place. An
attached block keeps its own `startMin/durationMin`. **Rendering — figure/ground
inversion (graft from the density design):** the appointment is **the only white
surface on the timeline** — `bg-white` (which `.dark` remaps to the dark surface
automatically), 0.5 px `border-slate-200/70`, **4 px** `#8b5cf6` left stripe (routine
stripes are 3 px), 10 px short of the lane's right edge so the tinted plane shows
behind it. **Nothing else distinguishes it**: no icon, no "APPT" label, no avatar, no
stage chip, no bell (appointments always remind, so a bell on every one is noise).
`WEBBY_SET` = the three non-stripe sides dashed (2/3), `title="Not confirmed"`. Row 1:
checkbox (18 px, violet when checked, label **Held**) + **the prospect's name as the
title**, 12 px/**600** (routine titles are 500 — the second, quieter tell). Row 2 (≥ 44
px): "10:00–10:30" 11 px slate-500. At 120 px nothing more is added — the emptiness is
the design. Tapping the name → `onOpenProspect(id)`. **Names render in-app only**
(§6b.5; test-pinned).

**7h.2 Follow-up names.** `followupQueue(prospects, stageIds, now)` (pure): prospects
with `!archivedAt && stageIds.includes(stage)`, ordered **`lastContact` ascending with
empty first** (never contacted = oldest; ASSUMPTION — the operator said "oldest first";
`dueStatus().daysLate` only exists for prospects with an armed cadence, and stage-
selected prospects often have none), then by `createdAt`. Age label = days since
`lastContact` ("12d"), or "new". Inside the follow-up block, **`full` tier only**:
header row = checkbox + "Follow-up queue" + the bare integer count right-aligned (12
px/600 **slate-400** — not amber: amber is reserved, below); then `min(4, floor((h −
58)/20))` name rows (12 px/500 slate-700, age right, no dividers, no stage labels, no
avatars, no per-name checkboxes); then "+10 more" (11 px/500 accent) when overflowing.
Under 78 px: header + "14 due · oldest 12d". Tapping the name region or "+N more" opens
**`GlassModal sheet`** with header "Follow-up queue · 14 due" and **`FollowupDueWidget`'s
exact row grammar** (`divide-y divide-slate-100`, name 14 px/600, secondary line "Missed
Appt · 12d", `ArrowRight`); a row → `onOpenProspect(id)` (where Log touch lives).
**No checkbox per name** — a name leaves only when the data changes. 10 names and 60
names look identical except the integer. `compact`/`spent` tiers show the count only.
Stage selection lives in Settings, never on the block.

**7h.3 Collision → split → owed.** `composeDay({ live, appointments, makeups, dayRecords,
nowMin })` (pure, `routineLive.mjs`) → `{ items, owedMin, offer }`:
- Sort appointments + attached blocks by start. For each routine block (non-`appt`)
  overlapped by one or more appointment intervals, cut it into the surviving segments;
  **a segment under 10 min is dropped and its minutes count as displaced.** `displaced
  = Σ overlap minutes + dropped segments`. Segments share the block's id, fill, stripe,
  and `done` record; only the **first** segment carries checkbox/title/bell; later
  segments show only their time range (11 px slate-500), no "cont." label, no
  connector — the shared stripe says it.
- **Loss marker**: "−30m" (U+2212, 11 px/600, **amber `text-amber-600` / dark
  `text-amber-400`** — amber means exactly one thing on this screen: routine time lost
  — as text, not a pill) 8 px from the right and 6 px from the bottom of the segment
  adjacent to the appointment; omitted from the timeline when that segment is under
  40 px (it still lives in the NOW card). On phone the step list has no split
  rendering: the displaced routine row shows its shortened range and "−30m" in the time
  column.
- **One `owed` record per day, summed**: `minutes = Σ displaced` across all collisions
  of the routine's *non-break* blocks (breaks eaten by appointments are not owed).
  Multiple collisions produce one number and one offer ("55m of routine displaced.").
- **Slot-finder** `findMakeupSlot(items, owedMin, nowMin)`: free gaps are computed
  against **all** composed items (segments, appointments, existing make-ups). Return
  the first gap ≥ `owedMin` starting **on or after 12:00 local and after now**; if none,
  the first such gap after now; else `null`. Prefers the afternoon by operator decision.
- **Offer lifecycle** (`owed.status`): `offered` while a slot exists and the agent has
  not answered → the NOW-card line shows "Add 2:00–2:30 · Skip". **Accept** → a
  `makeup` record `{ startMin, durationMin: owedMin, category, name: 'Dial block
  (make-up)' }` (category of the largest displaced block), rendered as a routine block
  with a **dashed 3 px stripe** (dash 4 / gap 3 — the only difference from a real
  block), reminding like one; `owed.status='accepted'`; the "−30m" markers vanish; no
  toast — the block appearing is the confirmation. **Skip**, or no slot → `owed.status
  = 'skipped'` / stays `offered` with `offeredStartMin: null` and the line collapses to
  the static "30m owed" **note**; it never changes again today. **Midnight**: the record
  is no longer today's — expired by definition, counted (§7h.5). A make-up block that
  is itself hit by a later appointment is re-split like any block; its displaced
  minutes re-enter the sum.
- **Accountability**: `dayDone` requires `behind === null` **and** no `owed` record in
  `offered` status with a slot still available — the day does not read as finished
  while recoverable time is on the table. Skipped or slotless owed time does not block
  `dayDone`; it is the agent's call, on record.

**7h.4 Yesterday's miss.** On open, `yesterdayMiss(blocks, dayRecords, tz, now)` (pure)
sums the minutes of yesterday's live non-break blocks (on an active day) that have no
`done`/`skipped` record for yesterday, plus yesterday's expired owed minutes. > 0 and
no `ack` for today → the meta line (§7b, lowest priority) renders once per day:
"Yesterday · 45m dialing unfinished". Pure text; the × writes `ack`; it also **self-
retires on the first `done` check of the day**. It never alters today's blocks, never
adds minutes, never pushes, never counts streaks, never says "you missed".

**7h.5 Weekly look-back.** At the very bottom of the view, on the page background
under a 0.5 px hairline: collapsed by default **every session** (collapse state not
persisted) — one line, "This week · 2h 10m displaced" (12 px/500 slate-500, tabular)
with a `ChevronRight`. Expanded (96 px, FadeIn): seven 20 px bars on a 44 px band,
height = `clamp(2, minutes/150·44, 44)`, fill slate-300 (dark slate-600), today's bar
slate-400; "M T W T F S S" 10 px under them. **Nothing else** — no numbers, no
tooltip, no goal line, no week-over-week, no color that implies good or bad.
`weeklyDisplaced(dayRecords, tz, now)` (pure) sums, per local day of the last 7, the
`owed` record's minutes for days where `status !== 'accepted'` (expired/skipped/
slotless) — "displaced and not recovered". Retention already covers it (§4b).

**What the design refuses to show** (from the winning submission, kept as tests of
restraint): any icon on appointments; stage names on the timeline; a phone number or
Call button on any block; a completion percentage or dial count; a colored badge for
owed time; a separate owed/displaced panel; per-collision lines; streaks; tooltips or
numbers on the weekly bars; confirmation toasts for accept/skip; a second meta line;
prospect names or stages in any push; dividers or avatars in the name list.

## 8. iOS / PWA — unchanged from rev 4
`buildAppMetadata(role)` in `src/lib/appMetadata.mjs`; `layout.js` →
`generateMetadata()` reading `x-prim-role`; manifest + `appleWebApp` + `icons.apple`
only when `role !== 'marketing'`; `public/manifest.webmanifest` (`start_url "/"`,
`standalone`, `theme_color #6366f1`), icons at `/icons/prim-192.png`, `/icons/prim-
512.png`, `/apple-touch-icon.png` generated once with `sharp` (present); no service-
worker change; install strip in the NowCard when iOS && `navigator.standalone===false`.

## 9. Navigation, gating, rollout — unchanged from rev 4, plus props
`NAV_TABS` + `ICONS` (`CalendarClock`) after Overview; `<ViewMount viewKey="routine">
<RoutineView showToast={showToast} prospects={prospects}
prospectSettings={prospectSettings} onOpenProspect={openProspect} /></ViewMount>`
(`LeadTracker` already holds all three — `FollowupDueWidget` receives them the same
way); `?view=` deep link only for ids in the user's filtered tab list; flag
`routine_builder { requiredTier:'starter', publicGA:true }`; non-entitled → the
`AgentSettingsPanel.jsx:343-361` locked card, zero writes; `[announce]` on merge.

## 10. Pure modules (node lane)
`routineKeys.mjs` · `tz.mjs` · `routineModel.mjs` (`uid`, `sanitizeBlocks`,
`liveBlocks`, `resolveOverlaps`, `sanitizeDay`, `sanitizeSettings`, `seedFollowupStages`,
`applyTemplate`, `instantiateTemplate`, `DEFAULT_SETTINGS`) · **`routineLive.mjs`**
(`todaysAppointments`, `followupQueue`, `composeDay`, `findMakeupSlot`,
`yesterdayMiss`, `weeklyDisplaced`) · `routinePalette.mjs` · `routineTemplates.mjs` ·
`routineLayout.mjs` · `routineClock.mjs` (`nowState`, `blockVisualState`, `formatTime`,
`formatMinutes`) · `routineTick.mjs` · `appMetadata.mjs`. Client: `routineStore.js`,
`usePointerDrag.js`, `useMediaQuery.js`. Server: `pushServer.js`.

## 11. Operator config (Juan, before the live pass) — unchanged from rev 4
0. Vercel Production: confirm `CRON_SECRET` exists (add + redeploy if not) and
   `NEXT_PUBLIC_SITE_URL = https://app.primtracker.com`.
1. Supabase: enable **pg_cron** and **pg_net**. 2. Vault: `prim_cron_secret` = `CRON_SECRET`.
3. Run `routine-push-log-migration.sql`, then `routine-tick-cron.sql` (pasted in chat).
4. Gate 0: `net._http_response` shows `200`; `cron.job_run_details` shows `succeeded`.
5. Check the manifest icons on an iPhone Home Screen.

## 12. Testing

- **Node lane** — everything in rev 4 §12 (tz incl. DST instants, `resolveOverlaps`
  rules, tombstones, `applyTemplate`, tick windows/claims/cooldown/retry/entitlement/
  shapes) **plus `routineLive.test.mjs`**: `todaysAppointments` — stage filter (a
  PENDING_DECISION prospect with a time today is excluded; SOLD excluded), timezone
  day boundary (an 11:30 PM Central appointment is *tomorrow* in Eastern), unconfirmed
  flag, manual-attach precedence; `followupQueue` — stage selection incl. a custom id,
  `lastContact` empty-first ordering, stable tiebreak, archived excluded, count with 60
  prospects; `composeDay` — appointment mid-block → two segments, head → one shorter
  segment starting later, tail → one, whole → zero segments (all minutes displaced), a
  9-minute remnant dropped and counted, breaks never owed, two collisions → one summed
  `owed`, a make-up block re-split by a later appointment; `findMakeupSlot` — afternoon
  gap preferred over an earlier one, falls back to after-now, `null` when full, never
  before now, respects existing make-ups; `yesterdayMiss` — unchecked + expired owed
  summed, `ack` suppresses, inactive day ignored, first `done` of today retires it;
  `weeklyDisplaced` — accepted excluded, expired/skipped/slotless included, 7-day
  window in the agent's zone; `seedFollowupStages` — regex match adds "Expressed
  Interest / Aiming APPT" and "Try to Reengage/Get interest back", flag flips once.
  `routineTick.test.mjs` adds: appointment candidate at T−5, aged out at T+11, `activeDays`
  ignored for appointments, SOLD/LOST excluded, **push payload for an appointment
  contains no `name` and no stage string** (grep the built payload for the fixture
  name), block whose head was eaten reminds for the surviving segment, appointment
  time edited → re-arms.
- **UI lane** — rev 4's suites plus: `TimelineBlock` renders an appointment with no
  `<svg>` icon and no bell; the follow-up block renders ≤ 4 names in `full` and none
  in `compact`; the count is slate not amber; "+N more" opens the sheet with
  `FollowupDueWidget` row classes; NowCard renders exactly one meta line in each
  priority state; Accept writes one `makeup` record and no toast; Skip collapses to
  "30m owed"; the yesterday × writes `ack`; `RoutineView` writes nothing to
  `prospects_v1` (mock `setItem`, assert never called with that key).
- **Tripwires** — rev 4's, plus: the tick route's push payload builder for
  appointments contains the literal `'Appointment in'` and no reference to `.name`.
- **Mutation checks** — rev 4's, plus: drop the stage filter in `todaysAppointments`
  → exclusion test red; sort `lastContact` descending → ordering test red; count breaks
  as owed → breaks test red; remove the 12:00 preference → afternoon test red; include
  `accepted` in `weeklyDisplaced` → red; put `p.name` in the appointment payload → red.
- **Live pass** — rev 4's gates 0–6, plus: (7) a real prospect with a 10:00
  appointment today appears white on the timeline with no icon; (8) a routine block it
  overlaps shows two segments and "−30m", the NOW card offers an afternoon slot, Accept
  places a dashed make-up block that then reminds; (9) the appointment push arrives
  name-free 5 min before; (10) the follow-up block lists the agent's real stage
  selection oldest-first and the sheet opens the prospect; (11) next morning the
  yesterday line appears once and retires on the first check; (12) the weekly line
  shows the counted minutes.

## 13. Risks on record
1–9 as rev 4 (pg_cron hand-config; RETURNING semantics [LIKELY]; first pointer-drag;
detected timezone; 15-entry tab strip; block names in the tray; iOS install step;
settings LWW; tombstone growth). New: **10.** appointment duration is assumed 30 min —
a 90-minute in-person appointment displaces less than it should until the agent
attaches a block with the real duration (manual attach exists for this); **11.**
`followupQueue` ordering by `lastContact` differs from `FollowupDueWidget`'s cadence
ordering — two "oldest first" lists that can disagree; documented in the sheet header
copy ("by last contact"); **12.** prospect names now live on a screen agents may share
— the PHI banner component the app already ships applies to Routine as to Prospects;
**13.** the stage-label regex seed can select an unintended custom stage — it is
visible in Settings and one tap to fix; **14.** an agent with 300 prospects makes
`composeDay`/`followupQueue` run on every 30-second tick — both are O(n) and
memoized on `[prospects, blocks, dayRecords, minute]`; measured in the live pass.

## 14. Deferred (with the reason)
Multiple/per-weekday routines (one discipline is the point); today-only manual
overrides beyond the make-up offer; mobile Move up/down; day-bounds settings; template
append; Profile install strip; streaks/percentages (a look-back, not a scoreboard, by
design); timezone on `agent_profile_v1`; quiet hours; cross-tab realtime; email
fallback; `pushServer` de-duplication; a11y pass; **live names in the dial block** (the
operator floated it; the restraint design refused it — revisit after usage); **owed
time rolling to the next day** (operator: expires and is counted, the agent decides);
**per-appointment duration on prospects** (would fix risk 10 at the Prospects layer).
