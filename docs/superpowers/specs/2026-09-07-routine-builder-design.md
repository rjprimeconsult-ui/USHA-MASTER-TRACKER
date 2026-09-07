# Routine Builder — design

**Date:** 2026-09-07 · **Operator decisions (Juan, 2026-09-07):** standalone blocks (no
lead-data wiring) · permanent top-level view + PRIM-authored starter templates · web-push
reminders at block time · UI = building-block palette (C) on a clock timeline (A) with
per-block checkboxes (B) · scheduler trigger = Supabase pg_cron every minute · **PWA
manifest + iPhone install guidance in v1** (most agents are on iPhone) · straight to all
tiers, no soak · every day active by default. · **Provenance:** synthesized from a
12-agent design workflow (6 subsystem readers, 3 independent designs, 3 adversarial
judges); every file reference below was opened by a reader or judge.

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
(excluded by decision 1); any change to `src/app/api/reminders/route.js`.

## 3. Architecture in one paragraph

The client stores three per-user documents in `user_kv` (blocks, per-day done-state,
settings incl. IANA timezone). A CRON_SECRET-gated route `GET /api/routine/tick`,
called every minute by Supabase `pg_cron` + `pg_net`, loads every entitled agent's
blocks + settings + push subscriptions, converts each block's reminder minute to a UTC
instant *in that agent's zone*, keeps only those due inside a narrow window, **claims**
them atomically in a `routine_push_log` table (PK `user_id, fire_key`) so overlapping
ticks cannot double-send, sends web push via the existing VAPID stack, and stamps the
result. Done-state is derived per local calendar day from the settings timezone and
needs no midnight job. iPhone agents receive push only when PRIM is installed to the
Home Screen; v1 ships the manifest and an honest in-app install strip.

## 4. Data model & storage

All three keys are JSON strings in `user_kv` via the `storage` adapter, **registered in
`APP_KEYS`** (`src/lib/storage.js`; unregistered keys survive `purgeLocalMirror` and
leak across accounts). The two arrays are also added to **`MERGEABLE_KEYS`** — they are
id-bearing records with `updatedAt`, so `mergeStore.mjs` gives newest-wins per record
and intentional-delete semantics for free (two tabs editing different blocks both
survive). Key literals live in `src/lib/routineKeys.mjs` (no imports) so the server
route and the client import the same strings.

### 4a. `routine_blocks_v1` — array

```json
{ "id": "blk_k3f9x2q", "name": "Dial block", "paletteId": "dial", "category": "dial",
  "startMin": 510, "durationMin": 120,
  "remind": { "enabled": true, "minutesBefore": 5 },
  "note": "", "createdAt": "…", "updatedAt": "…" }
```
`startMin`/`durationMin` are minutes after local midnight, snapped to 5; duration
10–720; ≤ 60 blocks; `updatedAt` stamped on every mutation. `sanitizeBlocks` drops bad
ids, dedupes by newest `updatedAt`, clamps/snaps, whitelists `category`, sorts by
`startMin`, and **resolves any overlap deterministically** (later-updated block moves to
the next free gap) — the canvas is single-lane by invariant.

### 4b. `routine_done_v1` — array, per LOCAL day

```json
{ "id": "2026-09-08|blk_k3f9x2q", "day": "2026-09-08", "blockId": "blk_k3f9x2q",
  "status": "done", "at": "…", "updatedAt": "…" }
```
`status` ∈ `done | skipped`. Unchecking deletes the record. Pruned on every save to
the last 7 local days. Written immediately, never debounced (a phone tick lands before
the phone goes back in the pocket).

### 4c. `routine_settings_v1` — object, last-write-wins

```json
{ "version": 1, "timezone": "America/Chicago", "timezoneMode": "auto",
  "remindersEnabled": true, "defaultMinutesBefore": 5,
  "activeDays": [0,1,2,3,4,5,6], "dayStartMin": 360, "dayEndMin": 1260,
  "seededFrom": null, "seededAt": null, "lastReplacedBackup": null }
```
`activeDays` defaults to every day (operator decision); chips in Settings turn days
off. The routine repeats on each active day; there is one routine.

### 4d. `routine_push_log` — Postgres table (server-only)

```sql
create table public.routine_push_log (
  user_id uuid not null, fire_key text not null, block_id text not null,
  local_day date not null, fire_at_utc timestamptz not null,
  status text not null default 'claimed',   -- claimed | sent | failed
  attempts int not null default 1, sent_at timestamptz, error text,
  created_at timestamptz not null default now(),
  primary key (user_id, fire_key));
create index on public.routine_push_log (created_at);
alter table public.routine_push_log enable row level security;  -- no policies: service role only
```
The idempotency ledger is a **table, deliberately not a `user_kv` key**: a key registered
in `APP_KEYS` is mirrored to localStorage and pushed back by `migrateLocalToCloud`
(`storage.js:385-399`), so a stale mirror would overwrite the server's ledger and
re-arm already-sent reminders (judge finding, fatal for the alternative).

## 5. Timezone

No agent timezone exists anywhere in PRIM today (`agent_profile_v1` has none;
`prospect.timezone` is a display string). Source of truth is
`routine_settings_v1.timezone` (IANA). Captured on first Routine open from
`Intl.DateTimeFormat().resolvedOptions().timeZone` (guarded `typeof window`), shown
as a short chip in the Routine header ("CT") beside the reminders toggle so a wrong
zone is visible without opening anything. `timezoneMode:'auto'` re-detects on each
mount and updates silently with a toast when it changes (agent traveled); `'manual'`
(short US list: Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii, plus
"Use device zone") is never overridden.

`src/lib/tz.mjs` (pure, `node --test`): `isValidTimeZone`, `offsetMinutesAt`,
`localDayKey`, `localWeekday`, `localMinuteOfDay`, `zonedTimeToUtc(dayKey, minute,
tz)` via `Intl.DateTimeFormat(...).formatToParts` — no dependency. DST policy: spring
gap (02:30 on 2026-03-08) resolves forward; fall overlap resolves to the first
occurrence. **The mismatch branch returns the first candidate (`utc1`)** — the design
draft's formula and its own test disagreed here (judge finding); the test asserts
02:30 NY → 07:30Z. An **invalid or missing timezone skips the agent's reminders and
surfaces "PRIM doesn't know your time zone" in the header chip** — never a silent
Eastern fallback, which would fire an hour early for Texas and Wisconsin agents.
Promoting the zone to `agent_profile_v1` (so the daily digest cron can use it) is a
follow-up, not v1.

## 6. Scheduler

### 6a. Trigger
`supabase/routine-tick-cron.sql` (operator runs by hand, §11):
```sql
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

1. Load in one query each: `user_kv` rows for `routine_blocks_v1`,
   `routine_settings_v1`, `push_subscriptions_v1`; `routine_push_log` rows with
   `created_at ≥ now−36h`; `profiles` for those users using **the same select as
   `email/send/route.js:146`** (`id, email, subscription_status, subscription_tier,
   trial_ends_at, is_complimentary, is_admin, past_due_since` — the `GATE_FIELDS` in
   `subscriptionAccess.mjs`). Every read checks `error`; a tick that cannot see the
   log aborts 500 and sends nothing.
2. Per agent, skip with a counted reason when: not entitled
   (`canAccessBetaFeature('routine_builder', profile)`), `remindersEnabled===false`,
   invalid tz (`bad_tz`), or no push subscriptions (`no_subs` — **without claiming**,
   so a device enabled later today still gets the rest).
3. For today and the previous local day (covers reminders just after midnight), for
   each block with `remind.enabled` whose weekday is in `activeDays`:
   `fireMin = max(0, startMin − minutesBefore)`; `fireAt = zonedTimeToUtc(day, fireMin,
   tz)`. Due iff `now − 10 min < fireAt ≤ now + 45 s`. **Older reminders age out —
   never fired, never stamped** — so an outage or a week away produces no storm.
   Skip if the block already ended (`nowLocalMin ≥ startMin + durationMin`). Skip
   (`cooldown`) if any log row for the same `block_id` was created in the last 15 min
   — absorbs a block edited mid-window.
4. **Claim before send:** `fire_key = ${blockId}|${day}|${fireMin}`;
   `supa.from('routine_push_log').upsert(rows, { onConflict:'user_id,fire_key',
   ignoreDuplicates:true }).select('fire_key')`. postgrest-js 2.110 exposes
   `ignoreDuplicates` (verified in `node_modules`); PostgREST maps it to `INSERT … ON
   CONFLICT DO NOTHING RETURNING`, which returns only the rows *this* invocation
   inserted [LIKELY — **hard-gated in the live pass**, §12]. Overlapping ticks split
   the set. Because `fire_key` carries the local minute, a block dragged from 9:00 to
   10:30 after its 8:55 reminder fired re-arms at 10:25.
5. Send: coalesce per agent per tick. One block → `{ title: 'Dial block starts in 5
   min', body: '8:30–10:30 · then Break at 10:30', url: appUrl()+'/?view=routine',
   tag: 'routine-'+blockId, urgent: false }`; if it already started (late within
   grace) the title says "started 3 min ago"; two blocks in the same tick → one push
   "2 blocks starting now". Distinct `tag` per block so consecutive reminders don't
   replace each other in the tray (`sw.js` defaults every push to `prim-alert`).
   `sendPush` + 404/410 pruning are lifted verbatim from `reminders/route.js:26-55,
   379-386` into `src/lib/pushServer.js`; the reminders route itself is untouched.
6. Stamp `sent`/`failed`. Bounded retry: a `failed` row with `attempts=1` still inside
   the grace window is re-claimed by a CAS update (`.eq('status','failed').eq('attempts',
   1)`), once. 4xx other than 404/410 (e.g. VAPID mismatch) is stamped with the code
   and not retried — one diagnosable log line, not silence.
7. Housekeeping at minute 7 of each hour: delete log rows older than 30 days.
   Response JSON counts every outcome (`due, claimed, sent, failed, skipped:{…}`) for
   pg_net/Vercel logs.

### 6c. Failure modes, on record
Block edited after firing → new key, fires at the new time. Block deleted → absent next
tick, old rows inert. Expired subscription → pruned on 410; all dead → `no_subs`. Two
tabs → server reads the merged array. Cron double-fire → PK claim. Cron down an hour →
only the last 10 minutes fire on resume. Agent away a week → nothing (aged out). Clock
skew → server clock only; the client contributes an IANA string and integers. VAPID env
missing → tick returns `push_not_configured` and claims nothing.

## 7. UI

### 7a. View & header
`src/components/views/RoutineView.jsx` owns: the three documents, `loaded` guard
(the initial empty state must never overwrite the cloud row), a 30-second clock tick
that pauses on `document.hidden`, the 400 ms debounced block save (drag commits are
discrete; renames are not), immediate done/settings saves, timezone capture, and the
layout switch. `RoutineHeader`: title, timezone chip, reminders toggle (Bell/BellOff),
settings gear → `RoutineSettingsSheet` (timezone, default reminder lead, active-day
chips, day bounds, "Start over from a template").

### 7b. NOW card — `src/components/routine/NowCard.jsx`
Sticky premium-card; category gradient tile left, primary action right, thin
`bg-accent-gradient` progress bar along the bottom during a block. Phases from
`nowState()` in `routineClock.mjs`:
- **Up first** (before the first block): "Morning review · starts 8:00 · reminder 7:55".
- **Now**: "NOW · 8:30–10:30 / Dial block / 1h 23m left · next Break 10:30" + a large
  Done checkbox; after checking, the card stays until the block ends showing
  "Done ✓ — next Break at 10:30".
- **Free until 10:45**: next block, its reminder time, "Start now" scrolls to it.
- **Running behind** (a past block neither done nor skipped; takes precedence): amber
  chip on the oldest such block with **Done / Skip today** — never auto-shifts anything
  (decision 1: no auto-completion).
- **Day done**: all blocks done/skipped, or past the last block.
A reminder strip below explains why a push will not arrive — "reminders off on this
device", "blocked in browser settings", or the iOS install strip (§8).

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
Rules: move → snap, clamp to bounds, **slide to the nearest free gap** that fits, else
revert + toast "No room there — shrink it or move a neighbor"; resize → clamp to the
next block's start, never pushes a neighbor; palette drag-in shows a ghost block at
pointer time; palette click adds at the next free slot at/after now; hovering empty
time shows a "+ 10:15" pill → click opens the editor pre-filled. Keyboard: ↑/↓ ±5 min
(Shift ±15), Alt+↑/↓ duration, Enter edit, Delete remove (undo toast), Space toggle.
Every commit path runs `resolveNoOverlap`.

### 7d. Palette — `src/lib/routinePalette.mjs`, `BlockPalette.jsx`
| id | name | category · hex | min | why-line (hover) |
|---|---|---|---|---|
| dial | Dial block | dial · #f43f5e | 120 | Protected outbound time. Phone only — no email, no CRM cleanup. |
| followup | Follow-up queue | followup · #f59e0b | 75 | Work the people who said "call me back". Oldest first. |
| text | Text blast + replies | text · #0ea5e9 | 30 | Send the blast, then answer every reply before you move on. |
| webby | Webby appointments | appt · accent gradient | 120 | Back-to-back webinar/Zoom presentations. Camera on, quotes ready. |
| inperson | In-person appointment | appt · accent gradient | 60 | Drive time not included — add a block for it. |
| review | Morning review | review · #6366f1 | 30 | Yesterday's misses, today's goals, who's warm. |
| admin | Apps & underwriting | admin · #64748b | 60 | Submit apps, chase underwriting, clear the paperwork pile. |
| learn | Learning | learn · #10b981 | 45 | Product training, a recorded call, a script drill. Compounds. |
| break | Break | break · #94a3b8 | 15 | Step away. The next block goes better. |
| custom | Make your own block | custom · #d946ef | 30 | Anything else your day needs. Name it, size it. |

Icons: PhoneCall, RotateCcw, MessageSquare, Video, MapPin, Sunrise, FileCheck,
GraduationCap, Coffee, Plus (lucide). Break defaults to no reminder.

### 7e. Templates — `src/lib/routineTemplates.mjs` (code constants, PRIM-authored)
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
**Blank.** Minutes are a first cut; a test asserts every template is collision-free
and every `paletteId` exists. Empty state shows the four as cards (span + block
count). With a routine present, the menu offers **Replace** (ConfirmDialog + 10-second
Undo via `lastReplacedBackup`) or **Add these blocks** (append, skips collisions, toasts
the count). A template never overwrites without that explicit confirmation.

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
dashed stripe.

## 8. iOS / PWA (in v1, operator decision)

Apple allows web push only from a site installed to the Home Screen (iOS 16.4+,
`display: standalone`). PRIM has no manifest today; `src/app/layout.js` exports
`metadata` (line 26) and `src/app/icon.svg` serves the mark. Add:
- `public/manifest.webmanifest`: `name "PRIM"`, `short_name "PRIM"`, `start_url
  "/?source=pwa"`, `display "standalone"`, `background_color`/`theme_color` from the
  accent tokens, icons 192 and 512 PNG (derived from the existing mark; `prim-mark.png`
  exists in `public/`) plus a 180 px `apple-touch-icon`.
- `layout.js` metadata: `manifest: '/manifest.webmanifest'`, `appleWebApp: { capable:
  true, statusBarStyle: 'default', title: 'PRIM' }`, `icons.apple`. No service-worker
  change: iOS uses the same `push` event; `enablePush()` already registers `/sw.js`.
- **Install strip** (in the NowCard reminder strip and in Profile → Notifications):
  shown when `iOS UA && navigator.standalone === false` — "To get reminders on
  iPhone: tap Share → Add to Home Screen, then open PRIM from there and turn on
  notifications." iOS has no install-prompt API; guidance is the only path. Inside
  the installed app the existing Profile → Notifications toggle completes the flow.
- The marketing host is excluded (`manifest` metadata only on the app layout path;
  `hostRouting.mjs` already separates them).

## 9. Navigation, gating, rollout

- Tab: `src/lib/constants.js` `NAV_TABS` gets `{ id:'routine', label:'Routine',
  icon:'CalendarClock' }` after Overview; `LeadTracker.jsx` adds `CalendarClock` to the
  lucide import **and** the `ICONS` map (both, or the render throws); static import of
  `RoutineView`; `<ViewMount visible={view==='routine'} viewKey="routine">`.
  `ViewMount` keeps views mounted — the only timer is the 30 s tick, gated on
  visibility.
- Deep link: `LeadTracker` mount reads `?view=` (guarded) → `setView` when it is a
  `NAV_TABS` id — this is what a push click lands on when no PRIM tab is open
  (`sw.js` focuses an existing window and ignores the URL; accepted for v1).
- Flag: `featureFlags.js` `BETA_FEATURES.routine_builder = { name:'Routine Builder',
  requiredTier:'starter', publicGA:true }` — **all paid tiers from day one** (operator:
  straight to GA); complimentary and admin included by the existing layers. The tick
  mirrors this check server-side so non-entitled accounts never receive pushes.
- Announce via the `[announce]` merge-subject convention.

## 10. Pure modules (node lane)

`routineKeys.mjs` · `tz.mjs` · `routineModel.mjs` (sanitizers, `resolveCollision`,
`applyTemplate`, `instantiateTemplate`, `doneId`, `DEFAULT_SETTINGS`, `uid`) ·
`routinePalette.mjs` · `routineTemplates.mjs` · `routineLayout.mjs` ·
`routineClock.mjs` (`localParts`, `nowState`, `blockVisualState`, `formatTime`) ·
`routineTick.mjs` (`computeDue`, `buildPayloads`, constants). Client glue:
`routineStore.js` (setupChecklist.js pattern), `usePointerDrag.js`, `useIsDark`
(existing) / `useMediaQuery.js`. Server: `pushServer.js`.

## 11. Operator config (Juan, before the live pass)

1. Supabase → Database → Extensions: enable **pg_cron** and **pg_net**.
2. Supabase → Vault: add secret `prim_cron_secret` = the value of Vercel's
   `CRON_SECRET` (same string; the tick route already accepts it).
3. Run `supabase/routine-push-log-migration.sql`, then `supabase/routine-tick-cron.sql`
   (SQL pasted here in chat, per your convention).
4. Confirm the manifest icons look right on an iPhone Home Screen.
Nothing else: no new Vercel env vars, no Stripe/Resend involvement.

## 12. Testing

- **Node lane:** `tz.test.mjs` (DST 2026-03-08 / 2026-11-01 for NY, Chicago, Honolulu;
  previous-day math; invalid zones); `routineModel.test.mjs` (every sanitizer,
  deterministic overlap healing, template never overwrites unless `replace`, append
  skips collisions, undo backup); `routineTemplates.test.mjs` (collision-free, valid
  palette ids, bounds); `routineLayout.test.mjs`; `routineClock.test.mjs` (all five
  NowCard phases, midnight rollover of `dayKey`); `routineTick.test.mjs` — fires at
  T−5, not T−6, fires at T+9 with "started" copy, not at T+11 (aged out, unstamped),
  inactive weekday skipped, `remind.enabled=false`, `remindersEnabled=false`, `no_subs`
  skips **without** claiming, ended block never fires, cooldown, coalescing, `bad_tz`
  skip, Wisconsin vs Florida same 8:30 block → different UTC instants.
- **UI lane:** `RoutineView` (load guard: zero writes before `loaded`; template
  adoption; timezone capture), `NowCard` (every phase from fixtures), `TimelineBlock`
  (checkbox toggles write exactly one done record; drag commit calls
  `resolveNoOverlap`), `BlockEditorSheet`, `MobileRoutineList`.
- **Tripwires** in `sourceInvariants.test.mjs`: the tick route contains the
  `CRON_SECRET` fail-closed block and an `if (error)` after every select; `sw.js`
  still reads `title/body/tag/url/urgent`; no sub-daily cron in `vercel.json`.
- **Mutation checks:** flip `GRACE` to 0 → boundary tests red; delete the claim
  filter → double-fire test red; drop the ended-block guard → red; typo the
  `fire_key` format → re-arm test red; remove `activeDays` filter → weekday test red.
- **Live pass (hard gates, in order):** (1) `curl` the tick twice back-to-back with a
  due block: first `claimed ≥ 1`, second `claimed: 0` — if not, the RETURNING
  assumption is wrong and the claim moves into a small `security definer` RPC before
  anyone gets a reminder; (2) a real push arrives on a **Central-time test account** at
  the correct local minute; (3) a block dragged later after its reminder fired re-arms;
  (4) an expired subscription prunes without error; (5) iPhone: install to Home
  Screen → enable notifications → a reminder arrives; (6) mobile list + desktop
  timeline round-trip the same routine.

## 13. Risks on record

1. Minute precision rests on pg_cron + pg_net + Vault, all hand-configured with no
   checked-in precedent; if skipped, the view ships with zero reminders and no visible
   error — hence live-pass gate (1) and the `push_not_configured` response counter.
2. `ignoreDuplicates` → RETURNING-only-inserted is [LIKELY]; gated, with the RPC
   fallback named.
3. Custom pointer drag is the repo's first touch/pointer interaction; real-device
   scroll-vs-drag behavior is verified in the live pass, and the mobile list is the
   fallback path regardless.
4. Browser-detected timezone is wrong for an agent on a desktop left in another state
   or traveling; the header chip makes it visible and manual mode pins it.
5. The tab strip is already 15 entries with no mobile variant; a 16th shifts
   everything right by one. Placement after Overview keeps Routine visible.
6. Block names are agent-authored and appear in the notification tray; the editor
   hint discourages client names (PHI-adjacent text on a lock screen).
7. iPhone push depends on the agent completing the manual install step; the strip
   is the only nudge available on iOS.
8. `routine_settings_v1` is whole-object LWW; a stale tab can flip one toggle. Visible
   in the header; accepted.

## 14. Deferred (with the reason)

Multiple/per-weekday routines (one routine is the locked scope); today-only overrides
(needs a per-day override layer — keep one source of truth in v1); streaks/stats
(motivating only after habit data exists; 7-day retention already supports it);
timezone on `agent_profile_v1` (promote when a second consumer needs it); quiet hours
(the routine itself is the quiet-hours model while push is only for blocks the agent
placed); cross-tab realtime (publication not enabled by any migration); email
fallback (would mail 10×/day); a11y pass beyond focusable/keyboard-movable blocks.
