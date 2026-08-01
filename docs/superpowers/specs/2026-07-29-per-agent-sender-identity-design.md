# Per-Agent Sender Identity & Verified Domains — Design Spec

**Date:** 2026-07-29
**Revision:** 6. Four adversarial review rounds against source (rev 1: 6 blocking findings, rev 2: 4, rev 3: 5, rev 5: 12 via a three-lens panel — all verified against code and folded in). **Rev 5 incorporated Juan's 2026-07-29 policy revision** (domain optional → two-lane sending §5, tier-entitled scope §1, setup walkthrough §9.1); **rev 6 folds in round-4's findings** — most notably a sender-name requirement (§6) and an identity exemption in the stale-bundle guard without which Julio Fernandez's own legitimate sends would have been permanently refused — **plus Juan's second decision: outreach moves from Team+ to Pro** ("Pro can use any email feature", §14 item 3).
**Status:** Awaiting Juan's review.
**Origin:** Support ticket #3 (michael.tolentino@healthservicespro.com, 2026-07-29, against prod `4fba142b0be0`).

**Phase 1 — this spec.** Per-agent sender identity, tokenized outreach templates, two-lane sending (own verified domain, or PRIM's shared domain with the agent's reply-to), CAN-SPAM footer per agent, sender-setup walkthrough.
**Phase 2 — deferred, its own spec.** Per-agent template *authoring* (Michael's "agents create their own HTML templates").

---

## 0. The live exposure that motivated the rewrite

Ticket #3 reports a footer. Investigating it found something bigger, **live in production on every outreach email PRIM sends**.

[`outreachEmails.js:26-31`](../../../src/lib/outreachEmails.js) hardcodes one agent's identity as module constants (banner, reply-to, company, address, NPN) — but that is only the surface. The same identity is written into the **copy itself**:

- [`:163`](../../../src/lib/outreachEmails.js) — the opening line of email 1: *"My name is **Julio Fernandez**, and I am the owner of **Prime Health Consultants**."*
- [`:279`](../../../src/lib/outreachEmails.js) — the subject: *"Health insurance quotes for you — Prime Health Consultants"*
- [`:225-230`](../../../src/lib/outreachEmails.js), [`:243-248`](../../../src/lib/outreachEmails.js), [`:265-270`](../../../src/lib/outreachEmails.js) — all three plain-text alternatives close with Julio's name, title, company, NPN and address
- [`:94-96`](../../../src/lib/outreachEmails.js), [`:103-105`](../../../src/lib/outreachEmails.js) — the HTML signature block and footer

So when any of the 23 agents sends outreach, the prospect receives a licensed-insurance solicitation signed by Julio Fernandez bearing NPN 19153319. **A wrong NPN on an insurance solicitation is a state-licensing matter, not a cosmetic bug.** *(Informational compliance flag — not legal advice. Flagged for human review.)*

Two precisions that matter for the design:

- **The `Reply-To` header is already correct** — [route.js:320-324](../../../src/app/api/email/send/route.js) sets it to the sending agent, falling back to their profile email. It is the in-body CTA mailto ([:85](../../../src/lib/outreachEmails.js)) and the signature link ([:96](../../../src/lib/outreachEmails.js)) that point at Julio. Reply reaches the right agent; the button does not.
- **The constants cannot simply be deleted.** `EMAIL_*_TEXT` interpolate them at module top level and `OUTREACH_TEMPLATES` ([:274](../../../src/lib/outreachEmails.js)) is evaluated at import, so deleting them throws a `ReferenceError` and takes outreach from *wrong* to *dead*. §7 handles this.

**Consequence for sequencing: §6 and §7 ship together.** Enforcing per-agent `From` addresses without fixing the body makes things worse — today a mismatched `From` and signature reads as a system bug; once the `From` genuinely says `mike@healthservicespro.com` while the body says *"Julio Fernandez, NPN 19153319"*, it reads as Mike's own claim about his license.

## 1. Problem

**Visible (the ticket):** `LEGAL.mailingAddress` is `''` ([legalConfig.mjs:12](../../../src/lib/legalConfig.mjs)), so `mailingAddressOrPlaceholder()` emits `[mailing address — to be added]` into **post-sale** email. Commercial email requires a valid physical postal address. *(Compliance flag; human review.)* Outreach never calls it — it renders its own footer (§0), and `ensureUnsubscribeFooter` ([route.js:113-125](../../../src/app/api/email/send/route.js)) early-returns on the outreach sentinel.

**Structural #1 — identity lives in the body, not the header.** Fixing `From` fixes nothing a recipient reads.

**Structural #2 — `LEGAL` does two jobs.** It is the platform operator's legal identity — [privacy/page.jsx:17](../../../src/app/privacy/page.jsx), [terms/page.jsx:20](../../../src/app/terms/page.jsx), [dpa/page.jsx:20](../../../src/app/dpa/page.jsx), the unsubscribe page — *and* the sender-of-record in post-sale email. Michael's request cannot be granted by editing `LEGAL` without rewriting PRIM's own Privacy Policy, Terms and DPA to name a customer's agency as the platform operator.

**Enforcement gap:** Resend only accepts mail from a DNS-verified domain. PRIM's code says so ([postSaleEmails.js:46](../../../src/lib/postSaleEmails.js)) and the UI warns about it ([Profile.jsx:738](../../../src/components/Profile.jsx)), but **nothing enforces it** — [route.js:303](../../../src/app/api/email/send/route.js) accepts any syntactically-valid address and uses it as the `From` ([:317-320](../../../src/app/api/email/send/route.js)), so an agent who saves an unverified address today silently breaks their own delivery. Rev 5 fixes this by *routing*, not blocking (§5).

**Context that scopes everything below.** These sends are not cold marketing: recipients consented to contact when they submitted inquiries on the platforms that captured them — the templates say so themselves (*"You received this email because you submitted a request for health insurance quotes online"*, [outreachEmails.js:106](../../../src/lib/outreachEmails.js)). Consent does not lift the commercial-email rules — footer, postal address, and working unsubscribe still apply *(informational, not legal advice)* — but it means the identity fix is about **accuracy**, not permission to contact. And the email features are already tier-gated server-side ([route.js:176-188](../../../src/app/api/email/send/route.js)): post-sale requires **Pro+** (`post_sale_emails`, [featureFlags.js:79-81](../../../src/lib/featureFlags.js)); outreach is **Team+ today** (`outreach_emails`, [:91-93](../../../src/lib/featureFlags.js)) and **moves to Pro+ as part of this spec** — Juan, 2026-07-29: *"Pro can use any email feature"* — a one-line `requiredTier` change whose pinned assertions in `featureFlags.test.mjs` are updated in the same commit. Entitlement has **four grant layers**, all inside `canAccessBetaFeature`: tier, complimentary ([:123](../../../src/lib/featureFlags.js)), admin override ([:117](../../../src/lib/featureFlags.js)), and the beta allowlist ([:126-128](../../../src/lib/featureFlags.js), currently Juan's own emails). The tier gate returns 403 *before* anything in this spec runs, so **the sender gate only ever applies to agents already entitled to send** — a Starter agent (absent admin/allowlist status, which today means only Juan) is never asked for sender setup they cannot use.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Juan verifies domains centrally in the Resend dashboard. PRIM reflects status. |
| D2 | **REVISED by Juan 2026-07-29 (supersedes "no verified domain → no sending").** A personal domain is **optional**. Verified own domain → mail sends `From` the agent's own address. No domain, or not yet verified → mail sends via **PRIM's shared verified domain** with the agent's display name and `Reply-To` their own email — any mailbox they own, Gmail included. **Domain status never blocks a send** (§5). |
| D3 | No mailing address → no sending. Hard block. (Same for business name, contact email, and — for outreach — NPN.) |
| D4 | Agent business identity is separate from `LEGAL`. The legal pages are **not touched**. |
| D5 | Agent-to-recipient email only. PRIM's own system mail is exempt (§4). |
| D6 | **Tokenize the shared templates now; per-agent authoring is Phase 2.** |
| D7 | §5's own-domain lane is written for a full-access Resend key. **Juan to confirm**; the fallback is documented. Sending is unaffected by the answer — only the own-domain lane depends on it. |
| D8 | **Scope: entitled agents only.** The existing server-side tier gates run first (post-sale Pro+; outreach Pro+ after this spec's tier change; plus the complimentary/admin/allowlist grants — §1); the sender gate never fires for anyone else. |
| D9 | **Setup before sending, gathered by a walkthrough** (§9.1): triggered on upgrade to an email-entitled tier, on first open of a send surface, and as a Dashboard checklist task. The gate is the backstop; the walkthrough is how agents are expected to actually meet it. |

## 3. The sender identity

Extends `email_sender_identity_v1` (today `{ fromName, fromAddress }`):

| Field | Status | Feeds | Cap |
|---|---|---|---|
| `fromName` | exists | `From` display name | 200 |
| `fromAddress` | exists | **Contact email.** `Reply-To` in both lanes; the `From` itself only when its domain is verified (§5); in-body CTA mailto; footer contact. Any mailbox the agent owns — a personal domain is optional (D2). | 254 |
| `businessName` | **new** | CAN-SPAM sender of record; subject, body copy, footer | 200 |
| `mailingAddress` | **new** | CAN-SPAM postal address (D3) | 300 |
| `npn` | **new** | Outreach footer license line (§0) | 20 |
| `signatureName` | **new** | Signature block + body opener; defaults to `fromName` | 200 |
| `signatureTitle` | **new** | Replaces the **whole** "Owner, Prime Health Consultants" line | 120 |
| `bannerUrl` | **new, optional** | Outreach banner; **omitted entirely when blank** | 500 |

`bannerUrl` blank → no banner, for everyone, until an agent supplies one. Omitting a banner is a cosmetic loss; rendering Prime Health Consultants' artwork over Michael's mail is the bug. Per-agent banner *upload* is Phase 2 (§14).

`signatureTitle` replaces the entire line, prefix included — the literal `Owner, ` at [outreachEmails.js:95](../../../src/lib/outreachEmails.js) is **removed**, not kept. Retaining it and letting an agent enter "Owner, HealthServicesPro" yields *"Owner, Owner, HealthServicesPro"*. It is not gate-checked (an agent may legitimately have no title), so blank must **omit the line** rather than emit an empty `<span>` in HTML and a blank line in all three text closings.

### 3.1 The storage whitelist must be extended or the fields vanish

There are **three** independent whitelists, not two. All must carry all eight fields, with the caps above.

| # | Where | Runs |
|---|---|---|
| 1 | `loadSenderIdentity` ([postSaleEmails.js:325-337](../../../src/lib/postSaleEmails.js)) | browser |
| 2 | `saveSenderIdentity` ([:339-346](../../../src/lib/postSaleEmails.js)) | browser |
| 3 | **the route's own reader** ([route.js:292-312](../../../src/app/api/email/send/route.js)) | **server** |

**#3 is the one that would have broken everything.** The route cannot call `loadSenderIdentity` — `storage.js` is a browser adapter keyed on `window.localStorage` ([:21](../../../src/lib/storage.js)) — so it queries `user_kv` directly and projects **two fields**:

```js
senderOverride = { fromName: ..., fromAddress: addr };   // route.js:304-307
```

Left unextended, the `identity` handed to `evaluate()` has no `businessName`, so **the gate returns 428 `business_name` for every agent forever — including fully-configured ones.** A total email outage, not a partial one. The footer in §8 would likewise receive no `sender` and keep rendering `LEGAL` + the placeholder, leaving ticket #3 unfixed while this spec claims it fixed.

The projection at [route.js:300-312](../../../src/app/api/email/send/route.js) must be widened to all eight fields.

**This is the highest-probability silent failure in the feature.** [Profile.jsx:123](../../../src/components/Profile.jsx) loads via `loadSenderIdentity` into the same state object [:180](../../../src/components/Profile.jsx) saves back, and [:178-181](../../../src/components/Profile.jsx) saves profile and identity on one Save click. Without this change the agent's address is stripped on write and the gate blocks forever with no visible cause. If only `save` were fixed and not `load`, an agent editing their display name months later would silently wipe their own address and go dark. A **round-trip test is mandatory** (§12).

No data migration is needed: absent fields read as `''` and fail the gate until filled.

## 4. The complete send surface

Verified by grepping every `api.resend.com` call site. **Four files reach Resend; this is the closed set.** (No nodemailer/SendGrid/SES/Postmark/Mailgun anywhere in `src/`.)

**GATED** — agent-to-recipient commercial mail via `/api/email/send` → [route.js:419](../../../src/app/api/email/send/route.js):

| Caller | `kind` | Trigger |
|---|---|---|
| [SendOutreachEmail.jsx:92](../../../src/components/SendOutreachEmail.jsx) | `outreach` | agent clicks Send |
| [PendingEmailQueueRunner.jsx:124-134](../../../src/components/PendingEmailQueueRunner.jsx) | **none → defaults to `post-sale`** | **automatic**, queue-driven |
| [SendWelcomeEmail.jsx:152-183](../../../src/components/SendWelcomeEmail.jsx) | **none → defaults to `post-sale`** | agent clicks Send |

Only `SendOutreachEmail` sets `kind` explicitly; both post-sale callers rely on the route default at [route.js:150](../../../src/app/api/email/send/route.js). Neither hits the `welcome` self-send lock ([:197-202](../../../src/app/api/email/send/route.js)) — and **no call site in `src/` sends `kind: 'welcome'` at all** — every occurrence of the string is inside the route's own handling, plus an unrelated Resend *tag* at [welcomeEmails.js:436](../../../src/lib/welcomeEmails.js) and `id: 'welcome'` entries in onboarding ([OnboardingWalkthrough.jsx:255](../../../src/components/OnboardingWalkthrough.jsx), [setupChecklist.js:63](../../../src/lib/setupChecklist.js)). The lock is correct and stays, but it guards a kind nothing currently produces; it is defense for future callers, not a live path.

**EXEMPT** — PRIM's own system mail, zero changes. None of these routes through `/api/email/send`:

| File | Sends as | Why exempt |
|---|---|---|
| [ticketEmails.js:15](../../../src/lib/ticketEmails.js) | `PRIM <FROM>` | Support-ticket notifications — gating them breaks the system that filed this bug |
| [welcomeEmails.js:421](../../../src/lib/welcomeEmails.js) | **hardcoded** `welcome@contact.primtracker.com` / "Juan @ PRIM" ([:22-24](../../../src/lib/welcomeEmails.js)) | Stripe webhook, server-side onboarding. Reads no FROM env var. |
| [reminders/route.js:227](../../../src/app/api/reminders/route.js) | `REMINDERS_FROM_EMAIL` ([:222](../../../src/app/api/reminders/route.js)) | Vercel cron, agent-to-self reminders |

`/api/email/unsubscribe/[token]` renders a page and sends nothing.

Sender config across PRIM is therefore **two env vars plus one hardcoded block** — not the single global the ticket implies.

**Not touched:** `LEGAL` and the legal pages (D4); the blast capture path.

## 5. Two-lane sending — domain status routes mail, it never blocks it

**D2 (revised) in one table.** The revision *simplifies* the build: the shared lane already exists in production — it is today's default `From` construction ([route.js:314-325](../../../src/app/api/email/send/route.js): `AgentName <shared mailbox>`, reply-to the agent). Rev 5 makes it a first-class lane instead of a fallback, and reserves the own-address `From` for verified domains only.

| Domain status of `fromAddress` | Lane | `From` header | `Reply-To` |
|---|---|---|---|
| `verified` | **own** | `fromName <fromAddress>` | `fromAddress` |
| `unverified` | **shared** | `fromName <RESEND_FROM_ADDRESS mailbox>` | `fromAddress` |
| `unknown` (lookup failed) | **shared** | same | `fromAddress` |

The one behavioral change to the existing shared path: `Reply-To` becomes the identity's `fromAddress` rather than `profile.email` ([route.js:324](../../../src/app/api/email/send/route.js)) — the contact the agent chose, which the gate guarantees is present for gated kinds. `kind: 'welcome'` passes the gate without an identity and **always rides the shared lane** with today's fallbacks (request `fromName`, `profile.email` reply-to) via `buildFromHeaders`' fallback inputs (§6) — a deliberate simplification from today's code, which would take a stored identity's address as the `From` even unverified.

**Two failure modes, one safe answer.** Today, saving an unverified address silently breaks delivery (route.js:317-320 uses it as `From`; SPF/DKIM fail). Rev 4 fixed that by *blocking*, which Juan overruled. Rev 5 fixes it by *routing*: mail never goes out `From` an unverified domain, and a Resend `/domains` outage can never stop a send — both route to the shared lane, which is verified by construction. There is no fail-closed block left in the domain path at all.

**Verification source of truth is Resend**, queried server-side. Juan verifies in the dashboard (D1); PRIM asks Resend. New `src/lib/resendDomains.js`:

```
listVerifiedDomains()         -> { ok: true, domains: Set<string> } | { ok: false }
domainStatusFor(addr, result) -> 'verified' | 'unverified' | 'unknown'
```

**Tri-state survives the revision, but its job changed.** `unverified` and `unknown` now send identically (shared lane); they stay distinguishable for the *status UI* (§9): `unverified` tells the agent "ask Juan to verify your domain to send from it directly"; `unknown` says "couldn't check — sending via PRIM's address." Collapsing them would tell an agent with no DNS setup that Resend is down.

Module-memory cache, **5-minute TTL**, cached only on `ok: true`: a normal send costs no extra API call, but a newly-verified domain goes live — automatically upgrading that agent to the own-domain lane — without a redeploy. Never cache a failure.

**D7 — consequence revised.** This assumes `RESEND_API_KEY` can read `GET /domains` (Sensitive in Vercel; unverifiable from this machine). If it is send-only, every lookup fails → everyone rides the shared lane, correctly and indefinitely; **sending is never affected.** The own-domain lane then needs either a full-access key or the fallback `verified_email_domains` admin table. No longer blocking for anything but the own-domain upgrade.

**Impersonation, stated openly — own-domain lane only:** verifying `healthservicespro.com` authorizes sending from any address at that domain; PRIM does not prove mailbox ownership. Accepted given a small trusted roster and central verification. The shared lane cannot be used to put mail on another agency's domain at all — its `From` is always PRIM's. A one-time confirmation email to the `fromAddress` would close the residual — Phase 2 (§14), recorded as a decision rather than an oversight.

## 6. The send gate

Pure module `src/lib/senderGate.mjs`, called from the route.

**Placement is exact — and rev 4's hoist is dropped as unnecessary.** The identity reader ([route.js:292-312](../../../src/app/api/email/send/route.js)) already sits after everything the gate must come after; the gate slots **directly between the reader and the `From` construction at [:314](../../../src/app/api/email/send/route.js)**, with no code moved. Resulting order: auth → tier gate → ownership ([:240](../../../src/app/api/email/send/route.js)) → suppression ([:255-261](../../../src/app/api/email/send/route.js)) → unsubscribe build (pure computation, harmless before a refusal) → `RESEND_API_KEY` check ([:278-284](../../../src/app/api/email/send/route.js)) → identity read → **gate** → lane selection (§5) → render → Resend `fetch` ([:419](../../../src/app/api/email/send/route.js)).

*Why after suppression:* that check returns `{ok: true, suppressed: true}` — a 200 that lets the queue close the item cleanly. Gate first, and an unconfigured agent's queued email to an **already-unsubscribed** recipient would return 428 and be retried forever against someone who opted out.

*Why after the key check:* a missing `RESEND_API_KEY` keeps reporting itself as the `notConfigured` response both senders already render specially ([SendOutreachEmail.jsx:242-244](../../../src/components/SendOutreachEmail.jsx), [SendWelcomeEmail.jsx:338-340](../../../src/components/SendWelcomeEmail.jsx)) instead of masquerading as a sender-setup problem.

*The trap inside the reader:* it produces `senderOverride = null` for **two different reasons** that must not be conflated:

| Cause | Where | Correct answer |
|---|---|---|
| Query threw (Supabase blip) | `catch` ([:310-312](../../../src/app/api/email/send/route.js)) | **503 `identity_unavailable`** — transient |
| Row present, `fromAddress` fails the regex ([:303](../../../src/app/api/email/send/route.js)) | the `if` never fires | **428 `from_address`** — the agent has a typo |

Both currently collapse to `null`. Map both to 503 and an agent with a typo'd address is told "couldn't check — try again shortly" forever; map both to 428 and a Supabase blip tells a correctly-configured agent their address is missing. **The reader must return a discriminated result** (`{ ok: true, identity }` / `{ ok: false, reason: 'threw' | 'absent' }` / `{ ok: false, reason: 'invalid', identity }` — the `'invalid'` case **carries the row it read**, so the gate can report the bad address rather than fields already filled), not a nullable object.

`senderGate.mjs` surface — no `fetch`, no env, no imports:

```
missingFields(identity, kind)         -> string[]   // e.g. ['from_name', 'npn']
evaluate({ kind, readerResult })      -> { ok: true, identity } | { ok: false, status, setupRequired, error }
selectLane(domainStatus)              -> 'own' | 'shared'   // 'own' ONLY on 'verified' (§5)
buildFromHeaders({ identity, lane, globalFrom, fallbackName, fallbackReplyTo }) -> { fromHeader, replyTo }
```

**`evaluate` takes the reader's discriminated result** (`{ ok: true, identity }` / `{ ok: false, reason }` — defined above), not a bare identity: that is what lets it map `reason: 'threw'` to 503 while `'absent'` and `'invalid'` fall through to the missing/invalid-`from_address` step like any other incomplete identity. **`evaluate` is defined in terms of `missingFields`** — it returns the first entry in precedence order. §9's status route needs the full list while the send path needs the first failure; deriving both from one function is what makes "the UI and the gate can never disagree" structurally true rather than merely asserted. **Domain status is not an input to `evaluate`** (D2 revised) — it feeds `selectLane`, after the gate has passed. `buildFromHeaders` is extracted pure so both lanes are node-testable, replacing the inline if/else at [route.js:315-325](../../../src/app/api/email/send/route.js); `fallbackName` / `fallbackReplyTo` (the route passes request `fromName` and `profile.email`) exist solely for the identityless `welcome` path, which today falls back exactly that way ([route.js:322-324](../../../src/app/api/email/send/route.js)).

```
1. kind === 'welcome'                    -> { ok: true }   (always SHARED lane — see below)
2. reader reason === 'threw'             -> 503 identity_unavailable
3. fromName blank                        -> 428 from_name
4. fromAddress missing/invalid           -> 428 from_address   ('invalid' reader results land here — the reader
                                                                carries the row it read, so only the bad address is
                                                                reported; 'absent' evaluates an empty identity and
                                                                reports its first gap, from_name)
5. businessName blank                    -> 428 business_name
6. mailingAddress blank                  -> 428 mailing_address        (D3)
7. kind === 'outreach' and npn blank     -> 428 npn                    (§0)
   otherwise                             -> { ok: true }  → selectLane → buildFromHeaders
```

**`from_name` is a gate requirement — added in rev 6 after review caught its absence.** Without it, an agent with every other field filled sends *"My name is , and I am the owner of X"* with an empty `From` display name: `{signature_name}` defaults to `fromName` (§3), and nothing else guaranteed either was non-empty. §7.2's "incomplete" is defined as exactly `missingFields(sender, 'outreach').length > 0` — the same predicate everywhere, so render, gate, and status can never disagree.

*Step 1 is the only exempt kind reachable here*, and **`welcome` always rides the shared lane, even for an agent with a saved identity** — a deliberate change from today, where a stored address takes the `senderOverride` branch ([route.js:317-320](../../../src/app/api/email/send/route.js)) and would go out `From` a possibly-unverified domain. No call site sends `kind: 'welcome'` (§4), so nothing observable changes. The exempt **files** in §4 never touch this route. *There are no domain steps* — an unverified or unknown domain selects the shared lane (§5) and the send proceeds.

**The stale-bundle guard — route-level, `kind === 'outreach'` only, runs after the gate.**

The gate validates identity *fields*. It never inspects what is actually being sent, and outreach HTML is rendered **client-side** ([SendOutreachEmail.jsx:71-74](../../../src/components/SendOutreachEmail.jsx)) then passed to the route, which uses the caller's `html` verbatim ([route.js:334-335](../../../src/app/api/email/send/route.js)).

PRIM is a SPA. **A tab opened before the deploy keeps running the old module**, with the hardcoded constants still in memory. That agent completes their setup, passes every field check, and sends `From: mike@healthservicespro.com` over a body reading *"Julio Fernandez … NPN: 19153319"* — §0's stated worst case, delivered to a real prospect. §12's absence assertions test the newly-built bundle, not the wire.

So the route rejects an outreach send whose `subject`, `body` or `html` contains any retired literal:

```
Julio Fernandez | Prime Health Consultants | 19153319 | 1550 Sawgrass | rjprimehealth.com | phc-banner
```

→ 428 `{ setupRequired: 'stale_client', error: 'Please reload PRIM and try again — this page is running an outdated version.' }`

**With one exemption, without which the guard is a permanent outage for one real agent.** Julio Fernandez is on the roster, and his *correct* post-tokenization identity legitimately renders five of the six literals — `{signature_name}` "Julio Fernandez", `{business_name}` "Prime Health Consultants", `{npn}` "19153319", `{mailing_address}` containing "1550 Sawgrass", and a CTA mailto containing "rjprimehealth.com". A naive literal check refuses every send he ever makes, with a "reload" instruction that can never clear it. So: **a literal is ignored when it is a substring of any of the sending agent's own gate-validated identity values.** For Julio every hit is exempt and his mail flows; for Mike none are, and a stale pre-deploy bundle is still caught exactly. §12 asserts both directions.

Cheap, exact, and it fails safe on the one path where the server cannot otherwise know what it is sending. Retire the check once no pre-deploy session can plausibly still be open.

**Every refusal carries a human-readable `error` string as well as `setupRequired`.** Both existing senders render `data?.error || \`HTTP ${res.status}\`` ([SendOutreachEmail.jsx:115](../../../src/components/SendOutreachEmail.jsx), [SendWelcomeEmail.jsx:187](../../../src/components/SendWelcomeEmail.jsx)); without `error` the agent sees a bare `HTTP 428`. `setupRequired` drives the UI; `error` is the fallback that always reads sensibly.

**428 Precondition Required** is deliberate — distinguishable from the tier gate's 403 (`upgradeRequired`) and auth's 401.

`RESEND_FROM_ADDRESS` ([route.js:314](../../../src/app/api/email/send/route.js)) is no longer a fallback to make unreachable — **it is the shared lane's `From` mailbox** (§5), a first-class path most agents will ride until their domain is verified. The `welcome` kind and any future gated-but-identityless case keep today's behavior through the same lane.

### 6.1 Queued email must be rescheduled, never failed

[PendingEmailQueueRunner.jsx:138](../../../src/components/PendingEmailQueueRunner.jsx) marks any non-OK response `status: 'failed'` — terminal; `isDue` ([pendingEmailQueue.js:152-154](../../../src/lib/pendingEmailQueue.js)) never re-fires it.

Unchanged, on deploy day every queued post-sale email for an unconfigured agent is permanently burned. **This is the most damaging thing this feature could do, and it is silent.**

**A new `held` status is not the answer** — the storage layer cannot represent it: `isDue` and `isPending` ([:156-158](../../../src/lib/pendingEmailQueue.js)) both require `'pending'`, `markFired` ([:122-131](../../../src/lib/pendingEmailQueue.js)) unconditionally stamps `firedAt`, `pruneCompleted` ([:140-143](../../../src/lib/pendingEmailQueue.js)) keeps only `'pending'` so a held item is **deleted 24h later**, and the documented union ([:20](../../../src/lib/pendingEmailQueue.js)) has no such member.

**Design — reschedule, don't restatus.**

New export in `pendingEmailQueue.js`:
```
reschedulePending(id, { scheduledAt, heldReason })
```
It sets `scheduledAt` and `heldReason` and leaves `status: 'pending'`, **without stamping `firedAt`**. `markFired` cannot do this (it always stamps), so the function is required — the runner must not read-modify-write the queue itself.

Runner rule, on a non-OK response:

| Response | Action |
|---|---|
| **428 or 503**, except `stale_client` | `reschedulePending(id, { scheduledAt: now + 15min, heldReason: setupRequired })` |
| 428 `stale_client` | `markFired(id, { status: 'failed', error })` — rescheduling would replay the same stale payload forever |
| any other non-OK | `markFired(id, { status: 'failed', error })` — unchanged |

*In practice the queue never sees `stale_client`: the guard is outreach-only (§6) and the queue sends post-sale. The row is here so the rule is total rather than leaving an implementer to reconcile "428 reschedules" against a 428 that must not.*

**503 must reschedule, not fail.** In rev 5 the only 503 is `identity_unavailable` — a Supabase blip during the identity read (§5's domain lookup no longer refuses anything; it routes to the shared lane). Treating a transient read error as terminal would mean one blip silently destroys pending client email — the exact outcome this section exists to prevent.

Without pushing `scheduledAt`, `isDue` stays true and the item re-POSTs on every tick.

**The reschedule call must sit outside the existing `catch`.** [PendingEmailQueueRunner.jsx:157](../../../src/components/PendingEmailQueueRunner.jsx) catches everything and marks `failed`. Put `reschedulePending` inside that scope and a transient storage blip converts a recoverable hold into a terminal burn — the precise failure this section exists to prevent, reintroduced by where the call is placed.

**Staleness bound.** `pruneCompleted` keeps `pending` items indefinitely. Per §10 every email-entitled agent starts with an incomplete identity on day one, so without a bound their queued post-sale email holds for weeks and then **all flushes at once** when they complete setup — a burst of stale "congratulations on your new policy" mail to real clients. An item whose **`enqueuedAt`** ([pendingEmailQueue.js:66](../../../src/lib/pendingEmailQueue.js)) is more than **72 hours** old is marked `failed` with `error: 'expired while sender setup incomplete'`. Deliberate: a week-late post-sale email is worse than none.

`enqueuedAt` is named explicitly because `reschedulePending` mutates `scheduledAt` on every hold and stamps no hold-start of its own — it is the only stable anchor already on the item.

**Expiry must be visible, and today nothing would show it.** `onAuditEntry` is called **only in the success branch** ([:141-142](../../../src/components/PendingEmailQueueRunner.jsx)); all four `markFired(..., 'failed')` sites ([:96](../../../src/components/PendingEmailQueueRunner.jsx), [:104](../../../src/components/PendingEmailQueueRunner.jsx), [:138](../../../src/components/PendingEmailQueueRunner.jsx), [:157](../../../src/components/PendingEmailQueueRunner.jsx)) write nothing to `lead.emailLog`, which is the only thing `LeadEmailAuditPanel` reads ([:24](../../../src/components/LeadEmailAuditPanel.jsx)). The toast list is `filter(isPending)`, so a `failed` item renders nothing either — and `pruneCompleted` deletes the row 24h later. **A client's post-sale email would expire with zero surface anywhere, and the evidence would be gone the next day.**

So: **the runner calls `onAuditEntry` on the failure branches too**, not just on success. Without this, §6.1 trades a silent burn at 0 hours for a silent burn at 72.

**Countdown honesty.** `CountdownToast` ([:192-224](../../../src/components/PendingEmailQueueRunner.jsx)) renders only "Sending in mm:ss" from `msUntilFire`. A held item would show a live countdown resetting every 15 minutes — telling the agent mail is imminent, forever. **The toast renders `heldReason` and a link to Profile → Sender instead of the countdown whenever it is set.** Required, not a nicety.

**Toast volume.** Held items stay `pending`, and the runner renders one toast per pending item in an unscrolled fixed stack ([:173-189](../../../src/components/PendingEmailQueueRunner.jsx)). An entitled agent with several queued sends and an incomplete identity would see N persistent toasts for up to 72 hours. Collapse held items into a single summary toast ("3 emails waiting on sender setup").

## 7. Tokenizing the outreach templates (D6)

The identity is in the copy, not just the constants (§0). The fix has three parts.

### 7.1 Split the registry from the copy

`OUTREACH_TEMPLATES` ([:274](../../../src/lib/outreachEmails.js)) is imported by two consumers: [SendOutreachEmail.jsx:20-24](../../../src/components/SendOutreachEmail.jsx) and [outreachReminders.js:20](../../../src/lib/outreachReminders.js). The latter only needs ids and ordering.

A template object has **ten** fields ([:275-286](../../../src/lib/outreachEmails.js)). Every one lands on a named side — nothing may fall between:

| Side | Fields |
|---|---|
| **Metadata** — stays on `OUTREACH_TEMPLATES` | `id`, `name`, `description`, `previewText`, `pillLabel`, `ctaLabel`, `ctaSubject` |
| **Copy** — moves to `buildTemplateCopy` | `subject`, `bodyHtmlInner`, `bodyText` |

`previewText` is metadata: it carries no identity and `renderShell` emits it as the hidden preheader ([:67](../../../src/lib/outreachEmails.js)). Drop it from both sides and it becomes `escapeHtml(undefined)` — an empty preheader on every outreach email, which is a deliverability regression, not just cosmetic.

`outreachReminders.js` reads only `.length` ([:46](../../../src/lib/outreachReminders.js)), array index ([:55](../../../src/lib/outreachReminders.js)) and `.id` ([:176-177](../../../src/lib/outreachReminders.js)), so it is unaffected. `getOutreachTemplate` ([:313](../../../src/lib/outreachEmails.js)) survives the split trivially.

The identity-bearing content moves into a builder:

```
buildTemplateCopy(templateId, sender) -> { subject, bodyHtmlInner, bodyText }
```

This resolves the module-load `ReferenceError` (§0): nothing interpolates identity at import time any more, because the copy is built per call.

### 7.2 Make the identity a required argument

`renderOutreachTemplate(template, prospect, opts)` ([:326](../../../src/lib/outreachEmails.js)) takes `opts.sender` and **returns `null` when it is missing or incomplete — where "incomplete" means exactly `missingFields(sender, 'outreach').length > 0` (§6), the same predicate the gate and the status route use.** One definition, three consumers; they cannot disagree.

This is the important design choice. A missing identity becomes a *render-time impossibility* rather than a silent blank — the component cannot produce an email with an empty signature even if a future caller forgets to pass one. Rev 2's design would have let the server-side gate pass while the browser rendered blank identity fields, because outreach HTML is built client-side in a `useMemo` ([SendOutreachEmail.jsx:71](../../../src/components/SendOutreachEmail.jsx)) that has no access to the identity today.

`renderShell` ([:39](../../../src/lib/outreachEmails.js)) likewise takes `sender` and derives banner, signature, CTA mailto and footer from it. The six module constants ([:26-31](../../../src/lib/outreachEmails.js)) are **deleted, not defaulted** — a default is how one agent's NPN reaches another agent's mail. The stale comment at [:328-330](../../../src/lib/outreachEmails.js) ("the shell doesn't reference any tokens so it stays static") is now false and must be rewritten.

### 7.3 Every identity string becomes a token

Extend the existing `applyTokens` mechanism rather than inventing a second one; it already handles `{first_name_greeting}` for prospect fields. Sender tokens resolve from the identity.

All of these must be tokenized — **the subject and plain-text parts included**, since [route.js:430](../../../src/app/api/email/send/route.js) sends `text` as the real plain-text alternative and `renderOutreachTemplate` returns `subject` straight from the template ([:344](../../../src/lib/outreachEmails.js)):

| Location | Today | Becomes |
|---|---|---|
| [:279](../../../src/lib/outreachEmails.js) subject | "…— Prime Health Consultants" | `{business_name}` |
| [:163](../../../src/lib/outreachEmails.js) HTML body opener | "My name is Julio Fernandez, and I am the owner of…" | `{signature_name}` / `{business_name}` |
| **[:211](../../../src/lib/outreachEmails.js) plain-text body opener** | **same sentence, in `EMAIL_1_TEXT`** | `{signature_name}` / `{business_name}` |
| [:94-96](../../../src/lib/outreachEmails.js) signature | literal "Julio Fernandez" + `${COMPANY}` | `{signature_name}` / `{signature_title}` |
| [:103-105](../../../src/lib/outreachEmails.js) footer | `${COMPANY}` `${NPN}` `${ADDRESS}` | `{business_name}` / `{npn}` / `{mailing_address}` |
| [:85](../../../src/lib/outreachEmails.js) CTA mailto | `${REPLY_TO}` | `{from_address}` |
| [:225-230](../../../src/lib/outreachEmails.js), [:243-248](../../../src/lib/outreachEmails.js), [:265-270](../../../src/lib/outreachEmails.js) plain-text closings | all of the above, literal | same tokens |
| [:26](../../../src/lib/outreachEmails.js) banner src | PHC artwork | `bannerUrl`, or the whole block is omitted |
| [:27](../../../src/lib/outreachEmails.js) banner **alt** | "Prime Health Consultants — Licensed…" | `{business_name}` — alt text is what renders when images are blocked, which is the common default |

**[:211](../../../src/lib/outreachEmails.js) is the one a careful implementer would miss**: the three plain-text ranges above are the *closings*, and the same sentence also opens `EMAIL_1_TEXT` in the body. Tokenize only the table's closings and the HTML part names the agent while the `text/plain` alternative names Julio. (The NPN occurrences — [:104](../../../src/lib/outreachEmails.js), [:229](../../../src/lib/outreachEmails.js), [:247](../../../src/lib/outreachEmails.js), [:269](../../../src/lib/outreachEmails.js) — are all covered; what leaks at `:211` is name and company.)

Note "Julio Fernandez" at [:94](../../../src/lib/outreachEmails.js) is a **bare string literal**, not one of the six constants — deleting the constants does not remove it. §12's absence assertions are what catch this class.

### 7.4 Two claims that are not identity — flagged, not silently shipped

Tokenizing swaps *who* the email is from. It does not examine *what the email asserts*, and two assertions get carried into all 23 agents' outreach under their own names:

1. **The two-hour promise** — *"quotes ready for you within the next two hours"* ([:165](../../../src/lib/outreachEmails.js), and again in the plain text at [:215](../../../src/lib/outreachEmails.js) and the preheader at [:280](../../../src/lib/outreachEmails.js)). A turnaround commitment every agent would now make in their own name.
2. **"Licensed Independent Insurance Agency"** ([:104](../../../src/lib/outreachEmails.js), [:229](../../../src/lib/outreachEmails.js), [:247](../../../src/lib/outreachEmails.js), [:269](../../../src/lib/outreachEmails.js)) — a licensing status asserted verbatim for every agent, sitting next to their own NPN. Closer in kind to §0's concern than the two-hour promise is. *(Compliance flag — informational, not legal advice; route to human review.)*

Neither is identity, so this spec does not change them — **but both should be deliberate.** Options for each: leave as-is, soften, or make it a per-agent field. **Juan: §14 item 4.**

## 8. Threading identity into post-sale mail

`canSpamFooterHtml` ([legalConfig.mjs:36](../../../src/lib/legalConfig.mjs)) has exactly two callers, **both intermediaries** — so changing it alone is a silent no-op that leaves every real send rendering `LEGAL`:

```
route.js:119 -> canSpamFooterStandaloneHtml (legalConfig.mjs:54) -> canSpamFooterHtml
             -> renderPostSaleHtml (postSaleHtml.js:231)          -> canSpamFooterHtml (:289)
```

All three take `sender` and pass it through. With `sender`, the footer renders the agent's `businessName` / `mailingAddress` and offers `fromAddress` as the contact; without it, `LEGAL` exactly as today.

**`renderPostSaleHtml` has two callers, not one:** [route.js:361](../../../src/app/api/email/send/route.js) *and* [SendWelcomeEmail.jsx:100](../../../src/components/SendWelcomeEmail.jsx), the send **preview**. Miss the second and the agent previews `R&J Prime Consultancy LLC` + `[mailing address — to be added]` while the send renders their own identity — ticket #3's complaint, on the screen immediately before Send.

`postSaleHtml.js` carries no other hardcoded identity: `agentName` / `agentPhone` / `agentEmail` ([:232-234](../../../src/lib/postSaleHtml.js)) are already per-agent. Only the footer leaks `LEGAL`.

`mailingAddressOrPlaceholder()` is **retained unchanged** for Privacy/Terms/DPA (D4). The placeholder still appears on the legal pages until `LEGAL.mailingAddress` is set — separate, still open (§14).

**The placeholder can no longer reach a commercial email**, because the gate's mailing-address requirement (§6, D3) refuses to send without a real one. That is the fix for ticket #3.

## 9. UI — Profile → Sender

Extends `SenderSection` ([defined Profile.jsx:724](../../../src/components/Profile.jsx), rendered [:353](../../../src/components/Profile.jsx)); no new navigation.

- New fields: **Business name**, **Mailing address**, **NPN**, **Signature name**, **Signature title**, **Banner URL** (optional) — each with one line on why it is required and where it appears.
- A **live preview** of the signature block and footer. The fastest way for an agent to catch a typo in their own license number.
- A **domain status row** under the From address — informational, never blocking (D2): `Verified ✓ — mail sends from your own address` / `Not verified — mail sends from PRIM's address with replies going to you; ask Juan to verify your domain to send from it directly` / `Couldn't check right now — sending via PRIM's address`.
- **"Request domain verification"** opens a prefilled support ticket to Juan with the domain and requesting agent — the D1 request path, reusing the ticket system rather than inventing one. Presented as the optional upgrade it now is.
- Send buttons in `SendOutreachEmail` / `SendWelcomeEmail` **disabled with the specific missing field** when the identity is incomplete, so the agent learns before composing.
- The existing unenforced warning at [:738](../../../src/components/Profile.jsx) is replaced by the real status row.
- The section is **only rendered for email-entitled agents** (D8) — a Starter agent sees no sender form for features they cannot use.

### 9.1 The sender-setup walkthrough (D9)

The gate is the backstop; this is how agents are actually expected to meet it — Juan's requirement that *"whenever an agent [has] their account created or they want to use email templates, there's another procedure to gather all that information required before they can start sending."* Three triggers, all driving the same Profile → Sender form; completion is **derived from the identity itself** (the §9 union of `missingFields()` over the agent's entitled kinds is empty), never tracked separately — the pattern `SetupChecklist` already uses ([SetupChecklist.jsx](../../../src/components/SetupChecklist.jsx): tasks "derived from the agent's actual app state (no extra tracking — completion flips automatically when they do the thing)").

| Trigger | Mechanism | Covers |
|---|---|---|
| **Upgrade to an email-entitled tier** | Stripe checkout returns to `/?subscription=success&session_id=…` ([create-checkout-session/route.js:90](../../../src/app/api/stripe/create-checkout-session/route.js)); after `sync-after-checkout` resolves, if the new tier grants `post_sale_emails` or `outreach_emails` and `missingFields()` is non-empty, show the walkthrough: *"You've unlocked email templates — set up your sender identity to start sending."* | Juan's "since you already upgraded, you have to do this now" case |
| **First open of a send surface** | While the identity is loading (`null`), `SendOutreachEmail` / `SendWelcomeEmail` render the setup prompt; once loaded incomplete, the **composer renders with Send disabled and the specific missing field named**, linking to Profile → Sender (per §9 — one behavior, stated once) | An entitled agent who skips the checklist and goes straight to Send |
| **Dashboard checklist task** | New derived task in [setupChecklist.js](../../../src/lib/setupChecklist.js)'s `deriveTasks`, shown **only when the agent is email-entitled** — `deriveTasks` gains an entitlement input from the profile the Dashboard already holds via `useSubscription` ([subscription.js:93](../../../src/lib/subscription.js) exposes tier/status/complimentary/admin): *"Set up your email sender identity"* → routes to Profile → Sender; auto-completes when the §9 union of `missingFields()` is empty | **New accounts on an entitled tier with a live checklist** — the widget returns `null` permanently once dismissed or all-complete ([SetupChecklist.jsx:55](../../../src/components/SetupChecklist.jsx)), so pre-deploy entitled agents are reached by trigger 2 and the §10 announcement instead |

Entitlement scoping matters in all three: the task and walkthrough must never appear for a Starter agent — a CTA to configure a feature they cannot use is how upgrade prompts get ignored. Entitlement comes from the same `canAccessBetaFeature` calls the send surfaces already make ([SendOutreachEmail.jsx:31](../../../src/components/SendOutreachEmail.jsx), [SendWelcomeEmail.jsx:26](../../../src/components/SendWelcomeEmail.jsx)).

New route **`GET /api/email/sender-status`** — the UI must never hold the Resend key:

```
200 { fromAddress, domain, domainStatus: 'verified'|'unverified'|'unknown',
      missing:  { 'post-sale': ['business_name', ...], outreach: [...] },
      complete: { 'post-sale': boolean, outreach: boolean } }
```
Auth: `requireUserId`, 401 otherwise. Reads the caller's own identity only — never accepts a user id. `missing` comes from **`senderGate.missingFields()` per kind** — the function is kind-sensitive (`npn` is outreach-only), so a flat list would either demand an NPN from an agent with no outreach entitlement or read "complete" while outreach still 428s. Each send surface consumes its own kind's list; **walkthrough/checklist completion (§9.1) uses the union over the agent's entitled kinds** — after this spec's tier change (§1) every email-entitled agent is Pro+ and outreach-entitled, so in practice the union is the outreach set, NPN included. Same function `evaluate()` is defined in terms of (§6), so the UI and the send path cannot disagree by construction.

*Residual, accepted:* an agent can probe whether an arbitrary domain is verified in Juan's Resend account by editing their own `fromAddress` and polling this route. Negligible on a 23-agent trusted roster; noted rather than mitigated.

`SendOutreachEmail` gains an async identity load into state (`null` while loading), rendering the setup prompt rather than a preview until it resolves — the tri-state pattern already used for `draftsEntitled` in `FollowupNextStep`.

**Dark mode:** any opacity-suffixed utility must exist in the `globals.css` remap table ([:105-115](../../../src/app/globals.css)) or be added — the trap behind the invisible hover on the CSV modal. Verify both themes.

## 10. Rollout

The blast radius shrank twice since rev 4, and the character of the cutover changed with it:

- **Tier scoping (D8):** only agents who pass the existing tier gates — post-sale Pro+, outreach Team+, complimentary — can send email at all, so only they can be affected. Starter agents lose nothing because they have nothing here.
- **No domain blocking (D2 revised):** nobody waits on DNS or on Juan. The only thing standing between an entitled agent and sending is **filling in a form** — name, business, mailing address, NPN — which the walkthrough (§9.1) puts in front of them at upgrade, at first send, and on the Dashboard.

What remains true: **on deploy, an entitled agent with an incomplete identity cannot send until they complete it** (D3), and their queued post-sale mail holds per §6.1. That is the intended behavior, not a cliff — which is why rev 4's staged-rollout enablement flag is **withdrawn**: it existed to soften a roster-wide domain-verification bottleneck that no longer exists.

1. **Measure first:**
   ```sql
   SELECT p.email, p.subscription_tier, p.subscription_status, p.is_complimentary,
          kv.value ->> 'fromAddress'    AS from_address,
          kv.value ->> 'businessName'   AS business_name,
          kv.value ->> 'mailingAddress' AS mailing_address,
          kv.value ->> 'npn'            AS npn
   FROM profiles p
   LEFT JOIN user_kv kv
     ON kv.user_id = p.id AND kv.key = 'email_sender_identity_v1'
   WHERE p.is_complimentary = true
      OR p.subscription_tier IN ('pro', 'team')
   ORDER BY 5 NULLS FIRST;
   ```
   (`user_kv.value` is `jsonb` and `storage.js` upserts a parsed object, so `->>` resolves. The `WHERE` approximates the flag logic — `canAccessBetaFeature` is canonical — and **undercounts the admin/allowlist grants** (§1), a population of one: Juan.) `business_name`, `mailing_address` and `npn` will be NULL for everyone; the row count is **how many agents get the walkthrough on day one**, not how many are broken. After the tier change (§1) every one of them is outreach-entitled, so the walkthrough asks each for the full form, **NPN included**.
2. **Announce before it lands** — `[announce]` commit telling entitled agents to fill in Profile → Sender (or just follow the walkthrough). Before the gate ships, not with it.
3. Merge, deploy, confirm `/api/version`.
4. **Optionally verify domains** in the Resend dashboard for agents who want the own-domain lane — including `healthservicespro.com` for Michael. At any later time; nothing waits on it.
5. Resolve ticket #3 to Michael: his footer and body now carry HealthServicesPro and his address; once his domain is verified his `From` does too.

## 11. Error handling

| Condition | Response | Client |
|---|---|---|
| Missing business / mailing / npn / from | 428 `{ setupRequired, error }` | Named prompt + link to Profile → Sender; queue **reschedules** |
| Domain unverified **or lookup failed** | **200 — sends via the shared lane (§5). Not an error.** | Profile shows the informational status row |
| Identity read threw | 503 `{ setupRequired: 'identity_unavailable', error }` | Transient message; queue **reschedules** |
| Stale client bundle (outreach) | 428 `{ setupRequired: 'stale_client', error }` | "Reload PRIM" — **not** rescheduled; a held retry would replay the same stale payload |
| `enqueuedAt` > 72h while held | — | Marked `failed` **and written to `lead.emailLog`** via `onAuditEntry` (§6.1) |
| Recipient suppressed | 200 `{ok, suppressed}` (unchanged) | Gate never runs — suppression is checked first |
| `kind: 'welcome'` | gate returns ok | unchanged |
| Genuine send failure | existing behavior | queue marks `failed` (unchanged) |

Invariant: **a gated refusal never sends, and never terminally burns a queued item except by the explicit 72h rule.**

## 12. Testing

`npm run test:all` — node lane 583, component lane 50, both verified green at exit 0. Both must stay green.

**Node lane** (`node --test src/lib/*.test.mjs`). The real constraint is *explicit extensions on relative imports and no framework-only deps* — a `.js` file is fine (`featureFlags.test.mjs` already imports `featureFlags.js`), so `resendDomains.js` + `resendDomains.test.mjs` works.

`senderGate.test.mjs`:
- each missing field returns its own `setupRequired`, in the documented precedence order — **`from_name` included** (rev 6): a blank name with every other field filled is refused, never rendered as *"My name is , …"*;
- `npn` required for `outreach`, not for `post-sale`;
- **`missingFields()` never contains a domain entry** — domain status is routing, not a requirement (D2 revised);
- **`selectLane`: `verified` → `own`; `unverified` → `shared`; `unknown` → `shared`, never `own`** — the `unknown → shared` case is the mutation-critical one: flip it to `own` and a Resend outage sends mail from unverified domains;
- **`buildFromHeaders`, both lanes:** own lane → `From: fromName <fromAddress>`, reply-to `fromAddress`; shared lane → `From: fromName <shared mailbox>`, **reply-to `fromAddress`, not `profile.email`** — the one behavioral change to the existing shared path (§5);
- **`evaluate({ kind, readerResult })` maps `reason: 'threw'` → 503 `identity_unavailable`; `'invalid'` (reader carries the read row) → 428 `from_address` even when every other field is filled; `'absent'` → the empty identity's first gap (`from_name`)** — asserted separately. All collapse to `null` in today's code; conflating them tells an agent with an address typo to "try again shortly" forever, or to add a name already on screen;
- `kind: 'welcome'` bypasses every check;
- **`missingFields()` and `evaluate()` agree**: `evaluate().setupRequired === missingFields()[0]` for every incomplete identity. This is what makes §9's consistency claim structural rather than asserted;
- every refusal carries a non-empty `error` string;
- **the `mailingAddressOrPlaceholder()` placeholder can never be the value that passes the mailing-address step** — asserted directly, since shipping that string is the original bug.

`resendDomains.test.mjs` (fetch injected):
- case-insensitive domain extraction; subdomains; malformed address → not verified;
- only `status === 'verified'` counts;
- cache TTL: no re-fetch inside the window, re-fetch after; **a failure is never cached**;
- lookup error → `unknown`, never `verified`.

**Round-trip** (`postSaleEmails`): save→load preserves **all eight fields**. Mutation-check by reverting either function to the two-field whitelist and confirming red. This is the §3.1 silent-wipe guard.

**The route's projection is the third whitelist** and needs its own assertion — a round-trip test on `postSaleEmails` alone passes while `route.js` still projects two fields and the gate 428s every agent (§3.1). Assert the projection carries all eight, either by extracting it into a pure helper in `senderGate.mjs` (preferred — it becomes node-testable) or in the component lane against a mocked Supabase response.

**Stale-bundle guard** (§6): a payload containing a retired literal is refused with `stale_client`; a clean payload passes; **and the identity exemption in both directions** — the same Julio-identity payload passes when the sender's gate-validated fields contain the literals and is refused when they don't (Mike's identity). Mutation-check twice: remove one literal and confirm red; remove the exemption and confirm the Julio case goes red.

**Tier change** (§1): `featureFlags.test.mjs`'s pinned `outreach_emails` assertions are updated to `pro` in the same commit as the flag — the failing-then-fixed test *is* the proof the policy changed.

**Outreach rendering** — the assertions rev 2 got wrong:
- `renderOutreachTemplate(t, prospect, { sender })` — the returned `subject`, `html` **and `text`** each contain the agent's identity and **none of** `Julio Fernandez`, `Prime Health Consultants`, `19153319`, `1550 Sawgrass`, `rjprimehealth.com`, `phc-banner`. Asserting only on `renderShell` output passes while the strings ship in the subject, the body opener and all three plain-text parts — that is exactly how rev 2 failed.
- `renderOutreachTemplate` with no/incomplete `sender` returns `null` (§7.2).
- Importing `outreachEmails.js` does not throw (§0 `ReferenceError` guard), and `OUTREACH_TEMPLATES` still exposes the ids `outreachReminders.js` depends on.

**Post-sale rendering:** `renderPostSaleHtml({ sender })` **and** `canSpamFooterStandaloneHtml({ sender })` each render the agent's business name and address. Testing `canSpamFooterHtml` alone is insufficient — it has no direct production callers, so a test on it passes while both real paths ship the bug.

**Component lane:**
- `SenderSection`: blank fields render the specific warnings; the preview shows the agent's identity, not `LEGAL`'s; the section renders **only for email-entitled agents** (D8).
- Send buttons disabled with the specific missing field when the identity is incomplete.
- `SendOutreachEmail` renders the setup prompt, not a preview, while identity is `null`.
- **Walkthrough triggers (§9.1):** the Dashboard checklist task appears only for entitled agents and auto-completes when `missingFields()` is empty — mutation-check the entitlement scoping by rendering a Starter profile and asserting the task is absent; the upgrade-success walkthrough shows only when the new tier grants an email flag **and** the identity is incomplete (all four combinations asserted).
- **Queue runner: 428 and 503 each leave the item `pending` with `scheduledAt` pushed and `heldReason` set; a 500 marks `failed`; an item whose `enqueuedAt` is past 72h marks `failed`.** These protect real client email — mutation-check by letting 503 fall into the `failed` branch and confirming red.
- **Expiry writes to `lead.emailLog` via `onAuditEntry`.** Without this the 72h rule is a silent burn (§6.1) — mutation-check by removing the call and confirming red, since a suite that only checks `status === 'failed'` stays green while the agent sees nothing.
- A storage throw during `reschedulePending` does **not** mark the item `failed` (the call sits outside the `catch` at [:157](../../../src/components/PendingEmailQueueRunner.jsx)).
- `CountdownToast` shows `heldReason` rather than a countdown when set, and held items collapse to one summary toast (§6.1).
- Per the lane's convention, any "no API call" assertion needs `await act(async () => {})` first, or it cannot fail.

## 13. Security & compliance

- **CAN-SPAM:** every gated email carries a real sender-of-record and postal address, enforced at send time rather than trusted.
- **Licensing:** each agent's own NPN, or no outreach send (§0; §6's `npn` requirement). *(Compliance flags are informational, not legal advice; flagged for human review.)*
- **Impersonation:** applies to the own-domain lane only (§5) — the shared lane's `From` is always PRIM's domain, so no agent can place mail on another agency's domain; the body identity is their own, gate-enforced. Mailbox confirmation is Phase 2.
- **Open relay:** the `welcome` self-send lock ([route.js:197-202](../../../src/app/api/email/send/route.js)) is retained unchanged — the gate's welcome bypass returns ok for that kind and does not replace the lock.
- **Suppression is checked before the gate**, so opt-outs are honored even for unconfigured agents.
- **Failure posture:** identity-read errors fail closed (503, queue reschedules). Domain-lookup errors fail **to the shared lane** — never to an unverified `From`, and never to a blocked send. A Resend outage can reroute mail; it cannot stop it and cannot forge it.
- **Tier enforcement is server-side and unchanged** ([route.js:176-188](../../../src/app/api/email/send/route.js)) — the sender gate composes after it; neither replaces the other.
- **No secrets client-side:** the Resend key stays server-only; the UI reads `/api/email/sender-status`, which serves only the caller's own identity.
- **Sanitization:** `bannerUrl` is agent-supplied and interpolated into HTML — it must be validated as an `https:` URL and attribute-escaped. It is the only free-form field that reaches markup in Phase 1. (Phase 2's HTML authoring needs a real sanitizer; noted in §14.)
- The three exempt system paths are untouched, so ticket, onboarding and reminder mail survive any failure of this feature.
- Blast capture path untouched.

## 14. Open items for Juan

1. **Is `RESEND_API_KEY` full-access or send-only?** (D7) Now decides only whether the **own-domain lane** works via the API or needs the fallback table — sending itself is unaffected either way (§5). No longer blocking; confirm when convenient.
2. **What is `RESEND_FROM_ADDRESS` set to?** It becomes the shared lane's `From` mailbox on most agents' mail (with their display name). Confirm the mailbox and domain are what you want representing them — and that it is not still the `onboarding@resend.dev` fallback ([route.js:314](../../../src/app/api/email/send/route.js)).
3. ~~Outreach Team+ or Pro?~~ **RESOLVED 2026-07-29: "Pro can use any email feature."** `outreach_emails.requiredTier` moves `'team'` → `'pro'` ([featureFlags.js:93](../../../src/lib/featureFlags.js)), in scope for this build with its test update (§12).
4. **Two non-identity claims** (§7.4) — the two-hour turnaround promise, and "Licensed Independent Insurance Agency". Each: leave, soften, or make per-agent? The licensing claim is the one worth a second look.
5. **Michael's address** — is `1550 Sawgrass Corporate Expressway, Sunrise FL 33323` HealthServicesPro's, to be entered as *his* identity? (Assumed yes.) It is one word from the hardcoded `1550 Sawgrass Corporate Pkwy` in `outreachEmails.js` — worth confirming which is correct for whom.
6. **Run the §10 query** — it sizes the walkthrough population (entitled agents), not a broken one.
7. `LEGAL.mailingAddress` is still `''` and still shows the placeholder on the **legal pages**. Out of scope here, still open.

**Phase 2 backlog (separate specs):** per-agent template authoring with HTML sanitization and a migration for the existing three; per-agent banner upload; one-time `fromAddress` mailbox confirmation.
