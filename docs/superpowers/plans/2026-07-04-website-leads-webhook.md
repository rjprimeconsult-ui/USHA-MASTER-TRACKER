# Website Leads (Universal Form Webhook) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. **Read the spec first:** [docs/superpowers/specs/2026-07-04-website-leads-webhook-design.md](../specs/2026-07-04-website-leads-webhook-design.md).

**Goal:** A per-agent public webhook (`POST /api/webforms/webhook/<token>`) that turns any external website form submission into a Prospect (`source: "Web Lead"`), with heuristic-first/AI-fallback extraction, raw-payload preservation, a needs-review flag, and ingress dedup.

**Architecture:** Clone the proven Ringy vendor-webhook shape (token in `profiles`, always-200, CAS-retry upsert into `user_kv.prospects_v1`) minus everything Ringy-specific (no blast detection, no disposition mapping). All parsing/extraction/upsert logic is pure and TDD'd in `src/lib/webforms.mjs`; the route stays a thin I/O shell. Settings UI clones the RingySettings card pattern.

**Tech Stack:** Next.js 16 route handlers (nodejs runtime) · Supabase service-role · `node --test` for `.mjs` logic · Anthropic Haiku for the AI fallback via the already-shipped `@anthropic-ai/sdk`. **Zero new npm dependencies.**

---

## Ground rules (every task)

1. Work on branch `website-leads` (Task 0). Commit per task. NEVER push to `main` (auto-deploys prod). PR at the end.
2. **NEVER modify** `src/app/api/ringy/**`, `src/app/api/benepath/**`, `src/app/api/blast/**`, or `increment_blast` (protected capture path — 2026-07-01 incident).
3. Zero new dependencies — `package.json` unchanged.
4. Never log payload values (PHI discipline) — aggregate counts/keys only, same as the Ringy route.
5. `npm test` (= `node --test src/lib/*.test.mjs`) green; `npm run build` ends `✓ Compiled successfully`; `npx eslint <changed files>` adds no NEW error categories (repo has known purity/set-state noise).
6. Both themes for UI work (dark = `.dark` class; standard slate/white classes auto-remap via globals.css).

## File structure

**Created:**
- `supabase/webforms-migration.sql` — one column + unique index (Juan runs in Supabase; feature no-ops harmlessly until run).
- `src/lib/webforms.mjs` + `src/lib/webforms.test.mjs` — ALL pure logic (flatten, extract, raw block, prospect build, dedup upsert, AI prompt builder).
- `src/app/api/webforms/webhook/[token]/route.js` — public capture route (thin shell).
- `src/app/api/webforms/config/route.js` — token + stats for the signed-in agent.
- `src/components/WebformsSettings.jsx` — settings card.

**Modified:**
- `src/components/views/ProspectsView.jsx` — mount the settings card next to RingySettings (~line 716 pattern) + needsReview chip on the kanban card + in the detail modal.
- `src/lib/announcements.js` — What's-New entry (last task).

---

## Task 0: Branch setup

- [ ] **Step 1:** `cd "C:/Users/juant/OneDrive/Desktop/AI TREJO/CPA TRACKER FODLER/USHA-MASTER-TRACKER" && git checkout main && git pull && git checkout -b website-leads`
- [ ] **Step 2:** `npm run build` → expect `✓ Compiled successfully` before any change.

## Task 1: Migration file

**Files:** Create `supabase/webforms-migration.sql`

- [ ] **Step 1:** Write the migration (follow the header-comment style of existing files in `supabase/`):

```sql
-- Website Leads (universal form webhook) — adds the per-agent webhook token.
-- Run in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS everywhere).
-- The token is read/written ONLY by service-role API routes (webforms config +
-- webhook); no RLS change is needed because profiles' existing policies do not
-- grant clients access to this column path (same posture as ringy_webhook_token).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS webforms_webhook_token text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_webforms_webhook_token_key
  ON profiles (webforms_webhook_token)
  WHERE webforms_webhook_token IS NOT NULL;
```

- [ ] **Step 2:** Commit: `git add supabase/webforms-migration.sql && git commit -m "Webforms: migration for profiles.webforms_webhook_token"`
- [ ] **Step 3:** Note for the controller/user: **Juan must run this in Supabase before live testing** (the code degrades gracefully until then: config GET will error-report, webhook token lookups simply never match).

## Task 2: Pure logic — `src/lib/webforms.mjs` (STRICT TDD)

**Files:** Create `src/lib/webforms.test.mjs` FIRST, then `src/lib/webforms.mjs`.

The module exports: `flattenRecord`, `normalizeBody`, `extractWebformFields`, `buildRawBlock`, `buildWebformProspect`, `upsertWebformProspect`, `buildWebformAiPrompt`, `WEBFORM_MAX_RAW_CHARS`.

**⚠️ SELF-CONTAINED module — do NOT import from `prospects.js`.** Verified: `src/lib/prospects.js` has extensionless imports (`./utils`, `./constants`) that only resolve under the Next/webpack build — importing it from an `.mjs` under `node --test` fails with `ERR_MODULE_NOT_FOUND`. The repo's established precedent for exactly this situation is `src/lib/ringy.mjs`, which is deliberately dependency-free ("NO imports from the project"). Follow it: `webforms.mjs` imports nothing from the project.
- Build the prospect object inline, mirroring `newProspect()`'s field set (`src/lib/prospects.js:75-111` — copy the field list into a comment-pinned literal; note "MIRRORS newProspect() — if that factory gains fields, add them here" the way ringy.mjs documents its mirrored shapes).
- Implement a local `webformDedupKey(p)` mirroring `prospectDedupKey` (`prospects.js:222`: phone digits → email lowercase → name lowercase), with ONE deliberate improvement for webform traffic: when the phone normalizes to 11 digits starting with `1`, strip the leading `1` (websites commonly send `+1` E.164 numbers while existing prospects store 10 digits — without this, `+13055551234` would never dedup against `3055551234`). Document the divergence in a comment.
- Do NOT reuse prospects.js' `HEADER_MAP`/`detectFieldFromHeader` — besides being unimportable, its CSV-oriented patterns (`/^date$/→lastContact`, `/^status$/→stage`) would mis-map arbitrary webform keys. Use the webform-specific synonym sets below, with the metadata ignore-list applied FIRST.
- `normalizeBody(contentType, rawText)` is a pure function here (so the spec §8 "three encodings" line is unit-tested): `application/json` → JSON.parse (throw→null), `application/x-www-form-urlencoded` → URLSearchParams→object; returns null when unparseable. Multipart stays in the route (needs `req.formData()`, not text) and is covered by the Task 7 curl checks.

- [ ] **Step 1: Write the failing tests** — `src/lib/webforms.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenRecord, normalizeBody, extractWebformFields, buildRawBlock,
  buildWebformProspect, upsertWebformProspect, buildWebformAiPrompt,
} from './webforms.mjs';

const NOW = '2026-07-04T18:00:00.000Z';

// ---- flattenRecord: nested JSON → flat {key: string} record ----
test('flattenRecord flattens one level of nesting and stringifies scalars', () => {
  assert.deepEqual(
    flattenRecord({ name: 'Jo', form: { phone: 3055551234, ok: true }, tags: ['a', 'b'] }),
    { name: 'Jo', 'form.phone': '3055551234', 'form.ok': 'true', tags: 'a, b' }
  );
});
test('flattenRecord tolerates null/undefined and skips empty values', () => {
  assert.deepEqual(flattenRecord({ a: '', b: null, c: undefined, d: 'x' }), { d: 'x' });
  assert.deepEqual(flattenRecord(null), {});
});

// ---- normalizeBody: pure body-encoding normalization ----
test('normalizeBody parses JSON and urlencoded; null on garbage', () => {
  assert.deepEqual(normalizeBody('application/json', '{"a":"1"}'), { a: '1' });
  assert.deepEqual(normalizeBody('application/x-www-form-urlencoded; charset=UTF-8', 'your-name=Ana+Diaz&email%5B%5D=ana%40x.com'), { 'your-name': 'Ana Diaz', 'email[]': 'ana@x.com' });
  assert.equal(normalizeBody('application/json', 'not json'), null);
});

// ---- extractWebformFields: heuristic mapping ----
test('maps the MANUS-style payload with high confidence, no AI needed', () => {
  const r = extractWebformFields({
    first_name: 'John', last_name: 'Smith', email: 'john@example.com',
    phone: '+13055551234', source: 'website', submitted_at: '2026-07-07T14:30:00Z',
  });
  assert.equal(r.fields.name, 'John Smith');
  assert.equal(r.fields.email, 'john@example.com');
  assert.equal(r.fields.phone, '+13055551234');
  assert.equal(r.confident, true);
  // metadata keys (source, submitted_at) are NOT mapped into prospect fields:
  assert.equal(r.fields.source, undefined);
});
test('maps bracketed/hyphenated keys (your-name, email[], phone_number)', () => {
  const r = extractWebformFields({ 'your-name': 'Ana Diaz', 'email[]': 'ana@x.com', phone_number: '9545550000' });
  assert.equal(r.fields.name, 'Ana Diaz');
  assert.equal(r.fields.email, 'ana@x.com');
  assert.equal(r.fields.phone, '9545550000');
  assert.equal(r.confident, true);
});
test('message/comments land in situation; unknown keys are left for the raw block', () => {
  const r = extractWebformFields({ name: 'Bo', email: 'b@x.com', message: 'Need family coverage', favorite_color: 'red' });
  assert.match(r.fields.situation, /Need family coverage/);
  assert.equal(r.fields.favorite_color, undefined);
});
test('name but NO phone/email → not confident', () => {
  const r = extractWebformFields({ full_name: 'Solo Name', comments: 'hi' });
  assert.equal(r.confident, false);
});
test('phone but no name → not confident (needs review, still extracted)', () => {
  const r = extractWebformFields({ phone: '3051112222' });
  assert.equal(r.fields.phone, '3051112222');
  assert.equal(r.confident, false);
});

// ---- buildRawBlock ----
test('buildRawBlock renders Label: value lines and truncates at the cap', () => {
  const block = buildRawBlock({ name: 'Jo', 'form.phone': '305' });
  assert.match(block, /— Website form submission —/);
  assert.match(block, /name: Jo/);
  const big = buildRawBlock({ k: 'x'.repeat(20000) });
  assert.ok(big.length <= 4200); // WEBFORM_MAX_RAW_CHARS + header slack
});

// ---- buildWebformProspect ----
test('builds a Web Lead prospect; raw block appended to situation; flag only when unsure', () => {
  const flat = { name: 'Jo Lee', email: 'jo@x.com' };
  const conf = buildWebformProspect(extractWebformFields(flat), flat, NOW);
  assert.equal(conf.source, 'Web Lead');
  assert.equal(conf.stage, 'PENDING_DECISION');
  assert.equal(conf.crm, 'None');
  assert.match(conf.situation, /Website form submission/);
  assert.ok(!conf.needsReview);

  const flat2 = { phone: '3051112222' };
  const unsure = buildWebformProspect(extractWebformFields(flat2), flat2, NOW);
  assert.equal(unsure.needsReview, true);
  assert.equal(unsure.name, 'Web Lead — needs review'); // never a blank name
});

// ---- upsertWebformProspect: dedup + fill-empty + re-submission touch ----
test('no match → appended as new', () => {
  const { list, created } = upsertWebformProspect([], buildWebformProspect(extractWebformFields({ name: 'A', phone: '111' }), { name: 'A', phone: '111' }, NOW), NOW);
  assert.equal(list.length, 1);
  assert.equal(created, true);
});
test('E.164 +1 phone dedups against the stored 10-digit number', () => {
  const existing = [{ id: 'p1', name: 'Jo', phone: '3055551234', archivedAt: null, touchLog: [] }];
  const flat = { name: 'John Smith', phone: '+13055551234', email: 'j@x.com' };
  const { created } = upsertWebformProspect(existing, buildWebformProspect(extractWebformFields(flat), flat, NOW), NOW);
  assert.equal(created, false);
});

test('phone match → no duplicate; fill-empty; re-submission touch appended with real schema', () => {
  const existing = [{ id: 'p1', name: 'Ana D', phone: '3055550000', email: '', situation: 'old notes', archivedAt: null, touchLog: [] }];
  const incoming = buildWebformProspect(
    extractWebformFields({ name: 'Ana Diaz', phone: '(305) 555-0000', email: 'ana@x.com' }),
    { name: 'Ana Diaz', phone: '(305) 555-0000', email: 'ana@x.com' }, NOW
  );
  const { list, created } = upsertWebformProspect(existing, incoming, NOW);
  assert.equal(created, false);
  assert.equal(list.length, 1);
  const p = list[0];
  assert.equal(p.name, 'Ana D');            // existing value wins
  assert.equal(p.email, 'ana@x.com');       // blank got filled
  const t = p.touchLog[p.touchLog.length - 1];
  assert.equal(t.channel, 'Other');
  assert.equal(t.outcome, 'Other');
  assert.match(t.note, /Submitted your website form again/);
  assert.equal(t.at, NOW);
  assert.ok(t.id);
});
test('archived prospects are NOT dedup matches', () => {
  const existing = [{ id: 'p1', name: 'A', phone: '111', archivedAt: '2026-01-01', touchLog: [] }];
  const { created } = upsertWebformProspect(existing, buildWebformProspect(extractWebformFields({ name: 'A', phone: '111' }), { name: 'A', phone: '111' }, NOW), NOW);
  assert.equal(created, true);
});

// ---- AI prompt builder (pure; the network call lives in the route) ----
test('buildWebformAiPrompt embeds the payload and demands the fixed JSON shape', () => {
  const p = buildWebformAiPrompt({ weird_field: 'John | j@x.com | 305-111-2222' });
  assert.match(p, /weird_field/);
  assert.match(p, /"name"/);
  assert.match(p, /single lead/i);
});
```

- [ ] **Step 2: Run to verify FAIL** — `npm test` → module-not-found failures for `./webforms.mjs`.
- [ ] **Step 3: Implement `src/lib/webforms.mjs`** to make every test pass. Implementation notes (follow the spec §4–§5 exactly):
  - `flattenRecord(obj)`: one level of nesting → dotted keys; arrays → `join(', ')`; everything `String()`ed and trimmed; drop empty values; return `{}` for non-objects.
  - Key normalization for matching: lowercase, strip `[]`, `-`, `_`, `.`, spaces (so `your-name`, `form.phone`, `email[]` match).
  - Synonym sets per spec §4 step 1 (name/first+last join, email, phone, state, zip, message→situation). **Metadata ignore-list** (mapped to nothing, still shown in the raw block): `source, submitted_at, submittedat, timestamp, formid, formname, form_name, page, pageurl, url, referrer, useragent, ip, token`.
  - `confident` = name AND (phone OR email) found.
  - `buildRawBlock(flat)`: header `— Website form submission —` + `key: value` lines, total capped at `WEBFORM_MAX_RAW_CHARS = 4000` (truncate with `…`).
  - `buildWebformProspect(extraction, flat, nowIso)`: builds the full prospect literal inline (self-contained — see the module warning above), mirroring `newProspect()`'s field set: id (crypto.randomUUID), name/phone/email/state/zip/timezone, `indvOrFamily:'Indv'`, dobs/income/quoteSize `''`, `quotes:[]`, policyType/meds `''`, situation, startDate `''`, `source:'Web Lead'`, referrer/leadVendor `''`, `crm:'None'`, `stage:'PENDING_DECISION'`, appointmentTime/nextSteps/lastContact `''`, `custom:{}`, `createdAt:nowIso`, `archivedAt:null`, `convertedLeadId:null`, `touchLog:[]`, `stageEnteredAt:nowIso`, `cadence:{stepIndex:0,nextDueAt:null,snoozedUntil:null,completedAt:null}`. Appends raw block to `situation` (after any extracted message + blank line), `needsReview: true` when not confident, fallback name `'Web Lead — needs review'` when name empty.
  - `upsertWebformProspect(list, incoming, nowIso)`: compute the local `webformDedupKey` for incoming (phone digits with the 11-digit leading-1 strip → email lowercase → name lowercase); find first non-archived existing whose key matches; on match: fill-empty fields (existing wins), append the touch `{ id: crypto.randomUUID(), at: nowIso, channel: 'Other', outcome: 'Other', note: 'Submitted your website form again' }` **directly** (spec §5 forbids `logTouch()` — it advances cadence + clears reminders); return `{ list, created: false, prospectId }`. No match: `{ list: [...list, incoming], created: true, prospectId }`.
  - `buildWebformAiPrompt(flat)`: lean single-record prompt: "Extract ONE lead from this website form submission… return ONLY JSON `{"name":"","phone":"","email":"","state":"","zip":"","situation":""}`, empty strings for unknowns, never invent values." Payload embedded as the `key: value` lines.
- [ ] **Step 4: Run to verify PASS** — `npm test` → all pass (existing ~395 + these).
- [ ] **Step 5: Commit** — `git add src/lib/webforms.mjs src/lib/webforms.test.mjs && git commit -m "Webforms: pure extraction/upsert logic, self-contained like ringy.mjs (TDD)"`

## Task 3: Webhook route

**Files:** Create `src/app/api/webforms/webhook/[token]/route.js`

- [ ] **Step 1: Read the Ringy route once** (`src/app/api/ringy/webhook/[token]/route.js`) — you are cloning its shell: `dynamic='force-dynamic'`, `runtime='nodejs'`, `cleanEnv`, `noop200`/`ok200`, async `ctx.params` await (Next 16!), service-role client, token→userId lookup, the CAS write loop against `user_kv` (`prospects_v1`), aggregate-only logging. **Drop entirely:** the blast increment, disposition mapping, ringy_config load.
- [ ] **Step 2: Implement.** Flow:
  1. `await ctx.params` → token; missing → `noop200()`.
  2. Env + admin client (copy pattern). Token lookup on `profiles.webforms_webhook_token`; error or no row → `noop200()` (no oracle).
  3. **Body parsing (3 encodings) — read the body exactly ONCE:** if `content-type` starts with `multipart/form-data` → `await req.formData()`, keep only string values (skip File parts; cap each value at 8KB). Otherwise → `const text = (await req.text()).slice(0, 65536)` (the 64KB cap) then `normalizeBody(contentType, text)` from `webforms.mjs`. `normalizeBody` returning null (garbage) → proceed with `{ _raw: text.slice(0, 4000) }` so even an unparseable body becomes a reviewable prospect. (Never call `req.json()` after `req.text()` — the body stream can only be consumed once.)
  4. `flattenRecord` → `extractWebformFields`.
  5. **AI fallback only if `!confident`:** the repo already ships `@anthropic-ai/sdk` (that's what `import-prospects-ai/route.js:367` uses — `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`), so use the SDK (zero-new-deps holds): `client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 500, messages: [{ role: 'user', content: buildWebformAiPrompt(flat) }] })` wrapped in try/catch with a `Promise.race` 8-second timeout (or the SDK's `timeout` option). (If you prefer raw `fetch` instead, the required headers are `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json` against `https://api.anthropic.com/v1/messages` — but the SDK is simpler and already the codebase convention.) Parse the JSON out of the reply defensively (first `{...}` match). Merge any non-empty AI fields into the extraction (heuristic finds win over AI); result stays `confident:false` → needsReview per spec. AI failure/timeout → continue with what heuristics found (raw preservation covers the rest).
  6. `buildWebformProspect` → load `user_kv` `prospects_v1` → `upsertWebformProspect` → **CAS write with the same compare-and-swap retry loop the Ringy route uses** (copy it: re-read on conflict, 5 attempts, backoff `40*attempt` ms).
  7. AFTER the prospect write: best-effort update of `user_kv` key `webforms_config_v1` → `{ lastReceivedAt: now, receivedCount: (n||0)+1 }` (fire-and-forget; failure only logged).
  8. `ok200({ created, needsReview })`. Every failure path above → `noop200()`. Log lines may include userId + counts + whether AI ran — never values.
- [ ] **Step 3: Build + lint** — `npm run build` → compiled; `npx eslint` the new file.
- [ ] **Step 4: Commit** — `"Webforms: public capture route (3 encodings, heuristics→AI→raw, CAS upsert)"`.

## Task 4: Config route

**Files:** Create `src/app/api/webforms/config/route.js`

- [ ] **Step 1:** Adapt `src/app/api/ringy/config/route.js` (read it once): same `generateToken()` (secure-RNG ×2 → 32 hex chars, throw if no crypto — never Math.random), same auth approach (it uses an inline auth+clients helper; reuse that shape or `requireUserId` from `src/lib/apiAuth.js` + a service-role client — pick one, be consistent).
  - **GET:** ensure token exists on `profiles.webforms_webhook_token` (generate + save if null); read `webforms_config_v1` stats; return `{ webhookUrl: \`${origin}/api/webforms/webhook/${token}\`, connected: (receivedCount||0) > 0, lastReceivedAt, receivedCount }`.
  - **POST `{ regenerateToken: true }`:** write a fresh token, return the new URL. (No other settings exist — keep it minimal, YAGNI.)
- [ ] **Step 2:** Build + eslint + commit — `"Webforms: config route (token issue/regenerate + stats)"`.

## Task 5: Settings card + mount

**Files:** Create `src/components/WebformsSettings.jsx`; Modify `src/components/views/ProspectsView.jsx`

- [ ] **Step 1:** Read `src/components/RingySettings.jsx` + its mount in ProspectsView (~line 716, lazy `RingySettingsSection` wrapper) — copy the card look (premium-card, dark-mode classes) and the lazy-mount pattern.
- [ ] **Step 2:** Build `WebformsSettings.jsx`:
  - Loads `GET /api/webforms/config` via `authedFetch` on open.
  - Shows the URL in a read-only input + **Copy** button; **Regenerate** button with `ConfirmDialog` (warn: "Your old webhook URL will stop capturing immediately — update your website after regenerating.").
  - Status line: `Waiting for your first lead…` or `Last lead received <toLocaleString> · <n> total`.
  - **Send a test lead** button: client `fetch(webhookUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name:'Test Lead (Website Leads)', email:'test@primtracker.com', phone:'', message:'Sent from the Send-a-test-lead button in PRIM settings — safe to archive.' }) })`, then refetch config and show "Test lead created — check your Prospects board ✓".
  - Collapsible cheat-sheet (plain text list): Webflow → native form webhook; Typeform/JotForm → Webhooks setting; WordPress → Gravity Forms/WPForms webhook add-on or CF7 webhook plugin; Wix/Squarespace → Zapier/Make "Webhooks: POST" step; custom sites/MANUS-built → POST JSON to the URL, any field names. Footer note: "Any tool that can POST a form to a URL works. No API key needed — the secret is in the URL."
- [ ] **Step 3:** Mount it in ProspectsView's settings area directly below the Ringy section, same lazy pattern, heading "Website Leads".
- [ ] **Step 4:** Build + eslint + commit — `"Webforms: settings card (URL, regenerate, test lead, cheat-sheet)"`.

## Task 6: needsReview chip

**Files:** Modify `src/components/views/ProspectsView.jsx`

- [ ] **Step 1:** Kanban card: where source/CRM tag chips render on a prospect card, add — only when `p.needsReview` — a small amber chip `Double-check` (`bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`, same chip sizing as neighbors, with `Tooltip` label "Imported from your website form — PRIM wasn't 100% sure it read every field right. Open and verify, then clear.").
- [ ] **Step 2:** Prospect detail modal: same chip near the stage/source chips in the header, plus a small `Mark reviewed` button that saves `needsReview: false` through the existing prospect-update path (find how the detail modal persists edits and use exactly that).
- [ ] **Step 3:** Verify no behavior change for prospects without the field (undefined → chip absent). Build + eslint + commit — `"Webforms: needs-review chip on card + detail with one-click clear"`.

## Task 7: Announcement + final verification

- [ ] **Step 1:** Add `ANNOUNCEMENTS` entry to `src/lib/announcements.js` (match existing shape/tone; id `2026-07-04-website-leads`): title like "Your website is now a lead source", body: connect any website form to PRIM with your personal webhook URL (Prospects → Settings → Website Leads) — every submission becomes a Prospect automatically, duplicates are caught, and PRIM flags anything it wasn't sure about.
- [ ] **Step 2:** Full checks: `npm test` (all green), `npm run build`, `git diff main -- package.json` (empty), `git diff main --stat -- src/app/api/ringy src/app/api/benepath src/app/api/blast` (EMPTY — protected paths untouched).
- [ ] **Step 3:** Local end-to-end (needs Juan to have run the migration; otherwise defer to preview): start dev, GET config as a signed-in user (or hit the settings card), then:
  - `curl -X POST <url> -H 'Content-Type: application/json' -d '{"first_name":"John","last_name":"Smith","email":"john@example.com","phone":"+13055551234","source":"website"}'` → `{ok:true, created:true}`, prospect "John Smith" appears, NO review chip.
  - Same payload again → `{ok:true, created:false}`, still one prospect, timeline shows "Submitted your website form again".
  - `curl -X POST <url> --data 'your-name=Ana+Diaz&email%5B%5D=ana%40x.com'` (urlencoded) → created.
  - `curl -X POST <url> -d '{"blob":"???"}' -H 'Content-Type: application/json'` → flagged raw prospect with the payload in notes.
  - Random token URL → 200 `{ok:false}`, nothing created.
- [ ] **Step 4:** Commit, push branch, open PR titled `"Website Leads: universal form webhook → Prospects"` (body: spec link, what it does, the migration Juan must run, verification notes, and a reminder line: "decide on an `[announce]`-tagged Slack deploy at ship time (in-app What's-New entry included)"; ⚠️ merging deploys prod). Do NOT merge.

## Notes for the executor
- `webforms.mjs` is SELF-CONTAINED (no project imports) — the `ringy.mjs` precedent. `prospects.js` cannot be imported under `node --test` (extensionless internal imports); do not try.
- Web-form traffic is low-volume (a visitor at a time) — the CAS loop is belt-and-suspenders, and the 8s AI call in-request is acceptable here (unlike the Ringy burst path, where nothing extra may run before capture — different route, and that rule still stands there).
- If `prospects_v1` doesn't exist yet for a user (brand-new agent), treat as empty list and create the key — check how the Ringy route handles the missing-row case and mirror it.
