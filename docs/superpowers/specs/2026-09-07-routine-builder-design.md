# Routine Builder — design

**Date:** 2026-09-07 · **Rev 6 (2026-09-08)** — rev 5 introduced the live layer; its
first four-lens review found 3 blockers (`appointmentTime` is a zone-less wall-clock
string, manual attach mutated the permanent routine, owed math lost minutes on
re-collision), ~16 majors, ~11 minors — all folded in here. Rev 4 was the standalone
routine after three review rounds. · **Operator decisions (Juan):** blocks ARE wired to
live Prospects data, read-only (2026-09-08) · one routine, the same every day · permanent
top-level tab (confirmed 2026-09-08 over embedding in Prospects) + one PRIM starter +
Blank · web-push at block time and 5 min before appointments · palette (C) on a clock
timeline (A) with checkboxes (B); phone = step list · Supabase pg_cron every minute · PWA
manifest + iPhone install strip in v1 · all paid tiers day one · every day active by
default · appointments automatic + manual attach · follow-up stages agent-configurable ·
collision → split → owed → afternoon-preferred make-up offer → note → expires at midnight
→ counted; the agent decides · UI clean and professional, one build. · **Provenance:**
12-agent design workflow, three 3-lens reviews (rev 1–4), a 6-agent UI design/critique
pass, and a 4-lens review of rev 5.

## 1. Problem

Agents — especially new ones — have no structure inside PRIM for *how* to run a day.
The cadence engine (`src/lib/followupEngine.mjs`) answers "who do I chase next";
nothing answers "what am I doing from 8:30 to 10:30." Routine is that surface: one
fixed daily routine, today's real commitments laid over it, what is now and next,
a nudge at block time, and — when an appointment eats routine time — a visible loss and
an offer to recover it. It is a standalone time-triggered surface (the 2026-07-28
lesson: never bolt time-of-day scheduling onto the cadence engine); it *reads*
prospects and never advances them.

## 2. Scope

**In:** the Routine tab (desktop clock timeline + phone step list, one render path);
the palette; one starter routine + Blank; per-day done-state; per-agent timezone; the
minute scheduler (route + claim table + pg_cron, one bounded retry) for block, make-up,
and appointment reminders; the live layer — today's appointments from Prospects
(automatic + today-only manual attach), live follow-up names from agent-selected
stages, collision → split → owed → make-up offer → note → expiry → weekly count,
yesterday's miss; PWA manifest + install strip; a minimal service-worker change so a
push tap lands on the Routine tab; feature flag; tests in both lanes; a live pass with
hard gates.

**Out (v1), reasons in §14:** multiple/per-weekday routines; per-block weekday chips;
side-by-side overlap rendering; Duplicate; mobile Move up/down; day-bounds settings;
template append; a Profile install strip; streaks or completion percentages; email
fallback; cross-tab live sync; inactivity pause; daily push cap; **auto-checking
anything from prospect activity**; live names in the dial block; a Call button or phone
number on any block; owed time rolling to the next day; an "unconfirmed" appointment
style; **any edit to `src/app/api/reminders/route.js`**.

## 3. Architecture in one paragraph

The client stores three per-user documents in `user_kv` (the routine, per-day records,
settings) and reads two existing ones (`prospects_v1`, `prospect_settings_v1`). One pure
`composeDay()` lays today's appointments over the routine, splits any block an
appointment overlaps, and yields the timeline items, the unrecovered (owed) minutes per
block, and the make-up offer; the same function runs in the browser (every 30 s) and in
the minute tick (per agent), so the two can never disagree. The tick claims due
reminders atomically in `routine_push_log` and sends one name-free push per item.
Per-day records (done, held, attach, owed, make-up, ack) stop applying at local
midnight; the weekly view is derived from the last seven of them. iPhone agents receive
push once PRIM is installed to the Home Screen; v1 ships the manifest.

## 4. Data model & storage

All keys are JSON documents in the `user_kv` `jsonb` column (client adapter speaks
strings; cloud rows hold parsed JSON; legacy rows may be strings, §6b.1). New keys are
registered in `APP_KEYS`; the two arrays are in `MERGEABLE_KEYS` (newest-wins per id,
`mergeStore.mjs`). Merge-on-save resurrects records deleted by another open session
(`mergeStore.mjs:34-36`; `ViewMount` keeps the view mounted), so **nothing in these
arrays is hard-deleted — every record kind carries `deletedAt` and is retained through
every save.** Key literals in `src/lib/routineKeys.mjs` (no imports), including
`PROSPECTS_KEY = 'prospects_v1'` and `PROSPECT_SETTINGS_KEY = 'prospect_settings_v1'`
(duplicated from the `const` at `LeadTracker.jsx:149`, with a comment).

### 4a. `routine_blocks_v1` — the routine (array). **Day-less and permanent.**

```json
{ "id": "blk_k3f9x2q", "name": "Dial block", "paletteId": "dial", "category": "dial",
  "startMin": 510, "durationMin": 120,
  "remind": { "enabled": true, "minutesBefore": 5 },
  "note": "", "deletedAt": null, "createdAt": "…", "updatedAt": "…" }
```
Ids from `routineModel.uid()` (`'blk_' + 7 base36`; not `utils.uid()`). Minutes after
local midnight, snapped to 5; duration 10–720; `startMin + durationMin ≤ 1440`; ≤ 60
live. **No prospect reference ever lives here** — attaching a prospect is a per-day
record (§4b) so the routine stays the same every day. `sanitizeBlocks` (retains
tombstones, prunes > 7 days, dedupes, clamps, whitelists `category` ∈ `dial, followup,
text, appt, review, admin, learn, break, custom`, sorts, `resolveOverlaps` on the live
subset) and `liveBlocks` as rev 4; `resolveOverlaps` tie-break/shrink/tombstone rules
as rev 4. **Two live blocks never overlap; appointments never modify the routine** —
splitting is a render-time projection (§7h.3).

### 4b. `routine_day_v1` — per-LOCAL-day records (array, mergeable, 7-day retention)

| kind | id | fields | meaning |
|---|---|---|---|
| `done` | `day\|blockId` | `blockId, status: done\|skipped\|cleared, at` | a routine or make-up block's checkbox / Skip today |
| `held` | `day\|appt\|prospectId` | `prospectId, at` | an appointment's checkbox ("Held"), derived or attached |
| `attach` | `day\|attach\|blockId` | `blockId, prospectId` | **today-only** binding of an `appt` placeholder block to a prospect |
| `owed` | `day\|owed` | `minutes, byBlock:{blockId:min}, status: open\|accepted\|skipped, decidedAt, makeupIds:[]` | one record per day: **unrecovered** displaced minutes (§7h.3) |
| `makeup` | `mk_<7 base36>` | `day, startMin, durationMin, category, name, ofBlockId` | a today-only block created by accepting the offer |
| `ack` | `day\|ack` | — | yesterday's-miss line dismissed today |

Every record also carries `day`, `updatedAt`, `deletedAt`. Ids never contain `|`
except as the documented separators (`mk_` ids have none, so they can be `fire_key`
components). `sanitizeDay` validates kinds, prunes `day < addDays(today, −7)`, and drops
tombstones older than 7 days. `done`/`held`/`attach`/`owed` writes are immediate. At
midnight nothing runs: a record whose `day` is no longer today is simply not today's —
an `owed` with `status ≠ accepted` and `minutes > 0` on a past day **is** an expired,
counted record (§7h.5).

### 4c. `routine_settings_v1` — object, last-write-wins

```json
{ "version": 1, "timezone": "America/Chicago", "timezoneMode": "auto",
  "remindersEnabled": true, "defaultMinutesBefore": 5,
  "activeDays": [0,1,2,3,4,5,6],
  "followupStages": ["MISSED_APPT","FOLLOWUP_LATER","PENDING_DECISION"],
  "followupStagesSeeded": false, "lastReplacedBackup": null }
```
`activeDays`: ints 0–6, **0 = Sunday** (`Date#getDay`; `localWeekday()` matches; chip
labels share the constant). **`followupStages`**: ids chosen from the agent's stage list
= **`(prospectSettings || defaultProspectSettings()).stages`** — the same fallback
`ProspectsView.jsx:1436` uses, because `prospectSettings` is `null` for any agent who
never saved one. **Seeding** runs once, after RoutineView's `loaded` guard (LeadTracker
finishes the settings read before any view mounts, so `null` means "no saved row"):
`seedFollowupStages(stages)` = the three defaults + every stage whose label matches
`/express|interest|re-?engage/i` **and not** `/\b(won|sold|closed|lost|dead)\b/i`
(ASSUMPTION — honors "plus custom stages like *Expressed Interest* / *Try to
Reengage*" without seeding a closed-won stage into a call list; the checklist in
Settings is one tap to correct). Unknown ids are kept, ignored at read. `sanitizeSettings`
as rev 4 plus `followupStages` → unique strings.

### 4d. `routine_push_log` — Postgres table (server-only)

```sql
create table public.routine_push_log (
  user_id uuid not null, fire_key text not null, block_id text not null,
  local_day date not null, fire_at_utc timestamptz not null,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  attempts int not null default 1 check (attempts between 1 and 2),
  sent_at timestamptz, error text,
  created_at timestamptz not null default now(),
  primary key (user_id, fire_key));
create index routine_push_log_created_idx on public.routine_push_log (created_at);
alter table public.routine_push_log enable row level security;  -- no policies: service role only
```
`block_id` is a block id, a make-up id, or `appt:<prospectId>`. A table, not a
`user_kv` key (`migrateLocalToCloud` would overwrite a mirrored ledger).

### 4e. Prospects — read-only inputs

`prospects_v1` is an **array** of records (`id, name, stage, appointmentTime,
archivedAt, lastContact 'YYYY-MM-DD', createdAt, cadence`); `prospect_settings_v1` is
`{ stages:[{id,label,color}], customFields }` or absent. **`appointmentTime` is a
zone-less datetime-local string `YYYY-MM-DDTHH:mm`** — every writer normalizes to
that shape (`datetimeField.mjs:69-76`, `ProspectForm.jsx:106-111`,
`LeadTracker.jsx:98-102`, `DateTimePicker.jsx:8-10`); an import may carry a zoned ISO.
It is interpreted as **wall-clock in `routine_settings_v1.timezone`** (ASSUMPTION: the
agent books in their own zone). **Nothing in Routine writes to either key.** Both are
already held by `LeadTracker` and passed to `ProspectsView` as `prospects` and
`settings`; RoutineView receives them the same way (§9).

## 5. Timezone

As rev 4 (settings zone, chip, auto/manual, `tz.mjs`). **`zonedTimeToUtc(day, minute,
tz)` algorithm, stated:** `guess = Date.UTC(day, minute)`; `off1 = offsetMinutesAt(guess)`;
`utc1 = guess − off1·60k`; if `offsetMinutesAt(utc1) === off1` → `utc1`; else `off2 =
offsetMinutesAt(utc1)`, `utc2 = guess − off2·60k`; if `offsetMinutesAt(utc2) === off2` →
`utc2` (fall-back first occurrence and the post-transition hour); else (spring gap) →
`utc1` (forward). Pinned: 02:30 NY 2026-03-08 → 07:30Z; 03:00 → 07:00Z; 01:30 NY
2026-11-01 → 05:30Z; 02:00 → 07:00Z. **Block starts and appointment wall-clocks both go
through `zonedTimeToUtc`; every reminder and end is an instant offset from its start.**

**`parseAppointmentTime(value, tz)`** (pure, `routineLive.mjs`) → `{ day, minute,
instant }` or `null`: normalize `' '`→`'T'`; if it matches
`/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/` (no `Z`/offset) → `day` =
the captured date **string**, `minute = hh·60+mm`, `instant = zonedTimeToUtc(day,
minute, tz)`; if it carries `Z` or `±hh:mm` → `instant = Date.parse`, `day =
localDayKey(instant, tz)`, `minute = localMinuteOfDay(instant, tz)`; else `null`
(excluded). **No code path calls bare `Date.parse` on `appointmentTime`** (tripwire).
Invalid/missing zone → reminders skipped, chip says so; the zone is in every `fire_key`.

## 6. Scheduler

### 6a. Trigger
`pg_cron` + `pg_net` every minute by operator decision; `vercel.json` keeps only the
daily reminders cron (tripwire). `supabase/routine-tick-cron.sql`, verbatim (raises at
schedule time and at every run if the Vault secret is missing):
```sql
do $$ begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'prim_cron_secret')
  then raise exception 'prim_cron_secret missing from Vault'; end if; end $$;
select cron.schedule('prim-routine-tick', '* * * * *', $$
  do $x$ declare s text; begin
    select decrypted_secret into s from vault.decrypted_secrets where name = 'prim_cron_secret';
    if s is null then raise exception 'prim_cron_secret missing from Vault'; end if;
    perform net.http_get(url := 'https://app.primtracker.com/api/routine/tick',
      headers := jsonb_build_object('Authorization', 'Bearer ' || s),
      timeout_milliseconds := 30000);
  end $x$; $$);
```

### 6b. Route: `src/app/api/routine/tick/route.js`
`runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`; auth from
`reminders/route.js:245-249`. Pure core `routineTick.mjs`, clock injected. Constants:
`LOOKAHEAD_SEC=45`, `GRACE_MIN=10`, `COOLDOWN_MIN=15`, `STALE_CLAIM_MIN=2`,
`LOG_WINDOW_MIN=60`, `APPT_LEAD_MIN=5`, `APPT_DEFAULT_MIN=30`.

0. VAPID unset → `200 { skipped:'push_not_configured' }`.
1. **Load in two phases.** Phase A: `routine_settings_v1`, `push_subscriptions_v1`,
   and `profiles` (8-column select from `email/send/route.js:146`) for all users; apply
   the step-2 skips → `eligible` ids (counted `eligible_users`). Phase B, **only for
   `eligible`, `.in('user_id', chunk)` in chunks of 100**: `routine_blocks_v1`,
   `routine_day_v1`, `prospects_v1`; plus `routine_push_log` (≤ 60 min, indexed by
   user). Every read checks `error`; a failed log read aborts 500 and sends nothing.
   Values arrive parsed; legacy strings via `try { JSON.parse } catch { null }`; bad
   shapes → empty, `bad_shape`, never abort. Blocks/day/settings sanitized. A disabled
   agent's prospects are never queried (test-pinned).
2. **Skips, in order, first match, counted once:** `not_entitled`
   (`canAccessBetaFeature(...).canAccess !== true`), `disabled`, `bad_tz`, `no_subs`
   (without claiming).
3. **Candidates — today only.** The tick calls **the same `composeDay()`** as the
   client (`live = liveBlocks` if today's weekday ∈ `activeDays`, else `[]`;
   `appointments = todaysAppointments(...)`; today's `makeup`/`attach`/`done` records;
   `nowMin`) and derives candidates from its items:
   - **Routine blocks** with `remind.enabled`: from the block's **first surviving
     segment** — `segStartMin` (= `startMin` when unsplit), `startAt =
     zonedTimeToUtc(today, segStartMin, tz)`, `endAt` = that segment's end instant,
     `fireMin = max(0, segStartMin − minutesBefore)`, `fireAt = max(startAt −
     minutesBefore·60k, zonedTimeToUtc(today, 0, tz))`, `fire_key =
     ${blockId}|${today}|${fireMin}|${tz}`. Zero surviving segments → no candidate.
     A block whose today `done` record is `done|skipped` → skipped, `already_done`.
   - **Make-ups** (today's, not tombstoned): `block_id = mk id`, `remind = { enabled:true,
     minutesBefore: settings.defaultMinutesBefore }`, same math on their first
     surviving segment; copy uses the make-up's `name`.
   - **Appointments** (derived and attached alike, from `todaysAppointments`): `startAt`
     = the item's instant, `endAt = startAt + durationMin` (derived: 30; attached: the
     block's duration), `fireAt = startAt − 5 min`, `block_id = appt:${prospectId}`,
     `fire_key = appt|${prospectId}|${today}|${fireMin}|${tz}`. Appointments ignore
     `activeDays` and per-block `remind`; `remindersEnabled=false` silences them with
     everything else. **An attached placeholder block yields no routine candidate.**
   **Due iff `fireAt ≤ now + 45 s` AND `now < startAt + 10 min` AND `now < endAt`.**
   Aged-out reminders never fire, never stamp. **Cooldown on fire instants**: skip iff a
   row for the same `(user_id, block_id)` with a different `fire_key`, status
   `claimed|sent`, and `|candidate.fireAt − row.fire_at_utc| ≤ 15 min`.
4. **Claim before send** — `upsert(rows, { onConflict:'user_id,fire_key',
   ignoreDuplicates:true }).select('fire_key')` [LIKELY RETURNING-only-inserted; live-
   gated]. Overlapping ticks split the set; moves, segment shifts, and zone changes
   re-arm; ≤ 15-min nudges are absorbed.
5. **Send — one push per item, never coalesced.** Routine/make-up copy: `N =
   round(|startAt − now|/60k)`; "Dial block starts now" / "starts in N min" / "started
   N min ago"; body = the segment's range, then **"then <next routine or make-up name>
   at hh:mm" — or "then an appointment at hh:mm" when the next composed item is an
   appointment**; `tag:'routine-'+block_id`. **Appointment copy is fixed and name-free:
   title "PRIM", body "Appointment in 5 min" / "starts now" / "started N min ago", `tag
   'appt-'+prospectId`.** No push ever contains a prospect's name or stage (tripwire
   over the whole `routineTick.mjs` payload path). `url: appUrl()+'/?view=routine'`.
   `pushServer.js` derived from `reminders/route.js:26-55, 379-386` (untouched), returning
   `{ sentCount, dead, failures }`; `pruneDeadSubs` re-selects and checks `error`.
6. **Stamp** as rev 4 (`sent`; retryable → `failed` attempts 1; `all_subs_dead` →
   attempts 1; non-retryable 4xx → attempts 2). One CAS retry for `failed`/stale-`claimed`.
7. Housekeeping at minute 7; response counts everything incl. `eligible_users`,
   `appts_due`, `appts_sent`, `already_done`.

### 6c. Failure modes, on record
Rev 4 cases hold. New: appointment wall-clock `2026-09-08T10:00` for a Chicago agent →
`startAt` 15:00Z, `fireAt` 14:55Z, day `2026-09-08` **regardless of the server's
`TZ`** (test runs under `TZ=UTC` and `TZ=America/Chicago`); `T23:30` is today at minute
1410 in every zone; a zoned import `…T23:30-05:00` is the next day for a New York agent.
Appointment moved 10:00→10:10 at 9:57 → new key, |9:55−10:05| = 10 → absorbed;
→14:00 → re-arms. Prospect leaves the three appointment stages → gone from timeline
and tick together (both use `todaysAppointments`); returns → re-arms if its minute is
ahead. Head eaten (8:30–9:00 appointment in the 8:30 Dial) → `segStartMin` 540,
reminder 8:55 for the surviving 9:00 start, key stable across ticks. Whole block eaten
→ no candidate. Make-up hit by a later appointment → re-split like any block; its
minutes reduce `recovered` (§7h.3), the offer re-opens. Attached prospect who also has
an auto appointment today → **one** item, the attached block's geometry wins. A done or
skipped block never pushes. A prospect still carrying a time but in Pending Decision
shows in the Prospects tab and the daily email but not on the timeline — recorded in
§13; the follow-up sheet's secondary line says why ("Pending Decision · appt 10:00").

## 7. UI

### 7a. View & header
`RoutineView.jsx` — props `{ showToast, prospects, prospectSettings, onOpenProspect }`.
Owns the three documents, `loaded`, the 30 s clock (paused when hidden), saves
(discrete commits immediate; editor text 400 ms debounce, flushed on close), timezone
capture, entitlement (§9), `devicePushOn` (async), one render path via
`useMediaQuery('(min-width: 768px)')`, and **`composeDay()`** recomputed on the clock
and on any change to blocks, day records, or prospects (memoized on those + the
minute). `RoutineHeader`: title, timezone chip, Bell = `settings.remindersEnabled`,
settings gear → sheet (timezone, default lead, active-day chips, **follow-up stages
checklist** from the resolved stage list, "Start over from a template"). The strip, not
the Bell, reflects device status.

### 7b. NOW card — `NowCard.jsx`
Sticky premium-card; tile left (gradient for `appt`), action right, 2 px progress bar.
`nowState(items, dayRecords, nowMin)` → `{ phase: upFirst|now|free|dayDone, behind:
item|null }` over composed items; **`behind`** = the oldest past routine or make-up item
with no `done|skipped` record (**appointments never set `behind`**). Phases as rev 4;
the current item may be an appointment ("NOW · 10:00–10:30 / Maria Delgado / 12 min
left · then Break at 10:30", checkbox labeled **Held**). **One 11 px meta line**, first
match: (1) **offer** — "30m of dial time displaced." + text button "Add 2:00–2:30" +
" · " + "Skip"; (2) **still open** — "Dial block · still open" (slate-500; tap scrolls
to it); (3) **note** — "30m owed" (slate-400, static); (4) **yesterday** — "Yesterday ·
30m dialing not made up" (slate-400) with a 12 px × (20 px hit; 44 on phone). No
rendered string anywhere contains "behind", "missed", or "streak" (tripwire). Minutes ≥
60 render "1h 25m". Then the reminder strip cases as rev 4. **`dayDone`** = `behind ===
null` **and not** (`owed.status === 'open'` with a slot available).

### 7c. Timeline (desktop)
Geometry, tints (inline hex; `.dark` remaps only four hues), `role="button"` blocks,
`usePointerDrag`, keyboard, slide-to-gap, palette click/drag, click-empty-to-add (spec
addition), single-delete undo, `sanitizeBlocks` on every commit — all as rev 4. Type
scale 10/11/12/14 px. **Dragging:** appointments and non-first segments are not
draggable; **the first segment is the routine block's drag handle** (moving it moves the
whole block, then re-composes). **Density tiers are per underlying block**: `full` if
any segment is the current or next item, `compact` for other future blocks,
`spent` for past. Names (§7h.2) render in `full` only.

### 7d. Palette — as rev 4 (`defaultMin`, `defaultRemind`, `appt #8b5cf6`).
### 7e. Templates — as rev 5 (one starter "Agent day" + Blank; `applyTemplate` as rev 4).

### 7f. Editor & mobile
`BlockEditorSheet.jsx` (desktop popover; phone `GlassModal` from
`MotionPrimitives.jsx:358`, `sheet`): name ≤ 60, palette, start, duration, lead, note
with the tray hint; **for an `appt` placeholder: "Attach prospect (today)"** — a native
`<select>` listing today's un-attached prospects in the three appointment stages
first, then the rest alphabetically, "— none —" first; choosing writes an `attach`
record (§4b) — **it never writes `prospectId` or the prospect's name into the block**.
**For a make-up block:** "Remove make-up" (tombstones it; no Skip today). Phone list:
shared NowCard; rows as rev 4; **follow-up row** = title + "14 due" in the time column —
tapping the count opens the sheet, tapping the title opens the editor; **appointment
row** = the white-surface treatment (§7h.1) with the Held checkbox; long-press → Skip
today / Delete (routine) or Remove (make-up).

### 7g. Done-state
`blockVisualState` as rev 4. **Any item rendered as an appointment (derived or
attached) writes `held` (`day|appt|prospectId`); an un-attached `appt` placeholder
writes `done`; segments of one block share its `done` record; a make-up writes `done`
under its `mk_` id.**

### 7h. The live layer — restraint design + two grafts

**7h.1 Appointments.** `todaysAppointments({ prospects, blocks, attaches, tz, now })`
(pure): (i) derived — prospects with `!archivedAt`, `stage ∈ {WEBBY_SET,
WEBBY_CONFIRMED, APPOINTMENT_SET}`, `parseAppointmentTime(appointmentTime, tz).day ===
localDayKey(now, tz)` → `{ prospectId, name, startMin: minute, durationMin: 30,
instant, source:'derived' }`; (ii) attached — for each live, non-tombstoned `attach`
record today whose `blockId` is a live `appt` block: `{ prospectId, name (resolved
from `prospects` at render; fallback the block's own name if the prospect is gone),
startMin/durationMin from the block, instant = zonedTimeToUtc(today, block.startMin,
tz), source:'attached' }`. **A prospect with an attach record is excluded from (i)** —
the attached block's geometry is authoritative — and **the placeholder block itself is
not rendered as a routine block.** Appointments ignore `activeDays`. **Rendering
(figure/ground inversion):** the appointment is **the only white surface on the
timeline** — `bg-white` (`.dark` remaps it), **`border-slate-200 dark:border-slate-700`**
(a bare utility, so the remap applies — never an opacity variant), 4 px `#8b5cf6` left
stripe (routine stripes are 3 px), inset 10 px from the lane's right edge. **Nothing else
distinguishes it**: no icon, no label, no avatar, no stage chip, no bell, **no
"unconfirmed" variant** (dropped — restraint). Row 1: checkbox (18 px, violet when
checked, **Held**) + the prospect's name as title, 12 px/600. Row 2 (≥ 44 px): "10:00–
10:30" 11 px slate-500. Nothing more at any height. Tapping the name →
`onOpenProspect(id)`. Names render in-app only.

**7h.2 Follow-up names.** `followupQueue(prospects, stageIds, tz, now)` (pure): `!archivedAt
&& stageIds.includes(stage)`, ordered **`lastContact` ascending, empty first**
(ASSUMPTION — "oldest first" for stage-selected prospects, most of which have no armed
cadence), then `createdAt`; age = `daysBetween(lastContact, localDayKey(now, tz))` →
"12d" / "new". In the follow-up block, **`full` tier only**: header = checkbox +
"Follow-up queue" + the bare count (12 px/600 **slate-400**, never amber); then `min(4,
floor((h − 58)/20))` name rows (12 px/500 slate-700, age right, no dividers, no stage
labels, no avatars, no per-name checkboxes); "+10 more" (11 px accent) on overflow;
under 78 px: header + "14 due · oldest 12d". Tapping names or "+N more" opens **`GlassModal
sheet`** — header "Follow-up queue · 14 due · by last contact" — with **`FollowupDueWidget`'s
row grammar** (`divide-y divide-slate-100`, name 14 px/600, secondary "Missed Appt ·
12d" — or "Pending Decision · appt 10:00" when the prospect still carries a time
today, §6c — `ArrowRight`); a row → `onOpenProspect(id)`. **No checkbox per name.**
`compact`/`spent` tiers show the count only.

**7h.3 Collision → split → owed → make-up.** `composeDay({ live, appointments, makeups,
dayRecords, nowMin })` (pure) → `{ items, displacedByBlock, recovered, unrecovered,
markers }`:
- **Union** overlapping appointment intervals (a routine minute is displaced at most
  once). Cut each routine block and make-up into surviving segments; **a segment under
  10 min is dropped and its minutes count as displaced**; `displacedByBlock[blockId] =
  overlap + dropped`, for **non-`break`** blocks. Segments share the block's id, fill,
  stripe, and `done` record; **checkbox/title/bell render on the first segment whose
  end > `nowMin`** (the last one once all are past); other segments show only their
  time range.
- **Recovery:** `recovered = Σ over live make-ups of (durationMin − that make-up's own
  displaced minutes)`; **make-up displaced minutes are not added to Σ displaced — they
  reduce `recovered`.** `unrecovered = Σ displacedByBlock (routine, non-break) −
  recovered`, floored at 0.
- **Loss markers:** one "−30m" per appointment interval per non-break routine block,
  amber text (`text-amber-600 dark:text-amber-400` — amber means routine time lost and
  nothing else), on the segment immediately preceding the interval (the following one
  if none), showing that interval's minutes for that block; omitted when that segment
  is under 40 px; **never on `break` blocks**; on phone the shortened row shows "−30m"
  in its time column. (g) two appointments in one block → two "−30m".
- **The `owed` record is upserted by RoutineView immediately, on every compose whose
  stored record differs:** `{ minutes: unrecovered, byBlock: displacedByBlock, status,
  makeupIds }`. A compose with `unrecovered = 0` writes `minutes: 0` (counts nothing,
  blocks nothing). `status` starts `open`; **whenever `unrecovered` rises above its
  value at `decidedAt`, `status` returns to `open`** (a new offer for the new total);
  Skip → `skipped` with `decidedAt`; Accept → `accepted` with `decidedAt` and the new
  make-up id appended. **Nothing about the slot is stored** — it is always
  `findMakeupSlot(items, live, unrecovered, nowMin)` at render.
- **`findMakeupSlot`:** gaps against all composed items **inside the routine's span
  `[max(nowMin, firstLive.startMin), lastLive.endMin]`** (operator: "no room that day" =
  inside the working day; the evening is not a slot). Pass 1 (afternoon preference):
  for each gap, `s = ceil5(max(gap.start, 720, nowMin))`, qualify iff `gap.end − s ≥
  unrecovered`, return the first. Pass 2: same with `s = ceil5(max(gap.start, nowMin))`.
  Else `null`. Pinned: gap 11:45–12:30, 30 owed, now 9:42 → 12:00–12:30; routine ends
  17:30, now 17:00, 45 owed → `null`.
- **Offer lifecycle** (meta line, §7b): `open` + slot → "Add hh:mm–hh:mm · Skip". Accept
  → `makeup { startMin: slot, durationMin: unrecovered, category/name of the largest
  displaced block + " (make-up)", ofBlockId }`, rendered as a routine block with a
  **dashed 3 px stripe** (the only difference) that reminds like one; no toast. Skip →
  the static note "30m owed". `open` + no slot → the same note. Removing a make-up
  (§7f) tombstones it, `recovered` drops, `status` re-opens automatically.
- **Accountability:** `dayDone` blocked only while `status === 'open'` and a slot
  exists. Skipped or slotless time is the agent's call, on record.
- **Inactive day**: `live = []` — no splitting, no owed record; appointments still
  render and remind.

**7h.4 Yesterday's miss.** `yesterdayMiss(dayRecords, blocks, tz, now)` (pure) = yesterday's
`owed.minutes` where `status !== 'accepted'` (**expired, unrecovered displaced time
only** — ASSUMPTION per the operator's "the block they missed"; unchecked blocks are
never counted, so a new agent's first morning is quiet). Category from `byBlock`: all
`dial` → "dialing not made up"; all `followup` → "follow-up not made up"; mixed → "not
made up". Rendered once per day as the lowest-priority meta line; hidden when today
has an `ack` or any `done|skipped` record (derived, no extra write beyond the ×). Never
alters today, never pushes, never nags.

**7h.5 Weekly look-back.** As rev 5 (one collapsed line on the page background,
expanded = seven unlabeled bars, nothing else). `weeklyDisplaced(dayRecords, tz, now)` =
per local day of the last 7, the `owed.minutes` of records with `status !== 'accepted'`.

**What the design refuses to show:** any icon on appointments; stage names on the
timeline; a phone number or Call button; completion percentages; a colored badge for
owed time; a separate owed panel; per-collision lines; streaks; tooltips or numbers on
the weekly bars; confirmation toasts; a second meta line; prospect names or stages in
any push; **dividers or avatars in the in-block name list** (the sheet reuses
`FollowupDueWidget`'s grammar, dividers included).

## 8. iOS / PWA + one service-worker line
As rev 4 (`buildAppMetadata(role)`, `generateMetadata()` on `x-prim-role`, manifest and
icons, install strip in the NowCard) **plus one change to `public/sw.js`
`notificationclick`**: when an existing PRIM window is found, `if ('navigate' in client
&& url && new URL(client.url).search !== new URL(url).search) return client.focus()
.then(c => c && c.navigate(url)); client.focus();` — otherwise a push tap with PRIM
already open (the normal desktop and installed-PWA case) lands on whatever tab was
active. `install` already `skipWaiting`s; the tripwire still asserts the payload fields.

## 9. Navigation, gating, rollout
`NAV_TABS` + `ICONS` (`CalendarClock`) after Overview; flag `routine_builder {
requiredTier:'starter', publicGA:true }`; non-entitled → `AgentSettingsPanel.jsx:343-361`
locked card, zero writes; `[announce]` on merge. **Props and the prospect opener
(new plumbing):** `LeadTracker` adds `const [pendingProspectId, setPendingProspectId]
= useState(null)` and `openProspect = useCallback((id) => { setPendingProspectId(id);
setView('prospects'); }, [])`; **`ProspectsView` gains props `openProspectId` +
`onOpenConsumed`** and, in an effect, `onView(prospects.find(p => p.id ===
openProspectId))` then `onOpenConsumed()` (unknown/archived ids ignored). Mount:
`<RoutineView showToast={showToast} prospects={prospects}
prospectSettings={prospectSettings} onOpenProspect={openProspect} />` — the same
`prospects`/`settings` `ProspectsView` receives. **`?view=` deep link** (new): on
mount, `setView` only for ids in the user's filtered tab list.

## 10. Pure modules (node lane)
`routineKeys.mjs` · `tz.mjs` · `routineModel.mjs` (`uid`, `sanitizeBlocks`, `liveBlocks`,
`resolveOverlaps`, `sanitizeDay`, `sanitizeSettings`, `seedFollowupStages`,
`applyTemplate`, `instantiateTemplate`, `DEFAULT_SETTINGS`) · **`routineLive.mjs`**
(`parseAppointmentTime`, `todaysAppointments`, `followupQueue`, `composeDay`,
`findMakeupSlot`, `yesterdayMiss`, `weeklyDisplaced`) · `routinePalette.mjs` ·
`routineTemplates.mjs` · `routineLayout.mjs` · `routineClock.mjs` (`nowState`,
`blockVisualState`, `formatTime`, `formatMinutes`) · `routineTick.mjs` ·
`appMetadata.mjs`. Client: `routineStore.js`, `usePointerDrag.js`, `useMediaQuery.js`.
Server: `pushServer.js`.

## 11. Operator config — unchanged from rev 4 (steps 0–5).

## 12. Testing

- **Node lane** — rev 4's suites, plus **`routineLive.test.mjs`**:
  `parseAppointmentTime` — `'2026-09-08T10:00'` for Chicago → 15:00Z, day
  `2026-09-08`; **the suite runs under both `TZ=UTC` and `TZ=America/Chicago` and asserts
  identical instants**; `'T23:30'` is today at 1410 in every zone; a zoned `…-05:00`
  import is tomorrow in New York; `'garbage'` → null. `todaysAppointments` — stage
  filter (Pending Decision with a time excluded; SOLD excluded), attach suppresses the
  derived item and wins on geometry, placeholder not rendered as routine, prospect gone
  → fallback name. `followupQueue` — custom id, empty-`lastContact` first, tiebreak,
  archived excluded, age with tz, 60 prospects. `composeDay` — tail/head/mid/whole,
  9-min remnant dropped and counted, breaks never owed, unioned overlaps counted once,
  two appointments → two markers and one sum, make-up re-split reduces `recovered` and
  re-opens the offer, title/checkbox on the first segment whose end > now. `findMakeupSlot`
  — the two pinned cases, afternoon over morning, never before now, respects make-ups,
  null outside the routine span. `yesterdayMiss` — expired owed only; unchecked blocks
  never counted; Dial 120 with 30 displaced → 30 not 150; `ack` and any done/skipped
  hide it; category variants. `weeklyDisplaced` — accepted excluded, 7-day window,
  DST week. `seedFollowupStages` — seeds "Expressed Interest/ Aiming APPT" and "Try to
  Reengage/Get interest back", **not** "Re-engaged (won)", with `prospectSettings=null`
  the three defaults; flag flips once. `routineTick.test.mjs` adds: appointment
  candidate at T−5 with the wall-clock instant, aged at T+11, `activeDays` ignored for
  appointments, head-eaten block fires at 8:55 for the 9:00 segment with a stable key,
  whole-eaten → no candidate, `already_done` skip, make-up fires from `routine_day_v1`,
  attached prospect → exactly one `appt:` candidate with name-free copy, **"then an
  appointment at 10:00" when the next item is an appointment** (no fixture name in any
  payload), disabled agent's prospects never queried (mocked `.in()` ids).
- **UI lane** — rev 4's plus: appointment card has no `<svg>`, no bell, and
  `border-slate-200` (no opacity variant); follow-up block ≤ 4 names in `full`, none in
  `compact`, count slate; "+N more" → sheet with `FollowupDueWidget` classes; sheet row
  → `onOpenProspect(id)` and `LeadTracker` lands on Prospects with that detail open;
  NowCard exactly one meta line per state; Accept writes one `makeup` and no toast;
  Skip → note; × → `ack`; at 9:42 with a 9:00–9:30 appointment the 9:30 segment shows
  title + checkbox; removing a make-up re-opens the offer; **`RoutineView` never writes
  `prospects_v1`, `prospect_settings_v1`, or `prospectId` into `routine_blocks_v1`**.
- **Tripwires** — rev 4's plus: no bare `Date.parse(` on `appointmentTime` in
  `routineLive.mjs`/`routineTick.mjs`; no `.name` of a prospect-derived item in any
  payload builder; `NowCard`/`Timeline` render no "behind"/"missed"/"streak".
- **Mutation checks** — rev 4's plus: parse with `Date.parse` → the `TZ` test red;
  drop the stage filter → red; sort `lastContact` desc → red; count breaks → red;
  remove the 720 floor → afternoon test red; remove the span bound → null test red;
  add make-up displaced to Σ → re-open test red; count unchecked blocks in
  `yesterdayMiss` → 120-vs-30 test red; include `accepted` in weekly → red; put
  `p.name` in any payload → red; write `prospectId` on a block → red.
- **Live pass** — rev 4's gates 0–6, plus: (7) a real prospect at 10:00 today appears
  white with no icon, at the right local time; (8) the overlapped block shows segments
  and "−30m", the NOW card offers an afternoon slot, Accept places a dashed make-up that
  then reminds; (9) the appointment push arrives name-free at 9:55 local; (10)
  **tapping that push with PRIM already open lands on the Routine tab**; (11) the
  follow-up block lists the agent's stage selection oldest-first and a row opens the
  prospect; (12) next morning the yesterday line shows the expired minutes once and
  retires on the first check; (13) the weekly line shows them.

## 13. Risks on record
Rev 4's 1–9, plus: **10.** appointment duration is assumed 30 min for derived items —
attach exists for longer ones; **11.** two "oldest first" orderings exist (queue by
last contact; `FollowupDueWidget` by cadence) — the sheet header says "by last
contact"; **12.** prospect names on a screen agents may share — the existing PHI
banner applies; **13.** the seeding keyword rule can still mis-select an unusual
label — visible in Settings, one tap; **14.** `composeDay`/`followupQueue` run every
30 s on up to a few hundred prospects — O(n), memoized, measured in the live pass;
**15.** the Prospects tab and the daily email list stage-less appointments that the
timeline hides — accepted, explained in the sheet; **16.** `appointmentTime` is
interpreted in the routine zone — an agent who books in another zone's wall-clock gets
a wrong instant; the chip and manual mode are the recourse.

## 14. Deferred (with the reason)
As rev 5, plus: an "unconfirmed" appointment style (restraint); per-appointment
duration on prospects (fixes risk 10 at the source); a proper open-by-id route for
prospects (v1 uses the pending-id prop hand-off).
