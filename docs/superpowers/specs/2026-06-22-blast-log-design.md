# Blast Log (Repurpose Tracker) — Design

**Date:** 2026-06-22
**Status:** Design — awaiting review before implementation.

## Goal

Log every **blast / repurpose** in PRIM, automatically, each time one is run — so agents (and team leaders) have an in-app record of their Ringy/TextDrip repurpose activity. PRIM does **not** run the blast; it only receives a copy of each completed run.

## Context — what a "blast" is

A blast/repurpose is a daily action run **outside PRIM** by the user's Cowork skill (`ringy-textdrip-blast`), which drives Ringy and TextDrip in the browser:

- **Ringy** — bulk-apply the tag `REPUROSED - AGED - POST O/E DRIP` to a batch of aged leads (~2,000), which fires the text-drip automation.
- **TextDrip** — filter contacts by a date range and **Add to Campaign** (`New Aged leads TEST`), which sends the drip.

The skill already appends each run to a local `blast-log.csv` with columns:
`run_date, platform, range_start, range_end, campaign_or_tag, contacts, send_time, numbers_used, notes`.

This feature adds a parallel "send a copy to PRIM" step so the same row lands in PRIM's tracker in real time.

## Decisions (from brainstorming)

- **Capture:** auto webhook — the Cowork skill POSTs each finished blast to a PRIM endpoint (mirrors the Benepath/Ringy webhook pattern). No manual entry.
- **Location:** a dedicated **"Blasts"** top-nav tab.
- **Roll-up:** **plain totals** only — no caps (caps are a Cowork-side guideline for the operator, not something PRIM enforces or displays).
- **Visibility:** the Blasts tab shows for **everyone**, with a setup state until the first blast arrives.
- **Scope (v1):** aggregate blast *events* only — **no** per-lead tagging in PRIM, **no** analytics/CPA tie-in (could come later).

## Architecture

### 1. Inbound webhook — `POST /api/blast/log/[token]`
Mirrors the Benepath webhook exactly (proven pattern):
- Token in `profiles.blast_webhook_token` (per-user 32-char hex). Public endpoint; token-in-URL is the auth (the skill can't send headers reliably).
- Tolerant body parse — accepts JSON or form-encoded, and both the CSV field names and camelCase: `run_date`/`runDate`, `platform`, `range_start`/`rangeStart`, `range_end`/`rangeEnd`, `campaign_or_tag`/`campaignOrTag`, `contacts`, `send_time`/`sendTime`, `numbers_used`/`numbersUsed`, `notes`.
- Normalize → blast record. **Dedup key** = `runDate + platform + sendTime + campaignOrTag` so an accidental re-POST won't double-log (update-in-place on match).
- Append to `blast_log_v1` (user_kv array) with the same optimistic compare-and-swap retry the Benepath route uses.
- Always returns HTTP 200 (`{ ok, status: 'success', action }`), with a GET/HEAD readiness probe.

### 2. Pure normalizer lib — `src/lib/blastLog.mjs` (+ `blastLog.test.mjs`)
Dependency-free, unit-tested:
- `normalizeBlastPayload(body)` → `{ runDate, platform, rangeStart, rangeEnd, campaignOrTag, contacts, sendTime, numbersUsed, notes }`. Platform normalized to `Ringy` | `Textdrip`; `contacts` coerced to a number; dates left as received (display-only).
- `upsertBlast(list, record, now)` → `{ list, action: 'create'|'update' }` using the dedup key.

### 3. Config route — `GET/POST /api/blast/config`
- `GET` (bearer-authed): ensure token exists, return `{ postingUrl, connected, lastReceivedAt, blastCount }`.
- `POST`: regenerate token. (No other settings — no default stage, etc.)

### 4. Blasts tab — `src/components/views/BlastsView.jsx`
- New nav entry `{ label: 'Blasts', viewId: 'blasts' }` in `NAV_TABS` (constants.js), rendered in LeadTracker. Visible to all.
- **Roll-up header (plain totals):** Today and This-week — total contacts blasted + blast count, split by platform (Ringy / TextDrip). No caps, no targets.
- **Table** (newest first): Date · Platform (badge) · Lead Range · Campaign/Tag · Contacts · Send Time · Sending Numbers · Notes. Platform filter (All / Ringy / TextDrip).
- **Setup panel** (collapsible): the per-user **Posting URL** (copy + regenerate) and the exact step to add to the Cowork blast skill. Always available; an empty state explains it before the first blast lands.
- Per-row delete (like the Investment Log) to remove a mistaken/test entry.
- `readOnly` support for the Team-leader mirror: show the log + roll-up, hide the setup panel and delete actions.

### 5. Data model — `blast_log_v1` (user_kv array)
```
{ id, runDate, platform, rangeStart, rangeEnd, campaignOrTag,
  contacts, sendTime, numbersUsed, notes, createdAt }
```
Server (webhook) is the authoritative appender via CAS. LeadTracker loads `blast_log_v1` and passes it to `BlastsView`; a delete handler writes back. Registered for the same cloud-sync treatment as other per-user arrays.

### 6. Cowork skill change (operator side)
The PRIM setup panel displays the exact snippet to add to the skill's "Log every blast" step: after appending the row to `blast-log.csv`, also POST the same row as JSON to the Posting URL (one `curl`/fetch). Provided as copy-paste; the skill files live in the user's Cowork folder, not this repo — PRIM only surfaces the snippet + URL.

### 7. SQL migration (user runs in Supabase)
```sql
alter table public.profiles
  add column if not exists blast_webhook_token text;
create unique index if not exists profiles_blast_webhook_token_key
  on public.profiles (blast_webhook_token) where blast_webhook_token is not null;
```

## Testing
- `blastLog.test.mjs`: normalize from CSV field names + camelCase; platform normalization; contacts coercion; dedup/upsert (re-POST updates, doesn't duplicate); tolerant of missing fields.
- Production build + live webhook smoke test (GET probe + a sample POST) as with Benepath.

## Files
- New: `src/app/api/blast/log/[token]/route.js`, `src/app/api/blast/config/route.js`, `src/lib/blastLog.mjs`, `src/lib/blastLog.test.mjs`, `src/components/views/BlastsView.jsx`.
- Edit: `src/lib/constants.js` (NAV_TABS), `src/components/LeadTracker.jsx` (load `blast_log_v1`, render `BlastsView`, route `blasts`).
- Hand to user: SQL migration + the Cowork skill POST snippet (shown in the setup panel).

## Out of scope (v1)
Per-lead tagging in PRIM; CPA/analytics tie-in; cap enforcement/warnings; running the blast from PRIM (it stays in Cowork).
