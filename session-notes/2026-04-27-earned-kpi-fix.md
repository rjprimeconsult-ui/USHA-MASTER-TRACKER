# Earned KPI math fix — 2026-04-27

## Goal
Make the dashboard's Earned / Total Revenue / True Net KPIs match the actual weekly statements (Total Advance + Miscellaneous = Total Payout).

## Problem
For agent rjprimeconsult, prior-month KPIs disagreed with the statements:
- Override income was missing entirely (filter silently dropping every row)
- "Own earned" was summing `lead.dealValue` across leads closed in the week, but `dealValue` gets overwritten on every re-import — meaningless per-week sum
- After first round of fixes, overrides showed doubled (~$5,151 instead of $2,575) — re-imports created duplicates
- Breakdown panel rows didn't reconcile with the tile total (different data sources)

## Fixes shipped (commits f503574 → 47dcc03)
1. **Period normalization** — `getWeekStart` and `inPeriod` now tolerate M/D/YYYY (legacy storage format)
2. **applyStatement writes ISO dates** — `toIsoDate` helper converts at write time
3. **Per-statement own advances** — new `own_advances_v1` collection. Each parsed own-sale row saves with policyId/period/amount, deduped by policyId+period
4. **Earned KPI uses ownAdvances** — `scopedOwnEarned` now sums own_advances entries scoped to the period (with dealValue fallback for un-imported weeks)
5. **One-shot dedup migration on load** — collapses duplicates created when storage format changed mid-flight. Normalizes all period strings to ISO and dedupes by (policyId|period|customer|amount)
6. **Breakdown panel reconciles** — `earnedByProduct` sources from ownAdvances when the tile does, so rows always sum to the total

## State of the codebase
- All 4 commits pushed to origin/main, deployed via Vercel
- User confirmed numbers now match the statements
- No data re-uploads required (migration handles legacy + duplicate data on load)

## Pending (Phase 3 monetization)
Waiting on user to provide:
- Stripe publishable test key
- 3 Price IDs ($50/mo, $500/yr, $25/mo founder)
- Email of the one founder user who gets $25/mo

Then implement: trial flow, webhook, billing portal, subscription gates.

## Files modified this session
- `src/components/LeadTracker.jsx` — own_advances state + load migration + applyStatement save
- `src/components/views/CpaDashboard.jsx` — inPeriod tolerance + scopedOwnEarned + breakdown reconciliation
- `src/lib/statement.js` — exposes ownAdvanceRows from parsePlan
- `src/lib/storage.js` — added own_advances_v1 to migration key list
