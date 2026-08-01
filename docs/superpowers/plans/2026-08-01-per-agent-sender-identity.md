# Per-Agent Sender Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every email an entitled agent sends through PRIM carries that agent's own identity (name, business, NPN, mailing address, contact email) — enforced by a server-side gate, rendered by tokenized templates, routed through a verified-domain "own" lane or PRIM's shared lane, and gathered up front by a setup walkthrough.

**Architecture:** One pure whitelist/gate module (`senderGate.mjs`) feeds three consumers (browser load/save, the send route's reader, the status route) so they cannot disagree. Template identity moves from hardcoded constants into tokens resolved per sender at render time (`outreachTemplateCopy.mjs`, node-testable, re-exported through `outreachEmails.js` so callers don't change). Domain status routes mail (own vs shared lane) and never blocks. Queued mail is rescheduled, never terminally failed, on setup errors.

**Tech Stack:** Next.js 16 App Router (plain JS), Supabase `user_kv`, Resend API, two test lanes: `npm test` (node --test, `src/lib/*.test.mjs`) and `npm run test:ui` (Vitest+RTL+jsdom, `src/**/*.test.jsx`).

**Spec (authoritative):** `docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md` (rev 6). On any conflict between this plan and the spec, the spec wins — stop and flag it.

**Hard rules for every task:**
1. Never touch `src/app/api/ringy`, `benepath`, `blast`, or `increment_blast` paths (blast capture).
2. Never modify `src/lib/ticketEmails.js`, `src/lib/welcomeEmails.js`, `src/app/api/reminders/route.js` (exempt system mail, spec §4).
3. Both test lanes green after every task: `npm run test:all` (node lane 583+new, ui lane 50+new).
4. The Write tool must never emit control bytes — after editing any file run:
   `node -e "const b=require('fs').readFileSync(process.argv[1]);let n=0;for(const c of b)if(c===0||(c<9)||(c>13&&c<32))n++;console.log('ctrl:',n)" <file>` and expect `ctrl: 0`.
5. Node lane files: `.mjs`, relative imports carry explicit extensions, no framework deps. (`.js` modules with explicit-extension imports also load — `featureFlags.test.mjs` imports `featureFlags.js`.)
6. Commit after every task with the exact message given. No pushes until Task 11.
7. Zero-API-call assertions in the ui lane need `await act(async () => {})` first or they cannot fail.

---

## File map

| File | Action | Owns |
|---|---|---|
| `src/lib/senderGate.mjs` | **Create** | THE whitelist (`sanitizeSenderIdentity`), `missingFields`, `evaluate`, `selectLane`, `buildFromHeaders`, `staleLiteralViolation` |
| `src/lib/senderGate.test.mjs` | **Create** | node-lane tests for all of the above |
| `src/lib/resendDomains.js` | **Create** | Resend `/domains` lookup, 5-min cache, `domainStatusFor` |
| `src/lib/resendDomains.test.mjs` | **Create** | node-lane tests, injected fetch |
| `src/lib/outreachTemplateCopy.mjs` | **Create** | tokenized template copy + `renderShell(sender)` + `buildTemplateCopy` + core render (pure) |
| `src/lib/outreachTemplateCopy.test.mjs` | **Create** | absence/presence assertions — the §0 regression guard |
| `src/lib/outreachEmails.js` | Modify | becomes metadata registry + wrapper re-exporting the pure core; storage helpers stay |
| `src/lib/postSaleEmails.js` | Modify | `loadSenderIdentity`/`saveSenderIdentity` → `sanitizeSenderIdentity`, 8 fields |
| `src/lib/postSaleEmails.identity.test.jsx` | **Create** | ui-lane round-trip with mocked storage |
| `src/lib/legalConfig.mjs` | Modify | `canSpamFooterHtml`/`canSpamFooterStandaloneHtml` accept `sender` |
| `src/lib/legalConfig.sender.test.mjs` | **Create** | footer renders agent identity with `sender`, `LEGAL` without |
| `src/lib/postSaleHtml.js` | Modify | `renderPostSaleHtml` accepts + threads `sender` |
| `src/lib/pendingEmailQueue.js` | Modify | add `reschedulePending`, `HELD_MAX_AGE_MS` |
| `src/app/api/email/send/route.js` | Modify | discriminated reader, gate, lanes, stale guard, sender into renders |
| `src/app/api/email/sender-status/route.js` | **Create** | per-kind `missing`/`complete` + domain status |
| `src/lib/featureFlags.js` | Modify | `outreach_emails.requiredTier` `'team'` → `'pro'` |
| `src/lib/featureFlags.test.mjs` | Modify | pin the new outreach tier matrix |
| `src/components/PendingEmailQueueRunner.jsx` | Modify | reschedule on 428/503, 72h expiry, audit on failure, held toast |
| `src/components/PendingEmailQueueRunner.test.jsx` | **Create** | ui-lane queue-protection tests |
| `src/components/Profile.jsx` | Modify | `SenderSection` new fields, preview, status row, entitlement scope, `initialSection` prop |
| `src/components/LeadTracker.jsx` | Modify | `prim:open-profile` listener (9.0), checklist stats + `openSenderSetup` action (10.3) |
| `src/components/SendOutreachEmail.jsx` | Modify | identity load (tri-state), sender-aware render, named-field disable |
| `src/components/SendWelcomeEmail.jsx` | Modify | preview gets `sender`, named-field disable |
| `src/components/SenderSetupPrompt.jsx` | **Create** | post-upgrade walkthrough modal (trigger 1) |
| `src/components/PaywallGate.jsx` | Modify | mount `SenderSetupPrompt` after successful sync |
| `src/lib/setupChecklist.js` + `src/components/SetupChecklist.jsx` + `src/components/views/Dashboard.jsx` | Modify | entitlement-scoped sender task (trigger 3) |
| `src/components/SenderSetup.test.jsx` | **Create** | ui-lane walkthrough/checklist scoping tests |

---

### Task 0: Branch + baseline

- [ ] **Step 0.1:** `git -C . status --short` — expect only the spec + this plan untracked/modified. `git branch --show-current` — note it.
- [ ] **Step 0.2:** `git add docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md docs/superpowers/plans/2026-08-01-per-agent-sender-identity.md && git commit -m "docs: sender identity spec (rev 6) + implementation plan"`
- [ ] **Step 0.3:** `git checkout -b feature/sender-identity`
- [ ] **Step 0.4:** `npm run test:all` → node lane **583 pass**, ui lane **50 pass**, both exit 0. `npm run build` → succeeds. If not, STOP — baseline is broken, do not proceed.

### Task 1: `senderGate.mjs` — the pure core (TDD)

**Files:** Create `src/lib/senderGate.mjs`, `src/lib/senderGate.test.mjs`.

- [ ] **Step 1.1: Write the failing test file first** — `src/lib/senderGate.test.mjs`, node-lane conventions (`import test from 'node:test'; import assert from 'node:assert/strict';` — copy header style from `src/lib/followupDraftCache.test.mjs`). Cover, minimum:
  - `sanitizeSenderIdentity`: preserves all **eight** fields; caps enforced (fromName 200, fromAddress 254, businessName 200, mailingAddress 300, npn 20, signatureName 200, signatureTitle 120, bannerUrl 500); absent/null/undefined → `''` (a stored **number** coerces via `String()` — `{npn: 19153319}` → `'19153319'`, deliberately); idempotent (`sanitize(sanitize(x))` deep-equals `sanitize(x)`).
  - `missingFields` precedence: empty identity + kind `'outreach'` → exactly `['from_name','from_address','business_name','mailing_address','npn']` in that order; kind `'post-sale'` → same minus `npn`; **never contains a domain entry**; a blank `fromName` with all else filled → `['from_name']` (the "My name is , …" guard); `mailingAddressOrPlaceholder()`'s placeholder string (import from `./legalConfig.mjs`) as `mailingAddress` **must still count as missing** — add a `PLACEHOLDER_RE` check or equality check in the implementation; this is the original ticket-#3 bug asserted directly.
  - `evaluate`: `{kind:'welcome'}` → `{ok:true}` regardless of readerResult; `readerResult:{ok:false,reason:'threw'}` → `{ok:false,status:503,setupRequired:'identity_unavailable'}`; **`reason:'absent'` → 428 `from_name`** (empty identity's first gap); **`reason:'invalid', identity: <full row with bad address>` → 428 `from_address`** — the reader CARRIES the row it read, so an agent with every field filled and a typo'd address is told about the address, not told to add a name already on screen (spec §6 reader trap, and the binding invariant: `evaluate(...).setupRequired === missingFields(identityUsed, kind)[0]` for every non-threw case); complete identity → `{ok:true,identity}`; **every refusal carries a non-empty `error` string**.
  - `selectLane`: `'verified'`→`'own'`; `'unverified'`→`'shared'`; `'unknown'`→`'shared'` (mutation-critical — assert explicitly).
  - `buildFromHeaders`: own lane → `From: "Name <contact>"`, replyTo contact; shared lane → From uses the mailbox inside `globalFrom` (`'PRIM <mail@primtracker.com>'` → `mail@primtracker.com`), **replyTo = identity.fromAddress, not fallbackReplyTo**, display name = identity.fromName; identityless (welcome) → fallbackName + fallbackReplyTo; bare `globalFrom` without angle brackets works.
  - `staleLiteralViolation`: payload containing `'Julio Fernandez'` with a Mike identity → returns the literal; same payload with Julio's identity (`signatureName:'Julio Fernandez'`, `businessName:'Prime Health Consultants'`, `npn:'19153319'`, `mailingAddress:'1550 Sawgrass Corporate Pkwy, Sunrise, FL 33323'`, `fromAddress:'julio.fernandez@rjprimehealth.com'`) → `null` for all five of his literals; clean payload → `null`; `'phc-banner'` never exempt for Mike.
- [ ] **Step 1.2:** `npm test` → new file FAILS with "Cannot find module … senderGate.mjs". Existing 583 still pass.
- [ ] **Step 1.3: Implement `src/lib/senderGate.mjs`** — complete module:

```js
/**
 * Sender-identity gate — pure logic shared by /api/email/send, the
 * sender-status route, and the browser load/save path. No fetch, no env,
 * no imports beyond legalConfig's placeholder constant: everything arrives
 * as arguments so the node test lane exercises every branch.
 *
 * Spec: docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md §3.1, §5, §6.
 */

import { mailingAddressOrPlaceholder } from './legalConfig.mjs';

export const IDENTITY_FIELD_CAPS = {
  fromName: 200,
  fromAddress: 254,
  businessName: 200,
  mailingAddress: 300,
  npn: 20,
  signatureName: 200,
  signatureTitle: 120,
  bannerUrl: 500,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(addr) {
  return EMAIL_RE.test(String(addr || '').trim());
}

// THE whitelist (spec §3.1). Three call sites — postSaleEmails load, save,
// and the route's user_kv reader — one projection. A field added here is
// added everywhere; a field missing here silently vanishes on save AND
// makes the gate refuse every send, which is why there is only one.
export function sanitizeSenderIdentity(raw) {
  const out = {};
  for (const [field, cap] of Object.entries(IDENTITY_FIELD_CAPS)) {
    out[field] = String(raw?.[field] ?? '').slice(0, cap).trim();
  }
  return out;
}

// Per-kind required fields in report order. npn is outreach-only. Domain
// status is deliberately absent — it routes (selectLane), it never blocks.
export function missingFields(identity, kind) {
  const id = identity || {};
  const blank = (v) => !String(v || '').trim();
  const missing = [];
  if (blank(id.fromName)) missing.push('from_name');
  if (!isValidEmail(id.fromAddress)) missing.push('from_address');
  if (blank(id.businessName)) missing.push('business_name');
  // The legal-pages placeholder can never satisfy the requirement — the
  // literal string shipping in a commercial email is ticket #3.
  if (blank(id.mailingAddress) || id.mailingAddress === mailingAddressOrPlaceholder()) {
    missing.push('mailing_address');
  }
  if (kind === 'outreach' && blank(id.npn)) missing.push('npn');
  return missing;
}

const FIELD_ERRORS = {
  from_name: 'Add your name in Profile → Sender before sending.',
  from_address: 'Add a valid contact email in Profile → Sender before sending.',
  business_name: 'Add your business name in Profile → Sender before sending.',
  mailing_address: 'Add your business mailing address in Profile → Sender before sending.',
  npn: 'Add your NPN in Profile → Sender before sending outreach.',
};

/**
 * The gate. `readerResult` is the route reader's discriminated result:
 *   { ok: true,  identity }                    — row read + sanitized
 *   { ok: false, reason: 'threw' }             — transient (Supabase error)
 *   { ok: false, reason: 'absent' }            — no row stored
 *   { ok: false, reason: 'invalid', identity } — row read, fromAddress bad;
 *                                                the row RIDES ALONG so the
 *                                                refusal names the address,
 *                                                not fields already filled
 * Only 'threw' is transient. Everything else evaluates whatever identity is
 * available and reports the FIRST missing field (spec §6 reader trap).
 */
export function evaluate({ kind, readerResult }) {
  if (kind === 'welcome') return { ok: true, identity: null };
  if (readerResult && readerResult.ok === false && readerResult.reason === 'threw') {
    return {
      ok: false, status: 503, setupRequired: 'identity_unavailable',
      error: 'Could not load your sender settings — please try again shortly.',
    };
  }
  const identity = (readerResult && readerResult.identity) || {};
  const missing = missingFields(identity, kind);
  if (missing.length) {
    const setupRequired = missing[0];
    return { ok: false, status: 428, setupRequired, error: FIELD_ERRORS[setupRequired] };
  }
  return { ok: true, identity };
}

// Domain status routes mail, never blocks it (§5): 'own' ONLY on 'verified'.
// 'unknown' (lookup failed) rides shared — an outage reroutes mail, it can
// never send From an unverified domain and never stops a send.
// (Deliberate deviation from the spec's illustrative sketch
// `selectLane(fromAddress, domainStatus)` — the address contributed nothing;
// domainStatusFor already consumed it.)
export function selectLane(domainStatus) {
  return domainStatus === 'verified' ? 'own' : 'shared';
}

/**
 * From/Reply-To for both lanes; replaces route.js's inline if/else.
 * fallbackName/fallbackReplyTo serve ONLY the identityless welcome path
 * (request fromName + profile.email — today's behavior, kept exactly).
 */
export function buildFromHeaders({ identity, lane, globalFrom, fallbackName = '', fallbackReplyTo = '' }) {
  const g = String(globalFrom || '');
  const sharedMailbox = (g.match(/<([^>]+)>/) || [])[1] || g;
  const name = String(identity?.fromName || '').trim() || String(fallbackName || '').trim() || 'PRIM';
  const contact = String(identity?.fromAddress || '').trim();
  if (lane === 'own' && contact) {
    return { fromHeader: `${name} <${contact}>`, replyTo: contact };
  }
  return {
    fromHeader: `${name} <${sharedMailbox}>`,
    replyTo: contact || String(fallbackReplyTo || '').trim(),
  };
}

// Stale-bundle guard (§6): strings that exist only in the pre-tokenization
// bundle. A hit is EXEMPT when the literal is a substring of one of the
// sending agent's own gate-validated identity values — Julio Fernandez is a
// real agent whose correct identity legitimately renders five of the six;
// without the exemption every send he makes is refused forever.
export const RETIRED_LITERALS = [
  'Julio Fernandez',
  'Prime Health Consultants',
  '19153319',
  '1550 Sawgrass',
  'rjprimehealth.com',
  'phc-banner',
];

export function staleLiteralViolation({ subject, body, html }, identity) {
  const hay = [subject, body, html].map((s) => String(s || '')).join('\n');
  const ownValues = Object.values(identity || {}).map((v) => String(v || '')).filter(Boolean);
  for (const lit of RETIRED_LITERALS) {
    if (!hay.includes(lit)) continue;
    if (ownValues.some((v) => v.includes(lit))) continue;
    return lit;
  }
  return null;
}
```

- [ ] **Step 1.4:** `npm test` → all pass (583 + new). Fix until green.
- [ ] **Step 1.5: Mutation checks (each: break → RED → restore → GREEN):** (a) drop `from_name` from `missingFields`; (b) make `selectLane` return `'own'` on `'unknown'`; (c) delete the exemption loop in `staleLiteralViolation`; (d) remove one field from `IDENTITY_FIELD_CAPS`; (e) remove one literal from `RETIRED_LITERALS` (spec §12). All five must go red.
- [ ] **Step 1.6:** `git add src/lib/senderGate.mjs src/lib/senderGate.test.mjs && git commit -m "feat(sender): pure sender gate — whitelist, missing-field gate, lane selection, stale guard"`

### Task 2: `resendDomains.js` (TDD)

**Files:** Create `src/lib/resendDomains.js`, `src/lib/resendDomains.test.mjs`.

- [ ] **Step 2.1: Failing tests** — injected `fetchImpl` + injected `now`; `__resetDomainCacheForTests()` in a `beforeEach`-style call at the top of each test. Cover: only `status === 'verified'` rows counted (`pending`/`failed`/`not_started` ignored); domain matching is exact + case-insensitive (`Mike@HealthServicesPro.com` verified when set has `healthservicespro.com`; `mail.healthservicespro.com` NOT verified when only the apex is in the set); malformed address (`'no-at-sign'`, `''`) → `'unknown'`; fetch throws → `{ok:false}` → `domainStatusFor` → `'unknown'`, never `'verified'`; non-200 response → `{ok:false}`; missing `RESEND_API_KEY` env → `{ok:false}` (set/delete `process.env.RESEND_API_KEY` inside the test, restore after); **cache:** second call inside 5 min with a throwing fetchImpl still returns `{ok:true}` (cache hit); call at `now + TTL + 1` re-fetches; **a failed lookup is never cached** (failure then success with working fetch → success).
- [ ] **Step 2.2:** `npm test` → new file fails (module missing).
- [ ] **Step 2.3: Implement:**

```js
/**
 * Verified-domain lookup against Resend. SERVER-ONLY (reads RESEND_API_KEY).
 * Source of truth is Resend's own domain list (spec §5): Juan verifies in
 * the dashboard, PRIM reflects. Module-memory cache, 5-minute TTL, success
 * only — a failure is never cached, so one bad call can't stick.
 */

const TTL_MS = 5 * 60 * 1000;
let cache = null; // { domains: Set<string>, at: number }

export async function listVerifiedDomains({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return { ok: true, domains: cache.domains };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false };
  try {
    const r = await fetchImpl('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return { ok: false };
    const data = await r.json();
    const domains = new Set(
      (Array.isArray(data?.data) ? data.data : [])
        .filter((d) => d?.status === 'verified')
        .map((d) => String(d.name || '').toLowerCase())
        .filter(Boolean)
    );
    cache = { domains, at: now };
    return { ok: true, domains };
  } catch {
    return { ok: false };
  }
}

// Tri-state (spec §5): 'verified' | 'unverified' | 'unknown'. The two
// non-verified states send identically (shared lane) but the status UI
// must tell them apart — "ask Juan to verify" vs "couldn't check".
export function domainStatusFor(addr, result) {
  if (!result || result.ok !== true) return 'unknown';
  const domain = String(addr || '').split('@')[1]?.trim().toLowerCase();
  if (!domain) return 'unknown';
  return result.domains.has(domain) ? 'verified' : 'unverified';
}

export function __resetDomainCacheForTests() { cache = null; }
```

- [ ] **Step 2.4:** `npm test` → green. **Step 2.5:** `git add src/lib/resendDomains.* && git commit -m "feat(sender): Resend verified-domain lookup with 5-min success-only cache"`

### Task 3: Widen the browser whitelists via the shared sanitizer

**Files:** Modify `src/lib/postSaleEmails.js` (lines ~320-346: `DEFAULT_SENDER_IDENTITY`, `loadSenderIdentity`, `saveSenderIdentity`). Create `src/lib/postSaleEmails.identity.test.jsx` (ui lane — the module imports `./storage`, so it cannot load in the node lane).

- [ ] **Step 3.1: Failing ui-lane test** — `vi.mock('./storage', ...)` with an in-memory Map implementing `getItem`/`setItem`. Assert: save→load round-trips **all eight fields** sanitized (the shared sanitizer trims — use whitespace-free fixtures); a legacy stored value `{"fromName":"J","fromAddress":"j@x.com"}` loads with the six new fields as `''` (no migration needed); saving `{fromName:'New'}` over a stored full identity **does not wipe** the other seven (load-merge is the caller's job via Profile state — assert save writes exactly what it is given, sanitized).
- [ ] **Step 3.2:** `npx vitest run src/lib/postSaleEmails.identity.test.jsx` → fails (new fields stripped).
- [ ] **Step 3.3: Implement** — in `postSaleEmails.js`: `import { sanitizeSenderIdentity } from './senderGate.mjs';`, `DEFAULT_SENDER_IDENTITY = sanitizeSenderIdentity({})`; `loadSenderIdentity` returns `sanitizeSenderIdentity(parsed)`; `saveSenderIdentity` computes `const safe = sanitizeSenderIdentity(identity)` and stores it. Delete the two-field literal objects entirely — the sanitizer is the only projection.
- [ ] **Step 3.4:** `npm run test:all` → green both lanes. **Step 3.5: Mutation check:** revert `saveSenderIdentity` to the old two-field literal → Step-3.1 test red → restore → green.
- [ ] **Step 3.6:** `git add src/lib/postSaleEmails.js src/lib/postSaleEmails.identity.test.jsx && git commit -m "feat(sender): 8-field identity via single shared sanitizer (silent-wipe guard)"`

### Task 4: Footer threading (`legalConfig` → `postSaleHtml`)

**Files:** Modify `src/lib/legalConfig.mjs`, `src/lib/postSaleHtml.js` (`renderPostSaleHtml` signature at :231 and the `canSpamFooterHtml` call at :289). Create `src/lib/legalConfig.sender.test.mjs`.

- [ ] **Step 4.1: Failing node tests:** `canSpamFooterHtml({unsubscribeUrl, sender})` with `sender = {businessName:'HealthServicesPro', mailingAddress:'1550 Sawgrass Corporate Expressway, Sunrise FL 33323', fromAddress:'mike@healthservicespro.com'}` renders the business name, the address, and the fromAddress as contact — and renders **neither** `LEGAL.company` **nor** the `[mailing address — to be added]` placeholder. Without `sender` (or `sender: null`) output is **byte-identical to the current** `canSpamFooterHtml({unsubscribeUrl})` (capture the current output string in the test BEFORE modifying, as a fixture constant). Same pair of assertions for `canSpamFooterStandaloneHtml`. Then: `renderPostSaleHtml({...minimal fixture..., sender})` contains the sender's business name + address; without `sender` it contains `LEGAL.company` — **these two assertions go in a ui-lane file** (`src/lib/postSaleHtml.sender.test.jsx`): `postSaleHtml.js:17` imports `./agentProfile` extensionlessly, so the module cannot load in the node lane (verified: `ERR_MODULE_NOT_FOUND`).
- [ ] **Step 4.2:** Run → red. **Step 4.3: Implement** — `canSpamFooterHtml({ unsubscribeUrl, sender } = {})`: when `sender?.businessName && sender?.mailingAddress`, render those (HTML-escaped — **add a small escape helper**; `legalConfig.mjs` has none today) and `sender.fromAddress` as the mailto contact; otherwise the existing `LEGAL` markup untouched. `canSpamFooterStandaloneHtml({ unsubscribeUrl, sender } = {})` passes `sender` through. `renderPostSaleHtml({ ..., sender })` adds the param and passes it at :289.
- [ ] **Step 4.4:** `npm run test:all` green. **Step 4.5:** `git add src/lib/legalConfig.mjs src/lib/postSaleHtml.js src/lib/legalConfig.sender.test.mjs src/lib/postSaleHtml.sender.test.jsx && git commit -m "feat(sender): thread sender identity through the CAN-SPAM footer chain"`

### Task 5: Tokenize the outreach templates (the §0 fix)

**Files:** Create `src/lib/outreachTemplateCopy.mjs` + `src/lib/outreachTemplateCopy.test.mjs`. Modify `src/lib/outreachEmails.js`.

**Design:** `outreachTemplateCopy.mjs` is pure (only import: `OUTREACH_UNSUBSCRIBE_PLACEHOLDER` from `./legalConfig.mjs`). It receives ALL identity-bearing content moved from `outreachEmails.js`, with the spec §7.3 replacements applied. `outreachEmails.js` keeps: `OUTREACH_TEMPLATES` (metadata only), `getOutreachTemplate`, `renderOutreachTemplate` (now sender-requiring, delegating to the core), `appendProspectEmailEntry`, the storage helpers — so `SendOutreachEmail.jsx` and `outreachReminders.js` import paths do not change.

- [ ] **Step 5.1: Failing tests** (`outreachTemplateCopy.test.mjs`). Fixtures: `JULIO` (the five real values from Task 1.1) and `MIKE = { fromName:'Mike Tolentino', fromAddress:'mike@healthservicespro.com', businessName:'HealthServicesPro', mailingAddress:'1550 Sawgrass Corporate Expressway, Sunrise FL 33323', npn:'88113311', signatureName:'Michael Tolentino', signatureTitle:'Owner, HealthServicesPro', bannerUrl:'' }`. For EVERY template id × MIKE, on the object returned by `renderOutreachTemplateCore(meta, {name:'Ana Diaz', email:'ana@x.com'}, MIKE, {})`:
  - `subject`, `html`, **and `text`** each contain **none of**: `Julio Fernandez`, `Prime Health Consultants`, `19153319`, `1550 Sawgrass Corporate Pkwy`, `rjprimehealth.com`, `phc-banner` — asserting on all three parts is the exact guard rev 2 of the spec failed;
  - `html` and `text` contain `Michael Tolentino`, `HealthServicesPro`, `NPN: 88113311`, Mike's mailing address, and a `mailto:mike@healthservicespro.com` CTA; `subject` contains `HealthServicesPro` for template 1;
  - `html` contains **no `<img`** (bannerUrl blank → banner block omitted, not an empty tag); with `bannerUrl:'https://x.com/b.jpg'` the img renders with that src and `alt` containing `HealthServicesPro`; with `bannerUrl:'javascript:alert(1)'` **no img renders** (https-only validation);
  - `signatureTitle:''` → no empty title line in html (no `Owner,` literal anywhere) and no blank line between name and email in `text`;
  - prospect tokens still work: `Hello Ana,` present; empty prospect name → `Hello,`;
  - the preheader div contains the template's `previewText` (non-empty);
  - the unsubscribe sentinel `OUTREACH_UNSUBSCRIBE_PLACEHOLDER` present when no `unsubscribeUrl` passed;
  - `renderOutreachTemplateCore(meta, prospect, {}, {})` and with incomplete sender (`missingFields(sender,'outreach').length > 0`) → **`null`**;
  - "Licensed Independent Insurance Agency" and "within the next two hours" still present verbatim (spec §7.4 — deliberately unchanged, pinned so a well-meaning edit is visible);
  - `TEMPLATE_META` has the same three ids (`phc-outreach-1-initial`, `-2-followup`, `-3-final`) in the same order, and each entry has NO `subject`/`bodyHtmlInner`/`bodyText` keys (metadata split enforced).
  **Lane note:** all Step-5.1 assertions target `outreachTemplateCopy.mjs` exports directly — call `renderOutreachTemplateCore(meta, prospect, MIKE, {})` (four positional args), NOT `renderOutreachTemplate`. The wrapper `outreachEmails.js` imports `./storage` extensionlessly and **cannot load in the node lane** (verified: `ERR_MODULE_NOT_FOUND`). Its assertions — import-doesn't-throw, `OUTREACH_TEMPLATES` ids/order preserved, wrapper `renderOutreachTemplate(meta, prospect, {sender})` delegates correctly — go in a **ui-lane** file created this task: `src/lib/outreachEmails.registry.test.jsx` (vitest collects `src/**/*.test.jsx`; mock `./storage` like Task 3 does).
- [ ] **Step 5.2:** Run → red. **Step 5.3: Implement `outreachTemplateCopy.mjs`:** move `escapeHtml`, `firstNameOf`, `applyTokens` from `outreachEmails.js` verbatim, then extend `applyTokens(str, prospect, sender)` with sender tokens — `{business_name}`, `{signature_name}` (default `sender.fromName`), `{signature_title_line_html}` / `{signature_title_line_text}` (whole line incl. trailing `<br/>` / `\n`, empty when `signatureTitle` blank), `{npn}`, `{mailing_address}`, `{from_address}`. Move the three body/text constants and template copy, applying spec §7.3 exactly — every row of the table, including `:211` (the `EMAIL_1_TEXT` body opener), the three text closings, the subject of template 1, and `BANNER_ALT` → `{business_name}`. Move `renderShell` and rework: `renderShell({ sender, subject, previewText, pillLabel, bodyInner, ctaLabel, ctaSubject, unsubscribeUrl })` — banner block included only when `sender.bannerUrl` starts with `https://` (attr-escaped); signature = `{signature_name}` + optional title line + `sender.fromAddress` link; CTA mailto = `sender.fromAddress`; footer = businessName / `Licensed Independent Insurance Agency · NPN: {npn}` / mailingAddress / consent line / unsubscribe. Export `TEMPLATE_META` (three entries: id, name, description, previewText, pillLabel, ctaLabel, ctaSubject), `buildTemplateCopy(templateId, sender)` → `{subject, bodyHtmlInner, bodyText}` (tokens resolved via `applyTokens(str, prospect, sender)` at render), and `renderOutreachTemplateCore(meta, prospect, sender, opts)` implementing the current `renderOutreachTemplate` contract but returning `null` unless `missingFields(sender,'outreach')` is empty — import `missingFields` from `./senderGate.mjs`. **Delete the six constants; nothing may default them.**
- [ ] **Step 5.4: Rewire `outreachEmails.js`:** delete the six constants, the bodies, `renderShell`, `escapeHtml`, `firstNameOf`, `applyTokens`; `OUTREACH_TEMPLATES = TEMPLATE_META` (imported); `renderOutreachTemplate(template, prospect, opts = {})` delegates to the core with `opts.sender`. Rewrite the stale header comment (lines 1-19) and the `:328-330` "shell stays static" comment — both are now false. Keep `getOutreachTemplate`, `appendProspectEmailEntry`, storage helpers untouched.
- [ ] **Step 5.5:** `npm run test:all` → **expect the FollowupNextStep/ui suites still green and the node lane green.** `npm run build` → succeeds (catches any missed import). **Step 5.6: Mutation checks:** (a) restore the literal `Julio Fernandez` inside the moved signature markup → absence test red; (b) skip the `:211` replacement in `EMAIL_1_TEXT` → the `text` absence assertion red — this is the exact miss the spec's round-3 review caught; restore → green.
- [ ] **Step 5.7:** `git add src/lib/outreachTemplateCopy.* src/lib/outreachEmails.js src/lib/outreachEmails.registry.test.jsx && git commit` with message `feat(sender): tokenize outreach templates — no hardcoded agent identity anywhere in subject/html/text` and a body noting: **from this commit until Task 9 lands, the outreach modal renders picker-only with Send disabled** (its single caller `SendOutreachEmail.jsx:72` passes no sender yet, so `renderOutreachTemplate` returns null and `{rendered && …}` hides the preview). Expected mid-branch state, never deployed — not a regression to debug.

### Task 6: The send route — reader, gate, lanes, stale guard

**Files:** Modify `src/app/api/email/send/route.js`. No new test files (the logic is Task-1-tested; the wiring is verified by build + Task 11 live pass).

- [ ] **Step 6.1:** Imports: add `evaluate, selectLane, buildFromHeaders, staleLiteralViolation, sanitizeSenderIdentity, isValidEmail` from `@/lib/senderGate.mjs` and `listVerifiedDomains, domainStatusFor` from `@/lib/resendDomains`.
- [ ] **Step 6.2: Reader → discriminated result** (replace :292-312): same query; produce `readerResult`:
  - query throws → `{ ok:false, reason:'threw' }` (keep the `console.warn`);
  - no row / empty value → `{ ok:false, reason:'absent' }`;
  - row present → `identity = sanitizeSenderIdentity(raw)`; if `!isValidEmail(identity.fromAddress)` → `{ ok:false, reason:'invalid', identity }` (**the row rides along** — the gate reports the bad address, not fields already filled) else `{ ok:true, identity }`.
- [ ] **Step 6.3: Gate** — immediately after the reader (before the From construction):

```js
  const gateResult = evaluate({ kind, readerResult });
  if (!gateResult.ok) {
    return Response.json(
      { error: gateResult.error, setupRequired: gateResult.setupRequired },
      { status: gateResult.status }
    );
  }
  const senderIdentity = gateResult.identity; // null only for kind 'welcome'
```

- [ ] **Step 6.4: Stale-bundle guard** (outreach only, right after the gate):

```js
  if (kind === 'outreach') {
    const staleHit = staleLiteralViolation({ subject: safeSubject, body: safeBody, html: safeHtml }, senderIdentity);
    if (staleHit) {
      return Response.json({
        error: 'Please reload PRIM and try again — this page is running an outdated version.',
        setupRequired: 'stale_client',
      }, { status: 428 });
    }
  }
```

- [ ] **Step 6.5: Lanes** — replace the whole `senderOverride`/`fromHeader` if/else (:314-325) with:

```js
  const globalFrom = process.env.RESEND_FROM_ADDRESS || 'PRIM <onboarding@resend.dev>';
  // Domain status routes, never blocks (spec §5): verified own domain sends
  // From the agent's address; anything else — including a failed lookup —
  // rides PRIM's shared verified domain with the agent's name + reply-to.
  // 'welcome' has no identity and always rides shared with today's fallbacks.
  let lane = 'shared';
  let domainStatus = 'unknown';
  if (senderIdentity) {
    domainStatus = domainStatusFor(senderIdentity.fromAddress, await listVerifiedDomains());
    lane = selectLane(domainStatus);
  }
  const { fromHeader, replyTo } = buildFromHeaders({
    identity: senderIdentity,
    lane,
    globalFrom,
    // Today's exact welcome-path fallback chain (route.js:322) — preserved
    // verbatim per spec §5: request fromName, then the email local-part.
    fallbackName: (fromName || (profile.email || '').split('@')[0] || '').trim(),
    fallbackReplyTo: profile.email,
  });
```

- [ ] **Step 6.6: Sender into the renders** — pass `sender: senderIdentity` into the `renderPostSaleHtml({...})` call (:361 region); change `ensureUnsubscribeFooter(html, unsubscribeUrl, { alreadyHasFooter })` → `ensureUnsubscribeFooter(html, unsubscribeUrl, { alreadyHasFooter, sender: senderIdentity })` and inside it call `canSpamFooterStandaloneHtml({ unsubscribeUrl, sender })`. Update the resolution-order comment block (:286-291) — it describes the deleted fallback order.
- [ ] **Step 6.7:** `npm run build` → succeeds. `npm run test:all` → green. Trace by hand (write the trace in the commit body): a Pro agent with complete identity + unverified domain sending post-sale → gate ok → lane shared → From `Name <shared>`, replyTo their address → footer carries their business + address. **Step 6.8:** `git add src/app/api/email/send/route.js && git commit -m "feat(sender): gate + two-lane From construction + stale-bundle guard in send route"`

### Task 7: Queue protection

**Files:** Modify `src/lib/pendingEmailQueue.js`, `src/components/PendingEmailQueueRunner.jsx`. Create `src/components/PendingEmailQueueRunner.test.jsx`.

- [ ] **Step 7.1:** `pendingEmailQueue.js` — add (complete):

```js
export const HELD_MAX_AGE_MS = 72 * 60 * 60 * 1000; // spec §6.1: stale post-sale mail is worse than none

/**
 * Push a pending item's fire time forward WITHOUT stamping firedAt —
 * markFired cannot do this (it always stamps, which pruneCompleted then
 * uses to delete the row 24h later). Used when the send route answers
 * 428/503 sender-setup: the item stays pending, visible, and retryable.
 */
export async function reschedulePending(id, { scheduledAt, heldReason } = {}) {
  const q = await loadQueue();
  const next = {
    items: q.items.map(it => it.id === id && it.status === 'pending'
      ? { ...it, scheduledAt: scheduledAt ?? it.scheduledAt, heldReason: heldReason || undefined }
      : it
    ),
  };
  await saveQueue(next);
}

export function isExpiredHold(item, now = Date.now()) {
  return item.status === 'pending' && !!item.heldReason && (now - item.enqueuedAt) > HELD_MAX_AGE_MS;
}
```

  Update the shape comment (:18-20) to include `heldReason?`.
- [ ] **Step 7.2: Runner changes** (`PendingEmailQueueRunner.jsx`):
  - In the fire path, **before** POSTing, expiry check: `if (isExpiredHold(item, now))` → `markFired(item.id, { status:'failed', error:'expired while sender setup incomplete' })` **and** `onAuditEntry(lead.id, {...auditShape, status:'failed', error:'expired while sender setup incomplete'})`, then continue to next item.
  - Response handling: `if (!res.ok)` splits — `if ((res.status === 428 || res.status === 503) && data?.setupRequired && data.setupRequired !== 'stale_client')` → `await reschedulePending(item.id, { scheduledAt: Date.now() + 15 * 60 * 1000, heldReason: data.setupRequired })` (**placed so a throw inside it cannot fall into the outer `catch` that marks `failed`** — wrap the reschedule in its own try/catch that only logs); else → existing `markFired failed` **plus** `onAuditEntry(..., { status:'failed', error })`.
  - Add `onAuditEntry` to **all four** existing failure `markFired` sites (:96, :104, :138, :157 today) — audit shape mirrors the success entry minus messageId, plus `status:'failed'` and `error`.
  - Toast: held items (`heldReason` set) are **excluded from the per-item countdown list** and collapse into ONE summary toast: `"{n} email{s} waiting on sender setup"` + an "Open Profile → Sender" button whose action is exactly `window.dispatchEvent(new CustomEvent('prim:open-profile', { detail: { section: 'sender' } }))` — **the listener lands in Step 9.0**, so from this task's commit until Task 9 the button dispatches into the void (note this dead-action window in Step 7.5's commit body, like the Task 5→9 window). Precedent for the event pattern: LeadTracker.jsx:362 already listens for `prim:profile-saved`.
- [ ] **Step 7.3: Failing ui tests first** (write before 7.2 where practical; TDD applies — at minimum run them red against the unmodified runner): mock `./storage` (in-memory) and `fetch`. Assert: **(a)** 428 `{setupRequired:'business_name'}` → item still `status:'pending'`, `scheduledAt` pushed ≥ 14 min, `heldReason:'business_name'`, `markFired` NOT called (spy); **(b)** 503 `{setupRequired:'identity_unavailable'}` → same reschedule path (mutation-critical: let 503 fall to `failed` → red); **(c)** 500 → `failed` + `onAuditEntry` called with `status:'failed'`; **(d)** item with `heldReason` and `enqueuedAt` 73h ago → `failed` + audit entry, no POST fired (`await act(async () => {})` before asserting zero fetch calls); **(e)** held item renders the summary toast, not a countdown; two held items → one toast saying `2`; **(f)** a `reschedulePending` that throws does NOT mark the item failed.
- [ ] **Step 7.4:** `npm run test:all` → green (node 583+, ui 50+new). **Step 7.5:** `git add src/lib/pendingEmailQueue.js src/components/PendingEmailQueueRunner.*` and commit with message `feat(sender): queue reschedules on setup 428/503, 72h expiry with audit, held-summary toast` and a body noting the toast button dispatches `prim:open-profile` which has no listener until Task 9 (expected mid-branch dead action, never deployed).

### Task 8: Outreach tier Team → Pro

**Files:** Modify `src/lib/featureFlags.js` (:93), `src/lib/featureFlags.test.mjs`.

- [ ] **Step 8.1: Failing test first** — add assertions: `subscription_tier:'pro'` active → `outreach_emails` canAccess **true**; `'team'` → true; `'starter'` → false; run `npm test` → the new pro assertion FAILS against `requiredTier:'team'`.
- [ ] **Step 8.2:** Change `requiredTier: 'team'` → `requiredTier: 'pro'` and update the entry's comment (the "Team only / upgrade incentive from Pro" rationale is superseded by Juan's 2026-07-29 "Pro can use any email feature"). Run `npm test` → green.
- [ ] **Step 8.3:** `git add src/lib/featureFlags.* && git commit -m "feat(sender): outreach emails move Team+ -> Pro+ (operator decision 2026-07-29)"`

### Task 9: Status route + send-surface UI

**Files:** Create `src/app/api/email/sender-status/route.js`. Modify `src/components/Profile.jsx` (SenderSection), `src/components/LeadTracker.jsx` (open-profile mechanism), `src/components/SendOutreachEmail.jsx`, `src/components/SendWelcomeEmail.jsx`. Extend `src/components/SenderSetup.test.jsx` (created here).

- [ ] **Step 9.0: The "open Profile → Sender" mechanism — prerequisite for 7.2's toast action, 9.2/9.3's CTAs, and Task 10.** Nothing like it exists today (`Profile({ open, onClose })` at Profile.jsx:100, section in private state `useState('identity')` at :104; sole mount `LeadTracker.jsx:2717`). Build it once:
  - `Profile` gains an `initialSection` prop; on `open` becoming true, `setActive(initialSection || 'identity')`.
  - `LeadTracker.jsx` adds a listener effect: `window.addEventListener('prim:open-profile', handler)` where the handler does `setProfileInitialSection(e.detail?.section || 'identity'); setShowProfile(true);` (new state `profileInitialSection`, passed to `<Profile initialSection=… />` at :2717). Cleanup on unmount.
  - Any component anywhere can then `window.dispatchEvent(new CustomEvent('prim:open-profile', { detail: { section: 'sender' } }))` — this exact call is what 7.2, 9.2, 9.3, 10.1 and 10.3 use.
- [ ] **Step 9.1: Status route** — auth via **`import { requireUserId } from '@/lib/apiAuth'`** (apiAuth.js:40 — the helper spec §9 names; `send/route.js`'s `getUserId` is file-local and not importable). Contract: `const auth = await requireUserId(req); if (auth instanceof Response) return auth; const userId = auth;` (copy the usage from `src/app/api/tickets/route.js:11`). Service client: copy `getServiceClient` locally like other routes do. GET handler: load the caller's `user_kv` identity via the same reader shape as Task 6.2 (inline is fine — `sanitizeSenderIdentity` does the work); respond
  `{ fromAddress, domain, domainStatus, missing: { 'post-sale': missingFields(id,'post-sale'), outreach: missingFields(id,'outreach') }, complete: { 'post-sale': !missing…, outreach: !missing… } }`
  with `domainStatus` from `domainStatusFor(fromAddress, await listVerifiedDomains())`. 401 without auth. Reader threw → 503.
- [ ] **Step 9.2: `SenderSection`** (Profile.jsx:724): add the six new fields (Business name, Mailing address — `<textarea rows=2>`, NPN, Signature name `placeholder: defaults to From name`, Signature title, Banner URL `hint: optional, https only`) wired through the existing `updateIdentity` patch flow (state already round-trips whole objects — Task 3 made load/save carry them). Replace the amber "Domain verification required" warning block with a **status row** fetched from `/api/email/sender-status` on section mount (authed fetch — copy the bearer pattern from SendOutreachEmail): `verified` → green "Verified — mail sends from your own address"; `unverified` → slate "Not verified — mail sends from PRIM's address with replies going to you. Ask Juan to verify {domain} to send from it directly." + a "Request domain verification" button that opens the existing support-ticket compose prefilled (find how the ticket modal opens — grep `tickets` usage in components — and reuse; if no programmatic open exists, render a `mailto:` to `LEGAL.contactEmail` with prefilled subject as the fallback and note it); `unknown` → "Couldn't check right now — sending via PRIM's address." Update the preview block: From line shows the **lane-aware** From (own-domain address when verified, `PRIM shared` label otherwise), plus the signature/footer preview showing businessName, NPN line, mailingAddress. Update the SectionShell `description` — "Leave both fields blank to use the PRIM default" is now false; required-for-sending copy per spec §9.
  **Also in 9.2:** replace the Julio placeholder strings at Profile.jsx:748/:757 with neutral ones (`"Your name"` / a generic example address).
  **Entitlement scoping (D8, spec §9 — required, with its own test in 9.5):** `SECTIONS` is a module-scope const (Profile.jsx:79-86) where `subProfile` is not in scope — gate at the **consumer**: filter the sender entry out of the `SECTIONS.map` at :291, and gate the `active === 'sender'` render (:352-359); both on `canAccessBetaFeature('post_sale_emails', subProfile).canAccess || canAccessBetaFeature('outreach_emails', subProfile).canAccess` — Profile already holds `subProfile` via `useSubscription` at :102. A Starter agent sees no sender section at all.
  **Dark mode:** any new `bg-*/N` opacity utility must exist in the `globals.css` remap table (**:105-185** — slate/white at :105-115, amber and other tints at :153-185; `.dark .bg-amber-50\/60` already exists at :154) — check each class used, add remaps if missing, verify both themes in Task 11.
- [ ] **Step 9.3: `SendOutreachEmail.jsx`** — load identity: `const [sender, setSender] = useState(null); useEffect(() => { let alive = true; loadSenderIdentity().then(si => { if (alive) setSender(si); }); return () => { alive = false; }; }, []);` (import from `@/lib/postSaleEmails`). Pass `{ sender }` into `renderOutreachTemplate(template, prospect, { sender })`. Render states: `sender === null` → spinner/setup placeholder, no composer; `missingFields(sender,'outreach').length > 0` (import from `@/lib/senderGate.mjs`) → composer renders but preview area shows the setup card naming the missing fields + "Open Profile → Sender", Send disabled; complete → current behavior (`rendered` is non-null exactly then, per Task 5). Also surface a server 428 response's `setupRequired` in the error UI (map to the same field labels).
- [ ] **Step 9.4: `SendWelcomeEmail.jsx`** — same identity load; pass `sender` into the `renderPostSaleHtml({...})` preview call (:100) so preview matches the wire; disabled-Send + named-missing-field for kind post-sale (`missingFields(sender,'post-sale')`).
- [ ] **Step 9.5: ui tests** (`SenderSetup.test.jsx`, part 1): SenderSection blank fields → each specific warning visible and preview shows the typed businessName (not `LEGAL.company`); **SenderSection absent entirely for a Starter profile, present for Pro (the D8 test)**; SendOutreachEmail with incomplete mocked identity → Send disabled + `business name` named + **zero** `/api/email/send` calls (flush first); with complete identity → preview contains the identity, Send enabled.
- [ ] **Step 9.6:** `npm run test:all` green. `git add src/app/api/email/sender-status src/components/Profile.jsx src/components/LeadTracker.jsx src/components/SendOutreachEmail.jsx src/components/SendWelcomeEmail.jsx src/components/SenderSetup.test.jsx && git commit -m "feat(sender): status route, SenderSection full identity form, send surfaces gate-aware, open-profile event"`

### Task 10: Walkthrough triggers

**Files:** Create `src/components/SenderSetupPrompt.jsx`. Modify `src/components/PaywallGate.jsx`, `src/lib/setupChecklist.js`, `src/components/SetupChecklist.jsx`, `src/components/views/Dashboard.jsx`. Extend `src/components/SenderSetup.test.jsx`.

- [ ] **Step 10.1: `SenderSetupPrompt.jsx`** — small modal (reuse `GlassModal` from `./motion/MotionPrimitives` like SendOutreachEmail does): headline "You've unlocked email templates", one line "Set up your sender identity to start sending — your name, business, mailing address and NPN go on every email you send.", primary button "Set up now" (opens Profile → Sender via the same mechanism found in Task 9.2), secondary "Later". Props: `{ open, onClose, onOpenProfile }`. No storage writes — reappearing is fine because completion is derived, not tracked.
- [ ] **Step 10.2: Trigger 1 (upgrade success)** — `PaywallGate.jsx`. Precise mechanics (there is NO success branch today, and `refresh()` returns `undefined` — the closure's `profile` is pre-sync):
  - The sync effect is `:30-58` (`try { await syncAfterCheckout(sessionId); if (!alive) return; await refresh(); } finally {…}`). Add `setSyncedOk(true)` (new state) after the `refresh()` call inside the `try` — a thrown sync skips it.
  - New effect keyed on `[profile, syncedOk]`: when `syncedOk && profile` and (`canAccessBetaFeature('post_sale_emails', profile).canAccess || canAccessBetaFeature('outreach_emails', profile).canAccess`) — the OR mirrors spec §9.1; identical in practice after Task 8, but a future tier split must not silently break the prompt — load `loadSenderIdentity()` and if `missingFields(id, 'outreach').length > 0` set `showPrompt(true)`, guarded by a `useRef` so it fires once per mount. Add the `canAccessBetaFeature`, `loadSenderIdentity`, `missingFields` imports (none exist in the file today).
  - Insertion point: the `if (hasActiveSubscription(profile)) return children;` return (`:79`) becomes `return <>{children}<SenderSetupPrompt open={showPrompt} onClose={() => setShowPrompt(false)} onOpenProfile={() => window.dispatchEvent(new CustomEvent('prim:open-profile', { detail: { section: 'sender' } }))} /></>;`
- [ ] **Step 10.3: Trigger 3 (checklist)** — **the owner is `src/components/LeadTracker.jsx`, not Dashboard** (Dashboard receives `setupStats`/`onSetupAction` as props at Dashboard.jsx:70 and holds no profile; `deriveTasks` is called inside `SetupChecklist.jsx:57` from `stats`):
  - `deriveTasks` (setupChecklist.js) gains `emailEntitled = false, senderIdentityComplete = false` in its destructured param; when `emailEntitled`, append task `{ id:'sender', label:'Set up your email sender identity', detail:'Your name, business, mailing address and NPN go on every email PRIM sends for you.', actionLabel:'Set up sender', action:'openSenderSetup', done: senderIdentityComplete }`.
  - `LeadTracker.jsx`: `setupChecklistStats` (defined :2102) gains the two new keys — `emailEntitled` from the profile LeadTracker already holds for its `useBetaFeature`-style checks (compute via `canAccessBetaFeature('post_sale_emails', profile).canAccess || canAccessBetaFeature('outreach_emails', profile).canAccess` with whatever profile object feeds the existing entitlement checks in that file — find it, do not invent a new hook), and `senderIdentityComplete` from `loadSenderIdentity()` + `missingFields(id,'outreach').length === 0` (async — hold it in a small state loaded on mount and after `prim:open-profile` closes).
  - `onSetupAction` switch (:2289-2298) gains `case 'openSenderSetup': window.dispatchEvent(new CustomEvent('prim:open-profile', { detail: { section: 'sender' } })); break;`
  - `SetupChecklist.jsx` itself: no structural change — the new keys flow through `stats` into `deriveTasks`.
- [ ] **Step 10.4: ui tests** (part 2): Starter profile → no sender task in `deriveTasks` output and no prompt from PaywallGate flow (assert all four combinations of entitled × complete for the prompt: only entitled+incomplete shows); entitled+incomplete → task present, `done:false`; entitled+complete → `done:true`.
- [ ] **Step 10.5:** `npm run test:all` green. `git add src/components/SenderSetupPrompt.jsx src/components/PaywallGate.jsx src/lib/setupChecklist.js src/components/LeadTracker.jsx src/components/SenderSetup.test.jsx && git commit -m "feat(sender): setup walkthrough — upgrade prompt + entitlement-scoped checklist task"` (SetupChecklist.jsx and Dashboard.jsx are pass-throughs — no diff, not staged).

### Task 11: Full verification

- [ ] **Step 11.1:** `npm run test:all` — record both counts. `npm run build` — success. `npm run lint` — exit 0 (fix any NEW errors; do not touch pre-existing warnings).
- [ ] **Step 11.2:** Control-byte check on every created/modified file (rule 4).
- [ ] **Step 11.3:** Grep the repo for regressions: `grep -rn "Julio Fernandez\|19153319\|rjprimehealth\|1550 Sawgrass\|phc-banner\|Prime Health Consultants" src/ --include="*.js" --include="*.jsx" --include="*.mjs"` → expected hits ONLY in: `senderGate.mjs` (RETIRED_LITERALS), test fixtures, and `Profile.jsx` placeholders if not yet replaced (replace them: `placeholder="Julio Fernandez"` → `placeholder="Your name"`, the address placeholder → a neutral example). Anything else is a missed tokenization — fix before proceeding.
- [ ] **Step 11.4:** Push branch, wait for CI (runs on every branch push): both lanes + build + lint green.
- [ ] **Step 11.5:** Live verification on the Vercel Preview (needs Vercel SSO + PRIM login in the browser pane, like the drafts build): (a) Profile → Sender shows the new form + status row in BOTH themes; (b) with an incomplete identity, Send outreach shows the named missing field and the server answers 428 (check network tab); (c) complete the identity on the test account, send an outreach email to a test address — verify the received mail: From/Reply-To per lane, body signed with the test identity, footer shows business + address + NPN, no Julio anywhere, unsubscribe link works; (d) queue a post-sale email with incomplete identity → held summary toast appears, item stays pending.
- [ ] **Step 11.6:** Clean up any test artifacts in BOTH localStorage and Supabase (`storage.setItem` writes through to `user_kv`) — reset the test account's `email_sender_identity_v1` to its pre-test value **and clear the `pending_email_queue_v1` item that 11.5(d) deliberately queued** (both layers).

### Task 12: Final review gate — then STOP

- [ ] **Step 12.1:** Dispatch a fresh-context adversarial code review of the full branch diff against the spec (rev 6) — the repo's standard gate.
- [ ] **Step 12.2:** Fix findings; re-run `npm run test:all`.
- [ ] **Step 12.3: STOP. Do not merge.** Merging deploys to prod and activates the D3 hard block for every entitled agent (spec §10: Juan announces BEFORE the gate ships, runs the measure query, and gives the explicit merge go). Report status and hand back to Juan.

---

**Deliberately NOT in this plan** (spec-confirmed): per-agent template authoring, banner upload, mailbox confirmation (Phase 2, §14); `LEGAL.mailingAddress` on the legal pages; the two §7.4 copy claims (pinned unchanged by tests until Juan decides); anything touching the exempt system-mail files.
