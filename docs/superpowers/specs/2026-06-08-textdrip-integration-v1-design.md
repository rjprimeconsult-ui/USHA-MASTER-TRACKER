# TextDrip ↔ PRIM integration — v1 (pull-only) design

**Date:** 2026-06-08
**Status:** Approved → implementation
**Scope:** v1 pulls FROM TextDrip into PRIM. No write-back.

## Purpose
Let each agent connect their own TextDrip account to PRIM and pull tagged contacts + their SMS conversations into PRIM as prospects, so they can see and work TextDrip leads inside PRIM.

## Decisions (from brainstorming)
- **Accounts:** per-agent. Each agent connects their own TextDrip **API key** in Settings.
- **v1 = pull-only.** No sending/enrolling/pushing to TextDrip yet.
- **Import rule:** import a TextDrip contact only if it carries **one specific tag** the agent designates (e.g. `PRIM`).
- **Landing stage:** a **default stage** the agent picks in Settings.
- **Sync:** **manual "Sync now"** button (no background polling in v1).
- **Dedup (by normalized phone):**
  - No match → create a new prospect (source = `TextDrip`).
  - Match that already came from TextDrip → **update in place** (refresh conversation), no duplicate, no prompt.
  - Match from a different source → **hold for review**: per-contact **Merge** or **Skip** (default Skip).

## Architecture
PRIM's **server** talks to TextDrip (never the browser) so the API key stays secret. (Rejected: browser→TextDrip = leaks key + CORS; server writing directly into user_kv = fights PRIM's merge-on-save.) Flow: client clicks Sync → PRIM server route loads the agent's key + tag, calls TextDrip, returns normalized data → client upserts into prospects (reusing PRIM's dedup + persistence) and shows the review step for collisions.

## Data model
- **`textdrip_secret_v1`** (user_kv) — `{ apiKey }`. Written/read ONLY by server routes (via service-role for the authed user). The client never fetches it. *v1 limitation:* RLS technically lets a user read their own row; acceptable since it's their own key, and the app never surfaces it. Future hardening: encrypt-at-rest / dedicated secrets table.
- **`textdrip_config_v1`** (user_kv, client-readable) — `{ importTag, defaultStage, connected, last4, lastSyncAt }`. No raw key.
- **Prospect additions:** `source: 'TextDrip'`, `textdripContactId` (for re-sync matching), and `textdripChat: { messages: [{ at, direction: 'in'|'out', body }], lastMessageAt, syncedAt }` (capped to most recent 50 messages to keep the blob light).
- Add `'TextDrip'` to `PROSPECT_SOURCES` in `src/lib/constants.js`.

## API routes (all auth'd: bearer token → getUser)
- **`POST /api/textdrip/connect`** — body `{ apiKey, importTag, defaultStage }`; validates the key with a lightweight TextDrip call; on success stores secret + config; returns `{ connected, last4, importTag, defaultStage }`.
- **`GET /api/textdrip/status`** — returns config (connected, last4, importTag, defaultStage, lastSyncAt). Never the raw key.
- **`POST /api/textdrip/disconnect`** — clears secret + config.
- **`POST /api/textdrip/sync`** — loads secret + config; runs the **import scan** (below); returns `{ contacts: [{ name, phone, phoneKey, tags, textdripContactId, conversation:{messages,lastMessageAt} }], scanned, matchedTag, lastMessageAtMax, counts }`. The CLIENT upserts + dedups + shows review, then saves `lastSyncAt = lastMessageAtMax`.

### Import mechanism (revised — there is NO "contacts by tag" endpoint)
TextDrip exposes contacts only via `get-conversations` (newest-first, 7/page). So sync **scans conversations newest-first and filters by the chosen tag title**:
1. Page through `/get-conversations` from page 1 (newest).
2. For each conversation whose `tags[].title` includes `importTag` → it's an import candidate; fetch its thread via `/get-chats?phone=` (cap 50 messages) and normalize.
3. **Stop** when: a conversation's parsed `last_message_date` is **older than `lastSyncAt`** (incremental), OR a **first-sync page cap** is hit (no prior `lastSyncAt` → scan up to `FIRST_SYNC_MAX_PAGES`, default 30 pages ≈ 210 recent conversations). Log/report how far it scanned.
This gives "recent + incremental": first sync grabs recent tagged contacts; later syncs only scan new activity. Known limitation (accepted): a tagged contact with no recent message activity beyond the scan window won't import. Respect rate limits: small delay between pages; only fetch `get-chats` for tag-matched candidates.

### TextDrip API contract — CONFIRMED LIVE 2026-06-08 (via MCP introspection)
- **Base URL:** `https://api.textdrip.com/api`
- **Auth (PRIM REST):** per-agent **API key** as a Bearer token. (The MCP itself uses OAuth; the REST API uses the account API key — confirm the exact header name from Postman, default `Authorization: Bearer <key>`.) This is the ONE remaining unknown for the implementer to verify against Postman.
- **`GET /get-conversations?page=N&search=`** → `{ contacts: { data: [ { id, name, last_name, phone, last_message, last_message_date, last_message_id, unread_message_count, tags: [{ id, title, color }], pipeline: { pipeline_id } } ], current_page, last_page, next_page_url, total }, total_unread_count }`. **Newest-first, per_page = 7.** `phone` is 11-digit, leading `1`, no `+` (e.g. `19416851718`).
- **`GET /get-chats?phone=+1XXXXXXXXXX&page=N`** → `{ contact_id, chats: { data: [ { message, type, date, delivery_status, is_drip, media_html } ], current_page, last_page, total } }`. **per_page = 15.** Direction: `type === 'receiver'` = OUTBOUND (agent→contact); `type === 'sender'` = INBOUND (contact→agent).
- **`GET /get-all-tags?page=N`** → tag list; **`id` is null in this endpoint** — real tag ids only appear on conversation `tags[]`. Match the import tag by **title** (e.g. `APPT SET PRIM`), not id. Used to populate the tag picker.
- **Dates** are human strings like `"8th Jun, 2026 6:29 PM"` — parse to ISO (strip ordinal suffix) for sorting/`lastMessageAt`/incremental cutoff.
- **Phone normalization:** digits-only, drop leading `1` → match against PRIM's normalized phones.

## Pure lib — `src/lib/textdrip.mjs` (+ `textdrip.test.mjs`, node:test)
- `phoneKey(raw)` — digits-only, drop leading US `1` → canonical match key.
- `normalizeContact(td)` → `{ name, phone, phoneKey, tags, textdripContactId, source:'TextDrip' }`.
- `normalizeConversation(td)` → `{ messages:[{at,direction,body}], lastMessageAt }`, capped to last 50.
- `classifyImport(contact, existingProspects)` → `{ action:'create'|'update'|'review', matchId? }` (update only when the matched prospect is TextDrip-origin / same `textdripContactId`).
- `mapToProspect(contact, defaultStage, conversation)` → new prospect object (reuse `newProspect` shape).
- `mergeConversationIntoProspect(prospect, conversation)` → updated prospect.
Unit-tested: phoneKey edge cases, create/update/review classification, conversation cap, mapping.

## Client (LeadTracker / ProspectsView)
- **Sync flow:** call `/api/textdrip/sync` → for each contact run `classifyImport`: apply `create`/`update` immediately (persist via existing prospect store); collect `review` items.
- **Review step:** if any review items, open a "Review TextDrip duplicates" modal (reuse the existing DuplicateResolver pattern) → per item **Merge** (fold conversation/details into the matched prospect) or **Skip** (default). Apply choices.
- **Result toast:** "Imported X · updated Y · N to review."

## UI
- **Settings → "TextDrip" card:** API key (password input), import-tag input, default-stage select, Connect/Disconnect, status (Connected ✓ · ••••last4 · last synced), and a "Sync now" button.
- **Prospects:** a "Sync TextDrip" button (near the existing import action) + a **"Texts (TextDrip)"** section in the prospect detail rendering the SMS thread (in/out bubbles, capped, with lastMessageAt).

## Security / HIPAA
- API key server-side only; never in client bundle, never returned after entry, never logged.
- Conversation text stays in the agent's RLS-isolated data; never cross-agent. Pull-only = nothing pushed outbound.
- Respect TextDrip rate limits (fetch tagged contacts only; soft cap per sync).

## Error handling
- Invalid key on connect → clear "couldn't connect" message, nothing saved.
- TextDrip API error/ratelimit on sync → surface message, apply any partial results, keep going.
- No tag/stage configured → prompt to finish setup before sync.

## Out of scope (v1)
Sending texts / scheduling / enrolling in drips / pushing leads TO TextDrip; background auto-sync; multiple tags → different stages; auto-logging replies as follow-up "touches" (planned v1.1 — would clear the No-answer reminder).

## Build sequence
0. **Confirm TextDrip API contract** (auth + endpoints + shapes) — blocker if unobtainable.
1. `textdrip.mjs` lib + tests.
2. TextDrip REST client + API routes (connect/status/disconnect/sync).
3. Settings "TextDrip" card.
4. Prospects: Sync button + client upsert/dedup + review modal + conversation view.
5. `constants` source + announcement entry.
6. Verify (tests + build), commit, push, announce.
