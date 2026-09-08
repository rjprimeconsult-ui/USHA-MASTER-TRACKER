# Routine Builder — design

**Date:** 2026-09-07 · **Rev 8 (2026-09-08)** — self-contained: every rule is stated here
(prior revisions are history only: rev 4 `f3c5de6`, rev 5 `19a205e`, rev 6 `876d06b`, rev 7
`1d0f340`; on any conflict this document wins). Rev 5 added the live layer; its three
review rounds (4 lenses each) found 3 + 3 + 4 blockers, ~16 + 12 + 23 majors, ~11 + 32 + 19
minors — all folded in. Rev 8 replaces rev 7's server write path (an atomic SQL function
instead of a row upsert), keys frozen appointments by start time, and makes the make-up
offer a derived value that never mutates the agent's decision. · **Operator decisions
(Juan):** blocks ARE wired to live Prospects data, read-only (2026-09-08) · one routine,
the same every day · separate top-level tab (2026-09-08) + one PRIM starter + Blank ·
web-push at block time (agent-set lead, default 5 min — accepted deviation from "at block
time") and 5 min before appointments · palette (C) on a clock timeline (A) with checkboxes
(B); phone = step list · Supabase pg_cron every minute · PWA manifest + iPhone install
strip in v1 · all paid tiers day one · every day active by default · appointments
automatic + manual attach · follow-up stages agent-configurable · collision → split → owed
→ afternoon-preferred make-up → note → expires at midnight → counted; the agent decides ·
UI clean and professional · one build. · **Provenance:** 12-agent design workflow, three
3-lens reviews (rev 1–4), a 6-agent UI design/critique pass, three 4-lens reviews (rev 5–7).

## 1. Problem

Agents — especially new ones — have no structure inside PRIM for *how* to run a day.
The cadence engine (`src/lib/followupEngine.mjs`) answers "who do I chase next";
nothing answers "what am I doing from 8:30 to 10:30." Routine is that surface: one
fixed daily routine, today's real commitments laid over it, what is now and next, a
nudge at block time, and — when an appointment eats routine time — a visible loss and
an offer to recover it. It is a standalone time-triggered surface (the 2026-07-28
lesson: never bolt time-of-day scheduling onto the cadence engine); it *reads*
prospects and never advances them.

## 2. Scope

**In:** the Routine tab (desktop clock timeline + phone step list, one render path);
the palette; one starter routine + Blank; per-day done-state; per-agent timezone; the
minute scheduler (route + claim table + pg_cron, one bounded retry) for block, make-up,
and appointment reminders; the live layer — today's appointments (automatic + today-
only manual attach, **frozen into the day once they start**), live follow-up names from
agent-selected stages, collision → split → owed → make-up → note → expiry → weekly
count, yesterday's miss; PWA manifest + install strip; a small service-worker change so
a push tap lands on the Routine tab; **two service-role SQL functions** — one so the tick
reads only appointment rows, one so it writes single day records atomically; feature
flag; tests in both lanes; a live pass with hard gates.

**Out (v1), reasons in §14:** multiple/per-weekday routines; per-block weekday chips;
side-by-side overlap rendering; Duplicate; mobile Move up/down; day-bounds settings;
template append; a Profile install strip; streaks or completion percentages; email
fallback; cross-tab live sync; inactivity pause; daily push cap; auto-checking anything
from prospect activity; live names in the dial block; a Call button or phone number on
any block; owed time rolling to the next day; an "unconfirmed" appointment style; **any
edit to `src/app/api/reminders/route.js`**.

## 3. Architecture in one paragraph

The client stores three per-user documents in `user_kv` (the routine, per-day records,
settings) and reads two existing ones (`prospects_v1`, `prospect_settings_v1`). One pure
`composeDay()` lays today's appointments over the routine, splits any block an
appointment overlaps, and yields the timeline items, per-block displaced minutes, the
unrecovered total, and the make-up offer; the same function runs in the browser (every
30 s) and in the minute tick (per agent), so the two never disagree. The tick claims due
reminders atomically in `routine_push_log`, sends one name-free push per item, and —
for every entitled agent with a valid zone, subscribed or not — freezes each
appointment that has started and the day's realized owed minutes into the per-day
array **through one atomic SQL function that appends by record id and never rewrites
the row**, so the count survives the agent moving the prospect on and survives a day
the agent never opened. Per-day records stop applying at local midnight; the weekly view
is derived from the last seven. iPhone agents receive push once PRIM is installed to
the Home Screen; v1 ships the manifest.

## 4. Data model & storage

All keys are JSON documents in the `user_kv` `jsonb` column (the client adapter speaks
strings; cloud rows hold parsed JSON; legacy rows may be strings — §6b.1). New keys are
registered in `APP_KEYS` (`src/lib/storage.js` — unregistered keys survive
`purgeLocalMirror` and leak across accounts); the two arrays are in `MERGEABLE_KEYS`
(newest-wins per `id` via `mergeStore.mjs`). Merge-on-save resurrects records deleted by
another open session (`mergeStore.mjs:34-36`; `ViewMount` keeps the view mounted), so
**every record carries `deletedAt` and nothing is hard-deleted** — a delete on one
device is not resurrected by another device's next save; the other device sees it on
refresh. Remote-only ids absent from the session baseline are kept on merge
(`mergeStore.mjs:63-66`) — this is what lets tick-appended records survive the client's
next save. Key literals live in `src/lib/routineKeys.mjs` (no imports), including
`PROSPECTS_KEY = 'prospects_v1'` and `PROSPECT_SETTINGS_KEY = 'prospect_settings_v1'`
(duplicated from the `const` at `LeadTracker.jsx:149`, with a comment).

### 4a. `routine_blocks_v1` — the routine (array). **Day-less and permanent.**

```json
{ "id": "blk_k3f9x2q", "name": "Dial block", "paletteId": "dial", "category": "dial",
  "startMin": 510, "durationMin": 120,
  "remind": { "enabled": true, "minutesBefore": 5 },
  "note": "", "deletedAt": null, "createdAt": "…", "updatedAt": "…" }
```
Ids from `routineModel.uid()` (`'blk_' + 7 base36`; **not** `utils.uid()`, a UUID).
Minutes after local midnight, snapped to 5; duration 10–720; `startMin + durationMin ≤
1440`; ≤ 60 live blocks; `updatedAt` on every mutation. **No prospect reference ever
lives here.** Delete = `deletedAt` + bump `updatedAt`; un-delete = `deletedAt: null` +
bump. **Deleting an `appt`-category block also tombstones every live `attach` record
whose `blockId` is that block, in the same commit; Undo restores both.** A frozen `appt`
record that came from the block stays (the meeting happened; §7f removes it).

**`sanitizeBlocks(blocks)` → the persistable array:** drops records without a string
id, dedupes by newest `updatedAt`, clamps/snaps, whitelists `category` ∈ `dial,
followup, text, appt, review, admin, learn, break, custom`, **retains tombstones** and
prunes those older than 7 days, sorts by `startMin`, then runs `resolveOverlaps` on the
live subset. **`liveBlocks(blocks)`** = sanitized minus tombstones — what the canvas,
NOW card, and tick use. **`resolveOverlaps(live)`**: the later-`updatedAt` block moves
to the next free gap at/after its start; equal stamps → the greater `id` moves; no gap
before 1440 → shrink to the largest free gap ≥ 10 min; none → tombstone + toast "No
room for <name>"; > 60 live → newest-`createdAt` extras tombstoned. Two live blocks
never overlap; **appointments never modify the routine** — splitting is a render-time
projection (§7h.3).

### 4b. `routine_day_v1` — per-LOCAL-day records (array, mergeable, 7-day retention)

| kind | id | fields | meaning |
|---|---|---|---|
| `done` | `day\|blockId` | `blockId, status: done\|skipped\|cleared, at` | a routine or make-up block's checkbox / Skip today |
| `appt` | `day\|appt\|prospectId\|startMin` | `prospectId, startMin, durationMin, source: derived\|attached, heldAt: iso\|null` | **a frozen appointment** — one per (prospect, start); written when it starts; wins over live data for that start |
| `attach` | `day\|attach\|blockId` | `blockId, prospectId` | today-only binding of an `appt` placeholder block to a prospect |
| `owed` | `day\|owed` | `minutes, byBlock:{blockId:min}, status: open\|accepted\|skipped, decidedAt, decidedMinutes` | `minutes` = the day's **realized** unrecovered displaced minutes (§7h.3); the other fields = the agent's last decision |
| `makeup` | `mk_<7 base36>` | `day, startMin, durationMin, category, name, ofBlockId` | a today-only block created by accepting the offer |
| `ack` | `day\|ack` | — | yesterday's-miss line dismissed today |

Every record also carries `day`, `updatedAt`, `deletedAt`. Only `mk_` ids may be
`fire_key` components (no `|`). **`sanitizeDay`** validates kinds, prunes `day <
addDays(today, −7)`, drops tombstones older than 7 days, clamps `makeup.durationMin` to
[10, 720] snapped to 5. `done`/`appt`/`attach`/`owed` writes are immediate.

**Writers.** The client writes all kinds through its normal merge-on-save of the whole
array. **The tick never reads-then-writes the `routine_day_v1` row and never calls
`.upsert`/`.update` on `user_kv`**; it writes only `appt` (freeze) and `owed` (refresh)
records through **`routine_day_write(p_user uuid, p_records jsonb) returns text[]`**
(§6b.4): for each incoming record, **append if no element with that `id` exists
(a tombstoned element counts as existing); replace if one exists and its `updatedAt` is
strictly older than the incoming `updatedAt`; otherwise skip**; returns the ids written.
The tick stamps a frozen `appt` with `updatedAt` = the appointment's start instant (never
newer than any client write of that id, so a client Held or tombstone always wins) and a
refreshed `owed` with `updatedAt` = the instant it read the row in Phase B (so a decision
the agent saved after that read rejects the replace; the next tick retries with fresh
data). At midnight nothing runs: a record whose `day` is not today is simply not today's;
an `owed` on a past day with `minutes > 0` **is** an expired, counted record.

### 4c. `routine_settings_v1` — object, last-write-wins

```json
{ "version": 1, "timezone": null, "timezoneMode": "auto",
  "remindersEnabled": true, "defaultMinutesBefore": 5,
  "activeDays": [0,1,2,3,4,5,6],
  "appointmentStages": ["WEBBY_SET","WEBBY_CONFIRMED","APPOINTMENT_SET"],
  "followupStages": ["MISSED_APPT","FOLLOWUP_LATER","PENDING_DECISION"],
  "followupStagesSeeded": false, "lastReplacedBackup": null }
```
**`DEFAULT_SETTINGS.timezone = null`**; a missing row sanitizes to that, and a null or
invalid zone is `bad_tz` everywhere (the agent must open Routine once — appointment
reminders and the freeze included). `activeDays`: ints 0–6, **0 = Sunday**
(`Date#getDay`; `localWeekday()` matches; chip labels share the constant); every day by
default; `[]` allowed ("All days off"). **`appointmentStages`** (stages are
agent-deletable — an agent who books into a custom "Appt Booked" stage would otherwise
get nothing): seeded to the three ids, a Settings checklist like the next one.
**`followupStages`**: chosen from the resolved stage list `(prospectSettings ||
defaultProspectSettings()).stages` (the `ProspectsView.jsx:1436` fallback —
`prospectSettings` is `null` for any agent who never saved one). **Seeding** runs once
after RoutineView's `loaded` guard: `seedFollowupStages(stages)` = the three defaults
**+ every stage id not in `DEFAULT_PROSPECT_STAGES` whose label does not match**
`/\b(won|sold|closed|lost|dead|not|no|never)\b|\b(un|dis)interest/i` (ASSUMPTION —
honors "plus custom stages"; excludes closed-won and "Not Interested"-type stages; the
checklist is one tap to correct). `sanitizeSettings`: `activeDays` → unique ints 0–6;
`defaultMinutesBefore` → nearest of {0, 5, 10, 15}; `timezoneMode` → `'auto'` unless
`'manual'`; `timezone` kept verbatim; stage lists → unique strings, unknown ids kept
and ignored at read; `remindersEnabled` → boolean; unknown fields dropped.
`lastReplacedBackup` backs the 10-second Replace undo. Canvas bounds derive from blocks.

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
`user_kv` key (`migrateLocalToCloud` at `storage.js:385-400` would overwrite a mirrored
ledger and re-arm sent reminders).

### 4e. Prospects — read-only inputs

`prospects_v1` is an **array** of records (`id, name, stage, appointmentTime,
archivedAt, lastContact 'YYYY-MM-DD', createdAt, cadence`); `prospect_settings_v1` is
`{ stages:[{id,label,color}], customFields }` or absent. **`appointmentTime` is a
zone-less datetime-local string `YYYY-MM-DDTHH:mm`** — every writer normalizes to it
(`datetimeField.mjs:69-76`, `ProspectForm.jsx:106-111`, `LeadTracker.jsx:98-102`,
`DateTimePicker.jsx:8-10`); a date-only import is normalized to `T00:00` on open; a
zoned ISO may arrive from an import. It is interpreted as **wall-clock in
`routine_settings_v1.timezone`** (ASSUMPTION: the agent books in their own zone).
**Nothing in Routine writes to either key.** Both are held by `LeadTracker` and passed
to `ProspectsView` as `prospects` and `settings`; RoutineView receives them the same
way (§9). **Server side, the tick never selects the blob** — it calls
`routine_appt_rows` (§6b.1).

## 5. Timezone

Source of truth: `routine_settings_v1.timezone` (IANA). Captured on first Routine open
from `Intl.DateTimeFormat().resolvedOptions().timeZone` (guarded `typeof window`),
shown as a header chip ("CT"); `auto` re-detects on each mount with a toast when it
changes; `manual` (Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii, "Use
device zone") is never overridden. `src/lib/tz.mjs` (pure): `isValidTimeZone`,
`offsetMinutesAt(instant)` (**returns local − UTC in minutes**; New York = −240 EDT,
−300 EST), `localDayKey`, `localWeekday` (0 = Sunday), `localMinuteOfDay`, `addDays`
(calendar arithmetic on the `YYYY-MM-DD` string), **`daysBetween(dayA, dayB)`**
(calendar-day difference of two `YYYY-MM-DD` strings, `dayB − dayA`), and
**`zonedTimeToUtc(day, minute, tz)`**: `guess = Date.UTC(day, minute)`; `off1 =
offsetMinutesAt(guess)`; `utc1 = guess − off1·60k`; if `offsetMinutesAt(utc1) === off1`
→ `utc1`; else `off2 = offsetMinutesAt(utc1)`, `utc2 = guess − off2·60k`; if
`offsetMinutesAt(utc2) === off2` → `utc2`; else (spring gap) → `utc1`. Pinned: 02:30 NY
2026-03-08 → 07:30Z; 03:00 → 07:00Z; 01:30 NY 2026-11-01 → 05:30Z; 02:00 → 07:00Z.
**Block starts and appointment wall-clocks both go through `zonedTimeToUtc`; every
reminder and end is an instant offset from its start. Frozen and attached appointment
items get `instant = zonedTimeToUtc(today, startMin, tz)`.**

**`parseAppointmentTime(value, tz)`** (pure, `routineLive.mjs`) → `{ day, minute,
instant }` or `null`: normalize `' '`→`'T'`; if it matches
`/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/` → `day` = the captured
date **string**, `minute = hh·60+mm`, `instant = zonedTimeToUtc(day, minute, tz)`; if it
carries `Z` or `±hh:mm` → `instant = Date.parse` (the **only** `Date.parse` in the
file), `day = localDayKey(instant, tz)`, `minute = localMinuteOfDay(instant, tz)`;
**date-only values and any wall-clock at `T00:00` are time-less → `null`** (excluded
from timeline and tick — they still show in Prospects, §13); anything else → `null`.
The zone is in every `fire_key`.

## 6. Scheduler

### 6a. Trigger
`pg_cron` + `pg_net` every minute by operator decision; `vercel.json` keeps only the
daily reminders cron (tripwire). `supabase/routine-tick-cron.sql`, verbatim:
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
`runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`; auth block copied from
`reminders/route.js:245-249` (401 when `CRON_SECRET` unset — fails closed). Pure core
`routineTick.mjs`, clock injected. Constants: `LOOKAHEAD_SEC=45`, `GRACE_MIN=10`,
`COOLDOWN_MIN=15`, `STALE_CLAIM_MIN=2`, `LOG_WINDOW_MIN=60`, `APPT_LEAD_MIN=5`,
`APPT_DEFAULT_MIN=30`.

0. VAPID unset → steps 5–7 are skipped and the response carries `skipped:
   'push_not_configured'`; steps 1–4 (load, eligibility, compose, freeze) still run —
   the freeze needs only the service role.
1. **Load in two phases.** Phase A: `routine_settings_v1`, `push_subscriptions_v1`, and
   `profiles` (the 8-column select string from `email/send/route.js:146` — `id, email,
   subscription_status, subscription_tier, trial_ends_at, is_complimentary, is_admin,
   past_due_since`); apply step 2 → `composeEligible` and `sendEligible`. Phase B,
   **only for `composeEligible`, `.in('user_id', chunk)` in chunks of 100**:
   `routine_blocks_v1`, `routine_day_v1` (record `readAt` per row), `routine_push_log`
   (≤ 60 min), and **appointment rows via `routine_appt_rows(p_user_ids uuid[],
   p_prefixes text[])`** — a `security definer` plpgsql function
   (`supabase/routine-appt-rows-function.sql`; `revoke execute on function … from
   public, anon, authenticated; grant execute on function … to service_role;` verbatim
   in the file) that, per listed user, reads that user's `routine_settings_v1` row for
   `appointmentStages` (`coalesce(…, '["WEBBY_SET","WEBBY_CONFIRMED","APPOINTMENT_SET"]')`,
   compared as text via `jsonb_array_elements_text`), normalizes the `prospects_v1`
   value (`jsonb_typeof = 'string'` → `(value #>> '{}')::jsonb`; a cast failure is
   caught per user with `exception when others`, raises a warning, and yields no rows
   for that user), skips non-arrays, and returns `(user_id, id, stage, appointmentTime,
   archivedAt)` for elements where `left(appointmentTime, 10) = any(p_prefixes)` (UTC
   yesterday/today/tomorrow — the tick then applies `parseAppointmentTime` per agent
   zone) **and** `stage` ∈ that user's `appointmentStages` **and** `archivedAt` is null
   or absent. **No attach/appt clause: frozen and attached items need no prospect row**
   (§7h.1). The blob itself is never transferred (100–500 KB per agent per minute
   otherwise). Every read checks `error`; a failed log read aborts 500. Values arrive
   parsed; legacy strings via `try { JSON.parse } catch { null }`; bad shapes → empty,
   `bad_shape`, never abort. Blocks/day/settings sanitized. A non-`composeEligible`
   agent's rows are never queried (test-pinned).
2. **Skips, in order, first match, counted once.** `composeEligible` = not
   `not_entitled` (`canAccessBetaFeature('routine_builder', profile).canAccess !== true`
   — the function returns an object, never a boolean; a missing profile is not
   entitled) and not `bad_tz` (missing row, null, or invalid zone). `sendEligible` =
   `composeEligible` and not `disabled` (`remindersEnabled === false`) and not
   `no_subs`. **`disabled` and `no_subs` are counted but the agent is still composed and
   frozen (steps 3–4); they skip only steps 5–7** — the freeze is accountability, not a
   reminder.
3. **Candidates — today only.** The tick calls **the same `todaysAppointments()` and
   `composeDay()`** as the client (`todaysAppointments` receives `liveBlocks(blocks)`
   regardless of `activeDays`; `composeDay` receives `live = liveBlocks` if today's
   weekday ∈ `activeDays`, else `[]`; the appointment rows + today's `appt`/`attach`
   records; today's `makeup`/`done` records; `nowMin`) and derives candidates from its
   items:
   - **Routine blocks** with `remind.enabled`, **excluding a placeholder that has a live
     `attach` today** (it reminds as its appointment): from the block's first surviving
     segment — `segStartMin` (= `startMin` when unsplit), `startAt = zonedTimeToUtc(today,
     segStartMin, tz)`, `endAt` = that segment's end instant, `fireMin = max(0,
     segStartMin − minutesBefore)`, `fireAt = max(startAt − minutesBefore·60k,
     zonedTimeToUtc(today, 0, tz))`, `fire_key = ${blockId}|${today}|${fireMin}|${tz}`.
     **An un-attached `appt`-category block is a candidate** and uses the fixed
     name-free copy of step 6. Zero surviving segments → no candidate. A `done` record
     `done|skipped` today → skipped, `already_done`.
   - **Make-ups** (today's, live): `block_id = mk id`, `remind = { enabled:true,
     minutesBefore: settings.defaultMinutesBefore }`, same math on their first surviving
     segment; copy uses the make-up's name.
   - **Appointments** (every item `todaysAppointments` yields — frozen, attached, or
     derived): `startAt` = the item's instant, `endAt = startAt + durationMin·60k`,
     `fireMin = max(0, startMin − 5)`, `fireAt = max(startAt − 5·60k, zonedTimeToUtc(today,
     0, tz))`, `block_id = appt:${prospectId}`, `fire_key =
     appt|${prospectId}|${today}|${fireMin}|${tz}`. Appointments ignore `activeDays` and
     per-block `remind`; `remindersEnabled=false` silences them with everything else. **A
     frozen item with `heldAt` → skipped, `already_held`** (un-Held re-arms it only
     while still inside grace).
   **Due iff `fireAt ≤ now + 45 s` AND `now < startAt + min(10, floor(segDurationMin/2))
   min` AND `now < endAt`.** Aged-out reminders never fire, never stamp. **Cooldown on fire
   instants**: skip iff a row for the same `(user_id, block_id)` with a different
   `fire_key`, status `claimed|sent`, and `|candidate.fireAt − row.fire_at_utc| ≤ 15 min`.
4. **Freeze (server side, every `composeEligible` agent, every tick):**
   - For each item of `todaysAppointments` with `instant ≤ now` and **no `appt` record
     with its id (live or tombstoned)** → an `appt` record `{ id: day|appt|prospectId|
     startMin, prospectId, startMin, durationMin, source, heldAt:null, updatedAt: <start
     instant ISO>, deletedAt:null }`.
   - `realized = composeDay({ …, appointments: items.filter(a => a.instant <= now) })`
     (started appointments only — time is lost once the meeting has happened); then
     `reconcileOwed(stored, realized)` (§7h.3) → the `owed` record to write or `null`,
     stamped `updatedAt = readAt`.
   - All of an agent's records go in **one `supa.rpc('routine_day_write', { p_user,
     p_records })`** call; `error` checked (`freeze_failed`, the agent's sends still
     proceed); `frozen` = the returned ids' count. A second tick with unchanged inputs
     makes no call. **`supabase/routine-day-write-function.sql`** (plpgsql, `security
     definer`, `set search_path = public`, same revoke/grant lines as §6b.1): normalizes
     the stored value (`string` → cast; non-array → `'[]'`), then one `insert … on
     conflict (user_id, key) do update` whose new value = stored elements with any
     replaced ids swapped for the incoming record + appended incoming records whose id
     is absent; a legacy/empty row is created. The row is never read by the tick.
5. **Claim before send (`sendEligible` only):** `supa.from('routine_push_log').upsert(rows,
   { onConflict:'user_id,fire_key', ignoreDuplicates:true }).select('fire_key')`.
   postgrest-js 2.110 sets `Prefer: resolution=ignore-duplicates`; PostgREST maps it to
   `INSERT … ON CONFLICT DO NOTHING RETURNING`, returning only the rows *this*
   invocation inserted [LIKELY — **hard-gated in the live pass**]. Overlapping ticks
   split the set; moves, segment shifts, and zone changes re-arm; ≤ 15-min nudges are
   absorbed.
6. **Send — one push per item, never coalesced.** Routine/make-up copy: `N =
   round(|startAt − now|/60k)`; "Dial block starts now" / "starts in N min" / "started N
   min ago"; body = the segment's range, then "then <next routine or make-up name> at
   hh:mm" — **or "then an appointment at hh:mm" when the next composed item is an
   appointment or an `appt`-category block**; `tag:'routine-'+block_id`. **Every
   `appt`-category block and every appointment uses the fixed name-free copy in every
   position: title "PRIM", body "Appointment in N min" / "Appointment starts now" /
   "Appointment started N min ago" (the same `N`; a derived appointment's lead is always
   5, a placeholder's is its own), `tag 'appt-'+prospectId` (or `'routine-'+blockId` for an
   un-attached placeholder).** No push ever contains a prospect's name, an `appt` block's
   name, or a stage. `url: appUrl()+'/?view=routine'`. `src/lib/pushServer.js` is
   **derived from `reminders/route.js:26-55` and `379-386`** (that route is not edited)
   and returns `{ sentCount, dead, failures:[{endpoint,statusCode,message}] }`;
   `pruneDeadSubs(supa, userId, dead)` **re-selects** the subscriptions row before
   writing, filters the 404/410 endpoints, upserts, and checks `error` (`prune_failed`).
7. **Stamp.** `sentCount ≥ 1` → `sent`. Retryable failures (no status, 5xx, 429, 408) and
   `all_subs_dead` → `failed`, `attempts` 1. Non-retryable 4xx other than 404/410 →
   `failed`, `attempts` 2, `error` = the code, never retried. **One CAS retry** for a
   `failed` row with `attempts=1`, or a `claimed` row older than 2 min (`stale_claimed`),
   still inside grace: `.update({status:'claimed', attempts:2}).eq('user_id').eq('fire_key')
   .eq('attempts',1)` + the status guard `.select()`; send only when exactly one row
   returns.
8. Housekeeping at minute 7 of each hour (delete log rows > 30 days). Response JSON
   counts every outcome: `compose_eligible, send_eligible, due, claimed, sent, failed,
   retried, stale_claimed, appts_due, appts_sent, frozen, freeze_failed, skipped:{
   not_entitled, disabled, bad_tz, no_subs, cooldown, already_done, already_held,
   bad_shape, prune_failed}`.

### 6c. Failure modes, on record
Block moved 9:00→10:30 at 8:57 after the 8:55 push → |10:25−8:55| = 90 → re-arms;
9:00→9:15 → |9:10−8:55| = 15 → absorbed; 9:00→8:50 → absorbed. Zone changed ET→CT at
9:05 ET after the 8:55 send → new key, 60 min apart → re-arms at 8:55 CT. Deleted →
tombstone wins, absent next tick. Expired subscription → pruned from a fresh row; all
dead → retried once if a device appears within grace, else `no_subs`. Two tabs → the
server sanitizes the merged array. Cron double-fire → PK claim. Cron down an hour →
only blocks that started in the last 10 minutes fire. Tick dies after claiming →
re-claimed once after 2 min. Agent away a week → nothing. VAPID missing → freeze runs,
sends skipped. A 23:50 10-min block seen at 00:03 → ended; no previous-day pass exists.
Spring-forward: 02:30 NY 30-min block → `fireAt` 07:25Z, `startAt` 07:30Z, `endAt`
08:00Z; 03:00 lead 5 → 06:55Z; fall-back 02:00 lead 5 → 06:55Z. **Appointment
wall-clock `2026-09-08T10:00` for a Chicago agent → `startAt` 15:00Z, `fireAt` 14:55Z,
day `2026-09-08`, identical under server `TZ=UTC` and `TZ=America/Chicago`.**
Appointment moved 10:00→10:10 at 9:57 (not yet frozen) → one item at 10:10, |10:05−9:55|
= 10 → absorbed; →14:00 → re-arms. **No-show at 10:00 rebooked for 14:00 at 10:05 (after
the freeze)** → the frozen 10:00 card stays and its displaced minutes count; a second
14:00 card renders, splits the afternoon block, and reminds at 13:55 (fireMin differs;
`block_id` is the same, 300 min apart → not absorbed). **Prospect moved out of the
appointment stages after the meeting** → the frozen record keeps it on the timeline and
in the split; its displaced minutes stay counted. Moved out **before** it starts → gone
from timeline and tick together (nothing frozen yet); moved back → re-arms. A held
appointment never pushes. Head eaten → reminder for the surviving segment, key stable
across ticks and across the derived→frozen transition (same geometry). Whole block eaten
→ no candidate. Make-up hit by a later appointment → re-split; its minutes reduce
`recovered`; the offer returns. Attached prospect who also has a derived item at the
same start → one item (the attached geometry). Two attaches for one prospect → one item
(earliest `startMin`, then newest `updatedAt`). A 10-min block at T+6 → aged out
(half-duration grace). **Appointment booked at 8:00 for 14:00 and cancelled at 9:00 from
the Prospects tab with Routine never opened** → nothing was frozen, `realized` stays 0,
the day ends uncounted. **Two collisions on a day the agent never opened** → the tick's
second freeze (14:00) raises `owed.minutes` from 30 to 60 (`reconcileOwed` replaces
`minutes/byBlock` only). **Agent Skips at 10:00:20; the tick read the row at 10:00:05 and
writes at 10:00:40** → the tick's `owed` carries `updatedAt` 10:00:05 < the client's →
rejected; the 10:01 tick reads the decision and refreshes minutes under it. On the
spring-forward day the client composes in local minutes and the tick in instants — the
one hour of divergence is accepted (once a year, 02:00–03:00, no agent block hours).

## 7. UI

### 7a. View & header
`src/components/views/RoutineView.jsx` — props `{ showToast, prospects,
prospectSettings, onOpenProspect }`. Owns: the three documents; the `loaded` guard
(the initial empty state must never overwrite the cloud row); a 30-second clock paused
on `document.hidden`; saves — drag/resize/keyboard/delete/checkbox/settings commits
**immediately**, editor text fields (name, note) through a 400 ms debounce flushed on
sheet close; timezone capture; entitlement (§9); `devicePushOn` (populated by `await
isPushEnabled()` — it is async — on mount, after `enablePush()`, and on
`visibilitychange`); **one render path** via `useMediaQuery('(min-width: 640px)')` (new
`src/lib/useMediaQuery.js`, guarded; **640 = Tailwind `sm:`**, the breakpoint
`GlassModal`'s `sheet` treatment keys on at `MotionPrimitives.jsx:360`, so one split
governs both) rendering `<Timeline/>` or `<MobileRoutineList/>` under a shared
`<NowCard/>` — clocks, drag hooks, and the write path mount once; and the two composes
(§7h.3: `projected` over all of today's items, `realized` over started ones)
recomputed on the clock and on any change to blocks, day records, or prospects
(memoized on those + the minute). **Client-side freeze:** on any compose, an appointment
item with `instant ≤ now` and no `appt` record with its id (live or tombstoned) → the
client writes one (same rule as the tick; whichever runs first wins by id). `RoutineHeader`:
title, timezone chip, **Bell = `settings.remindersEnabled`** (turning it ON while
`devicePushOn === false` calls `enablePush()` first; if permission is denied the flag
still saves and the strip explains), settings gear → `RoutineSettingsSheet` (timezone,
default lead, active-day chips, **appointment-stages checklist**, **follow-up-stages
checklist**, "Start over from a template"). The strip, not the Bell, reflects device
status.

### 7b. NOW card — `src/components/routine/NowCard.jsx`
Sticky premium-card; category tile left (`bg-accent-gradient` for `appt` only),
primary action right, 2 px accent progress bar. **`nowState(items, blocks, dayRecords,
nowMin)`** → `{ phase: upFirst|now|free|dayDone, behind: block|null }` where **`behind`
is per underlying block**: the oldest routine block or make-up whose **last** surviving
segment has ended and that has no `done|skipped` record (appointments never set it).
Phases: **Up first** "Morning review · starts 8:00 · reminder 7:55"; **Now** "NOW ·
8:30–10:00 / Dial block / 18 min left · then Break at 10:30" + a large Done checkbox
(after checking, "Done ✓ — then Break at 10:30" until the block ends); for an
appointment the action button shows the visible word **Held** (disabled until the
item has started, §7g); **Free until 10:45** (next item + its reminder time; "Start now"
scrolls to it); **Day done** (`behind === null` **and not** `offerOpen && slot`, §7h.3).
**There is no amber "Running behind" chip** — `behind` surfaces only as meta line (2).
**One 11 px meta line**, first match, no icon, no background: (1) **offer** — `offerOpen
&& slot`: "30m of <noun> displaced." (slate-500) + text button "Add 2:00–2:30" (weight
600, accent) " · " "Skip" (slate-400); (2) **still open** — "<block name> · still open"
(slate-500; tap scrolls to it); (3) **note** — `projected > 0` and no offer: "30m owed"
(slate-400, static); (4) **yesterday** — "Yesterday · 30m <noun-y> not made up"
(slate-400) with a 12 px × (20 px hit; 44 on phone). With `projected = 0` lines (1) and
(3) never render. **Noun table** (from the projected `displacedByBlock` for (1)/(3),
from the stored `byBlock` for (4)): all `dial` → "dial time" / "dialing"; all `followup`
→ "follow-up time" / "follow-up"; otherwise "routine time" / "routine time". Minutes ≥
60 render "1h 25m". Below the meta line, the **reminder strip**, first match:
`remindersEnabled===false` → "Reminders are off"; iOS && `navigator.standalone===false`
→ the install strip (§8); `Notification.permission === 'denied'` → "Reminders are
blocked in your browser settings"; `devicePushOn===false` → "Reminders are off on this
device" + Enable; invalid zone → "PRIM doesn't know your time zone"; `activeDays` empty →
"All days off". **Copy tripwire:** no PRIM-authored literal in NowCard, Timeline, or the
phone rows contains "behind", "missed", or "streak" (case-insensitive; agent data —
stage labels, prospect and block names — is exempt).

### 7c. Timeline (desktop, ≥ 640 px) — `Timeline.jsx`, `TimelineBlock.jsx`
Geometry (`src/lib/routineLayout.mjs`, pure): `PX_PER_MIN=2`, `SNAP_MIN=5`,
`DEFAULT_START=360`, `DEFAULT_END=1260`; bounds = `[min(DEFAULT_START,
floorHour(earliest)), max(DEFAULT_END, ceilHour(latest end))]` over composed items,
derived, never stored; `top=(startMin−boundsStart)·2`, `height=durationMin·2`. Hour
gutter, dashed half-hour rules, a 2 px rose now-line with a time label, auto-scroll so
now sits a third of the way down. Routine block: `role="button" tabIndex=0` (not
`<button>` — the global `button:active` scale would shrink it mid-drag), left category
stripe 3 px, inline `background: hex+'1F'` light / `hex+'33'` dark via `useIsDark`
(**inline hex on purpose** — `globals.css` remaps only indigo/amber/emerald/rose
backgrounds in `.dark`), row 1 checkbox 18 px (emerald when checked, spring scale) +
title 12 px/500 + category icon, row 2 (≥ 44 px) time range + Bell + reminder minute,
6 px bottom resize handle. **Type scale is PRIM's: 10 / 11 / 12 / 14 px.**
`blockVisualState` (`routineClock.mjs`, tested): future/unchecked normal; future/done
checked + opacity .6; current → subtle accent ring; past/done checked + faded;
**past/unchecked → full opacity with a slate-400 dot** (no amber — the loss marker is
the only amber text on the page; category hues are not semantic); skipped → dashed
stripe; `cleared` renders as unchecked. **Density tiers are per underlying block:**
`full` if any segment is the current or next item (all rows); `compact` for other
future blocks (title + time); `spent` for past blocks (title only; opacity .55 **only
when done or skipped** — past/unchecked keeps full opacity and the dot). **Segments
(§7h.3):** tier, `blockVisualState`, checkbox, title, bell, and the dot are evaluated
per block and rendered on the **title segment** (the first segment whose end > `nowMin`;
the last once all are past); every other segment renders fill, stripe, its own time
range (11 px slate-500), and any loss marker placed on it — nothing else, at any tier;
the accent ring is drawn on the current segment only.

Drag/resize: `src/lib/usePointerDrag.js` — pointer events + `setPointerCapture`, 4 px
threshold, Escape cancels, touch-capable, ~70 lines, **no new dependency** (the repo
has no DnD library; framer drag inside a scroll container fights auto-scroll). Rules on
`liveBlocks`: move → snap, clamp to bounds, slide to the nearest free gap that fits,
else revert + toast "No room there — shrink it or move a neighbor"; resize → clamp to
the next item's start; palette drag-in ghosts at pointer time; palette click adds at
the next free slot ≥ default duration at/after now, else toast "No room today"; click
empty time (spec addition) → "+ 10:15" pill → editor. **Appointments and non-first
segments are not draggable; the first segment is the routine block's drag handle**
(moving it moves the whole block, then re-composes). Keyboard: ↑/↓ ±5 (Shift ±15),
Alt+↑/↓ duration, Enter edit, Delete → tombstone (+ its live attaches, §4a), Space
toggle. **Single-delete undo** = a RoutineView-local 5 s toast holding the block id;
Undo sets `deletedAt:null` + `updatedAt:now` on the block and its attaches. Every commit
→ `sanitizeBlocks` → save.

### 7d. Palette — `src/lib/routinePalette.mjs`, `BlockPalette.jsx`
Every category has exactly one hex for tint, stripe, and dot; the NowCard tile may
render the accent gradient for `appt` only. **No category uses amber `#f59e0b`** —
amber text is reserved for the loss marker (tripwire: the hex appears nowhere under
`src/components/routine/` or `src/lib/routine*`).

| id | name | category · hex | defaultMin | defaultRemind | why-line (hover) |
|---|---|---|---|---|---|
| dial | Dial block | dial · #f43f5e | 120 | on | Protected outbound time. Phone only — no email, no CRM cleanup. |
| followup | Follow-up queue | followup · #f97316 | 75 | on | Work the people who said "call me back". Oldest first. |
| text | Text blast + replies | text · #0ea5e9 | 30 | on | Send the blast, then answer every reply before you move on. |
| webby | Webby appointments | appt · #8b5cf6 | 120 | on | Back-to-back webinar/Zoom presentations. Camera on, quotes ready. |
| inperson | In-person appointment | appt · #8b5cf6 | 60 | on | Drive time not included — add a block for it. |
| review | Morning review | review · #6366f1 | 30 | on | Yesterday's misses, today's goals, who's warm. |
| admin | Apps & underwriting | admin · #64748b | 60 | on | Submit apps, chase underwriting, clear the paperwork pile. |
| learn | Learning | learn · #10b981 | 45 | on | Product training, a recorded call, a script drill. Compounds. |
| break | Break | break · #94a3b8 | 15 | off | Step away. The next block goes better. |
| custom | Make your own block | custom · #d946ef | 30 | on | Anything else your day needs. Name it, size it. |

Icons: PhoneCall, RotateCcw, MessageSquare, Video, MapPin, Sunrise, FileCheck,
GraduationCap, Coffee, Plus (lucide 1.8). A palette click and `instantiateTemplate`
both set `remind = { enabled: palette.defaultRemind, minutesBefore:
settings.defaultMinutesBefore }`.

### 7e. Templates — `src/lib/routineTemplates.mjs`
**One starter + Blank.** A template entry carries `paletteId, name?, startMin,
durationMin?, note?, remind?` (never overrides `paletteId`; an unlisted `durationMin`
uses the palette default); `instantiateTemplate(t, { now, defaultMinutesBefore })` fills
`id, category, remind, createdAt, updatedAt`. Shared constants: **Lunch** = `{
paletteId:'break', name:'Lunch', durationMin:45 }`; **Day wrap-up** = `{
paletteId:'review', name:'Day wrap-up', durationMin:15 }`. **Starter — "Agent day":**
08:00 Morning review 30 · 08:30 Dial block 120 "Fresh leads first. Aim for 40 dials." ·
10:30 Break 15 · 10:45 Text blast + replies 30 · 11:15 Follow-up queue 75 · 12:30 Lunch
· 13:15 Dial block 120 "Callbacks + aged leads" · 15:15 Break 15 · 15:30 Follow-up queue
60 · 16:30 Apps & underwriting 45 · 17:15 Day wrap-up "Log every touch. Set tomorrow's
top 3." (collision-free, no midnight crossing — test-pinned). **`applyTemplate(existing,
template, { replace=false, now, defaultMinutesBefore })` → `{ blocks, backup }`:** live
existing non-empty + `!replace` → unchanged, `backup:null`; live empty → seeded; `replace`
→ `backup` = the pre-call sanitized array, `blocks` = old live blocks tombstoned (`deletedAt
= updatedAt = now`) + tombstones + the instantiated template. **Undo** re-sanitizes
`backup` with every `updatedAt` bumped to `now` and clears `lastReplacedBackup`. Empty
state: two cards. Replace: ConfirmDialog + 10-second Undo.

### 7f. Editor & mobile
`BlockEditorSheet.jsx` (desktop popover per `DateTimePicker`'s portal/outside-click/
Escape pattern; phone `GlassModal` from `src/components/motion/MotionPrimitives.jsx:358`,
`sheet`): name ≤ 60, palette, start, duration, lead (off/0/5/10/15), note ≤ 200 with the
hint "keep block names generic — they show in your notification tray". **`appt`
placeholder → "Attach prospect (today)":** a native `<select>` — options = non-archived
prospects with **no live `attach` record today whose block is live**; group 1: stage ∈
`appointmentStages`, A–Z; group 2: every other stage except SOLD and LOST, A–Z; "— none
—" first — choosing writes an `attach` record (**never `prospectId` or a name into the
block**). A prospect who also has a derived item may be chosen; the block's geometry
then wins for that start. **Make-up → "Remove make-up"** (tombstone; no Skip today).
**Frozen appointment (desktop popover, phone long-press) → "Remove from today"**
(tombstones the `appt` record and, when `source === 'attached'`, the attach record too;
the tombstone suppresses both that frozen copy and any live item at the same start — the
card returns only if the appointment's time changes). **Phone list (< 640 px,
`MobileRoutineList.jsx`):** the shared NowCard; rows = 4 px category stripe, time column,
title, Bell + minute, a 28 px right-thumb checkbox; a rose "now" divider; "+ Add block"
FAB → `PaletteSheet`; **follow-up row** = title + "14 due" in the time column (tap the
count → the sheet; tap the title → the editor); **appointment row** = the white treatment
(§7h.1) with the Held checkbox (`aria-label="Held"`, no visible text); long-press:
routine rows → Skip today / Delete; make-ups → Remove; **attached rows (not yet started)
→ "Detach (today)"** (tombstones the attach record); **frozen rows → "Remove from
today"**; **derived rows that have not started have no long-press menu** (tap the name →
`onOpenProspect`; the stage or time is changed in Prospects). No `done` record is ever
written with an `appt:` or derived id.

### 7g. Done-state
Per local day from `settings.timezone` at read time — no midnight job. **Held is enabled
only once the appointment item has started (`instant ≤ now`)** — by then a frozen record
exists (the client freezes on the same compose, §7a) — and **stamps `heldAt` on that
record; unchecking sets `heldAt: null`** (both bump `updatedAt`). Held never creates a
record. An un-attached `appt` placeholder writes `done`; segments of one block share its
`done` record; a make-up writes `done` under its `mk_` id.

### 7h. The live layer — restraint design + two grafts

**7h.1 Appointments.** `todaysAppointments({ prospectRows, blocks, dayRecords, settings,
tz, now })` (pure; `blocks` = `liveBlocks`, never emptied by `activeDays`) → items `{
prospectId, name, startMin, durationMin, instant, source, frozen, heldAt }`, keyed by
**(prospectId, startMin)**:
1. **Every live (not tombstoned) frozen `appt` record for today** is an item (`frozen:
   true`, its stored geometry and `source`, `instant = zonedTimeToUtc(today, startMin,
   tz)`) — regardless of the prospect's current stage, time, or archive state, and
   without needing a prospect row. This keeps a finished appointment on the timeline
   after the agent moves the prospect on.
2. **The live item** for a prospect — an **attach** record for today on a live `appt`
   block (the block's geometry; two attaches → earliest `startMin`, then newest
   `updatedAt`; an attach whose block is tombstoned yields nothing; no prospect row
   needed), else **derived** — `!archivedAt`, `stage ∈ settings.appointmentStages`,
   `parseAppointmentTime(...).day === localDayKey(now, tz)`, `durationMin: 30` — is an
   item **iff no `appt` record (live or tombstoned) exists for that prospect at that
   `startMin`**. A live item whose `instant ≤ now` is what the freeze (§6b.4, §7a) turns
   into a frozen record; the next compose renders it under rule 1.
So a no-show at 10:00 rebooked for 14:00 yields two cards; a pre-start time edit moves
the one card. `name` is resolved from `prospects` at render (fallback: the placeholder
block's own name, or "Appointment"); the tick never uses it. A placeholder block with a
live attach is not rendered as a routine block. Appointments ignore `activeDays`.
**Rendering (figure/ground inversion):** **the only white surface on the timeline** —
`bg-white` (`.dark` remaps it), `border-slate-200 dark:border-slate-700` (bare utilities
— an opacity variant would escape the remap), 4 px `#8b5cf6` left stripe (routine
stripes are 3 px), inset 10 px from the lane's right edge. **Nothing else distinguishes
it**: no icon, no label, no avatar, no stage chip, no bell, no unconfirmed variant. Row 1:
checkbox (18 px, violet when checked, `aria-label="Held"`, disabled before start) + the
prospect's name as title, 12 px/600. Row 2 (≥ 44 px): "10:00–10:30" 11 px slate-500.
Nothing more at any height. Tap the name → `onOpenProspect(id)`. Names render in-app only.

**7h.2 Follow-up names.** `followupQueue(prospects, stageIds, tz, now)` (pure):
`!archivedAt && stageIds.includes(stage)`, ordered **`lastContact` ascending with
empty first**, then `createdAt` **ascending**, then `id` (ASSUMPTION — "oldest first" for
stage-selected prospects, most of which have no armed cadence); age =
`daysBetween(lastContact, localDayKey(now, tz))` → "12d"; empty `lastContact` → "new"
if `createdAt` is within 7 days, else "—". In the follow-up block, **`full` tier only**,
with `h` = the pixel height of the title segment: header = checkbox + "Follow-up queue"
+ the bare count (12 px/600 **slate-400**, never amber); then `min(4, floor((h −
58)/20))` name rows (12 px/500 slate-700, age right, no dividers, no stage labels, no
avatars, no per-name checkboxes); "+10 more" (11 px accent) on overflow; **under 78 px**
the header's count becomes "14 due · oldest 12d" and no rows render. Tapping names or
"+N more" opens **`GlassModal sheet`** — header "Follow-up queue · 14 due · by last
contact" — with **`FollowupDueWidget`'s row grammar** (`divide-y divide-slate-100`, name
14 px/600, secondary "<stage label> · 12d" — or "<stage label> · appt 10:00" when the
prospect still carries a time today — `ArrowRight`; **no "Due today" chip, no "Next:"
line** — only those three elements); a row → `onOpenProspect(id)`. **No checkbox per
name.** `compact`/`spent` show the count only.

**7h.3 Collision → split → owed → make-up.** `composeDay({ live, appointments, makeups,
dayRecords, nowMin })` (pure) → `{ items, displacedByBlock, displacedByMakeup, recovered,
unrecovered, markers }`:
- **Two kinds of cut interval.** (a) The **union of appointment intervals** cuts every
  routine block and make-up into surviving segments; a segment under 10 min is dropped
  and its minutes count as displaced. **Displacement applies to routine blocks with
  `category ∉ {break, appt}` only** — an un-attached `appt` placeholder and a `break` are
  cut for rendering (the white card sits on top) but contribute 0, get no marker, open
  no offer. `displacedByBlock` keys are routine block ids only; make-up displacement
  lives in `displacedByMakeup`. (b) **Live make-up intervals** cut whatever routine
  segment they sit on (a break, a block skipped today, or one since un-skipped) **for
  rendering only**: those minutes are never displaced, never marked, never in
  `displacedByBlock`; a remnant under 10 min is simply not rendered. Segments share the
  block's id, fill, stripe, and `done` record; the title segment is defined in §7c.
- **Recovery:** `recovered = Σ over live make-ups of (durationMin − displacedByMakeup)`;
  `unrecovered = max(0, Σ displacedByBlock − recovered)`.
- **Two composes on the client, one on the tick.** `projected` = `composeDay` over
  **all** of today's items (frozen + live, future included) — drives rendering, the
  offer, the note, `dayDone`, and `makeupMin = max(10, ceil5(projected.unrecovered))`.
  `realized` = `composeDay` over items with `instant ≤ now` only — the minutes actually
  lost so far; this is what is stored and counted. At midnight the two are equal.
- **Loss markers** (from `projected`): one "−30m" per appointment interval per displaced
  routine block, amber text (`text-amber-600 dark:text-amber-400` — amber text means
  routine time lost and nothing else), **on the preceding segment if it is ≥ 40 px, else
  the following if ≥ 40 px, else omitted**; never on `break` or `appt` blocks; on phone the
  shortened row shows "−30m" in its time column.
- **The `owed` record** stores the realized minutes and the agent's last decision;
  **compose never changes `status`.** `reconcileOwed(stored, realized, now)` (pure,
  shared by client and tick) → the record to write or `null`: absent and
  `realized.unrecovered === 0` → `null`; absent and `> 0` → `{ minutes, byBlock, status:
  'open', decidedAt:null, decidedMinutes:null }`; present and `minutes` or `byBlock`
  differ → the stored record with only `minutes/byBlock/updatedAt` replaced; else `null`.
  **Skip** → `status:'skipped', decidedAt: now, decidedMinutes: projected.unrecovered`;
  **Accept** → `status:'accepted', decidedAt: now, decidedMinutes: 0` (the make-up is
  sized to cover the projected total). **`offerOpen = projected.unrecovered >
  (decidedMinutes ?? 0)`** — derived, never stored. Walk: skip at 30 → note; a second
  collision → 45 > 30 → offer; that appointment cancelled → 30 → note again (status still
  `skipped`); 45 again → offer; skip at 45 → note. Accept at 30 → projected 0 → nothing;
  make-up hit by 20 → 20 > 0 → offer; remove the make-up → 30 > 0 → offer. A
  cancelled-then-rebooked appointment never re-offers a total the agent already skipped.
- **`findMakeupSlot(items, live, dayRecords, makeupMin, nowMin)`:** a gap is a run of
  minutes inside the routine's span `[max(nowMin, firstLive.startMin), lastLive.endMin]`
  not covered by an appointment, a make-up, or a routine segment whose block is
  **non-`break` and not `skipped` today** — i.e. **a make-up may be placed over a break
  or over a block the agent skipped today** (a gap-free routine still has lunch and
  breaks to offer). Pass 1 (afternoon): for each gap `s = ceil5(max(gap.start, 720,
  nowMin))`, qualify iff `gap.end − s ≥ makeupMin`, return the first. Pass 2: `s =
  ceil5(max(gap.start, nowMin))`. Else `null`. Pinned: gap 11:45–12:30, 30 owed, now 9:42
  → 12:00–12:30; routine ends 17:30, now 17:00, 45 owed → `null`; **the starter routine
  with a 9:00–9:30 appointment inside the morning Dial, now 9:42, 30 owed → 12:30–13:00
  (over Lunch; the 10:30 break fails the 720 floor; Lunch's 13:00–13:15 remnant still
  renders)**.
- **Offer lifecycle** (meta line): `offerOpen && slot` → "Add hh:mm–hh:mm · Skip". Accept
  → `makeup { startMin: slot, durationMin: makeupMin, category/name of the largest
  displaced block (tie → earliest-starting) + " (make-up)", ofBlockId }`, rendered as a
  routine block with a **dashed 3 px stripe** (the only difference), reminding like one;
  no toast. `projected.unrecovered > 0` and no offer → the static note. Removing a make-up
  tombstones it; `recovered` drops; the offer returns by the rule above.
- **Accountability:** `dayDone` is blocked only while `offerOpen && slot`. **Inactive
  day:** `live = []` — no splitting, no owed record; appointments still render, freeze,
  and remind.

**7h.4 Yesterday's miss.** `yesterdayMiss(dayRecords, blocks)` (pure) = yesterday's
`owed.minutes` where `minutes > 0` — **realized, unrecovered displaced time only**
(`minutes` already nets out an intact make-up, so an accepted-and-kept make-up reads 0
and an accepted-then-removed one counts; ASSUMPTION per "the block they missed":
unchecked blocks are never counted). Noun from the stored `byBlock` via the §7b table.
Rendered once per day as the lowest-priority meta line; hidden when today has an `ack`
or any `done|skipped` record. Never alters today, never pushes, never nags.

**7h.5 Weekly look-back.** At the very bottom, on the page background under a 0.5 px
hairline: collapsed every session — "This week · 2h 10m displaced" (12 px/500 slate-500,
tabular) + `ChevronRight`; expanded (96 px, FadeIn) = seven 20 px bars on a 44 px band,
`clamp(2, minutes/150·44, 44)`, slate-300 (dark slate-600), yesterday's bar slate-400,
"M T W T F S S" 10 px beneath. **Nothing else.** `weeklyDisplaced(dayRecords, tz, now)`
covers **`addDays(today, −7) … addDays(today, −1)`** (day-key arithmetic; today is never
included — its record has not expired), summing `owed.minutes` where `minutes > 0`.
Because the tick freezes every started appointment and refreshes `owed` for every
entitled agent with a valid zone (§6b.4), a day the agent never opened is still counted.

**What the design refuses to show:** any icon on appointments; stage names on the
timeline; a phone number or Call button; completion percentages; a colored badge for
owed time; a separate owed panel; per-collision lines; streaks; tooltips or numbers on
the weekly bars; confirmation toasts; a second meta line; prospect names or stages in
any push; dividers or avatars in the in-block name list (the sheet reuses
`FollowupDueWidget`'s grammar, dividers included, chip and Next line excluded).

## 8. iOS / PWA + the service worker
- **`src/lib/appMetadata.mjs`: pure `buildAppMetadata(role)`** → the existing
  title/description and, **only when `role !== 'marketing'`**, `manifest:
  '/manifest.webmanifest'`, `appleWebApp: { capable:true, statusBarStyle:'default',
  title:'PRIM' }`, `icons: { apple:'/apple-touch-icon.png' }`. **`layout.js` converts its
  static `metadata` export (line 26) to `export async function generateMetadata()`**
  resolving the role from `(await headers()).get('x-prim-role')` (fallback
  `classifyHost`). Node-lane test (`layout.js` imports `next/font` and CSS). The static
  file is served on both hosts; only the `<link>` is gated.
- `public/manifest.webmanifest`: `name/short_name "PRIM"`, `start_url "/"`, `display
  "standalone"`, `theme_color "#6366f1"`, `background_color "#ffffff"`, icons
  `/icons/prim-192.png`, `/icons/prim-512.png`; plus `/apple-touch-icon.png` (180 px).
  Generated once from `public/prim-mark.png` with `sharp` (0.34.5, present in
  `node_modules` as a Next dependency; not added to `package.json`); PNGs committed.
- **Service worker (`public/sw.js`), two changes.** (a) `notificationclick`: among the
  `matchAll` window clients, **prefer the first whose `new URL(client.url).pathname ===
  '/'`** (the app shell; `/pricing`, `/admin`, and the legal pages mount no LeadTracker
  listener); when found, **`client.focus(); client.postMessage({ type: 'prim:view',
  view: 'routine' }); return;`** — no navigation, no reload; **when no such client
  exists, `self.clients.openWindow(url)` even if other PRIM windows are open**. (b)
  nothing else; `push` and the payload contract (`title/body/tag/url/urgent`) are
  untouched (tripwire). `install` already `skipWaiting`s.
- **Install strip** (NowCard only): iOS UA && `navigator.standalone === false` → "To get
  reminders on iPhone: tap Share → Add to Home Screen, then open PRIM from there and
  turn on notifications." Inside the installed app the Bell or Profile → Notifications
  completes the flow.

## 9. Navigation, gating, rollout
- **Tab:** `src/lib/constants.js` `NAV_TABS` gets `{ id:'routine', label:'Routine',
  icon:'CalendarClock' }` after Overview (dashboard); `LeadTracker.jsx` adds `CalendarClock`
  to the lucide import **and** the `ICONS` map (line 94 — both, or the render throws);
  static import; `<ViewMount visible={view==='routine'} viewKey="routine"><RoutineView
  showToast={showToast} prospects={prospects} prospectSettings={prospectSettings}
  onOpenProspect={openProspect} /></ViewMount>` — the same `prospects`/`settings`
  `ProspectsView` receives.
- **Deep link, two paths (new):** on mount, `?view=<id>` → `setView` only for ids in the
  user's **filtered** tab list, then **`window.history.replaceState(null, '',
  window.location.pathname)`** (guarded) so the URL is clean again; and a
  `navigator.serviceWorker.addEventListener('message', …)` listener (guarded) that on
  `{ type:'prim:view', view }` calls the same guarded `setView`. Both feed one helper.
- **Prospect opener (new plumbing):** `LeadTracker` adds `const [pendingProspectId,
  setPendingProspectId] = useState(null)` and `openProspect = useCallback((id) => {
  setPendingProspectId(id); setView('prospects'); }, [])`; **`ProspectsView` gains
  props `openProspectId` + `onOpenConsumed`** and, in an effect, `onView(prospects.find(p
  => p.id === openProspectId))` then `onOpenConsumed()` (unknown/archived ids ignored).
- **Flag:** `featureFlags.js` `BETA_FEATURES.routine_builder = { name:'Routine Builder',
  requiredTier:'starter', publicGA:true }` — all paid tiers day one; complimentary and
  admin included by the existing layers; the tick mirrors it (§6b.2).
- **Non-entitled UI:** tab visible; `useBetaFeature('routine_builder')`; `loading` →
  skeleton; `canAccess === false` → the `AgentSettingsPanel.jsx:343-361` locked card
  (`no_subscription` / `tier_too_low` → `/pricing`) and **zero storage writes**.
- Announce via the `[announce]` merge-subject convention.

## 10. Pure modules (node lane)
`routineKeys.mjs` · `tz.mjs` (incl. `daysBetween`) · `routineModel.mjs` (`uid`,
`sanitizeBlocks`, `liveBlocks`, `resolveOverlaps`, `sanitizeDay`, `sanitizeSettings`,
`seedFollowupStages`, `applyTemplate`, `instantiateTemplate`, `DEFAULT_SETTINGS`) ·
`routineLive.mjs` (`parseAppointmentTime`, `todaysAppointments`, `followupQueue`,
`composeDay`, `reconcileOwed`, `findMakeupSlot`, `yesterdayMiss`, `weeklyDisplaced`) ·
`routinePalette.mjs` · `routineTemplates.mjs` · `routineLayout.mjs` · `routineClock.mjs`
(`nowState`, `blockVisualState`, `formatTime`, `formatMinutes`) · `routineTick.mjs`
(`computeDue`, `computeFreeze`, `buildPayload`, constants) · `appMetadata.mjs`. Client:
`routineStore.js` (setupChecklist.js pattern), `usePointerDrag.js`, `useMediaQuery.js`,
`useIsDark` (existing). Server: `pushServer.js`. SQL: `supabase/routine-push-log-
migration.sql`, `supabase/routine-appt-rows-function.sql`, `supabase/routine-day-write-
function.sql`, `supabase/routine-tick-cron.sql`.

## 11. Operator config (Juan, before the live pass)
0. **Vercel → Production env:** confirm `CRON_SECRET` exists (the production env pull on
   record did not include it — if absent, add 32+ random characters and redeploy; the
   tick fails closed without it) and `NEXT_PUBLIC_SITE_URL = https://app.primtracker.com`.
1. Supabase → Database → Extensions: enable **pg_cron** and **pg_net**.
2. Supabase → Vault: `prim_cron_secret` = the same value as `CRON_SECRET`.
3. Run, in order, `routine-push-log-migration.sql`, `routine-appt-rows-function.sql`,
   `routine-day-write-function.sql`, then `routine-tick-cron.sql` (SQL pasted in chat).
   The last raises if the Vault secret is missing — by design.
4. **Gate 0:** two minutes later, `select status_code, left(content::text,120) from
   net._http_response order by id desc limit 3` → `200` with the tick's JSON; `select
   status from cron.job_run_details where jobid = (select jobid from cron.job where
   jobname='prim-routine-tick') order by start_time desc limit 3` → `succeeded`. `401` =
   secrets differ or `CRON_SECRET` unset; `failed` with "missing from Vault" = renamed.
5. Check the manifest icons on an iPhone Home Screen.

## 12. Testing

- **Node lane** (`src/lib/*.test.mjs`, `npm test`): **`tz.test.mjs`** — the four DST
  instants, `offsetMinutesAt` sign, `localWeekday('2026-09-06') === 0`, `addDays`,
  `daysBetween` (incl. across a DST change), invalid zones. **`routineModel.test.mjs`** —
  every sanitizer rule (§4a/§4b/§4c), `startMin+durationMin ≤ 1440`, `resolveOverlaps`
  tie-break/shrink/tombstone/60-cap, tombstones retained + `liveBlocks` hides + 8-day
  prune, stale-merge keeps a delete, un-delete bumps, deleting an `appt` block tombstones
  its live attaches and Undo restores both, `applyTemplate` all four branches + undo,
  `instantiateTemplate` remind defaults, `seedFollowupStages` seeds "Expressed Interest/
  Aiming APPT" and "Try to Reengage/Get interest back" and **not** "Re-engaged (won)",
  "Not Interested", "Uninterested", "No interest", with `prospectSettings=null` → the
  three defaults, flag flips once. **`routineTemplates.test.mjs`** — collision-free, valid
  ids, no midnight crossing. **`routineLayout.test.mjs`**, **`routineClock.test.mjs`**
  (four phases with `behind` set/null; at 9:10 with a 9:00–9:30 mid-Dial appointment
  `behind` is null; at 10:31 unchecked it is set; midnight rollover; `spent` opacity only
  when done/skipped), **`appMetadata.test.mjs`**. **`routineLive.test.mjs`** —
  `parseAppointmentTime`: `'2026-09-08T10:00'` Chicago → 15:00Z, day `2026-09-08`,
  **identical under `TZ=UTC` and `TZ=America/Chicago`**; `'T23:30'` → 1410 today in every
  zone; zoned `…-05:00` → tomorrow in New York; `'2026-09-08'` and `'…T00:00'` → null;
  `'garbage'` → null. `todaysAppointments`: frozen wins over a stage change at the same
  start; **frozen 10:00 + live 14:00 → two items**; a pre-start time edit → one item; a
  tombstoned `appt` suppresses the live item at that start; attach wins over derived at
  the same start; two attaches → one; an attach whose block is tombstoned → nothing;
  frozen/attached items need no prospect row; stage filter uses `appointmentStages`;
  SOLD excluded; name fallback; `activeDays` never empties it. `followupQueue`: custom
  id, empty-first, `createdAt` asc tiebreak, "new"/"—", archived excluded, 60-prospect
  fixture pins the four visible names. `composeDay`: tail/head/mid/whole, 9-min remnant
  dropped, unioned overlaps counted once, breaks and `appt` placeholders contribute 0,
  two appointments → two markers and one sum, make-up re-split reduces `recovered`,
  `displacedByBlock` has no `mk_` keys, marker on preceding-≥40px-else-following,
  title segment = first ending after now, **make-up over a skipped followup block →
  `displacedByBlock` unchanged, no marker; un-skipped afterwards → same**, make-up over
  Lunch leaves the 13:00–13:15 remnant. `findMakeupSlot`: the three pinned cases,
  over-a-break and over-a-skipped-block placement, afternoon over morning, never before
  now, `makeupMin` (owed 9 → 10, 33 → 35). `reconcileOwed`: absent+0 → null; absent+30 →
  open; differing minutes → only minutes/byBlock/updatedAt change (status, decidedAt,
  decidedMinutes untouched); equal → null. **Offer lifecycle (derived `offerOpen`):**
  skip@30 → note; 45 → offer; 30 → note (status still `skipped`); 45 → offer; skip@45 →
  note; accept@30 → nothing; make-up hit 20 → offer; remove make-up → offer; `projected =
  0` → no line, dayDone reachable. `yesterdayMiss`: `minutes > 0` only (Dial 120 with 30
  displaced → 30; accepted with an intact make-up → 0 → no line; accepted then removed →
  counted); `ack`/`done` hide; nouns. `weeklyDisplaced`: seven days ending yesterday,
  DST week has seven distinct keys. **`routineTick.test.mjs`** — lead 5: due T−5, not
  T−6, T+9 "started 9 min ago", not T+11; lead 15 and midnight clamp; 10-min block at
  T+6 aged out; appointment at T−5 with the wall-clock instant; `activeDays` ignored for
  appointments; head-eaten → 8:55 for the 9:00 segment, key stable; whole-eaten → none;
  `already_done`, `already_held`; make-up fires from `routine_day_v1`; attached prospect
  with empty `appointmentTime` → exactly one `appt:` candidate and no prospect row
  needed; **un-attached `appt` placeholder at T−5 → one candidate, body "Appointment in
  5 min", tag `routine-<id>`, no block name; attached → none**; **"then an appointment at
  10:00"** when the next item is an appointment **or an `appt` block** (no fixture name
  in any payload); `bad_tz` for a missing settings row with appointments + subs, Phase B
  not queried; a non-entitled agent's rows never queried (mocked `.in()` ids); **reminders
  off + no subs → still composed and frozen, nothing sent**; **freeze: first tick → RPC
  called with the `appt` (updatedAt = start instant) and `owed` (updatedAt = readAt);
  second tick with unchanged inputs → no RPC call; a later started appointment → `owed`
  refresh with minutes 60; a stored decided record → only minutes/byBlock differ in the
  outgoing record; booked-for-14:00-cancelled-at-9:00 → no owed record all day**;
  Wisconsin vs Florida same 8:30 → different instants; cooldown on instants; retry once,
  not twice; stale claim; `value` string and array both parse; unparseable →
  `bad_shape`, others still fire.
- **UI lane** (`src/components/routine/*.test.jsx`, `views/RoutineView.test.jsx`):
  RoutineView — zero writes before `loaded`, zero when not entitled, template adoption,
  timezone capture, exactly one of Timeline/MobileRoutineList at 640 px, a drag commit
  saves immediately, a rename saves once after 400 ms, **never writes `prospects_v1`,
  `prospect_settings_v1`, or a prospect reference into `routine_blocks_v1`**, client
  freeze writes `appt` once and never re-freezes a tombstoned id; NowCard — every phase
  with/without `behind`, exactly one meta line per state, every strip case, **with
  `projected.unrecovered = 0` no element carries a `text-amber-*`/`bg-amber-*` class and
  no meta line (1)/(3) renders**; TimelineBlock — checkbox writes one record; drag commit
  runs `sanitizeBlocks`; delete → undo; appointment card has no `<svg>`, no bell,
  `border-slate-200`; Held disabled before start, enabled after, un-Held writes `heldAt:
  null`; at 9:42 with a 9:00–9:30 appointment the 9:30 segment shows title + checkbox
  **and the 8:30–9:00 segment shows a time range only (no dot, no checkbox)**; follow-up
  block ≤ 4 names in `full`, none in `compact`, count slate; "+N more" → sheet with
  `FollowupDueWidget` classes and no amber chip; sheet row → `onOpenProspect(id)` and
  LeadTracker lands on Prospects with that detail open; Accept writes one `makeup`, no
  toast; Skip → note; remove make-up → offer returns; × → `ack`; no `done` record with an
  `appt:` id; phone long-press menus per §7f (**Detach on an unstarted attached row;
  Remove from today on a frozen row tombstones `appt` + attach**); the `prim:view`
  message → `setView`.
- **Tripwires** (`sourceInvariants.test.mjs`, text-level): the tick route contains the
  `CRON_SECRET` fail-closed block and an `if (error)` after every select and after the
  `rpc(` call; **the tick route contains no `.upsert(` or `.update(` targeting `user_kv`
  and no `from('user_kv')` write of any kind**; its profile select contains
  `subscription_tier`; `pushServer.js` has `if (error)` after select and upsert; `sw.js`
  still reads `title/body/tag/url/urgent` and contains `pathname === '/'`; no sub-daily
  cron in `vercel.json`; **`Date.parse(` occurs exactly once in `routineLive.mjs`
  (inside `parseAppointmentTime`) and zero times in `routineTick.mjs`**; no `.name` of a
  prospect-derived or `appt`-category item in any payload builder; `#f59e0b` appears
  nowhere under `src/components/routine/` or `src/lib/routine*`; both SQL function files
  contain `security definer`, `jsonb_typeof`, `revoke execute`, and `grant execute … to
  service_role`; the copy tripwire of §7b.
- **Mutation checks:** `GRACE_MIN` → 0 → red; delete the claim filter → double-fire red;
  drop the ended guard → red; drop `|tz` → zone test red; drop `.canAccess` → red; drop
  `activeDays` → red; cooldown on `created_at` → absorb red; `liveBlocks` returns
  tombstones → red; `endAt`/`fireAt` via `zonedTimeToUtc` → spring-forward red; re-add a
  previous-day pass → red; parse with `Date.parse` → the `TZ` test red; drop the stage
  filter → red; sort `lastContact` desc → red; count breaks or `appt` → red; count a
  make-up cut as displaced → red; remove the 720 floor → red; remove the span bound → null
  test red; drop `decidedMinutes` from `offerOpen` → the skip-30-45-30 test red; let
  compose mutate `status` → the same test red; count unchecked blocks in `yesterdayMiss`
  → red; count `minutes = 0` in weekly → red; put any name in a payload → red; write a
  prospect reference on a block → red; drop the negation guard → "Not Interested" red;
  freeze from future items → the cancelled-at-9:00 test red; replace the RPC with a row
  upsert → the tripwire red; gate the freeze on subs → the reminders-off test red;
  key `appt` by prospect only → the two-cards test red.
- **Live pass (hard gates, in order):** (0) the pg_cron → pg_net → Vault → route chain
  (§11.4); (1) `curl` the tick twice back-to-back with a due block: `claimed ≥ 1` then
  `claimed: 0` — else the claim moves into a `security definer` RPC before anyone gets a
  reminder; (2) a real push on a **Central-time test account** at the right local minute;
  (3) a block dragged 90 min later re-arms; (4) an expired subscription prunes from a
  fresh row; (5) iPhone: install → enable → a reminder arrives; (6) a phone delete is not
  resurrected by the open desktop tab's next save; (7) a real prospect at 10:00 today
  appears white with no icon at the right local time; (8) the overlapped block shows
  segments and "−30m", the NOW card offers an afternoon slot, Accept places a dashed
  make-up that then reminds; (9) the appointment push arrives name-free at 9:55 local;
  (10) **tap two pushes in a row with PRIM already open — both land on Routine, no
  reload — and once with PRIM open on `/pricing`**; (11) the follow-up block lists the
  agent's stage selection oldest-first and a row opens the prospect; (12) move the
  prospect to Pending Decision after the meeting — the appointment stays on the timeline
  and the owed minutes stay; **(12b) with the app closed through an appointment, the
  `routine_day_v1` row gains the `appt` and `owed` records from the tick, and a checkbox
  ticked on the phone during that minute survives**; (13) next morning the yesterday
  line shows them once and retires on the first check; (14) the weekly line shows them;
  (15) `net._http_response` sizes confirm the tick transfers appointment rows, not
  blobs; (16) the 15-entry tab strip at 1280 px and on the phone.

## 13. Risks on record
1. Minute precision rests on pg_cron + pg_net + Vault + a production `CRON_SECRET`, all
   hand-configured; gate 0 and the raise-on-null SQL make misconfiguration loud.
2. `ignoreDuplicates` → RETURNING-only-inserted is [LIKELY]; gated, RPC fallback named.
3. Custom pointer drag is the repo's first touch/pointer interaction; the phone list is
   the fallback regardless.
4. Browser-detected timezone can be wrong for a traveling agent; the chip and manual
   mode are the recourse — and every appointment wall-clock is interpreted in it.
5. This spec makes `NAV_TABS` 15 entries (14 visible for non-Team agents); the strip is
   checked at 1280 px and on the phone at gate 16.
6. Block names are agent-authored; the editor hint discourages client names; `appt`
   blocks never reach a push by name regardless.
7. iPhone push depends on the manual install step; the strip is the only nudge.
8. `routine_settings_v1` is whole-object LWW; a stale tab can flip one toggle.
9. Tombstones grow the arrays between prunes (bounded: 7 days, ≤ 60 live blocks).
10. Derived appointment duration is assumed 30 min; attach exists for longer ones.
11. Two "oldest first" orderings (queue by last contact; `FollowupDueWidget` by cadence);
    the sheet header says "by last contact".
12. Prospect names on a screen agents may share — the existing PHI banner applies.
13. The seeding rule can still mis-select an unusual label — visible in Settings.
14. `composeDay` runs twice every 30 s on a few hundred prospects — O(n), memoized;
    measured in the live pass.
15. The Prospects tab and the daily email list stage-less and date-only appointments
    that the timeline hides — accepted; the sheet's secondary line explains the former.
16. The freeze records an appointment at the first compose (client or tick) after it
    starts; a cancellation after that minute is still counted, one before it is not.
    Realized minutes are refreshed by every tick, so a day the agent never opened
    converges on the true total by midnight.
17. `routine_day_write` is the only server write path into `routine_day_v1`; the
    client's merge keeps tick-appended ids, and the tick's `owed` refresh is rejected
    whenever the agent saved a decision after the tick's read (retried next minute).
    A client save that lands between the RPC's read and write inside Postgres is
    serialized by the row lock.
18. Every minute the tick transfers appointment rows, not blobs — egress is measured at
    gate 15; if `jsonb_array_elements` over a few hundred agents' arrays proves slow, a
    materialized per-user appointment index is the fallback.

## 14. Deferred (with the reason)
Multiple/per-weekday routines (one discipline is the point); today-only manual
overrides beyond the make-up offer; mobile Move up/down; day-bounds settings;
template append; Profile install strip; streaks/percentages (a look-back, not a
scoreboard); timezone on `agent_profile_v1`; quiet hours; cross-tab realtime; email
fallback; `pushServer` de-duplication; a11y pass; live names in the dial block
(restraint — revisit after usage); owed time rolling to the next day (operator: expires
and is counted); per-appointment duration on prospects; an "unconfirmed" style; a
proper open-by-id route for prospects.
