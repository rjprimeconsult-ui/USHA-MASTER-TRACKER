# Statement Manager — Design

**Date:** 2026-06-04
**Status:** Approved (design); ready for implementation planning
**Area:** Settings (in `LeadTracker.jsx`), commission/statement data stores

## Goal

Give agents a self-service way to **view and delete** statement-derived data — per item (week / month / single row) and in **bulk by custom date range** — instead of the all-or-nothing "Clear everything". Reusable by every agent to undo a wrong/duplicate statement upload. Also the clean tool for the Alexis cross-account cleanup (he can sweep Jan 1 → today and re-upload his own).

## Decisions (locked)

1. **Placement:** Settings, near the existing granular Clear buttons.
2. **Delete-only** (no inline amount editing — re-upload to correct numbers).
3. **Scope:** weekly statement rows (own advances, overrides, chargebacks) **and** monthly payouts (statement-derived Books income).
4. **Two delete modes:**
   - **Custom date-range bulk delete** (with a live preview before committing).
   - **Per-item delete** (a whole week, a whole month, or a single row).
5. **Does NOT un-issue leads.** Deleting commission rows updates Earned / CPA / Books totals, but lead stages/dealValue set by a statement are left as-is (intentional, safer). Surfaced as a note in the UI.

## Data model (existing stores)

Weekly rows (each: `{ id, policyId, customer, writingAgent, productDesc, amount, appDate, effDate, period, importedAt }`):
- `own_advances_v1` (state `ownAdvances`)
- `overrides_v1` (state `overrides`)
- `chargebacks_v1` (state `chargebacks`) — `amount` is the pulled-back figure
- Grouped by **`period`** (ISO date of the statement week).

Monthly payouts — live in `business_income_v1` (state `businessIncome`), added by `applyStatement`. Row: `{ id, date, category, amount, source, notes }`. Statement-derived ones are identified by:
- `notes` starting with `"Auto-imported from statement"` (covers existing data), OR
- a new explicit flag `fromStatement: true` that `applyStatement` will stamp on rows it creates going forward (rock-solid for new data).
- Categories: `MONTHLIES`, `MONTHLIES_PLUS_ASSOC`, `BONUS`.
- Grouped by **month** (`date.slice(0,7)`).

Manually-entered Books income (not from statements) is **never** touched by this manager.

## Architecture

### `src/lib/statementManager.mjs` (pure, tested)
- `isStatementIncome(row)` → true if a `business_income_v1` row came from a statement (flag or note-prefix).
- `groupStatements({ ownAdvances, overrides, chargebacks, businessIncome })` →
  ```
  {
    weekly: [ { period, own:[...], override:[...], chargeback:[...],
                counts:{own,override,chargeback}, totals:{advances, chargebacks} } ],  // sorted desc by period
    monthly: [ { month, rows:[...], total } ],                                          // sorted desc by month
  }
  ```
- `statementsInRange({ ownAdvances, overrides, chargebacks, businessIncome }, from, to)` →
  ```
  {
    weekly:    { ownIds:Set, overrideIds:Set, chargebackIds:Set },
    monthlyIds: Set,                       // business income row ids in range (statement-only)
    counts:    { weeks, monthlyEntries, ownRows, overrideRows, chargebackRows, monthlyRows },
    totals:    { advances, overrides, chargebacks, monthlyIncome },
  }
  ```
  - Range is **inclusive** on both ends. Weekly rows matched by `period`; monthly rows matched by `date`. Both compared as `YYYY-MM-DD` strings (lexicographic = chronological for ISO).
- All functions pure; no storage/DOM.

### `src/components/StatementManager.jsx`
Props: `{ ownAdvances, overrides, chargebacks, businessIncome, onDeleteRange, onDeleteWeek, onDeleteMonth, onDeleteRow }`.
- **Range bar (top):** From / To date inputs (default From = earliest statement date found, To = today). A live **preview** line built from `statementsInRange(...)`: counts + dollar totals + the date span. A **Delete range** button → confirm dialog → `onDeleteRange(from, to)`.
- **Per-item list (below):** `groupStatements(...)` output. Weekly sections (period header + totals + expandable rows, each row has a × to `onDeleteRow`), a **Delete week** button per period → `onDeleteWeek(period)`. Monthly sections similarly with **Delete month** → `onDeleteMonth(month)`.
- Empty state when there's nothing.
- Behavior note rendered near the top ("removes commission/income entries; does not change lead stages").
- Reuses dark-mode-safe input styling (`bg-white text-slate-900` etc.).

### `LeadTracker.jsx`
- Mount `<StatementManager .../>` in the Settings section, passing the four arrays + handlers.
- Handlers (all immutable filters; existing persistence effects save the result):
  - `deleteStatementRange(from, to)` — compute in-range ids via `statementsInRange`; filter them out of `ownAdvances`, `overrides`, `chargebacks`, and statement-derived `businessIncome`. One confirm.
  - `deleteStatementWeek(period)` — drop rows with that `period` from the three weekly stores.
  - `deleteStatementMonth(month)` — drop statement-income rows with `date` in that month from `businessIncome`.
  - `deleteStatementRow(store, id)` — remove one row by id from the named store (`'own'|'override'|'chargeback'|'income'`).
- `applyStatement`: stamp `fromStatement: true` on the bonus/monthly Books-income rows it creates (so detection is robust for new uploads).

## Testing — `src/lib/statementManager.test.mjs`
- `isStatementIncome`: true for flag, true for note-prefix, false for manual Books income.
- `groupStatements`: groups weekly by period + monthly by month; correct counts/totals; sorted desc; ignores non-statement income.
- `statementsInRange`: inclusive boundaries (row exactly on `from` and on `to` included; one day outside excluded); weekly matched by period, monthly by date; correct id sets + counts + totals; empty range → zeros.

## Constraints
- HIPAA: the manager shows the agent's **own** customer names/amounts (their data) — fine; nothing is emailed or sent externally. No PHI leaves the app.
- No cross-user access (all per-agent stores).
- Delete actions confirm before running; range delete shows a preview first.

## Build phases
1. **Lib + tests** — `statementManager.mjs` (`isStatementIncome`, `groupStatements`, `statementsInRange`) + `statementManager.test.mjs`.
2. **Component + wiring** — `StatementManager.jsx`; mount in Settings; LeadTracker delete handlers; `applyStatement` `fromStatement` stamp.
3. **Verify + merge + announce** — full tests + build, review, merge to main, announce (bell + Slack).

## Out of scope
- Editing amounts (delete-only).
- Un-issuing / reverting lead stage or dealValue changes a statement applied.
- Managing manually-entered (non-statement) Books income or manual leads.
