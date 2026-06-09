# Ringy → PRIM integration v1 (lead webhook feed) — design

**Date:** 2026-06-09 · **Status:** Approved → implementation
**Contract reference:** `2026-06-09-ringy-integration-research.md` (confirmed Ringy API/webhook contract).

## Purpose
Real-time lead feed: when an agent dispositions a lead in Ringy, Ringy POSTs it to a per-agent PRIM webhook; PRIM creates/updates a prospect (deduped by phone), maps the disposition → a PRIM stage, and keeps the pipeline in sync on re-disposition.

## Decisions (from brainstorming)
- **Scope:** webhook lead feed ONLY. No API-key extras (calls/sold/appointments/get-lead) and no SMS content (unavailable) in v1.
- **Stage mapping:** configured **in PRIM** — a disposition→stage table + a default stage for unmapped.
- **Dedup:** match by phone (or ringyLeadId) → **update in place, fill-empty (never overwrite agent edits)**; stamp `source: 'Ringy'` + `ringyLeadId`; update stage per the mapped disposition. No duplicates. No review modal (background event).
- **Per-agent:** each agent has their own Ringy account → their own PRIM webhook URL/token + their own mapping.

## Architecture — direct receiver
Ringy → `POST /api/ringy/webhook/<token>` (public; token in URL is the auth) → resolve token→userId (service-role) → load that agent's `ringy_config_v1` + `prospects_v1` → normalize → upsert into prospects_v1 (service-role read-modify-write). PRIM's existing merge-on-save reconciles client/server. (Inbox model considered + deferred as a hardening option.)

## Data model
- **`profiles.ringy_webhook_token`** (text, unique, indexed) — lets the public receiver resolve token→userId. (Migration below.)
- **`ringy_config_v1`** (user_kv) — `{ mapping: [{ disposition, stage }], defaultStage, connected, lastReceivedAt, importedCount }`.
- **Prospect additions:** `source: 'Ringy'`, `ringyLeadId`. Add `'Ringy'` to `PROSPECT_SOURCES` (constants.js).

## Pure lib — `src/lib/ringy.mjs` (dependency-free, + `ringy.test.mjs`)
- `phoneKey(raw)` — digits only, drop leading US `1` (same as textdrip).
- `ageFromDob(dob, nowIso)` — integer years or null.
- `normalizeRingyPayload(body)` → `{ ringyLeadId, name, phone, phoneKey, email, address, city, state, zip, birthday, age, notes, status, source, disposition }`. Tolerant of missing keys; builds `name` from first+last if `name` absent.
- `mapDispositionToStage(disposition, mapping, defaultStage)` → stageId. Case-insensitive match of `disposition` against `mapping[].disposition`; fallback `defaultStage`.
- `upsertRingyLead(prospects, normalized, mapping, defaultStage, now)` → `{ prospects, action }`:
  - match by `phoneKey` OR existing `ringyLeadId`.
  - no match → create (prospect shape mirrors `newProspect`: name/phone/email/state/zip/age/notes→situation-or-meds?, stage=mapped, source='Ringy', ringyLeadId, createdAt; follow-up defaults).
  - match → **fill-empty** demographics (email/state/zip/age/address), **set stage = mapped** (disposition is authoritative for stage), stamp `ringyLeadId`/`source` if missing, refresh a Ringy note. Never overwrite non-empty agent-edited fields except stage.
  - Put Ringy `notes` into the prospect `situation` (fill-empty); `status` is informational.
- Unit tests: phoneKey, ageFromDob, normalize (full + sparse), mapDispositionToStage (match/case/default), upsert (create / update-fill-empty / stage-update / dedup by ringyLeadId).

## API routes
- **`GET/POST /api/ringy/config`** (authed: bearer→getUser). GET returns `{ webhookUrl, mapping, defaultStage, connected, lastReceivedAt, importedCount }` (generates + stores a token in `profiles` if missing). POST saves `{ mapping, defaultStage }`. Support `regenerateToken: true` to rotate. Never expose other users' data; webhookUrl built from the caller's token.
- **`POST /api/ringy/webhook/[token]`** (PUBLIC, `runtime nodejs`, `dynamic force-dynamic`): resolve token→userId via service-role `profiles` query; if unknown token → 404/200-noop. Parse JSON body; `normalizeRingyPayload`; load config + prospects_v1 (service-role); `upsertRingyLead`; write prospects_v1; bump `lastReceivedAt`/`importedCount`. Return 200 fast. **NEVER log PHI** (names/notes/phones) — aggregate/booleans only. Wrap in try/catch; always 200 to avoid Ringy retries storms (log errors server-side).

## UI — "Ringy" Settings card (`src/components/RingySettings.jsx`, in the prospect Settings modal next to TextDrip)
- On mount `GET /api/ringy/config`.
- Show **Webhook URL** (read-only) + **Copy** + **Regenerate** (rotates token; warns it breaks the old URL).
- **Disposition → Stage** table: add/remove rows (text input for the Ringy disposition name + a `<select>` of PRIM stages). + a **Default stage** select. **Save** → POST config.
- Collapsible **Setup instructions**: the exact Ringy steps + the copy-paste **payload key list** (below).
- Status line: connected ✓ · last received · imported count.
- Match existing settings card styling (dark-mode aware).

## Ringy setup the agent performs (documented in the card)
In Ringy → Disposition Tags & Automated Actions → for each disposition to sync: create/edit an Automated Action → check **Post to a custom webhook** → paste the PRIM URL → **ADD VALUE** for each:
| Key (type exactly) | Value (pick from dropdown) |
|---|---|
| `leadId` | Lead ID |
| `firstName` | Lead first name |
| `lastName` | Lead last name |
| `phone` | Lead phone number |
| `email` | Lead email |
| `address` | Lead street address |
| `city` | Lead city |
| `state` | Lead State |
| `zip` | Lead zipcode |
| `birthday` | Lead birthday |
| `notes` | Lead notes |
| `status` | Lead status |
| `source` | Lead source |
| `disposition` | **Custom** → type the disposition tag's name |

Then add that disposition name + a PRIM stage in PRIM's mapping table.

## Security
Token (random, ~32 char) in the URL path is the auth (Ringy can't send headers). Rotatable. Stored in `profiles` (service-role resolves it). Receiver does no auth-header check (none available) but validates the token maps to a user. No PHI in logs. Prospect data stays in the owning agent's RLS-isolated `user_kv`.

## Migration (Juan runs in Supabase SQL Editor)
```
alter table public.profiles add column if not exists ringy_webhook_token text;
create unique index if not exists profiles_ringy_webhook_token_idx on public.profiles (ringy_webhook_token) where ringy_webhook_token is not null;
```

## Out of scope (v1)
SMS content; API-key features (get-lead enrichment, call activity, sold-products backfill, create-appointment write-back); review modal.

## Build order
1. `ringy.mjs` lib + tests.
2. Migration SQL + `/api/ringy/config` + `/api/ringy/webhook/[token]` + `PROSPECT_SOURCES += 'Ringy'`.
3. `RingySettings.jsx` card + mount in Settings modal.
4. Announcement + verify (tests/build) + ship.
