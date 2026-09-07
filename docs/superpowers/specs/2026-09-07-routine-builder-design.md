# Routine Builder — design

**Date:** 2026-09-07 · **Rev 2** (r1 adversarial review: 9 majors + 16 minors folded in;
six were found independently by two lenses). · **Operator decisions (Juan,
2026-09-07):** standalone blocks (no lead-data wiring) · permanent top-level view +
PRIM-authored starter templates · web-push reminders at block time · UI = building-block
palette (C) on a clock timeline (A) with per-block checkboxes (B) · scheduler trigger =
Supabase pg_cron every minute · **PWA manifest + iPhone install guidance in v1** (most
agents are on iPhone) · straight to all tiers, no soak · every day active by default. ·
**Provenance:** synthesized from a 12-agent design workflow (6 subsystem readers, 3
independent designs, 3 adversarial judges) and a 3-lens spec review; every file
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

**In:** the Routine view (desktop clock timeline + mobile step list), the block
palette, three starter templates + Blank, per-day checkbox/skip done-state, per-agent
timezone capture, the minute-level reminder scheduler (route + claim table + pg_cron
trigger), a PWA manifest with iOS install guidance, feature-flag registration, tests in
both lanes, and a live pass with hard gates.

**Out (v1), each a clean add later:** multiple named routines / per-weekday routine
selection; today-only overrides ("push the rest back 30 min"); per-block weekday
chips; side-by-side overlap rendering; block Duplicate; streaks and completion stats;
email fallback for reminders; cross-tab live sync (a refresh shows the other device's
edits); inactivity auto-pause pushes; a daily push cap; wiring blocks to PRIM data
(excluded by decision 1); **any edit to `src/app/api/reminders/route.js`** (the new
push helper is a deliberate copy, §6b.5).

## 3. Architecture in one paragraph

The client stores three per-user documents in `user_kv` (blocks, per-day done-state,
settings incl. IANA timezone). A CRON_SECRET-gated route `GET /api/routine/tick`,
called every minute by Supabase `pg_cron` + `pg_net`, loads every entitled agent's
blocks + settings + push subscriptions, converts each block's start and reminder minute
to UTC instants *in that agent's zone*, keeps only reminders due inside a narrow window
measured from the block's **start**, **claims** them atomically in a `routine_push_log`
table (PK `user_id, fire_key`) so overlapping ticks cannot double-send, sends web push
via the existing VAPID stack, and stamps the result. Done-state is derived per local
calendar day from the settings timezone and needs no midnight job. iPhone agents
receive push only when PRIM is installed to the Home Screen; v1 ships the manifest and
an honest in-app install strip.

## 4. Data model & storage

All three keys are **JSON documents in the `user_kv` `jsonb` column** — the client
`storage` adapter accepts/returns strings, but the cloud row holds a parsed
array/object, and a server read gets it already parsed (legacy rows may still hold a
stringified value; §6b.1). Keys are **registered in `APP_KEYS`** (`src/lib/storage.js`;
unregistered keys survive `purgeLocalMirror` and leak across accounts). The two arrays
are also added to **`MERGEABLE_KEYS`** — id-bearing records with `updatedAt`, so
`mergeStore.mjs` gives newest-wins per record. Its documented limitation
(`mergeStore.mjs:33-36`): a record *deleted* by another session is resurrected by this
session's next save until reload — and `ViewMount` keeps RoutineView mounted all day.
Therefore **nothing in these arrays is ever hard-deleted; deletes are tombstones**
that travel through newest-wins (§4a, §4b). Key literals live in `src/lib/routineKeys.mjs`
(no imports) so the server route and the client import the same strings.

### 4a. `routine_blocks_v1` — array

```json
{ "id": "blk_k3f9x2q", "name": "Dial block", "paletteId": "dial", "category": "dial",
  "startMin": 510, "durationMin": 120,
  "remind": { "enabled": true, "minutesBefore": 5 },
  "note": "", "deletedAt": null, "createdAt": "…", "updatedAt": "…" }
```
Minutes after local midnight, snapped to 5; duration 10–720 and **`startMin +
durationMin ≤ 1440`** (a block never crosses local midnight); ≤ 60 live blocks;
`updatedAt` stamped on every mutation. **Delete = set `deletedAt` and bump
`updatedAt`** (the tombstone wins the merge against a stale tab); tombstones older than
7 days are pruned on save. `sanitizeBlocks` (pure, `routineModel.mjs`): drops records
without a string id, dedupes by newest `updatedAt`, clamps/snaps, whitelists
`category` (exactly: `dial, followup, text, appt, review, admin, learn, break, custom`),
hides tombstoned blocks from the canvas and from the tick, sorts by `startMin`, and
runs **`resolveOverlaps`** — the single overlap resolver, exported once and used by the
sanitizer and by every client commit path: the later-`updatedAt` block moves to the
next free gap, deterministically. The canvas is single-lane by invariant, and the
**server re-sanitizes** what it reads (§6b.1) because merge-on-save writes the merged
array to the cloud without sanitizing.

### 4b. `routine_done_v1` — array, per LOCAL day

```json
{ "id": "2026-09-08|blk_k3f9x2q", "day": "2026-09-08", "blockId": "blk_k3f9x2q",
  "status": "done", "at": "…", "updatedAt": "…" }
```
`status` ∈ `done | skipped | cleared`. **Unchecking writes `cleared`** (a tombstone the
UI treats as unchecked) rather than deleting the record. Pruned on every save to the
last 7 local days. Written immediately, never debounced.

### 4c. `routine_settings_v1` — object, last-write-wins

```json
{ "version": 1, "timezone": "America/Chicago", "timezoneMode": "auto",
  "remindersEnabled": true, "defaultMinutesBefore": 5,
  "activeDays": [0,1,2,3,4,5,6], "dayStartMin": 360, "dayEndMin": 1260,
  "lastReplacedBackup": null }
```
`activeDays` defaults to every day (operator decision); chips in Settings turn days
off. One routine, repeating on each active day. `lastReplacedBackup` holds the
pre-Replace blocks for the 10-second Undo (§7e); nothing else is stored that no code
reads.

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
(`storage.js:385-399`), so a stale mirror would overwrite the server's ledger and
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
`localDayKey`, `localWeekday`, `localMinuteOfDay`, `zonedTimeToUtc(dayKey, minute,
tz)` via `Intl.DateTimeFormat(...).formatToParts` — no dependency. DST policy: spring
gap (02:30 on 2026-03-08) resolves forward; fall overlap resolves to the first
occurrence; **the offset-mismatch branch returns the first candidate (`utc1`)** — the
test asserts 02:30 NY → 07:30Z. An **invalid or missing timezone skips the agent's
reminders and surfaces "PRIM doesn't know your time zone" in the header chip** —
never a silent Eastern fallback, which would fire an hour early for Texas and
Wisconsin agents. The zone is part of the reminder's identity (`fire_key`, §6b.4), so
changing it mid-day re-arms that day's remaining reminders on the new clock.

## 6. Scheduler

### 6a. Trigger
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
Vercel is personal scope (Hobby) [LIKELY — personal scope + repo doc reference; not
provable from config]; Hobby crons are once-daily and **a sub-daily entry in
`vercel.json` fails the whole build** — none is committed. The route is cadence-
agnostic: a GitHub Actions `*/5` workflow is the documented fallback (reminders up to
5 min late) if pg_cron cannot be enabled.

### 6b. Route: `src/app/api/routine/tick/route.js`
`runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60`. Auth block copied
from `reminders/route.js:245-249` (401 when `CRON_SECRET` unset — fails closed).
Thin I/O around a pure core in `src/lib/routineTick.mjs` (clock injected, tested).
Constants there: `LOOKAHEAD_SEC=45`, `GRACE_MIN=10`, `COOLDOWN_MIN=15`,
`STALE_CLAIM_MIN=2`, `LOG_WINDOW_MIN=60`.

1. **Load**, one query each: `user_kv` rows for `routine_blocks_v1`,
   `routine_settings_v1`, `push_subscriptions_v1`; `routine_push_log` rows with
   `created_at ≥ now − 60 min` (covers cooldown, retry, and both local days' grace);
   `profiles` for those users with **the same 8-column select string as
   `email/send/route.js:146`** — `id, email, subscription_status, subscription_tier,
   trial_ends_at, is_complimentary, is_admin, past_due_since` (a superset of
   `GATE_FIELDS`; `email` and `subscription_tier` are required by
   `canAccessBetaFeature`'s allowlist and tier layers). Every read checks `error`; a
   tick that cannot see the log aborts 500 and sends nothing. **A `user_kv` `value`
   arrives parsed** (array/object); accept a legacy string with `typeof v === 'string'
   ? JSON.parse(v) : v` exactly as `storage.js` merge-on-save does; anything else →
   empty, counted `bad_shape`. Blocks and settings are then run through
   `sanitizeBlocks` / `sanitizeSettings` before `computeDue`.
2. **Per-agent skips, evaluated in this order, first match wins, counted once:**
   `not_entitled` (`canAccessBetaFeature('routine_builder', profile).canAccess !==
   true`; a missing profile is not entitled — the function returns an object, never a
   boolean), `disabled` (`remindersEnabled === false`), `bad_tz`, `no_subs` (skipped
   **without claiming**, so a device enabled later today still gets the rest).
3. **Candidates**: for today and the previous local day, for each live block with
   `remind.enabled` whose `localWeekday(day)` is in `activeDays`, compute instants:
   `startAt = zonedTimeToUtc(day, startMin, tz)`, `endAt = zonedTimeToUtc(day, startMin
   + durationMin, tz)`, `fireMin = max(0, startMin − minutesBefore)` (a lead that
   would cross midnight is clamped to 00:00 — copy comes from instants, so it still
   reads truthfully), `fireAt = zonedTimeToUtc(day, fireMin, tz)`. **Due iff `fireAt ≤
   now + 45 s` AND `now < startAt + 10 min` AND `now < endAt`.** Grace is measured from
   the block's start, so a lead of 5 fires at T−5 and, if the tick was late, still
   fires "started 4 min ago" at T+4; at T+11 it has aged out — **never fired, never
   stamped** — so an outage or a week away produces no storm. The previous-day pass
   exists for the grace tail of late-night blocks (a 23:58 block seen at 00:05).
   `fire_key = ${blockId}|${day}|${fireMin}|${tz}`. **Cooldown**: skip iff a log row
   exists for the same `block_id` with a *different* `fire_key`, status `claimed` or
   `sent`, and `created_at > now − 15 min` — this absorbs a block nudged a few minutes
   after its reminder went out. A row with the candidate's *own* `fire_key` falls
   through to steps 4 and 6.
4. **Claim before send:** `supa.from('routine_push_log').upsert(rows, {
   onConflict:'user_id,fire_key', ignoreDuplicates:true }).select('fire_key')`.
   postgrest-js 2.110 exposes `ignoreDuplicates` (verified in `node_modules`); PostgREST
   maps it to `INSERT … ON CONFLICT DO NOTHING RETURNING`, returning only the rows
   *this* invocation inserted [LIKELY — **hard-gated in the live pass**, §12].
   Overlapping ticks split the set. Because the key carries the local minute and the
   zone, a block dragged from 9:00 to 10:30 after its 8:55 reminder fired re-arms at
   10:25, and an ET→CT switch mid-morning re-arms the rest of the day on Central time.
5. **Send**: coalesce per agent per tick. Copy from instants: `fireAt ≤ now < startAt`
   → "Dial block starts in N min" (`N = round((startAt − now)/60000)`); `now ≥ startAt`
   → "Dial block started N min ago". Body "8:30–10:30 · then Break at 10:30"; `url:
   appUrl()+'/?view=routine'`; **`tag: 'routine-'+blockId`** (distinct per block —
   `sw.js` defaults every push to `prim-alert`, which would replace the previous one);
   `urgent:false`. Two blocks in one tick → one push "2 blocks starting now".
   `sendPush(subs, payload)` and `pruneDeadSubs(supa, userId, dead)` live in
   `src/lib/pushServer.js`, **copied (deliberately duplicated) from
   `reminders/route.js:26-55` and `379-386`** — that route is not edited; de-duplication
   is a follow-up. `pruneDeadSubs` **re-selects** the agent's `push_subscriptions_v1`
   row immediately before writing (never the step-1 snapshot, or a phone that enabled
   push this minute loses it), filters the 404/410 endpoints out of the fresh value,
   upserts, and **checks `error`** (counted `prune_failed`).
6. **Stamp** `sent` / `failed` (`error` ≤ 200 chars). **Bounded retry**, one CAS per
   candidate still inside grace: `.update({ status:'claimed', attempts:2 })
   .eq('user_id',uid).eq('fire_key',key).eq('attempts',1)` with **either**
   `.eq('status','failed')` **or** (`.eq('status','claimed')` and `created_at < now −
   2 min` — a tick that died after claiming, counted `stale_claimed`) `.select()`; send
   only when exactly one row returns. 4xx other than 404/410 (e.g. VAPID mismatch) is
   stamped with the code and not retried — one diagnosable log line.
7. **Housekeeping** at minute 7 of each hour: delete log rows older than 30 days.
   Response JSON counts every outcome (`due, claimed, sent, failed, retried,
   stale_claimed, skipped:{not_entitled, disabled, bad_tz, no_subs, cooldown,
   bad_shape, prune_failed}`) for pg_net / Vercel logs.

### 6c. Failure modes, on record
Block moved after its reminder fired → **re-arms at the new minute only if that minute
is ≥ 15 min after the fired row** (9:00→10:30 at 8:57 fires at 10:25); smaller moves
(9:00→9:15) are absorbed by cooldown — the agent already has a reminder for it. Block
deleted → tombstone wins the merge, absent from the due-set next tick. Timezone
changed → new keys, re-arms on the new clock. Expired subscription → pruned on 410
from a fresh row; all dead → `no_subs`. Two tabs → server sanitizes the merged array
(an overlap heals the same way the client heals it). Cron double-fire → PK claim. Cron
down an hour → only blocks that started in the last 10 minutes fire on resume. Tick
dies after claiming → re-claimed once after 2 min if still in grace. Agent away a week
→ nothing (aged out). Clock skew → server clock only; the client contributes an IANA
string and integers. VAPID env missing → tick returns `push_not_configured` and claims
nothing. Late-night block (23:55, 5 min) seen at 00:03 → `now ≥ endAt`, skipped;
spring-forward block at 02:30 → instants, not local minutes, so it is not "ended" early.

## 7. UI

### 7a. View & header
`src/components/views/RoutineView.jsx` — props `{ showToast }` (the repo has no global
toast; views receive it from `LeadTracker`, threaded down to Timeline, editor, and
mobile list). Owns: the three documents, `loaded` guard (the initial empty state must
never overwrite the cloud row), a 30-second clock tick that pauses on
`document.hidden`, the 400 ms debounced block save (drag commits are discrete;
renames are not), immediate done/settings saves, timezone capture, entitlement (§9),
and the layout switch. `RoutineHeader`: title, timezone chip, **Bell toggle =
`settings.remindersEnabled`** (account-wide, saved immediately; turning it ON on a
device with `isPushEnabled() === false` calls `enablePush()` first — if permission is
denied the flag still saves and the strip explains), settings gear →
`RoutineSettingsSheet` (timezone, default reminder lead, active-day chips, day bounds,
"Start over from a template"). The Bell reflects the account flag; **the strip, not the
Bell, reflects device status.**

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
browser settings"; `!isPushEnabled()` → "reminders off on this device" with an Enable
button; invalid timezone → "PRIM doesn't know your time zone".

### 7c. Timeline (desktop, `md:` and up) — `Timeline.jsx`, `TimelineBlock.jsx`
Geometry in `src/lib/routineLayout.mjs` (pure): `PX_PER_MIN=2`, `SNAP_MIN=5`, bounds =
`[min(dayStartMin, floorHour(earliest)), max(dayEndMin, ceilHour(latest end))]`,
default 06:00–21:00; `top=(startMin−boundsStart)·2`, `height=durationMin·2`. Hour
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
Interactive rules: move → snap, clamp to bounds, **slide to the nearest free gap** that
fits, else revert + toast "No room there — shrink it or move a neighbor"; resize →
clamp to the next block's start, never pushes a neighbor; palette drag-in shows a
ghost block at pointer time; palette click adds at the next free slot at/after now;
hovering empty time shows a "+ 10:15" pill → click opens the editor pre-filled.
Keyboard: ↑/↓ ±5 min (Shift ±15), Alt+↑/↓ duration, Enter edit, Delete → tombstone
(undo toast), Space toggle. **Every commit path then passes the array through
`sanitizeBlocks` (which includes `resolveOverlaps`) before save.**

### 7d. Palette — `src/lib/routinePalette.mjs`, `BlockPalette.jsx`
Every category has exactly one hex used for tint, stripe, and dot; the NowCard tile may
additionally render `bg-accent-gradient` for `appt` only.

| id | name | category · hex | min | why-line (hover) |
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
A template entry carries only `paletteId, name?, startMin, durationMin, note?,
remind?` — it may override `name`, `durationMin`, `note`, `remind` but never
`paletteId`; `instantiateTemplate` fills `id`, `category`, `createdAt`, `updatedAt`.
**Lunch** = `{ paletteId:'break', name:'Lunch', remind off }`; **Day wrap-up** =
`{ paletteId:'review', name:'Day wrap-up', remind on }`.

**New agent · week 1** (08:00 Morning review 30 · 08:30 Dial block 120 "Fresh leads
first. Aim for 40 dials." · 10:30 Break 15 · 10:45 Text blast + replies 30 · 11:15
Follow-up queue 45 · 12:00 Lunch 45 · 12:45 Learning 45 · 13:30 Dial block 120
"Callbacks + aged leads" · 15:30 Break 15 · 15:45 Follow-up queue 60 · 16:45 Apps &
underwriting 30 · 17:15 Day wrap-up 15 "Log every touch. Set tomorrow's top 3.").
**Prospecting day** (07:30 review · 08:00 dial · 10:00 break · 10:15 text · 10:45 dial
· 12:45 lunch · 13:30 follow-up 75 · 14:45 break · 15:00 dial · 17:00 admin 60 · 18:00
wrap-up). **Appointment day** (08:00 review "Confirm every appointment. Quotes
prepped." · 08:30 follow-up 60 · 09:30 webby 120 · 11:30 break · 11:45 admin 60 · 12:45
lunch · 13:30 webby 120 · 15:30 follow-up 60 · 16:30 text 30 · 17:00 wrap-up).
**Blank.** Minutes are a first cut; a test asserts every template is collision-free,
every `paletteId` exists, and no block crosses midnight. Empty state shows the four as
cards (span + block count). With a routine present, the menu offers **Replace**
(ConfirmDialog + 10-second Undo via `lastReplacedBackup`) or **Add these blocks**
(append, skips collisions, toasts the count). A template never overwrites without that
explicit confirmation.

### 7f. Editor & mobile
`BlockEditorSheet.jsx`: desktop popover anchored to the block (DateTimePicker's
portal/outside-click/Escape pattern), mobile `GlassModal sheet`. Fields: name (≤ 60),
palette/category, start, duration, reminder lead (off / 0 / 5 / 10 / 15 min), note
(≤ 200; hint "keep block names generic — they show in your notification tray").
**Mobile** (`md:hidden`, `MobileRoutineList.jsx`): the same NowCard sticky on top, an
ordered step list — 4 px category stripe, time column, title, Bell + time, a 28 px
checkbox on the right thumb; row tap → editor sheet; long-press → Skip today / Move
up / Move down / Delete; a slim rose "now" divider between rows; "+ Add block" FAB →
`PaletteSheet`. Both trees render and display-toggle at `md:` per repo convention.

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
- **`layout.js`: convert to `export async function generateMetadata()`** that reads
  `(await headers()).get('x-prim-role')` (the layout already awaits `headers()`;
  fallback `classifyHost`) and returns the existing title/description **plus**
  `manifest: '/manifest.webmanifest'`, `appleWebApp: { capable:true, statusBarStyle:
  'default', title:'PRIM' }`, `icons.apple` **only when role !== 'marketing'**. The
  static file itself is served on both hosts (nothing blocks a public asset); only the
  `<link>` is gated, which is what matters for install prompts. A test asserts the
  marketing role yields no `manifest` key.
- `public/manifest.webmanifest`: `name "PRIM"`, `short_name "PRIM"`, `start_url "/"`,
  `display "standalone"`, `background_color`/`theme_color` from the accent tokens,
  icons 192 and 512 PNG derived from the existing mark (`public/prim-mark.png`), plus
  a 180 px `apple-touch-icon`.
- No service-worker change: iOS uses the same `push` event; `enablePush()` already
  registers `/sw.js`.
- **Install strip** (NowCard reminder strip and Profile → Notifications): shown when
  iOS UA && `navigator.standalone === false` — "To get reminders on iPhone: tap Share
  → Add to Home Screen, then open PRIM from there and turn on notifications." iOS has
  no install-prompt API; guidance is the only path. Inside the installed app the
  existing Profile → Notifications toggle (or the header Bell, §7a) completes the flow.

## 9. Navigation, gating, rollout

- Tab: `src/lib/constants.js` `NAV_TABS` gets `{ id:'routine', label:'Routine',
  icon:'CalendarClock' }` after Overview; `LeadTracker.jsx` adds `CalendarClock` to the
  lucide import **and** the `ICONS` map (both, or the render throws); static import of
  `RoutineView`; `<ViewMount visible={view==='routine'} viewKey="routine"><RoutineView
  showToast={showToast} /></ViewMount>`. `ViewMount` keeps views mounted — the only
  timer is the 30 s tick, gated on visibility.
- Deep link: `LeadTracker` mount reads `?view=` (guarded) → `setView` when it is a
  `NAV_TABS` id — what a push click lands on when no PRIM tab is open (`sw.js` focuses
  an existing window and ignores the URL; accepted for v1).
- Flag: `featureFlags.js` `BETA_FEATURES.routine_builder = { name:'Routine Builder',
  requiredTier:'starter', publicGA:true }` — **all paid tiers from day one**;
  complimentary and admin included by the existing layers. The tick mirrors this check
  server-side (§6b.2) so non-entitled accounts never receive pushes.
- **Non-entitled UI**: the tab is always visible. `RoutineView` calls
  `useBetaFeature('routine_builder')`; while `loading` it renders the skeleton; when
  `canAccess === false` it renders the locked-card pattern `AgentSettingsPanel` uses for
  `post_sale_emails` (reason → copy; `no_subscription` / `tier_too_low` → upgrade CTA to
  `/pricing`) and performs **zero storage writes**. Entitled → full view.
- Announce via the `[announce]` merge-subject convention.

## 10. Pure modules (node lane)

`routineKeys.mjs` · `tz.mjs` · `routineModel.mjs` (`sanitizeBlocks`, `sanitizeDone`,
`sanitizeSettings`, `resolveOverlaps`, `applyTemplate`, `instantiateTemplate`,
`doneId`, `DEFAULT_SETTINGS`, `uid`) · `routinePalette.mjs` · `routineTemplates.mjs`
· `routineLayout.mjs` · `routineClock.mjs` (`localParts`, `nowState`,
`blockVisualState`, `formatTime`) · `routineTick.mjs` (`computeDue`, `buildPayloads`,
constants). Client glue: `routineStore.js` (setupChecklist.js pattern),
`usePointerDrag.js`, `useIsDark` (existing) / `useMediaQuery.js`. Server:
`pushServer.js`.

## 11. Operator config (Juan, before the live pass)

1. Supabase → Database → Extensions: enable **pg_cron** and **pg_net**.
2. Supabase → Vault: add secret `prim_cron_secret` = the value of Vercel's
   `CRON_SECRET` (same string; the tick route already accepts it).
3. Run `supabase/routine-push-log-migration.sql`, then `supabase/routine-tick-cron.sql`
   (SQL pasted here in chat, per your convention). The second file raises if the Vault
   secret is missing — that is by design.
4. **Prove the trigger path (live-pass gate 0)** — two minutes after step 3:
   `select status_code, left(content::text,120) from net._http_response order by id
   desc limit 3` must show `200` with the tick's JSON, and `select status from
   cron.job_run_details where jobid = (select jobid from cron.job where jobname =
   'prim-routine-tick') order by start_time desc limit 3` must show `succeeded`. A
   `401` here means the Vault secret and `CRON_SECRET` differ.
5. Confirm the manifest icons look right on an iPhone Home Screen.
Nothing else: no new Vercel env vars, no Stripe/Resend involvement.

## 12. Testing

- **Node lane** (`src/lib/*.test.mjs`, collected by `npm test`): `tz.test.mjs` (DST
  2026-03-08 / 2026-11-01 for NY, Chicago, Honolulu; previous-day math; invalid
  zones; a 23:55 block seen at 00:03 is ended; a 02:30 NY spring-forward block is not
  "ended" at 08:00Z); `routineModel.test.mjs` (every sanitizer, `startMin+durationMin
  ≤ 1440` clamp, deterministic `resolveOverlaps`, tombstone hidden and pruned, **stale
  array without a tombstone merged against remote with one → block stays deleted**,
  `cleared` renders unchecked, template never overwrites unless `replace`, append
  skips collisions, undo backup); `routineTemplates.test.mjs` (collision-free, valid
  palette ids, no midnight crossing); `routineLayout.test.mjs`;
  `routineClock.test.mjs` (all five NowCard phases, midnight rollover);
  `routineTick.test.mjs` — with lead 5: due at T−5, not at T−6, due at T+9 with
  "started 9 min ago", not at T+11 (aged out, unstamped); with lead 15: fires at
  T−15 and, if missed, "started 3 min ago" at T+3; 00:10 block with lead 15 fires at
  00:00 and says "starts in 10 min"; inactive weekday skipped; `remind.enabled=false`;
  `remindersEnabled=false`; `no_subs` skips **without** claiming; `bad_tz` + `no_subs`
  → `skipped.bad_tz===1 && skipped.no_subs===0`; `subscription_status:'canceled'`
  → `not_entitled`, zero claims; `is_complimentary` → entitled; ended block never
  fires; 9:00→9:15 move absorbed by cooldown, 9:00→10:30 re-arms; ET→CT at 8:50
  re-arms; `failed@attempt1` re-sent once and not a third time; stale `claimed` row
  re-claimed after 2 min; two overlapping blocks in the raw row → only healed
  positions fire; a `value` that is a JSON string and one that is an array both
  parse; coalescing; Wisconsin vs Florida same 8:30 block → different UTC instants.
- **UI lane** (`src/components/routine/*.test.jsx`, `src/components/views/
  RoutineView.test.jsx` — the vitest include glob): `RoutineView` (zero writes before
  `loaded`; zero writes when not entitled; template adoption; timezone capture),
  `NowCard` (every phase and every strip case from fixtures), `TimelineBlock`
  (checkbox toggles write exactly one done record; drag commit runs `sanitizeBlocks`),
  `BlockEditorSheet`, `MobileRoutineList`, and the `generateMetadata` marketing-role
  test.
- **Tripwires** in `sourceInvariants.test.mjs`: the tick route contains the
  `CRON_SECRET` fail-closed block and an `if (error)` after every select; its profile
  select string contains `subscription_tier`; `pushServer.js` contains `if (error)`
  after its select and its upsert; `sw.js` still reads `title/body/tag/url/urgent`; no
  sub-daily cron in `vercel.json`.
- **Mutation checks:** `GRACE_MIN` → 0 → boundary tests red; delete the claim filter →
  double-fire test red; drop the ended-block guard → red; drop `|tz` from `fire_key` →
  zone-change test red; drop the `.canAccess` property read → not-entitled test red;
  remove `activeDays` filter → weekday test red; make cooldown ignore `fire_key` →
  retry test red.
- **Live pass (hard gates, in order):** (0) the pg_cron → pg_net → Vault → route
  chain per §11.4; (1) `curl` the tick twice back-to-back with a due block: first
  `claimed ≥ 1`, second `claimed: 0` — if not, the RETURNING assumption is wrong and
  the claim moves into a small `security definer` RPC before anyone gets a reminder;
  (2) a real push arrives on a **Central-time test account** at the correct local
  minute; (3) a block dragged 90 min later after its reminder fired re-arms; (4) an
  expired subscription prunes from a fresh row without error; (5) iPhone: install to
  Home Screen → enable notifications → a reminder arrives; (6) mobile list + desktop
  timeline round-trip the same routine, including a delete made on the phone staying
  deleted on the still-open desktop tab.

## 13. Risks on record

1. Minute precision rests on pg_cron + pg_net + Vault, all hand-configured with no
   checked-in precedent; gate 0 and the raise-if-missing SQL make a misconfiguration
   loud rather than silent.
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

## 14. Deferred (with the reason)

Multiple/per-weekday routines (one routine is the locked scope); today-only overrides
(needs a per-day override layer — keep one source of truth in v1); streaks/stats
(motivating only after habit data exists; 7-day retention already supports it);
timezone on `agent_profile_v1` (promote when a second consumer needs it); quiet hours
(the routine itself is the quiet-hours model while push is only for blocks the agent
placed); cross-tab realtime (publication not enabled by any migration); email
fallback (would mail 10×/day); de-duplicating `pushServer.js` back into the reminders
route; a11y pass beyond focusable/keyboard-movable blocks.
