# Storage-full error + duplicate explosion — 2026-06-01

> **Handoff note.** Worked this session from Juan's **laptop** (cloned repo). Picking
> up tomorrow from the **office desktop**. This file carries the full context so
> nothing is lost. Pull `main` on the desktop and read this first.

## TL;DR for tomorrow
1. One small fix **shipped + deployed** today (Chargebacks collapsible). Nothing pending there.
2. A real agent bug was **diagnosed but NOT yet fixed**. Two parts remain:
   - **(A) Clean up** a duplicate-lead explosion in one agent's account (the duplicate review tool reported "≥169,000 duplicates").
   - **(B) Prevention fix** so it can't recur (false "Storage full" error + a dedup gap).
3. The desktop already has the **real `.env.local`** (incl. the `service_role` key), so the DB analysis/cleanup can run there without pasting any keys. The laptop's pulled env had the sensitive keys blanked by Vercel.

---

## What shipped today (done, deployed)
- **Chargebacks section is now collapsible** — click the "Chargebacks" header to expand/collapse, matching the Prospecting calendar/follow-ups pattern. Totals badges stay visible when collapsed.
- Commit `36b9edc` on `main`, pushed, auto-deployed via Vercel. `src/components/ChargebacksPanel.jsx`.

## The agent bug — full diagnosis

**Symptom 1:** Agent importing ~1,490 historical leads saw a red toast: **"Storage full — your last save was not persisted."**

**Symptom 2:** All leads DID import (Juan verified via admin impersonate), but with **massive duplication**. The in-app duplicate review reported **≥169,000 duplicates**.

### Root cause #1 — the "Storage full" error is a FALSE ALARM for signed-in users
- The error comes from `src/lib/storage.js` (`localSet` → `isQuotaError`, line ~64). It's a **browser localStorage** quota error (~5 MB cap), NOT Supabase.
- For a signed-in agent, every `setItem` does **two independent writes**: (1) a localStorage mirror/backup, then (2) the **Supabase cloud write** (the real source of truth). See `storage.js` `setItem` (~line 201-228). The cloud write runs **after** and is **unaffected** by the localStorage failure.
- So the data persisted to the cloud fine; the toast only reflects the **backup** failing. But the message says "your last save was not persisted," which made the agent **re-import**, thinking it failed.
- **The bug:** success + the error message are keyed on the **localStorage** result (`return localOk`), not the **cloud** result. When signed in and the cloud write succeeds, it should NOT say "not persisted."

### Root cause #2 — the SalesReport "gap detector" path has NO dedup gate
- The Excel/Smart Import path (`LeadTracker.jsx` `importLeads`, ~line 673) runs every lead through `dedupLeads` before adding. Good.
- The **SalesReport gap path** (`LeadTracker.jsx` ~line 989-991) does **NOT** dedup — it just stamps `importBatchId` and prepends: `return [...stamped, ...updated]`.
- So running the gap upload (especially repeatedly, or after the Excel historical already added those people) **stacks leads with no duplicate guard**. This is Juan's "salesreport gap + excel historical collided" theory — confirmed mechanism.

### About the "169,000" number — likely quadratic, not 169k records
- The duplicate review counts **pairs**, which grow quadratically. One same-name group of ~583 leads = 583×582÷2 ≈ **169,000 pairs**. So the **actual** excess-lead count is probably far smaller (hundreds–few thousand). **Must confirm against real data** before cleaning.
- Note: this is a **recurring class** of issue — see `session-notes/2026-04-27-earned-kpi-fix.md` (duplicates from re-imports for agent rjprimeconsult).

## Plan for tomorrow (desktop)

### Step 0 — resume
- `git pull` on `main` (gets the Chargebacks commit + this note).
- Desktop already has real `.env.local` (incl. `service_role`). Confirm with a quick read of the env keys.

### Step A — clean up the agent's duplicates (do this carefully, on real data)
Manual "Review now" is impossible at this scale (169k pairs). Use a scripted, reviewed approach with the service-role key:
1. **Back up first** — dump the agent's entire `leads_v5` (`user_kv` row) to a local JSON file. Touch nothing until backed up.
2. **Analyze** — report: real total lead count, blob size in MB (check vs Supabase row/request limits — a huge blob may itself threaten future saves), # genuine duplicates, their shape (same person? same policyId? which import path stamped them — look for `importBatchId` starting `salesreport_`).
3. **Dry run** — show exactly what would be deleted vs kept (keep the most-complete/oldest of each real person; `findDuplicateGroups` in `src/lib/leadDedup.js` ranks canonical).
4. **Delete only after Juan approves.** Write filtered `leads_v5` back. (The admin endpoint `POST /api/admin/duplicate-leads` already does keyed bulk-delete — can reuse its logic, but it only catches keyed dupes; un-keyed/by-name need the scripted pass.)

### Step B — prevention fix (so it never recurs)
1. `storage.js`: when signed in (cloud active), judge save success + the error toast on the **cloud** write, not the localStorage mirror. A failed mirror should be at most a quiet "couldn't cache offline," never "your save wasn't persisted." (Root cause #1.)
2. `LeadTracker.jsx` SalesReport gap path (~line 989): route added leads through the **same `dedupLeads` gate** as `importLeads`. (Root cause #2.)
3. (Follow-up, optional) move the local backup from 5 MB localStorage to **IndexedDB** (`idb-keyval` is already a dependency) so large books cache properly.
4. Use TDD: write a failing test reproducing the duplicate-on-re-import + the false-error-on-quota before fixing.

## Git / environment state
- Branch: `main` @ `36b9edc`, in sync with origin. Clean tree. (Earlier laptop work branch `work-laptop-2026-05-31` was merged to main + pushed.)
- **Laptop-only, not in repo:** a `usha` config was added to `.claude/launch.json` in the *parent* folder (workspace root, outside this git repo) to run `npm run dev`. The desktop doesn't need it.
- **Reminder:** delete the temporary **Vercel token** Juan created (vercel.com/account/tokens, name "laptop") — it was only needed to pull env to the laptop.

## Don't-miss checklist for the desktop
- [ ] `git pull` main, read this note
- [ ] Confirm real `.env.local` present (service_role key) — needed for Step A
- [ ] Back up `leads_v5` BEFORE any delete
- [ ] Dry-run + Juan approval before deleting
- [ ] Ship prevention fix (storage.js + salesreport dedup) with tests
- [ ] Delete the laptop Vercel token
