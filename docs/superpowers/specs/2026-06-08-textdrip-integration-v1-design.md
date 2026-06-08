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
- **`POST /api/textdrip/sync`** — loads secret + config; calls TextDrip to fetch contacts carrying `importTag` + each one's conversation; normalizes; returns `{ contacts: [{ name, phone, phoneKey, tags, textdripContactId, conversation }], counts }`. Soft cap (e.g. 200 contacts/sync) logged if exceeded. The CLIENT upserts + dedups + shows review.

### TextDrip API contract — CONFIRM AT BUILD (Step 0, see below)
Capabilities are confirmed (Zapier actions: Get Phone Number List, Get All Tags, Get Contact Details, Get All Conversations / Get Chats, etc.); exact base URL, auth header, endpoint paths, params, and response shapes MUST be confirmed from the Postman docs (https://documenter.getpostman.com/view/19538898/UVeKqQb1) or the TextDrip MCP before writing the client. Treat unobtainable contract as a blocker to surface.

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
