# Prospects CSV Export — Design Spec

**Date:** 2026-07-22
**Status:** Approved by Juan (verbal, via brainstorming session) — pending spec review
**Owner request:** "Export our prospects from inside of PRIM and create a CSV file… to other CRMs that only read CSV files."

## 1. Problem

Prospects live only inside PRIM. Agents who want to work those prospects in
another system (a dialer, another CRM, a spreadsheet) have no way to get them
out. Nearly every CRM accepts CSV import, so a CSV export is the universal
bridge. Leads already have a CSV export ([LeadsView.jsx:191](../../../src/components/views/LeadsView.jsx));
Prospects have nothing.

## 2. Decisions (locked with Juan)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Target format | **General-purpose CSV** — plain column names any CRM can map. No per-CRM presets. |
| D2 | Row selection | **Picker modal** — filter by Source + Stage + free-text search, tick rows, multi-select, "Select all matching". NOT export-what's-on-screen and NOT always-everything. |
| D3 | "Grab everything" path | Both filters default to **All sources / All stages**; open → Select all → Export. |
| D4 | Columns | **Demographics + contact essentials ONLY** (9 columns, §4). Explicitly NO meds, NO situation/notes, NO quotes, NO stage/source columns — "a CSV must be simple to load into any other CRM." |
| D5 | Name handling | **Trim** the stored single `name`, then split on the **first space of the trimmed value** → First Name + Last Name; also keep Full Name column (as stored, untrimmed — 3 columns, zero information loss). |
| D6 | Street address | **Omitted** — PRIM has no address field (verified: no address/street/city on the prospect model or form). State + ZIP only. |
| D7 | Leads export | Fix **only the missing-BOM bug** (accented names garble in Excel) as part of this work. The Leads formula-injection fix is **deferred** to a separate change (Juan's call: don't disturb working code beyond one line). |
| D8 | Architecture | **Approach A** — pure logic module + modal component, client-side download. No server route. |

## 3. Architecture

Two new files + two small edits. No storage schema change, no migration, no
new dependencies, no server code.

```
src/lib/prospectExport.mjs          NEW  pure logic (node --test testable)
src/lib/prospectExport.test.mjs     NEW  unit tests
src/components/ExportProspectsModal.jsx  NEW  picker UI
src/components/views/ProspectsView.jsx   EDIT mount Export button + modal
src/components/views/LeadsView.jsx       EDIT prepend BOM to existing export (D7)
```

### Why a separate .mjs logic module
Matches the repo convention (`ringy.mjs`, `webforms.mjs`, `blastRange.mjs`):
`npm test` is `node --test src/lib/*.test.mjs`, and only dependency-free
`.mjs` modules are testable there. All fragile logic (name split, CSV
escaping, injection guard, BOM) goes in the module; the modal stays a thin
view. `prospectExport.mjs` must be **self-contained** (no imports from
`prospects.js` — it's unimportable under node --test due to extensionless
imports; same lesson as webforms.mjs).

## 4. CSV format

**Filename:** `prospects-YYYY-MM-DD.csv` (local date).

**Columns (exact order and headers):**

| Header | Source field | Notes |
|---|---|---|
| `First Name` | `name` | text before the first space; whole name if no space |
| `Last Name` | `name` | everything after the first space; `''` if no space |
| `Full Name` | `name` | as stored |
| `Phone` | `phone` | as stored (no reformatting — CRM importers handle common formats) |
| `Email` | `email` | as stored |
| `Date of Birth` | `dobs` | as stored (free text; may be comma-separated for family — commas are safe because every cell is quoted) |
| `State` | `state` | as stored (2-letter) |
| `ZIP` | `zip` | as stored |
| `Income` | `income` | as stored (free-text money) |

**Encoding rules (the fragile part — all unit-tested):**

1. **Quoting:** every cell is wrapped in double quotes; embedded `"` doubled
   (`""`). Same as the Leads export.
2. **UTF-8 BOM:** file starts with `﻿` so Excel renders José/Nuñez
   correctly. (The existing Leads export lacks this — that's the D7 fix.)
3. **CSV-injection guard:** any cell whose first character is `=`, `+`, `-`,
   or `@` gets a leading tab character (`\t`) prepended inside the quotes.
   Excel/Sheets then treat it as text, not a formula. Rationale: prospects
   arrive from internet-facing webforms — a submitted `first_name` of
   `=HYPERLINK(...)` must never execute on an agent's machine. The tab
   prefix is the OWASP-recommended neutralization and is invisible in Excel.
   Note: a legitimate phone stored as `-1234` or income `+50k` gains a tab;
   acceptable — display is unchanged and injection safety wins.
4. **Line endings:** `\r\n` (Windows-friendly, per RFC 4180).
5. **null/undefined** → empty string.

## 5. Picker modal — behavior

**Entry:** an **Export** button (Download icon) in the Prospects header,
next to the existing action buttons, **inside the `!readOnly` block**
(ProspectsView.jsx ~1652-1677) — the team-leader mirror renders ProspectsView
with `readOnly` and ANOTHER agent's data, and bulk-exporting another agent's
client demographics must not be possible from that surface. Opens
`ExportProspectsModal` (use `GlassModal` like the app's other modals).

**Data scope:** ACTIVE prospects only (`!archivedAt`). Archived prospects
are not in the working pipeline and are excluded entirely.

**Controls (top to bottom):**

1. **Source dropdown** — options: `All sources` (default) + the distinct
   `source` values present in the agent's own prospects (values **trimmed**
   before the emptiness test and dedup), sorted alphabetically. Derived, not
   hardcoded — an agent only sees sources they actually have (Benepath,
   Ringy, TextDrip, Web Lead, Referral, …). If any prospect has an
   empty/whitespace-only `source`, append a `(No source)` option using the
   sentinel value `'__none__'` (repo precedent: LeadsView.jsx:228) so it
   can't collide with a real source string; it matches prospects whose
   trimmed `source` is `''`. Named-source filter comparisons are
   **trim-both-sides** (a stored `" Benepath"` matches the `Benepath`
   option).
2. **Stage dropdown** — `All stages` (default) + the agent's configured
   stages from `cfg.stages` (prospect settings; may include custom
   `STAGE_<ts>` stages), in **array order** (which IS the pipeline order —
   SettingsModal reorders that array), using stage labels.
3. **Search box** — case-insensitive substring match against name and
   email; phone is compared digits-only ("(954) 555" matches "9545550132")
   **and the phone comparison applies only when the query contains at least
   one digit** (an all-alphabetic query must never match every row via the
   empty-digits substring). Filters combine with AND.
4. **Select-all row** — checkbox + "Select all N matching" where N = rows
   passing current filters. Checking selects all matching; unchecking
   deselects all matching (scoped to matching rows only — out-of-filter
   selections are untouched). Display state: **checked** iff N > 0 and every
   matching row is selected; **indeterminate** when some but not all matching
   rows are selected; **unchecked** otherwise (including N = 0). A count
   pill shows `X of TOTAL selected`.
5. **Row list** — scrollable (the ONE permitted internal scroll region);
   each row: checkbox · name · phone · state · source badge · stage label.
   Clicking anywhere on the row toggles its checkbox.
6. **Footer** — static caption listing the 9 columns; **Export N** button,
   disabled when N = 0.

**Selection semantics:** selection is a Set of prospect ids and SURVIVES
filter changes — filter to Benepath, select all, then filter to Ringy and
select all: both groups stay selected (this is the "multiple selections"
Juan asked for). The count pill always reflects the true total selected.
Changing a filter never silently drops prior selections; Export exports the
full selection Set regardless of what's currently visible. **The selection
Set resets to empty every time the modal opens** — no selection state
persists across close/reopen (this is also the escape hatch for clearing
out-of-filter selections: close and reopen).

**Export click:** build CSV via `prospectExport.mjs` → Blob →
`URL.createObjectURL` → temp `<a download>` click → revoke URL (same
mechanism as the Leads export) → close modal. No toast needed; the browser
download is its own confirmation.

## 6. Explicitly out of scope

- Meds / situation / notes / quotes / touchLog / custom fields in the CSV (D4).
- Any per-CRM header presets (D1).
- Street address anywhere (D6).
- Leads export injection guard (D7 — deferred; only the BOM line is added).
- Exporting archived prospects.
- Server-side anything.

## 7. Security & compliance

- **No PHI leaves PRIM:** `meds` and `situation` are excluded by design
  (D4). The export is demographics + contact only.
- **CSV injection neutralized** (§4.3) on the new export. Known-open on
  the Leads export until the deferred follow-up.
- Export is client-side from data the signed-in agent already has; no new
  API surface, no new auth considerations.
- **Blast/webhook capture paths untouched** (standing rule).

## 8. Error handling

- Zero selected → button disabled (no empty-file path).
- Prospect with empty `name` → exports with blank First/Last/Full Name.
- All-spaces name → treated as empty.
- Modal open with zero active prospects → empty list, "Select all 0
  matching", Export disabled.
- Blob/download failures are browser-level and not recoverable in JS;
  no special handling (matches Leads export).

## 9. Testing

**Unit (`prospectExport.test.mjs`, node --test):**
- name split: "Maria Gonzalez" → Maria/Gonzalez; "Cher" → Cher/'' ;
  "Maria Elena Gonzalez Ruiz" → Maria/"Elena Gonzalez Ruiz";
  " Maria Gonzalez" (leading space) → Maria/Gonzalez (trim-then-split);
  '' and '   ' → ''/'' .
- escaping: embedded quotes doubled; embedded commas survive round-trip;
  a cell containing a literal `\r\n` survives round-trip inside its quotes
  (distinguished from the `\r\n` row delimiter); null/undefined → ''.
- injection guard: leading `=`, `+`, `-`, `@` gain `\t`; leading space/digit
  do not; guard applies to the raw cell value (no trimming first).
- BOM present exactly once at position 0; `\r\n` line endings.
- row filtering helper: archived excluded; source/stage/search AND-combine;
  digits-only phone match; an all-alphabetic query does NOT match rows via
  phone (empty-digits guard); `'__none__'` source matches only
  trimmed-empty sources.
- full-file golden test: 2 prospects → exact expected string.

**Manual (live, local-only mode):**
- Export button renders in both themes; modal opens; filters narrow the
  list; cross-filter multi-select holds; file downloads and opens in Excel
  with an accented test name intact; a `=2+2` test name imports as text.
- Leads export still downloads and now renders José correctly (D7).

## 10. Rollout

Single PR, no flag (additive UI; no existing behavior changes except the
one-line Leads BOM). Standard: 448+ tests green, build clean, subagent
implementation + review flow, Juan merges.
