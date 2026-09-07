# Routine Builder — design

**Date:** 2026-09-07 · **Rev 3** (r1: 9 majors + 16 minors; r2: 1 blocker + 5 majors +
14 minors — all folded in; the cap round). · **Operator decisions (Juan, 2026-09-07):**
standalone blocks (no lead-data wiring) · permanent top-level view + PRIM-authored
starter templates · web-push reminders at block time · UI = building-block palette
(C) on a clock timeline (A) with per-block checkboxes (B) · scheduler trigger =
Supabase pg_cron every minute · **PWA manifest + iPhone install guidance in v1** (most
agents are on iPhone) · straight to all tiers, no soak · every day active by default. ·
**Provenance:** synthesized from a 12-agent design workflow (6 subsystem readers, 3
independent designs, 3 adversarial judges) and two 3-lens spec reviews; every file
reference below was opened by a reader, judge, or reviewer.

## 1. Problem

Agents — especially new ones — have no structure inside PRIM for *how* to run a day.
The follow-up cadence engine (`src/lib/followupEngine.mjs`) answers "who do I chase
next"; nothing answers "what am I doing from 8:30 to 10:30." Routine is that surface:
an agent lays out their day as blocks, PRIM shows what is now and next, and nudges
them at block time. It is deliberately a standalone time-triggered surface — the
repo's own lesson (2026-07-28) is that time-of-day scheduling must not be bolted onto
the cadence engine.

## 2. Scope

**In:** the Routine view (desktop clock timeline + mobile step list, one render path),
the block palette, three starter templates + Blank, per-day checkbox/skip
done-state, per-agent timezone capture, the minute-level reminder scheduler (route +
claim table + pg_cron trigger, with one bounded retry), a PWA manifest with iOS
install guidance, feature-flag registration, tests in both lanes, and a live pass with
hard gates.

**Out (v1), each a clean add later — see §14 for reasons:** multiple named routines /
per-weekday routine selection; today-only overrides; per-block weekday chips;
side-by-side overlap rendering; block Duplicate; mobile Move up/down; day-bounds
settings; template "Add these blocks" append; a second install strip in Profile;
streaks and completion stats; email fallback; cross-tab live sync (a refresh shows the
other device's edits); inactivity auto-pause pushes; a daily push cap; wiring blocks to
PRIM data (excluded by decision 1); **any edit to `src/app/api/reminders/route.js`**.

## 3. Architecture in one paragraph

The client stores three per-user documents in `user_kv` (blocks, per-day done-state,
settings incl. IANA timezone). A CRON_SECRET-gated route `GET /api/routine/tick`,
called every minute by Supabase `pg_cron` + `pg_net`, loads every entitled agent's
blocks + settings + push subscriptions, resolves each block's start and reminder
minute to UTC instants *in that agent's zone*, keeps only reminders due inside a
narrow window measured from the block's **start**, **claims** them atomically in a
`routine_push_log` table (PK `user_id, fire_key`) so overlapping ticks cannot
double-send, sends web push via the existing VAPID stack, and stamps the result.
Done-state is derived per local calendar day from the settings timezone and needs no
midnight job. iPhone agents receive push only when PRIM is installed to the Home
Screen; v1 ships the manifest and an honest in-app install strip.

## 4. Data model & storage

All three keys are **JSON documents in the `user_kv` `jsonb` column** — the client
`storage` adapter accepts/returns strings, but the cloud row holds a parsed
array/object and a server read gets it already parsed (legacy rows may hold a
stringified value; §6b.1). Keys are **registered in `APP_KEYS`** (`src/lib/storage.js`;
unregistered keys survive `purgeLocalMirror` and leak across accounts). The two arrays
are also added to **`MERGEABLE_KEYS`** — id-bearing records with `updatedAt`, so
`mergeStore.mjs` gives newest-wins per record. Its documented limitation
(`mergeStore.mjs:34-36`): a record *deleted* by another session is resurrected by this
session's next save until reload — and `ViewMount` keeps RoutineView mounted all day.
Therefore **nothing in these arrays is ever hard-deleted; deletes are tombstones**
that travel through newest-wins **and are retained through every save** (§4a). What
tombstones guarantee: a delete made on one device is not resurrected in the cloud row
by another still-open device's next save. What they do not do: push the deletion into
that other device's in-memory state — it sees the change on refresh (cross-tab live
sync is out of scope). Key literals live in `src/lib/routineKeys.mjs` (no imports) so
the server route and the client import the same strings.

### 4a. `routine_blocks_v1` — array

```json
{ "id": "blk_k3f9x2q", "name": "Dial block", "paletteId": "dial", "category": "dial",
  "startMin": 510, "durationMin": 120,
  "remind": { "enabled": true, "minutesBefore": 5 },
  "note": "", "deletedAt": null, "createdAt": "…", "updatedAt": "…" }
```
Minutes after local midnight, snapped to 5; duration 10–720 and **`startMin +
durationMin ≤ 1440`** (a block never crosses local midnight); ≤ 60 **live** blocks;
`updatedAt` stamped on every mutation. **Delete = set `deletedAt` and bump
`updatedAt`.**

Two pure functions, `src/lib/routineModel.mjs`:
- **`sanitizeBlocks(blocks)` → the persistable array.** Drops records without a
  string id, dedupes by newest `updatedAt`, clamps/snaps numbers, whitelists
  `category` (exactly `dial, followup, text, appt, review, admin, learn, break,
  custom`), **retains tombstones** (validated like any record) and prunes only those
  with `deletedAt` older than 7 days, sorts by `startMin`, then runs `resolveOverlaps`
  over the **live** subset. Every client commit path and the server tick call this;
  it is what `setItem` receives, so tombstones reach `user_kv`.
- **`liveBlocks(blocks)` = `sanitizeBlocks(blocks).filter(b => !b.deletedAt)`** — the
  canvas, the mobile list, the NOW card, and `computeDue` read this. Tombstones
  occupy no time.

**`resolveOverlaps(live)`** — the single overlap resolver, one export, deterministic:
the later-`updatedAt` block moves to the next free gap at/after its start; **tie-break
on equal `updatedAt` (every template/append block shares a stamp): the greater `id`
moves.** No gap that fits before 1440 → the moving block is **shrunk** to the largest
free gap ≥ 10 min at/after its start; none → it is **tombstoned** and the client toasts
"No room for <name>". More than 60 live blocks after sanitizing → the newest-`createdAt`
extras are tombstoned. Each rule is pinned in `routineModel.test.mjs`.

### 4b. `routine_done_v1` — array, per LOCAL day

```json
{ "id": "2026-09-08|blk_k3f9x2q", "day": "2026-09-08", "blockId": "blk_k3f9x2q",
  "status": "done", "at": "…", "updatedAt": "…" }
```
`status` ∈ `done | skipped | cleared`. **Unchecking writes `cleared`** (a tombstone the
UI treats as unchecked) rather than deleting. Pruned on every save to the last 7 local
days. Written immediately, never debounced.

### 4c. `routine_settings_v1` — object, last-write-wins

```json
{ "version": 1, "timezone": "America/Chicago", "timezoneMode": "auto",
  "remindersEnabled": true, "defaultMinutesBefore": 5,
  "activeDays": [0,1,2,3,4,5,6], "lastReplacedBackup": null }
```
`activeDays` defaults to every day (operator decision); chips in Settings turn days
off. One routine, repeating on each active day. `lastReplacedBackup` holds the
pre-Replace blocks for the 10-second Undo (§7e). Canvas bounds are **derived** from the
blocks (§7c), not stored. **`sanitizeSettings`**: `activeDays` → unique ints 0–6, `[]`
allowed (routine paused; header shows "All days off"); `defaultMinutesBefore` → nearest
of {0, 5, 10, 15}; `timezoneMode` → `'auto'` unless exactly `'manual'`; `timezone` kept
verbatim (`isValidTimeZone` decides `bad_tz` at read time, and the chip shows what is
stored); `remindersEnabled` → boolean; unknown fields dropped.

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
The idempotency ledger is a **table, deliberately not a `user_kv` key**: a key in
`APP_KEYS` is mirrored to localStorage and pushed back by `migrateLocalToCloud`
(`storage.js:385-400`), so a stale mirror would overwrite the server's ledger and
re-arm already-sent reminders.

## 5. Timezone

No agent timezone exists anywhere in PRIM today (`agent_profile_v1` has none;
`prospect.timezone` is a display string). Source of truth is
`routine_settings_v1.timezone` (IANA). Captured on first Routine open from
`Intl.DateTimeFormat().resolvedOptions().timeZone` (guarded `typeof window`), shown
as a short chip in the Routine header ("CT") so a wrong zone is visible without
opening anything. `timezoneMode:'auto'` re-detects on each mount and updates silently
with a toast when it changes; `'manual'` (short US list: Eastern, Central, Mountain,
Arizona, Pacific, Alaska, Hawaii, plus "Use device zone") is never overridden.

`src/lib/tz.mjs` (pure, `node --test`): `isValidTimeZone`, `offsetMinutesAt`,
`localDayKey`, `localWeekday`, `localMinuteOfDay`, **`addDays(dayKey, n)`** (calendar
arithmetic on the `YYYY-MM-DD` string — the previous local day is `addDays(today, −1)`,
**never `now − 24 h`**, which lands on the wrong date for the hour after
spring-forward), and `zonedTimeToUtc(dayKey, minute, tz)` via
`Intl.DateTimeFormat(...).formatToParts` — no dependency. DST policy: spring gap
(02:30 on 2026-03-08) resolves forward; fall overlap resolves to the first occurrence;
**the offset-mismatch branch returns the first candidate (`utc1`)** — the test asserts
02:30 NY → 07:30Z. **Only a block's start and reminder minutes go through
`zonedTimeToUtc`; its end is `startAt + durationMin × 60 000`** (duration is a real
span, so a block spanning the spring gap cannot end before it starts). An **invalid or
missing timezone skips the agent's reminders and surfaces "PRIM doesn't know your time
zone" in the header chip** — never a silent Eastern fallback, which would fire an hour
early for Texas and Wisconsin agents. The zone is part of the reminder's identity
(`fire_key`, §6b.4), so changing it mid-day re-arms that day's remaining reminders on
the new clock.

## 6. Scheduler

### 6a. Trigger
`pg_cron` + `pg_net` is the trigger **by operator decision** (minute cadence, no
dependency on the Vercel plan; the repo record notes the plan changed after the
2026-07 outage [UNVERIFIED]). `vercel.json` keeps only the existing daily reminders
cron, and a tripwire asserts no sub-daily entry is ever added there (§12). The route
is cadence-agnostic; a GitHub Actions `*/5` workflow is the documented fallback if
pg_cron cannot be enabled.

`supabase/routine-tick-cron.sql` (operator runs by hand, §11) — fails loudly if the
Vault secret is missing, so a typo cannot produce a silent 401-every-minute:
```sql
do $$ begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'prim_cron_secret')
  then raise exception 'prim_cron_secret missing from Vault'; end if; end $$;
select cron.schedule('prim-routine-tick', '* * * * *', $$
  select net.http_get(url := 'https://app.primtracker.com/api/routine/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'prim_cron_secret')),
    timeout_milliseconds := 30000); $$);
```

### 6b. Route: `src/app/api/routine/tick/route.js`
`runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`. Auth block copied
from `reminders/route.js:245-249` (401 when `CRON_SECRET` unset — fails closed).
Thin I/O around a pure core in `src/lib/routineTick.mjs` (clock injected, tested).
Constants there: `LOOKAHEAD_SEC=45`, `GRACE_MIN=10`, `COOLDOWN_MIN=15`,
`STALE_CLAIM_MIN=2`, `LOG_WINDOW_MIN=60`.

0. **Push not configured**: if `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are unset,
   return `200 { skipped: 'push_not_configured' }` before any load.
1. **Load**, one query each: `user_kv` rows for `routine_blocks_v1`,
   `routine_settings_v1`, `push_subscriptions_v1`; `routine_push_log` rows with
   `created_at ≥ now − 60 min`, **indexed in memory by `user_id`** — `computeDue`
   receives only that agent's rows (block ids are client-generated 7-char `uid()`
   values and must never be compared across accounts); `profiles` for those users
   with **the same 8-column select string as `email/send/route.js:146`** — `id, email,
   subscription_status, subscription_tier, trial_ends_at, is_complimentary, is_admin,
   past_due_since` (a superset of `GATE_FIELDS`; `email` and `subscription_tier` are
   required by `canAccessBetaFeature`). Every read checks `error`; a tick that cannot
   see the log aborts 500 and sends nothing. **A `user_kv` `value` arrives parsed**;
   accept a legacy string with `typeof v === 'string' ? JSON.parse(v) : v` exactly as
   `storage.js` merge-on-save does; anything else → empty, counted `bad_shape`. Blocks
   and settings then pass through `sanitizeBlocks` / `sanitizeSettings`; the tick
   works on `liveBlocks`.
2. **Per-agent skips, evaluated in this order, first match wins, counted once:**
   `not_entitled` (`canAccessBetaFeature('routine_builder', profile).canAccess !==
   true`; a missing profile is not entitled — the function returns an object, never a
   boolean), `disabled` (`remindersEnabled === false`), `bad_tz`, `no_subs` (skipped
   **without claiming**, so a device enabled later today still gets the rest).
3. **Candidates**: for `today = localDayKey(now, tz)` and `addDays(today, −1)`, for
   each live block with `remind.enabled` whose `localWeekday(day)` is in
   `activeDays`, compute instants: `startAt = zonedTimeToUtc(day, startMin, tz)`,
   **`endAt = startAt + durationMin × 60 000`**, `fireMin = max(0, startMin −
   minutesBefore)` (a lead that would cross midnight is clamped to 00:00 — copy comes
   from instants, so it still reads truthfully), `fireAt = zonedTimeToUtc(day,
   fireMin, tz)`. **Due iff `fireAt ≤ now + 45 s` AND `now < startAt + 10 min` AND `now
   < endAt`.** Grace is measured from the block's start: with lead 5 it fires at T−5
   and, if the tick was late, still fires "started 4 min ago" at T+4; at T+11 it has
   aged out — **never fired, never stamped** — so an outage or a week away produces no
   storm. The previous-day pass exists for the grace tail of late-night blocks (a
   23:58 block seen at 00:05). `fire_key = ${blockId}|${day}|${fireMin}|${tz}`.
   **Cooldown, measured on fire instants (not row age):** skip iff a row exists for
   the same `(user_id, block_id)` with a *different* `fire_key`, status `claimed` or
   `sent`, and **`|candidate.fireAt − row.fire_at_utc| ≤ 15 min` (inclusive)** — this
   *absorbs* a block nudged a few minutes either way after its reminder went out, and
   is stable across ticks. A row with the candidate's *own* `fire_key` falls through
   to steps 4 and 6.
4. **Claim before send:** `supa.from('routine_push_log').upsert(rows, {
   onConflict:'user_id,fire_key', ignoreDuplicates:true }).select('fire_key')`.
   postgrest-js 2.110 sets `Prefer: resolution=ignore-duplicates` (verified in
   `node_modules`); PostgREST maps it to `INSERT … ON CONFLICT DO NOTHING RETURNING`,
   returning only the rows *this* invocation inserted [LIKELY — **hard-gated in the
   live pass**, §12]. Overlapping ticks split the set. Because the key carries the
   local minute and the zone, a block dragged from 9:00 to 10:30 after its 8:55
   reminder fired re-arms at 10:25, and an ET→CT switch mid-morning re-arms the rest
   of the day on Central time.
5. **Send.** Copy from instants: `fireAt ≤ now < startAt` → "Dial block starts in N
   min" (`N = round((startAt − now)/60000)`); `now ≥ startAt` → "Dial block started N
   min ago". Body "8:30–10:30 · then Break at 10:30"; `url: appUrl()+'/?view=routine'`;
   **`tag: 'routine-'+blockId`** (distinct per block — `sw.js` defaults every push to
   `prim-alert`, which would replace the previous one); `urgent:false`. **Coalescing:**
   only candidates sharing the same phase (both pre-start or both started) *and* the
   same `fireMin` become one push ("2 blocks starting now"), tag `'routine-' +
   sortedBlockIds.join('+')`; otherwise they send separately. A coalesced send's
   outcome is stamped identically on every `fire_key` it covered.
   `src/lib/pushServer.js` is **derived from `reminders/route.js:26-55` and
   `379-386`** (that route is not edited) with one required difference: **`sendPush(subs,
   payload)` returns `{ sentCount, dead, failures: [{ endpoint, statusCode, message }]
   }`** instead of swallowing errors — the tick cannot stamp what it cannot see.
   `pruneDeadSubs(supa, userId, dead)` **re-selects** the agent's
   `push_subscriptions_v1` row immediately before writing (never the step-1 snapshot,
   or a phone that enabled push this minute loses it), filters the 404/410 endpoints
   out of the fresh value, upserts, and **checks `error`** (counted `prune_failed`).
6. **Stamp.** `sentCount ≥ 1` → `sent`. All sends failed with retryable causes (no
   status code, 5xx, 429, 408) → `failed`, `attempts` stays 1 (eligible for the single
   retry). Any non-retryable 4xx other than 404/410 (e.g. 403 VAPID mismatch), or every
   subscription dead after pruning → `failed` with `attempts: 2` and `error` = the code
   / `'all_subs_dead'` — **never retried**, one diagnosable log line. **Bounded retry**,
   one CAS per candidate still inside grace: `.update({ status:'claimed', attempts:2
   }).eq('user_id',uid).eq('fire_key',key).eq('attempts',1)` with **either**
   `.eq('status','failed')` **or** (`.eq('status','claimed')` and `created_at < now − 2
   min` — a tick that died after claiming, counted `stale_claimed`) `.select()`; send
   only when exactly one row returns.
7. **Housekeeping** at minute 7 of each hour: delete log rows older than 30 days.
   Response JSON counts every outcome (`due, claimed, sent, failed, retried,
   stale_claimed, skipped:{not_entitled, disabled, bad_tz, no_subs, cooldown,
   bad_shape, prune_failed}`) for pg_net / Vercel logs.

### 6c. Failure modes, on record (all worked with lead 5, reminder fired at 8:55)
Block moved 9:00→10:30 at 8:57 → new `fireAt` 10:25, |10:25 − 8:55| = 90 min → re-arms.
Moved 9:00→9:15 → new `fireAt` 9:10, |9:10 − 8:55| = 15 → **absorbed** (the agent
already has a reminder for it). Moved earlier 9:00→8:50 → `fireAt` 8:45, |8:45 − 8:55|
= 10 → absorbed. Zone changed ET→CT at 8:50 → key changes, 13:25Z − 12:25Z = 60 min →
re-arms on Central. Block deleted → tombstone wins the merge, absent from
`liveBlocks` next tick. Expired subscription → pruned on 410 from a fresh row; all dead
→ `no_subs`. Two tabs → server sanitizes the merged array (an overlap heals the same
way the client heals it). Cron double-fire → PK claim. Cron down an hour → only blocks
that started in the last 10 minutes fire on resume. Tick dies after claiming →
re-claimed once after 2 min if still in grace. Agent away a week → nothing (aged
out). Clock skew → server clock only; the client contributes an IANA string and
integers. VAPID env missing → step 0. Late-night block (23:55, 5 min) seen at 00:03 →
`now ≥ endAt`, skipped. Spring-forward: a 02:30 NY block of 30 min on 2026-03-08 →
`fireAt` 07:25Z, `startAt` 07:30Z, `endAt` 08:00Z — due at 07:25Z with "starts in 5
min", not ended at 07:29Z. A push whose every send fails with 5xx → retried once next
tick; a 403 → stamped, never retried.

## 7. UI

### 7a. View & header
`src/components/views/RoutineView.jsx` — props `{ showToast }` (the repo has no global
toast; views receive it from `LeadTracker`, threaded down to Timeline, editor, and
mobile list). Owns: the three documents, `loaded` guard (the initial empty state must
never overwrite the cloud row), a 30-second clock tick that pauses on
`document.hidden`, the 400 ms debounced block save (drag commits are discrete;
renames are not), immediate done/settings saves, timezone capture, entitlement (§9),
**`devicePushOn` state** (populated by `await isPushEnabled()` — it is async — on
mount, after `enablePush()` resolves, and on `visibilitychange`), and **one render
path**: `useMediaQuery('(min-width: 768px)')` (new `src/lib/useMediaQuery.js`, guarded
for `typeof window`) renders **either** `<Timeline/>` **or** `<MobileRoutineList/>`
below a shared `<NowCard/>`, so the clock, the drag hook, and the done-write path
mount exactly once (no component in the repo dual-renders trees; `md:` is used only
for grid columns). `RoutineHeader`: title, timezone chip, **Bell toggle =
`settings.remindersEnabled`** (account-wide, saved immediately; turning it ON while
`devicePushOn === false` calls `enablePush()` first — if permission is denied the flag
still saves and the strip explains), settings gear → `RoutineSettingsSheet` (timezone,
default reminder lead, active-day chips, "Start over from a template"). The Bell
reflects the account flag; **the strip, not the Bell, reflects device status.**

### 7b. NOW card — `src/components/routine/NowCard.jsx`
Sticky premium-card; category tile left (gradient for `appt`, hex tint otherwise),
primary action right, thin `bg-accent-gradient` progress bar along the bottom during
a block. Phases from `nowState()` in `routineClock.mjs`:
- **Up first** (before the first block): "Morning review · starts 8:00 · reminder 7:55".
- **Now**: "NOW · 8:30–10:30 / Dial block / 1h 23m left · next Break 10:30" + a large
  Done checkbox; after checking, the card stays until the block ends showing
  "Done ✓ — next Break at 10:30".
- **Free until 10:45**: next block, its reminder time, "Start now" scrolls to it.
- **Running behind** (a past block neither done nor skipped; takes precedence): amber
  chip on the oldest such block with **Done / Skip today** — never auto-shifts anything
  (decision 1: no auto-completion).
- **Day done**: all blocks done/skipped, or past the last block.
**Reminder strip**, cases in priority order, first match shown: `remindersEnabled ===
false` → "Reminders are off" (Bell turns them on); iOS && `navigator.standalone ===
false` → the install strip (§8); `Notification.permission === 'denied'` → "blocked in
browser settings"; `devicePushOn === false` → "reminders off on this device" with an
Enable button; invalid timezone → "PRIM doesn't know your time zone"; `activeDays`
empty → "All days off".

### 7c. Timeline (desktop) — `Timeline.jsx`, `TimelineBlock.jsx`
Geometry in `src/lib/routineLayout.mjs` (pure): `PX_PER_MIN=2`, `SNAP_MIN=5`,
constants `DEFAULT_START=360`, `DEFAULT_END=1260`; bounds = `[min(DEFAULT_START,
floorHour(earliest)), max(DEFAULT_END, ceilHour(latest end))]` — derived from the
blocks, never stored. `top=(startMin−boundsStart)·2`, `height=durationMin·2`. Hour
gutter, dashed half-hour rules, a 2 px rose now-line with a time label, auto-scroll on
mount so now sits a third of the way down. Block: `role="button" tabIndex=0` (not
`<button>`, so the global active-scale does not shrink it mid-drag), left category
stripe, inline `background: hex+'1F'` (light) / `hex+'33'` (dark via `useIsDark`) —
**inline hex on purpose**: `globals.css` remaps only indigo/amber/emerald/rose
backgrounds in `.dark`; sky/violet/fuchsia utility classes would break. Row 1 checkbox
(24 px hit area, emerald when checked, spring scale) + title + category icon; row 2
(height ≥ 44 px) time range + Bell + reminder time. 6 px bottom resize handle.

Drag/resize: `src/lib/usePointerDrag.js` — pointer events + `setPointerCapture`, 4 px
threshold before a move starts (plain click still opens the editor), Escape cancels,
touch-capable, ~70 lines, **no new dependency**. The repo has no DnD library; framer
drag inside a scroll container fights auto-scroll and leaves transform residue.
Interactive rules (on `liveBlocks`): move → snap, clamp to bounds, **slide to the
nearest free gap** that fits, else revert + toast "No room there — shrink it or move a
neighbor"; resize → clamp to the next block's start, never pushes a neighbor; palette
drag-in shows a ghost block at pointer time; palette click adds at the next free slot
≥ the block's default duration at/after now, **else toast "No room today", no insert**;
**click empty time to add** (locked decision 4) — hovering empty column shows a
"+ 10:15" pill, click opens the editor pre-filled. Keyboard: ↑/↓ ±5 min (Shift ±15),
Alt+↑/↓ duration, Enter edit, Delete → tombstone (undo toast), Space toggle. **Every
commit path then passes the full array through `sanitizeBlocks` (tombstones retained,
`resolveOverlaps` on the live subset) before save.**

### 7d. Palette — `src/lib/routinePalette.mjs`, `BlockPalette.jsx`
Every category has exactly one hex used for tint, stripe, and dot; the NowCard tile may
additionally render `bg-accent-gradient` for `appt` only. `defaultMin` is the default
duration.

| id | name | category · hex | defaultMin | why-line (hover) |
|---|---|---|---|---|
| dial | Dial block | dial · #f43f5e | 120 | Protected outbound time. Phone only — no email, no CRM cleanup. |
| followup | Follow-up queue | followup · #f59e0b | 75 | Work the people who said "call me back". Oldest first. |
| text | Text blast + replies | text · #0ea5e9 | 30 | Send the blast, then answer every reply before you move on. |
| webby | Webby appointments | appt · #8b5cf6 | 120 | Back-to-back webinar/Zoom presentations. Camera on, quotes ready. |
| inperson | In-person appointment | appt · #8b5cf6 | 60 | Drive time not included — add a block for it. |
| review | Morning review | review · #6366f1 | 30 | Yesterday's misses, today's goals, who's warm. |
| admin | Apps & underwriting | admin · #64748b | 60 | Submit apps, chase underwriting, clear the paperwork pile. |
| learn | Learning | learn · #10b981 | 45 | Product training, a recorded call, a script drill. Compounds. |
| break | Break | break · #94a3b8 | 15 | Step away. The next block goes better. |
| custom | Make your own block | custom · #d946ef | 30 | Anything else your day needs. Name it, size it. |

Icons: PhoneCall, RotateCcw, MessageSquare, Video, MapPin, Sunrise, FileCheck,
GraduationCap, Coffee, Plus (lucide). Break defaults to no reminder.

### 7e. Templates — `src/lib/routineTemplates.mjs` (code constants, PRIM-authored)
A template entry carries only `paletteId, name?, startMin, durationMin?, note?,
remind?` — it may override `name`, `durationMin`, `note`, `remind` but never
`paletteId`; **an unlisted `durationMin` uses the palette `defaultMin`**;
`instantiateTemplate` fills `id`, `category`, `createdAt`, `updatedAt`. Two shared
constants: **Lunch** = `{ paletteId:'break', name:'Lunch', durationMin:45, remind off
}`; **Day wrap-up** = `{ paletteId:'review', name:'Day wrap-up', durationMin:15,
remind on }`.

**New agent · week 1** (08:00 Morning review 30 · 08:30 Dial block 120 "Fresh leads
first. Aim for 40 dials." · 10:30 Break 15 · 10:45 Text blast + replies 30 · 11:15
Follow-up queue 45 · 12:00 Lunch · 12:45 Learning 45 · 13:30 Dial block 120
"Callbacks + aged leads" · 15:30 Break 15 · 15:45 Follow-up queue 60 · 16:45 Apps &
underwriting 30 · 17:15 Day wrap-up "Log every touch. Set tomorrow's top 3.").
**Prospecting day** (07:30 review · 08:00 dial · 10:00 break · 10:15 text · 10:45 dial
· 12:45 Lunch · 13:30 follow-up 75 · 14:45 break · 15:00 dial · 17:00 admin 60 · 18:00
Day wrap-up). **Appointment day** (08:00 review "Confirm every appointment. Quotes
prepped." · 08:30 follow-up 60 · 09:30 webby · 11:30 break · 11:45 admin 60 · 12:45
Lunch · 13:30 webby · 15:30 follow-up 60 · 16:30 text · 17:00 Day wrap-up). **Blank.**
With Lunch at 45 both days remain collision-free (12:45 + 45 = 13:30 in each). Minutes
are a first cut; a test asserts every template is collision-free, every `paletteId`
exists, and no block crosses midnight. Empty state shows the four as cards (span +
block count). With a routine present, the menu offers **Replace** (ConfirmDialog +
10-second Undo via `lastReplacedBackup`). A template never overwrites without that
explicit confirmation.

### 7f. Editor & mobile
`BlockEditorSheet.jsx`: desktop popover anchored to the block (DateTimePicker's
portal/outside-click/Escape pattern), mobile `GlassModal sheet`. Fields: name (≤ 60),
palette/category, start, duration, reminder lead (off / 0 / 5 / 10 / 15 min), note
(≤ 200; hint "keep block names generic — they show in your notification tray").
**Mobile** (`MobileRoutineList.jsx`, rendered instead of the timeline below 768 px):
the shared NowCard sticky on top, an ordered step list — 4 px category stripe, time
column, title, Bell + time, a 28 px checkbox on the right thumb; row tap → editor
sheet (start time is changed there); long-press → Skip today / Delete; a slim rose
"now" divider between rows; "+ Add block" FAB → `PaletteSheet`.

### 7g. Done-state
Per local day, per block, derived from `settings.timezone` at read time — no midnight
job; the 30 s tick recomputes `dayKey` and yesterday's marks simply stop being
today's. Visual states from `blockVisualState()` (tested): future/unchecked normal;
future/done checked+faded (did it early); current gets a subtle accent ring; past/done
checked+faded; past/unchecked full opacity with an amber dot ("Unchecked"); skipped
dashed stripe; `cleared` renders exactly as unchecked.

## 8. iOS / PWA (in v1, operator decision)

Apple allows web push only from a site installed to the Home Screen (iOS 16.4+,
`display: standalone`). PRIM has no manifest today. There is **one root layout serving
both hosts** with a static `metadata` export (`src/app/layout.js:26`), so host-scoping
requires:
- **`src/lib/appMetadata.mjs`: pure `buildAppMetadata(role)`** returns the existing
  title/description and, **only when `role !== 'marketing'`**, adds `manifest:
  '/manifest.webmanifest'`, `appleWebApp: { capable:true, statusBarStyle:'default',
  title:'PRIM' }`, `icons: { apple: '/apple-touch-icon.png' }`. **`layout.js` converts
  the static export to `export async function generateMetadata()`** that resolves the
  role from `(await headers()).get('x-prim-role')` (fallback `classifyHost`, as the
  layout already does) and returns `buildAppMetadata(role)`. Tested in the node lane
  (`appMetadata.test.mjs`: marketing → no `manifest` key; app → all three present) —
  `layout.js` itself imports `next/font` and CSS and cannot be loaded by `node --test`.
  The static file is served on both hosts (nothing blocks a public asset); only the
  `<link>` is gated, which is what matters for install prompts.
- `public/manifest.webmanifest`: `name "PRIM"`, `short_name "PRIM"`, `start_url "/"`,
  `display "standalone"`, `theme_color "#6366f1"`, `background_color "#ffffff"`, icons
  `/icons/prim-192.png` and `/icons/prim-512.png`. Plus `public/apple-touch-icon.png`
  (180 px). **Generated once** from `public/prim-mark.png` with a throwaway script
  using `sharp` from `node_modules` (present as a Next.js image dependency
  [LIKELY]; not added to `package.json`; if absent, any one-off resize tool — the
  three PNGs are committed, the script is not).
- No service-worker change: iOS uses the same `push` event; `enablePush()` already
  registers `/sw.js`.
- **Install strip** (NowCard reminder strip only): shown when iOS UA &&
  `navigator.standalone === false` — "To get reminders on iPhone: tap Share → Add to
  Home Screen, then open PRIM from there and turn on notifications." iOS has no
  install-prompt API; guidance is the only path. Inside the installed app the header
  Bell (§7a) or the existing Profile → Notifications toggle completes the flow.

## 9. Navigation, gating, rollout

- Tab: `src/lib/constants.js` `NAV_TABS` gets `{ id:'routine', label:'Routine',
  icon:'CalendarClock' }` after Overview; `LeadTracker.jsx` adds `CalendarClock` to the
  lucide import **and** the `ICONS` map (both, or the render throws); static import of
  `RoutineView`; `<ViewMount visible={view==='routine'} viewKey="routine"><RoutineView
  showToast={showToast} /></ViewMount>`. `ViewMount` keeps views mounted — the only
  timer is the 30 s tick, gated on visibility.
- Deep link: `LeadTracker` mount reads `?view=` (guarded) → `setView` only when the id
  is in **the filtered `NAV_TABS` list rendered for this user** (the same list the
  tab bar maps — `team` is hidden for non-Team agents). This is what a push click
  lands on when no PRIM tab is open (`sw.js` focuses an existing window and ignores the
  URL; accepted for v1).
- Flag: `featureFlags.js` `BETA_FEATURES.routine_builder = { name:'Routine Builder',
  requiredTier:'starter', publicGA:true }` — **all paid tiers from day one**;
  complimentary and admin included by the existing layers. The tick mirrors this check
  server-side (§6b.2) so non-entitled accounts never receive pushes.
- **Non-entitled UI**: the tab is always visible. `RoutineView` calls
  `useBetaFeature('routine_builder')`; while `loading` it renders the skeleton; when
  `canAccess === false` it renders the locked-card pattern `AgentSettingsPanel.jsx:343-357`
  uses for `post_sale_emails` (reason → copy; `no_subscription` / `tier_too_low` →
  upgrade CTA to `/pricing`) and performs **zero storage writes**. Entitled → full view.
- Announce via the `[announce]` merge-subject convention.

## 10. Pure modules (node lane)

`routineKeys.mjs` · `tz.mjs` · `routineModel.mjs` (`sanitizeBlocks`, `liveBlocks`,
`resolveOverlaps`, `sanitizeDone`, `sanitizeSettings`, `applyTemplate`,
`instantiateTemplate`, `doneId`, `DEFAULT_SETTINGS`, `uid`) · `routinePalette.mjs` ·
`routineTemplates.mjs` · `routineLayout.mjs` · `routineClock.mjs` (`localParts`,
`nowState`, `blockVisualState`, `formatTime`) · `routineTick.mjs` (`computeDue`,
`buildPayloads`, constants) · `appMetadata.mjs`. Client glue: `routineStore.js`
(setupChecklist.js pattern), `usePointerDrag.js`, `useMediaQuery.js`, `useIsDark`
(existing). Server: `pushServer.js`.

## 11. Operator config (Juan, before the live pass)

0. **Vercel → Project → Settings → Environment Variables (Production): confirm
   `CRON_SECRET` exists.** The production env pull on record did not include it. If
   absent, add one (32+ random characters) and redeploy — the tick route fails closed
   without it.
1. Supabase → Database → Extensions: enable **pg_cron** and **pg_net**.
2. Supabase → Vault: add secret `prim_cron_secret` = **the same value** as Vercel's
   `CRON_SECRET`.
3. Run `supabase/routine-push-log-migration.sql`, then `supabase/routine-tick-cron.sql`
   (SQL pasted here in chat, per your convention). The second file raises if the Vault
   secret is missing — that is by design.
4. **Prove the trigger path (live-pass gate 0)** — two minutes after step 3:
   `select status_code, left(content::text,120) from net._http_response order by id
   desc limit 3` must show `200` with the tick's JSON, and `select status from
   cron.job_run_details where jobid = (select jobid from cron.job where jobname =
   'prim-routine-tick') order by start_time desc limit 3` must show `succeeded`. A
   `401` means the Vault secret and `CRON_SECRET` differ **or `CRON_SECRET` is unset in
   production** (step 0).
5. Confirm the manifest icons look right on an iPhone Home Screen.
Nothing else: no new Vercel env vars beyond step 0, no Stripe/Resend involvement.

## 12. Testing

- **Node lane** (`src/lib/*.test.mjs`, collected by `npm test`): `tz.test.mjs` (DST
  2026-03-08 / 2026-11-01 for NY, Chicago, Honolulu; `addDays`: 2026-03-09 00:05 NY →
  previous day 2026-03-08, 2026-11-02 → 2026-11-01; invalid zones);
  `routineModel.test.mjs` (every sanitizer rule in §4a/§4c, `startMin+durationMin ≤
  1440`, `resolveOverlaps` incl. equal-`updatedAt` tie-break, shrink-to-gap, tombstone
  when nothing fits, >60 cap; **`sanitizeBlocks` keeps a fresh tombstone, `liveBlocks`
  hides it, an 8-day-old tombstone is pruned; a stale array without the tombstone
  merged against remote with one → block stays deleted**; `cleared` renders
  unchecked; template never overwrites unless `replace`; undo backup);
  `routineTemplates.test.mjs` (collision-free with Lunch 45, valid palette ids, no
  midnight crossing); `routineLayout.test.mjs`; `routineClock.test.mjs` (all five
  NowCard phases, midnight rollover); `appMetadata.test.mjs`; `routineTick.test.mjs`
  — with lead 5: due at T−5, not at T−6, due at T+9 with "started 9 min ago", not at
  T+11 (aged out, unstamped); with lead 15: fires at T−15 and, if missed, "started 3
  min ago" at T+3; 00:10 block with lead 15 fires at 00:00 and says "starts in 10
  min"; **02:30 NY 30-min block on 2026-03-08 → `fireAt` 07:25Z, `startAt` 07:30Z,
  `endAt` 08:00Z, due at 07:25Z, not ended at 07:29Z; 01:30 NY 60-min block on
  2026-11-01 → `startAt` 05:30Z, `endAt` 06:30Z**; a 23:55 block seen at 00:03 is
  ended; inactive weekday skipped; `remind.enabled=false`; `remindersEnabled=false`;
  `no_subs` skips **without** claiming; `bad_tz` + `no_subs` → `skipped.bad_tz===1 &&
  skipped.no_subs===0`; `subscription_status:'canceled'` → `not_entitled`, zero
  claims; `is_complimentary` → entitled; **9:00→9:15 absorbed, 9:00→8:50 absorbed,
  9:00→10:30 re-arms, ET→CT at 8:50 re-arms** (cooldown on instants); another agent's
  log row with the same `block_id` has no effect; `failed@attempt1` re-sent once and
  not a third time; a 403 stamped `attempts:2` never retried; stale `claimed` row
  re-claimed after 2 min; two overlapping blocks in the raw row → only healed
  positions fire; one pre-start + one started candidate in the same tick → two pushes,
  two tags; a `value` that is a JSON string and one that is an array both parse;
  Wisconsin vs Florida same 8:30 block → different UTC instants.
- **UI lane** (`src/components/routine/*.test.jsx`, `src/components/views/
  RoutineView.test.jsx` — the vitest include glob): `RoutineView` (zero writes before
  `loaded`; zero writes when not entitled; template adoption; timezone capture;
  exactly one of Timeline/MobileRoutineList mounted per viewport), `NowCard` (every
  phase and every strip case from fixtures), `TimelineBlock` (checkbox toggles write
  exactly one done record; drag commit runs `sanitizeBlocks`), `BlockEditorSheet`,
  `MobileRoutineList`.
- **Tripwires** in `sourceInvariants.test.mjs`: the tick route contains the
  `CRON_SECRET` fail-closed block and an `if (error)` after every select; its profile
  select string contains `subscription_tier`; `pushServer.js` contains `if (error)`
  after its select and its upsert; `sw.js` still reads `title/body/tag/url/urgent`; **no
  sub-daily cron in `vercel.json`**.
- **Mutation checks:** `GRACE_MIN` → 0 → boundary tests red; delete the claim filter →
  double-fire test red; drop the ended-block guard → red; drop `|tz` from `fire_key` →
  zone-change test red; drop the `.canAccess` property read → not-entitled test red;
  remove `activeDays` filter → weekday test red; measure cooldown on `created_at`
  instead of `fire_at_utc` → absorb test red; make `liveBlocks` return tombstones →
  deleted-block-fires test red; compute `endAt` via `zonedTimeToUtc` → spring-forward
  test red.
- **Live pass (hard gates, in order):** (0) the pg_cron → pg_net → Vault → route
  chain per §11.4; (1) `curl` the tick twice back-to-back with a due block: first
  `claimed ≥ 1`, second `claimed: 0` — if not, the RETURNING assumption is wrong and
  the claim moves into a small `security definer` RPC before anyone gets a reminder;
  (2) a real push arrives on a **Central-time test account** at the correct local
  minute; (3) a block dragged 90 min later after its reminder fired re-arms; (4) an
  expired subscription prunes from a fresh row without error; (5) iPhone: install to
  Home Screen → enable notifications → a reminder arrives; (6) mobile list + desktop
  timeline round-trip the same routine, and **a delete made on the phone is not
  resurrected in the cloud row by the still-open desktop tab's next save** (read
  `user_kv` / refresh the phone) and disappears from the desktop on refresh.

## 13. Risks on record

1. Minute precision rests on pg_cron + pg_net + Vault + a production `CRON_SECRET`,
   all hand-configured with no checked-in precedent; gate 0 and the raise-if-missing
   SQL make a misconfiguration loud rather than silent.
2. `ignoreDuplicates` → RETURNING-only-inserted is [LIKELY]; gated, with the RPC
   fallback named.
3. Custom pointer drag is the repo's first touch/pointer interaction; real-device
   scroll-vs-drag behavior is verified in the live pass, and the mobile list is the
   fallback path regardless.
4. Browser-detected timezone is wrong for an agent on a desktop left in another state
   or traveling; the header chip makes it visible and manual mode pins it.
5. `NAV_TABS` is already 14 entries (13 visible for non-Team agents); a 15th shifts
   everything right by one. Placement after Overview keeps Routine visible.
6. Block names are agent-authored and appear in the notification tray; the editor
   hint discourages client names (PHI-adjacent text on a lock screen).
7. iPhone push depends on the agent completing the manual install step; the strip
   is the only nudge available on iOS.
8. `routine_settings_v1` is whole-object LWW; a stale tab can flip one toggle. Visible
   in the header; accepted.
9. Tombstones make the arrays grow between prunes (bounded: 7 days, ≤ 60 live blocks).
10. Coalescing by identical phase + `fireMin` means two blocks starting one minute
    apart produce two pushes; accepted — merging them would misstate one block's time.

## 14. Deferred (with the reason)

Multiple/per-weekday routines (one routine is the locked scope); today-only overrides
(needs a per-day override layer — keep one source of truth in v1); mobile Move
up/down (the row-tap editor already changes start time; a swap rule would be a second
path into `resolveOverlaps`); day-bounds settings (bounds auto-derive from the
blocks); template "Add these blocks" append (Replace + confirm satisfies decision 2;
append adds a collision-skipping path with its own tests); a second install strip in
Profile → Notifications (the NowCard strip is the nudge; Profile's existing toggle
works once installed); streaks/stats (motivating only after habit data exists; 7-day
retention already supports it); timezone on `agent_profile_v1` (promote when a second
consumer needs it); quiet hours (the routine itself is the quiet-hours model while
push is only for blocks the agent placed); cross-tab realtime (publication not
enabled by any migration); email fallback (would mail 10×/day); de-duplicating
`pushServer.js` back into the reminders route; a11y pass beyond focusable/
keyboard-movable blocks.
