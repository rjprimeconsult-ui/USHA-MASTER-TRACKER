# Blasts Time-Range Selector — Design Spec

**Date:** 2026-07-23
**Status:** Approved by Juan (verbal, via brainstorming) — "Look good, write, commit, push and deploy"
**Request:** The Blasts total only shows the last 7 days. Let agents view the total (and the blast list) over multiple time ranges.

## 1. Problem

`BlastsView.jsx` shows exactly two fixed rollup cards — **Today** and **Last 7 days** ([lines 310-311](../../../src/components/views/BlastsView.jsx)) — computed by `tally(since)` ([lines 147-162](../../../src/components/views/BlastsView.jsx)). Agents can't see 30-day, year-to-date, or arbitrary-range blast totals.

## 2. Decisions (locked with Juan)

| # | Decision |
|---|----------|
| D1 | **Period selector** (mirrors the CPA Dashboard's period toggle), driving **one** rollup total card. NOT multiple always-on cards. |
| D2 | Periods: **Today · This week · Last 30 days · Year to date · Custom**. **No "All time"** (each year resets; YTD is the max lookback needed). |
| D3 | **Default period = This week.** |
| D4 | **"This week" = calendar Monday→Sunday** (Monday-start), NOT a rolling 7 days. Sunday belongs to the week that began the prior Monday. |
| D5 | "This week" and "Year to date" are **calendar-bounded** (reset Monday / Jan 1). "Last 30 days" is a **rolling** window (today − 29). "Today" is today. This mix is intentional. |
| D6 | The selected period **filters BOTH** the total card **AND** the blast list below (in addition to the existing platform filter) — like the CPA Dashboard. |
| D7 | Pure client-side. **No backend, no `blast_counters`/schema change, no new queries.** All blasts are already loaded with `runDate`. |
| D8 | The blast **capture path** (`/api/{ringy,benepath,blast}`, `increment_blast`) is **untouched** — this is read-only display. The add/edit-blast form is unchanged. |

## 3. Architecture

Two files: one new tested pure module + edits to the one view.

```
src/lib/blastPeriod.mjs        NEW  pure period→{start,end} logic (node --test)
src/lib/blastPeriod.test.mjs   NEW  unit tests (Monday/Sunday/YTD/30d/custom edges)
src/components/views/BlastsView.jsx  EDIT  selector UI + range-driven total + list filter
```

### 3.1 `blastPeriod.mjs`

Self-contained (zero imports — testable under `node --test`, per repo convention).

```
export const BLAST_PERIODS = ['today', 'week', '30d', 'ytd', 'custom'];  // order = button order
export const DEFAULT_BLAST_PERIOD = 'week';

// blastPeriodRange(period, opts) -> { start: Date, end: Date } | null
//   opts: { now = new Date(), customStart, customEnd }  (custom* are 'YYYY-MM-DD' strings)
// start = local midnight of the first day; end = local end-of-day (23:59:59.999) of the last day.
// Returns null when custom is incomplete/invalid (missing a date, or start > end).
```

Range definitions (all end at **end of today** except custom — "to date" semantics; future-dated blasts, which effectively don't exist, never inflate a preset total):

| period | start | end |
|---|---|---|
| `today` | today 00:00 | today 23:59:59.999 |
| `week` | **Monday** of the current week, 00:00 | today 23:59:59.999 |
| `30d` | (today − 29) 00:00 | today 23:59:59.999 |
| `ytd` | Jan 1 (local) 00:00 | today 23:59:59.999 |
| `custom` | customStart 00:00 | customEnd 23:59:59.999 |

**Monday-of-week formula:** `daysBack = (day + 6) % 7` where `day = date.getDay()` (0=Sun…6=Sat). Sun→6, Mon→0, Tue→1, … — so Sunday maps back to the prior Monday's week. Subtract `daysBack` days from today (local), set to 00:00.

`now` is injectable so tests are deterministic (real callers pass nothing → `new Date()`).

### 3.2 `BlastsView.jsx` changes

- **State:** `period` (default `DEFAULT_BLAST_PERIOD = 'week'`), `customStart`, `customEnd` (both `''` initially).
- **Range:** `const range = useMemo(() => blastPeriodRange(period, { customStart, customEnd }), [period, customStart, customEnd])`.
- **Tally:** generalize the existing `tally(since)` → `tally(start, end)`; filter is `d && d >= start && d <= end`. Same Ringy/Textdrip split + `sum` reducer. When `range` is null (incomplete custom), the total is an empty tally (0s).
- **One RollupCard** driven by `tally(range)`, replacing the two fixed cards. Card label = the period's human label (`Today` / `This week` / `Last 30 days` / `Year to date` / `Custom`).
- **List filter:** `sorted` gains the range filter alongside the existing `platformFilter` — `blasts.filter(b => (platformFilter==='all' || b.platform===platformFilter) && inRange(blastDate(b), range))`. When `range` is null, the list is empty.
- **Selector UI:** a button row above the card, styled like the existing platform-filter pills / CPA period toggle (active = `bg-indigo-600 text-white`, inactive = muted, dark-mode aware). When `period === 'custom'`, render two `<input type="date">` (start / end) beside the row.

### 3.3 Custom-range behavior

- Until both dates are set and valid (`start <= end`), `blastPeriodRange` returns `null` → total shows 0, list is empty, and a small hint renders: *"Pick a start and end date."* No crash, no error.

## 4. Edge cases

- **Sunday** (getDay 0): `daysBack = 6` → week start = the Monday 6 days ago; correct (Sunday is the week's last day). **Unit-tested.**
- **Monday** (getDay 1): `daysBack = 0` → week start = today. **Unit-tested.**
- **YTD on Jan 1:** start = Jan 1 = today. **Unit-tested.**
- **30d** includes today + 29 prior = 30 calendar days. **Unit-tested.**
- **Custom inclusive end:** a blast dated on the end date is included (blastDate is that day's midnight ≤ end-of-day). **Unit-tested.**
- **Custom start > end:** returns null. **Unit-tested.**
- Blasts with an unparseable `runDate` (`blastDate` returns null) are excluded from every range (unchanged behavior).

## 5. Testing

**Unit (`blastPeriod.test.mjs`, node --test):** week Monday-start with a fixed `now` on each weekday incl. Sunday & Monday; ytd start = Jan 1 of `now`'s year; 30d start = now−29 at 00:00; today start=end-day bounds; custom inclusive end + null on missing/invalid; end is 23:59:59.999 local.

**Manual (live, local-only mode):** seed blasts across dates (today, 3 days ago, 20 days ago, 200 days ago, last year); verify each period's total + the list filter match; custom range; empty-custom hint; both light/dark themes; capture path & add/edit form unaffected.

## 6. Out of scope

- Any change to `blast_counters`, webhooks, `increment_blast`, or the add/edit-blast form.
- Per-period persistence across sessions (period resets to "This week" on reload — acceptable; matches CPA Dashboard which also resets).
- "All time" period (D2).

## 7. Rollout

Single branch `feat/blasts-period-selector`, no flag (additive UI). 479+ tests green, build clean, adversarial code review, then merge → deploy → verify. Agent-facing change → worth a one-line Slack note (Juan's call).
