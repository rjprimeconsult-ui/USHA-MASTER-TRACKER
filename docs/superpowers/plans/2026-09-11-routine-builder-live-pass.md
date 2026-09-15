# Routine Builder — live-pass handoff

Branch `feature/routine-builder`. Spec `docs/superpowers/specs/2026-09-07-routine-builder-design.md` (rev 10).
Plan `docs/superpowers/plans/2026-09-11-routine-builder.md`.

Everything in the repo is built, reviewed and green. Nothing here has run against a real
Supabase project, a real push subscription, or a real phone. This document is what turns
that into a shipped feature: your configuration steps first, then the eighteen gates, in
order. **Gate 0 and gate 12b are the two most likely to be skipped and the two most likely
to hide a silent failure. They are not optional.**

---

## 1. Baselines at handoff

| Gate | Result |
|---|---|
| Node lane (`npm test`) | 863 pass / 0 fail |
| UI lane (`npm run test:ui`) | 164 pass / 0 fail, 24 files |
| `npm run lint` | 0 errors, 72 warnings |
| `npm run build` | succeeds |

The 72 warnings are the repo's pre-existing backlog (71) plus one new
`react-hooks/set-state-in-effect` at `ProspectsView.jsx:1568`. It is left unsuppressed on
purpose: `eslint.config.mjs` documents that rule as a deliberately visible backlog of
correct-but-conservatively-flagged code, and an inline disable would hide it.

---

## 2. Your configuration steps (spec §11)

Do these in order. Steps 1–3 are one Supabase session.

- [ ] **0. Vercel → Production env.** Confirm `CRON_SECRET` exists. The production env pull
      on record did **not** include it — if it is absent, add 32+ random characters and
      redeploy. The tick fails closed without it, so a missing secret means silence, not an
      error. Confirm `NEXT_PUBLIC_SITE_URL = https://app.primtracker.com`.
- [ ] **1. Supabase → Database → Extensions.** Enable `pg_cron` and `pg_net`.
- [ ] **2. Supabase → Vault.** Create `prim_cron_secret` with the **same value** as
      `CRON_SECRET`. A mismatch shows up as 401s at gate 0.
- [ ] **3. Supabase → SQL Editor.** Run these four files in this order:
      1. `supabase/routine-push-log-migration.sql`
      2. `supabase/routine-appt-rows-function.sql`
      3. `supabase/routine-day-write-function.sql`
      4. `supabase/routine-tick-cron.sql`
      The last one raises if the Vault secret is missing. That is by design — it is the
      only thing standing between a renamed secret and a scheduler that looks healthy
      while sending nothing. To re-run it later:
      `select cron.unschedule('prim-routine-tick');` first.
- [ ] **5. iPhone.** Check the manifest icons on a Home Screen install (see gate 5).

---

## 3. The eighteen gates (spec §12)

Run them in order. A gate that fails stops the pass.

| # | Who | Action | Expected |
|---|---|---|---|
| 0 | Juan | Two minutes after step 3, run both queries below | `200` with the tick's JSON, and `succeeded` |
| 1 | Juan | `curl` the tick twice back to back with a due block | first `claimed ≥ 1`, second `claimed: 0` |
| 2 | Juan | Real push on a **Central-time** test account | arrives at the right local minute |
| 3 | Juan | Drag a block 90 minutes later | it re-arms and reminds at the new time |
| 4 | Juan | Expired subscription, fresh row | prunes cleanly |
| 5 | Juan | iPhone: install → enable → wait | a reminder arrives |
| 6 | Juan | Delete a block on the phone with a desktop tab open | the desktop's next save does not resurrect it |
| 7 | Juan | A real prospect at 10:00 today | appears **white, no icon**, at the right local time |
| 8 | Juan | The overlapped block | shows segments and `−30m`; NOW card offers an afternoon slot; Accept places a dashed make-up that then reminds |
| 9 | Juan | The appointment push at 9:55 local | arrives **name-free** |
| 10 | Juan | Tap two pushes in a row with PRIM open, then once with PRIM on `/pricing` | both land on Routine, no reload |
| 11 | Juan | The follow-up block | lists your stage selection oldest-first; a row opens the prospect |
| 12 | Juan | Move the prospect to Pending Decision after the meeting | the appointment stays on the timeline and the owed minutes stay |
| **12b** | Juan | **Leave the app closed through an appointment**, tick a checkbox on the phone during that minute | `routine_day_v1` gains the `appt` **and** `owed` records from the tick, **and** the phone's checkbox survives |
| 13 | Juan | Next morning | the yesterday line shows once and retires on the first check |
| 14 | Juan | The weekly line | shows them |
| 15 | Juan | `net._http_response` sizes | confirm the tick transfers appointment **rows**, not blobs |
| 16 | Juan | The tab strip at 1280 px and on the phone | see the note below before judging this one |

**Gate 0 queries.**

```sql
select status_code, left(content::text, 120)
from net._http_response order by id desc limit 3;
```

```sql
select status from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'prim-routine-tick')
order by start_time desc limit 3;
```

`401` means the two secrets differ or `CRON_SECRET` is unset.
`failed` with "missing from Vault" means the secret was renamed.

**Gate 16 — read this first.** The tab strip is `overflow-x-auto` with a scroll fade, so it
scrolls; it cannot wrap or clip. Measured in a faithful replica of the strip's classes at
1280 px: all 15 tabs need 1662 px, a non-Team agent's 14 need 1524 px, and the **13-tab
strip before this work already needed 1428 px against 1248 px available**. So the strip was
already scrolling at 1280 px before the Routine tab existed; Routine adds about 96 px to an
existing scroll. The question for you is not whether it fits — it does not, and did not —
but whether the horizontal scroll reads as intentional. That is a judgment call and it is
yours.

---

## 4. Mutation checks

All 37 plan mutants were applied one at a time and reverted byte-identically. **35 died.
Two survived, and both were proven equivalent** — no test could ever kill them, because the
mutated code cannot change behavior.

| Result | Mutants |
|---|---|
| **Died** (34, node lane) | 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37 |
| **Died** (1, UI lane) | 36, in its meaningful form — see below |
| **Survived, proven equivalent** | 2, 15 |

**Mutant 2** — removing `now < c.endAt` from the tick's due window. Equivalent by algebra:
`grace = min(GRACE_MIN, floor(segDur / 2)) * MIN`, so `startAt + grace ≤ endAt` for every
non-negative duration, and the grace clause strictly dominates. The `endAt` conjunct is
dead but harmless, and it documents intent — left in place deliberately.

**Mutant 15** — removing the span bound from `findMakeupSlot`. Equivalent by construction
(every gap lies inside the span, so the loop already returns null) and confirmed by a
20,000-case differential fuzz over randomized blocks, appointments, make-ups and skipped
records: identical digests with and without the guard. A redundant fast path.

**Mutant 36** is the most informative of the set and was run in two forms. Injecting a
`prospectId` into a block patch via `updateBlock` **survives** — because `clampBlock`'s
field whitelist strips it before it can reach storage. Opening that whitelist so the field
passes through **kills** RoutineView case 5 immediately. The "no prospect data in
`routine_blocks_v1`" invariant is therefore guarded at two independent layers, and the test
catches a breach at the layer that matters.

---

## 5. Spec deviations to fold into rev 11

Each of these is a place the build had to depart from the spec text, with the reason.

1. **§4** — `routine_day_v1` is added to `MIGRATE_SKIP` in `migrateLocalToCloud`, so a local
   mirror can never overwrite the cloud day document.
2. **§4c** — `NOT_FOLLOWUP_WORDS` needs the lookahead `\bno\b(?![\s-]*show)`. The spec's
   regex rejects the stage "No show", which is exactly a follow-up stage.
3. **§7b** — breaks never set `behind`. A break you did not tick is not work you owe.
4. **§8** — the service worker derives the target view from the push URL's `?view=`, not a
   hard-coded `'routine'`. A reminders-cron push carries no `?view=`, so it focuses the app
   without switching tabs.
5. **§7c** — **the slide must be bounded.** With an unbounded search, a dragged block's own
   slot always fits, so the spec's "else revert + toast" branch was unreachable text and a
   drop onto a packed hour teleported the block up to an hour away. The block now keeps at
   least 5 minutes under the pointer.
6. **§9** — the deep link deletes only the `view` parameter (matching `ImpersonationBanner`)
   rather than wiping the query string, and a link naming a real tab the account cannot see
   yet is kept rather than consumed, so it still works once entitlement resolves.
7. **§4a** — "deleting an appt block tombstones its live attaches" is reachable from the UI
   only when the attached item is absorbed by an overlapping frozen card. Worth a line in
   the spec so the next reader does not hunt for a second path.
8. **§12** — **LeadTracker renders in jsdom.** The plan asserted it was too heavy and
   prescribed source-text checks instead. It mounts with about 8 mocks in roughly 40 ms per
   case, and the text tripwire it justified was blind to a one-word change that silently
   kills the warm deep link. The wiring now has real behavior suites.

---

## 6. Two things that will bite on another machine

**OneDrive dehydration.** This repo lives under OneDrive with the sync client not running,
so `node_modules` files can be cloud placeholders that throw `UNKNOWN` or `ERR_DLOPEN` on
read. It happened twice during this build — `sharp` while generating the PWA icons, and
`lucide-react` during a production build, where 3624 of 3886 icon files were dehydrated.
The fix is to re-materialize that one package from the registry tarball into `node_modules`
and leave `package.json` and `package-lock.json` untouched.

**The tick is invisible when misconfigured.** It fails closed on a missing `CRON_SECRET` and
the SQL raises on a missing Vault secret, so both failure modes are loud *if you look*.
Gate 0 is where you look.
