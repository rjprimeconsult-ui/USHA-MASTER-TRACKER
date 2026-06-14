# SalesReport hardening + Estimated AV — design

**Date:** 2026-06-14
**Author:** Meruem (with Juan)
**Status:** Draft for review

## Why

New agents — some who have never used a spreadsheet — rely on the **USHA SalesReport**
as their main feed into PRIM, plus the **weekly advance statement** for the actual
advance $. The SalesReport import has to be bulletproof, especially around policies
that go **Not Taken / Cancelled**, where USHA's report often omits the AV/premium (and
sometimes the date), which currently breaks two things:

1. **Wrong numbers** — a status PRIM doesn't recognize silently becomes "Pending," so a
   dead policy can masquerade as a live pending deal.
2. **Advances not attaching / clients showing blank** — when a client is missing the
   policy number or AV, the weekly-statement advance can't line up cleanly, and the
   client shows nothing useful even though real money was advanced to them.

## Workflow (confirmed)

Agents upload **both**: the SalesReport (sets each client's policy/stage/products/AV) and
the weekly statement (supplies the real advance $, matched to the client by policy #).
The advance is the source of truth for $; the SalesReport is the source of truth for the
policy picture.

## Goals

- SalesReport import is reliable and never silently mislabels a status.
- Re-uploading the SalesReport keeps each client's policy numbers and premiums complete,
  so weekly-statement advances always attach to the right client.
- When — and **only** when — a client has an advance but no AV (the Not-Taken/missing-data
  case), PRIM fills an **Estimated AV** derived from the statement's own commission data,
  so the client shows up instead of being blank.
- Estimated AV counts in KPIs, but is clearly tagged so real vs. estimated is transparent.
- Everything locked with unit tests.

## Non-goals

- No change to how advances attach for clients we *do* have data for. Those keep working
  exactly as today (right client, real amount, real AV).
- Not touching the weekly-statement parser's core; we only *read* fields it already
  captures (commPremium, rate, advMonths, productDesc, policyId, tier).
- No renewals math (first-year only, consistent with `commission.js`).

---

## Part 1 — Status parsing robustness (`salesreport.js`)

Today `STATUS_MAP` matches exact strings and **falls back to `'Pending'`** for anything
unknown (`salesreport.js:290`). That's the silent-mislabel bug.

Changes:
- Normalize the status before lookup: trim, collapse whitespace, case-insensitive.
- Expand the map to real-world variants:
  - `In Force` / `Active` / `Issued` → **Issued**
  - `Not Taken` / `Nottaken` → **Not taken**
  - `Declined` → **Declined**
  - `Withdrawn` → **Withdrawn**
  - `Canceled` / `Cancelled` / `Cancelled - *` / `Cancel` → **Withdrawn** (the $ side is
    handled by statement chargebacks)
  - `Lapsed` / `Termed` / `Terminated` / `Rescinded` → **Withdrawn** (treat as dead)
  - `Pending` / `Submitted` / `Received` → **Pending**
- **No silent default.** An unrecognized status is NOT quietly turned into Pending.
  Instead the deal is flagged (`unknownStatus: <raw>`) and the import preview surfaces a
  small list: "N rows had a status PRIM didn't recognize — please confirm." Those default
  to Pending only after the user sees them.

## Part 2 — Re-upload keeps policy #s + premiums complete (`gapDetect`)

Today `gapDetect` only reports `stage` and `mainProduct` mismatches, and the apply step
only writes those two fields. So new policy numbers / corrected premiums discovered on a
later upload are lost — leaving incomplete policy numbers, which is exactly what makes a
statement advance miss its client.

Changes:
- `gapDetect` also detects:
  - **new policy numbers** present in the deal but not yet on the matched lead, and
  - **premium/AV** differences (main premium and add-on premiums).
- The apply step **merges** new policy numbers into the lead's `policyNumber` list (union,
  delimiter-normalized) and updates premiums. It never drops existing policy numbers.
- Real AV from the SalesReport always wins over any prior Estimated AV (clears the tag).

## Part 3 — Estimated AV (strict trigger)

**Trigger (guardrail):** compute an Estimated AV for a client **only when BOTH**:
1. an advance from the weekly statement attaches to that client, AND
2. the client has **no real AV** on file (main premium 0 / blank and no real add-on
   premiums) — the Not-Taken / Cancelled / missing-data case.

For every other client, behavior is unchanged: real AV is used, advance attaches at its
real amount, no estimation, nothing modified.

**Computation** (per matched advance row → summed for the client):
1. **Preferred — statement premium:** if the advance row carries `commPremium`,
   `estAV_row = commPremium × 12`.
2. **Fallback — reverse the commission math:** otherwise
   `estMonthlyPremium = netAdvance ÷ advMonths ÷ rate`, then `estAV_row = × 12`, where:
   - `rate` = the row's own `rate` if present, else `resolveRate(productKey, tier, state)`
     from `commission.js` (productKey mapped from the row's `productDesc`; `tier` from the
     statement header → agent setting → `WA`; `state` from the lead if known, else default
     rate),
   - `advMonths` = the row's value if present, else `getAdvanceMonthsForDate(history, date)`.
3. Rows we can't price (rate 0 / non-commissionable like ACA WRAP, or unmappable product)
   contribute $0 to the estimate and are noted, never guessed.

New pure helper in `commission.js`: `estimateAvFromAdvance({ advance, commPremium, rate,
productKey, tier, state, advanceMonths })` → `{ estimatedAV, basis: 'premium'|'reverse'|'unknown' }`.

**Storage on the lead:** `estimatedAV` (number) and `avEstimated: true`. These are separate
from the real premium fields and never overwrite them. If a real AV later arrives,
`avEstimated` clears and `estimatedAV` is dropped.

## Part 4 — KPIs include it, with a transparency tag

- Estimated AV **rolls into** the AV/premium KPIs and dashboard/report totals (per Juan —
  these numbers are still useful).
- **Per client:** a small **"est."** badge next to the AV in Portal Clients (and Closed
  Deals) wherever `avEstimated` is true.
- **Aggregate:** a notation on the Dashboard KPI strip and the Reports sheet, e.g.
  *"$12,400 of $84,000 AV is estimated (reverse-engineered from commissions due to missing
  SalesReport data)."* So it's always clear how much of a total is real vs. derived.

## Data model (lead)

- `estimatedAV?: number` — the derived AV, only set under the Part 3 trigger.
- `avEstimated?: boolean` — true when `estimatedAV` is in use (drives badge + aggregate).
- (Existing `mainProductPremium`, `products[].premium` untouched and authoritative.)

## Edge cases

- **Real AV present → no estimate, ever.** Estimate is gap-fill only.
- **Chargebacks / negative advances** don't drive AV estimates.
- **Non-commissionable / unknown product** → that row adds $0 to the estimate, flagged.
- **advanceMonths by date** — use the advance's period date, not "today."
- **Idempotency** — recomputing on re-upload yields the same estimate; real AV always
  supersedes.
- **Multi-policy / multi-product client** — estimate sums per-policy/per-product rows
  (matches "based on policy numbers and products attached to it").

## Testing

- `salesreport.test.mjs` — status normalization (all variants + unknown-not-defaulted),
  gapDetect policy-number merge + premium update.
- `commission.test.mjs` — `estimateAvFromAdvance`: premium-basis, reverse-basis,
  rate-0/unknown → 0, tier/state variations, round-trip (projectCommission → reverse ≈ AV).
- Apply-path guardrail test — estimate fires only when advance present AND AV missing;
  real AV always wins.

## Files

- `src/lib/salesreport.js` — status map/normalize, surface-unknowns, gapDetect merge.
- `src/lib/commission.js` — `estimateAvFromAdvance` helper.
- `src/lib/statement.js` / `LeadTracker.applyStatement` — set `estimatedAV`/`avEstimated`
  under the trigger; clear when real AV arrives.
- `src/components/views/UploadView.jsx` — surface unrecognized statuses in the preview.
- `src/components/views/LeadsView.jsx` (+ ClosedDeals) — "est." badge.
- Dashboard / Reports — aggregate estimated-portion notation.
- Tests: `salesreport.test.mjs`, `commission.test.mjs`.

## Open items for review

- Aggregate notation placement: proposed **Dashboard KPI strip + Reports sheet**. OK, or
  one of them only?
- Any other SalesReport field seen coming in wrong to fold in now?
