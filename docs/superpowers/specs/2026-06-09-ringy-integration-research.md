# Ringy ↔ PRIM — API contract & feasibility (research, confirmed 2026-06-09)

Confirmed live from the Ringy account (Account Settings → API Keys, Call/Text Webhooks, Disposition Tags & Automated Actions). This is the pinned contract for the eventual spec.

## Feasibility verdict
- ✅ **Leads — strong.** Real-time, disposition-triggered **custom webhook** with a **fully configurable payload** (we pick the keys + map ~25 Ringy lead fields). Plus API-key pull/enrichment + appointment write-back.
- ❌ **SMS conversation content — NOT available.** Text webhook sends only your email + a *count* of texts; there is no API endpoint for message bodies. (So we can't replicate TextDrip's conversation sync.)
- ⚠️ **No "list all leads" endpoint.** API-key discovery is only via date-range endpoints that return `leadId`s (call-recordings, sold-products). The real lead feed is the **webhook**.

## INBOUND — Custom webhook (Ringy → PRIM)  ← the lead feed
- Set up: **Disposition Tags & Automated Actions** → create an Automated Action → check **"Post to a custom webhook"** → enter PRIM's URL → **define payload** via ADD VALUE (Key = name PRIM expects; Value = Ringy field). Attach the action to disposition tags.
- Fires **in real time** when a lead is dispositioned with that tag. Method POST, `application/json`, user-agent `axios`. **Payload is whatever we configure** (empty if no values added — that was the earlier `{}`).
- **Available Value fields to map:** Lead full name · first · last · phone number · email · street address · city · state · zipcode · birthday · notes · status · quote · **Lead ID** · vendor reference ID · vendor response ID · source · user name (agent) · user email · is sold · marked-on-sold (date) · initial text sent on · last inbound call · last outbound call · last inbound text · created at · current timestamp · **Custom** (static value — use to stamp the triggering disposition/stage per action).
- Implication: the webhook alone can carry the **full prospect** (identity, contact, address, birthday→age, notes, status, source, sold flag/date, activity timestamps). `get-lead` enrichment becomes optional.

## API-KEY endpoints (PRIM → Ringy pull / write). All `POST`, `application/json`, `apiKey` in body.
Base: `https://app.ringy.com/api/public/external/`
- `get-lead` — body `{apiKey, leadId}` → id, phoneNumber, name, email, vendorResponseId, streetAddress, city, state, zipCode, **notes (most recent only)**, **dispositions[] (tag names)**, receivedOn.
- `get-calls` — `{apiKey, callId}` → id, callDirection (INBOUND/OUTBOUND), to/fromPhoneNumber, leadId, duration, callStartDate.
- `get-call-recordings` — `{apiKey, startDate, endDate, limit(≤5000)}` → [{id, callId, mediaUrl, dateRecorded, agentId, userFullName}]. **(date-range; yields callIds→leadIds)**
- `get-lead-sold-products` — `{apiKey, startDate, endDate, limit}` → [{leadId, soldProductId, soldProductName, amount, dateSold}]. **(date-range; yields leadIds)**
- `create-appointment` — `{apiKey, leadId|leadPhoneNumber+name, leadEmail?, comments?, start(UTC), durationInMinutes?}` → `{status, message}`. **(write-back)**
- API keys created in **Account Settings → API Keys** with per-key **permission checkboxes** (Call recordings, Call data, Lead data, Lead sold products, Create appointment). Dates are **UTC `YYYY-MM-DD HH:mm:ss`**.

## Likely build shape (for the spec)
- **Receiver:** a per-agent PRIM webhook endpoint (`/api/ringy/webhook/<token>`) the agent pastes into their Ringy disposition actions. Verify via the opaque token.
- **Mapping:** Ringy disposition/status → PRIM prospect stage (agent's tags already map well: Expressed Interest, Active Conversation/APPT set, SOLD, Missed Appointment, Ghost, NO CONTACT, etc.).
- **Dedup:** by phone (PRIM's normalized phoneKey) + store `ringyLeadId`.
- **Enrichment/optional:** `get-lead` for dispositions[]/note; date-range endpoints for backfill of called/sold leads; `create-appointment` write-back.
- **Out of scope:** SMS conversation content (unavailable).
- Per-agent: each agent has their own Ringy account → their own API key + their own webhook URL/token. Mirrors TextDrip's per-agent model.

## Open design questions (for brainstorming)
- Which dispositions import / how to map each to a PRIM stage (config UI vs fixed map).
- Webhook-only vs webhook + `get-lead` enrichment for v1.
- How the agent configures it (we'll need clear setup instructions — they add the webhook action to each disposition tag they want synced).
- Security: token in URL + optional shared-secret header.
