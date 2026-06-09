# Playbook: Integrating a third-party API into PRIM

Distilled from the TextDrip integration (2026-06-08), which worked great in the
end but took ~10 fix commits because we built on assumptions instead of the
verified contract. This playbook front-loads the things that bit us so the next
integration is smooth.

## The golden rule
**Verify the external contract BEFORE writing the client.** Most of the TextDrip
pain was guessing endpoints, methods, field names, and formats. Confirm them
first, write them into the spec, then build.

---

## Phase 1 — Pin the contract (do this first)
For the external API, get the EXACT, real values — not assumptions:
- **Base URL, auth** — header name + format (e.g. `Authorization: Bearer <key>`).
- **HTTP method per endpoint** — don't assume GET. (TextDrip is all POST.)
- **Endpoint paths** — exact spelling. (We guessed `/get-contact`; real was `/get-contact-detail` → 404s.)
- **Request body/param shape** — names + types (note: page numbers were strings `"1"`).
- **Response field names** — the literal keys. (We read `dob`/`zip`; real keys were `birthdate`/`zipcode`, so fields silently came back blank.)

**How to get the real contract:**
- If there's a **Postman doc** (`documenter.getpostman.com/view/<id>`), the page is JS-rendered (WebFetch returns nothing), BUT the raw collection JSON is fetchable:
  `curl -s "https://documenter.gw.postman.com/api/collections/<id>"` → grep it for endpoint names, `"method"`, header `Authorization`, and body `"raw"` examples.
- If there's an **MCP** for the service, introspect live: list tools, call the read endpoints, and inspect the real response shapes (this is how we confirmed TextDrip's contact/conversation/tag shapes).
- **Probe with curl** to learn method/auth without a key: `GET` a POST-only path → 405; a bad path → 404; valid path with bad auth → the API's auth-error body. (A masked generic 400 means you can't distinguish further without a real key — then ask the user for a throwaway key they can rotate after.)
- Write all of this into the design spec's "API contract (confirmed)" section.

## Phase 2 — Design defensively
- **Formats you're unsure about → make the client tolerant.** When a param format was uncertain (phone for `get-contact-detail`), the fix was trying `+1XXXXXXXXXX`, `1XXXXXXXXXX`, `XXXXXXXXXX` and returning on the first that resolves.
- **"Incremental since last sync" is a trap without a real cursor.** A naive `lastMessageDate < lastSyncAt` cutoff with a `lastSyncAt = now` fallback silently excluded everything older than the first sync — so only brand-new activity imported. For v1, prefer **re-scan a bounded recent window every time + dedup by a stable key** over clever incremental logic.
- **Plan for slowness up front.** Any sync that pages an external API and does per-item sub-fetches is slow. Page and sub-fetch in **bounded-concurrency batches** (we used 6) and set `export const maxDuration = 300` from the start — don't wait for the 504.

## Phase 3 — Reuse PRIM's proven patterns (don't reinvent)
- **Anthropic structured output:** copy the EXACT working invocation from `import-prospects-ai`: `client.messages.stream({ ..., system: [{type:'text', text, cache_control:{type:'ephemeral'}}], output_config:{ format:{ type:'json_schema', schema } } })` then `await stream.finalMessage()`. Non-streaming `messages.create` with `output_config` errored. Model is `claude-haiku-4-5`. (Vision + `output_config` HANGS — for images use fenced-JSON prompting instead.)
- **API-route auth:** mirror an existing route — bearer→`getUser` (see `sync-after-checkout` / `apiAuth.requireUserId`), service-role client for `user_kv`, never return/log the secret.
- **Client → authed API call:** get the token via `supabase.auth.getSession()` → `data.session?.access_token`. Don't call a helper unless you've confirmed it's in scope (see runtime-error note below).
- **Secrets:** store third-party API keys in `user_kv` written/read **only** server-side; never return them to the client after entry, never log them.

## Phase 4 — Verify like it's production (where the time was actually lost)
- **Build passing ≠ working.** These are all runtime-only and pass `next build`:
  - dynamic `import()` of a non-existent module/export,
  - an undefined variable in a code path that isn't always taken (`getBearer is not defined` — the killer here),
  - external API method/path/field/format mismatches,
  - non-streaming-vs-streaming AI invocation differences.
- **Smoke-test the whole chain on REAL data before handing off.** A feature like this is a chain: auth → external call → parse → dedup → AI → merge → display. One end-to-end run on a real record surfaces these faster than user round-trips. When you can't run it (needs the user's key/session), say so and make the first user test a deliberate diagnostic.
- **Surface real errors immediately.** A generic "could not extract" hid `getBearer is not defined` for several rounds. When a feature crosses an unverified boundary, have the failure path show the actual status + error string in the toast from the start — that one change ended the guessing.
- **Test the AI prompt in isolation.** Spawning a subagent with the exact prompt + a real transcript confirmed the extraction logic was correct, which ruled out the prompt and pointed at the plumbing. Do this early to split "AI logic" bugs from "wiring" bugs.
- **UI gotchas seen here:** toasts must portal above modals (high z-index) or you can't read the feedback; detail/modal views must read the **live** record from the source array by id, not a stale snapshot, or updates won't appear; `<input type="datetime-local">` needs exactly `YYYY-MM-DDTHH:mm` — normalize AI/ISO datetimes (strip seconds/zone, space→T).

---

## TextDrip bug chain (the actual sequence, for reference)
1. Client used **GET** → 405 (API is POST + JSON body).
2. Contact lookup hit **`/get-contact`** → 404 (real path `/get-contact-detail`).
3. Read **`dob`/`zip`** → blank (real keys `birthdate`/`zipcode`); also `age` written to a hidden field instead of the visible `dobs`.
4. **Incremental cutoff** excluded all-but-newest activity.
5. Sequential paging → **504 timeout** (fixed with batched-parallel + maxDuration 300).
6. AI route used non-streaming `messages.create` → errored (use `stream().finalMessage()`).
7. Button called **`getBearer()`** which only existed inside the sync function → `not defined`.
8. Detail modal showed a **stale snapshot** so the extracted appointment didn't appear.
9. Toast rendered **behind the modal**; appointment datetime needed format normalization.

Every one passed `next build`. The diagnostic toast (surfacing the real error) was the turning point.
