# Website Leads (Universal Form Webhook) — Design Spec

**Date:** 2026-07-04
**Status:** Approved design → ready for implementation plan
**Owner:** Juan (product)
**Scope:** One new integration: a universal per-agent webhook that turns any external website form submission into a PRIM Prospect. **Webhook only** — the inbound-email capture path was considered and explicitly cut (may return later as its own feature).

---

## 1. Goal

Agents run their own websites (WordPress, Wix, Webflow, custom, etc.) with lead-capture forms. Today those submissions only email the agent. This feature gives every PRIM agent a personal webhook URL; pointing their form tool (or a Zapier/Make bridge) at it makes each submission appear in PRIM as a Prospect within seconds — `source: "Web Lead"` — universally, for all users, with zero per-agent infrastructure.

**Non-goals (explicit):**
- No inbound-email capture (cut from scope by owner).
- No embedded/hosted form builder — PRIM ingests from the agent's existing form, it does not host forms.
- No changes to the Ringy/Benepath/blast webhook routes or `increment_blast` (standing hard rule from the 2026-07-01 undercount incident).
- No new npm dependencies.

## 2. Architecture — clone the proven vendor-webhook pattern

Follow the existing Ringy/Benepath structure exactly:

| Piece | Path | Modeled on |
|---|---|---|
| Public webhook route | `src/app/api/webforms/webhook/[token]/route.js` | `api/ringy/webhook/[token]` |
| Config route (token + settings) | `src/app/api/webforms/config/route.js` | `api/ringy/config` |
| Pure logic module + tests | `src/lib/webforms.mjs` + `src/lib/webforms.test.mjs` | `src/lib/ringy.mjs` |
| Settings UI card | `src/components/WebformsSettings.jsx` | `RingySettings.jsx` |
| DB migration | `supabase/webforms-migration.sql` (Juan runs in Supabase) | prior migrations |

**Token:** 32-char hex from the existing secure-RNG pattern (crypto.randomUUID ×2; throw if no secure RNG — never Math.random), stored in a new column `profiles.webforms_webhook_token`. The token in the URL is the entire auth perimeter (form tools can't send custom headers) — same accepted posture as Ringy/Benepath. Regenerating the token invalidates the old URL.

**Migration (`supabase/webforms-migration.sql`):** `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS webforms_webhook_token text;` plus a unique index on it. No RLS change needed (column read/written only via service-role in the config/webhook routes, like the other tokens).

## 3. The webhook route — request handling

`POST /api/webforms/webhook/<token>`:

1. **Always return 200** with a minimal JSON body, even on bad input — form tools and Zapier retry or mark integrations "broken" on non-200s, and we never want a vendor retry storm. (Unknown token also returns 200 with `{ok:false}` — do not create an existence oracle.)
2. **Accept three body encodings** (form tools vary): `application/json`, `application/x-www-form-urlencoded`, and `multipart/form-data` (fields only — ignore file parts). Normalize all three into one flat `{key: value}` record. Cap raw body at **64KB**; larger → truncate for storage, still 200.
3. Resolve token → `userId` via `profiles.webforms_webhook_token` (service-role client). Unknown → log aggregate only, return 200.
4. Run the **extraction pipeline** (§4) → prospect fields + confidence.
5. **Upsert into `user_kv` key `prospects_v1`** with the same optimistic-concurrency compare-and-swap + retry-with-backoff loop the Ringy webhook uses (web-form volume is low — one visitor at a time — but the CAS loop is already proven; reuse it).
6. Update lightweight stats in the agent's `user_kv` `webforms_config_v1` (lastReceivedAt, receivedCount) — **after** the prospect write, never before it.
7. **Never log PHI** — aggregate logging only (counts, truncated key names, no values), same discipline as the existing webhooks.

## 4. Extraction pipeline (Approach A — locked by owner)

One shared function chain in `src/lib/webforms.mjs` (pure, TDD-tested):

**Step 1 — Heuristic field mapping (free, instant, expected to cover most tools).**
`extractWebformFields(record)` matches normalized keys (lowercase, strip `[]`, `-`, `_`, spaces) against synonym sets:
- name: `name, fullname, yourname, contactname, firstname+lastname (join), fname+lname`
- email: `email, emailaddress, youremail, e-mail`
- phone: `phone, phonenumber, tel, telephone, mobile, cell`
- state: `state, region, province`; zip: `zip, zipcode, postal, postalcode`
- message/notes: `message, comments, notes, details, inquiry, question, situation`
- Everything else (unrecognized keys with non-empty values) is preserved as `Label: value` lines appended into the notes text.
Success = found a name AND (phone OR email) → **high confidence**, skip AI entirely.

**Step 2 — AI fallback (only when heuristics fail).**
If step 1 can't find name + contact, call Anthropic (same Haiku model + technique as `api/import-prospects-ai`, but a new, much leaner single-record prompt: "extract one lead from this form submission payload") with an 8s timeout, `try/catch`. AI success → **low confidence** (`needsReview: true`). AI failure/timeout → step 3.
- Implementation note: a small server-side helper reused inside the webhook route; NOT a round-trip through the import-prospects-ai HTTP route.

**Step 3 — Raw preservation (never drop a submission).**
Whatever happened above, the flattened raw payload (as readable `Label: value` lines, truncated to fit) is stored in the prospect's `situation`/notes. If both steps failed to find anything, still create a Prospect named `Web Lead — needs review` with the raw text in notes and `needsReview: true`. **A received submission always becomes a Prospect. Nothing is silently dropped.**

## 5. Prospect creation, flag, and dedup

- Build via the existing `newProspect()` factory: `source: 'Web Lead'` (already a valid source enum), `crm: 'None'`, `stage: 'PENDING_DECISION'`, plus extracted fields; append the raw-payload block to `situation`.
- **`needsReview` flag:** new optional boolean on the prospect object (absent = false; older prospects unaffected). Set when confidence is low (§4 step 2/3). UI: a small amber "Double-check" chip on the Prospects kanban card and in the prospect detail view; one click (in detail) clears it (`needsReview: false` via the normal save path).
- **Dedup on ingress:** compute `prospectDedupKey` (existing helper: phone → email → name) for the incoming lead; if an existing non-archived prospect matches:
  - do NOT create a duplicate;
  - fill-empty on fields (existing values win, blanks get filled — same rule as the Ringy upsert);
  - append a re-submission entry to `touchLog` using the **real touch schema** (`{ id, at, channel, outcome, note }` — see `logTouch()` in `src/lib/followupEngine.mjs:157-163`): `{ id: <uuid>, at: <now ISO>, channel: 'Other', outcome: 'Other', note: 'Submitted your website form again' }`. Both values are in the valid enums (`CHANNELS`/`OUTCOMES`, followupEngine.mjs:11-12) so it renders in the existing timeline, and `'Other'` is in neither `CONNECT_OUTCOMES` nor `NO_CONTACT_OUTCOMES`, so it doesn't distort connect-rate stats. **Do NOT route this through `logTouch()`** — that function advances the follow-up cadence and clears open reminders, side effects that belong to agent-initiated touches only, not an automated inbound signal. Append the entry directly in the upsert logic.
  - No match → create new.

## 6. Config route + Settings UI

**`GET /api/webforms/config`** (bearer auth via `requireUserId` from `src/lib/apiAuth.js`, plus a service-role client for the `profiles` token read/write — note Ringy's config route uses its own inline `authAndClients` helper; either pattern is acceptable, pick one and be consistent): returns `{ webhookUrl, connected, lastReceivedAt, receivedCount }`; auto-generates the token on first load.
**`POST /api/webforms/config`** with `{ regenerateToken: true }`: new token (old URL dies instantly).

**`WebformsSettings.jsx`** — a card matching RingySettings' look, mounted wherever Ringy/Benepath settings currently are (Prospects → Settings area):
- The webhook URL with a copy button; "Regenerate" with a confirm (warns the old URL stops working).
- Status line: `Connected — last lead received <relative time> · <n> total` (or "Waiting for your first lead…").
- A compact per-platform cheat-sheet (collapsible): Webflow (native form webhook), Typeform/JotForm (webhook setting), WordPress (Gravity Forms/WPForms webhook add-on or Contact Form 7 + webhook plugin), Wix/Squarespace (via Zapier/Make "webhook POST" step). Include the note: "any tool that can POST a form to a URL works."
- A "Send a test lead" button that POSTs a sample payload to the agent's own webhook URL and confirms the prospect appeared — instant end-to-end validation without touching their website. The sample is clearly identifiable and disposable: name `"Test Lead (Website Leads)"`, note stating it came from the test button, so the agent can archive/delete it without hunting.

## 7. Security & abuse posture

- Token-in-URL is the auth perimeter (32-char secure-random; same accepted model as Ringy/Benepath). Regeneration is the abuse remedy.
- 64KB body cap; multipart file parts ignored (never stored); always-200 with no token-validity oracle.
- **No rate limiter and no extra DB round-trips before the prospect write** — the standing lesson from the 2026-07-01 incident applies to every capture path.
- PHI discipline: no payload values in logs, ever.

## 8. Testing & verification

- `src/lib/webforms.test.mjs` (node --test, TDD): heuristic mapping across synonym sets (incl. `first_name`+`last_name` join, `your-name[]`-style keys), the three body-encoding normalizations, confidence rules, raw-preservation block building, dedup fill-empty + touch-append behavior (pure function level).
- Route-level manual verification: POST JSON / urlencoded / multipart samples with curl to a dev token → prospect appears; unknown token → 200 `{ok:false}`, no prospect; malformed body → flagged raw prospect, still 200.
- Settings card: copy button, regenerate (the old URL keeps returning 200 but becomes a no-op that creates nothing; the new URL captures), test-lead button round-trip, both themes.
- `npm run build` clean; no new deps; Ringy/Benepath/blast routes untouched (`git diff` proves it).

## 9. Ship ritual

User-facing feature → `ANNOUNCEMENTS` What's-New entry ("Connect your website: every form submission becomes a Prospect automatically") + decide on `[announce]` Slack deploy at ship time. Feature branch + PR; no unattended pushes to `main`.
