# PRIM Integrations Scoping — Calendly, Benepath, Repurposing

**Date:** 2026-06-18
**Status:** ✅ Benepath SHIPPED & verified live (Group Health). Calendly + Repurposing not started.

## Benepath — DONE (2026-06-18)

Live and verified end-to-end. Final config:
- Inbound webhook `POST /api/benepath/webhook/[token]` (Ringy-pattern clone). Token in `profiles.benepath_webhook_token` (SQL migration run by Juan). Config + Settings card at `BenepathSettings.jsx`; per-user default stage in `benepath_config_v1`.
- Lib `src/lib/benepath.mjs` (+ `benepath.test.mjs`, 14 tests): tolerant parser (JSON/form/nested-flatten, broad aliases), immutable upsert (dedup phone/email/leadId), always-200 responses with `status:"success"` token, GET/HEAD readiness probes.
- **Agent's product is Group Health (employer), not individual Health.** Normalizer captures Company Name + # Employees + coverage expiration; buckets to indvOrFamily Small Bizz (<5) / Employer 5-10 (5+); folds business context into situation. Source = CRM = leadVendor = "Benepath".
- Benepath portal setup: New Integration → POST → Posting URL (PRIM's) → ping OFF; Request Headers empty; Api Fields → Content Type `application/json`, Lead Type **Group Health**, Liquid body template (in the in-app guide, copy button); Response Type Success = `success`; Test with Product Leads + Group Health.
- In-app step-by-step guide rewritten in `BenepathSettings.jsx` for self-serve by other agents.
- Gotchas learned: Response Type "Success" is a body-string match (use `success`, not "HTTP 200"); Benepath has no DOB (use Age / for Group Health, business fields); integration Lead Type must match the campaign product or leads don't route.
- Remaining (Juan's side): delete test prospects; confirm integration green/Active + attached to Group Health campaigns; set Default Stage.

## Goal

Three integrations requested:
1. **Calendly → PRIM** — a booking auto-creates a Prospect.
2. **TextDrip + Ringy "repurposing" tracker** — log the repurposing workflow Juan built in Cowork.
3. **Benepath leads portal → PRIM** — leads auto-land in the Prospects tab with full info.

## Key discovery finding: PRIM already has the inbound-webhook template

The Ringy integration is the canonical inbound-lead pattern. New inbound integrations (Benepath, Calendly) should mirror it.

- **Route:** `POST /api/{vendor}/webhook/[token]` — token in URL (vendors can't send custom headers).
- **Auth/user binding:** token stored in `profiles.{vendor}_webhook_token` (32-char hex). Webhook resolves token → userId via **service-role** admin client.
- **Config route:** `GET/POST /api/{vendor}/config` (bearer-authed) generates/regenerates token, returns webhook URL, saves mapping + defaultStage to `user_kv` key `{vendor}_config_v1`.
- **Normalizer:** pure `src/lib/{vendor}.mjs` — `normalize{Vendor}Payload(body)` + `upsert{Vendor}Lead(prospects, normalized, config, now)`. Match on `phoneKey` OR vendor lead id; **create** new prospect (`source`/`crm` = vendor, mapped stage) or **fill-empty** on update (stage authoritative).
- **Persistence:** `user_kv` key `prospects_v1` (mergeable array). Optimistic CAS retry (5×, 40ms backoff) on `updated_at` for concurrent webhooks.
- **Dedup:** `prospectDedupKey` (phone → email → name) in `src/lib/prospects.js`.
- **UI:** `{Vendor}Settings.jsx` mirrors `RingySettings.jsx` — copy-able webhook URL, regenerate, disposition→stage mapping table, default stage, setup instructions.
- **Prospect model:** `newProspect()` in `src/lib/prospects.js` (name, phone, email, state, zip, dobs, income, quoteSize, policyType, situation, startDate, source, crm, stage, appointmentTime, nextSteps, lastContact, touchLog, cadence, …).

TextDrip, by contrast, is **pull/polling** (client clicks "Sync now" → server pages TextDrip API by tag → normalize → client upsert) with an AI `extract-conversation` step (Haiku 4.5, JSON schema) for new prospects.

## Task 1 — Calendly (RECOMMENDED FIRST: fully self-serve + testable)

- **Webhooks v2**, events `invitee.created` / `invitee.canceled` (reschedule fires canceled w/ `rescheduled:true` then created).
- **Auth:** Personal Access Token (simplest for one account). **Requires a paid Calendly plan.**
- **Flow:** Juan pastes PAT in a `CalendlySettings` connect form → server validates via `GET /users/me`, stores PAT (`calendly_secret_v1`), gets user/org URI → server creates webhook subscription (`POST /webhook_subscriptions`) pointing at `/api/calendly/webhook/[token]` → inbound webhook fetches invitee details (`GET /scheduled_events/{uuid}/invitees/{uuid}`) → upsert prospect at `APPOINTMENT_SET` with `appointmentTime`.
- **To verify before build:** webhook signature header + HMAC algorithm (Calendly signing key), exact rate limits, whether PAT webhooks are signed. Sources: developer.calendly.com.
- **Open decision:** behavior on cancel/reschedule (→ `MISSED_APPT`? update notes only? update time?).

## Task 2 — Benepath (start support request in parallel; build = Ringy clone)

- Benepath supports **real-time HTTP POST to a customer-provided URL** (also email/SMS/portal). **Setup is support-driven** — not self-serve; Benepath's team registers the destination URL. Payload format (JSON/form/XML) and exact field names are **not publicly documented** → need a real sample.
- **Build:** clone the Ringy webhook (`/api/benepath/webhook/[token]`), tolerant parser (consider AI-assisted field mapping fallback), upsert to prospects. Fields expected: name, phone, email, address/state/zip, requested coverage start date, current insurance status.
- **Needed:** (a) Juan asks Benepath to POST leads to our URL; (b) one sample lead to map fields.
- Fallback if webhook refused: parse forwarded lead emails.

## Task 3 — Repurposing (BLOCKED on Cowork file)

- **Nothing exists in PRIM** for "repurpose/repurposing/cowork/recycle/re-engage" (zero matches). The "Repurposed 6/17" seen on a card came from Juan's external Cowork workflow.
- Best inference: a lead is re-engaged → stage change + `nextSteps` set to "Repurposed <date>" + a `touchLog` entry. Confirm against the Cowork file.
- **Needed:** the Cowork workflow file (full spec).

## Inputs needed from Juan

1. Calendly: paid plan? (y/n)
2. Calendly: Personal Access Token (pasted into PRIM by Juan).
3. Calendly: cancel/reschedule behavior decision.
4. Benepath: confirm he can request the POST-to-URL setup from Benepath.
5. Benepath: one sample lead payload/email.
6. Repurposing: the Cowork workflow file.

## Security note

All three handle PII over inbound webhooks. Plan: keep token-in-URL auth, add signature verification where the vendor provides it (Calendly signing key), and run an adversarial review pass on each before shipping.
