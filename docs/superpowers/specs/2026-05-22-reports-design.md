# PRIM Reports — Design Spec

**Date:** 2026-05-22
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Juan Trejo + Claude

---

## 1. Goal

Give PRIM agents a **Reports** feature: pick a report type and a time period,
see a clean color-coded report on screen, and download it as a PDF (for
accountants, records, taxes, or personal review).

PRIM already holds all the underlying data — this feature only **reads** it and
presents it. It never writes to any data store, so it carries zero risk to
existing data.

---

## 2. Scope

### In scope (v1)

Five report types:

1. **Leads Sold** — issued deals in the period
2. **Overrides** — override income entries in the period
3. **Chargebacks** — chargeback entries in the period
4. **Expenses** — Books + Platform spending in the period
5. **P&L Summary** — combined income vs outflow = net

Each report: viewable on screen + downloadable as a PDF via the browser's
"Save as PDF" (Approach A — see §7).

### Out of scope (future)

- **Budget rules + spending alerts** for the Expenses area — let agents set a
  spending budget per category/platform and get a warning when they approach
  it. Parked deliberately; tackle right after Reports v1 ships.
- A combined "all 5 reports in one PDF" period pack.
- Spreadsheet (Excel/CSV) export of reports.
- Scheduled / emailed reports.

---

## 3. Architecture

The feature is additive. Nothing existing changes behavior.

| File | Purpose |
|---|---|
| `src/components/views/ReportsView.jsx` | The Reports page — report picker, period bar, the report sheet. |
| `src/lib/reports.js` | Pure functions: take raw data stores + a date range, return structured report data (rows + totals + KPIs). No UI. Unit-testable. |
| `src/lib/reportColors.js` | The color-semantics system (§5) — maps a value's financial meaning to a color. |
| `src/lib/reports.test.mjs` | `node:test` unit tests for the `reports.js` aggregation functions. |
| `src/app/globals.css` | Adds an `@media print` block that isolates the report sheet for PDF/print. |
| `src/components/LeadTracker.jsx` | One line: add a `reports` entry to the nav + route to `ReportsView`. |
| `src/lib/constants.js` | Add `{ id: 'reports', label: 'Reports', icon: 'FileText' }` to the views list. |

**Navigation:** new "Reports" tab in the top nav, placed between **Books** and
**Calculator**.

**Page anatomy (`ReportsView`):**

1. **Report picker** — 5 selectable cards/tabs, each in its identity color (§5).
2. **Period bar** — preset buttons + custom from/to date picker, and the
   "Download PDF" button.
3. **Report sheet** — the report itself, rendered as a white "paper" sheet
   regardless of app theme (so on-screen == PDF exactly).

---

## 4. Period model

The period bar offers preset buttons plus a custom range:

- **This Month** — 1st of current month → today
- **Last Month** — full previous calendar month
- **This Quarter** — 1st of current quarter → today
- **YTD** — Jan 1 of current year → today
- **Last Year** — full previous calendar year
- **Custom** — explicit from/to date pickers

Every report is filtered to `[from, to]` inclusive. The resolved range is shown
in the report header ("May 1 – May 31, 2026").

---

## 5. Color system

Two layers. This is the heart of the design.

### Layer 1 — Report identity color (the header band)

| Report | Identity color | Hex |
|---|---|---|
| Leads Sold | Emerald | `#10B981` |
| Overrides | Indigo (PRIM brand) | `#6366F1` |
| Chargebacks | Red | `#EF4444` |
| Expenses | Amber | `#F59E0B` |
| P&L Summary | Dynamic — emerald if net ≥ 0, red if net < 0 | `#10B981` / `#EF4444` |

### Layer 2 — Value semantics (every number, identical logic in all 5 reports)

Principle: **don't cry wolf.** Only genuine bad news gets the alarm color.

| Meaning | Color | Hex | Applies to |
|---|---|---|---|
| Good — profit, income, money earned, net positive, under budget | Emerald | `#059669` | Premiums, advances, override income, positive net |
| Bad — net loss, chargebacks, spend **over** the desired/budget level | Red | `#DC2626` | Chargeback amounts, negative net, over-budget total |
| Warning — approaching a threshold (90–100% of budget) | Amber | `#D97706` | Expense total when within 10% of budget |
| Neutral — routine costs, dates, names, counts, labels | Slate | `#475569` | Lead cost, under-budget spend, all labels/dates |

Structural elements (table borders, section dividers, the report-picker chrome)
use PRIM's standard slate/indigo, matching the rest of the app.

`reportColors.js` exposes helpers like `valueColor(kind, { overBudget, nearBudget })`
so the color logic lives in one place and every report applies it identically.

---

## 6. The five reports

All amounts are whole-dollar formatted (`$1,234`). Each report shows a **KPI
strip** (big summary numbers) above a **detail table**, then a **totals row**.

### 6.1 Leads Sold

- **Source:** `leads_v5`, records where `stage === 'Issued'` and `closedDate`
  falls in the period.
- **KPI strip:** # Deals · Total Premium 🟢 · Total Advance 🟢 · Total Lead Cost ⚪ · Net Profit 🟢/🔴
- **Columns:** Client (`name`) · Product(s) (`products`) · Date Sold (`closedDate`) · CRM (`crm`) · Campaign (`campaign`) · Premium 🟢 · Advance (`dealValue`) 🟢 · Lead Cost (`leadCost`) ⚪
- **Totals row:** sums of Premium, Advance, Lead Cost; Net Profit = Advance − Lead Cost.
- **Empty state:** "No deals sold in this period."

### 6.2 Overrides

- **Source:** `overrides_v1`, records where `period` falls in the range.
- **KPI strip:** # Entries · Total Override Income 🟢
- **Columns:** Date (`period`) · Source / detail (customer / writing agent /
  product where present) · Amount 🟢
- **Totals row:** Total Override Income 🟢.
- **Empty state:** "No override income recorded in this period."

### 6.3 Chargebacks

- **Source:** `chargebacks_v1`, records where `period` falls in the range.
- **KPI strip:** # Chargebacks · Total Clawed Back 🔴 (split: Own 🔴 / Override 🔴)
- **Columns:** Date (`period`) · Client (`customer`) · Policy (`policyId`) ·
  Product (`productDesc`) · Type (`isOwn` → "Own" / "Override") · Amount 🔴
- **Totals row:** Total Clawed Back 🔴.
- **Empty state:** "No chargebacks in this period — good news." (shown in emerald)

### 6.4 Expenses

- **Source:** `business_expenses_v1` — the single canonical expense store. Each
  record: `{ id, date, vendor, amount, category, reason, notes }` (`date` is
  ISO `YYYY-MM-DD`). Platform spend lives in this *same* store under the
  `PLATFORM_RINGY` / `PLATFORM_TEXTDRIP` / `PLATFORM_VANILLASOFT` categories —
  there is no separate platform store (legacy `platform_expenses_v1` is
  auto-migrated into Books on load).
- **Books vs Platform split:** a category id starting with `PLATFORM_` is
  Platform spend; everything else is Books spend.
- **Category labels:** resolved from `EXPENSE_CATEGORIES` in `constants.js`
  (id → label); unknown ids fall back to the raw id.
- **KPI strip:** Total Spent · Books subtotal · Platform subtotal · **vs Budget**
  — shown only when the period is a single calendar month AND a platform
  monthly budget (`platform_budget_v1`) is set: compares Platform spend to that
  budget, 🟢 under / 🟠 within 10% / 🔴 over.
- **Detail:** grouped by category. Columns: Category (label) · Group
  (Books / Platform) · # Items · Total ⚪ (🔴 when over budget).
- **Totals row:** Grand Total.
- **Empty state:** "No expenses recorded in this period."

### 6.5 P&L Summary

A single-page summary. Every line is shown explicitly so nothing is hidden or
double-counted.

```
INCOME
  Commissions (issued advances)        + $ 0,000   🟢
  Override income                      + $ 0,000   🟢
  ----------------------------------------------------
  Total In                               $ 0,000   🟢

OUTFLOW
  Chargebacks                          − $ 0,000   🔴
  Platform expenses                    − $ 0,000   ⚪
  Books expenses                       − $ 0,000   ⚪
  ----------------------------------------------------
  Total Out                              $ 0,000   🔴

NET RESULT                               $ 0,000   🟢 / 🔴  (large)
```

- **Net** = Total In − Total Out, shown large in emerald (≥ 0) or red (< 0).
- "Platform expenses" and "Books expenses" are both drawn from the single
  `business_expenses_v1` store, split by the `PLATFORM_` category prefix —
  shown as two lines purely for clarity.
- Lead cost is intentionally **not** an outflow line here — it is reflected in
  the Leads Sold report's Net Profit. Keeping it out of the P&L avoids any
  double-count with platform spend. (Decision — revisit if agents want it in.)
- **Empty state:** still renders, with all zeros.

---

## 7. PDF / print behavior (Approach A — browser "Save as PDF")

The on-screen report sheet **is** the PDF. No PDF library, no new dependency.

- **Download PDF button:** sets `document.title` to a clean filename hint
  (e.g. `PRIM — Leads Sold — May 2026`), then calls `window.print()`. The user
  picks "Save as PDF" as the destination.
- **`@media print` rules in `globals.css`:**
  - Hide all app chrome — only `.report-sheet` prints.
  - `print-color-adjust: exact` so the colored header band and color-coded
    numbers actually render (browsers strip backgrounds/colors by default).
  - Table header repeats on every page: `thead { display: table-header-group }`.
  - Rows never split across a page: `tr { break-inside: avoid }`.
  - KPI strip and report header never split.
  - Letter page size with sensible margins.
- The sheet renders on a **white background even in dark mode**, so the
  on-screen view is pixel-identical to the PDF.

### Report sheet layout (PRIM-branded)

1. **Header band** — in the report's identity color: PRIM prism logo + "PRIM"
   wordmark (left); report title, resolved period, "Generated [date]", agent
   name (right).
2. **KPI strip** — summary numbers as print-friendly cells, color-coded.
3. **Detail table** — zebra rows, right-aligned money figures, color-coded per
   §5, emphasized totals row.
4. **Footer** — "Generated by PRIM · primtracker.com" + the period + page number.

---

## 8. Data safety

Reports are strictly **read-only**. `reports.js` consumes the in-memory data
already loaded by `LeadTracker` (leads, overrides, chargebacks, expenses) and
returns derived view-models. It calls no `storage.setItem`, mutates no arrays.
There is no path by which generating a report can alter or lose data.

---

## 9. Testing

- `src/lib/reports.test.mjs` (`node --test`) covers the pure aggregation
  functions in `reports.js`:
  - Date-range filtering is inclusive on both ends.
  - Each report's totals equal the sum of its rows.
  - Period presets resolve to the correct boundaries (month / quarter / year).
  - Empty inputs produce a valid empty report (no crash, zeroed totals).
  - P&L net = Total In − Total Out across positive and negative cases.
- Manual: `npx next build` + `npx eslint` on touched files; visual check of
  each report on screen and as a saved PDF.

---

## 10. Build sequence (for the implementation plan)

1. `reportColors.js` — color system + helpers.
2. `reports.js` — pure aggregation for all 5 reports + period presets.
3. `reports.test.mjs` — tests; get green.
4. `ReportsView.jsx` — picker, period bar, report sheet, Download PDF.
5. `@media print` block in `globals.css`.
6. Nav wiring in `constants.js` + `LeadTracker.jsx`.
7. Verify: build, lint, manual on-screen + PDF check of all 5 reports.
