# Routine Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Routine tab — one fixed daily routine on a clock timeline, today's Prospects appointments laid over it, displaced-time accounting, make-up offers, name-free push reminders from a Supabase minute tick, and a PWA manifest — exactly as specified in `docs/superpowers/specs/2026-09-07-routine-builder-design.md` (rev 10, commit `5be10a3`).

**Architecture:** Three new `user_kv` documents (`routine_blocks_v1`, `routine_day_v1`, `routine_settings_v1`) plus read-only use of `prospects_v1` / `prospect_settings_v1`. All logic lives in pure `src/lib/*.mjs` modules under `node --test`; the same `todaysAppointments()` / `composeDay()` run in the browser (RoutineView, every 30 s) and in `/api/routine/tick` (pg_cron every minute). The tick writes single per-day records through an atomic SQL function (`routine_day_write`) and reads appointment rows through another (`routine_appt_rows`); it never touches the `user_kv` row directly. Push copy is name-free by construction and pinned by tripwires.

**Tech Stack:** Next.js 16 (app router, `src/app`), React 19, Tailwind v4 (class-based dark via `.dark`), framer-motion, lucide-react 1.8, Supabase (`@supabase/supabase-js` 2.110.8, service role in routes), `web-push` 3.6.7, Node 24 `node --test` for `src/lib/*.test.mjs`, Vitest 4 + Testing Library (jsdom) for `src/**/*.test.jsx`, `sharp` 0.34.5 (transitive, one-off icon script).

---

## Ground rules for every task

1. **The spec wins.** Every task cites the spec sections it implements. When this plan and the spec disagree, follow the spec and note the discrepancy in the commit message.
2. **Two test lanes, never mixed.** Pure logic → `src/lib/<name>.mjs` + `src/lib/<name>.test.mjs`, run with `npm test` (plain Node: no `@/` alias, no JSX, no `.js` imports that pull React/Next). Components → `src/components/**/<Name>.test.jsx`, run with `npm run test:ui` (Vitest, jsdom, `@/` alias works). `.mjs` modules import each other with the explicit `.mjs` extension and relative paths (`./tz.mjs`).
3. **Storage contract.** `storage.getItem(key)` is async and returns a JSON **string** or `null`; `storage.setItem(key, value)` is async and takes a **string** (`JSON.stringify`). Both keys of arrays must have an `id` on every record (merge-on-save returns `null` otherwise → plain write).
4. **supabase-js never rejects a failed query** — it resolves `{ data, error }`. Every read and every write in the tick route checks `error`.
5. **Prospect names, stages, and `appt`-block names never enter a push payload.** Tripwires pin it; do not weaken them.
6. **Never bare `Date.parse` an `appointmentTime`** (zone-less `YYYY-MM-DDTHH:mm`). Only `parseAppointmentTime` may call `Date.parse`, and only for a zoned ISO.
7. **Commit after every green step** with the exact message given. Never `git checkout --` over uncommitted work. Before each task: `git status --short` must be clean.
8. **Baselines before Task 0 (verified 2026-09-14):** `npm test` → 754 pass / 0 fail; `npm run test:ui` → 99 pass (10 files); `npm run lint` → 0 errors (213 warnings — warnings are the repo's accepted React-Compiler backlog; **0 errors is the gate**, never chase the warning count). Every task ends with the same three commands green and the new counts recorded in the commit message.
8b. **Server-TZ reruns on this Windows machine:** the Git Bash tool strips `TZ`, so `TZ=UTC node --test …` silently runs in the host zone. Use PowerShell: `$env:TZ='America/Chicago'; node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"; node --test src/lib/tz.test.mjs src/lib/routineLive.test.mjs src/lib/routineTick.test.mjs` — and read the printed zone before trusting the run.
9. Repo root (run every command from here): `C:\Users\juant\OneDrive\Desktop\AI TREJO\CPA TRACKER FODLER\USHA-MASTER-TRACKER`. Branch: `feature/routine-builder`.

## File structure

**New pure modules (`src/lib/`)** — one responsibility each, all node-tested:

| File | Responsibility |
|---|---|
| `routineKeys.mjs` | Key literals only. No imports. |
| `tz.mjs` | IANA zone math: `isValidTimeZone`, `offsetMinutesAt`, `localDayKey`, `localMinuteOfDay`, `localWeekday`, `addDays`, `daysBetween`, `zonedTimeToUtc`. |
| `routinePalette.mjs` | The 10 palette entries (hex, defaults, why-lines). |
| `routineTemplates.mjs` | Starter "Agent day" + Blank. |
| `routineModel.mjs` | `uid`, `sanitizeBlocks`, `liveBlocks`, `resolveOverlaps`, `sanitizeDay`, `sanitizeSettings`, `DEFAULT_SETTINGS`, `seedFollowupStages`, `instantiateTemplate`, `applyTemplate`. |
| `routineLayout.mjs` | Pixel geometry constants + bounds. |
| `routineClock.mjs` | `formatTime`, `formatRange`, `formatMinutes`, `blockVisualState`, `nowState`. |
| `routineLive.mjs` | `parseAppointmentTime`, `todaysAppointments`, `followupQueue`, `composeDay`, `findMakeupSlot`, `reconcileOwed`, `applyOwedDecision`, `offerState`, `dayNotDone`, `yesterdayMiss`, `weeklyNotDone`. |
| `routineTick.mjs` | `tickAgent` (candidates → due → freeze records), `buildPayload`, constants. |
| `appMetadata.mjs` | `buildAppMetadata(role)`. |

**New client modules (`src/lib/`)**: `routineStore.js` (load/save the three keys, `setupChecklist.js` pattern), `useMediaQuery.js`, `usePointerDrag.js`.

**New server**: `src/lib/pushServer.js`, `src/app/api/routine/tick/route.js`.

**New SQL (`supabase/`)**: `routine-push-log-migration.sql`, `routine-appt-rows-function.sql`, `routine-day-write-function.sql`, `routine-tick-cron.sql`.

**New components (`src/components/routine/`)**: `NowCard.jsx`, `Timeline.jsx`, `TimelineBlock.jsx`, `AppointmentCard.jsx`, `BlockPalette.jsx`, `BlockEditorSheet.jsx`, `FollowupSheet.jsx`, `MobileRoutineList.jsx`, `RoutineHeader.jsx`, `RoutineSettingsSheet.jsx`, `WeeklyLookback.jsx`, `TemplatePicker.jsx`. View: `src/components/views/RoutineView.jsx`.

**Modified**: `src/lib/storage.js` (APP_KEYS, MERGEABLE_KEYS, migrate exclusion), `src/lib/featureFlags.js` (+ test), `src/lib/constants.js` (NAV_TABS), `src/components/LeadTracker.jsx` (icon, ViewMount, deep link, `openProspect`), `src/components/views/ProspectsView.jsx` (two props), `src/app/layout.js` (`generateMetadata`), `public/sw.js`, `src/lib/sourceInvariants.test.mjs` (tripwires), `public/manifest.webmanifest` + icons (new).

---

## Task 0: Keys, storage registration, feature flag

**Spec:** §4 (APP_KEYS / MERGEABLE_KEYS), §9 (flag).

**Files:**
- Create: `src/lib/routineKeys.mjs`
- Modify: `src/lib/storage.js:176-183` (MERGEABLE_KEYS), `src/lib/storage.js:353-384` (APP_KEYS), `src/lib/storage.js:385-401` (migrateLocalToCloud)
- Modify: `src/lib/featureFlags.js:61-101` (BETA_FEATURES)
- Test: `src/lib/featureFlags.test.mjs` (exists — append), `src/lib/routineKeys.test.mjs` (new)

- [x] **Step 1: Write `src/lib/routineKeys.mjs`**

```js
// Routine Builder — key literals. NO imports (this file is loaded by the tick
// route, the client store, and node --test alike).
//
// prospects_v1 / prospect_settings_v1 are duplicated from the module-private
// consts at src/components/LeadTracker.jsx:148-149 on purpose: the routine
// READS those keys and never writes them (spec §4e).
export const ROUTINE_BLOCKS_KEY = 'routine_blocks_v1';
export const ROUTINE_DAY_KEY = 'routine_day_v1';
export const ROUTINE_SETTINGS_KEY = 'routine_settings_v1';
export const PUSH_SUBS_KEY = 'push_subscriptions_v1';
export const PROSPECTS_KEY = 'prospects_v1';
export const PROSPECT_SETTINGS_KEY = 'prospect_settings_v1';
export const ROUTINE_FEATURE_KEY = 'routine_builder';
export const ROUTINE_KEYS = [ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY];
```

- [x] **Step 2: Write the failing tests**

`src/lib/routineKeys.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTINE_KEYS, ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY, ROUTINE_FEATURE_KEY } from './routineKeys.mjs';

const storageSrc = readFileSync(new URL('./storage.js', import.meta.url), 'utf8');

test('every routine key is registered in APP_KEYS (purgeLocalMirror isolation — spec §4)', () => {
  // Slice the APP_KEYS literal (closes with `];`) — a whole-file search would also
  // match MERGEABLE_KEYS / MIGRATE_SKIP and miss a removal from APP_KEYS.
  const start = storageSrc.indexOf('const APP_KEYS');
  const appKeys = storageSrc.slice(start, storageSrc.indexOf('];', start));
  for (const k of ROUTINE_KEYS) assert.ok(appKeys.includes(`'${k}'`), `${k} missing from storage.js APP_KEYS`);
});

test('the two routine arrays are MERGEABLE_KEYS; settings is not', () => {
  const block = storageSrc.slice(storageSrc.indexOf('const MERGEABLE_KEYS'), storageSrc.indexOf(']);', storageSrc.indexOf('const MERGEABLE_KEYS')));
  assert.ok(block.includes(`'${ROUTINE_BLOCKS_KEY}'`));
  assert.ok(block.includes(`'${ROUTINE_DAY_KEY}'`));
  assert.ok(!block.includes(`'${ROUTINE_SETTINGS_KEY}'`));
});

test('migrateLocalToCloud never overwrites routine_day_v1 (tick-written records live there)', () => {
  // Assert the Set literal AND the guard inside the function body (the declaration alone proves nothing).
  const decl = storageSrc.slice(storageSrc.indexOf('const MIGRATE_SKIP'), storageSrc.indexOf(')', storageSrc.indexOf('const MIGRATE_SKIP')) + 1);
  assert.ok(decl.includes(`'${ROUTINE_DAY_KEY}'`), 'MIGRATE_SKIP must list routine_day_v1');
  const fnStart = storageSrc.indexOf('export async function migrateLocalToCloud');
  const fn = storageSrc.slice(fnStart, storageSrc.indexOf('\n}', fnStart));
  assert.ok(fn.includes('MIGRATE_SKIP.has(key)'), 'the loop must skip MIGRATE_SKIP keys');
});

import { BETA_FEATURES } from './featureFlags.js';
test('ROUTINE_FEATURE_KEY names a registered feature', () => { assert.ok(BETA_FEATURES[ROUTINE_FEATURE_KEY], 'routine_builder must exist in BETA_FEATURES'); });
```

Append to `src/lib/featureFlags.test.mjs` in the file's own style (it has a `P()` profile helper and asserts `reason` codes — read it first): one test `'routine_builder: starter tier, publicGA, every access reason'` asserting `requiredTier === 'starter'`, `publicGA === true`, and `canAccessBetaFeature('routine_builder', …)` → admin `{ true, 'admin' }`, complimentary `{ true, 'complimentary' }`, canceled `{ false, 'no_subscription' }`, `null` profile `{ false, 'not_signed_in' }`, active starter `{ true, 'tier_match' }`, active with `subscription_tier: null` `{ false, 'tier_too_low' }`. (As committed in `89a48ae`.)

- [x] **Step 3: Run to verify they fail**

Run: `npm test 2>&1 | findstr /C:"fail"` → expect `fail 4` (or more).

- [x] **Step 4: Register the keys and the flag**

In `src/lib/storage.js`:
- MERGEABLE_KEYS (L176-183): add `'routine_blocks_v1',` and `'routine_day_v1',` after `'activities_v1',`.
- APP_KEYS (L353-384): append before the closing `];`:
```js
  // Routine Builder (spec 2026-09-07 §4). MUST be registered: unregistered
  // keys survive purgeLocalMirror and leak across accounts.
  'routine_blocks_v1', 'routine_day_v1', 'routine_settings_v1',
```
- `migrateLocalToCloud` (L385-401): add a skip set so a stale local mirror can never clobber records the server tick appended. **Plan deviation, record in the commit message and propose for spec rev 11 §4:** the spec does not ask for this; it is a defensive guard (the client only writes `routine_day_v1` when signed in, so the local mirror is never the sole copy — skipping it in the one-shot migration loses nothing).
```js
// Keys the SERVER also writes (routine tick → routine_day_write RPC). A stale
// local mirror must never overwrite them wholesale.
const MIGRATE_SKIP = new Set(['routine_day_v1']);
export async function migrateLocalToCloud() {
  if (!cloudActive()) throw new Error('Not signed in');
  let migrated = 0, skipped = 0;
  for (const key of APP_KEYS) {
    if (MIGRATE_SKIP.has(key)) { skipped++; continue; }
    ...
```
(keep the rest of the function unchanged).

In `src/lib/featureFlags.js` BETA_FEATURES, append after `outreach_emails`:
```js
  // Routine Builder — spec docs/superpowers/specs/2026-09-07-routine-builder-design.md §9.
  // All paid tiers day one (operator decision); complimentary + admin pass via the
  // existing layers above.
  routine_builder: {
    name: 'Routine Builder',
    requiredTier: 'starter',
    betaAllowlist: [],
    publicGA: true,
  },
```

- [x] **Step 5: Run to verify they pass**

Run: `npm test` → expect `pass 759` (754 + 5), `fail 0`.

- [x] **Step 6: Commit**

```bash
git add src/lib/routineKeys.mjs src/lib/routineKeys.test.mjs src/lib/storage.js src/lib/featureFlags.js src/lib/featureFlags.test.mjs
git commit -m "feat(routine): register keys, mergeable arrays, migrate skip, routine_builder flag (spec §4, §9)"
```

---

## Task 1: `tz.mjs` — zone math

**Spec:** §5 (all of it), §6c DST pins.

**Files:**
- Create: `src/lib/tz.mjs`, `src/lib/tz.test.mjs`

- [x] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, offsetMinutesAt, localDayKey, localMinuteOfDay, localWeekday, addDays, daysBetween, zonedTimeToUtc } from './tz.mjs';

const NY = 'America/New_York';
const CHI = 'America/Chicago';
const Z = (s) => Date.parse(s);

test('isValidTimeZone', () => {
  assert.equal(isValidTimeZone(NY), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
});

test('offsetMinutesAt returns local − UTC (NY = −240 EDT, −300 EST)', () => {
  assert.equal(offsetMinutesAt(Z('2026-07-01T12:00:00Z'), NY), -240);
  assert.equal(offsetMinutesAt(Z('2026-01-15T12:00:00Z'), NY), -300);
  assert.equal(offsetMinutesAt(Z('2026-07-01T12:00:00Z'), 'Asia/Kolkata'), 330);
});

test('localDayKey / localMinuteOfDay follow the zone, not the server', () => {
  const t = Z('2026-09-09T04:30:00Z'); // 23:30 CDT on 09-08 (Chicago is UTC−5 in September)
  assert.equal(localDayKey(t, CHI), '2026-09-08');
  assert.equal(localMinuteOfDay(t, CHI), 23 * 60 + 30);
  assert.equal(localDayKey(t, 'UTC'), '2026-09-09');
});

test('localWeekday: 0 = Sunday (2026-09-06 is a Sunday)', () => {
  assert.equal(localWeekday('2026-09-06'), 0);
  assert.equal(localWeekday('2026-09-08'), 2);
});

test('addDays / daysBetween are calendar arithmetic on the day key', () => {
  assert.equal(addDays('2026-09-08', -7), '2026-09-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // DST day, still +1
  assert.equal(daysBetween('2026-09-01', '2026-09-08'), 7);
  assert.equal(daysBetween('2026-03-01', '2026-03-15'), 14); // across a DST change
  assert.equal(daysBetween('2026-09-08', '2026-09-08'), 0);
});

test('zonedTimeToUtc — the four DST pins (spec §5)', () => {
  assert.equal(zonedTimeToUtc('2026-03-08', 2 * 60 + 30, NY), Z('2026-03-08T07:30:00Z')); // spring gap → utc1
  assert.equal(zonedTimeToUtc('2026-03-08', 3 * 60, NY), Z('2026-03-08T07:00:00Z'));
  assert.equal(zonedTimeToUtc('2026-11-01', 1 * 60 + 30, NY), Z('2026-11-01T05:30:00Z')); // first 01:30 (EDT)
  assert.equal(zonedTimeToUtc('2026-11-01', 2 * 60, NY), Z('2026-11-01T07:00:00Z'));
});

test('zonedTimeToUtc — an ordinary day, and WI vs FL differ by an hour', () => {
  assert.equal(zonedTimeToUtc('2026-09-08', 8 * 60 + 30, CHI), Z('2026-09-08T13:30:00Z'));
  assert.equal(zonedTimeToUtc('2026-09-08', 8 * 60 + 30, NY), Z('2026-09-08T12:30:00Z'));
  assert.equal(zonedTimeToUtc('2026-09-08', 0, CHI), Z('2026-09-08T05:00:00Z'));
});
```

- [x] **Step 2: Run to verify it fails**

Run: `node --test src/lib/tz.test.mjs` → expect a module-not-found failure.

- [x] **Step 3: Implement `src/lib/tz.mjs`**

```js
// Pure IANA time-zone math for the Routine Builder (spec §5). No imports.
// Every instant is a millisecond epoch number; every "day" is 'YYYY-MM-DD'.

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function wallParts(instant, tz) {
  const out = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(instant))) out[type] = value;
  // Some engines print hour "24" at midnight even with h23; normalise.
  if (out.hour === '24') out.hour = '00';
  return out;
}

const p2 = (n) => String(n).padStart(2, '0');

// local − UTC in minutes (New York summer = −240).
export function offsetMinutesAt(instant, tz) {
  const p = wallParts(instant, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const whole = Math.floor(instant / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

export function localDayKey(instant, tz) {
  const p = wallParts(instant, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localMinuteOfDay(instant, tz) {
  const p = wallParts(instant, tz);
  return (+p.hour) * 60 + (+p.minute);
}

function dayToUtcMs(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// 0 = Sunday … 6 = Saturday, from a 'YYYY-MM-DD' key (Date#getDay convention).
export function localWeekday(day) {
  return new Date(dayToUtcMs(day)).getUTCDay();
}

export function addDays(day, n) {
  const d = new Date(dayToUtcMs(day) + n * 86400000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

// dayB − dayA in whole calendar days.
export function daysBetween(dayA, dayB) {
  return Math.round((dayToUtcMs(dayB) - dayToUtcMs(dayA)) / 86400000);
}

// Wall-clock (day + minute-of-day) in `tz` → UTC instant. Two-step algorithm
// from spec §5; a spring-forward gap resolves to the first guess (utc1).
export function zonedTimeToUtc(day, minute, tz) {
  const guess = dayToUtcMs(day) + minute * 60000;
  const off1 = offsetMinutesAt(guess, tz);
  const utc1 = guess - off1 * 60000;
  if (offsetMinutesAt(utc1, tz) === off1) return utc1;
  const off2 = offsetMinutesAt(utc1, tz);
  const utc2 = guess - off2 * 60000;
  if (offsetMinutesAt(utc2, tz) === off2) return utc2;
  return utc1;
}
```

- [x] **Step 4: Run to verify it passes**

Run: `node --test src/lib/tz.test.mjs` → `pass 7, fail 0`. Then `npm test` → 766 pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/tz.mjs src/lib/tz.test.mjs
git commit -m "feat(routine): tz.mjs — zone math with DST pins (spec §5)"
```

---

## Task 2: Palette + templates

**Spec:** §7d (palette table), §7e (starter).

**Files:**
- Create: `src/lib/routinePalette.mjs`, `src/lib/routineTemplates.mjs`, `src/lib/routinePalette.test.mjs`, `src/lib/routineTemplates.test.mjs`

- [x] **Step 1: Write the failing tests**

`src/lib/routinePalette.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, paletteById, CATEGORIES } from './routinePalette.mjs';

test('10 entries, unique ids, every category whitelisted, one hex each', () => {
  assert.equal(PALETTE.length, 10);
  assert.equal(new Set(PALETTE.map(p => p.id)).size, 10);
  for (const p of PALETTE) {
    assert.ok(CATEGORIES.includes(p.category), p.id);
    assert.match(p.hex, /^#[0-9a-f]{6}$/);
    assert.ok(p.defaultMin >= 10 && p.defaultMin % 5 === 0);
    assert.equal(typeof p.defaultRemind, 'boolean');
    assert.ok(p.why.length > 10);
  }
});

test('no palette hue is amber #f59e0b (amber text is reserved for the loss marker — spec §7d)', () => {
  assert.ok(PALETTE.every(p => p.hex.toLowerCase() !== '#f59e0b'));
});

test('break is the only category that defaults reminders off; both appt entries share #8b5cf6', () => {
  assert.deepEqual(PALETTE.filter(p => !p.defaultRemind).map(p => p.id), ['break']);
  assert.equal(paletteById('webby').hex, '#8b5cf6');
  assert.equal(paletteById('inperson').hex, '#8b5cf6');
  assert.equal(paletteById('nope'), null);
});
```

`src/lib/routineTemplates.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_TEMPLATE, BLANK_TEMPLATE, TEMPLATES } from './routineTemplates.mjs';
import { paletteById } from './routinePalette.mjs';

const dur = (e) => e.durationMin ?? paletteById(e.paletteId).defaultMin;

test('starter is collision-free, sorted, never crosses midnight, 11 entries', () => {
  const es = STARTER_TEMPLATE.entries;
  assert.equal(es.length, 11);
  for (let i = 1; i < es.length; i++) assert.ok(es[i].startMin >= es[i - 1].startMin + dur(es[i - 1]), `overlap at ${i}`);
  for (const e of es) {
    assert.ok(paletteById(e.paletteId), e.paletteId);
    assert.ok(e.startMin + dur(e) <= 1440);
    assert.equal(e.startMin % 5, 0);
  }
});

test('starter shape pins (spec §7e)', () => {
  const es = STARTER_TEMPLATE.entries;
  assert.deepEqual(es.map(e => e.startMin), [480, 510, 630, 645, 675, 750, 795, 915, 930, 990, 1035]);
  assert.equal(es[5].name, 'Lunch');
  assert.equal(es[5].paletteId, 'break');
  assert.equal(es[10].name, 'Day wrap-up');
  assert.equal(es[10].paletteId, 'review');
  assert.equal(es[1].note, 'Fresh leads first. Aim for 40 dials.');
});

test('blank has no entries; TEMPLATES lists both', () => {
  assert.deepEqual(BLANK_TEMPLATE.entries, []);
  assert.deepEqual(TEMPLATES.map(t => t.id), ['agent-day', 'blank']);
});
```

- [x] **Step 2: Run to verify they fail**

Run: `node --test src/lib/routinePalette.test.mjs src/lib/routineTemplates.test.mjs` → module-not-found.

- [x] **Step 3: Implement**

`src/lib/routinePalette.mjs`:
```js
// Routine Builder palette (spec §7d). One hex per category — used for tint,
// stripe, and dot. NEVER Tailwind amber-500: amber text means "routine time
// lost" and nothing else (tripwire in sourceInvariants.test.mjs).
export const CATEGORIES = ['dial', 'followup', 'text', 'appt', 'review', 'admin', 'learn', 'break', 'custom'];

export const PALETTE = [
  { id: 'dial',     name: 'Dial block',              category: 'dial',     hex: '#f43f5e', defaultMin: 120, defaultRemind: true,  icon: 'PhoneCall',     why: 'Protected outbound time. Phone only — no email, no CRM cleanup.' },
  { id: 'followup', name: 'Follow-up queue',         category: 'followup', hex: '#f97316', defaultMin: 75,  defaultRemind: true,  icon: 'RotateCcw',     why: 'Work the people who said "call me back". Oldest first.' },
  { id: 'text',     name: 'Text blast + replies',    category: 'text',     hex: '#0ea5e9', defaultMin: 30,  defaultRemind: true,  icon: 'MessageSquare', why: 'Send the blast, then answer every reply before you move on.' },
  { id: 'webby',    name: 'Webby appointments',      category: 'appt',     hex: '#8b5cf6', defaultMin: 120, defaultRemind: true,  icon: 'Video',         why: 'Back-to-back webinar/Zoom presentations. Camera on, quotes ready.' },
  { id: 'inperson', name: 'In-person appointment',   category: 'appt',     hex: '#8b5cf6', defaultMin: 60,  defaultRemind: true,  icon: 'MapPin',        why: 'Drive time not included — add a block for it.' },
  { id: 'review',   name: 'Morning review',          category: 'review',   hex: '#6366f1', defaultMin: 30,  defaultRemind: true,  icon: 'Sunrise',       why: "Yesterday's misses, today's goals, who's warm." },
  { id: 'admin',    name: 'Apps & underwriting',     category: 'admin',    hex: '#64748b', defaultMin: 60,  defaultRemind: true,  icon: 'FileCheck',     why: 'Submit apps, chase underwriting, clear the paperwork pile.' },
  { id: 'learn',    name: 'Learning',                category: 'learn',    hex: '#10b981', defaultMin: 45,  defaultRemind: true,  icon: 'GraduationCap', why: 'Product training, a recorded call, a script drill. Compounds.' },
  { id: 'break',    name: 'Break',                   category: 'break',    hex: '#94a3b8', defaultMin: 15,  defaultRemind: false, icon: 'Coffee',        why: 'Step away. The next block goes better.' },
  { id: 'custom',   name: 'Make your own block',     category: 'custom',   hex: '#d946ef', defaultMin: 30,  defaultRemind: true,  icon: 'Plus',          why: 'Anything else your day needs. Name it, size it.' },
];

const BY_ID = new Map(PALETTE.map(p => [p.id, p]));
export function paletteById(id) { return BY_ID.get(id) || null; }

const BY_CATEGORY = new Map();
for (const p of PALETTE) if (!BY_CATEGORY.has(p.category)) BY_CATEGORY.set(p.category, p);
// First palette entry of a category — the hex/icon source for a block whose
// paletteId is unknown (an old id after a palette change).
export function paletteForCategory(category) { return BY_CATEGORY.get(category) || BY_ID.get('custom'); }
```

`src/lib/routineTemplates.mjs`:
```js
// Routine templates (spec §7e): ONE starter + Blank. An entry never overrides
// paletteId; an unlisted durationMin uses the palette default.
export const LUNCH = { paletteId: 'break', name: 'Lunch', durationMin: 45 };
export const DAY_WRAP_UP = { paletteId: 'review', name: 'Day wrap-up', durationMin: 15 };

export const STARTER_TEMPLATE = {
  id: 'agent-day',
  name: 'Agent day',
  description: 'Morning review, two dial blocks, follow-up queues, breaks, a wrap-up. 8:00–5:30.',
  entries: [
    { paletteId: 'review',   startMin: 480,  durationMin: 30 },
    { paletteId: 'dial',     startMin: 510,  durationMin: 120, note: 'Fresh leads first. Aim for 40 dials.' },
    { paletteId: 'break',    startMin: 630,  durationMin: 15 },
    { paletteId: 'text',     startMin: 645,  durationMin: 30 },
    { paletteId: 'followup', startMin: 675,  durationMin: 75 },
    { ...LUNCH,              startMin: 750 },
    { paletteId: 'dial',     startMin: 795,  durationMin: 120, note: 'Callbacks + aged leads' },
    { paletteId: 'break',    startMin: 915,  durationMin: 15 },
    { paletteId: 'followup', startMin: 930,  durationMin: 60 },
    { paletteId: 'admin',    startMin: 990,  durationMin: 45 },
    { ...DAY_WRAP_UP,        startMin: 1035, note: "Log every touch. Set tomorrow's top 3." },
  ],
};

export const BLANK_TEMPLATE = { id: 'blank', name: 'Blank', description: 'Start from an empty day.', entries: [] };

export const TEMPLATES = [STARTER_TEMPLATE, BLANK_TEMPLATE];
```

- [x] **Step 4: Run to verify they pass**

Run: `node --test src/lib/routinePalette.test.mjs src/lib/routineTemplates.test.mjs` → 6 pass. `npm test` → 772 pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/routinePalette.mjs src/lib/routineTemplates.mjs src/lib/routinePalette.test.mjs src/lib/routineTemplates.test.mjs
git commit -m "feat(routine): palette + starter template (spec §7d, §7e)"
```

---

## Task 3: `routineModel.mjs` — sanitizers, overlaps, settings, seeding, templates

**Spec:** §4a, §4b (sanitizeDay), §4c, §7e (applyTemplate).

**Files:**
- Create: `src/lib/routineModel.mjs`, `src/lib/routineModel.test.mjs`

- [x] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uid, dayUid, sanitizeBlocks, liveBlocks, resolveOverlaps, sanitizeDay, sanitizeSettings,
  DEFAULT_SETTINGS, seedFollowupStages, instantiateTemplate, applyTemplate,
} from './routineModel.mjs';
import { STARTER_TEMPLATE } from './routineTemplates.mjs';

const NOW = '2026-09-08T15:00:00.000Z';
const blk = (o) => ({ id: uid(), name: 'X', paletteId: 'dial', category: 'dial', startMin: 480, durationMin: 60,
  remind: { enabled: true, minutesBefore: 5 }, note: '', deletedAt: null, createdAt: NOW, updatedAt: NOW, ...o });

test('uid shapes', () => {
  assert.match(uid(), /^blk_[0-9a-z]{7}$/);
  assert.match(dayUid(), /^mk_[0-9a-z]{7}$/);
  assert.notEqual(uid(), uid());
});

test('sanitizeBlocks: drops idless, dedupes by newest updatedAt, snaps, clamps, whitelists category', () => {
  const a1 = blk({ id: 'blk_aaaaaaa', startMin: 482, durationMin: 7, updatedAt: '2026-09-08T10:00:00Z' });
  const a2 = { ...a1, name: 'newer', updatedAt: '2026-09-08T11:00:00Z' };
  const bad = blk({ id: 'blk_bbbbbbb', category: 'nope', startMin: 1430, durationMin: 60 });
  const out = sanitizeBlocks([{ name: 'no id' }, a1, a2, bad], NOW);
  assert.equal(out.length, 2);
  const a = out.find(b => b.id === 'blk_aaaaaaa');
  assert.equal(a.name, 'newer');
  assert.equal(a.startMin, 480);
  assert.equal(a.durationMin, 10);
  const b = out.find(b => b.id === 'blk_bbbbbbb');
  assert.equal(b.category, 'custom');
  assert.equal(b.startMin + b.durationMin <= 1440, true);
});

test('sanitizeBlocks retains tombstones ≤ 7 days, prunes older; liveBlocks hides them', () => {
  const live = blk({ id: 'blk_live000' });
  const fresh = blk({ id: 'blk_dead001', startMin: 600, deletedAt: '2026-09-05T00:00:00Z' });
  const old = blk({ id: 'blk_dead002', startMin: 700, deletedAt: '2026-08-20T00:00:00Z' });
  const out = sanitizeBlocks([live, fresh, old], NOW);
  assert.deepEqual(out.map(b => b.id).sort(), ['blk_dead001', 'blk_live000']);
  assert.deepEqual(liveBlocks([live, fresh, old], NOW).map(b => b.id), ['blk_live000']);
});

test('resolveOverlaps: later-updatedAt moves to the next free gap; equal stamps → greater id moves', () => {
  const a = blk({ id: 'blk_a000000', startMin: 480, durationMin: 60, updatedAt: '2026-09-08T10:00:00Z' });
  const b = blk({ id: 'blk_b000000', startMin: 500, durationMin: 30, updatedAt: '2026-09-08T11:00:00Z' });
  const { blocks } = resolveOverlaps([a, b]);
  assert.equal(blocks.find(x => x.id === 'blk_b000000').startMin, 540);
  const c = blk({ id: 'blk_c000000', startMin: 480, durationMin: 60, updatedAt: NOW });
  const d = blk({ id: 'blk_d000000', startMin: 480, durationMin: 60, updatedAt: NOW });
  const r2 = resolveOverlaps([c, d]);
  assert.equal(r2.blocks.find(x => x.id === 'blk_d000000').startMin, 540);
  assert.equal(r2.blocks.find(x => x.id === 'blk_c000000').startMin, 480);
});

test('resolveOverlaps: no gap before 1440 → shrink to the largest free gap ≥ 10; none → dropped', () => {
  const big = blk({ id: 'blk_big0000', startMin: 0, durationMin: 720, updatedAt: '2026-09-08T09:00:00Z' });
  const big2 = blk({ id: 'blk_big0001', startMin: 720, durationMin: 700, updatedAt: '2026-09-08T09:00:00Z' });
  const late = blk({ id: 'blk_late000', startMin: 700, durationMin: 60, updatedAt: '2026-09-08T12:00:00Z' });
  const r = resolveOverlaps([big, big2, late]);
  const l = r.blocks.find(x => x.id === 'blk_late000');
  assert.equal(l.startMin, 1420);
  assert.equal(l.durationMin, 20);
  const full = blk({ id: 'blk_full000', startMin: 1420, durationMin: 20, updatedAt: '2026-09-08T09:00:00Z' });
  const extra = blk({ id: 'blk_extra00', startMin: 1425, durationMin: 10, updatedAt: '2026-09-08T12:00:00Z' });
  const r3 = resolveOverlaps([big, big2, full, extra]);
  assert.deepEqual(r3.dropped, ['blk_extra00']);
  assert.ok(!r3.blocks.some(x => x.id === 'blk_extra00'));
});

test('sanitizeBlocks caps at 60 live (newest-createdAt extras tombstoned) and two live blocks never overlap', () => {
  const many = Array.from({ length: 62 }, (_, i) => blk({ id: 'blk_' + String(i).padStart(7, '0'), startMin: (i * 20) % 1400, durationMin: 10, createdAt: `2026-09-0${i < 31 ? 1 : 2}T${String(i % 24).padStart(2, '0')}:00:00Z` }));
  const out = liveBlocks(many, NOW);
  assert.equal(out.length, 60);
  const sorted = [...out].sort((x, y) => x.startMin - y.startMin);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].startMin >= sorted[i - 1].startMin + sorted[i - 1].durationMin);
});

test('sanitizeBlocks: a stale merge cannot resurrect a delete (tombstone with newer updatedAt wins the dedupe)', () => {
  const alive = blk({ id: 'blk_same000', updatedAt: '2026-09-08T10:00:00Z' });
  const dead = { ...alive, deletedAt: '2026-09-08T10:30:00Z', updatedAt: '2026-09-08T10:30:00Z' };
  assert.equal(liveBlocks([alive, dead], NOW).length, 0);
  assert.equal(liveBlocks([dead, alive], NOW).length, 0);
});

test('sanitizeDay: prunes < today−7, drops 8-day-old tombstones, clamps make-up duration, validates kinds', () => {
  const recs = [
    { id: '2026-09-08|blk_a', kind: 'done', day: '2026-09-08', blockId: 'blk_a', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null },
    { id: '2026-08-30|blk_a', kind: 'done', day: '2026-08-30', blockId: 'blk_a', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null },
    { id: 'mk_0000001', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 3, category: 'dial', name: 'Dial block (make-up)', ofBlockId: 'blk_a', updatedAt: NOW, deletedAt: null },
    { id: 'mk_0000002', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 30, category: 'dial', name: 'x', ofBlockId: 'blk_a', updatedAt: NOW, deletedAt: '2026-08-25T00:00:00Z' },
    { id: '2026-09-08|weird', kind: 'weird', day: '2026-09-08', updatedAt: NOW, deletedAt: null },
    { id: '2026-09-08|owed', kind: 'owed', day: '2026-09-08', minutes: 30, byBlock: { blk_a: 30 }, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: NOW, deletedAt: null },
  ];
  const out = sanitizeDay(recs, '2026-09-08', NOW);
  assert.deepEqual(out.map(r => r.id).sort(), ['2026-09-08|blk_a', '2026-09-08|owed', 'mk_0000001']);
  assert.equal(out.find(r => r.id === 'mk_0000001').durationMin, 10);
});

test('sanitizeSettings + DEFAULT_SETTINGS', () => {
  assert.equal(DEFAULT_SETTINGS.timezone, null);
  assert.deepEqual(DEFAULT_SETTINGS.activeDays, [0, 1, 2, 3, 4, 5, 6]);
  const s = sanitizeSettings({ activeDays: [1, 1, 9, -1, 3], defaultMinutesBefore: 7, timezoneMode: 'weird', timezone: 'America/Chicago', appointmentStages: ['A', 'A', 5], followupStages: ['B'], remindersEnabled: 'yes', junk: 1 });
  assert.deepEqual(s.activeDays, [1, 3]);
  assert.equal(s.defaultMinutesBefore, 5);
  assert.equal(s.timezoneMode, 'auto');
  assert.equal(s.timezone, 'America/Chicago');
  assert.deepEqual(s.appointmentStages, ['A']);
  assert.equal(s.remindersEnabled, true);
  assert.equal('junk' in s, false);
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.equal(sanitizeSettings({ defaultMinutesBefore: 13 }).defaultMinutesBefore, 15);
  assert.deepEqual(sanitizeSettings({ activeDays: [] }).activeDays, []);
});

test('seedFollowupStages: defaults + follow-up-worded customs; never won/sold/not-interested; null settings → defaults', () => {
  const stages = [
    { id: 'WEBBY_SET', label: 'Webby Set' }, { id: 'MISSED_APPT', label: 'Missed Appt' }, { id: 'SOLD', label: 'Sold' },
    { id: 'STAGE_1', label: 'Expressed Interest/ Aiming APPT' },
    { id: 'STAGE_2', label: 'Try to Reengage/Get interest back' },
    { id: 'STAGE_3', label: 'Pitched / needs app' },
    { id: 'STAGE_4', label: 'Circle back Q4' },
    { id: 'STAGE_5', label: 'Check back in Jan' },
    { id: 'STAGE_6', label: 'Call back Friday' },
    { id: 'STAGE_7', label: 'No show – reschedule' },
    { id: 'STAGE_8', label: 'Re-engaged (won)' },
    { id: 'STAGE_9', label: 'Not Interested' },
    { id: 'STAGE_10', label: 'Uninterested' },
    { id: 'STAGE_11', label: 'No interest' },
    { id: 'STAGE_12', label: 'Referral source' },
    { id: 'STAGE_13', label: 'Hot lead' },
    { id: 'STAGE_14', label: 'Quoted' },
  ];
  const out = seedFollowupStages(stages);
  assert.deepEqual(out, ['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION', 'STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'STAGE_6', 'STAGE_7']);
  assert.deepEqual(seedFollowupStages(null), ['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION']);
});

test('instantiateTemplate fills id/category/remind/timestamps from the palette', () => {
  const b = instantiateTemplate({ paletteId: 'break', name: 'Lunch', startMin: 750, durationMin: 45 }, { now: NOW, defaultMinutesBefore: 10 });
  assert.match(b.id, /^blk_/);
  assert.equal(b.category, 'break');
  assert.deepEqual(b.remind, { enabled: false, minutesBefore: 10 });
  assert.equal(b.name, 'Lunch');
  assert.equal(b.createdAt, NOW);
  const d = instantiateTemplate({ paletteId: 'dial', startMin: 510 }, { now: NOW, defaultMinutesBefore: 5 });
  assert.equal(d.name, 'Dial block');
  assert.equal(d.durationMin, 120);
  assert.deepEqual(d.remind, { enabled: true, minutesBefore: 5 });
});

test('applyTemplate: non-empty + !replace → unchanged; empty → seeded; replace → old tombstoned + backup; undo restores', () => {
  const existing = [blk({ id: 'blk_old0000' })];
  const r1 = applyTemplate(existing, STARTER_TEMPLATE, { now: NOW, defaultMinutesBefore: 5 });
  assert.equal(r1.backup, null);
  assert.deepEqual(r1.blocks.map(b => b.id), ['blk_old0000']);
  const r2 = applyTemplate([], STARTER_TEMPLATE, { now: NOW, defaultMinutesBefore: 5 });
  assert.equal(liveBlocks(r2.blocks, NOW).length, 11);
  const r3 = applyTemplate(existing, STARTER_TEMPLATE, { replace: true, now: NOW, defaultMinutesBefore: 5 });
  assert.equal(r3.backup.length, 1);
  assert.equal(r3.blocks.find(b => b.id === 'blk_old0000').deletedAt, NOW);
  assert.equal(liveBlocks(r3.blocks, NOW).length, 11);
  const restored = sanitizeBlocks(r3.backup.map(b => ({ ...b, updatedAt: '2026-09-08T16:00:00Z' })), NOW);
  assert.equal(liveBlocks(restored, NOW).length, 1);
});
```

- [x] **Step 2: Run to verify it fails**

Run: `node --test src/lib/routineModel.test.mjs` → module-not-found.

- [x] **Step 3: Implement `src/lib/routineModel.mjs`**

```js
// Routine Builder data model (spec §4a, §4b, §4c, §7e). Pure; node-tested.
import { CATEGORIES, paletteById, paletteForCategory } from './routinePalette.mjs';
import { addDays } from './tz.mjs';

const SEVEN_DAYS = 7 * 86400000;
const MAX_LIVE = 60;
const MIN_DUR = 10;
const MAX_DUR = 720;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function base36(n) {
  let s = '';
  while (s.length < n) s += Math.random().toString(36).slice(2);
  return s.slice(0, n);
}
export function uid() { return 'blk_' + base36(7); }
export function dayUid() { return 'mk_' + base36(7); }

const snap5 = (n) => Math.round(n / 5) * 5;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isoOrNull = (v) => (typeof v === 'string' && v ? v : null);
const olderThan = (iso, nowIso, ms) => Date.parse(nowIso) - Date.parse(iso) > ms;

function clampBlock(b) {
  const durationMin = clamp(snap5(Number(b.durationMin) || MIN_DUR), MIN_DUR, MAX_DUR);
  let startMin = clamp(snap5(Number(b.startMin) || 0), 0, 1440 - MIN_DUR);
  if (startMin + durationMin > 1440) startMin = 1440 - durationMin;
  const category = CATEGORIES.includes(b.category) ? b.category : 'custom';
  const pal = paletteById(b.paletteId) || paletteForCategory(category);
  const remind = {
    enabled: b.remind ? b.remind.enabled !== false : pal.defaultRemind,
    minutesBefore: [0, 5, 10, 15].includes(Number(b.remind?.minutesBefore)) ? Number(b.remind.minutesBefore) : 5,
  };
  return {
    id: b.id,
    name: (typeof b.name === 'string' && b.name.trim() ? b.name : pal.name).slice(0, 60),
    paletteId: pal.id,
    category,
    startMin, durationMin, remind,
    note: String(b.note ?? '').slice(0, 200),
    deletedAt: isoOrNull(b.deletedAt),
    createdAt: isoOrNull(b.createdAt) || isoOrNull(b.updatedAt) || '1970-01-01T00:00:00.000Z',
    updatedAt: isoOrNull(b.updatedAt) || '1970-01-01T00:00:00.000Z',
  };
}

// Dedupe by id keeping the newest updatedAt (a tombstone stamped later than
// the live copy wins → a stale merge cannot resurrect a delete).
function dedupeNewest(records) {
  const byId = new Map();
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    const prev = byId.get(r.id);
    if (!prev || String(r.updatedAt || '') > String(prev.updatedAt || '')) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// Free gaps (as [start, end)) between placed blocks inside [0, 1440).
function gaps(placed) {
  const sorted = [...placed].sort((x, y) => x.startMin - y.startMin);
  const out = [];
  let cursor = 0;
  for (const p of sorted) {
    if (p.startMin > cursor) out.push([cursor, p.startMin]);
    cursor = Math.max(cursor, p.startMin + p.durationMin);
  }
  if (cursor < 1440) out.push([cursor, 1440]);
  return out;
}

function place(block, placed) {
  // 1) first gap at/after its start that fits
  for (const [s, e] of gaps(placed)) {
    const start = Math.max(s, block.startMin);
    if (e - start >= block.durationMin) return { ...block, startMin: start };
  }
  // 2) shrink to the largest gap ≥ MIN_DUR (prefer at/after start, else any)
  const all = gaps(placed).map(([s, e]) => [s, e, e - s]).filter(g => g[2] >= MIN_DUR);
  const after = all.filter(([s]) => s >= block.startMin);
  const pick = (after.length ? after : all).sort((a, b) => b[2] - a[2])[0];
  if (pick) return { ...block, startMin: pick[0], durationMin: Math.min(block.durationMin, Math.floor(pick[2] / 5) * 5) };
  return null;
}

// Priority placement (spec §4a): blocks are placed in order of (updatedAt asc,
// id asc). The earliest-updated block keeps its slot; every later block is
// placed into the free gaps left by those before it — at/after its own start,
// else shrunk into the largest free gap ≥ 10 min, else dropped. Equal stamps →
// the greater id yields. Overlap-free and idempotent by construction. Resolved
// moves keep their updatedAt on purpose: bumping it would flip priority on the
// next merge and ping-pong the block across devices.
export function resolveOverlaps(live) {
  const order = [...live].sort((a, b) =>
    String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) || String(a.id).localeCompare(String(b.id)));
  const placed = [];
  const dropped = [];
  for (const b of order) {
    const moved = place(b, placed);
    if (moved) placed.push(moved); else dropped.push(b.id);
  }
  return { blocks: placed.sort((a, b) => a.startMin - b.startMin || String(a.id).localeCompare(String(b.id))), dropped };
}

// `onDropped` (optional) receives the NAMES of the blocks resolveOverlaps could not place
// anywhere, so a caller can honour §4a's last resort — tombstone AND toast "No room for
// <name>". A callback rather than a second return value or an out-parameter: every one of
// this function's existing call sites passes two arguments and reads a plain array back
// (liveBlocks, applyTemplate x2, routineStore, the view's commitBlocks, a dozen tests), and
// none of them has to change. The 60-live cap tombstones through a different rule and stays
// silent — §4a scopes the toast to the resolver.
export function sanitizeBlocks(blocks, nowIso = new Date().toISOString(), onDropped = null) {
  const deduped = dedupeNewest(Array.isArray(blocks) ? blocks : []).map(clampBlock);
  const tombstones = deduped.filter(b => b.deletedAt && !olderThan(b.deletedAt, nowIso, SEVEN_DAYS));
  let live = deduped.filter(b => !b.deletedAt);
  if (live.length > MAX_LIVE) {
    const byNewest = [...live].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    const extra = new Set(byNewest.slice(0, live.length - MAX_LIVE).map(b => b.id));
    for (const b of live) if (extra.has(b.id)) tombstones.push({ ...b, deletedAt: nowIso, updatedAt: nowIso });
    live = live.filter(b => !extra.has(b.id));
  }
  const { blocks: resolved, dropped } = resolveOverlaps(live);
  const droppedNames = [];
  for (const id of dropped) { const b = live.find(x => x.id === id); tombstones.push({ ...b, deletedAt: nowIso, updatedAt: nowIso }); droppedNames.push(b.name); }
  if (droppedNames.length && typeof onDropped === 'function') onDropped(droppedNames);
  return [...resolved, ...tombstones].sort((a, b) => a.startMin - b.startMin);
}

export function liveBlocks(blocks, nowIso = new Date().toISOString()) {
  return sanitizeBlocks(blocks, nowIso).filter(b => !b.deletedAt);
}

// ---------------- per-day records (spec §4b) ----------------
const DAY_KINDS = new Set(['done', 'appt', 'attach', 'owed', 'makeup', 'ack']);

export function sanitizeDay(records, today, nowIso = new Date().toISOString()) {
  if (!DAY_KEY_RE.test(String(today))) throw new TypeError('sanitizeDay: today must be YYYY-MM-DD');
  const floor = addDays(today, -7);
  const out = [];
  for (const r of dedupeNewest(Array.isArray(records) ? records : [])) {
    if (!DAY_KINDS.has(r.kind)) continue;
    if (typeof r.day !== 'string' || !DAY_KEY_RE.test(r.day) || r.day < floor) continue;
    const deletedAt = isoOrNull(r.deletedAt);
    if (deletedAt && olderThan(deletedAt, nowIso, SEVEN_DAYS)) continue;
    const rec = { ...r, deletedAt, updatedAt: isoOrNull(r.updatedAt) || '1970-01-01T00:00:00.000Z' };
    if (rec.kind === 'makeup') {
      rec.durationMin = clamp(snap5(Number(rec.durationMin) || MIN_DUR), MIN_DUR, MAX_DUR);
      rec.startMin = clamp(snap5(Number(rec.startMin) || 0), 0, 1440 - rec.durationMin);
      if (!/^mk_[0-9a-z]{7}$/.test(rec.id)) continue;
    }
    if (rec.kind === 'owed') {
      rec.minutes = Math.max(0, Number(rec.minutes) || 0);
      rec.byBlock = rec.byBlock && typeof rec.byBlock === 'object' ? rec.byBlock : {};
      rec.status = ['open', 'accepted', 'skipped'].includes(rec.status) ? rec.status : 'open';
      rec.decidedMinutes = rec.decidedMinutes == null ? null : Math.max(0, Number(rec.decidedMinutes) || 0);
    }
    if (rec.kind === 'done' && !['done', 'skipped', 'cleared'].includes(rec.status)) continue;
    if (rec.kind === 'appt') {
      rec.startMin = clamp(Number(rec.startMin) || 0, 0, 1439);
      rec.durationMin = clamp(Number(rec.durationMin) || 30, 5, MAX_DUR);
      rec.source = rec.source === 'attached' ? 'attached' : 'derived';
      rec.heldAt = isoOrNull(rec.heldAt);
    }
    out.push(rec);
  }
  return out;
}

// ---------------- settings (spec §4c) ----------------
export const DEFAULT_SETTINGS = Object.freeze({
  version: 1, timezone: null, timezoneMode: 'auto',
  remindersEnabled: true, defaultMinutesBefore: 5,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  appointmentStages: ['WEBBY_SET', 'WEBBY_CONFIRMED', 'APPOINTMENT_SET'],
  followupStages: ['MISSED_APPT', 'FOLLOWUP_LATER', 'PENDING_DECISION'],
  followupStagesSeeded: false, lastReplacedBackup: null,
});

const uniqStrings = (arr, fallback) => (Array.isArray(arr) ? [...new Set(arr.filter(x => typeof x === 'string' && x))] : [...fallback]);

export function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return { ...DEFAULT_SETTINGS, activeDays: [...DEFAULT_SETTINGS.activeDays], appointmentStages: [...DEFAULT_SETTINGS.appointmentStages], followupStages: [...DEFAULT_SETTINGS.followupStages] };
  const lead = typeof s.defaultMinutesBefore === 'number' ? s.defaultMinutesBefore : NaN;
  const nearest = [0, 5, 10, 15].reduce((best, v) => (Math.abs(v - lead) < Math.abs(best - lead) ? v : best), 5);
  return {
    version: 1,
    timezone: typeof s.timezone === 'string' && s.timezone ? s.timezone : null,
    timezoneMode: s.timezoneMode === 'manual' ? 'manual' : 'auto',
    remindersEnabled: s.remindersEnabled !== false,
    defaultMinutesBefore: Number.isFinite(lead) ? nearest : 5,
    activeDays: Array.isArray(s.activeDays) ? [...new Set(s.activeDays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [...DEFAULT_SETTINGS.activeDays],
    appointmentStages: uniqStrings(s.appointmentStages, DEFAULT_SETTINGS.appointmentStages),
    followupStages: uniqStrings(s.followupStages, DEFAULT_SETTINGS.followupStages),
    followupStagesSeeded: s.followupStagesSeeded === true,
    lastReplacedBackup: Array.isArray(s.lastReplacedBackup) ? s.lastReplacedBackup : null,
  };
}

// Custom stages seed ONLY on follow-up wording (Juan 2026-09-11) AND never on
// closed-won / not-interested wording.
export const FOLLOWUP_WORDS = /follow|circle|check\s*back|call\s*back|callback|pitch|needs?\s*app|re-?engage|interest|missed|pending|later|reschedul|no[\s-]*show|think|decid/i;
// A bare \bno\b would also reject "No show – reschedule", which the positive
// list deliberately seeds — the lookahead keeps "no" as a negation word except
// when it heads "no show" / "no-show". (Spec §4c's regex lacks the lookahead
// and contradicts its own §12 pin; recorded as a plan deviation for spec rev 11 §4c.)
export const NOT_FOLLOWUP_WORDS = /\b(won|sold|closed|lost|dead|not|never)\b|\bno\b(?![\s-]*show)|\b(un|dis)interest/i;
// Hand copy of constants.js DEFAULT_PROSPECT_STAGES ids — a node test in Task 13 pins the two equal.
export const DEFAULT_STAGE_IDS = new Set(['WEBBY_SET', 'WEBBY_CONFIRMED', 'APPOINTMENT_SET', 'MISSED_APPT', 'PENDING_DECISION', 'FOLLOWUP_LATER', 'GHOSTED', 'SOLD', 'LOST']);

export function seedFollowupStages(stages) {
  const out = [...DEFAULT_SETTINGS.followupStages];
  for (const s of Array.isArray(stages) ? stages : []) {
    if (!s || typeof s.id !== 'string' || DEFAULT_STAGE_IDS.has(s.id)) continue;
    const label = String(s.label || '');
    if (FOLLOWUP_WORDS.test(label) && !NOT_FOLLOWUP_WORDS.test(label)) out.push(s.id);
  }
  return out;
}

// ---------------- templates (spec §7e) ----------------
export function instantiateTemplate(entry, { now, defaultMinutesBefore }) {
  const pal = paletteById(entry.paletteId) || paletteById('custom');
  return clampBlock({
    id: uid(),
    name: entry.name ?? pal.name,
    paletteId: pal.id,
    category: pal.category,
    startMin: entry.startMin,
    durationMin: entry.durationMin ?? pal.defaultMin,
    remind: { enabled: pal.defaultRemind, minutesBefore: defaultMinutesBefore, ...(entry.remind || {}) },
    note: entry.note ?? '',
    deletedAt: null, createdAt: now, updatedAt: now,
  });
}

// → { blocks, backup }. See spec §7e for the four branches.
export function applyTemplate(existing, template, { replace = false, now, defaultMinutesBefore }) {
  const sanitized = sanitizeBlocks(existing, now);
  const live = sanitized.filter(b => !b.deletedAt);
  const fresh = template.entries.map(e => instantiateTemplate(e, { now, defaultMinutesBefore }));
  if (live.length > 0 && !replace) return { blocks: sanitized, backup: null };
  if (live.length === 0) return { blocks: sanitizeBlocks([...sanitized, ...fresh], now), backup: null };
  const tombstoned = live.map(b => ({ ...b, deletedAt: now, updatedAt: now }));
  const tombs = sanitized.filter(b => b.deletedAt);
  return { blocks: sanitizeBlocks([...tombstoned, ...tombs, ...fresh], now), backup: sanitized };
}
```

- [x] **Step 4: Run to verify it passes**

Run: `node --test src/lib/routineModel.test.mjs` → 12 pass. If `resolveOverlaps` shrink test fails on the exact `1420/20` numbers, hand-trace `place()` against `gaps()`: big 0–720, big2 720–1420 → gaps `[[1420,1440]]`; late (700, 60) has no fitting gap → shrink → start 1420, duration `min(60, floor(20/5)*5) = 20`. Fix the implementation, not the test. Then `npm test` → 784 pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/routineModel.mjs src/lib/routineModel.test.mjs
git commit -m "feat(routine): routineModel — sanitizers, overlap resolution, settings, seeding, templates (spec §4a-c, §7e)"
```

---

## Task 4: `routineLayout.mjs` + `routineClock.mjs`

**Spec:** §7c geometry, §7b `nowState`, §7c `blockVisualState`, density tiers.

**Files:**
- Create: `src/lib/routineLayout.mjs`, `src/lib/routineLayout.test.mjs`, `src/lib/routineClock.mjs`, `src/lib/routineClock.test.mjs`

- [x] **Step 1: Write the failing tests**

`src/lib/routineLayout.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PX_PER_MIN, SNAP_MIN, DEFAULT_START, DEFAULT_END, floorHour, ceilHour, bounds, topPx, heightPx, minuteFromPx } from './routineLayout.mjs';

test('constants', () => { assert.deepEqual([PX_PER_MIN, SNAP_MIN, DEFAULT_START, DEFAULT_END], [2, 5, 360, 1260]); });

test('bounds never shrink below the defaults and expand to whole hours', () => {
  assert.deepEqual(bounds([]), { start: 360, end: 1260 });
  assert.deepEqual(bounds([{ startMin: 300, endMin: 330 }]), { start: 300, end: 1260 });
  assert.deepEqual(bounds([{ startMin: 1250, endMin: 1275 }]), { start: 360, end: 1320 });
  assert.deepEqual(bounds([{ startMin: 305, endMin: 1290 }]), { start: 300, end: 1320 });
});

test('pixel math', () => {
  assert.equal(floorHour(305), 300); assert.equal(ceilHour(1275), 1320); assert.equal(ceilHour(1260), 1260);
  assert.equal(topPx(510, 360), 300); assert.equal(heightPx(120), 240);
  assert.equal(minuteFromPx(303, 360), 510); assert.equal(minuteFromPx(-10, 360), 360); assert.equal(minuteFromPx(99999, 360), 1440);
});
```

`src/lib/routineClock.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatRange, formatMinutes, blockVisualState, nowState } from './routineClock.mjs';

test('formatters', () => {
  assert.equal(formatTime(510), '8:30'); assert.equal(formatTime(795), '1:15'); assert.equal(formatTime(0), '12:00'); assert.equal(formatTime(720), '12:00');
  assert.equal(formatRange(510, 630), '8:30–10:30');
  assert.equal(formatMinutes(30), '30m'); assert.equal(formatMinutes(85), '1h 25m'); assert.equal(formatMinutes(120), '2h'); assert.equal(formatMinutes(0), '0m');
});

test('blockVisualState', () => {
  const s = (o) => blockVisualState({ startMin: 480, endMin: 540, done: null, nowMin: 400, ...o });
  assert.equal(s({}), 'future');
  assert.equal(s({ done: 'done' }), 'future-done');
  assert.equal(s({ nowMin: 500 }), 'current');
  assert.equal(s({ nowMin: 600, done: 'done' }), 'past-done');
  assert.equal(s({ nowMin: 600 }), 'past-unchecked');
  assert.equal(s({ nowMin: 600, done: 'cleared' }), 'past-unchecked');
  assert.equal(s({ done: 'skipped' }), 'skipped');
});

// Dial 8:30–10:30 split by a 9:00–9:30 appointment; Break 10:30–10:45.
const seg = (blockId, s, e, extra = {}) => ({ kind: 'segment', blockId, startMin: s, endMin: e, name: blockId, category: blockId === 'break' ? 'break' : 'dial', ...extra });
// Breaks never set `behind` (a "Break · still open" line is noise; consistent with §7h.4 excluding breaks) — plan deviation from the literal §7b, propose for rev 11.
const items = [seg('dial', 510, 540, { isFirst: true }), { kind: 'appt', prospectId: 'p1', startMin: 540, endMin: 570, name: 'Ana' }, seg('dial', 570, 630, { isLast: true }), seg('break', 630, 645, { isFirst: true, isLast: true })];
const noDone = [];
const TODAY = '2026-09-08';
const d = (blockId, status, day = TODAY) => ({ kind: 'done', blockId, status, day, deletedAt: null });

test('nowState phases and the per-block behind rule (spec §7b)', () => {
  assert.equal(nowState({ items, dayRecords: noDone, nowMin: 400, today: TODAY }).phase, 'upFirst');
  const at550 = nowState({ items, dayRecords: noDone, nowMin: 550, today: TODAY });
  assert.equal(at550.phase, 'now'); assert.equal(at550.current.kind, 'appt'); assert.equal(at550.behind, null); // last segment not ended
  assert.equal(nowState({ items, dayRecords: noDone, nowMin: 631, today: TODAY }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [d('dial', 'done')], nowMin: 631, today: TODAY }).behind, null);
  assert.equal(nowState({ items, dayRecords: [d('dial', 'skipped')], nowMin: 700, today: TODAY }).phase, 'dayDone');
  assert.equal(nowState({ items, dayRecords: [d('dial', 'done')], nowMin: 700, today: TODAY, offerBlocked: true }).phase, 'free');
  const free = nowState({ items: [seg('a', 480, 500, { isFirst: true, isLast: true }), seg('b', 600, 660, { isFirst: true, isLast: true })], dayRecords: [d('a', 'done')], nowMin: 520, today: TODAY });
  assert.equal(free.phase, 'free'); assert.equal(free.next.blockId, 'b');
  assert.equal(nowState({ items: [], dayRecords: [], nowMin: 500, today: TODAY }).phase, 'dayDone');
});

test('nowState: done scoped to today (day-2 bug); tombstoned done ignored; oldest of two wins; make-ups keyed by makeupId; free with no next; boundaries; midnight', () => {
  assert.equal(nowState({ items, dayRecords: [d('dial', 'done', '2026-09-07')], nowMin: 631, today: TODAY }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [{ ...d('dial', 'done'), deletedAt: 'x' }], nowMin: 631, today: TODAY }).behind.blockId, 'dial');
  const two = [seg('a', 480, 500, { isFirst: true, isLast: true }), seg('b', 520, 540, { isFirst: true, isLast: true })];
  assert.equal(nowState({ items: two, dayRecords: [], nowMin: 600, today: TODAY }).behind.blockId, 'a');
  assert.equal(nowState({ items: two, dayRecords: [d('a', 'done')], nowMin: 600, today: TODAY }).behind.blockId, 'b');
  const mk = [{ kind: 'makeup', makeupId: 'mk_0000001', name: 'Dial block (make-up)', category: 'dial', startMin: 750, endMin: 780 }];
  assert.equal(nowState({ items: mk, dayRecords: [], nowMin: 800, today: TODAY }).behind.blockId, 'mk_0000001');
  assert.equal(nowState({ items: mk, dayRecords: [d('mk_0000001', 'done')], nowMin: 800, today: TODAY }).behind, null);
  const late = nowState({ items, dayRecords: [], nowMin: 700, today: TODAY });
  assert.equal(late.phase, 'free'); assert.equal(late.next, null); assert.equal(late.behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [], nowMin: 630, today: TODAY }).behind.blockId, 'dial');
  assert.equal(nowState({ items, dayRecords: [], nowMin: 510, today: TODAY }).current.blockId, 'dial');
  assert.throws(() => nowState({ items, dayRecords: [], nowMin: 500 }), TypeError);
  assert.equal(formatTime(1440), '12:00'); assert.equal(formatTime(-5), '11:55'); assert.equal(formatTime(1445), '12:05');
});
```

- [x] **Step 2: Run to verify they fail** — `node --test src/lib/routineLayout.test.mjs src/lib/routineClock.test.mjs` → module-not-found.

- [x] **Step 3: Implement**

`src/lib/routineLayout.mjs`:
```js
// Timeline geometry (spec §7c). Pure.
export const PX_PER_MIN = 2;
export const SNAP_MIN = 5;
export const DEFAULT_START = 360;
export const DEFAULT_END = 1260;

export const floorHour = (m) => Math.floor(m / 60) * 60;
export const ceilHour = (m) => Math.ceil(m / 60) * 60;

// Derived from the composed items; never stored.
export function bounds(items) {
  let start = DEFAULT_START, end = DEFAULT_END;
  for (const it of items || []) {
    if (Number.isFinite(it.startMin)) start = Math.min(start, floorHour(it.startMin));
    const e = Number.isFinite(it.endMin) ? it.endMin : it.startMin + (it.durationMin || 0);
    if (Number.isFinite(e)) end = Math.max(end, ceilHour(e));
  }
  return { start, end: Math.min(1440, end) };
}

export const topPx = (startMin, boundsStart) => (startMin - boundsStart) * PX_PER_MIN;
export const heightPx = (durationMin) => durationMin * PX_PER_MIN;
export function minuteFromPx(px, boundsStart) {
  const raw = boundsStart + px / PX_PER_MIN;
  return Math.max(boundsStart, Math.min(1440, Math.round(raw / SNAP_MIN) * SNAP_MIN)); // clamp to bounds (§7c), never before the canvas
}
```

`src/lib/routineClock.mjs`:
```js
// NOW-card state + block visual state (spec §7b, §7c). Pure.
export function formatTime(min) {
  const n = ((Math.round(min) % 1440) + 1440) % 1440; // wraps midnight and negatives (a 00:00 block with a 5-min lead)
  const h24 = Math.floor(n / 60), m = n % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')}`;
}
export const formatRange = (s, e) => `${formatTime(s)}–${formatTime(e)}`;
export function formatMinutes(min) {
  const n = Math.max(0, Math.round(min));
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// done ∈ 'done' | 'skipped' | 'cleared' | null
export function blockVisualState({ startMin, endMin, done, nowMin }) {
  if (done === 'skipped') return 'skipped';
  const checked = done === 'done';
  if (nowMin >= endMin) return checked ? 'past-done' : 'past-unchecked';
  if (nowMin >= startMin) return 'current';
  return checked ? 'future-done' : 'future';
}

// items = composeDay().items (segments, makeups, appts) sorted by startMin.
// behind = oldest routine block / make-up whose LAST segment ended with no
// done|skipped record. Appointments never set it.
// `today` is REQUIRED: dayRecords carries 7 days and block ids are permanent,
// so an unscoped done map would let yesterday's checkmark mark today done
// (caught by the Task 4 code review). Breaks never set `behind` (plan
// deviation from the literal §7b, recorded for rev 11).
export function nowState({ items = [], dayRecords = [], nowMin, today, offerBlocked = false }) {
  if (typeof today !== 'string') throw new TypeError('nowState: today is required');
  const done = new Map(dayRecords.filter(r => r && r.kind === 'done' && !r.deletedAt && r.day === today).map(r => [r.blockId, r.status]));
  const current = items.find(it => it.startMin <= nowMin && nowMin < it.endMin) || null;
  const next = items.find(it => it.startMin > nowMin) || null;
  const info = new Map(); // key → { name, startMin (first), endMin (last) }
  for (const it of items) {
    const key = it.kind === 'segment' ? it.blockId : it.kind === 'makeup' ? it.makeupId : null;
    if (!key || it.category === 'break') continue;
    const cur = info.get(key);
    if (!cur) info.set(key, { name: it.name, startMin: it.startMin, endMin: it.endMin });
    else { cur.startMin = Math.min(cur.startMin, it.startMin); cur.endMin = Math.max(cur.endMin, it.endMin); }
  }
  let behind = null;
  for (const [key, v] of info) {
    const status = done.get(key);
    if (v.endMin <= nowMin && status !== 'done' && status !== 'skipped' && (!behind || v.startMin < behind.startMin)) behind = { blockId: key, name: v.name, startMin: v.startMin, endMin: v.endMin };
  }
  let phase;
  if (current) phase = 'now';
  else if (next && items[0] && nowMin < items[0].startMin) phase = 'upFirst';
  else if (next) phase = 'free';
  else phase = (behind || offerBlocked) ? 'free' : 'dayDone'; // 'free' with next === null is a real state — NowCard renders "Free" with no "until"
  return { phase, current, next, behind };
}
```

- [x] **Step 4: Run to verify they pass** — `node --test src/lib/routineLayout.test.mjs src/lib/routineClock.test.mjs` → 7 pass; `npm test` → 794 pass (counts drift with earlier tasks' review additions — 0 failures is the gate).

- [x] **Step 5: Commit**

```bash
git add src/lib/routineLayout.mjs src/lib/routineLayout.test.mjs src/lib/routineClock.mjs src/lib/routineClock.test.mjs
git commit -m "feat(routine): layout geometry + clock/now-state helpers (spec §7b, §7c)"
```

---

## Task 5: `routineLive.mjs` part A — `parseAppointmentTime`, `todaysAppointments`, `followupQueue`

**Spec:** §5 (`parseAppointmentTime`), §7h.1 (rules 1–2 and the overlap absorption), §7h.2.

**Files:**
- Create: `src/lib/routineLive.mjs`, `src/lib/routineLive.test.mjs`

- [x] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppointmentTime, todaysAppointments, followupQueue } from './routineLive.mjs';
import { DEFAULT_SETTINGS } from './routineModel.mjs';

const CHI = 'America/Chicago', NY = 'America/New_York';
const Z = (s) => Date.parse(s);
const NOW = Z('2026-09-08T14:42:00Z'); // 9:42 Chicago
const S = { ...DEFAULT_SETTINGS };

test('parseAppointmentTime: wall-clock in the agent zone, identical under any server TZ (spec §5)', () => {
  const r = parseAppointmentTime('2026-09-08T10:00', CHI);
  assert.deepEqual(r, { day: '2026-09-08', minute: 600, instant: Z('2026-09-08T15:00:00Z') });
  assert.equal(parseAppointmentTime('2026-09-08 10:00', CHI).instant, r.instant);
  assert.equal(parseAppointmentTime('2026-09-08T10:00:00', CHI).instant, r.instant);
  assert.equal(parseAppointmentTime('2026-09-08T23:30', 'Pacific/Auckland').minute, 1410);
  assert.equal(parseAppointmentTime('2026-09-08T23:30', 'Pacific/Auckland').day, '2026-09-08');
});

test('parseAppointmentTime: zoned ISO uses Date.parse; date-only and T00:00 are time-less → null', () => {
  const z = parseAppointmentTime('2026-09-09T02:30:00-05:00', NY); // 03:30 NY on 09-09
  assert.deepEqual(z, { day: '2026-09-09', minute: 210, instant: Z('2026-09-09T07:30:00Z') });
  assert.equal(parseAppointmentTime('2026-09-08', CHI), null);
  assert.equal(parseAppointmentTime('2026-09-08T00:00', CHI), null);
  assert.equal(parseAppointmentTime('garbage', CHI), null);
  assert.equal(parseAppointmentTime('', CHI), null);
  assert.equal(parseAppointmentTime(null, CHI), null);
});

const p = (id, o = {}) => ({ id, name: 'N ' + id, stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T10:00', archivedAt: null, ...o });
const blk = (id, startMin, o = {}) => ({ id, name: 'Webby appointments', category: 'appt', paletteId: 'webby', startMin, durationMin: 120, deletedAt: null, ...o });
const attach = (blockId, prospectId, o = {}) => ({ id: `2026-09-08|attach|${blockId}`, kind: 'attach', day: '2026-09-08', blockId, prospectId, updatedAt: 'x', deletedAt: null, ...o });
const frozen = (pid, startMin, o = {}) => ({ id: `2026-09-08|appt|${pid}|${startMin}`, kind: 'appt', day: '2026-09-08', prospectId: pid, startMin, durationMin: 30, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: null, ...o });
const ta = (o) => todaysAppointments({ prospectRows: [], blocks: [], dayRecords: [], settings: S, tz: CHI, now: NOW, ...o });

test('derived: today only, stage-filtered, archived excluded, 30 min, name from the row', () => {
  const rows = [p('a'), p('b', { stage: 'SOLD' }), p('c', { archivedAt: '2026-09-01T00:00:00Z' }), p('d', { appointmentTime: '2026-09-09T10:00' }), p('e', { appointmentTime: '2026-09-08T14:00' })];
  const out = ta({ prospectRows: rows });
  assert.deepEqual(out.map(i => [i.prospectId, i.startMin, i.durationMin, i.source, i.frozen]), [['a', 600, 30, 'derived', false], ['e', 840, 30, 'derived', false]]);
  assert.equal(out[0].name, 'N a');
  assert.equal(out[0].instant, Z('2026-09-08T15:00:00Z'));
});

test('appointmentStages is agent-configurable; a custom stage counts', () => {
  const out = ta({ prospectRows: [p('a', { stage: 'STAGE_9' })], settings: { ...S, appointmentStages: ['STAGE_9'] } });
  assert.equal(out.length, 1);
});

test('frozen wins over a stage change at the same start; needs no prospect row; name falls back', () => {
  const out = ta({ prospectRows: [p('a', { stage: 'PENDING_DECISION' })], dayRecords: [frozen('a', 600)] });
  assert.equal(out.length, 1); assert.equal(out[0].frozen, true); assert.equal(out[0].name, 'N a');
  const noRow = ta({ dayRecords: [frozen('zz', 600)] });
  assert.equal(noRow[0].name, 'Appointment'); assert.equal(noRow[0].instant, Z('2026-09-08T15:00:00Z'));
});

test('frozen 10:00 + live 14:00 → two items; a post-start nudge to 10:05 is absorbed; pre-start edit moves the one card', () => {
  const two = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T14:00' })], dayRecords: [frozen('a', 600)] });
  assert.deepEqual(two.map(i => i.startMin), [600, 840]);
  const nudge = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T10:05' })], dayRecords: [frozen('a', 600)] });
  assert.deepEqual(nudge.map(i => i.startMin), [600]);
  const moved = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T10:10' })] });
  assert.deepEqual(moved.map(i => i.startMin), [610]);
});

test('a tombstoned appt record suppresses the live item at that start (Remove from today)', () => {
  const out = ta({ prospectRows: [p('a')], dayRecords: [frozen('a', 600, { deletedAt: '2026-09-08T15:02:00Z' })] });
  assert.equal(out.length, 0);
});

test('attach: block geometry, wins over derived only at the same start; derived 10:00 + attach 14:00 → two; tombstoned block → nothing', () => {
  const b = blk('webby', 840);
  const same = ta({ prospectRows: [p('a', { appointmentTime: '2026-09-08T14:00' })], blocks: [b], dayRecords: [attach('webby', 'a')] });
  assert.deepEqual(same.map(i => [i.startMin, i.durationMin, i.source]), [[840, 120, 'attached']]);
  const two = ta({ prospectRows: [p('a')], blocks: [b], dayRecords: [attach('webby', 'a')] });
  assert.deepEqual(two.map(i => [i.startMin, i.source]), [[600, 'derived'], [840, 'attached']]);
  const dead = ta({ blocks: [blk('webby', 840, { deletedAt: 'x' })], dayRecords: [attach('webby', 'a')] });
  assert.equal(dead.length, 0);
  const twoBlocks = ta({ blocks: [blk('w1', 840), blk('w2', 960)], dayRecords: [attach('w1', 'a'), attach('w2', 'a')] });
  assert.deepEqual(twoBlocks.map(i => i.startMin), [840, 960]);
  assert.equal(ta({ blocks: [b], dayRecords: [attach('webby', 'zz')] })[0].name, 'Webby appointments');
});

test('activeDays never affects appointments (caller passes liveBlocks regardless)', () => {
  const out = ta({ prospectRows: [p('a')], settings: { ...S, activeDays: [] } });
  assert.equal(out.length, 1);
});

test('followupQueue: stage-selected, archived out, lastContact asc with empty first, createdAt asc, ages', () => {
  const mk = (id, o) => ({ id, name: 'N' + id, stage: 'FOLLOWUP_LATER', archivedAt: null, lastContact: '', createdAt: '2026-09-01T00:00:00Z', ...o });
  const rows = [
    mk('1', { lastContact: '2026-08-27' }), mk('2', { lastContact: '2026-09-05' }), mk('3', { createdAt: '2026-09-07T00:00:00Z' }),
    mk('4', { createdAt: '2026-08-01T00:00:00Z' }), mk('5', { archivedAt: 'x' }), mk('6', { stage: 'SOLD' }), mk('7', { stage: 'STAGE_X', lastContact: '2026-09-01' }),
  ];
  const out = followupQueue(rows, ['FOLLOWUP_LATER', 'STAGE_X'], CHI, NOW);
  assert.deepEqual(out.map(r => r.id), ['4', '3', '1', '7', '2']);
  assert.deepEqual(out.map(r => r.age), ['—', 'new', '12d', '7d', '3d']);
});
```

- [x] **Step 2: Run to verify it fails** — `node --test src/lib/routineLive.test.mjs` → module-not-found.

- [x] **Step 3: Implement part A of `src/lib/routineLive.mjs`**

```js
// Routine Builder live layer (spec §5 parseAppointmentTime, §7h). Pure; the
// SAME functions run in the browser and in /api/routine/tick.
import { zonedTimeToUtc, localDayKey, localMinuteOfDay, addDays, daysBetween, localWeekday } from './tz.mjs';

export const APPT_DEFAULT_MIN = 30;
const MIN_SEG = 10;
const ceil5 = (n) => Math.ceil(n / 5) * 5;

// ---------- §5 parseAppointmentTime ----------
const WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const ZONED = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// → { day, minute, instant } | null. Wall-clock strings are interpreted in
// `tz`; only a zoned ISO goes through Date.parse (the ONLY Date.parse here).
export function parseAppointmentTime(value, tz) {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(' ', 'T');
  let m = s.match(WALL);
  if (m) {
    const hh = +m[2], mm = +m[3];
    if (hh > 23 || mm > 59) return null;
    const minute = hh * 60 + mm;
    if (minute === 0) return null;
    return { day: m[1], minute, instant: zonedTimeToUtc(m[1], minute, tz) };
  }
  m = s.match(ZONED);
  if (m) {
    const instant = Date.parse(s);
    if (!Number.isFinite(instant)) return null;
    const minute = localMinuteOfDay(instant, tz);
    if (minute === 0) return null;
    return { day: localDayKey(instant, tz), minute, instant };
  }
  return null;
}

// ---------- §7h.1 todaysAppointments ----------
export const apptRecordId = (day, prospectId, startMin) => `${day}|appt|${prospectId}|${startMin}`;

export function todaysAppointments({ prospectRows = [], blocks = [], dayRecords = [], settings, tz, now }) {
  const today = localDayKey(now, tz);
  const stages = new Set(settings?.appointmentStages || []);
  const names = new Map();
  for (const p of prospectRows) if (p && p.id != null && p.name) names.set(p.id, p.name);
  const apptRecs = dayRecords.filter(r => r && r.kind === 'appt' && r.day === today);
  const recordKeys = new Set(apptRecs.map(r => `${r.prospectId}|${r.startMin}`));
  const frozen = apptRecs.filter(r => !r.deletedAt).map(r => ({
    prospectId: r.prospectId, startMin: r.startMin, durationMin: r.durationMin, source: r.source,
    frozen: true, heldAt: r.heldAt || null, recordId: r.id,
    instant: zonedTimeToUtc(today, r.startMin, tz), name: names.get(r.prospectId) || null,
  }));
  const liveBlock = new Map(blocks.filter(b => b && !b.deletedAt).map(b => [b.id, b]));
  const attached = [];
  for (const r of dayRecords) {
    if (!r || r.kind !== 'attach' || r.day !== today || r.deletedAt) continue;
    const b = liveBlock.get(r.blockId);
    if (!b || b.category !== 'appt') continue;
    attached.push({
      prospectId: r.prospectId, startMin: b.startMin, durationMin: b.durationMin, source: 'attached',
      frozen: false, heldAt: null, blockId: b.id, attachId: r.id,
      instant: zonedTimeToUtc(today, b.startMin, tz), name: names.get(r.prospectId) || b.name || null,
    });
  }
  const derived = [];
  for (const p of prospectRows) {
    if (!p || p.archivedAt || !stages.has(p.stage)) continue;
    const parsed = parseAppointmentTime(p.appointmentTime, tz);
    if (!parsed || parsed.day !== today) continue;
    if (attached.some(a => a.prospectId === p.id && a.startMin === parsed.minute)) continue;
    derived.push({ prospectId: p.id, startMin: parsed.minute, durationMin: APPT_DEFAULT_MIN, source: 'derived', frozen: false, heldAt: null, instant: parsed.instant, name: p.name || null });
  }
  const overlapsFrozen = (it) => frozen.some(f => f.prospectId === it.prospectId && it.startMin < f.startMin + f.durationMin && f.startMin < it.startMin + it.durationMin);
  const live = [...attached, ...derived].filter(it => !recordKeys.has(`${it.prospectId}|${it.startMin}`) && !overlapsFrozen(it));
  return [...frozen, ...live]
    .map(it => ({ ...it, name: it.name || 'Appointment', endMin: it.startMin + it.durationMin }))
    .sort((a, b) => a.startMin - b.startMin || String(a.prospectId).localeCompare(String(b.prospectId)));
}

// ---------- §7h.2 followupQueue ----------
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function followupQueue(prospects, stageIds, tz, now) {
  const today = localDayKey(now, tz);
  const ids = new Set(stageIds || []);
  const rows = [];
  for (const p of prospects || []) {
    if (!p || p.archivedAt || !ids.has(p.stage)) continue;
    const lastContact = typeof p.lastContact === 'string' && DAY_RE.test(p.lastContact) ? p.lastContact : '';
    const createdAt = typeof p.createdAt === 'string' ? p.createdAt : '';
    let age;
    if (lastContact) age = `${Math.max(0, daysBetween(lastContact, today))}d`;
    else { const c = new Date(createdAt).getTime(); age = Number.isFinite(c) && now - c <= 7 * 86400000 ? 'new' : '—'; } // not Date.parse — the tripwire allows exactly one in this file
    rows.push({ id: p.id, name: p.name || '(no name)', stage: p.stage, lastContact, createdAt, age });
  }
  rows.sort((a, b) => {
    if (!a.lastContact !== !b.lastContact) return a.lastContact ? 1 : -1;
    if (a.lastContact !== b.lastContact) return a.lastContact < b.lastContact ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return rows;
}
```
`Date.parse(` appears exactly once in this file (the zoned branch) and must stay that way — the tripwire in Task 8 counts it. Everything else uses `new Date(x).getTime()`.

- [x] **Step 4: Run to verify it passes** — `node --test src/lib/routineLive.test.mjs` → 10 pass; `npm test` → 800 pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/routineLive.mjs src/lib/routineLive.test.mjs
git commit -m "feat(routine): routineLive part A — parseAppointmentTime, todaysAppointments, followupQueue (spec §5, §7h.1-2)"
```

---

## Task 6: `routineLive.mjs` part B — `composeDay`, `findMakeupSlot`, owed model, `dayNotDone`, weekly

**Spec:** §7h.3 (all bullets), §7h.4, §7h.5, §4b owed row.

**Files:**
- Modify: `src/lib/routineLive.mjs` (append), `src/lib/routineLive.test.mjs` (append)

- [x] **Step 1: Append the failing tests**

```js
import { composeDay, findMakeupSlot, reconcileOwed, offerState, applyOwedDecision, owedId, dayNotDone, yesterdayMiss, weeklyNotDone } from './routineLive.mjs';
import { STARTER_TEMPLATE } from './routineTemplates.mjs';
import { instantiateTemplate } from './routineModel.mjs';

// T0 is the blocks' createdAt: it MUST predate the 7-day look-back window
// (dayNotDone excludes blocks created after the day being scored — §7h.4).
const T0 = '2026-08-25T12:00:00.000Z';
const starter = () => STARTER_TEMPLATE.entries.map((e, i) => ({ ...instantiateTemplate(e, { now: T0, defaultMinutesBefore: 5 }), id: 'blk_' + String(i).padStart(7, '0') }));
const DIAL_AM = 'blk_0000001', TEXT = 'blk_0000003', FU_AM = 'blk_0000004', LUNCH = 'blk_0000005', DIAL_PM = 'blk_0000006';
const ap = (pid, startMin, durationMin = 30) => ({ prospectId: pid, startMin, durationMin, endMin: startMin + durationMin, instant: 0, source: 'derived', frozen: false, heldAt: null, name: 'N' });
const mk = (id, startMin, durationMin, o = {}) => ({ id, kind: 'makeup', day: '2026-09-08', startMin, durationMin, category: 'dial', name: 'Dial block (make-up)', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null, ...o });
const TODAY = '2026-09-08';
const compose = (o) => composeDay({ live: starter(), appointments: [], makeups: [], dayRecords: [], nowMin: 582, today: TODAY, ...o });
const segsOf = (r, id) => r.items.filter(i => i.kind === 'segment' && i.blockId === id).map(i => [i.startMin, i.endMin]);

test('composeDay: tail / head / mid / whole; displaced per block; title segment = first ending after now', () => {
  const tail = compose({ appointments: [ap('a', 600)] });
  assert.deepEqual(segsOf(tail, DIAL_AM), [[510, 600]]); assert.deepEqual(tail.displacedByBlock, { [DIAL_AM]: 30 }); assert.equal(tail.unrecovered, 30);
  const head = compose({ appointments: [ap('a', 510)] });
  assert.deepEqual(segsOf(head, DIAL_AM), [[540, 630]]);
  const mid = compose({ appointments: [ap('a', 540)] });
  assert.deepEqual(segsOf(mid, DIAL_AM), [[510, 540], [570, 630]]);
  const segs = mid.items.filter(i => i.blockId === DIAL_AM);
  assert.deepEqual(segs.map(s => s.isTitle), [false, true]); assert.deepEqual(segs.map(s => s.isFirst), [true, false]);
  const whole = compose({ appointments: [ap('a', 510, 120)] });
  assert.deepEqual(segsOf(whole, DIAL_AM), []); assert.equal(whole.displacedByBlock[DIAL_AM], 120);
  const past = compose({ appointments: [ap('a', 540)], nowMin: 700 });
  assert.deepEqual(past.items.filter(i => i.blockId === DIAL_AM).map(s => s.isTitle), [false, true]);
});

test('composeDay: 9-min remnant dropped and counted; unioned overlaps counted once; breaks and appt placeholders contribute 0', () => {
  const r = compose({ appointments: [ap('a', 621), ap('b', 640, 11)] }); // b (640–651) lies inside a (621–651): union 10:21–10:51, counted once
  assert.deepEqual(segsOf(r, DIAL_AM), [[510, 621]]); assert.equal(r.displacedByBlock[DIAL_AM], 9);
  assert.deepEqual(segsOf(r, TEXT), [[651, 675]]); assert.equal(r.displacedByBlock[TEXT], 6);
  assert.equal(r.displacedByBlock['blk_0000002'], undefined); // break
  assert.equal(r.unrecovered, 15);
  const rem = compose({ appointments: [ap('a', 519)] }); // 8:39–9:09 leaves a 9-min head 8:30–8:39 → dropped and counted
  assert.deepEqual(segsOf(rem, DIAL_AM), [[549, 630]]); assert.equal(rem.displacedByBlock[DIAL_AM], 39);
  const live = [...starter(), { id: 'blk_webby00', name: 'Webby', category: 'appt', paletteId: 'webby', startMin: 1100, durationMin: 60, deletedAt: null, remind: { enabled: true, minutesBefore: 5 } }];
  const r2 = composeDay({ live, appointments: [ap('a', 1110)], makeups: [], dayRecords: [], nowMin: 582, today: TODAY });
  assert.equal(r2.displacedByBlock['blk_webby00'], undefined); assert.equal(r2.unrecovered, 0);
});

test('composeDay: two appointments → two markers, one sum; marker on preceding ≥ 40 px else following else omitted', () => {
  const r = compose({ appointments: [ap('a', 540), ap('b', 600)] });
  assert.equal(r.displacedByBlock[DIAL_AM], 60);
  assert.deepEqual(r.markers.filter(m => m.blockId === DIAL_AM).map(m => [m.minutes, m.segmentIndex]), [[30, 0], [30, 1]]);
  const f = compose({ appointments: [ap('a', 660)] }); // Text 10:45–11:15 → 10:45–11:00 (15 min = 30 px) survives, Follow-up 11:30–12:30
  assert.deepEqual(f.markers.filter(m => m.blockId === TEXT), []);
  assert.deepEqual(f.markers.filter(m => m.blockId === FU_AM).map(m => [m.minutes, m.segmentIndex]), [[15, 0]]);
});

test('composeDay: make-up cuts are render-only (breaks, skipped blocks, un-skipped afterwards); recovered/unrecovered; make-up re-split', () => {
  const overLunch = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000001', 750, 30)] });
  assert.deepEqual(segsOf(overLunch, LUNCH), [[780, 795]]); assert.equal(overLunch.recovered, 30); assert.equal(overLunch.unrecovered, 0);
  assert.equal(overLunch.markers.some(m => m.blockId === LUNCH), false);
  assert.equal(Object.keys(overLunch.displacedByBlock).some(k => k.startsWith('mk_')), false);
  const skippedFu = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000002', 930, 30)], dayRecords: [{ kind: 'done', blockId: 'blk_0000008', status: 'skipped', day: '2026-09-08', deletedAt: null }] });
  assert.deepEqual(skippedFu.displacedByBlock, { [DIAL_AM]: 30 });
  const unskipped = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000002', 930, 30)] });
  assert.deepEqual(unskipped.displacedByBlock, { [DIAL_AM]: 30 }); assert.deepEqual(segsOf(unskipped, 'blk_0000008'), [[960, 990]]);
  const hit = compose({ appointments: [ap('a', 540), ap('b', 765, 15)], makeups: [mk('mk_0000001', 750, 30)] });
  assert.equal(hit.displacedByMakeup['mk_0000001'], 15); assert.equal(hit.recovered, 15); assert.equal(hit.unrecovered, 15);
  const gone = compose({ appointments: [ap('a', 540)], makeups: [mk('mk_0000001', 750, 30, { deletedAt: 'x' })] });
  assert.equal(gone.unrecovered, 30);
});

test('findMakeupSlot: the three pinned cases, over-a-break/skipped, afternoon first, never before now', () => {
  const live = starter();
  const slot = (o) => findMakeupSlot({ live, appointments: [], makeups: [], dayRecords: [], makeupMin: 30, nowMin: 582, today: TODAY, ...o });
  assert.deepEqual(slot({ appointments: [ap('a', 540)] }), { startMin: 750, endMin: 780 });
  const gapLive = live.filter(b => b.id !== FU_AM).map(b => b.id === TEXT ? { ...b, startMin: 645, durationMin: 60 } : b); // gap 11:45–12:30
  assert.deepEqual(findMakeupSlot({ live: gapLive, appointments: [], makeups: [], dayRecords: [], makeupMin: 30, nowMin: 582, today: TODAY }), { startMin: 720, endMin: 750 });
  assert.equal(slot({ makeupMin: 45, nowMin: 1020 }), null);
  assert.deepEqual(slot({ makeupMin: 15, nowMin: 600 }), { startMin: 750, endMin: 765 });
  // FU_AM skipped + Lunch (a break) merge into one 11:15–13:15 gap. Pass 1 (12:00 floor) offers 75 min — enough for 60, not for 90 — so 90 falls through to pass 2 and lands on the skipped morning block.
  assert.deepEqual(slot({ makeupMin: 60, dayRecords: [{ kind: 'done', blockId: FU_AM, status: 'skipped', day: TODAY, deletedAt: null }] }), { startMin: 720, endMin: 780 });
  assert.deepEqual(slot({ makeupMin: 90, dayRecords: [{ kind: 'done', blockId: FU_AM, status: 'skipped', day: TODAY, deletedAt: null }] }), { startMin: 675, endMin: 765 });
  // Lunch fully taken by a 45-min make-up and every morning block live → only the two 15-min breaks remain → null
  assert.equal(slot({ makeupMin: 30, makeups: [mk('mk_0000001', 750, 45)] }), null);
});

test('reconcileOwed: absent+0 → null; absent+>0 → open; differ → minutes/byBlock/updatedAt only; equal (even reordered keys) → null', () => {
  const day = '2026-09-08';
  assert.equal(reconcileOwed(null, { unrecovered: 0, displacedByBlock: {} }, T0, day), null);
  const fresh = reconcileOwed(null, { unrecovered: 30, displacedByBlock: { a: 30 } }, T0, day);
  assert.deepEqual(fresh, { id: `${day}|owed`, kind: 'owed', day, minutes: 30, byBlock: { a: 30 }, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: T0, deletedAt: null });
  const decided = { ...fresh, status: 'skipped', decidedAt: T0, decidedMinutes: 30, updatedAt: 'old' };
  const up = reconcileOwed(decided, { unrecovered: 60, displacedByBlock: { a: 30, b: 30 } }, 'later', day);
  assert.equal(up.minutes, 60); assert.equal(up.status, 'skipped'); assert.equal(up.decidedMinutes, 30); assert.equal(up.updatedAt, 'later');
  assert.equal(reconcileOwed({ ...up, byBlock: { b: 30, a: 30 } }, { unrecovered: 60, displacedByBlock: { a: 30, b: 30 } }, 'x', day), null);
  assert.equal(owedId(day), `${day}|owed`);
});

test('offer lifecycle (derived offerOpen, remainder-sized make-ups) — spec §7h.3 walk', () => {
  const day = '2026-09-08';
  const proj = (u) => ({ unrecovered: u, displacedByBlock: u ? { a: u } : {} });
  let stored = null;
  let st = offerState(stored, proj(30)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 30]);
  stored = applyOwedDecision(stored, 'skip', { projected: proj(30), realized: proj(0), makeupMin: 30, nowIso: T0, day });
  assert.deepEqual([stored.status, stored.decidedMinutes, stored.minutes], ['skipped', 30, 0]);
  st = offerState(stored, proj(30)); assert.equal(st.offerOpen, false);
  st = offerState(stored, proj(45)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 15]);
  st = offerState(stored, proj(30)); assert.equal(st.offerOpen, false);
  st = offerState(stored, proj(60)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 30]);
  stored = applyOwedDecision(stored, 'accept', { projected: proj(60), realized: proj(30), makeupMin: 30, nowIso: T0, day });
  assert.deepEqual([stored.status, stored.decidedMinutes], ['accepted', 30]);
  assert.equal(offerState(stored, proj(30)).offerOpen, false); // make-up recovered 30
  st = offerState(stored, proj(50)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 20]); // make-up hit by 20
  st = offerState(stored, proj(60)); assert.deepEqual([st.offerOpen, st.makeupMin], [true, 30]); // make-up removed
  const freshAccept = applyOwedDecision(null, 'accept', { projected: proj(30), realized: proj(30), makeupMin: 30, nowIso: T0, day });
  assert.deepEqual([freshAccept.status, freshAccept.decidedMinutes, freshAccept.minutes], ['accepted', 0, 30]);
  assert.equal(offerState({ ...freshAccept }, proj(0)).offerOpen, false);
  assert.equal(offerState(null, proj(0)).offerOpen, false);
  assert.equal(offerState(null, proj(7)).makeupMin, 10);
  assert.equal(offerState(null, proj(33)).makeupMin, 35);
});

const dnd = (o) => dayNotDone({ day: '2026-09-07', blocks: starter(), dayRecords: [], settings: { ...DEFAULT_SETTINGS }, tz: CHI, ...o });
const doneRec = (blockId, status = 'done', day = '2026-09-07') => ({ id: `${day}|${blockId}`, kind: 'done', day, blockId, status, updatedAt: 'x', deletedAt: null });
const owedRec = (minutes, byBlock, day = '2026-09-07', o = {}) => ({ id: `${day}|owed`, kind: 'owed', day, minutes, byBlock, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: 'x', deletedAt: null, ...o });
const allDone = (day = '2026-09-07') => starter().map(b => doneRec(b.id, 'done', day));

test('dayNotDone: displaced + unchecked, never double-counted; skipped/break/appt/inactive → 0; created-later excluded, deleted-later included', () => {
  assert.equal(dnd({ dayRecords: allDone() }).minutes, 0);
  assert.equal(dnd({ dayRecords: [...allDone(), owedRec(30, { [DIAL_AM]: 30 })] }).minutes, 30);
  const uncheckedDial = allDone().filter(r => r.blockId !== DIAL_AM);
  assert.equal(dnd({ dayRecords: [...uncheckedDial, owedRec(30, { [DIAL_AM]: 30 })] }).minutes, 120);
  assert.equal(dnd({ dayRecords: uncheckedDial }).minutes, 120);
  assert.equal(dnd({ dayRecords: uncheckedDial }).byCategory.dial, 120);
  assert.equal(dnd({ dayRecords: [...uncheckedDial.filter(r => r.blockId !== DIAL_AM), doneRec(DIAL_AM, 'skipped')] }).minutes, 0);
  assert.equal(dnd({ dayRecords: allDone().filter(r => r.blockId !== 'blk_0000002') }).minutes, 0); // break unchecked
  const total = dnd({}).minutes; // whole non-break routine: 30+120+30+75+120+60+45+15 = 495
  assert.equal(total, 495);
  assert.equal(dnd({ day: '2026-09-06', settings: { ...DEFAULT_SETTINGS, activeDays: [1, 2, 3, 4, 5] } }).minutes, 0); // Sunday, inactive → 0
  const createdToday = starter().map(b => ({ ...b, createdAt: '2026-09-08T14:00:00Z' }));
  assert.equal(dnd({ blocks: createdToday }).minutes, 0);
  const deletedToday = starter().map(b => ({ ...b, deletedAt: '2026-09-08T14:00:00Z' }));
  assert.equal(dnd({ blocks: deletedToday }).minutes, 495);
  const withMakeup = [...allDone(), { id: 'mk_0000009', kind: 'makeup', day: '2026-09-07', startMin: 750, durationMin: 30, category: 'dial', name: 'x', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null }];
  assert.equal(dnd({ dayRecords: withMakeup }).minutes, 30);
  assert.equal(dnd({ dayRecords: [...withMakeup, doneRec('mk_0000009')] }).minutes, 0);
});

test('yesterdayMiss and weeklyNotDone', () => {
  const now = Z('2026-09-08T14:42:00Z');
  const recs = [...allDone('2026-09-07').filter(r => r.blockId !== DIAL_AM), owedRec(30, { [DIAL_AM]: 30 })];
  const y = yesterdayMiss({ blocks: starter(), dayRecords: recs, settings: DEFAULT_SETTINGS, tz: CHI, now });
  assert.equal(y.minutes, 120); assert.equal(y.hidden, false); assert.equal(y.noun, 'dial time');
  assert.equal(yesterdayMiss({ blocks: starter(), dayRecords: [...recs, { id: '2026-09-08|ack', kind: 'ack', day: '2026-09-08', updatedAt: 'x', deletedAt: null }], settings: DEFAULT_SETTINGS, tz: CHI, now }).hidden, true);
  assert.equal(yesterdayMiss({ blocks: starter(), dayRecords: [...recs, doneRec('blk_0000000', 'done', '2026-09-08')], settings: DEFAULT_SETTINGS, tz: CHI, now }).hidden, true);
  const week = weeklyNotDone({ blocks: starter(), dayRecords: [...recs, ...allDone('2026-09-06'), owedRec(20, {}, '2026-09-05', { deletedAt: 'x' }), ...allDone('2026-09-05')], settings: { ...DEFAULT_SETTINGS, activeDays: [0, 1, 2, 3, 4, 5, 6] }, tz: CHI, now });
  assert.deepEqual(week.days.map(d => d.day), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']);
  assert.equal(week.days[6].minutes, 120); assert.equal(week.days[5].minutes, 0); assert.equal(week.days[4].minutes, 0);
  assert.equal(week.days[0].minutes, 495); // never opened → whole routine
  assert.equal(week.total, 495 * 4 + 120);
});
```

- [x] **Step 2: Run to verify they fail** — `node --test src/lib/routineLive.test.mjs` → import errors for the new names.

- [x] **Step 3: Append part B to `src/lib/routineLive.mjs`**

```js
// ---------- interval helpers ----------
function unionIntervals(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
function subtract([s, e], cuts) {
  const out = [];
  let cursor = s;
  for (const [a, b] of cuts) {
    if (b <= cursor || a >= e) continue;
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < e) out.push([cursor, e]);
  return out;
}
const isDisplaceable = (category) => category !== 'break' && category !== 'appt';
const px = (min) => min * 2; // PX_PER_MIN, inlined to keep this module import-light

// ---------- §7h.3 composeDay ----------
// `today` is REQUIRED: dayRecords carries 7 days and block ids are permanent, so
// done records must be scoped to today (same day-2 bug as nowState — Task 4 review).
// Callers already pass only today's live make-ups, but composeDay scopes defensively — same as dayRecords.
export function composeDay({ live = [], appointments = [], makeups = [], dayRecords = [], nowMin = 0, today }) {
  if (typeof today !== 'string') throw new TypeError('composeDay: today is required');
  const apptCuts = unionIntervals(appointments.map(a => [a.startMin, Math.min(1440, a.startMin + a.durationMin)]));
  const liveMk = makeups.filter(m => m && !m.deletedAt && m.day === today);
  const mkCuts = unionIntervals(liveMk.map(m => [m.startMin, m.startMin + m.durationMin]));
  const doneById = new Map(dayRecords.filter(r => r && r.kind === 'done' && !r.deletedAt && r.day === today).map(r => [r.blockId, r.status]));
  const displacedByBlock = {};
  const markers = [];
  const items = [];

  const pushSegments = (kind, owner, ownerKey, segs) => {
    const ti = segs.findIndex(([, e]) => e > nowMin);
    const titleIdx = ti === -1 ? segs.length - 1 : ti;
    segs.forEach(([s, e], i) => items.push({
      kind, id: `${ownerKey}#${i}`, [kind === 'segment' ? 'blockId' : 'makeupId']: ownerKey,
      [kind === 'segment' ? 'block' : 'makeup']: owner,
      category: owner.category, name: owner.name, startMin: s, endMin: e, index: i,
      isTitle: i === titleIdx, isFirst: i === 0, isLast: i === segs.length - 1,
      done: doneById.get(ownerKey) || null,
    }));
  };

  for (const b of live) {
    if (!b || b.deletedAt) continue;
    const full = [b.startMin, b.startMin + b.durationMin];
    const keptA = subtract(full, apptCuts).filter(([s, e]) => e - s >= MIN_SEG);
    const survived = keptA.reduce((n, [s, e]) => n + (e - s), 0);
    const displaced = b.durationMin - survived;
    const segs = keptA.flatMap(seg => subtract(seg, mkCuts)).filter(([s, e]) => e - s >= MIN_SEG);
    if (isDisplaceable(b.category) && displaced > 0) {
      displacedByBlock[b.id] = displaced;
      for (const [as, ae] of apptCuts) {
        const os = Math.max(as, full[0]), oe = Math.min(ae, full[1]);
        if (oe <= os) continue;
        let idx = -1;
        for (let i = segs.length - 1; i >= 0; i--) if (segs[i][1] <= os) { idx = i; break; }
        if (idx >= 0 && px(segs[idx][1] - segs[idx][0]) < 40) idx = -1;
        if (idx === -1) { const f = segs.findIndex(([s]) => s >= oe); if (f >= 0 && px(segs[f][1] - segs[f][0]) >= 40) idx = f; }
        if (idx >= 0) markers.push({ blockId: b.id, segmentIndex: idx, minutes: oe - os, apptStart: as });
      }
    }
    pushSegments('segment', b, b.id, segs);
  }

  // Overlapping make-ups (same slot, e.g. a re-offer): render once and recover once. Each
  // make-up is cut by the APPOINTMENT-CUT (keptA) segments of every make-up already processed —
  // never the full span — so a prior make-up's sub-MIN_SEG remnant (dropped, unrendered) can't
  // still cut a later one. Priority order = updatedAt asc, id asc — same tie-break as resolveOverlaps.
  const displacedByMakeup = {};
  let recovered = 0;
  const orderedMk = [...liveMk].sort((a, b) =>
    String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) || String(a.id).localeCompare(String(b.id)));
  let priorMk = [];
  for (const m of orderedMk) {
    const full = [m.startMin, m.startMin + m.durationMin];
    const keptA = subtract(full, apptCuts).filter(([s, e]) => e - s >= MIN_SEG);
    displacedByMakeup[m.id] = m.durationMin - keptA.reduce((n, [s, e]) => n + (e - s), 0);
    const kept = keptA.flatMap(seg => subtract(seg, priorMk)).filter(([s, e]) => e - s >= MIN_SEG);
    pushSegments('makeup', m, m.id, kept);
    recovered += kept.reduce((n, [s, e]) => n + (e - s), 0);
    priorMk = unionIntervals([...priorMk, ...keptA]);
  }

  for (const a of appointments) items.push({ kind: 'appt', id: `appt|${a.prospectId}|${a.startMin}`, ...a, endMin: Math.min(1440, a.startMin + a.durationMin) }); // a 23:45 appointment never hangs below the lane
  items.sort((x, y) => x.startMin - y.startMin || ((y.kind === 'appt') - (x.kind === 'appt')));

  const totalDisplaced = Object.values(displacedByBlock).reduce((n, v) => n + v, 0);
  const unrecovered = Math.max(0, totalDisplaced - recovered);
  return { items, displacedByBlock, displacedByMakeup, recovered, unrecovered, markers };
}

// ---------- §7h.3 findMakeupSlot ----------
export function findMakeupSlot({ live = [], appointments = [], makeups = [], dayRecords = [], makeupMin, nowMin, today }) {
  if (typeof today !== 'string') throw new TypeError('findMakeupSlot: today is required');
  const blocks = live.filter(b => b && !b.deletedAt).sort((a, b) => a.startMin - b.startMin);
  if (!blocks.length || !(makeupMin > 0)) return null;
  const spanStart = Math.max(nowMin, blocks[0].startMin);
  const spanEnd = Math.max(...blocks.map(b => b.startMin + b.durationMin));
  if (spanEnd - spanStart < makeupMin) return null;
  const skipped = new Set(dayRecords.filter(r => r && r.kind === 'done' && !r.deletedAt && r.status === 'skipped' && r.day === today).map(r => r.blockId));
  const covered = unionIntervals([
    ...appointments.map(a => [a.startMin, a.startMin + a.durationMin]),
    ...makeups.filter(m => m && !m.deletedAt && m.day === today).map(m => [m.startMin, m.startMin + m.durationMin]),
    ...blocks.filter(b => b.category !== 'break' && !skipped.has(b.id)).map(b => [b.startMin, b.startMin + b.durationMin]),
  ]);
  const gaps = subtract([spanStart, spanEnd], covered);
  for (const floor of [720, 0]) {
    for (const [gs, ge] of gaps) {
      const s = ceil5(Math.max(gs, floor, nowMin));
      if (ge - s >= makeupMin) return { startMin: s, endMin: s + makeupMin };
    }
  }
  return null;
}

// ---------- §7h.3 owed record ----------
export const owedId = (day) => `${day}|owed`;
const cleanByBlock = (obj) => { const out = {}; for (const [k, v] of Object.entries(obj || {})) if (v > 0) out[k] = v; return out; };
function sameByBlock(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  return ka.every(k => Number((a || {})[k]) === Number((b || {})[k]));
}

// realized = composeDay over STARTED appointments only. Never changes status.
export function reconcileOwed(stored, realized, nowIso, day) {
  const minutes = realized.unrecovered;
  const byBlock = cleanByBlock(realized.displacedByBlock);
  if (!stored || stored.deletedAt) {
    if (minutes === 0) return null;
    return { id: owedId(day), kind: 'owed', day, minutes, byBlock, status: 'open', decidedAt: null, decidedMinutes: null, updatedAt: nowIso, deletedAt: null };
  }
  if (Number(stored.minutes) === minutes && sameByBlock(stored.byBlock, byBlock)) return null;
  return { ...stored, minutes, byBlock, updatedAt: nowIso };
}

// projected = composeDay over ALL of today's items. Derived, never stored.
export function offerState(stored, projected) {
  const decided = stored && !stored.deletedAt ? (stored.decidedMinutes ?? 0) : 0;
  const remainder = projected.unrecovered - decided;
  return { offerOpen: remainder > 0, makeupMin: Math.max(10, ceil5(Math.max(0, remainder))), decidedMinutes: decided };
}

// decision ∈ 'skip' | 'accept'. Creates the record when absent.
export function applyOwedDecision(stored, decision, { projected, realized, makeupMin, nowIso, day }) {
  if (decision !== 'skip' && decision !== 'accept') throw new TypeError('applyOwedDecision: unknown decision ' + String(decision));
  const base = stored && !stored.deletedAt ? { ...stored } : {
    id: owedId(day), kind: 'owed', day, minutes: realized.unrecovered, byBlock: cleanByBlock(realized.displacedByBlock),
    status: 'open', decidedAt: null, decidedMinutes: null, deletedAt: null,
  };
  if (decision === 'skip') return { ...base, status: 'skipped', decidedAt: nowIso, decidedMinutes: projected.unrecovered, updatedAt: nowIso };
  return { ...base, status: 'accepted', decidedAt: nowIso, decidedMinutes: Math.max(0, projected.unrecovered - makeupMin), updatedAt: nowIso };
}

// ---------- §7h.4 / §7h.5 not-done accounting ----------
function nounFor(byCategory) {
  const cats = Object.entries(byCategory).filter(([, v]) => v > 0).map(([k]) => k);
  if (cats.length && cats.every(c => c === 'dial')) return 'dial time';
  if (cats.length && cats.every(c => c === 'followup')) return 'follow-up time';
  return 'routine time';
}

// settings must be sanitized (sanitizeSettings); undefined activeDays scores every day 0. byBlock/byCategory carry GROSS displaced minutes per block (they feed nounFor and diagnostics); `minutes` is the authoritative total.
export function dayNotDone({ day, blocks = [], dayRecords = [], settings, tz }) {
  const empty = { minutes: 0, byBlock: {}, byCategory: {}, noun: 'routine time' };
  if (!(settings?.activeDays || []).includes(localWeekday(day))) return empty;
  const dayEnd = zonedTimeToUtc(addDays(day, 1), 0, tz);
  const recs = dayRecords.filter(r => r && r.day === day && !r.deletedAt);
  const owed = recs.find(r => r.kind === 'owed');
  const byBlock = cleanByBlock(owed?.byBlock);
  const byCategory = {};
  const add = (cat, n) => { if (n > 0) byCategory[cat] = (byCategory[cat] || 0) + n; };
  let minutes = owed ? Math.max(0, Number(owed.minutes) || 0) : 0;
  const catOf = new Map(blocks.map(b => [b.id, b.category]));
  for (const [id, n] of Object.entries(byBlock)) add(catOf.get(id) || 'other', n);
  const decided = new Set(recs.filter(r => r.kind === 'done' && (r.status === 'done' || r.status === 'skipped')).map(r => r.blockId));
  const t = (iso) => new Date(iso || 0).getTime();
  for (const b of blocks) {
    if (!b || !isDisplaceable(b.category) || decided.has(b.id)) continue;
    if (t(b.createdAt) > dayEnd) continue;
    if (b.deletedAt && t(b.deletedAt) <= dayEnd) continue;
    const part = Math.max(0, b.durationMin - (byBlock[b.id] || 0));
    if (!part) continue;
    minutes += part; byBlock[b.id] = (byBlock[b.id] || 0) + part; add(b.category, part);
  }
  for (const m of recs.filter(r => r.kind === 'makeup')) {
    if (decided.has(m.id)) continue;
    minutes += m.durationMin; byBlock[m.id] = m.durationMin; add(m.category || 'other', m.durationMin);
  }
  return { minutes, byBlock, byCategory, noun: nounFor(byCategory) };
}

export function yesterdayMiss({ blocks, dayRecords, settings, tz, now }) {
  const today = localDayKey(now, tz);
  const r = dayNotDone({ day: addDays(today, -1), blocks, dayRecords, settings, tz });
  const hidden = dayRecords.some(x => x && x.day === today && !x.deletedAt && (x.kind === 'ack' || (x.kind === 'done' && (x.status === 'done' || x.status === 'skipped'))));
  return { ...r, hidden };
}

export function weeklyNotDone({ blocks, dayRecords, settings, tz, now }) {
  const today = localDayKey(now, tz);
  const days = [];
  for (let i = 7; i >= 1; i--) {
    const day = addDays(today, -i);
    days.push({ day, minutes: dayNotDone({ day, blocks, dayRecords, settings, tz }).minutes });
  }
  return { days, total: days.reduce((n, d) => n + d.minutes, 0) };
}
```

- [x] **Step 4: Run to verify it passes** — `node --test src/lib/routineLive.test.mjs` → 19 pass (10 + 9). This exact code and these exact tests were executed together during plan review and passed 19/19 under `TZ=UTC`, `TZ=America/Chicago`, and `TZ=Pacific/Auckland`; a red here means a transcription slip — diff your copy against the plan before changing either side. `npm test` → 809 pass.

- [x] **Step 5: Commit**

```bash
git add src/lib/routineLive.mjs src/lib/routineLive.test.mjs
git commit -m "feat(routine): routineLive part B — composeDay, make-up slot, owed model, not-done accounting (spec §7h.3-5)"
```

---

## Task 7: `routineTick.mjs` — candidates, due, cooldown slot sets, freeze, payloads

**Spec:** §6b.2–6b.4, §6b.6 copy, §6c pins.

**Files:**
- Create: `src/lib/routineTick.mjs`, `src/lib/routineTick.test.mjs`

- [x] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickAgent, buildPayload, classifySend, retryEligible, LOOKAHEAD_SEC, GRACE_MIN } from './routineTick.mjs';
import { DEFAULT_SETTINGS, instantiateTemplate } from './routineModel.mjs';
import { STARTER_TEMPLATE } from './routineTemplates.mjs';

const CHI = 'America/Chicago';
const Z = (s) => Date.parse(s);
const T0 = '2026-09-08T12:00:00.000Z';
const starter = () => STARTER_TEMPLATE.entries.map((e, i) => ({ ...instantiateTemplate(e, { now: T0, defaultMinutesBefore: 5 }), id: 'blk_' + String(i).padStart(7, '0') }));
const DIAL_AM = 'blk_0000001';
const S = { ...DEFAULT_SETTINGS, timezone: CHI };
const run = (o) => tickAgent({ canAccess: true, settings: S, blocks: starter(), dayRecords: [], apptRows: [], logRows: [], subs: [{ endpoint: 'e' }], now: Z('2026-09-08T13:25:00Z'), readAt: '2026-09-08T13:25:00.000Z', ...o });
const keys = (r) => r.due.map(d => d.fire_key);

test('skips: not_entitled and bad_tz stop compose; disabled / no_subs stop sends only', () => {
  assert.equal(run({ canAccess: false }).skip, 'not_entitled');
  assert.equal(run({ settings: { ...S, timezone: null } }).skip, 'bad_tz');
  assert.equal(run({ settings: { ...S, timezone: 'Mars/Olympus' } }).skip, 'bad_tz');
  const off = run({ settings: { ...S, remindersEnabled: false } });
  assert.equal(off.skip, null); assert.equal(off.sendSkip, 'disabled'); assert.equal(off.composeEligible, true);
  const noSubs = run({ subs: [] });
  assert.equal(noSubs.sendSkip, 'no_subs'); assert.equal(noSubs.due.length, 1); // computed, not sent
});

test('lead 5: due at T−5 with the wall-clock instant; not at T−6; T+9 fires "started"; T+11 aged out; key shape', () => {
  const at = (iso) => run({ now: Z(iso), readAt: iso });
  assert.deepEqual(keys(at('2026-09-08T13:25:00Z')), [`${DIAL_AM}|2026-09-08|505|${CHI}`]);
  assert.deepEqual(keys(at('2026-09-08T13:24:10Z')), []);
  assert.deepEqual(keys(at('2026-09-08T13:24:20Z')), [`${DIAL_AM}|2026-09-08|505|${CHI}`]); // 45 s lookahead
  const late = at('2026-09-08T13:39:00Z');
  assert.equal(late.due[0].block_id, DIAL_AM); assert.equal(late.due[0].fireAt, Z('2026-09-08T13:25:00Z'));
  assert.deepEqual(keys(at('2026-09-08T13:41:00Z')), []);
});

test('lead 15 and the midnight clamp; 10-min block at T+6 aged out (half-duration grace)', () => {
  const blocks = [{ ...starter()[0], id: 'blk_early00', startMin: 5, durationMin: 10, remind: { enabled: true, minutesBefore: 15 } }];
  const r = run({ blocks, now: Z('2026-09-08T05:00:20Z'), readAt: '2026-09-08T05:00:20.000Z' });
  assert.equal(r.due[0].fireAt, Z('2026-09-08T05:00:00Z')); assert.equal(r.due[0].fireMin, 0);
  assert.deepEqual(keys(run({ blocks, now: Z('2026-09-08T05:11:00Z') })), []);
});

test('activeDays: inactive day → no routine candidates but appointments still remind and freeze', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T08:30', archivedAt: null }];
  const r = run({ settings: { ...S, activeDays: [] }, apptRows: rows });
  assert.deepEqual(keys(r), [`appt|p1|2026-09-08|505|${CHI}`]);
  assert.equal(r.due[0].block_id, 'appt:p1');
});

test('head-eaten → 8:55 for the 9:00 segment, key stable across ticks and across the freeze; whole-eaten → none', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T08:30', archivedAt: null }];
  const a = run({ apptRows: rows, now: Z('2026-09-08T13:55:00Z'), readAt: 'x' });
  assert.ok(keys(a).includes(`${DIAL_AM}|2026-09-08|535|${CHI}`));
  const frozen = [{ id: '2026-09-08|appt|p1|510', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 510, durationMin: 30, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: null }];
  const b = run({ apptRows: [], dayRecords: frozen, now: Z('2026-09-08T13:55:00Z'), readAt: 'x' });
  assert.ok(keys(b).includes(`${DIAL_AM}|2026-09-08|535|${CHI}`));
  const whole = run({ apptRows: [{ ...rows[0], appointmentTime: '2026-09-08T08:00' }], dayRecords: [{ id: '2026-09-08|appt|p1|480', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 480, durationMin: 150, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: null }], now: Z('2026-09-08T13:25:00Z') });
  assert.equal(keys(whole).some(k => k.startsWith(DIAL_AM)), false);
});

test('already_done, already_held, make-up fires from routine_day_v1 with the default lead', () => {
  assert.equal(run({ dayRecords: [{ id: `2026-09-08|${DIAL_AM}`, kind: 'done', blockId: DIAL_AM, status: 'skipped', day: '2026-09-08', updatedAt: 'x', deletedAt: null }] }).skipped.already_done, 1); // every day record carries its id — sanitizeDay drops idless rows
  const held = [{ id: '2026-09-08|appt|p1|510', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 510, durationMin: 30, source: 'derived', heldAt: 'x', updatedAt: 'x', deletedAt: null }];
  const h = run({ dayRecords: held, now: Z('2026-09-08T13:26:00Z') });
  assert.equal(h.skipped.already_held, 1);
  const mk = [{ id: 'mk_0000001', kind: 'makeup', day: '2026-09-08', startMin: 750, durationMin: 30, category: 'dial', name: 'Dial block (make-up)', ofBlockId: DIAL_AM, updatedAt: 'x', deletedAt: null }];
  const m = run({ dayRecords: mk, now: Z('2026-09-08T17:25:00Z') });
  assert.deepEqual(keys(m), [`mk_0000001|2026-09-08|745|${CHI}`]);
});

test('un-attached appt placeholder reminds name-free; attached → no routine candidate; attached with empty appointmentTime → one appt candidate', () => {
  // Drop the 13:15–15:15 Dial so a 14:00 placeholder can be live (two live blocks never overlap — resolveOverlaps would move it).
  const blocks = [...starter().filter(b => b.id !== 'blk_0000006'), { ...starter()[0], id: 'blk_webby00', name: 'Ana Diaz webby', category: 'appt', paletteId: 'webby', startMin: 840, durationMin: 60 }];
  const un = run({ blocks, now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  const c = un.due.find(d => d.block_id === 'blk_webby00');
  assert.ok(c); assert.equal(c.kind, 'placeholder');
  const pl = buildPayload(c, null, Z('2026-09-08T18:55:00Z'), 'https://app.primtracker.com');
  assert.equal(pl.title, 'PRIM'); assert.equal(pl.body, 'Appointment in 5 min'); assert.equal(pl.tag, 'routine-blk_webby00'); assert.ok(!JSON.stringify(pl).includes('Ana'));
  const att = run({ blocks, dayRecords: [{ id: '2026-09-08|attach|blk_webby00', kind: 'attach', day: '2026-09-08', blockId: 'blk_webby00', prospectId: 'p9', updatedAt: 'x', deletedAt: null }], now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  assert.deepEqual(keys(att), [`appt|p9|2026-09-08|835|${CHI}`]);
});

test('"then an appointment at 10:00" when the next item is an appointment or an appt block; routine copy variants', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T10:30', archivedAt: null, name: 'Ana' }];
  const r = run({ apptRows: rows, now: Z('2026-09-08T13:25:00Z'), readAt: 'x' });
  const dial = r.due.find(d => d.block_id === DIAL_AM);
  const p = buildPayload(dial, dial.next, Z('2026-09-08T13:25:00Z'), 'https://app.primtracker.com');
  assert.equal(p.title, 'Dial block starts in 5 min');
  assert.equal(p.body, '8:30–10:30 · then an appointment at 10:30');
  assert.equal(p.url, 'https://app.primtracker.com/?view=routine'); assert.equal(p.tag, `routine-${DIAL_AM}`); assert.equal(p.urgent, false);
  const now = buildPayload({ ...dial, startAt: Z('2026-09-08T13:25:00Z') }, null, Z('2026-09-08T13:25:10Z'), 'x');
  assert.equal(now.title, 'Dial block starts now');
  const ago = buildPayload({ ...dial, startAt: Z('2026-09-08T13:16:00Z') }, { kind: 'segment', name: 'Break', startMin: 630 }, Z('2026-09-08T13:25:00Z'), 'x');
  assert.equal(ago.title, 'Dial block started 9 min ago'); assert.equal(ago.body, '8:30–10:30 · then Break at 10:30');
  assert.ok(!JSON.stringify(p).includes('Ana'));
  const ap = buildPayload(r.due.find(d => d.block_id === 'appt:p1') || { kind: 'appt', block_id: 'appt:p1', prospectId: 'p1', startAt: Z('2026-09-08T15:30:00Z') }, null, Z('2026-09-08T15:25:00Z'), 'x');
  assert.equal(ap.body, 'Appointment in 5 min'); assert.equal(ap.tag, 'appt-p1');
});

test('cooldown on instants, and slot sets absorb placeholder ↔ attached transitions', () => {
  const now = Z('2026-09-08T13:25:00Z');
  const row = (block_id, fire_key, fire_at_utc, status = 'sent') => ({ block_id, fire_key, fire_at_utc, status });
  // Dial moved 8:30→8:45 (fireMin 505→520): 15 min apart → absorbed; 8:30→10:30 → 120 → re-arms
  const moved = starter().map(b => b.id === DIAL_AM ? { ...b, startMin: 525 } : b);
  const a = run({ blocks: moved, logRows: [row(DIAL_AM, `${DIAL_AM}|2026-09-08|505|${CHI}`, '2026-09-08T13:25:00Z')], now: Z('2026-09-08T13:40:00Z'), readAt: 'x' });
  assert.equal(a.skipped.cooldown, 1);
  const far = starter().map(b => b.id === DIAL_AM ? { ...b, startMin: 630 } : b).filter(b => b.id !== 'blk_0000002');
  const b = run({ blocks: far, logRows: [row(DIAL_AM, `${DIAL_AM}|2026-09-08|505|${CHI}`, '2026-09-08T13:25:00Z')], now: Z('2026-09-08T15:25:00Z'), readAt: 'x' });
  assert.equal(b.skipped.cooldown, 0); assert.ok(keys(b).includes(`${DIAL_AM}|2026-09-08|625|${CHI}`));
  const blocks = [...starter().filter(b => b.id !== 'blk_0000006'), { ...starter()[0], id: 'blk_webby00', name: 'Webby', category: 'appt', paletteId: 'webby', startMin: 840, durationMin: 60 }]; // no overlap with the afternoon Dial
  const attachRec = { id: '2026-09-08|attach|blk_webby00', kind: 'attach', day: '2026-09-08', blockId: 'blk_webby00', prospectId: 'p9', updatedAt: 'x', deletedAt: null };
  // attached push sent at 13:55; Remove-from-today at 14:05 → placeholder candidate absorbed
  const removed = run({ blocks, dayRecords: [{ ...attachRec, deletedAt: 'y' }, { id: '2026-09-08|appt|p9|840', kind: 'appt', day: '2026-09-08', prospectId: 'p9', startMin: 840, durationMin: 60, source: 'attached', heldAt: null, updatedAt: 'x', deletedAt: 'y' }], logRows: [row('appt:p9', `appt|p9|2026-09-08|835|${CHI}`, '2026-09-08T18:55:00Z')], now: Z('2026-09-08T19:05:00Z'), readAt: 'x' });
  assert.equal(removed.skipped.cooldown, 1); assert.equal(keys(removed).some(k => k.startsWith('blk_webby00')), false);
  // placeholder push at 13:55; attach at 13:57 → attached candidate absorbed
  const attachedAfter = run({ blocks, dayRecords: [attachRec], logRows: [row('blk_webby00', `blk_webby00|2026-09-08|835|${CHI}`, '2026-09-08T18:55:00Z')], now: Z('2026-09-08T18:57:00Z'), readAt: 'x' });
  assert.equal(attachedAfter.skipped.cooldown, 1);
  // attached push at 13:55; Detach at 13:57 → the placeholder's own candidate is absorbed
  const detached = run({ blocks, dayRecords: [{ ...attachRec, deletedAt: 'y' }], logRows: [row('appt:p9', `appt|p9|2026-09-08|835|${CHI}`, '2026-09-08T18:55:00Z')], now: Z('2026-09-08T18:57:00Z'), readAt: 'x' });
  assert.equal(detached.skipped.cooldown, 1);
  // attach at 10:30 for a 14:00 block → fires normally at 13:55
  const early = run({ blocks, dayRecords: [attachRec], logRows: [], now: Z('2026-09-08T18:55:00Z'), readAt: 'x' });
  assert.ok(keys(early).includes(`appt|p9|2026-09-08|835|${CHI}`));
});

test('DST pins (spec §6c): endAt/fireAt are instant offsets from a zonedTimeToUtc start', () => {
  const NY = 'America/New_York', SN = { ...S, timezone: NY };
  const b = (startMin, lead = 5) => [{ ...starter()[0], id: 'blk_dst0000', startMin, durationMin: 30, remind: { enabled: true, minutesBefore: lead } }];
  const a = run({ settings: SN, blocks: b(150), now: Z('2026-03-08T07:25:00Z'), readAt: 'x' }).due[0]; // 02:30 NY in the spring gap
  assert.deepEqual([a.fireAt, a.startAt, a.endAt], [Z('2026-03-08T07:25:00Z'), Z('2026-03-08T07:30:00Z'), Z('2026-03-08T08:00:00Z')]);
  assert.equal(run({ settings: SN, blocks: b(180), now: Z('2026-03-08T06:55:00Z'), readAt: 'x' }).due[0].fireAt, Z('2026-03-08T06:55:00Z'));
  assert.equal(run({ settings: SN, blocks: b(120), now: Z('2026-11-01T06:55:00Z'), readAt: 'x' }).due[0].fireAt, Z('2026-11-01T06:55:00Z'));
});

test('a 23:50 10-min block seen at 00:03 has ended; there is no previous-day pass', () => {
  const late = [{ ...starter()[0], id: 'blk_late000', startMin: 1430, durationMin: 10, remind: { enabled: true, minutesBefore: 5 } }];
  assert.equal(run({ blocks: late, now: Z('2026-09-09T05:03:00Z'), readAt: 'x' }).due.length, 0);
});

test('freeze: first tick writes appt (updatedAt = start instant, no expect) + owed (updatedAt = readAt, expect null); second tick nothing; later collision refreshes minutes with expect; cancelled-before-start never counts', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T09:00', archivedAt: null }];
  const t1 = run({ apptRows: rows, now: Z('2026-09-08T14:00:30Z'), readAt: '2026-09-08T14:00:05.000Z' });
  assert.equal(t1.freezeRecords.length, 2);
  const appt = t1.freezeRecords.find(r => r.kind === 'appt');
  assert.equal(appt.id, '2026-09-08|appt|p1|540'); assert.equal(appt.updatedAt, new Date(Z('2026-09-08T14:00:00Z')).toISOString()); assert.equal('expect' in appt, false); assert.equal(appt.heldAt, null);
  const owed = t1.freezeRecords.find(r => r.kind === 'owed');
  assert.deepEqual([owed.minutes, owed.status, owed.updatedAt, owed.expect], [30, 'open', '2026-09-08T14:00:05.000Z', null]);
  const stored = [ { ...appt }, { ...owed, expect: undefined } ].map(r => { const c = { ...r }; delete c.expect; return c; });
  const t2 = run({ apptRows: rows, dayRecords: stored, now: Z('2026-09-08T14:01:30Z'), readAt: 'x' });
  assert.equal(t2.freezeRecords.length, 0);
  const reordered = stored.map(r => r.kind === 'owed' ? { ...r, byBlock: Object.fromEntries(Object.entries(r.byBlock).reverse()) } : r);
  assert.equal(run({ apptRows: rows, dayRecords: reordered, now: Z('2026-09-08T14:01:30Z'), readAt: 'x' }).freezeRecords.length, 0);
  const rows2 = [...rows, { id: 'p2', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T13:30', archivedAt: null }];
  const t3 = run({ apptRows: rows2, dayRecords: stored, now: Z('2026-09-08T18:30:30Z'), readAt: '2026-09-08T18:30:05.000Z' });
  const owed2 = t3.freezeRecords.find(r => r.kind === 'owed');
  assert.deepEqual([owed2.minutes, owed2.expect, owed2.updatedAt], [60, owed.updatedAt, '2026-09-08T18:30:05.000Z']);
  const decided = stored.map(r => r.kind === 'owed' ? { ...r, status: 'skipped', decidedAt: 'd', decidedMinutes: 30, updatedAt: 'D' } : r);
  const t4 = run({ apptRows: rows2, dayRecords: decided, now: Z('2026-09-08T18:30:30Z'), readAt: 'r' });
  const o4 = t4.freezeRecords.find(r => r.kind === 'owed');
  assert.deepEqual([o4.status, o4.decidedMinutes, o4.expect, o4.minutes], ['skipped', 30, 'D', 60]);
  const future = run({ apptRows: [{ ...rows[0], appointmentTime: '2026-09-08T14:00' }], now: Z('2026-09-08T14:00:30Z'), readAt: 'x' });
  assert.equal(future.freezeRecords.length, 0);
});

test('a frozen (tombstoned) id is never re-frozen; reminders off + no subs still freeze', () => {
  const rows = [{ id: 'p1', stage: 'APPOINTMENT_SET', appointmentTime: '2026-09-08T09:00', archivedAt: null }];
  const tomb = [{ id: '2026-09-08|appt|p1|540', kind: 'appt', day: '2026-09-08', prospectId: 'p1', startMin: 540, durationMin: 30, source: 'derived', heldAt: null, updatedAt: 'x', deletedAt: 'y' }];
  assert.equal(run({ apptRows: rows, dayRecords: tomb, now: Z('2026-09-08T14:05:00Z'), readAt: 'x' }).freezeRecords.length, 0);
  const off = run({ apptRows: rows, settings: { ...S, remindersEnabled: false }, subs: [], now: Z('2026-09-08T14:00:30Z'), readAt: 'x' });
  assert.equal(off.freezeRecords.length, 2); assert.equal(off.sendSkip, 'disabled');
});

test('Wisconsin vs Florida same 8:30 → different instants and keys', () => {
  const wi = run({ now: Z('2026-09-08T13:25:00Z') }).due[0];
  const fl = run({ settings: { ...S, timezone: 'America/New_York' }, now: Z('2026-09-08T12:25:00Z'), readAt: 'x' }).due[0];
  assert.equal(wi.fireAt - fl.fireAt, 3600000); assert.notEqual(wi.fire_key, fl.fire_key);
});

test('classifySend + retryEligible', () => {
  assert.deepEqual(classifySend({ sentCount: 1, failures: [] }), { status: 'sent', attempts: 1, error: null });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 503 }] }), { status: 'failed', attempts: 1, error: '503' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [{ statusCode: 400 }] }), { status: 'failed', attempts: 2, error: '400' });
  assert.deepEqual(classifySend({ sentCount: 0, failures: [], allDead: true }), { status: 'failed', attempts: 1, error: 'all_subs_dead' });
  const now = Z('2026-09-08T13:30:00Z');
  assert.equal(retryEligible({ status: 'failed', attempts: 1, created_at: '2026-09-08T13:25:00Z' }, now), true);
  assert.equal(retryEligible({ status: 'failed', attempts: 2, created_at: '2026-09-08T13:25:00Z' }, now), false);
  assert.equal(retryEligible({ status: 'claimed', attempts: 1, created_at: '2026-09-08T13:27:30Z' }, now), true);
  assert.equal(retryEligible({ status: 'claimed', attempts: 1, created_at: '2026-09-08T13:29:00Z' }, now), false);
  assert.equal(retryEligible({ status: 'sent', attempts: 1, created_at: '2026-09-08T13:25:00Z' }, now), false);
  assert.equal(LOOKAHEAD_SEC, 45); assert.equal(GRACE_MIN, 10);
});
```

- [x] **Step 2: Run to verify it fails** — module-not-found.

- [x] **Step 3: Implement `src/lib/routineTick.mjs`**

```js
// Routine tick core (spec §6b). Pure — the route does IO around tickAgent().
import { isValidTimeZone, localDayKey, localMinuteOfDay, localWeekday, zonedTimeToUtc } from './tz.mjs';
import { sanitizeSettings, sanitizeDay, liveBlocks } from './routineModel.mjs';
import { todaysAppointments, composeDay, reconcileOwed, apptRecordId, owedId } from './routineLive.mjs';
import { formatRange, formatTime } from './routineClock.mjs';

export const LOOKAHEAD_SEC = 45;
export const GRACE_MIN = 10;
export const COOLDOWN_MIN = 15;
export const STALE_CLAIM_MIN = 2;
export const LOG_WINDOW_MIN = 60;
export const APPT_LEAD_MIN = 5;
export const APPT_DEFAULT_MIN = 30;

const MIN = 60000;

export function tickAgent({ canAccess, settings: rawSettings, blocks, dayRecords, apptRows, logRows = [], subs = [], now, readAt }) {
  if (typeof readAt !== 'string') throw new TypeError('tickAgent: readAt is required');
  const skipped = { already_done: 0, already_held: 0, cooldown: 0 };
  const out = { skip: null, composeEligible: false, sendSkip: null, tz: null, today: null, candidates: [], due: [], skipped, freezeRecords: [], items: [] };
  if (canAccess !== true) return { ...out, skip: 'not_entitled' };
  const settings = sanitizeSettings(rawSettings);
  if (!isValidTimeZone(settings.timezone)) return { ...out, skip: 'bad_tz' };
  const tz = settings.timezone;
  const nowIso = new Date(now).toISOString();
  const today = localDayKey(now, tz);
  const nowMin = localMinuteOfDay(now, tz);
  const dayStart = zonedTimeToUtc(today, 0, tz);
  const live = liveBlocks(blocks, nowIso);
  const liveForCompose = settings.activeDays.includes(localWeekday(today)) ? live : [];
  const day = sanitizeDay(dayRecords, today, nowIso);
  const items = todaysAppointments({ prospectRows: apptRows, blocks: live, dayRecords: day, settings, tz, now });
  const makeups = day.filter(r => r.kind === 'makeup' && r.day === today && !r.deletedAt);
  const projected = composeDay({ live: liveForCompose, appointments: items, makeups, dayRecords: day, nowMin, today });
  const attachesToday = day.filter(r => r.kind === 'attach' && r.day === today); // live + tombstoned
  const attachedLive = new Set(attachesToday.filter(r => !r.deletedAt).map(r => r.blockId));
  const doneById = new Map(day.filter(r => r.kind === 'done' && r.day === today && !r.deletedAt).map(r => [r.blockId, r.status]));
  const nextAfter = (endMin) => projected.items.find(it => it.startMin >= endMin) || null;

  const candidates = [];
  for (const it of projected.items) {
    if (it.kind === 'segment' && it.isFirst) {
      const b = it.block;
      if (!b.remind?.enabled) continue;
      if (b.category === 'appt' && attachedLive.has(b.id)) continue;
      const lead = b.remind.minutesBefore;
      const startAt = zonedTimeToUtc(today, it.startMin, tz);
      const slotSet = new Set([b.id, ...attachesToday.filter(r => r.blockId === b.id).map(r => `appt:${r.prospectId}`)]);
      candidates.push({ kind: b.category === 'appt' ? 'placeholder' : 'routine', block_id: b.id, name: b.name, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.endMin - it.startMin,
        startAt, endAt: startAt + (it.endMin - it.startMin) * MIN, fireMin: Math.max(0, it.startMin - lead), fireAt: Math.max(startAt - lead * MIN, dayStart),
        fire_key: `${b.id}|${today}|${Math.max(0, it.startMin - lead)}|${tz}`, done: doneById.get(b.id) || null, heldAt: null, slotSet, next: nextAfter(it.endMin) });
    } else if (it.kind === 'makeup' && it.isFirst) {
      const m = it.makeup, lead = settings.defaultMinutesBefore;
      const startAt = zonedTimeToUtc(today, it.startMin, tz);
      candidates.push({ kind: 'makeup', block_id: m.id, name: m.name, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.endMin - it.startMin,
        startAt, endAt: startAt + (it.endMin - it.startMin) * MIN, fireMin: Math.max(0, it.startMin - lead), fireAt: Math.max(startAt - lead * MIN, dayStart),
        fire_key: `${m.id}|${today}|${Math.max(0, it.startMin - lead)}|${tz}`, done: doneById.get(m.id) || null, heldAt: null, slotSet: new Set([m.id]), next: nextAfter(it.endMin) });
    } else if (it.kind === 'appt') {
      const slotSet = new Set([`appt:${it.prospectId}`, ...attachesToday.filter(r => r.prospectId === it.prospectId).map(r => r.blockId)]);
      candidates.push({ kind: 'appt', block_id: `appt:${it.prospectId}`, prospectId: it.prospectId, segStartMin: it.startMin, segEndMin: it.endMin, segDur: it.durationMin,
        startAt: it.instant, endAt: it.instant + it.durationMin * MIN, fireMin: Math.max(0, it.startMin - APPT_LEAD_MIN), fireAt: Math.max(it.instant - APPT_LEAD_MIN * MIN, dayStart),
        fire_key: `appt|${it.prospectId}|${today}|${Math.max(0, it.startMin - APPT_LEAD_MIN)}|${tz}`, done: null, heldAt: it.heldAt || null, slotSet, next: nextAfter(it.endMin) });
    }
  }

  const due = [];
  for (const c of candidates) {
    if (c.done === 'done' || c.done === 'skipped') { skipped.already_done++; continue; }
    if (c.heldAt) { skipped.already_held++; continue; }
    const grace = Math.min(GRACE_MIN, Math.floor(c.segDur / 2)) * MIN;
    if (!(c.fireAt <= now + LOOKAHEAD_SEC * 1000 && now < c.startAt + grace && now < c.endAt)) continue;
    const cool = logRows.some(r => c.slotSet.has(r.block_id) && r.fire_key !== c.fire_key && (r.status === 'claimed' || r.status === 'sent') && Math.abs(c.fireAt - new Date(r.fire_at_utc).getTime()) <= COOLDOWN_MIN * MIN);
    if (cool) { skipped.cooldown++; continue; }
    due.push(c);
  }

  // Freeze (§6b.4): started appointments + realized owed.
  const freezeRecords = [];
  const apptIds = new Set(day.filter(r => r.kind === 'appt' && r.day === today).map(r => r.id));
  for (const it of items) {
    if (it.frozen || it.instant > now) continue;
    const id = apptRecordId(today, it.prospectId, it.startMin);
    if (apptIds.has(id)) continue;
    freezeRecords.push({ id, kind: 'appt', day: today, prospectId: it.prospectId, startMin: it.startMin, durationMin: it.durationMin, source: it.source, heldAt: null, updatedAt: new Date(it.instant).toISOString(), deletedAt: null });
  }
  const started = items.filter(it => it.instant <= now);
  const realized = composeDay({ live: liveForCompose, appointments: started, makeups, dayRecords: day, nowMin, today });
  const storedOwed = day.find(r => r.kind === 'owed' && r.id === owedId(today) && !r.deletedAt) || null;
  const owed = reconcileOwed(storedOwed, realized, readAt, today);
  if (owed) freezeRecords.push({ ...owed, expect: storedOwed ? storedOwed.updatedAt : null });

  const sendSkip = settings.remindersEnabled === false ? 'disabled' : (!Array.isArray(subs) || subs.length === 0) ? 'no_subs' : null;
  return { ...out, composeEligible: true, sendSkip, tz, today, candidates, due, freezeRecords, items: projected.items };
}

// ---------- §6b.6 payload (name-free by construction) ----------
function relative(startAt, now, capMin = Infinity) {
  const n = Math.round(Math.abs(startAt - now) / MIN);
  if (n === 0) return 'starts now';
  return startAt > now ? `starts in ${Math.min(n, capMin)} min` : `started ${n} min ago`;
}
function thenPart(next) {
  if (!next) return '';
  const isAppt = next.kind === 'appt' || next.category === 'appt';
  return ` · then ${isAppt ? 'an appointment' : next.name} at ${formatTime(next.startMin)}`;
}
export function buildPayload(c, next, now, appUrl) {
  const url = `${appUrl}/?view=routine`;
  const capMin = Number.isFinite(c.fireAt) ? Math.max(1, Math.round((c.startAt - c.fireAt) / MIN)) : Infinity;
  if (c.kind === 'appt' || c.kind === 'placeholder') {
    const rel = relative(c.startAt, now, capMin);
    const body = rel === 'starts now' ? 'Appointment starts now' : rel.startsWith('starts in') ? `Appointment in ${rel.slice('starts in '.length)}` : `Appointment ${rel}`;
    return { title: 'PRIM', body, tag: c.kind === 'appt' ? `appt-${c.prospectId}` : `routine-${c.block_id}`, url, urgent: false };
  }
  return { title: `${c.name} ${relative(c.startAt, now, capMin)}`, body: `${formatRange(c.segStartMin, c.segEndMin)}${thenPart(next)}`, tag: `routine-${c.block_id}`, url, urgent: false };
}

// ---------- §6b.7 stamping ----------
const RETRYABLE = (code) => code == null || code >= 500 || code === 429 || code === 408;
export function classifySend({ sentCount, failures = [], allDead = false }) {
  if (sentCount >= 1) return { status: 'sent', attempts: 1, error: null };
  if (allDead) return { status: 'failed', attempts: 1, error: 'all_subs_dead' };
  const code = failures[0]?.statusCode ?? null;
  if (RETRYABLE(code)) return { status: 'failed', attempts: 1, error: code == null ? 'no_status' : String(code) };
  return { status: 'failed', attempts: 2, error: String(code) };
}
export function retryEligible(row, now) {
  if (row.attempts !== 1) return false;
  if (row.status === 'failed') return true;
  if (row.status === 'claimed') return now - new Date(row.created_at).getTime() >= STALE_CLAIM_MIN * MIN;
  return false;
}
```

- [x] **Step 4: Run to verify it passes** — `node --test src/lib/routineTick.test.mjs` → 15 pass. `npm test` → 824 pass. The 13 original tests were executed with this exact implementation during plan review (13/13 under three server TZs); the two appended tests (DST pins, 23:50) were hand-traced only. On a red, hand-trace the rule in the spec before changing either side. Note in the commit message that the spec's §10 names (`computeDue`/`computeFreeze`) are folded into one `tickAgent` export.

- [x] **Step 5: Commit**

```bash
git add src/lib/routineTick.mjs src/lib/routineTick.test.mjs
git commit -m "feat(routine): routineTick — candidates, due window, cooldown slot sets, freeze records, name-free payloads (spec §6b)"
```

---

## Task 8: SQL functions, `pushServer.js`, the tick route, tripwires

**Spec:** §4d, §6a, §6b (route steps 0–8), §12 tripwires.

**Files:**
- Create: `supabase/routine-push-log-migration.sql`, `supabase/routine-appt-rows-function.sql`, `supabase/routine-day-write-function.sql`, `supabase/routine-tick-cron.sql`
- Create: `src/lib/pushServer.js`, `src/app/api/routine/tick/route.js`
- Modify: `src/lib/sourceInvariants.test.mjs` (append tripwires)

- [x] **Step 1: Append the failing tripwires to `src/lib/sourceInvariants.test.mjs`**

```js
// ---- Routine Builder tripwires (spec §12) ----
const TICK = 'src/app/api/routine/tick/route.js';

test('routine tick: CRON_SECRET fail-closed, every query result checked, never a direct user_kv write', () => {
  const src = read(TICK);
  assert.ok(src.includes('process.env.CRON_SECRET') && /status: 401/.test(src) && src.includes('if (!expected ||'), 'fail-closed auth block');
  for (const id of ['sErr', 'pErr', 'subErr', 'logQ.error', 'blocksQ', 'dayQ', 'apptQ', 'fErr', 'cErr', 'rErr', 'uErr', 'hErr', 'phase B read failed', '.canAccess !== true']) assert.ok(src.includes(id), `missing error handling anchor ${id}`);
  assert.ok(src.includes(".rpc('routine_day_write'") && src.includes(".rpc('routine_appt_rows'"));
  for (const bad of [".from('user_kv').upsert(", ".from('user_kv').update(", ".from('user_kv').delete(", ".from('user_kv').insert("]) assert.ok(!src.includes(bad), `tick must never write user_kv directly: ${bad}`);
  assert.ok(!src.includes("eq('key', 'prospects_v1')"), 'tick must never select the prospects blob');
  assert.ok(selectStrings(src).some((s) => s.includes('subscription_tier') && s.includes('past_due_since')), 'profile SELECT must carry the 8 gate columns');
  assert.ok(src.includes('ignoreDuplicates: true'), 'claim-before-send');
});

test('pushServer checks error after select and upsert and returns failures', () => {
  const src = read('src/lib/pushServer.js');
  assert.ok(src.includes('if (error)') && src.includes('if (e2)'));
  assert.ok(src.includes('failures'));
  assert.ok(count(src, /return \{ ok: false, error/g) >= 2, 'prune returns failures instead of throwing');
});

test('routineLive has exactly one Date.parse (parseAppointmentTime); routineTick has none', () => {
  assert.equal(count(read('src/lib/routineLive.mjs'), /Date\.parse\(/g), 1);
  assert.equal(count(read('src/lib/routineTick.mjs'), /Date\.parse\(/g), 0);
});

test('payload builder is name-free: fixed appointment copy, "an appointment" for next items', () => {
  const src = read('src/lib/routineTick.mjs');
  const fn = src.slice(src.indexOf('export function buildPayload'));
  assert.ok(fn.includes("title: 'PRIM'") && fn.includes("'Appointment"));
  assert.ok(src.includes("'an appointment'"));
  assert.ok(!/prospect(Name|\.name)/.test(fn));
});

test('vercel.json keeps only daily crons (never sub-daily — Hobby build fails)', () => {
  const cfg = JSON.parse(read('vercel.json'));
  for (const c of cfg.crons || []) { const [min, hour] = c.schedule.split(' '); assert.ok(min !== '*' && hour !== '*', `sub-daily cron: ${c.schedule}`); }
});

test('routine SQL functions are security definer, legacy-string safe, and service-role only', () => {
  for (const f of ['supabase/routine-appt-rows-function.sql', 'supabase/routine-day-write-function.sql']) {
    const src = read(f).toLowerCase();
    for (const needle of ['security definer', 'jsonb_typeof', 'revoke execute', 'grant execute', 'to service_role', 'set search_path = public']) assert.ok(src.includes(needle), `${f} missing ${needle}`);
  }
  const w = read('supabase/routine-day-write-function.sql').toLowerCase();
  assert.ok(w.includes('on conflict (user_id, key) do nothing') && w.includes('for update'), 'row created empty and locked before read');
  assert.ok(w.includes("'expect'"), 'expected-version CAS');
  assert.ok(read('supabase/routine-tick-cron.sql').includes("'prim-routine-tick'"));
});
```

- [x] **Step 2: Run to verify they fail** — `node --test src/lib/sourceInvariants.test.mjs` → 6 new failures (files missing).

- [x] **Step 3: Write the four SQL files**

`supabase/routine-push-log-migration.sql`:
```sql
-- Routine Builder — push idempotency ledger (spec §4d).
-- Spec: docs/superpowers/specs/2026-09-07-routine-builder-design.md
-- Run once in Supabase → SQL Editor. Idempotent. A TABLE, not a user_kv key:
-- migrateLocalToCloud would overwrite a mirrored ledger and re-arm sent reminders.
create table if not exists public.routine_push_log (
  user_id     uuid        not null,
  fire_key    text        not null,
  block_id    text        not null,
  local_day   date        not null,
  fire_at_utc timestamptz not null,
  status      text        not null default 'claimed' check (status in ('claimed','sent','failed')),
  attempts    int         not null default 1 check (attempts between 1 and 2),
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  primary key (user_id, fire_key)
);
create index if not exists routine_push_log_created_idx on public.routine_push_log (created_at);
alter table public.routine_push_log enable row level security;
-- No policies on purpose: only the service-role tick reads or writes this table.
```

`supabase/routine-appt-rows-function.sql`:
```sql
-- Routine Builder — appointment rows for the minute tick (spec §6b.1).
-- Spec: docs/superpowers/specs/2026-09-07-routine-builder-design.md
-- Returns ONLY (user_id, id, stage, appointment_time, archived_at) for elements
-- of each user's prospects_v1 whose appointmentTime starts with one of the UTC
-- day prefixes and whose stage is in that user's appointmentStages. The blob
-- itself is never transferred. Frozen/attached items need no prospect row.
-- Legacy string-typed blobs are cast; a per-user failure is a WARNING, not an abort.
create or replace function public.routine_appt_rows(p_user_ids uuid[], p_prefixes text[])
returns table (user_id uuid, id text, stage text, appointment_time text, archived_at text)
language plpgsql
security definer
set search_path = public
as $$
declare
  u          uuid;
  v_blob     jsonb;
  v_settings jsonb;
  v_stages   text[];
begin
  if p_user_ids is null then return; end if;
  foreach u in array p_user_ids loop
    begin
      select value into v_settings from public.user_kv
        where user_kv.user_id = u and user_kv.key = 'routine_settings_v1';
      if v_settings is not null and jsonb_typeof(v_settings) = 'string' then
        v_settings := (v_settings #>> '{}')::jsonb;
      end if;
      v_stages := array(
        select jsonb_array_elements_text(
          coalesce(v_settings -> 'appointmentStages', '["WEBBY_SET","WEBBY_CONFIRMED","APPOINTMENT_SET"]'::jsonb)));
      if coalesce(array_length(v_stages, 1), 0) = 0 then continue; end if;

      select value into v_blob from public.user_kv
        where user_kv.user_id = u and user_kv.key = 'prospects_v1';
      if v_blob is null then continue; end if;
      if jsonb_typeof(v_blob) = 'string' then v_blob := (v_blob #>> '{}')::jsonb; end if;
      if jsonb_typeof(v_blob) <> 'array' then continue; end if;

      return query
        select u, e ->> 'id', e ->> 'stage', e ->> 'appointmentTime', e ->> 'archivedAt'
        from jsonb_array_elements(v_blob) e
        where left(coalesce(e ->> 'appointmentTime', ''), 10) = any(p_prefixes)
          and (e ->> 'stage') = any(v_stages)
          and (e ->> 'archivedAt') is null;
    exception when others then
      raise warning 'routine_appt_rows: user % skipped: %', u, sqlerrm;
    end;
  end loop;
  return;
end;
$$;

revoke execute on function public.routine_appt_rows(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.routine_appt_rows(uuid[], text[]) to service_role;
```

`supabase/routine-day-write-function.sql`:
```sql
-- Routine Builder — atomic per-record write into routine_day_v1 (spec §4b, §6b.4).
-- Spec: docs/superpowers/specs/2026-09-07-routine-builder-design.md
-- The tick NEVER rewrites the user_kv row. For each incoming record:
--   * append if no element with that id exists in the stored array or earlier in this batch;
--   * replace iff rec.expect is non-null and equals the stored element's updatedAt
--     (expected-version CAS — a client write that landed after the tick's read
--     changes updatedAt and the replace is rejected);
--   * otherwise skip.
-- `expect` is stripped before storing. Returns the ids written. The row is
-- created empty and locked BEFORE it is read so an agent's first-ever record is
-- serialised against a concurrent client save.
--
-- p_floor ('YYYY-MM-DD', the tick passes addDays(today, -7)) enforces §4b's 7-day retention
-- on the SERVER as well: Pass 1 drops every stored element older than it instead of copying
-- it forward. Without it only the client's write path ever prunes, so an agent who sets a
-- routine up once and then works out of another tab accumulates an `appt` record per started
-- appointment plus the day's `owed` record every day, forever — and the tick re-reads that
-- whole jsonb every minute and Pass 1 rebuilds it element by element, so the cost is
-- quadratic in bytes and unbounded. The row is already locked by the `for update` below, so
-- the prune costs no extra round trip and cannot race a client save. Null prunes nothing.
--
-- RUN THIS FILE WHOLE, and note the DROP: `create or replace` cannot change a signature, and
-- p_floor makes this routine_day_write(uuid, jsonb, text) where the first release was
-- (uuid, jsonb). Dropping also drops that function's grants, which is why the revoke/grant
-- at the foot of the file are part of the same run. p_floor defaults to null so a still-
-- deployed older caller keeps working (without the prune) until the new route ships.
drop function if exists public.routine_day_write(uuid, jsonb);

create or replace function public.routine_day_write(p_user uuid, p_records jsonb, p_floor text default null)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored  jsonb;
  v_new     jsonb := '[]'::jsonb;
  el        jsonb;
  rec       jsonb;
  v_written text[] := '{}';
  v_id      text;
  v_expect  text;
  v_replaced boolean;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then return v_written; end if;

  insert into public.user_kv (user_id, key, value)
    values (p_user, 'routine_day_v1', '[]'::jsonb)
    on conflict (user_id, key) do nothing;

  select value into v_stored from public.user_kv
    where user_kv.user_id = p_user and user_kv.key = 'routine_day_v1'
    for update;

  if v_stored is not null and jsonb_typeof(v_stored) = 'string' then
    begin
      v_stored := (v_stored #>> '{}')::jsonb;
    exception when others then
      v_stored := '[]'::jsonb;
    end;
  end if;
  if v_stored is null or jsonb_typeof(v_stored) <> 'array' then v_stored := '[]'::jsonb; end if;

  -- Pass 1: keep every stored element, replacing where the CAS matches — except the ones
  -- the retention floor has passed, which are dropped here instead of copied into v_new.
  -- An incoming record sharing a pruned id is still appended by Pass 2 (it is not in v_new),
  -- so a live record is never lost to the prune.
  for el in select * from jsonb_array_elements(v_stored) loop
    if p_floor is not null and (el ->> 'day') is not null and (el ->> 'day') < p_floor then
      continue;
    end if;
    v_replaced := false;
    for rec in select * from jsonb_array_elements(p_records) loop
      if (rec ->> 'id') is not null and (rec ->> 'id') = (el ->> 'id') then
        v_expect := rec ->> 'expect';
        if v_expect is not null and v_expect = (el ->> 'updatedAt') then
          v_new := v_new || jsonb_build_array(rec - 'expect');
          v_written := array_append(v_written, rec ->> 'id');
          v_replaced := true;
        end if;
        exit;
      end if;
    end loop;
    if not v_replaced then v_new := v_new || jsonb_build_array(el); end if;
  end loop;

  -- Pass 2: append incoming records whose id is absent from the stored array.
  for rec in select * from jsonb_array_elements(p_records) loop
    v_id := rec ->> 'id';
    if v_id is null then continue; end if;
    if not exists (select 1 from jsonb_array_elements(v_new) s where (s ->> 'id') = v_id) then
      v_new := v_new || jsonb_build_array(rec - 'expect');
      v_written := array_append(v_written, v_id);
    end if;
  end loop;

  update public.user_kv set value = v_new, updated_at = now()
    where user_kv.user_id = p_user and user_kv.key = 'routine_day_v1';
  return v_written;
end;
$$;

revoke execute on function public.routine_day_write(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.routine_day_write(uuid, jsonb, text) to service_role;
```

`supabase/routine-tick-cron.sql` — copy §6a verbatim, with this header:
```sql
-- Routine Builder — minute trigger (spec §6a). Requires extensions pg_cron + pg_net
-- and Vault secret `prim_cron_secret` (= Vercel CRON_SECRET). Raises if the secret
-- is missing — by design. Re-run after `select cron.unschedule('prim-routine-tick');`.
```
then the `do $$ … $$;` block and the `select cron.schedule('prim-routine-tick', '* * * * *', $$ … $$);` block exactly as in spec §6a.

- [x] **Step 4: Write `src/lib/pushServer.js`**

```js
/**
 * Server-side web push for the routine tick (spec §6b.6). Derived from
 * src/app/api/reminders/route.js:26-55 and :379-386 — that route is NOT edited.
 * Unlike the reminders helper this one RETURNS every failure so the tick can
 * stamp the ledger; it never swallows an error.
 */
import webpush from 'web-push';

const PUSH_KEY = 'push_subscriptions_v1';
let ready = false;

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function init() {
  if (ready) return true;
  if (!pushConfigured()) return false;
  try {
    webpush.setVapidDetails('mailto:rjprimeconsult@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    ready = true;
  } catch (e) {
    console.warn('[pushServer] VAPID setup failed:', e?.message);
    return false;
  }
  return true;
}

// → { sentCount, dead: [endpoint], failures: [{ endpoint, statusCode, message }] }
export async function sendPushAll(subs, payload) {
  if (!init() || !Array.isArray(subs) || subs.length === 0) return { sentCount: 0, dead: [], failures: [] };
  const body = JSON.stringify(payload);
  let sentCount = 0;
  const dead = [];
  const failures = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, body);
      sentCount++;
    } catch (e) {
      const statusCode = e?.statusCode ?? null;
      if (statusCode === 404 || statusCode === 410) dead.push(sub.endpoint);
      else failures.push({ endpoint: sub.endpoint, statusCode, message: String(e?.message || e) });
    }
  }));
  return { sentCount, dead, failures };
}

// Re-selects the row before writing so a device added since the tick's read
// is never dropped. → { ok, error? }
export async function pruneDeadSubs(supa, userId, dead) {
  if (!Array.isArray(dead) || dead.length === 0) return { ok: true };
  const { data, error } = await supa.from('user_kv').select('value').eq('user_id', userId).eq('key', PUSH_KEY).maybeSingle();
  if (error) return { ok: false, error };
  // Legacy rows may be JSON strings (§4). Never write back from a value that
  // did not parse to an array — that would wipe every device's subscription.
  let current = data?.value;
  if (typeof current === 'string') { try { current = JSON.parse(current); } catch { current = null; } }
  if (!Array.isArray(current)) return { ok: false, error: new Error('bad_shape') };
  const alive = current.filter((s) => !dead.includes(s?.endpoint));
  const { error: e2 } = await supa.from('user_kv').upsert(
    { user_id: userId, key: PUSH_KEY, value: alive, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,key' }
  );
  if (e2) return { ok: false, error: e2 };
  return { ok: true };
}
```

- [x] **Step 5: Write `src/app/api/routine/tick/route.js`**

```js
/**
 * GET /api/routine/tick — Routine Builder minute scheduler (spec §6b).
 *
 * Triggered by Supabase pg_cron → pg_net every minute (supabase/routine-tick-cron.sql)
 * with `Authorization: Bearer <CRON_SECRET>`. Fails CLOSED when CRON_SECRET is unset.
 *
 * Per entitled agent with a valid zone: compose today (the SAME pure functions the
 * client runs), freeze started appointments + realized owed minutes through the
 * routine_day_write RPC, then (if subscribed) claim-before-send reminders in
 * routine_push_log. Never selects the prospects blob (routine_appt_rows RPC) and
 * never writes a user_kv row directly. Push copy is name-free by construction.
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 * CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, NEXT_PUBLIC_SITE_URL.
 */
import { createClient } from '@supabase/supabase-js';
import { canAccessBetaFeature } from '@/lib/featureFlags';
import { appUrl } from '@/lib/appUrl.mjs';
import { isValidTimeZone, addDays } from '@/lib/tz.mjs';
import { tickAgent, buildPayload, classifySend, retryEligible, LOG_WINDOW_MIN } from '@/lib/routineTick.mjs';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY, PUSH_SUBS_KEY, ROUTINE_FEATURE_KEY } from '@/lib/routineKeys.mjs';
import { pushConfigured, sendPushAll, pruneDeadSubs } from '@/lib/pushServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHUNK = 100;
const DAY_MS = 86400000;

const parseValue = (v) => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return undefined; } } return v; };
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const groupBy = (rows) => { const m = new Map(); for (const r of rows || []) { if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id).push(r); } return m; };

export async function GET(req) {
  // Fail CLOSED (mirrors reminders/route.js:245-249).
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) return new Response('Unauthorized', { status: 401 });

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  const supa = createClient(url, key, { auth: { persistSession: false } });

  const now = Date.now();
  const summary = {
    compose_eligible: 0, send_eligible: 0, due: 0, claimed: 0, sent: 0, failed: 0, retried: 0, stale_claimed: 0,
    appts_due: 0, appts_sent: 0, frozen: 0, freeze_failed: 0,
    skipped: { not_entitled: 0, disabled: 0, bad_tz: 0, no_subs: 0, cooldown: 0, already_done: 0, already_held: 0, bad_shape: 0, prune_failed: 0, push_not_configured: 0 },
    errors: [],
  };
  const pushOn = pushConfigured();
  if (!pushOn) summary.skipped.push_not_configured = 1; // step 0: sends skipped, freeze still runs

  // ---- Phase A: settings + profiles + subscriptions ----
  const { data: settingsRows, error: sErr } = await supa.from('user_kv').select('user_id, value').eq('key', ROUTINE_SETTINGS_KEY);
  if (sErr) return Response.json({ error: sErr.message }, { status: 500 });
  const userIds = [...new Set((settingsRows || []).map((r) => r.user_id))];
  if (userIds.length === 0) return Response.json(summary);

  const profiles = new Map();
  const subsByUser = new Map();
  for (const chunk of chunks(userIds, CHUNK)) {
    // literal on purpose: sourceInvariants' selectStrings() only reads literal .select('…') arguments
    const { data: pRows, error: pErr } = await supa.from('profiles').select('id, email, subscription_status, subscription_tier, trial_ends_at, is_complimentary, is_admin, past_due_since').in('id', chunk);
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
    for (const p of pRows || []) profiles.set(p.id, p);
    const { data: subRows, error: subErr } = await supa.from('user_kv').select('user_id, value').eq('key', PUSH_SUBS_KEY).in('user_id', chunk);
    if (subErr) return Response.json({ error: subErr.message }, { status: 500 });
    for (const r of subRows || []) { const v = parseValue(r.value); subsByUser.set(r.user_id, Array.isArray(v) ? v : []); }
  }

  // ---- Step 2: eligibility (Phase B runs only for composeEligible) ----
  const settingsByUser = new Map();
  const eligible = [];
  for (const r of settingsRows) {
    const s = parseValue(r.value);
    if (s === undefined) { summary.skipped.bad_shape++; continue; } // counted once (§6b.2)
    const settings = s && typeof s === 'object' ? s : null;
    settingsByUser.set(r.user_id, settings);
    const access = canAccessBetaFeature(ROUTINE_FEATURE_KEY, profiles.get(r.user_id) || null);
    if (access.canAccess !== true) { summary.skipped.not_entitled++; continue; }
    if (!isValidTimeZone(settings?.timezone)) { summary.skipped.bad_tz++; continue; }
    eligible.push(r.user_id);
  }

  const prefixes = [utcDay(now - DAY_MS), utcDay(now), utcDay(now + DAY_MS)];
  const since = new Date(now - LOG_WINDOW_MIN * 60000).toISOString();

  // ---- Phase B per chunk ----
  for (const chunk of chunks(eligible, CHUNK)) {
    const readAt = new Date().toISOString();
    const [blocksQ, dayQ, logQ, apptQ] = await Promise.all([
      supa.from('user_kv').select('user_id, value').eq('key', ROUTINE_BLOCKS_KEY).in('user_id', chunk),
      supa.from('user_kv').select('user_id, value').eq('key', ROUTINE_DAY_KEY).in('user_id', chunk),
      supa.from('routine_push_log').select('user_id, fire_key, block_id, fire_at_utc, status, attempts, created_at').in('user_id', chunk).gte('created_at', since),
      supa.rpc('routine_appt_rows', { p_user_ids: chunk, p_prefixes: prefixes }),
    ]);
    if (logQ.error) return Response.json({ error: 'log read failed: ' + logQ.error.message }, { status: 500 });
    // A failed read is NOT an empty input: composing on [] would zero an agent's
    // realized owed minutes through the CAS. Skip the chunk; next minute retries.
    if (blocksQ.error || dayQ.error || apptQ.error) {
      summary.errors.push({ chunk: chunk.length, err: 'phase B read failed: ' + (blocksQ.error || dayQ.error || apptQ.error).message });
      continue;
    }
    const blocksBy = new Map((blocksQ.data || []).map((r) => [r.user_id, r.value]));
    const dayBy = new Map((dayQ.data || []).map((r) => [r.user_id, r.value]));
    const logBy = groupBy(logQ.data);
    const apptBy = groupBy(apptQ.data);

    for (const userId of chunk) {
      try {
        const blocksRaw = parseValue(blocksBy.get(userId));
        const dayRaw = parseValue(dayBy.get(userId));
        if (blocksRaw === undefined || dayRaw === undefined) summary.skipped.bad_shape++;
        const apptRows = (apptBy.get(userId) || []).map((r) => ({ id: r.id, stage: r.stage, appointmentTime: r.appointment_time, archivedAt: r.archived_at }));
        const subs = subsByUser.get(userId) || [];
        const logRows = logBy.get(userId) || [];

        const res = tickAgent({
          canAccess: true, settings: settingsByUser.get(userId),
          blocks: Array.isArray(blocksRaw) ? blocksRaw : [],
          dayRecords: Array.isArray(dayRaw) ? dayRaw : [],
          apptRows, logRows, subs, now, readAt,
        });
        if (res.skip) { summary.skipped[res.skip]++; continue; }
        summary.compose_eligible++;
        summary.skipped.cooldown += res.skipped.cooldown;
        summary.skipped.already_done += res.skipped.already_done;
        summary.skipped.already_held += res.skipped.already_held;

        // Step 4: freeze — one RPC per agent, only when there is something to write.
        // p_floor carries §4b's 7-day retention into the function: without it nothing
        // server-side ever prunes routine_day_v1 and the jsonb this tick re-reads every
        // minute grows without bound (the client's write path is the only other pruner,
        // and an agent who never opens the tab never runs it).
        if (res.freezeRecords.length) {
          const { data: written, error: fErr } = await supa.rpc('routine_day_write', { p_user: userId, p_records: res.freezeRecords, p_floor: addDays(res.today, -7) });
          if (fErr) { summary.freeze_failed++; summary.errors.push({ user_id: userId, err: 'freeze: ' + fErr.message }); }
          else summary.frozen += Array.isArray(written) ? written.length : 0;
        }

        if (res.sendSkip) { summary.skipped[res.sendSkip]++; continue; }
        if (!pushOn) continue;
        summary.send_eligible++;
        summary.due += res.due.length;
        summary.appts_due += res.due.filter((d) => d.kind === 'appt').length;
        if (res.due.length === 0) continue;

        // Step 5: claim-before-send.
        const existing = new Map(logRows.map((r) => [r.fire_key, r]));
        const fresh = res.due.filter((d) => !existing.has(d.fire_key));
        const toSend = [];
        if (fresh.length) {
          const rows = fresh.map((d) => ({ user_id: userId, fire_key: d.fire_key, block_id: d.block_id, local_day: res.today, fire_at_utc: new Date(d.fireAt).toISOString(), status: 'claimed', attempts: 1 }));
          const { data: claimed, error: cErr } = await supa.from('routine_push_log').upsert(rows, { onConflict: 'user_id,fire_key', ignoreDuplicates: true }).select('fire_key');
          if (cErr) summary.errors.push({ user_id: userId, err: 'claim: ' + cErr.message });
          else {
            const got = new Set((claimed || []).map((r) => r.fire_key));
            summary.claimed += got.size;
            for (const d of fresh) if (got.has(d.fire_key)) toSend.push({ d, attempts: 1 });
          }
        }
        // Step 7: one CAS retry for failed(attempts=1) or stale claimed rows still inside grace.
        for (const d of res.due) {
          const row = existing.get(d.fire_key);
          if (!row || !retryEligible(row, now)) continue;
          const { data: cas, error: rErr } = await supa.from('routine_push_log')
            .update({ status: 'claimed', attempts: 2 })
            .eq('user_id', userId).eq('fire_key', d.fire_key).eq('attempts', 1).in('status', ['failed', 'claimed'])
            .select('fire_key');
          if (rErr) { summary.errors.push({ user_id: userId, err: 'retry: ' + rErr.message }); continue; }
          if ((cas || []).length === 1) { summary.retried++; if (row.status === 'claimed') summary.stale_claimed++; toSend.push({ d, attempts: 2 }); }
        }

        // Step 6: send one push per item; step 7: stamp.
        let live = subs;
        for (const { d, attempts } of toSend) {
          const payload = buildPayload(d, d.next, now, appUrl());
          const r = await sendPushAll(live, payload);
          if (r.dead.length) {
            const pr = await pruneDeadSubs(supa, userId, r.dead);
            if (!pr.ok) summary.skipped.prune_failed++;
            live = live.filter((s) => !r.dead.includes(s?.endpoint));
          }
          const cls = classifySend({ sentCount: r.sentCount, failures: r.failures, allDead: r.sentCount === 0 && r.failures.length === 0 && r.dead.length > 0 });
          const stamp = { status: cls.status, attempts: cls.status === 'sent' ? attempts : Math.max(attempts, cls.attempts), error: cls.error };
          if (cls.status === 'sent') stamp.sent_at = new Date().toISOString();
          const { error: uErr } = await supa.from('routine_push_log').update(stamp).eq('user_id', userId).eq('fire_key', d.fire_key);
          if (uErr) summary.errors.push({ user_id: userId, err: 'stamp: ' + uErr.message });
          if (cls.status === 'sent') { summary.sent++; if (d.kind === 'appt') summary.appts_sent++; } else summary.failed++;
        }
      } catch (e) {
        summary.errors.push({ user_id: userId, err: String(e?.message || e) });
      }
    }
  }

  // Step 8: housekeeping at minute 7 of each hour.
  if (new Date(now).getUTCMinutes() === 7) {
    const { error: hErr } = await supa.from('routine_push_log').delete().lt('created_at', new Date(now - 30 * DAY_MS).toISOString());
    if (hErr) summary.errors.push({ err: 'housekeeping: ' + hErr.message });
  }
  return Response.json(summary);
}
```

- [x] **Step 5b: Route-level behavior test** — `src/app/api/routine/tick/route.test.jsx` (Vitest lane; the route imports `@/` aliases and `web-push`). Spec §12 pins route behaviors the text tripwires cannot: a `bad_tz` agent's Phase B rows are never queried, a non-entitled id never reaches `.in()`, an unparseable value counts `bad_shape` while other agents still fire, and the claim → send → stamp flow. Build a thenable chain stub and pin those four:

```jsx
import { test, expect, vi, beforeEach } from 'vitest';
const calls = vi.hoisted(() => []);            // every terminal chain, in order: { table|rpc, ops }
const responder = vi.hoisted(() => ({ fn: null })); // (call) => { data, error }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain = (target) => {
      const c = { target, ops: [] };
      const add = (op) => (...args) => { c.ops.push([op, ...args]); return c; };
      for (const op of ['select', 'eq', 'in', 'gte', 'lt', 'maybeSingle', 'upsert', 'update', 'delete']) c[op] = add(op);
      c.then = (resolve, reject) => { calls.push(c); try { resolve(responder.fn(c)); } catch (e) { reject(e); } };
      return c;
    };
    return { from: (table) => chain({ table }), rpc: (name, args) => { const c = chain({ rpc: name, args }); return c; } };
  },
}));
vi.mock('@/lib/pushServer', () => ({ pushConfigured: () => true, sendPushAll: vi.fn(async () => ({ sentCount: 1, dead: [], failures: [] })), pruneDeadSubs: vi.fn(async () => ({ ok: true })) }));
import { GET } from './route';
import { sendPushAll } from '@/lib/pushServer';

const ok = (data) => ({ data, error: null });
const NOW = new Date('2026-09-08T13:25:00Z');           // 8:25 Chicago — the starter Dial reminds at 8:25
const settings = (tz) => ({ version: 1, timezone: tz, timezoneMode: 'manual', remindersEnabled: true, defaultMinutesBefore: 5, activeDays: [0, 1, 2, 3, 4, 5, 6], appointmentStages: ['APPOINTMENT_SET'], followupStages: [], followupStagesSeeded: true, lastReplacedBackup: null });
const block = { id: 'blk_dial000', name: 'Dial block', paletteId: 'dial', category: 'dial', startMin: 510, durationMin: 120, remind: { enabled: true, minutesBefore: 5 }, note: '', deletedAt: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' };
const profile = (id, tier = 'starter') => ({ id, email: `${id}@x.com`, subscription_status: 'active', subscription_tier: tier, trial_ends_at: null, is_complimentary: false, is_admin: false, past_due_since: null });
const req = () => new Request('http://x/api/routine/tick', { headers: { authorization: 'Bearer secret' } });

function world({ users }) {
  // users: { [id]: { settings, profile|null, subs, blocks, day } }
  responder.fn = (c) => {
    const key = c.ops.find(([op, col, v]) => op === 'eq' && col === 'key')?.[2];
    const inIds = c.ops.find(([op, col]) => op === 'in' && (col === 'user_id' || col === 'id'))?.[2] || Object.keys(users);
    if (c.target.rpc === 'routine_appt_rows') return ok([]);
    if (c.target.rpc === 'routine_day_write') return ok([]);
    if (c.target.table === 'profiles') return ok(inIds.map((id) => users[id]?.profile).filter(Boolean));
    if (c.target.table === 'routine_push_log') {
      if (c.ops.some(([op]) => op === 'upsert')) return ok(c.ops.find(([op]) => op === 'upsert')[1].map((r) => ({ fire_key: r.fire_key })));
      if (c.ops.some(([op]) => op === 'update')) return ok([{ fire_key: 'x' }]);
      return ok([]);
    }
    if (c.target.table === 'user_kv') {
      const field = { routine_settings_v1: 'settings', push_subscriptions_v1: 'subs', routine_blocks_v1: 'blocks', routine_day_v1: 'day' }[key];
      return ok(inIds.filter((id) => users[id] && users[id][field] !== undefined).map((id) => ({ user_id: id, value: users[id][field] })));
    }
    return ok([]);
  };
}
const phaseBCallsFor = (id) => calls.filter((c) => (c.target.table === 'routine_blocks_v1' ? false : true) && c.ops.some(([op, , v]) => op === 'in' && Array.isArray(v) && v.includes(id)) && c.ops.some(([op, , v]) => op === 'eq' && ['routine_blocks_v1', 'routine_day_v1'].includes(v)));

beforeEach(() => { calls.length = 0; vi.stubEnv('CRON_SECRET', 'secret'); vi.stubEnv('SUPABASE_URL', 'http://s'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k'); vi.useFakeTimers(); vi.setSystemTime(NOW); sendPushAll.mockClear(); });

test('fails closed without CRON_SECRET / wrong bearer', async () => {
  vi.stubEnv('CRON_SECRET', '');
  expect((await GET(req())).status).toBe(401);
  vi.stubEnv('CRON_SECRET', 'other');
  expect((await GET(req())).status).toBe(401);
});

test('a due block on an entitled Central agent is claimed, sent, and stamped once; a bad_tz agent with subs is never Phase-B queried; a non-entitled id never reaches .in()', async () => {
  world({ users: {
    u1: { settings: settings('America/Chicago'), profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] },
    u2: { settings: settings(null), profile: profile('u2'), subs: [{ endpoint: 'e2' }], blocks: [block], day: [] },
    u3: { settings: settings('America/Chicago'), profile: profile('u3', 'none'), subs: [{ endpoint: 'e3' }], blocks: [block], day: [] },
  } });
  const res = await GET(req());
  const body = await res.json();
  expect(body.skipped.bad_tz).toBe(1);
  expect(body.skipped.not_entitled).toBe(1);
  expect(body.claimed).toBe(1); expect(body.sent).toBe(1); expect(body.failed).toBe(0);
  expect(sendPushAll).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(sendPushAll.mock.calls[0][1])).toContain('Dial block starts in 5 min');
  for (const id of ['u2', 'u3']) expect(phaseBCallsFor(id).length).toBe(0);
  const stamp = calls.find((c) => c.target.table === 'routine_push_log' && c.ops.some(([op]) => op === 'update'));
  expect(stamp.ops.find(([op]) => op === 'update')[1].status).toBe('sent');
});

test('an unparseable settings value counts bad_shape once and does not stop the other agent', async () => {
  world({ users: {
    u1: { settings: '{not json', profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] },
    u4: { settings: settings('America/Chicago'), profile: profile('u4'), subs: [{ endpoint: 'e4' }], blocks: [block], day: [] },
  } });
  const body = await (await GET(req())).json();
  expect(body.skipped.bad_shape).toBe(1); expect(body.skipped.bad_tz).toBe(0); expect(body.sent).toBe(1);
});

test('a chunk whose blocks read fails is skipped, never composed as empty', async () => {
  world({ users: { u1: { settings: settings('America/Chicago'), profile: profile('u1'), subs: [{ endpoint: 'e1' }], blocks: [block], day: [] } } });
  const base = responder.fn;
  responder.fn = (c) => (c.target.table === 'user_kv' && c.ops.some(([op, , v]) => op === 'eq' && v === 'routine_blocks_v1') ? { data: null, error: { message: 'boom' } } : base(c));
  const body = await (await GET(req())).json();
  expect(body.errors.some((e) => String(e.err || e).includes('phase B read failed'))).toBe(true);
  expect(body.sent).toBe(0); expect(body.frozen).toBe(0);
  expect(calls.some((c) => c.target.rpc === 'routine_day_write')).toBe(false);
});
```
Adjust the `phaseBCallsFor` helper if the chain shape differs from the route as written; the assertion it serves is "no Phase-B query carries u2 or u3 in its `.in()` list". `vi.stubEnv` requires Vitest ≥ 0.26 (repo has 4.x).

- [x] **Step 6: Run the tripwires, the route test, and the full node lane**

Run: `node --test src/lib/sourceInvariants.test.mjs` → all pass. `npx vitest run src/app/api/routine/tick/route.test.jsx` → 4 pass. `npm test` → 830 pass. `npm run lint` → 0 errors.

- [x] **Step 7: Commit**

```bash
git add supabase/routine-push-log-migration.sql supabase/routine-appt-rows-function.sql supabase/routine-day-write-function.sql supabase/routine-tick-cron.sql src/lib/pushServer.js src/app/api/routine/tick/route.js src/app/api/routine/tick/route.test.jsx src/lib/sourceInvariants.test.mjs
git commit -m "feat(routine): SQL functions, pushServer, /api/routine/tick, tripwires (spec §4d, §6a-b, §12)"
```

---

## Task 9: PWA metadata, manifest + icons, service worker

**Spec:** §8 (all), §9 deep-link contract (the SW half).

**Files:**
- Create: `src/lib/appMetadata.mjs`, `src/lib/appMetadata.test.mjs`, `public/manifest.webmanifest`, `scripts/make-pwa-icons.mjs`, `public/icons/prim-192.png`, `public/icons/prim-512.png`, `public/apple-touch-icon.png`
- Modify: `src/app/layout.js:26-29` (metadata → generateMetadata), `public/sw.js:20-32` (notificationclick)
- Modify: `src/lib/sourceInvariants.test.mjs` (append)

- [x] **Step 1: Write the failing tests**

`src/lib/appMetadata.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { buildAppMetadata, BASE_METADATA } from './appMetadata.mjs';

test('marketing role gets no manifest / apple metadata; app role does (spec §8)', () => {
  const m = buildAppMetadata('marketing');
  assert.equal(m.title, BASE_METADATA.title); assert.equal('manifest' in m, false); assert.equal('appleWebApp' in m, false);
  assert.equal('icons' in m, false);
  const a = buildAppMetadata('app');
  assert.equal(a.manifest, '/manifest.webmanifest');
  assert.deepEqual(a.appleWebApp, { capable: true, statusBarStyle: 'default', title: 'PRIM' });
  assert.deepEqual(a.icons, { icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }], apple: '/apple-touch-icon.png' });
  assert.deepEqual(buildAppMetadata(undefined).manifest, '/manifest.webmanifest');
});

test('layout.js exports generateMetadata (not a static metadata object) and reads x-prim-role', () => {
  const src = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
  assert.ok(src.includes('export async function generateMetadata'));
  assert.ok(!src.includes('export const metadata'));
  assert.ok(src.includes("get('x-prim-role')"));
  assert.ok(src.includes('buildAppMetadata'));
});

test('manifest + icons exist and the manifest is well-formed', () => {
  const root = new URL('../../public/', import.meta.url);
  const man = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(man.name, 'PRIM'); assert.equal(man.short_name, 'PRIM'); assert.equal(man.display, 'standalone'); assert.equal(man.start_url, '/');
  assert.equal(man.theme_color, '#6366f1'); assert.equal(man.background_color, '#ffffff');
  assert.deepEqual(man.icons.map(i => i.src), ['/icons/prim-192.png', '/icons/prim-512.png']);
  for (const f of ['icons/prim-192.png', 'icons/prim-512.png', 'apple-touch-icon.png']) assert.ok(existsSync(new URL(f, root)), f);
});
```

Append to `src/lib/sourceInvariants.test.mjs`:
```js
test('sw.js: payload contract untouched; notificationclick picks the "/" client on the app origin and otherwise opens a window', () => {
  const src = read('public/sw.js');
  for (const k of ['data.title', 'data.body', 'data.tag', 'data.url', 'data.urgent']) assert.ok(src.includes(k), k);
  assert.ok(src.includes("pathname === '/'") && src.includes('self.location.origin') && src.includes("'prim:view'") && src.includes('openWindow'));
});
```

- [x] **Step 2: Run to verify they fail** — `node --test src/lib/appMetadata.test.mjs src/lib/sourceInvariants.test.mjs` → 4 failures.

- [x] **Step 3: Implement**

`src/lib/appMetadata.mjs`:
```js
// Pure metadata builder for src/app/layout.js (spec §8). The manifest and the
// Apple web-app tags are emitted ONLY for the app host; the marketing host
// keeps the plain title/description.
export const BASE_METADATA = Object.freeze({
  title: 'PRIM — Performance, Revenue & Investment Manager',
  description: 'Multi-channel agent tracker for leads, commissions, and CPA.',
});

export function buildAppMetadata(role) {
  if (role === 'marketing') return { ...BASE_METADATA };
  return {
    ...BASE_METADATA,
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'PRIM' },
    // Next 16 only merges the file-convention icon (src/app/icon.svg) when
    // metadata.icons is falsy — `icons: { apple }` alone silently drops the
    // SVG favicon on the app host (Task 9 quality-review regression fix).
    icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }], apple: '/apple-touch-icon.png' },
  };
}
```

`src/app/layout.js` — replace lines 26-29 (`export const metadata = {...}`) with:
```js
import { buildAppMetadata } from '@/lib/appMetadata.mjs';

// set by middleware (authoritative — honors flag + preview override); falls
// back to classifyHost (safety net) when the header is absent.
function resolveRole(h) {
  return h.get('x-prim-role')
    || classifyHost(h.get('x-forwarded-host') || h.get('host') || '', { marketingSplitEnabled: process.env.MARKETING_SPLIT_ENABLED === '1' });
}

// Manifest + Apple web-app tags only on the app host (spec 2026-09-07 §8).
// Same role resolution as RootLayout below — middleware header first.
export async function generateMetadata() {
  const h = await headers();
  return buildAppMetadata(resolveRole(h));
}
```
(Put the import with the other imports at the top. **Plan deviation (Task 9 quality review):** `RootLayout`'s inline role-resolution — `h.get('x-prim-role') || classifyHost(...)` — duplicated the block above; it now calls the shared `resolveRole(h)` helper instead. Behavior is identical, only the duplication is removed.)

`public/manifest.webmanifest`:
```json
{
  "name": "PRIM",
  "short_name": "PRIM",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#6366f1",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/prim-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/prim-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]
}
```

`scripts/make-pwa-icons.mjs` (run once; PNGs are committed, the script stays for regeneration):
```js
// One-off: rasterise the PRIM mark into the PWA icon set. sharp is a transitive
// dependency of next (0.34.5) — not added to package.json on purpose.
//   node scripts/make-pwa-icons.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';

const src = existsSync('public/prim-mark.png') ? 'public/prim-mark.png' : 'public/icon.svg';
mkdirSync('public/icons', { recursive: true });
const make = (size, out) => sharp(src).resize(size, size, { fit: 'contain', background: '#0f172a' }).png().toFile(out);
await make(192, 'public/icons/prim-192.png');
await make(512, 'public/icons/prim-512.png');
await make(180, 'public/apple-touch-icon.png');
console.log('icons written from', src);
```
Run: `node scripts/make-pwa-icons.mjs` → `icons written from …`. Open each PNG (`Read` tool) and confirm the mark is centred on a dark tile.

`public/sw.js` — replace the `notificationclick` handler (lines 20-32) with:
```js
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || (self.location.origin + '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Only a window on the APP origin can receive the in-app view switch. A
      // subscription registered on www before the host split would otherwise
      // focus a marketing tab whose "/" is a rewrite to /landing.
      let sameOrigin = false;
      let view = null;
      try {
        const target = new URL(url);
        sameOrigin = target.origin === self.location.origin;
        view = target.searchParams.get('view');
      } catch { sameOrigin = false; }
      if (sameOrigin) {
        for (const client of clientList) {
          let pathname = null;
          try { pathname = new URL(client.url).pathname; } catch { pathname = null; }
          // Prefer the app shell ("/"): /pricing, /admin and the legal pages mount no listener.
          if (pathname === '/' && 'focus' in client) {
            return client.focus().then((c) => { if (view && c && typeof c.postMessage === 'function') c.postMessage({ type: 'prim:view', view }); });
          }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
```
(`push` handler and its `title/body/tag/url/urgent` reads are untouched. **Plan deviation, record in the commit message and propose for spec rev 11 §8:** the `view` is derived from the push URL's `?view=` rather than the spec's hard-coded `'routine'`, so a reminders-cron push — whose URL has no `?view=` — only focuses instead of switching tabs. **Plan deviation (Task 9 quality review):** two more fixes on top of the above — (a) `client.focus()` is chained (`return client.focus().then(...)`) instead of fire-and-forget, so `event.waitUntil` actually waits for the `postMessage` step rather than resolving early; (b) the fallback default URL is `self.location.origin + '/'` instead of the hard-coded marketing origin, since every real sender already passes an absolute app URL and the default should never point at `www` post-cutover.)

- [x] **Step 4: Run to verify it passes** — `npm test` → 834 pass. `npm run build` must succeed (the `generateMetadata` conversion is the only Next-level change so far); if it fails, the error is in `layout.js` — fix there.

- [x] **Step 5: Commit**

```bash
git add src/lib/appMetadata.mjs src/lib/appMetadata.test.mjs src/app/layout.js public/manifest.webmanifest public/icons/prim-192.png public/icons/prim-512.png public/apple-touch-icon.png scripts/make-pwa-icons.mjs public/sw.js src/lib/sourceInvariants.test.mjs
git commit -m "feat(routine): PWA manifest + icons via generateMetadata, SW notificationclick picks the app shell (spec §8)"
```

---

## Task 10: Client store + hooks (`routineStore.js`, `useMediaQuery.js`, `usePointerDrag.js`)

**Spec:** §4 (storage contract), §7a (`useMediaQuery` at 640), §7c (pointer drag).

**Files:**
- Create: `src/lib/routineStore.js`, `src/lib/useMediaQuery.js`, `src/lib/usePointerDrag.js`
- Test: `src/lib/routineStore.test.jsx` (vitest — it imports `storage`), `src/lib/useMediaQuery.test.jsx`, `src/lib/usePointerDrag.test.jsx`

**Plan deviation (Task 10 quality review, 2026-09-14):** the original drop shipped with no test coverage for `usePointerDrag.js` and two real defects a fresh-context review caught: (1) the `window` `keydown` listener and in-flight drag state leaked past unmount (no cleanup effect) and (2) `finish`/`onPointerMove` closed over the `onStart`/`onMove`/`onEnd` props directly, so a parent re-render mid-drag rebuilt `onPointerUp`/`onPointerCancel` with a *new* `finish` but the stale `window` `keydown` listener from `start()` still called the *old* `finish`, and — worse — if the parent's `onEnd` reference changed mid-drag, `[onEnd]` in `finish`'s deps meant a fresh `finish` closure existed but nothing rebound the live drag's `s.onKey`, so Escape could reach a stale `onEnd`. Fixed by routing all three callbacks through a `cbs` ref (updated every render, read at call time) and adding an unmount effect that force-cancels an in-flight drag. `useMediaQuery.js` is rewritten on `useSyncExternalStore` to kill the `react-hooks/set-state-in-effect` lint warning from calling `setMatches` synchronously inside the effect body — same public behavior (SSR-safe, `false` until hydrated), no test changes needed for the original test. `routineStore.test.jsx`'s second test also had a dead assertion (`mem.set('leads_v5', ...)` against a key `loadRoutine` never reads) which is removed; a third test was added, backed by a new `fail` hoisted `Set` the mock's `getItem` checks, proving `loadRoutine` degrades safely on both corrupt settings JSON and a throwing storage read (never rejects).

- [x] **Step 1: Write the failing tests**

`src/lib/routineStore.test.jsx`:
```jsx
import { test, expect, vi, beforeEach } from 'vitest';
const mem = vi.hoisted(() => new Map());
const fail = vi.hoisted(() => new Set());
vi.mock('@/lib/storage', () => ({
  storage: {
    getItem: async (k) => { if (fail.has(k)) throw new Error('boom'); return mem.has(k) ? mem.get(k) : null; },
    setItem: async (k, v) => { mem.set(k, v); return true; },
    removeItem: async (k) => { mem.delete(k); },
  },
}));
import { loadRoutine, saveBlocks, saveDay, saveSettings } from './routineStore';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY } from './routineKeys.mjs';

beforeEach(() => { mem.clear(); fail.clear(); });
const NOW = '2026-09-08T15:00:00.000Z';

test('loadRoutine: empty store → [] / [] / default settings (timezone null)', async () => {
  const r = await loadRoutine({ nowIso: NOW });
  expect(r.blocks).toEqual([]); expect(r.dayRaw).toEqual([]); expect(r.settings.timezone).toBe(null); expect(r.settings.activeDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

// The day array comes back RAW so the caller can prune it against the SETTINGS zone; a
// sanitize here would have to guess one. Pinned because the guess used to be the device's,
// and a device zone one day ahead deleted the oldest still-in-window day on the next save.
test('loadRoutine returns the day array unsanitized — nothing older than today−7 is pruned here', async () => {
  const stale = { id: '2020-01-01|blk_aaaaaaa', kind: 'done', day: '2020-01-01', blockId: 'blk_aaaaaaa', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null };
  await saveDay([stale, { id: 'junk', kind: 'nonsense' }]);
  const r = await loadRoutine({ nowIso: NOW });
  expect(r.dayRaw).toEqual([stale, { id: 'junk', kind: 'nonsense' }]);
  expect(r.day).toBeUndefined();
});

test('save* write strings; loadRoutine sanitizes and tolerates corrupt JSON', async () => {
  await saveBlocks([{ id: 'blk_aaaaaaa', name: 'X', paletteId: 'dial', category: 'dial', startMin: 482, durationMin: 60, remind: { enabled: true, minutesBefore: 5 }, note: '', deletedAt: null, createdAt: NOW, updatedAt: NOW }]);
  expect(typeof mem.get(ROUTINE_BLOCKS_KEY)).toBe('string');
  await saveDay([{ id: '2026-09-08|blk_aaaaaaa', kind: 'done', day: '2026-09-08', blockId: 'blk_aaaaaaa', status: 'done', at: NOW, updatedAt: NOW, deletedAt: null }]);
  await saveSettings({ timezone: 'America/Chicago', defaultMinutesBefore: 12, junk: true });
  const r = await loadRoutine({ nowIso: NOW });
  expect(r.blocks[0].startMin).toBe(480); expect(r.dayRaw.length).toBe(1); expect(r.settings.defaultMinutesBefore).toBe(10); expect('junk' in r.settings).toBe(false);
  mem.set(ROUTINE_DAY_KEY, '{oops');
  const r2 = await loadRoutine({ nowIso: NOW });
  expect(r2.dayRaw).toEqual([]);
  expect(mem.has(ROUTINE_SETTINGS_KEY)).toBe(true);
});

test('corrupt settings default safely; a throwing storage read never rejects loadRoutine', async () => {
  mem.set(ROUTINE_SETTINGS_KEY, '{oops');
  const r = await loadRoutine({ nowIso: NOW });
  expect(r.settings.timezone).toBe(null);
  fail.add(ROUTINE_BLOCKS_KEY);
  await expect(loadRoutine({ nowIso: NOW })).resolves.toMatchObject({ blocks: [] });
});
```

`src/lib/useMediaQuery.test.jsx`:
```jsx
import { test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

test('reads matchMedia and follows change events', () => {
  let listener = null; let matches = false;
  vi.stubGlobal('matchMedia', (q) => ({ matches, media: q, addEventListener: (_, fn) => { listener = fn; }, removeEventListener: () => { listener = null; } }));
  const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 640px)'));
  expect(result.current).toBe(false);
  act(() => { matches = true; listener({ matches: true }); });
  expect(result.current).toBe(true);
  unmount(); expect(listener).toBe(null);
});

test('query change re-subscribes: old listener removed, new one added', () => {
  const added = []; const removed = [];
  vi.stubGlobal('matchMedia', (q) => ({
    matches: false,
    media: q,
    addEventListener: () => { added.push(q); },
    removeEventListener: () => { removed.push(q); },
  }));
  const { rerender } = renderHook(({ query }) => useMediaQuery(query), { initialProps: { query: '(min-width: 640px)' } });
  expect(added).toEqual(['(min-width: 640px)']);
  rerender({ query: '(min-width: 768px)' });
  expect(removed).toEqual(['(min-width: 640px)']);
  expect(added).toEqual(['(min-width: 640px)', '(min-width: 768px)']);
});
```

`src/lib/usePointerDrag.test.jsx` (added Task 10 quality review — no test file shipped with the original drop; see the plan-deviation note above):
```jsx
import { test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePointerDrag } from './usePointerDrag';

const el = () => ({ setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
const ev = (x, y, o = {}) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: o.target, ...o });
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

function setup(opts = {}) {
  const onStart = vi.fn(), onMove = vi.fn(), onEnd = vi.fn(), target = el();
  const hook = renderHook((p) => usePointerDrag({ onStart, onMove, onEnd, ...p }), { initialProps: opts });
  const down = (x = 100, y = 100, o = {}) => act(() => hook.result.current.start(o.mode || 'move')(ev(x, y, { target, ...o })));
  const move = (x, y, o = {}) => act(() => hook.result.current.handlers.onPointerMove(ev(x, y, { target, ...o })));
  const up = () => act(() => hook.result.current.handlers.onPointerUp(ev(0, 0, { target })));
  const cancel = () => act(() => hook.result.current.handlers.onPointerCancel(ev(0, 0, { target })));
  return { ...hook, onStart, onMove, onEnd, target, down, move, up, cancel };
}

test('2 px move ignored; 6 px starts+moves; pointerup ends cancelled=false', () => {
  const t = setup();
  t.down(100, 100);
  expect(t.target.setPointerCapture).toHaveBeenCalledWith(1);
  t.move(102, 100);
  expect(t.onStart).not.toHaveBeenCalled(); expect(t.onMove).not.toHaveBeenCalled(); expect(t.result.current.dragging).toBe(false);
  t.move(106, 100);
  expect(t.onStart).toHaveBeenCalledWith({ mode: 'move' });
  expect(t.onMove).toHaveBeenLastCalledWith({ mode: 'move', dx: 6, dy: 0 });
  expect(t.result.current.dragging).toBe(true);
  t.up();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 6, dy: 0, cancelled: false });
  expect(t.result.current.dragging).toBe(false);
  expect(t.target.releasePointerCapture).toHaveBeenCalledWith(1);
});

test('click without movement: no onStart/onEnd, dragging stays false', () => {
  const t = setup();
  t.down(); t.up();
  expect(t.onStart).not.toHaveBeenCalled(); expect(t.onEnd).not.toHaveBeenCalled(); expect(t.result.current.dragging).toBe(false);
});

test('Escape mid-drag cancels; later pointerup and Escape are no-ops', () => {
  const t = setup();
  t.down(100, 100); t.move(110, 100);
  act(() => { escape(); });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 10, dy: 0, cancelled: true });
  expect(t.result.current.dragging).toBe(false);
  t.up(); act(() => { escape(); });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
});

test('button 2 ignored; undefined button + touch allowed; mode passes through', () => {
  const t = setup();
  t.down(0, 0, { button: 2 }); t.move(50, 50);
  expect(t.onStart).not.toHaveBeenCalled();
  t.down(0, 0, { button: undefined, pointerType: 'touch', mode: 'resize' }); t.move(50, 50);
  expect(t.onStart).toHaveBeenCalledWith({ mode: 'resize' });
  t.up();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'resize', dx: 50, dy: 50, cancelled: false });
});

test('pointercancel -> cancelled=true; foreign pointerId ignored; custom threshold honoured', () => {
  const t = setup({ threshold: 10 });
  t.down(0, 0);
  t.move(50, 50, { pointerId: 2 }); expect(t.onStart).not.toHaveBeenCalled();
  t.move(9, 9); expect(t.onStart).not.toHaveBeenCalled();
  t.move(10, 0); expect(t.onStart).toHaveBeenCalledTimes(1);
  t.cancel();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 10, dy: 0, cancelled: true });
});

test('unmount mid-drag ends the drag and removes the window listener', () => {
  const t = setup();
  t.down(0, 0); t.move(20, 0);
  t.unmount();
  expect(t.onEnd).toHaveBeenCalledWith({ mode: 'move', dx: 20, dy: 0, cancelled: true });
  act(() => { escape(); });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
  expect(t.target.releasePointerCapture).toHaveBeenCalledTimes(1);
});

test('parent re-render with a new onEnd mid-drag: drag survives, Escape uses the LATEST onEnd', () => {
  const target = el(); const first = vi.fn(); const second = vi.fn();
  const hook = renderHook(({ onEnd }) => usePointerDrag({ onEnd }), { initialProps: { onEnd: first } });
  act(() => hook.result.current.start('move')(ev(0, 0, { target })));
  act(() => hook.result.current.handlers.onPointerMove(ev(10, 0, { target })));
  hook.rerender({ onEnd: second });
  expect(first).not.toHaveBeenCalled(); expect(hook.result.current.dragging).toBe(true);
  act(() => { escape(); });
  expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled();
});

test('second pointerdown mid-drag cancels the first instead of orphaning it', () => {
  const t = setup();
  t.down(0, 0); t.move(20, 0);
  t.down(0, 0, { pointerId: 7 });
  expect(t.onEnd).toHaveBeenCalledTimes(1);
  expect(t.target.releasePointerCapture).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run to verify they fail** — `npx vitest run src/lib/routineStore.test.jsx src/lib/useMediaQuery.test.jsx src/lib/usePointerDrag.test.jsx` → module-not-found.

- [x] **Step 3: Implement**

`src/lib/routineStore.js` (pattern: `setupChecklist.js`):
```js
/**
 * Routine Builder storage adapter (spec §4). Three user_kv documents; every
 * write is a JSON string. The two arrays are in MERGEABLE_KEYS, so a save
 * merges newest-wins by record id (mergeStore.mjs).
 *
 * Blocks and settings are sanitized here. The day array is NOT — see loadRoutine.
 */
import { storage } from './storage';
import { ROUTINE_BLOCKS_KEY, ROUTINE_DAY_KEY, ROUTINE_SETTINGS_KEY } from './routineKeys.mjs';
import { sanitizeBlocks, sanitizeSettings } from './routineModel.mjs';

async function readJson(key) {
  try { const raw = await storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// Returns `dayRaw` UNSANITIZED, on purpose. sanitizeDay prunes everything older than
// `today − 7` (§4b) and `today` depends on routine_settings_v1.timezone — which this call
// is what reads. Sanitizing here would have to guess a zone (the device's), and whenever
// that guess runs ahead of the configured zone the floor lands a day late: the oldest
// still-in-window day is dropped and the next commitDay persists the deletion. The caller
// sanitizes once the settings zone is resolved, so the prune floor and every later
// commitDay share one zone (RoutineView's load effect).
export async function loadRoutine({ nowIso }) {
  const [blocksRaw, dayRaw, settingsRaw] = await Promise.all([readJson(ROUTINE_BLOCKS_KEY), readJson(ROUTINE_DAY_KEY), readJson(ROUTINE_SETTINGS_KEY)]);
  return {
    blocks: sanitizeBlocks(Array.isArray(blocksRaw) ? blocksRaw : [], nowIso),
    dayRaw: Array.isArray(dayRaw) ? dayRaw : [],
    settings: sanitizeSettings(settingsRaw),
  };
}
export async function saveBlocks(blocks) { await storage.setItem(ROUTINE_BLOCKS_KEY, JSON.stringify(blocks)); return blocks; }
export async function saveDay(records) { await storage.setItem(ROUTINE_DAY_KEY, JSON.stringify(records)); return records; }
export async function saveSettings(settings) { const safe = sanitizeSettings(settings); await storage.setItem(ROUTINE_SETTINGS_KEY, JSON.stringify(safe)); return safe; }
```

`src/lib/useMediaQuery.js` (rewritten on `useSyncExternalStore` in the Task 10 quality review — see the plan-deviation note above; the original `useState`+`useEffect` version called `setMatches` synchronously in the effect body, which `react-hooks/set-state-in-effect` flags):
```js
'use client';
import { useCallback, useSyncExternalStore } from 'react';
// One breakpoint split for the whole view (spec §7a): 640 = Tailwind `sm:` =
// the breakpoint GlassModal's `sheet` keys on. Server snapshot (false) hydrates,
// then React re-renders with the live value — no mismatch, no setState-in-effect.
const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
export function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    if (!canQuery()) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => (canQuery() ? window.matchMedia(query).matches : false), () => false);
}
```

`src/lib/usePointerDrag.js` (rewritten in the Task 10 quality review to close two real defects — see the plan-deviation note above: a leaked `window` `keydown` listener on unmount mid-drag, and Escape reaching a stale `onEnd` after a parent re-render mid-drag. Callbacks now read through a `cbs` ref instead of being closed over directly, and an unmount effect force-cancels an in-flight drag):
```js
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
/**
 * Pointer-capture drag (spec §7c): 4 px threshold, Escape cancels, touch-capable
 * (the draggable element MUST set `touch-action: none`, or the browser fires
 * pointercancel after a few px), no library. Usage:
 *   const drag = usePointerDrag({ onMove: ({ dx, dy }) => …, onEnd: ({ dx, dy, cancelled }) => … });
 *   <div onPointerDown={drag.start('move')} {...drag.handlers} style={{ touchAction: 'none' }} />
 * Callbacks are read through a ref so a parent re-render mid-drag never cancels
 * the drag and Escape always reaches the latest onEnd. Unmount mid-drag cancels.
 */
export function usePointerDrag({ onStart, onMove, onEnd, threshold = 4 } = {}) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const cbs = useRef({ onStart, onMove, onEnd, threshold });
  useEffect(() => { cbs.current = { onStart, onMove, onEnd, threshold }; });

  const finish = useCallback((cancelled) => {
    const s = ref.current; if (!s) return;
    ref.current = null;
    try { s.target.releasePointerCapture(s.pointerId); } catch { /* already released */ }
    window.removeEventListener('keydown', s.onKey);
    setDragging(false);
    if (s.active) cbs.current.onEnd?.({ mode: s.mode, dx: s.dx, dy: s.dy, cancelled });
  }, []);

  const start = useCallback((mode) => (e) => {
    if (e.button != null && e.button !== 0) return;
    if (ref.current) finish(true); // a second pointer never orphans the first drag
    const target = e.currentTarget;
    const s = { mode, pointerId: e.pointerId, target, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false, onKey: null };
    s.onKey = (ke) => { if (ke.key === 'Escape') finish(true); };
    ref.current = s;
    try { target.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    window.addEventListener('keydown', s.onKey);
  }, [finish]);

  const onPointerMove = useCallback((e) => {
    const s = ref.current; if (!s || e.pointerId !== s.pointerId) return;
    const cb = cbs.current;
    s.dx = e.clientX - s.x0; s.dy = e.clientY - s.y0;
    if (!s.active) {
      if (Math.abs(s.dx) < cb.threshold && Math.abs(s.dy) < cb.threshold) return;
      s.active = true; setDragging(true); cb.onStart?.({ mode: s.mode });
    }
    cb.onMove?.({ mode: s.mode, dx: s.dx, dy: s.dy });
  }, []);

  const onPointerUp = useCallback(() => finish(false), [finish]);
  const onPointerCancel = useCallback(() => finish(true), [finish]);
  useEffect(() => () => finish(true), [finish]); // unmount mid-drag cancels

  // Spread `handlers` on the element that received onPointerDown.
  return { start, dragging, handlers: { onPointerMove, onPointerUp, onPointerCancel } };
}
```

- [x] **Step 4: Run to verify** — `npm run test:ui` → 102 pass (99 + 3). `npm test` unchanged.

- [x] **Step 5: Commit**

```bash
git add src/lib/routineStore.js src/lib/routineStore.test.jsx src/lib/useMediaQuery.js src/lib/useMediaQuery.test.jsx src/lib/usePointerDrag.js
git commit -m "feat(routine): client store adapter, useMediaQuery, pointer-capture drag hook (spec §4, §7a, §7c)"
```

---

## Task 11: Routine components

**Spec:** §7b (NowCard), §7c (Timeline/TimelineBlock), §7d (palette UI), §7e (templates UI), §7f (editor, phone list), §7h.1 (appointment card), §7h.2 (follow-up block + sheet), §7h.5 (weekly). Every pixel, class, and copy string below comes from those sections — when unsure, re-read the section, do not improvise.

**Files (all new, `src/components/routine/`):** `NowCard.jsx`, `AppointmentCard.jsx`, `TimelineBlock.jsx`, `Timeline.jsx`, `MobileRoutineList.jsx`, `BlockPalette.jsx`, `BlockEditorSheet.jsx`, `FollowupSheet.jsx`, `RoutineHeader.jsx`, `RoutineSettingsSheet.jsx`, `TemplatePicker.jsx`, `WeeklyLookback.jsx`, `constants.js` (shared class strings)
**Tests:** `NowCard.test.jsx`, `TimelineBlock.test.jsx`, `AppointmentCard.test.jsx`, `FollowupSheet.test.jsx`, `WeeklyLookback.test.jsx`

**Shared conventions (put in `src/components/routine/constants.js`):**
```js
export const TYPE = { xs: 'text-[10px]', sm: 'text-[11px]', md: 'text-[12px]', lg: 'text-[14px]' }; // PRIM's 10/11/12/14 scale
export const SLATE = { meta: 'text-slate-500', quiet: 'text-slate-400', body: 'text-slate-700', strong: 'text-slate-900' };
export const LOSS = 'text-amber-600 dark:text-amber-400'; // the ONLY amber text on the page
export const APPT_STRIPE = '#8b5cf6';
export const tint = (hex, isDark) => hex + (isDark ? '33' : '1F');
export const ICONS = { PhoneCall, RotateCcw, MessageSquare, Video, MapPin, Sunrise, FileCheck, GraduationCap, Coffee, Plus }; // import these from 'lucide-react'
```

**Props contracts (the view passes exactly these):**

| Component | Props |
|---|---|
| `NowCard` | `{ state: nowState(), nowMin, projected, offer, slot, storedOwed, yesterday, behind, strip, onDone(blockId), onHeld(item), onAccept(), onSkip(), onAck(), onEnable(), onScrollTo(id), settingsTz }` |
| `AppointmentCard` | `{ item, style, onHeld(item), onOpenProspect(id), onRemove(item), onDetach(item), started, compact }` |
| `TimelineBlock` | `{ item, tier, visual, marker, followupRows, followupCount, isDark, boundsStart, onToggle, onOpen, onDrag, onResize, onKey, onNames() }` |
| `Timeline` | `{ items, markers, tiers, visuals, followup, bounds, nowMin, isDark, onMove(blockId, startMin), onResize(blockId, durationMin), onAddAt(startMin), …block handlers }` |
| `MobileRoutineList` | `{ items, …, onLongPress(item) → menu }` |
| `BlockPalette` | `{ onAdd(paletteId), onDragStart }` |
| `BlockEditorSheet` | `{ open, block, isMakeup, isFrozenAppt, prospects, attachOptions, defaultMinutesBefore, onSave(patch), onDelete, onSkipToday, onAttach(prospectId), onRemoveMakeup, onRemoveFromToday, onClose, sheet }` |
| `FollowupSheet` | `{ open, rows, stageLabelOf(id), apptTimeOf(id), onOpenProspect, onClose }` |
| `RoutineHeader` | `{ tzLabel, remindersEnabled, onBell, onSettings }` |
| `RoutineSettingsSheet` | `{ open, settings, stages, onChange(patch), onStartOver(), onClose }` |
| `TemplatePicker` | `{ templates, onPick(template, replace), replaceMode, onUndo, undoAvailable }` |
| `WeeklyLookback` | `{ week }` (from `weeklyNotDone`) |

- [x] **Step 1: Write the failing component tests** (behavior only — no styling assertions beyond the spec's pinned classes)

`NowCard.test.jsx` — cases from spec §12 UI lane:
```jsx
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('@/lib/push', () => ({ isPushEnabled: async () => true, enablePush: async () => ({ ok: true }), pushPermission: () => 'granted' }));
import NowCard from './NowCard';

const base = { nowMin: 582, projected: { unrecovered: 0, displacedByBlock: {} }, offer: { offerOpen: false, makeupMin: 10 }, slot: null, storedOwed: null, yesterday: { minutes: 0, hidden: true, noun: 'routine time' }, strip: null, onDone: vi.fn(), onHeld: vi.fn(), onAccept: vi.fn(), onSkip: vi.fn(), onAck: vi.fn(), onEnable: vi.fn(), onScrollTo: vi.fn() };
const seg = { kind: 'segment', blockId: 'b1', name: 'Dial block', startMin: 510, endMin: 630, category: 'dial', done: null };
const metaLines = (c) => c.querySelectorAll('[data-meta-line]').length;

test('phases: upFirst / now with Done checkbox / free / dayDone; exactly one meta line per state', () => {
  const { container, rerender } = render(<NowCard {...base} state={{ phase: 'upFirst', next: seg, current: null, behind: null }} />);
  expect(screen.getByText(/Morning|Dial block/)).toBeTruthy(); expect(screen.getByText(/starts 8:30/)).toBeTruthy(); expect(metaLines(container)).toBe(0);
  rerender(<NowCard {...base} state={{ phase: 'now', current: seg, next: { kind: 'segment', name: 'Break', startMin: 630 }, behind: null }} />);
  expect(screen.getByText('NOW')).toBeTruthy(); expect(screen.getByText(/then Break at 10:30/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /done/i })); expect(base.onDone).toHaveBeenCalledWith('b1');
  rerender(<NowCard {...base} state={{ phase: 'free', current: null, next: { ...seg, startMin: 645, name: 'Text blast + replies' }, behind: null }} />);
  expect(screen.getByText(/Free until 10:45/)).toBeTruthy();
  rerender(<NowCard {...base} state={{ phase: 'dayDone', current: null, next: null, behind: null }} />);
  expect(screen.getByText(/Day done/)).toBeTruthy();
});

test('meta line priority: offer > still open > note > yesterday; never two', () => {
  const offer = { offerOpen: true, makeupMin: 30 };
  const proj = { unrecovered: 30, displacedByBlock: { b1: 30 } };
  const blocksCat = { b1: 'dial' };
  const { container, rerender } = render(<NowCard {...base} categoryOf={(id) => blocksCat[id]} state={{ phase: 'free', next: null, current: null, behind: { blockId: 'b0', name: 'Morning review' } }} projected={proj} offer={offer} slot={{ startMin: 750, endMin: 780 }} yesterday={{ minutes: 30, hidden: false, noun: 'dial time' }} />);
  expect(metaLines(container)).toBe(1); expect(screen.getByText('30m of dial time displaced.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add 12:30–1:00' })); expect(base.onAccept).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' })); expect(base.onSkip).toHaveBeenCalled();
  rerender(<NowCard {...base} categoryOf={(id) => blocksCat[id]} state={{ phase: 'free', next: null, current: null, behind: { blockId: 'b0', name: 'Morning review' } }} projected={proj} offer={{ offerOpen: false, makeupMin: 10 }} yesterday={{ minutes: 30, hidden: false, noun: 'dial time' }} />);
  expect(metaLines(container)).toBe(1); expect(screen.getByText('Morning review · still open')).toBeTruthy();
  rerender(<NowCard {...base} categoryOf={(id) => blocksCat[id]} state={{ phase: 'free', next: null, current: null, behind: null }} projected={proj} offer={{ offerOpen: false, makeupMin: 10 }} yesterday={{ minutes: 30, hidden: false, noun: 'dial time' }} />);
  expect(screen.getByText('30m owed')).toBeTruthy();
  rerender(<NowCard {...base} state={{ phase: 'dayDone', next: null, current: null, behind: null }} yesterday={{ minutes: 150, hidden: false, noun: 'routine time' }} />);
  expect(screen.getByText('Yesterday · 2h 30m of routine time not done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /dismiss/i })); expect(base.onAck).toHaveBeenCalled();
});

test('with projected = 0 no amber class and no offer/note line; reminder strip cases', () => {
  const { container, rerender } = render(<NowCard {...base} state={{ phase: 'dayDone', next: null, current: null, behind: null }} />);
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0); expect(metaLines(container)).toBe(0);
  for (const [strip, text] of [['off', 'Reminders are off'], ['ios', /Add to Home Screen/], ['denied', 'Reminders are blocked in your browser settings'], ['device', 'Reminders are off on this device'], ['tz', "PRIM doesn't know your time zone"], ['days', 'All days off']]) {
    rerender(<NowCard {...base} strip={strip} state={{ phase: 'dayDone', next: null, current: null, behind: null }} />);
    expect(screen.getByText(text)).toBeTruthy();
    if (strip === 'device') { fireEvent.click(screen.getByRole('button', { name: 'Enable' })); expect(base.onEnable).toHaveBeenCalled(); }
    else expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
  }
});

test('appointment as the current item: Held action, disabled before start', () => {
  const appt = { kind: 'appt', prospectId: 'p1', name: 'Ana Diaz', startMin: 600, endMin: 630, instant: 1, frozen: true, heldAt: null };
  const { rerender } = render(<NowCard {...base} state={{ phase: 'now', current: appt, next: null, behind: null }} started />);
  fireEvent.click(screen.getByRole('button', { name: 'Held' })); expect(base.onHeld).toHaveBeenCalledWith(appt);
  rerender(<NowCard {...base} state={{ phase: 'upFirst', current: null, next: { ...appt, frozen: false }, behind: null }} started={false} />);
  expect(screen.queryByRole('button', { name: 'Held' })).toBeNull();
});
```

`TimelineBlock.test.jsx`:
```jsx
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineBlock from './TimelineBlock';
const block = { id: 'b1', name: 'Dial block', category: 'dial', paletteId: 'dial', startMin: 510, durationMin: 120, remind: { enabled: true, minutesBefore: 5 } };
const seg = (s, e, o) => ({ kind: 'segment', blockId: 'b1', block, name: 'Dial block', category: 'dial', startMin: s, endMin: e, done: null, ...o });
const props = { tier: 'full', visual: 'current', isDark: false, boundsStart: 360, onToggle: vi.fn(), onOpen: vi.fn(), onNames: vi.fn() };

test('title segment carries checkbox, title, bell; a non-title segment shows only its time range and any marker', () => {
  const { container, rerender } = render(<TimelineBlock {...props} item={seg(570, 630, { isTitle: true, index: 1 })} />);
  expect(screen.getByRole('checkbox')).toBeTruthy(); expect(screen.getByText('Dial block')).toBeTruthy(); expect(screen.getByText('9:30–10:30')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox')); expect(props.onToggle).toHaveBeenCalledWith('b1');
  rerender(<TimelineBlock {...props} item={seg(510, 540, { isTitle: false, index: 0 })} marker={{ minutes: 30 }} visual="current" />);
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByText('Dial block')).toBeNull(); expect(screen.getByText('8:30–9:00')).toBeTruthy();
  const m = screen.getByText('−30m'); expect(m.className).toContain('text-amber-600');
  expect(container.querySelector('[data-dot]')).toBeNull();
});

test('past-unchecked shows the slate dot at full opacity; spent tier fades only when done/skipped', () => {
  const { container, rerender } = render(<TimelineBlock {...props} item={seg(510, 630, { isTitle: true, index: 0 })} tier="spent" visual="past-unchecked" />);
  expect(container.querySelector('[data-dot]')).toBeTruthy(); expect(container.firstChild.style.opacity).not.toBe('0.55');
  rerender(<TimelineBlock {...props} item={seg(510, 630, { isTitle: true, index: 0, done: 'done' })} tier="spent" visual="past-done" />);
  expect(container.firstChild.style.opacity).toBe('0.55');
});

test('follow-up block: ≤ 4 names in full, count only in compact, count is slate not amber; "+N more" and names open the sheet', () => {
  const fb = { ...block, id: 'f1', name: 'Follow-up queue', category: 'followup', paletteId: 'followup', startMin: 675, durationMin: 75 };
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: 'p' + i, name: 'Name ' + i, age: `${i}d` }));
  const item = { kind: 'segment', blockId: 'f1', block: fb, name: fb.name, category: 'followup', startMin: 675, endMin: 750, isTitle: true, index: 0, done: null };
  const { container, rerender } = render(<TimelineBlock {...props} item={item} followupRows={rows} followupCount={14} />);
  expect(screen.getAllByText(/^Name /).length).toBe(4); expect(screen.getByText('14').className).toContain('text-slate-400');
  fireEvent.click(screen.getByText('+10 more')); expect(props.onNames).toHaveBeenCalled();
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0);
  rerender(<TimelineBlock {...props} item={item} tier="compact" followupRows={rows} followupCount={14} />);
  expect(screen.queryAllByText(/^Name /).length).toBe(0); expect(screen.getByText('14')).toBeTruthy();
});
```

`AppointmentCard.test.jsx`:
```jsx
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppointmentCard from './AppointmentCard';
const item = { kind: 'appt', prospectId: 'p1', name: 'Ana Diaz', startMin: 600, endMin: 630, durationMin: 30, frozen: true, heldAt: null, source: 'derived' };
test('white surface, no svg, no bell, Held checkbox disabled before start; name opens the prospect', () => {
  const onOpen = vi.fn(), onHeld = vi.fn();
  const { container, rerender } = render(<AppointmentCard item={item} started onHeld={onHeld} onOpenProspect={onOpen} />);
  expect(container.firstChild.className).toContain('bg-white'); expect(container.firstChild.className).toContain('border-slate-200');
  expect(container.querySelector('svg')).toBeNull();
  expect(screen.getByText('10:00–10:30')).toBeTruthy();
  fireEvent.click(screen.getByText('Ana Diaz')); expect(onOpen).toHaveBeenCalledWith('p1');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Held' })); expect(onHeld).toHaveBeenCalledWith(item);
  rerender(<AppointmentCard item={{ ...item, frozen: false }} started={false} onHeld={onHeld} onOpenProspect={onOpen} />);
  expect(screen.getByRole('checkbox', { name: 'Held' }).disabled).toBe(true);
});
```

`FollowupSheet.test.jsx`:
```jsx
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FollowupSheet from './FollowupSheet';
test('FollowupDueWidget row grammar without chip or Next line; rows open the prospect', () => {
  const onOpen = vi.fn();
  const rows = [{ id: 'p1', name: 'Ana Diaz', stage: 'MISSED_APPT', age: '12d' }, { id: 'p2', name: 'Bo Li', stage: 'STAGE_X', age: 'new' }];
  const { container } = render(<FollowupSheet open rows={rows} stageLabelOf={(id) => ({ MISSED_APPT: 'Missed Appt', STAGE_X: 'Try to Reengage' })[id]} apptTimeOf={(id) => (id === 'p2' ? 600 : null)} onOpenProspect={onOpen} onClose={() => {}} />);
  expect(screen.getByText('Follow-up queue · 2 due · by last contact')).toBeTruthy();
  expect(container.querySelector('.divide-y.divide-slate-100')).toBeTruthy();
  expect(screen.getByText('Missed Appt · 12d')).toBeTruthy(); expect(screen.getByText('Try to Reengage · appt 10:00')).toBeTruthy();
  expect(screen.queryByText(/Due today/)).toBeNull(); expect(screen.queryByText(/Next:/)).toBeNull();
  expect(container.querySelectorAll('[class*="amber"]').length).toBe(0);
  fireEvent.click(screen.getByText('Ana Diaz')); expect(onOpen).toHaveBeenCalledWith('p1');
});
```

`WeeklyLookback.test.jsx`:
```jsx
import { test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WeeklyLookback from './WeeklyLookback';
test('collapsed copy, expands to seven bars, no numbers on bars', () => {
  const week = { total: 130, days: Array.from({ length: 7 }, (_, i) => ({ day: `2026-09-0${i + 1}`, minutes: i === 6 ? 120 : i === 3 ? 10 : 0 })) };
  const { container } = render(<WeeklyLookback week={week} />);
  expect(screen.getByText('This week · 2h 10m not done')).toBeTruthy();
  expect(container.querySelectorAll('[data-bar]').length).toBe(0);
  fireEvent.click(screen.getByRole('button'));
  const bars = container.querySelectorAll('[data-bar]'); expect(bars.length).toBe(7);
  expect(bars[6].style.height).toBe('35.2px'); expect(bars[0].style.height).toBe('2px');
  expect(container.textContent.includes('120')).toBe(false);
});
```

- [x] **Step 2: Run to verify they fail** — `npm run test:ui` → 5 new files failing on import.

- [x] **Step 3: Implement the components.** Read spec §7b–§7h.5 in full before writing each one. Key rules restated:

**`NowCard.jsx`** — `premium-card` sticky (`sticky top-2 z-10`), category tile left (`w-9 h-9 rounded-lg`, category tint; `bg-accent-gradient` only for `appt`), 2 px accent progress bar (`h-[2px]` absolute bottom, width = elapsed % of the current item). Phase copy exactly: upFirst → `"{next.name} · starts {formatTime(next.startMin)} · reminder {formatTime(fireMin)}"` (fireMin = startMin − lead; for appointments lead 5); now → small `NOW` label + `formatRange(current.startMin, current.endMin)`, name, `"{n} min left"`, `" · then {next name or 'an appointment'} at {time}"`; the large Done checkbox (`role="checkbox"`, `aria-label="Done"`, 22 px, emerald when checked → shows `"Done ✓ — then Break at 10:30"` until the block ends); for an appointment current the action is a `<button aria-label="Held">Held</button>` (visible word), rendered only when `started`; free → `"Free until {formatTime(next.startMin)}"` + `"{next.name} · reminder {time}"` + a "Start now" text button calling `onScrollTo(next.id)` — **but `next` can be `null`** (everything has ended and a block is still open or an offer is pending): then render just `"Free"` with no "until" line and no "Start now" button; dayDone → `"Day done"` + `"Nothing else on the routine today."`. Meta line: ONE `<div data-meta-line className="text-[11px] mt-2">` chosen in this order — (1) `offer.offerOpen && slot` → `<span className="text-slate-500">{formatMinutes(projected.unrecovered)} of {noun} displaced.</span> <button className="font-semibold text-accent">Add {formatRange(slot.startMin, slot.endMin)}</button> · <button className="text-slate-400">Skip</button>`; (2) `behind` → `<button className="text-slate-500">{behind.name} · still open</button>` (calls `onScrollTo`); (3) `projected.unrecovered > 0` → `<span className="text-slate-400">{formatMinutes(projected.unrecovered)} owed</span>`; (4) `!yesterday.hidden && yesterday.minutes > 0` → `<span className="text-slate-400">Yesterday · {formatMinutes(yesterday.minutes)} of {yesterday.noun} not done</span><button aria-label="Dismiss" className="ml-2 inline-flex h-5 w-5 sm:h-5 sm:w-5 min-h-[44px] sm:min-h-0 …">×</button>`. Noun for (1)/(3): from `projected.displacedByBlock` via `categoryOf(blockId)` prop: all dial → "dial time", all followup → "follow-up time", else "routine time". Strip (below the meta line, `text-[11px] text-slate-500 mt-2`), `strip` prop ∈ `'off'|'ios'|'denied'|'device'|'tz'|'days'|null` with copy: "Reminders are off" / "To get reminders on iPhone: tap Share → Add to Home Screen, then open PRIM from there and turn on notifications." / "Reminders are blocked in your browser settings" / "Reminders are off on this device" + `<button>Enable</button>` / "PRIM doesn't know your time zone" / "All days off". **Copy tripwire:** no literal containing behind / missed / streak.

**`AppointmentCard.jsx`** — root `div` with className exactly containing `bg-white border border-slate-200 dark:border-slate-700 rounded-lg` plus `absolute right-[10px]` positioning from `style`; 4 px left stripe via `style={{ boxShadow: 'inset 4px 0 0 #8b5cf6' }}`; row 1: `<input type="checkbox" aria-label="Held" disabled={!started} checked={!!item.heldAt} className="h-[18px] w-[18px] accent-violet-600" />` + `<button className="text-[12px] font-semibold text-slate-900 truncate" onClick={() => onOpenProspect(item.prospectId)}>{item.name}</button>`; row 2 (only when `heightPx ≥ 44`): `<div className="text-[11px] text-slate-500">{formatRange(...)}</div>`. No `<svg>`, no icon, no bell, no label. Long-press/context menu (desktop: a small `…` **text** button on hover, not an icon): frozen → "Remove from today"; attached & not started → "Detach (today)"; derived & not started → none.

**`TimelineBlock.jsx`** — root `div role="button" tabIndex={0}` (never `<button>`), `style={{ top, height, background: tint(hex, isDark), opacity: (tier === 'spent' && (item.done === 'done' || item.done === 'skipped')) ? 0.55 : 1 }}`, left stripe 3 px (`boxShadow: inset 3px 0 0 hex`, dashed for make-ups via a `border-l-[3px] border-dashed` instead), accent ring when `visual === 'current'` (`ring-1 ring-accent`). Title segment (`item.isTitle`) renders row 1: `<input type="checkbox" aria-label="Done" className="h-[18px] w-[18px] accent-emerald-500" checked={item.done === 'done'} />` + title `text-[12px] font-medium text-slate-900` + category icon (16 px, lucide); row 2 when `heightPx ≥ 44`: time range `text-[11px] text-slate-500` + `Bell` 12 px + lead minute (`compact` tier: title + time only; `spent`: title only); `visual === 'past-unchecked'` → a `<span data-dot className="inline-block h-[6px] w-[6px] rounded-full bg-slate-400" />` after the title; `skipped` → stripe dashed. Non-title segments render only `<div className="text-[11px] text-slate-500">{formatRange}</div>` and, when `marker`, `<span className={LOSS + ' text-[11px] font-medium'}>−{formatMinutes(marker.minutes)}</span>` (**the only amber**). Follow-up block in `full` tier: header = checkbox + "Follow-up queue" + `<span className="text-[12px] font-semibold text-slate-400">{count}</span>`; `h = heightPx`; rows = `Math.min(4, Math.floor((h − 58) / 20))` of `followupRows` (each `text-[12px] font-medium text-slate-700` name left, age right, 20 px tall, no dividers), then `+{count − shown} more` (`text-[11px] text-accent`, calls `onNames`); under 78 px: the count reads `"{count} due · oldest {rows[0].age}"` and no rows. Drag: the FIRST segment (`item.isFirst`) is the drag handle (`onPointerDown={drag.start('move')}`); a 6 px bottom handle on the last segment for resize; appointments and non-first segments are not draggable. Keyboard on the focused block: ↑/↓ ±5 (Shift ±15), Alt+↑/↓ duration ±5, Enter → `onOpen`, Delete → `onDelete`, Space → `onToggle`.

**`Timeline.jsx`** — hour gutter (48 px, `text-[10px] text-slate-400`), dashed half-hour rules, a 2 px rose now-line with a time label (`bg-rose-500`), auto-scroll on mount so `now` sits a third of the way down (`scrollTop = topPx(nowMin) − container.clientHeight / 3`). Renders `TimelineBlock` per segment/make-up item and `AppointmentCard` per appt item, all absolutely positioned inside a relative lane with `height = heightPx(bounds.end − bounds.start)`. Click on empty lane → "+ {time}" pill → `onAddAt(minuteFromPx(y, bounds.start))`. Palette drag-in: accept `onDragOver`/`onDrop` with `dataTransfer` `paletteId` → `onAddAt` + palette id. Move/resize commits call `onMove(blockId, startMin)` / `onResize(blockId, durationMin)` once at drag end (the view snaps, clamps, slides to a gap or reverts with the toast "No room there — shrink it or move a neighbor").

**`MobileRoutineList.jsx`** — rows: 4 px category stripe, time column (`w-14 text-[11px] text-slate-500`), title, Bell + minute, a 28 px right-thumb checkbox; rose "now" divider row inserted before the first item whose `startMin > nowMin`; follow-up row = title + `"{count} due"` in the time column (tap count → `onNames`, tap title → `onOpen`); appointment row = the white treatment + Held checkbox (`aria-label="Held"`, no visible text); a shortened (displaced) row shows `−30m` in `LOSS` in its time column; "+ Add block" FAB → `PaletteSheet` (a `GlassModal sheet` listing the palette). Long-press (500 ms pointer hold, via `usePointerDrag`'s `start` with a timer) → an action sheet: routine rows → Skip today / Delete; make-ups → Remove; attached-not-started → Detach (today); frozen → Remove from today; derived-not-started → no menu.

**`BlockPalette.jsx`** — 10 chips (icon + name, `text-[12px]`), hover shows the `why` line (`title` attr + a `text-[11px] text-slate-500` line under the chip on hover), click → `onAdd(paletteId)`, `draggable` with `dataTransfer.setData('text/prim-palette', id)`.

**`BlockEditorSheet.jsx`** — desktop: a fixed popover positioned like `DateTimePicker` (portal to `document.body`, outside-click + Escape close); phone: `GlassModal sheet maxWidth="sm:max-w-md" zIndexClass="z-[70]"`. Fields: name (`maxLength 60`), palette `<select>`, start (`DateTimePicker`-style hour/minute pickers are overkill — a native `<input type="time" step="300">`), duration (`<select>` 10…720 by 5 for ≤ 120 then 15s), lead (`off/0/5/10/15` — "off" = `remind.enabled=false`), note (`maxLength 200`) with the hint text "keep block names generic — they show in your notification tray". `appt` category and not a make-up → the "Attach prospect (today)" native `<select>` built from `attachOptions` (`[{ group: 'Appointment stages'|'Other', id, name }]`, "— none —" first); choosing → `onAttach(prospectId)`. Make-up → a "Remove make-up" button instead of Skip today / Delete. Frozen appointment editor (opened from an appointment card's menu) → only "Remove from today". Text fields commit through a 400 ms debounce and flush on close (`onSave(patch)`).

**`FollowupSheet.jsx`** — `GlassModal open sheet maxWidth="sm:max-w-md" zIndexClass="z-[70]"`; header `"Follow-up queue · {n} due · by last contact"` (`text-sm font-bold text-slate-900`); list `div.divide-y.divide-slate-100.border-t.border-slate-100`; each row = `<button className="w-full text-left px-4 py-3 flex items-center gap-3 transition hover:bg-slate-50">` with `div.font-semibold.text-sm.text-slate-900` name, `div.text-[11px].text-slate-500` secondary (`"{stageLabel} · {age}"` or `"{stageLabel} · appt {formatTime(min)}"` when `apptTimeOf(id)` is a number), `ArrowRight size={14} className="text-slate-400"`. No chip, no "Next:" line, no checkbox.

**`RoutineHeader.jsx`** — `h1.text-2xl.font-bold.text-slate-900` "Routine" with `section-accent`; timezone chip (`text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600`, e.g. "CT" — derive from `Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })`); Bell button (`aria-pressed={remindersEnabled}`, lucide `Bell`/`BellOff`); gear button → `onSettings`.

**`RoutineSettingsSheet.jsx`** — `GlassModal sheet`: timezone mode (auto / manual with the seven options + "Use device zone"), default lead radio (0/5/10/15), active-day chips (`['S','M','T','W','T','F','S']`, index = `Date#getDay`), appointment-stages checklist and follow-up-stages checklist (both from `stages`), "Start over from a template" button → `onStartOver`. Every change calls `onChange(patch)` immediately.

**`TemplatePicker.jsx`** — the empty state: two `premium-card` cards ("Agent day" with its description, "Blank"); in replace mode (opened from Settings) a `ConfirmDialog` ("Replace your routine?", danger) then `onPick(template, true)`; an "Undo" toast for 10 s when `undoAvailable`.

**`WeeklyLookback.jsx`** — bottom of the page, `border-t border-slate-200/60 pt-3 mt-6`; a `<button>` row: `"This week · {formatMinutes(total)} not done"` (`text-[12px] font-medium text-slate-500 tabular-nums`) + `ChevronRight` (rotates when open); expanded (`FadeIn`, 96 px tall): seven `<div data-bar>` 20 px wide on a 44 px band, `height = clamp(2, minutes / 150 * 44, 44)` px, `bg-slate-300 dark:bg-slate-600`, yesterday's bar (`days[6]`) `bg-slate-400`, letters `"M T W T F S S"` mapped from each `day`'s weekday (`text-[10px] text-slate-400`). Nothing else — no tooltips, no numbers.

- [x] **Step 4: Run to verify** — `npm run test:ui` → all green (99 + 3 + 5 files' cases). Fix components, not tests, unless a test contradicts the spec.

- [x] **Step 5: Add the copy + amber tripwires** to `src/lib/sourceInvariants.test.mjs`:
```js
test('routine UI copy never says behind/missed/streak; amber hex nowhere in routine sources (spec §7b, §7d)', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['src/components/routine/NowCard.jsx', 'src/components/routine/Timeline.jsx', 'src/components/routine/TimelineBlock.jsx', 'src/components/routine/MobileRoutineList.jsx']) {
    const src = strip(read(f));
    const literals = src.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
    for (const lit of literals) assert.ok(!/\b(behind|missed|streak)\b/i.test(lit), `${f}: forbidden copy in ${lit}`);
  }
  const dir = path.join(process.cwd(), 'src/components/routine');
  for (const f of readdirSync(dir).filter((n) => !/\.test\.jsx?$/.test(n))) assert.ok(!strip(readFileSync(path.join(dir, f), 'utf8')).toLowerCase().includes('#f59e0b'), `${f} uses amber hex`);
  for (const f of readdirSync(path.join(process.cwd(), 'src/lib')).filter((n) => n.startsWith('routine') && !n.endsWith('.test.mjs'))) assert.ok(!strip(read('src/lib/' + f)).toLowerCase().includes('#f59e0b'), f);
});
```
Run `npm test` → green.

- [x] **Step 6: Commit**

```bash
git add src/components/routine src/lib/sourceInvariants.test.mjs
git commit -m "feat(routine): components — NOW card, timeline, appointment card, palette, editor, phone list, follow-up sheet, settings, weekly look-back (spec §7)"
```

---

## Task 12: `RoutineView.jsx` — the integration

**Spec:** §7a (ownership, loaded guard, clock, saves, timezone capture, entitlement, one render path, client freeze + owed refresh), §7g (done-state), §7h.3 (offer lifecycle handlers), §9 (non-entitled UI).

**Files:**
- Create: `src/components/views/RoutineView.jsx`, `src/components/views/RoutineView.test.jsx`

- [x] **Step 1: Write the failing tests** (mock `@/lib/storage` in-memory as in Task 10, `@/lib/supabase` stub, `@/lib/push` stub with a controllable `isPushEnabled`, `@/lib/useBetaFeature` via a hoisted holder; fix the clock with `vi.useFakeTimers()` + `vi.setSystemTime(new Date('2026-09-08T14:42:00Z'))`; `Intl.DateTimeFormat().resolvedOptions().timeZone` → stub to `'America/Chicago'` via `vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')`):

```jsx
// cases (one test each, all from spec §12 UI lane):
// 1. zero storage writes before loaded; zero writes when canAccess === false (renders the locked card with the /pricing link for tier_too_low);
// 2. first open captures the device zone into routine_settings_v1 and seeds followupStages once (with prospectSettings=null → the three defaults; with a custom "Circle back" stage → four);
// 3. empty routine → TemplatePicker; picking "Agent day" saves 11 live blocks to routine_blocks_v1 exactly once;
// 4. a checkbox toggle writes ONE done record immediately; a rename through the editor writes once after 400 ms;
// 5. never writes prospects_v1 / prospect_settings_v1; no block in routine_blocks_v1 ever carries prospectId or a prospect name;
// 6. at 9:42 with a prospect at '2026-09-08T09:00' (APPOINTMENT_SET) the client freezes ONE appt record (id '2026-09-08|appt|p1|540'), and a second render/tick does not write again; a tombstoned id is never re-frozen;
// 7. exactly one of Timeline / MobileRoutineList at 640 px (stub matchMedia both ways);
// 8. Accept writes one makeup record (dashed) + the owed decision, no toast; Skip → note; removing the make-up brings the offer back;
// 9. × on the yesterday line writes an ack record; the client owed refresh writes minutes when realized changes;
// 10. Held on a started appointment stamps heldAt; Held is disabled before start; "Remove from today" tombstones the appt record (and the attach when attached);
// 11. Detach on an unstarted attached row tombstones the attach; attaching a prospect to a placeholder whose start has a tombstoned appt record un-deletes it;
// 12. deleting an appt block tombstones its live attach; Undo restores both.
// 13. (review addition — nothing else drives a drag) a drag commits ONE blocks write at the snapped
//     start; a resize clamps to the next block's start; a drag into a packed hour reverts with the
//     toast 'No room there — shrink it or move a neighbor' and zero writes;
// 14. (review addition) entitlement lost mid-session: a pending 400 ms rename flushed by the
//     editor's unmount, and an enablePush() still in flight when canAccess flips, both write NOTHING.
```
Write them ALL as concrete tests BEFORE writing the component (the plan's TDD rule; this is the longest task — budget it that way), with assertions on `mem.get(key)` parsed JSON (the same style as `PendingEmailQueueRunner.test.jsx`).

**Timers — two corrections from the Task 12 review, both load-bearing:** (1) `vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date'] })` — Vitest 4 fakes `Intl` by DEFAULT (a mirrored fake implementation), which detaches the `resolvedOptions` spy from the constructor the view calls, and 5 of the 12 cases then silently run in the machine's real zone. (2) NO `shouldAdvanceTime`: leave `Date.now()` frozen between explicit `vi.advanceTimersByTime` calls so every stamp in a case is deterministic. Wait on CONDITIONS, never on a fixed number of `act` flushes — `const until = (fn) => vi.waitFor(async () => { await act(async () => {}); return fn(); })`; a negative assertion ("zero writes") must follow a positive wait that proves the async chain finished. RTL's `waitFor` cannot be used with this combination (it does not detect these fake timers, so its own timeout never fires and it hangs); `vi.waitFor` advances them itself.

- [x] **Step 2: Run to verify they fail** — component missing.

- [x] **Step 3: Implement `src/components/views/RoutineView.jsx`.** Skeleton (fill in against the spec — every handler below is a spec rule):

```jsx
'use client';
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { Lock } from 'lucide-react';
import { loadRoutine, saveBlocks, saveDay, saveSettings } from '@/lib/routineStore';
import { sanitizeBlocks, liveBlocks, sanitizeDay, sanitizeSettings, seedFollowupStages, applyTemplate, instantiateTemplate, dayUid } from '@/lib/routineModel.mjs';
import { todaysAppointments, composeDay, findMakeupSlot, reconcileOwed, offerState, applyOwedDecision, owedId, apptRecordId, followupQueue, yesterdayMiss, weeklyNotDone } from '@/lib/routineLive.mjs';
import { isValidTimeZone, localDayKey, localMinuteOfDay, localWeekday } from '@/lib/tz.mjs';
import { nowState } from '@/lib/routineClock.mjs';
import { paletteById } from '@/lib/routinePalette.mjs';
import { TEMPLATES } from '@/lib/routineTemplates.mjs';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useIsDark } from '@/lib/useIsDark';
import { isPushEnabled, enablePush, pushPermission } from '@/lib/push';
import { defaultProspectSettings } from '@/lib/prospects';
import RoutineHeader from '../routine/RoutineHeader';
import NowCard from '../routine/NowCard';
import Timeline from '../routine/Timeline';
import MobileRoutineList from '../routine/MobileRoutineList';
import BlockPalette from '../routine/BlockPalette';
import BlockEditorSheet from '../routine/BlockEditorSheet';
import FollowupSheet from '../routine/FollowupSheet';
import RoutineSettingsSheet from '../routine/RoutineSettingsSheet';
import TemplatePicker from '../routine/TemplatePicker';
import WeeklyLookback from '../routine/WeeklyLookback';

const upsertById = (arr, recs) => { const m = new Map(arr.map(r => [r.id, r])); for (const r of recs) m.set(r.id, r); return [...m.values()]; };
const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

// Non-entitled card (spec §9): the AgentSettingsPanel.jsx:343-361 treatment, zero storage writes.
function LockedCard({ reason }) {
  if (reason === 'tier_too_low' || reason === 'no_subscription') {
    return (
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 text-center">
        <Lock size={24} className="text-indigo-600 mx-auto mb-3" />
        <h3 className="font-bold text-slate-900 mb-1">Routine is included with every PRIM plan</h3>
        <p className="text-sm text-slate-600 mb-4">Start a plan to build your daily routine, see today's appointments on it, and get reminders at block time.</p>
        <a href="/pricing" className="inline-flex items-center bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">See plans</a>
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-600">
      <Lock size={24} className="text-slate-400 mx-auto mb-3" />
      Routine isn&apos;t available on your account yet.
    </div>
  );
}

export default function RoutineView({ showToast, prospects = [], prospectSettings, onOpenProspect }) {
  const { canAccess, reason, loading: accessLoading } = useBetaFeature('routine_builder');
  const [loaded, setLoaded] = useState(false);
  const [blocks, setBlocks] = useState([]);       // sanitized, tombstones included
  const [day, setDay] = useState([]);             // sanitized day records
  const [settings, setSettings] = useState(() => sanitizeSettings(null));
  const [now, setNow] = useState(() => Date.now());
  const [devicePushOn, setDevicePushOn] = useState(null);
  const [editing, setEditing] = useState(null);   // { block } | { makeup } | { appt }
  const [namesOpen, setNamesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [undo, setUndo] = useState(null);         // { blockId, attachIds, timer }
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const isDark = useIsDark();
  const nowIso = new Date(now).toISOString();
  const tz = isValidTimeZone(settings.timezone) ? settings.timezone : null;
  const today = tz ? localDayKey(now, tz) : null;
  const nowMin = tz ? localMinuteOfDay(now, tz) : 0;
  const minuteKey = Math.floor(now / 60000);
  // Memoized: it sits in the load effect's deps — a fresh array per render would restart loadRoutine on every pre-loaded re-render.
  const stages = useMemo(() => (prospectSettings || defaultProspectSettings()).stages, [prospectSettings]);

  // ---- writes (spec §7a: immediate for state changes; the editor debounces text) ----
  // Side effects live OUTSIDE React updaters (StrictMode double-invokes updaters
  // in dev — a save inside one would write twice). Latest values come from refs.
  const blocksRef = useRef([]);  // like dayRef: the newest SAVED document, written by the load path and the commits
  const dayRef = useRef([]); dayRef.current = day;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  // §9: EVERY commit gates on entitlement read through a ref, NOT on the `entitled` value each
  // useCallback closed over — a helper captured by a child fires after canAccess flips false (the
  // editor's 400 ms debounce flushed on unmount; an in-flight enablePush) and would write to a
  // locked account. The assignment MUST be useLayoutEffect, never useEffect: layout creates run in
  // the same commit that unmounts the editor, BEFORE that child's passive cleanup fires its flush,
  // whereas React runs every passive destroy for a commit before any passive create — a useEffect
  // assignment still reads the stale `true`. (A render-phase `ref.current = x` also works but costs
  // a react-hooks/refs warning, and this task's lint gate is zero warnings from touched files.)
  const entitledRef = useRef(canAccess === true);
  useLayoutEffect(() => { entitledRef.current = canAccess === true; });
  const commitBlocks = useCallback((next) => { if (!entitledRef.current) return blocksRef.current; const s = sanitizeBlocks(next, new Date().toISOString()); setBlocks(s); saveBlocks(s); return s; }, []);
  const commitDay = useCallback((updater) => { if (!entitledRef.current || !today) return dayRef.current; const next = sanitizeDay(updater(dayRef.current), today, new Date().toISOString()); dayRef.current = next; setDay(next); saveDay(next); return next; }, [today]);
  const commitSettings = useCallback((patch) => { if (!entitledRef.current) return settingsRef.current; const next = sanitizeSettings({ ...settingsRef.current, ...patch }); settingsRef.current = next; setSettings(next); saveSettings(next); return next; }, []);

  // ---- load (zero writes before loaded; zero when not entitled) ----
  useEffect(() => {
    if (accessLoading || canAccess !== true || loaded) return;
    let alive = true;
    (async () => {
      const deviceTz = typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
      const probeTz = isValidTimeZone(deviceTz) ? deviceTz : 'UTC';
      const r = await loadRoutine({ today: localDayKey(Date.now(), probeTz), nowIso: new Date().toISOString() });
      if (!alive) return;
      let s = r.settings;
      if (s.timezoneMode === 'auto' && isValidTimeZone(deviceTz) && s.timezone !== deviceTz) { const changed = !!s.timezone; s = { ...s, timezone: deviceTz }; if (changed) showToast?.(`Time zone updated to ${deviceTz}`); }
      if (!s.followupStagesSeeded) s = { ...s, followupStages: seedFollowupStages(stages), followupStagesSeeded: true };
      setBlocks(r.blocks); setDay(r.day); setSettings(s); setLoaded(true);
      if (JSON.stringify(s) !== JSON.stringify(r.settings)) saveSettings(s);
      try { setDevicePushOn(await isPushEnabled()); } catch { setDevicePushOn(false); }
    })();
    return () => { alive = false; };
  }, [accessLoading, canAccess, loaded, stages, showToast]);

  // ---- 30 s clock, paused while hidden ----
  useEffect(() => {
    if (!loaded) return;
    let id = null;
    const tick = () => setNow(Date.now());
    const arm = () => { if (id == null) id = setInterval(tick, 30000); };
    const disarm = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => { if (document.hidden) disarm(); else { tick(); arm(); isPushEnabled().then(setDevicePushOn).catch(() => {}); } };
    arm(); document.addEventListener('visibilitychange', onVis);
    return () => { disarm(); document.removeEventListener('visibilitychange', onVis); };
  }, [loaded]);

  // ---- compose (memoized on inputs + the minute) ----
  const live = useMemo(() => liveBlocks(blocks, nowIso), [blocks, minuteKey]);           // eslint-disable-line react-hooks/exhaustive-deps
  const liveForCompose = useMemo(() => (today && settings.activeDays.includes(localWeekday(today)) ? live : []), [live, today, settings.activeDays]);
  const items = useMemo(() => (tz ? todaysAppointments({ prospectRows: prospects, blocks: live, dayRecords: day, settings, tz, now }) : []), [prospects, live, day, settings, tz, minuteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const makeups = useMemo(() => day.filter(r => r.kind === 'makeup' && r.day === today && !r.deletedAt), [day, today]);
  const projected = useMemo(() => composeDay({ live: liveForCompose, appointments: items, makeups, dayRecords: day, nowMin, today }), [liveForCompose, items, makeups, day, nowMin, today]);
  const realized = useMemo(() => composeDay({ live: liveForCompose, appointments: items.filter(i => i.instant <= now), makeups, dayRecords: day, nowMin, today }), [liveForCompose, items, makeups, day, nowMin, now, today]);
  const storedOwed = useMemo(() => day.find(r => r.kind === 'owed' && r.id === owedId(today) && !r.deletedAt) || null, [day, today]);
  const offer = useMemo(() => offerState(storedOwed, projected), [storedOwed, projected]);
  const slot = useMemo(() => (offer.offerOpen ? findMakeupSlot({ live, appointments: items, makeups, dayRecords: day, makeupMin: offer.makeupMin, nowMin, today }) : null), [offer, live, items, makeups, day, nowMin, today]);
  const state = useMemo(() => nowState({ items: projected.items, dayRecords: day, nowMin, today, offerBlocked: offer.offerOpen && !!slot }), [projected, day, nowMin, today, offer, slot]);
  const queue = useMemo(() => (tz ? followupQueue(prospects, settings.followupStages, tz, now) : []), [prospects, settings.followupStages, tz, minuteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const yesterday = useMemo(() => (tz ? yesterdayMiss({ blocks, dayRecords: day, settings, tz, now }) : { minutes: 0, hidden: true, noun: 'routine time' }), [blocks, day, settings, tz, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const week = useMemo(() => (tz ? weeklyNotDone({ blocks, dayRecords: day, settings, tz, now }) : { total: 0, days: [] }), [blocks, day, settings, tz, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- client-side freeze + owed refresh (spec §7a) ----
  useEffect(() => {
    if (!loaded || !tz) return;
    const stamp = new Date().toISOString();
    const recs = [];
    const existing = new Set(day.filter(r => r.kind === 'appt' && r.day === today).map(r => r.id));
    for (const it of items) {
      if (it.frozen || it.instant > now) continue;
      const id = apptRecordId(today, it.prospectId, it.startMin);
      if (existing.has(id)) continue;
      // Same rule as the tick (§4b): a frozen appt is stamped at its START instant.
      recs.push({ id, kind: 'appt', day: today, prospectId: it.prospectId, startMin: it.startMin, durationMin: it.durationMin, source: it.source, heldAt: null, updatedAt: new Date(it.instant).toISOString(), deletedAt: null });
    }
    const owed = reconcileOwed(storedOwed, realized, stamp, today);
    if (owed) recs.push(owed);
    if (recs.length) commitDay(prev => upsertById(prev, recs));
  }, [loaded, tz, items, realized, storedOwed, today, now, day, commitDay]);

  // ---- handlers (each one is a spec rule) ----
  const doneRecord = (blockId, status) => ({ id: `${today}|${blockId}`, kind: 'done', day: today, blockId, status, at: nowIso, updatedAt: new Date().toISOString(), deletedAt: null });
  const toggleDone = (blockId) => commitDay(prev => { const cur = prev.find(r => r.id === `${today}|${blockId}` && !r.deletedAt); return upsertById(prev, [doneRecord(blockId, cur?.status === 'done' ? 'cleared' : 'done')]); });
  const skipToday = (blockId) => commitDay(prev => upsertById(prev, [doneRecord(blockId, 'skipped')]));
  const held = (item) => { if (!item.recordId) return; commitDay(prev => upsertById(prev, prev.filter(r => r.id === item.recordId).map(r => ({ ...r, heldAt: r.heldAt ? null : nowIso, updatedAt: new Date().toISOString() })))); };
  // Tombstones the frozen record and, for an attached item, ONLY the attach whose block starts at this item's start (§7f — two attaches on two blocks stay independent).
  const removeFromToday = (item) => commitDay(prev => { const stamp = new Date().toISOString(); const ids = new Set([item.recordId]); if (item.source === 'attached') for (const r of prev) if (r.kind === 'attach' && r.day === today && !r.deletedAt && r.prospectId === item.prospectId && live.find(b => b.id === r.blockId)?.startMin === item.startMin) ids.add(r.id); return prev.map(r => (ids.has(r.id) ? { ...r, deletedAt: stamp, updatedAt: stamp } : r)); });
  const detach = (item) => commitDay(prev => prev.map(r => (r.id === item.attachId ? { ...r, deletedAt: nowIso, updatedAt: new Date().toISOString() } : r)));
  const attach = (blockId, prospectId) => { const b = live.find(x => x.id === blockId); if (!b) return; commitDay(prev => { const stamp = new Date().toISOString(); const rec = { id: `${today}|attach|${blockId}`, kind: 'attach', day: today, blockId, prospectId, updatedAt: stamp, deletedAt: null }; const revived = prev.filter(r => r.kind === 'appt' && r.day === today && r.deletedAt && r.prospectId === prospectId && r.startMin === b.startMin).map(r => ({ ...r, deletedAt: null, updatedAt: stamp })); return upsertById(prev, [rec, ...revived]); }); };
  const deleteBlock = (blockId) => { const stamp = new Date().toISOString(); const attachIds = day.filter(r => r.kind === 'attach' && !r.deletedAt && r.blockId === blockId).map(r => r.id); commitBlocks(blocks.map(b => (b.id === blockId ? { ...b, deletedAt: stamp, updatedAt: stamp } : b))); if (attachIds.length) commitDay(prev => prev.map(r => (attachIds.includes(r.id) ? { ...r, deletedAt: stamp, updatedAt: stamp } : r))); if (undo?.timer) clearTimeout(undo.timer); setUndo({ blockId, attachIds, timer: setTimeout(() => setUndo(null), 5000) }); };
  const undoDelete = () => { if (!undo) return; const stamp = new Date().toISOString(); commitBlocks(blocks.map(b => (b.id === undo.blockId ? { ...b, deletedAt: null, updatedAt: stamp } : b))); if (undo.attachIds.length) commitDay(prev => prev.map(r => (undo.attachIds.includes(r.id) ? { ...r, deletedAt: null, updatedAt: stamp } : r))); clearTimeout(undo.timer); setUndo(null); };
  const updateBlock = (blockId, patch) => commitBlocks(blocks.map(b => (b.id === blockId ? { ...b, ...patch, updatedAt: new Date().toISOString() } : b)));
  // §7c: move → snap, clamp, slide to the NEAREST free gap that fits, else revert + toast. Never shrink, relocate far away, or delete on a drag.
  // SPEC DEVIATION (rev 11, §7c): the slide MUST be bounded — the block keeps ≥ 5 min under the
  // pointer (`maxSlide = durationMin - 5`) — or the revert-and-toast branch is unreachable. With an
  // unbounded ±1440 search the dragged block is excluded from `others`, so its own slot always fits,
  // `target` is never null, and the whole else-branch is dead text; worse, a drop onto a packed hour
  // teleports the block up to an hour away, which §7c's own "never relocate far away" forbids.
  const moveBlock = (blockId, startMin) => {
    const me = live.find(b => b.id === blockId); if (!me) return;
    const others = live.filter(b => b.id !== blockId);
    const fits = (s) => s >= 0 && s + me.durationMin <= 1440 && !others.some(o => s < o.startMin + o.durationMin && o.startMin < s + me.durationMin);
    const maxSlide = Math.max(5, me.durationMin - 5);
    let target = null;
    for (let d = 0; d <= maxSlide && target == null; d += 5) { if (fits(startMin + d)) target = startMin + d; else if (d && fits(startMin - d)) target = startMin - d; }
    if (target == null) { showToast?.('No room there — shrink it or move a neighbor'); return; }
    if (target !== me.startMin) updateBlock(blockId, { startMin: target });
  };
  // §7c: resize → clamp to the next item's start (and the 10–720 range), snapped to 5.
  const resizeBlock = (blockId, durationMin) => {
    const me = live.find(b => b.id === blockId); if (!me) return;
    const next = live.filter(b => b.startMin > me.startMin).sort((a, b) => a.startMin - b.startMin)[0];
    const max = Math.min(720, (next ? next.startMin : 1440) - me.startMin);
    updateBlock(blockId, { durationMin: Math.max(10, Math.min(max, Math.round(durationMin / 5) * 5)) });
  };
  const nextFreeSlot = (durationMin) => { const sorted = [...live].sort((a, b) => a.startMin - b.startMin); let cursor = Math.ceil(nowMin / 5) * 5; for (const b of sorted) { if (b.startMin + b.durationMin <= cursor) continue; if (b.startMin - cursor >= durationMin) return cursor; cursor = Math.max(cursor, b.startMin + b.durationMin); } return cursor + durationMin <= 1440 ? cursor : null; };
  const addFromPalette = (paletteId, startMin = null) => { const p = paletteById(paletteId); if (!p) return; const s = startMin ?? nextFreeSlot(p.defaultMin); if (s == null) { showToast?.('No room today'); return; } const b = instantiateTemplate({ paletteId, startMin: s }, { now: new Date().toISOString(), defaultMinutesBefore: settings.defaultMinutesBefore }); commitBlocks([...blocks, b]); setEditing({ block: b }); };
  const acceptOffer = () => { if (!slot) return; const stamp = new Date().toISOString(); const [bigId] = Object.entries(projected.displacedByBlock).sort((a, b) => b[1] - a[1] || (live.find(x => x.id === a[0])?.startMin ?? 0) - (live.find(x => x.id === b[0])?.startMin ?? 0))[0] || []; const src = live.find(b => b.id === bigId) || { category: 'custom', name: 'Routine' }; const mk = { id: dayUid(), kind: 'makeup', day: today, startMin: slot.startMin, durationMin: offer.makeupMin, category: src.category, name: `${src.name} (make-up)`, ofBlockId: bigId || null, updatedAt: stamp, deletedAt: null }; const owed = applyOwedDecision(storedOwed, 'accept', { projected, realized, makeupMin: offer.makeupMin, nowIso: stamp, day: today }); commitDay(prev => upsertById(prev, [mk, owed])); };
  const skipOffer = () => commitDay(prev => upsertById(prev, [applyOwedDecision(storedOwed, 'skip', { projected, realized, makeupMin: offer.makeupMin, nowIso: new Date().toISOString(), day: today })]));
  const removeMakeup = (id) => commitDay(prev => prev.map(r => (r.id === id ? { ...r, deletedAt: nowIso, updatedAt: new Date().toISOString() } : r)));
  const ackYesterday = () => commitDay(prev => upsertById(prev, [{ id: `${today}|ack`, kind: 'ack', day: today, updatedAt: new Date().toISOString(), deletedAt: null }]));
  const toggleBell = async () => { const next = !settings.remindersEnabled; if (next && devicePushOn === false) { try { const r = await enablePush(); setDevicePushOn(!!r.ok); } catch { setDevicePushOn(false); } } commitSettings({ remindersEnabled: next }); };
  const pickTemplate = (template, replace) => { const { blocks: next, backup } = applyTemplate(blocks, template, { replace, now: new Date().toISOString(), defaultMinutesBefore: settings.defaultMinutesBefore }); commitBlocks(next); if (backup) commitSettings({ lastReplacedBackup: backup }); };
  const undoReplace = () => { const b = settings.lastReplacedBackup; if (!b) return; const stamp = new Date().toISOString(); commitBlocks(b.map(x => ({ ...x, updatedAt: stamp }))); commitSettings({ lastReplacedBackup: null }); };

  // ---- strip (spec §7b) ----
  const strip = settings.remindersEnabled === false ? 'off' : (isIOS() && typeof navigator !== 'undefined' && navigator.standalone === false) ? 'ios' : pushPermission() === 'denied' ? 'denied' : devicePushOn === false ? 'device' : !tz ? 'tz' : settings.activeDays.length === 0 ? 'days' : null;

  // ---- render ----
  if (accessLoading) return <div className="premium-card p-6 animate-pulse h-40" />;
  if (canAccess !== true) return <LockedCard reason={reason} />;   // the AgentSettingsPanel.jsx:343-361 card, copy "Routine is included with every PRIM plan"
  if (!loaded) return <div className="premium-card p-6 animate-pulse h-40" />;
  const categoryOf = (id) => live.find(b => b.id === id)?.category || makeups.find(m => m.id === id)?.category;
  return (
    <div className="space-y-4">
      <RoutineHeader tz={tz} remindersEnabled={settings.remindersEnabled} onBell={toggleBell} onSettings={() => setSettingsOpen(true)} />
      <NowCard state={state} nowMin={nowMin} projected={projected} offer={offer} slot={slot} storedOwed={storedOwed} yesterday={yesterday} behind={state.behind} strip={strip} categoryOf={categoryOf} started={state.current?.kind === 'appt' && state.current.instant <= now} onDone={toggleDone} onHeld={held} onAccept={acceptOffer} onSkip={skipOffer} onAck={ackYesterday} onEnable={toggleBell} onScrollTo={(id) => document.querySelector(`[data-item="${id}"]`)?.scrollIntoView({ block: 'center' })} />
      {live.length === 0 && makeups.length === 0 && items.length === 0
        ? <TemplatePicker templates={TEMPLATES} onPick={pickTemplate} />
        : isDesktop
          ? <><Timeline …all handlers… /><BlockPalette onAdd={(id) => addFromPalette(id)} /></>
          : <MobileRoutineList …all handlers… />}
      <WeeklyLookback week={week} />
      <BlockEditorSheet … />
      <FollowupSheet open={namesOpen} rows={queue} stageLabelOf={(id) => stages.find(s => s.id === id)?.label || id} apptTimeOf={(id) => items.find(i => i.prospectId === id)?.startMin ?? null} onOpenProspect={(id) => { setNamesOpen(false); onOpenProspect?.(id); }} onClose={() => setNamesOpen(false)} />
      <RoutineSettingsSheet open={settingsOpen} settings={settings} stages={stages} onChange={commitSettings} onStartOver={…} onClose={() => setSettingsOpen(false)} />
      {undo && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 …">Block deleted <button onClick={undoDelete}>Undo</button></div>}
    </div>
  );
}
```
Notes for the implementer: `Timeline` receives `tiers` computed per block (`full` if any of its segments is `state.current` or `state.next`; `compact` for other future blocks; `spent` for past) and `visuals` from `blockVisualState` per block using the block's title segment's start and its last segment's end; `followupRows`/`followupCount` go to every `followup`-category title segment (`queue.slice(0, 4)` and `queue.length`). Editor saves: `onSave(patch)` → `updateBlock(block.id, patch)`; make-up editor → `removeMakeup`; frozen editor → `removeFromToday`. The block editor's attach options: `prospects.filter(p => !p.archivedAt && !day.some(r => r.kind === 'attach' && r.day === today && !r.deletedAt && r.prospectId === p.id && live.some(b => b.id === r.blockId)))` grouped by `settings.appointmentStages.includes(p.stage)` and excluding `SOLD`/`LOST` from group 2, sorted A–Z.

- [x] **Step 4: Run to verify** — `npm run test:ui` → all green (154 with the 14 cases above). `npm test` → 860 / 0, unchanged. `npm run lint` → 0 errors and no warning from a touched file (the memo deps warnings are the repo's accepted pattern; do not disable rules beyond the marked lines). Then run the RoutineView suite ~100× consecutively: a fixed-flush-budget suite passes in isolation and fails under load, so the repeat run is the real gate on the timer rules above.

- [x] **Step 5: Commit**

```bash
git add src/components/views/RoutineView.jsx src/components/views/RoutineView.test.jsx
git commit -m "feat(routine): RoutineView — load guard, clock, compose, client freeze/owed refresh, every handler (spec §7a, §7g, §7h.3)"
```

---

## Task 13: Wire the tab — `constants.js`, `LeadTracker.jsx`, `ProspectsView.jsx`

**Spec:** §9 (tab, deep link, prospect opener, flag gating), §13.5.

**Files:**
- Modify: `src/lib/constants.js:216-235` (NAV_TABS), `src/components/LeadTracker.jsx` (lines 3-5 import, 94 ICONS, ~357 effects, ~306 state, 2426-2448 ProspectsView props, 2516 new ViewMount), `src/components/views/ProspectsView.jsx:1409-1436` (props) + effect
- Test: `src/lib/navTabs.test.mjs` (new; `constants.js` loads under plain Node — verified),
  `src/components/LeadTracker.deeplink.test.jsx` (new), `src/components/views/ProspectsView.openById.test.jsx`
  (new), `src/lib/sourceInvariants.test.mjs` (append the icon-pair check only — see Step 1)

- [x] **Step 1: Write the failing tests**

Node lane (`src/lib/navTabs.test.mjs`, new):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_TABS, DEFAULT_PROSPECT_STAGES } from './constants.js';
import { DEFAULT_STAGE_IDS } from './routineModel.mjs';
test('Routine tab sits right after Overview and uses the CalendarClock icon (spec §9)', () => {
  const ids = NAV_TABS.map(t => t.id);
  assert.equal(ids[ids.indexOf('dashboard') + 1], 'routine');
  assert.deepEqual(NAV_TABS.find(t => t.id === 'routine'), { id: 'routine', label: 'Routine', icon: 'CalendarClock' });
  assert.equal(NAV_TABS.length, 15);
});
test('routineModel DEFAULT_STAGE_IDS mirrors constants.js DEFAULT_PROSPECT_STAGES (seeding must not desync)', () => {
  assert.deepEqual([...DEFAULT_STAGE_IDS].sort(), DEFAULT_PROSPECT_STAGES.map(s => s.id).sort());
});
```
If `constants.js` cannot load under plain Node (it may import nothing — check with `node -e "import('./src/lib/constants.js')"`), make this a text-level assertion in `sourceInvariants.test.mjs` instead.

UI lane — **render the real shell.** An earlier draft of this plan said "a text-level test is
enough for the wiring (LeadTracker is too heavy to render in jsdom)". That premise is false and
was measured: `LeadTracker` mounts in jsdom with eight `vi.mock` lines (`@/lib/storage` — include
`prefetch` — `@/lib/supabase`, `./auth/AuthProvider`, `@/lib/subscription` via `importOriginal`,
`@/lib/useBetaFeature`, `@/lib/realtimeSync`, and stubs for `./views/RoutineView` and
`./views/TeamView`) plus a `global.ResizeObserver` stub, at roughly 40 ms per case.

It matters because the text tripwire was blind. Fourteen single-point mutants were run against
it and **only four died** — the NAV_TABS data and a toast string. The `allowed()` guard, its
`team` clause, the listener TARGET (`navigator.serviceWorker` → `window`, which silently kills
every warm deep link), the listener teardown, `setView('prospects')` inside `openProspect`, and the ProspectsView
open-by-id effect *in its entirety* all survived with every gate green — the last because
`pv.includes('openProspectId')` is satisfied by the prop destructuring alone.

Write two behaviour suites instead, asserting on what an agent sees (which tab is lit, whether
the detail bubble opened) and on `window.location`, never on source text:

- **`src/components/LeadTracker.deeplink.test.jsx`** — `?view=routine` lights the tab, mounts it
  and removes ONLY the `view` param (a sibling `keep=1` must survive); `?view=<not a tab>` changes
  nothing; `?view=team` un-entitled is refused *and keeps its param*, then is honoured when the
  entitlement flips; a stub SW container (`Object.defineProperty(navigator, 'serviceWorker',
  { value: new EventTarget(), configurable: true })` that counts add/remove) receives an
  `Event('message')` with `.data = { type:'prim:view', view:'routine' }` and switches the tab —
  this is the case that pins the listener target — with the count back to 0 after `unmount()`;
  and the RoutineView stub's `onOpenProspect` switches to Prospects *and* opens that prospect
  (seed `prospects_v1` through the storage mock so the chain runs end to end).
- **`src/components/views/ProspectsView.openById.test.jsx`** — needs only the `ResizeObserver`
  stub. A known id opens the bubble ("Primary Information" is a heading unique to it, and it
  portals to `document.body`) and consumes once; an unknown id and an archived id each consume
  once and open nothing; clearing the prop is not a new request, and re-requesting the same id is.

Keep in `sourceInvariants.test.mjs` only the icon pair — two edits in two places that must agree,
and the one thing a behaviour test reports as an opaque "Element type is invalid". Read the member
LISTS, not a fixed layout, so a reformat cannot turn it red:
```js
test('LeadTracker imports CalendarClock AND maps it in ICONS (spec §9 — both, or the Routine tab renders an undefined element type)', () => {
  const src = read('src/components/LeadTracker.jsx');
  const members = (re) => (src.match(re)?.[1] || '').split(',').map((x) => x.split(' as ')[0].trim());
  assert.ok(members(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/).includes('CalendarClock'), 'lucide-react import');
  assert.ok(members(/const ICONS\s*=\s*\{([^}]*)\}/).includes('CalendarClock'), 'ICONS map');
});
```

**Standing rule — clean a URL surgically.** Never `replaceState(null, '', window.location.pathname)`:
that drops the whole query string, including params another component still owes an answer to.
Read through `new URL(window.location.href)`, `searchParams.delete()` your own key, and write back
`url.toString()` — the house pattern at `ImpersonationBanner.jsx:23-26`.

- [x] **Step 2: Run to verify they fail.**

- [x] **Step 3: Implement**

`src/lib/constants.js` — insert after the `dashboard` line:
```js
  { id: 'routine',      label: 'Routine',       icon: 'CalendarClock' },
```

`src/components/LeadTracker.jsx`:
1. Line 3-5 lucide import: add `CalendarClock`.
2. Line 94 ICONS: add `CalendarClock`.
3. Imports: `import RoutineView from './views/RoutineView';` (static, next to `ProspectsView`).
4. State (near line 306): `const [pendingProspectId, setPendingProspectId] = useState(null);` and
```js
  const openProspect = useCallback((id) => { setPendingProspectId(id); setView('prospects'); }, []);
```
5. Deep link (a new effect near line 357; both paths feed one helper):
```js
  // Deep link into a tab: `?view=<id>` on mount (push tap cold start) and the
  // service worker's `prim:view` message (push tap with PRIM already open).
  // Spec 2026-09-07 §9. Only ids in the user's filtered tab list are honoured.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const allowed = (id) => NAV_TABS.some(t => t.id === id) && (id !== 'team' || teamEntitled);
    const go = (id) => { if (allowed(id)) setView(id); };
    try {
      const url = new URL(window.location.href);
      const v = url.searchParams.get('view');
      // A REAL tab the agent is not entitled to YET keeps its param: the profile is
      // still loading, teamEntitled is false, and this effect re-runs on the flip to
      // honour it then. Everything else is answered now. Only `view` is removed —
      // session_id / impersonating / anything else survives (ImpersonationBanner.jsx:23).
      const awaitingEntitlement = !!v && NAV_TABS.some(t => t.id === v) && !allowed(v);
      if (v && !awaitingEntitlement) {
        go(v);
        url.searchParams.delete('view');
        window.history.replaceState({}, '', url.toString());
      }
    } catch { /* ignore */ }
    const onMsg = (e) => { if (e?.data?.type === 'prim:view' && typeof e.data.view === 'string') go(e.data.view); };
    // Guarded: `navigator.serviceWorker` throws on access in some hardened webviews, and
    // that must cost the deep link, not the whole app shell.
    let sw = null;
    try { sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null; } catch { /* no SW here */ }
    sw?.addEventListener?.('message', onMsg);
    return () => sw?.removeEventListener?.('message', onMsg);
  }, [teamEntitled]);
```
6. ProspectsView props (2426-2448): add `openProspectId={pendingProspectId}` and `onOpenConsumed={() => setPendingProspectId(null)}`.
7. New ViewMount before `</main>` (line 2516):
```jsx
        <ViewMount visible={view === 'routine'} viewKey="routine">
          <RoutineView showToast={showToast} prospects={prospects} prospectSettings={prospectSettings} onOpenProspect={openProspect} />
        </ViewMount>
```

`src/components/views/ProspectsView.jsx` — add props `openProspectId = null, onOpenConsumed` to the destructuring (line ~1434) and, after the `onView` definition (~1557):
```js
  // Open-by-id from another tab (Routine → prospect). Unknown or archived ids
  // are ignored; the request is consumed either way so it never re-fires.
  useEffect(() => {
    if (!openProspectId) return;
    const p = prospects.find(x => x.id === openProspectId && !x.archivedAt);
    if (p) onView(p);
    onOpenConsumed?.();
  }, [openProspectId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Verify in the browser.** `npm run test:all` green, `npm run lint` 0 errors, `npm run build` succeeds. Then start the dev server (`.claude/launch.json` → `npm run dev`, port 3000), sign in with the admin test account, and check: the Routine tab renders after Overview; the empty state offers "Agent day" and "Blank"; picking Agent day paints 11 blocks; the strip at 1280 px shows all 15 tabs without wrapping (gate 16); `/?view=routine` lands on the tab and the URL is cleaned. Screenshot the timeline for the commit.

  > **Partially done (2026-09-15).** `npm run test:all`, `npm run lint` and `npm run build` are green, and the 1280 px strip was measured in a class-faithful replica (see the live-pass doc, gate 16). The authenticated walkthrough and the screenshot were **deliberately not done** — no agent on this build may sign in anywhere. They are gates for Juan in `2026-09-11-routine-builder-live-pass.md`.

- [x] **Step 5: Commit**

```bash
git add src/lib/constants.js src/lib/navTabs.test.mjs src/components/LeadTracker.jsx src/components/views/ProspectsView.jsx src/lib/sourceInvariants.test.mjs
git commit -m "feat(routine): Routine tab, deep link (?view= + prim:view), openProspect plumbing (spec §9)"
```

---

## Task 14: Verification, mutation checks, handoff

**Spec:** §12 mutation checks and live-pass gates, §11 operator config.

**Files:**
- Create: `docs/superpowers/plans/2026-09-11-routine-builder-live-pass.md` (the operator checklist + SQL to paste + the 16 gates)
- Modify: `docs/superpowers/plans/2026-09-11-routine-builder.md` (this file — tick the boxes)

- [x] **Step 1: Full green run and record the numbers**

```bash
npm run test:all
npm run lint
npm run build
```
Expected: node lane ≥ 830, UI lane ≥ 115, lint 0 errors, build succeeds. Paste the three tails into the commit message of Step 4.

- [x] **Step 2: Mutation checks** — for each line below, apply the mutation, run the named test file, confirm it goes RED, then `git checkout -- <file>` **only for the mutated file** (working tree must be clean before starting: `git status --short` empty). Record PASS/FAIL per mutant in the live-pass doc.

| # | Mutation (file) | Expected red test |
|---|---|---|
| 1 | `GRACE_MIN = 0` (routineTick.mjs) | routineTick: T+9 fires |
| 2 | remove `now < c.endAt` (routineTick.mjs) | routineTick: aged-out |
| 3 | drop `\|${tz}` from `fire_key` (routineTick.mjs) | routineTick: WI vs FL keys |
| 4 | `activeDays` ignored for routine blocks (routineTick.mjs: use `live` instead of `liveForCompose`) | routineTick: inactive day |
| 5 | cooldown compares `created_at` instead of `fire_at_utc` (routineTick.mjs) | routineTick: cooldown |
| 6 | cooldown on `c.block_id` only (drop slot set) | routineTick: Remove-at-14:05 |
| 7 | `liveBlocks` returns tombstones (routineModel.mjs) | routineModel: tombstones hidden |
| 8 | `endAt = zonedTimeToUtc(today, segEndMin, tz)` (routineTick.mjs) | tz/routineTick spring-forward pin (add a 02:30 NY block case if not present) |
| 9 | `parseAppointmentTime` uses `Date.parse` for the wall-clock branch (routineLive.mjs) | routineLive: identical under TZ + tripwire |
| 10 | drop the stage filter in `todaysAppointments` | routineLive: SOLD excluded |
| 11 | `followupQueue` sorts `lastContact` desc | routineLive: ordering |
| 12 | count breaks in `composeDay` (`isDisplaceable` → true) | routineLive: breaks contribute 0 |
| 13 | make-up cuts counted as displaced (subtract mkCuts before computing `displaced`) | routineLive: make-up render-only |
| 14 | remove the `720` floor in `findMakeupSlot` | routineLive: afternoon first |
| 15 | remove the span bound | routineLive: 17:00 → null |
| 16 | `offerState` ignores `decidedMinutes` | routineLive: skip-30-45-30 |
| 17 | `reconcileOwed` mutates status to `'open'` | routineLive: offer lifecycle |
| 18 | `sameByBlock` via `JSON.stringify` | routineLive: reordered keys |
| 19 | `dayNotDone` skips unchecked blocks | routineLive: Dial-120-unchecked |
| 20 | `dayNotDone` counts skipped blocks | routineLive |
| 21 | weekly window includes today (`i = 6..0`) | routineLive: weekly days |
| 22 | `buildPayload` puts `c.name` in the appointment branch | routineTick: name-free + tripwire |
| 23 | `seedFollowupStages` drops the positive list | routineModel: "Referral source" |
| 24 | freeze from all items (drop `it.instant > now`) | routineTick: cancelled-at-9:00 |
| 25 | tick route: replace the RPC with `.from('user_kv').upsert(` | sourceInvariants |
| 26 | `sendSkip` gates the freeze (return before freezeRecords when `no_subs`) | routineTick: reminders off still freeze |
| 27 | `apptRecordId` without `startMin` | routineLive: two cards |
| 28 | drop the overlap absorption in `todaysAppointments` | routineLive: 10:05 nudge |
| 29 | `makeupMin` = full projected (drop `− decided`) | routineLive: skip-30-then-30 |
| 30 | tick route: remove `ignoreDuplicates: true` from the claim upsert | sourceInvariants (claim-before-send anchor) |
| 31 | tick route: `access.canAccess !== true` → `false` (everyone entitled) | sourceInvariants (`.canAccess !== true` anchor) |
| 32 | `tickAgent` also composes `addDays(today, −1)` (a previous-day pass) | routineTick: 23:50 block at 00:03 |
| 33 | `dayNotDone`: `isDisplaceable` → always true (breaks counted) | routineLive: break unchecked → 0 |
| 34 | `dayNotDone`: drop `− (byBlock[b.id] \|\| 0)` (double-count) | routineLive: Dial 120 unchecked with 30 displaced → 120 |
| 35 | `dayNotDone`: drop the `!r.deletedAt` filter on records | routineLive: weekly `days[4] === 0` |
| 36 | `updateBlock` copies a `prospectId` onto the block | RoutineView UI test #5 |
| 37 | `seedFollowupStages`: drop the `NOT_FOLLOWUP_WORDS` check | routineModel: "Not Interested" |

Run each with `node --test src/lib/<file>.test.mjs` (node lane) or `npx vitest run <file>` for #36 (UI lane).

- [x] **Step 3: Write the live-pass handoff doc** `docs/superpowers/plans/2026-09-11-routine-builder-live-pass.md`:
   - §11 operator steps 0–5 as a checklist with the exact SQL file names and the gate-0 queries.
   - Every checkpoint from spec §12 "Live pass" — **18 rows: (0) through (16) plus (12b)** — each with: who does it (Juan / Claude), the exact action, the expected observation, and a checkbox. Gate 0 (pg_cron → pg_net → Vault → route) and 12b (the tick appends `appt` + `owed` while a phone checkbox survives) are the two most likely to be dropped; they are not optional.
   - The three spec deviations this plan introduces, for Juan to fold into rev 11: §4c `NOT_FOLLOWUP_WORDS` lookahead (Task 3), §7b breaks never set `behind` (Task 4), §8 the SW derives `view` from the push URL (Task 9); plus the defensive `MIGRATE_SKIP` (Task 0).
   - The mutation-check table from Step 2 with the recorded results.
   - The test baselines after Task 14.

- [x] **Step 4: Commit and push the branch**

```bash
git add docs/superpowers/plans/2026-09-11-routine-builder-live-pass.md docs/superpowers/plans/2026-09-11-routine-builder.md
git commit -m "docs(routine): live-pass handoff + mutation-check results; plan boxes ticked"
git push -u origin feature/routine-builder
```

Then report: the three baselines, the mutant table, the preview URL Vercel assigns to the branch, and the §11 items Juan must do before gate 0.
