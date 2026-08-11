# Subscription Enforcement & Payment-Failure Lockout — Design Spec

**Date:** 2026-08-02
**Revision:** 3 (rev 1: 2 critical + 4 major; rev 2 review caught 1 more critical + 1 module-hazard I introduced — all confirmed against source and folded in. The rev-1 critical would have locked Juan's own account out; the rev-2 critical would have made the day-3 lockout never fire on the client.)
**Status:** Awaiting Juan's sign-off.
**Origin:** Juan, 2026-08-02 — trial abusers keep full access after their card fails post-trial; enforcement is client-side only. Wants: trial → degraded grace → hard lockout, and restricted payment methods at signup.

> **Not legal advice.** Billing + account-lockout logic. A bug here either locks out a paying agent or hands out free access, so this spec goes through the same adversarial review that caught the supabase-error bug and the Julio-NPN exposure before any code.

---

## 0. What's true today (verified against code)

- **A bare signup is already blocked.** `handle_new_user` ([schema.sql:206](../../../supabase/schema.sql)) creates a profile with only `id` + `email` — `subscription_status` is NULL, and `hasActiveSubscription(null)` returns false ([subscription.js:31-42](../../../src/lib/subscription.js)). The 7-day trial only exists via Stripe Checkout, which requires a card (`payment_method_collection: 'always'`, [create-checkout-session:105](../../../src/app/api/stripe/create-checkout-session/route.js)). "Sign up, peek, never pay" already hits the paywall on first login. **This spec does not change that — it's already correct.**
- **`past_due` grants full access with no time limit.** `hasActiveSubscription` returns `true` for `past_due` — comment: *"grace period — gate elsewhere if needed"* ([subscription.js:40](../../../src/lib/subscription.js)) — and there is no "elsewhere." A card-failing agent keeps full access through Stripe's entire dunning window (~2-4 weeks). **This is the leak.**
- **Enforcement is 100% client-side.** Every RLS policy gates on `auth.uid() = user_id` only; **no policy references subscription status** ([schema.sql:117-190](../../../supabase/schema.sql)). Server AI/email routes check *tier* (`canAccessBetaFeature`) but never *"is this subscription still valid."* A determined expired user retains read/write to **their own** data (valid auth token + direct Supabase calls). Scope: revenue-leak / cost-leak, **not** a cross-tenant breach — RLS still isolates other agents' data.

## 1. Decisions (locked with Juan 2026-08-02)

| # | Decision |
|---|---|
| D1 | **Three access levels, not two:** FULL (trialing-valid / active / complimentary), BASIC (past_due within grace), LOCKED (grace expired / canceled / unpaid). |
| D2 | **Grace = 3 days** of BASIC access after the first failed payment, then LOCKED. |
| D3 | **BASIC = direct-database features only.** No AI, no email sending, no paid server features. Viewing, manual entry, CPA dashboard, books all work. |
| D4 | **LOCKED = pay-only wall.** The agent can still authenticate, but the app renders *only* an "update payment to continue" screen. On successful **card** payment they are unlocked immediately (card-only at launch — D6/§5); NOT a literal auth-layer block. |
| D5 | **Server enforcement is required, not just the client wall.** The paid server routes reject when access isn't FULL — this is what actually stops a bypasser spending money on AI/email. |
| D6 | **Payment methods restricted to CARD only at launch** (credit + debit). Cash App Pay, Venmo, other wallets disabled. **ACH (`us_bank_account`) is DEFERRED** — its 3-4-day settlement collides with the 3-day grace and can lock out a paying agent (§6); ship it only after verifying Stripe's status during ACH `processing`. Chime cannot be blocked specifically (§6). |
| D7 | **The grace clock is an explicit `past_due_since` timestamp**, stamped by the webhook — NOT inferred from Stripe period fields (§4). |

## 2. The access model — one pure module

New `src/lib/subscriptionAccess.mjs` — **pure and client-safe** (no React, no fetch, no server imports), so it is safe to import from client components (`featureFlags`, `PaywallGate`) AND fully exercised by the node lane. It exports `accessLevel`, `isFull`, `isLocked`, `hasBasicOrBetter`, the `hasActiveSubscription` alias, `GRACE_DAYS`, `ACCESS`. **The server-only enforcement helper `requireFullAccess` does NOT live here** (§3) — putting it here would drag `stripe-server.js` (Stripe SDK + service-role key) into the client bundle through the `featureFlags → subscriptionAccess` import chain. That is the exact hazard `featureFlags.js:5-11` was architected to avoid.

`hasActiveSubscription` is **kept as a thin alias** (`=== 'full'`) so existing callers don't break. Callers to know (N-10, corrected in round 2): exactly two — `PaywallGate.jsx:104` (rewritten, §5) and `Profile.jsx:550` (feeds the `:621` "Next bill" notice — now hides for past_due; cosmetic, benign; "Manage billing" at `:635` is gated on `stripe_customer_id` not status, so a locked user still reaches the portal — verified safe). `TrialBanner` never calls it.

**CRITICAL — the client must actually be able to reach LOCKED (was a rev-2 finding).** `accessLevel` reads `profile.past_due_since`, but `useSubscription`'s SELECT ([subscription.js:91-93](../../../src/lib/subscription.js)) does **not** fetch it today. Left unchanged, every client-side `past_due` profile returns BASIC forever — the `<PaymentWall>` never renders, the day-3 lockout never fires, and `{daysLeft}` is uncomputable. **`past_due_since` MUST be added to the `useSubscription` SELECT** (and to `PaywallGate`'s own profile read if it has one). This is the one change that makes the client enforcement real; without it the whole feature silently no-ops the lockout.

```
export const GRACE_DAYS = 3;
export const ACCESS = { FULL: 'full', BASIC: 'basic', LOCKED: 'locked' };

// The single source of truth. `now` is injected for testability.
export function accessLevel(profile, now = Date.now()) {
  if (!profile) return ACCESS.LOCKED;                        // signed out / no profile

  // PRIVILEGED BYPASSES — must MIRROR canAccessBetaFeature (featureFlags.js:117,123)
  // exactly, or this gate locks out accounts the rest of the app treats as
  // privileged. is_admin is the operator's own account; is_complimentary is
  // the ~3 hand-picked partners. Both get FULL regardless of subscription.
  if (profile.is_admin === true) return ACCESS.FULL;
  if (profile.is_complimentary === true) return ACCESS.FULL;

  const s = profile.subscription_status;

  if (s === 'active') return ACCESS.FULL;

  if (s === 'trialing') {
    if (!profile.trial_ends_at) return ACCESS.FULL;          // no end recorded → valid trial
    if (new Date(profile.trial_ends_at).getTime() > now) return ACCESS.FULL;
    // EXPIRED trialing → FULL (safety net, see below). Stripe moves a real
    // failed trial to past_due within seconds; a stuck 'trialing' means OUR
    // webhook lagged, and locking a just-charged paying agent over that is
    // the worse error. Abusers do not durably live here.
    return ACCESS.FULL;
  }

  if (s === 'past_due') {
    if (!profile.past_due_since) return ACCESS.BASIC;        // failed, clock not stamped yet
    const graceEnds = new Date(profile.past_due_since).getTime() + GRACE_DAYS * 86400_000;
    return now < graceEnds ? ACCESS.BASIC : ACCESS.LOCKED;   // strict < : at exactly +3d → LOCKED
  }

  // canceled | unpaid | incomplete | incomplete_expired | null | anything else
  return ACCESS.LOCKED;
}

export const isFull   = (p, now) => accessLevel(p, now) === ACCESS.FULL;
export const isLocked = (p, now) => accessLevel(p, now) === ACCESS.LOCKED;
export const hasBasicOrBetter = (p, now) => accessLevel(p, now) !== ACCESS.LOCKED;
```

**CRITICAL correction from rev 1 — privileged bypasses (was CRITICAL-1).** Rev 1 exempted only `is_complimentary`. But `canAccessBetaFeature` ([featureFlags.js:117,123](../../../src/lib/featureFlags.js)) grants access to **`is_admin` AND `is_complimentary`** — and the 6 AI import routes have *no* tier gate today, so inserting a complimentary-only gate before them would newly 402 any admin, **including Juan's own operator account**, out of imports/chat/email and trap them behind the PaymentWall. `accessLevel` must honor the same two flags. (The per-*feature* `betaAllowlist` at [:126](../../../src/lib/featureFlags.js) is deliberately NOT mirrored: it is a beta-feature mechanism scoped to one feature, not a global access grant — but see §11.1, Juan must confirm his testing accounts carry `is_admin` or `is_complimentary`, which they near-certainly do.)

**Expired `trialing` → FULL (was CRITICAL-2 — a self-contradiction in rev 1).** Rev 1's code returned LOCKED here while its prose argued FULL — an implementer couldn't tell which, and they have opposite money-risk. Resolved to **FULL**: at trial→paid conversion the *only* sync is the webhook ([webhook/route.js](../../../src/app/api/stripe/webhook/route.js)); if it lags during a Stripe incident, the DB sits at `trialing`+expired and LOCKED would wall a paying agent with no auto-recovery. A real failed trial goes to `past_due` (gated hard) within seconds, so FULL here does not create a durable abuser hole. Residual — and it needs a REAL mechanism, not a hand-wave (round-2 review caught the first draft claiming mitigations that didn't exist): a persistently stuck `trialing` would otherwise be permanent free FULL access. Mitigation, actually wired: **PaywallGate fires `refresh-subscription` once per session when it sees `subscription_status === 'trialing' && trial_ends_at < now`** (throttled via a sessionStorage flag) — the route re-pulls Stripe truth and the row converges to `active`/`past_due` within one app open. Plus the §9 rollout step measures how many such rows exist today and remediates them at deploy.

## 3. What BASIC blocks, precisely (D3)

The line is **server route = paid, direct Supabase CRUD = basic**. It maps cleanly to the two paid surfaces already enumerated:

**BLOCKED in BASIC and LOCKED** (every paid server route):
| Route | Cost |
|---|---|
| [import-leads-ai](../../../src/app/api/import-leads-ai/route.js), [import-prospects-ai](../../../src/app/api/import-prospects-ai/route.js), [import-expenses-ai](../../../src/app/api/import-expenses-ai/route.js) | Anthropic |
| [parse-statement-ai](../../../src/app/api/parse-statement-ai/route.js), [extract-screenshot-ai](../../../src/app/api/extract-screenshot-ai/route.js), [recategorize-ai](../../../src/app/api/recategorize-ai/route.js) | Anthropic |
| [chat](../../../src/app/api/chat/route.js), [followup-draft](../../../src/app/api/followup-draft/route.js) | Anthropic |
| [textdrip/extract-conversation](../../../src/app/api/textdrip/extract-conversation/route.js) | Anthropic |
| [email/send](../../../src/app/api/email/send/route.js) | Resend |

**STILL WORKS in BASIC** (direct Supabase CRUD via RLS): leads, prospects, books, investments, activities, CPA dashboard, manual entry, CSV export, viewing everything.

**EXEMPT — never gated by subscription** (not agent-initiated spend):
| Route | Why |
|---|---|
| [webforms/webhook/[token]](../../../src/app/api/webforms/webhook/[token]/route.js) | Inbound lead from the agent's own site — token-authed, not a logged-in action. Blocking it drops leads the agent is paying to capture. |
| [reminders](../../../src/app/api/reminders/route.js) | Vercel cron, system mail. |
| [tickets](../../../src/app/api/tickets/route.js) → `ticketEmails.js` (Resend) | **Support email — MUST stay open to LOCKED users** (N-8): a locked agent needs support to fix their payment. Wrapping this would trap them. |
| ringy / benepath / blast webhooks | Blast capture path — **never touched** (standing rule). |
| stripe/* | Billing itself — must work while locked so they can pay. |

**Enforcement mechanism (D5).** A shared **server-only** helper in a new `src/lib/subscriptionGate.server.mjs` (NOT in the client-safe `subscriptionAccess.mjs` — see §2). It imports `getSupabaseAdmin` from `stripe-server.js` and `accessLevel` from `subscriptionAccess.mjs`:

```js
// server-only: builds its OWN admin client (getSupabaseAdmin) — the 6 import
// routes build no service client today (import-leads-ai/route.js:256-258 is
// requireUserId only), so the helper must be self-contained (N-7). The SELECT
// MUST include every field accessLevel reads.
export async function requireFullAccess(userId) {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin, is_complimentary, subscription_status, trial_ends_at, past_due_since')
    .eq('id', userId)
    .maybeSingle();
  if (error || !profile) return { ok: false, level: 'locked', transient: true }; // FAIL CLOSED
  const level = accessLevel(profile);
  return level === ACCESS.FULL ? { ok: true, level } : { ok: false, level };
}
```

Each paid route, after its existing `requireUserId`, adds:

```js
const access = await requireFullAccess(userId);
if (!access.ok) {
  return Response.json(
    { error: 'Your subscription is not active. Update your payment method to use this feature.',
      accessLevel: access.level, subscriptionRequired: true },
    { status: 402 } // Payment Required — distinct from 401 auth and 403 tier
  );
}
```

*(`email/send` builds its own client + SELECT already ([route.js:146](../../../src/app/api/email/send/route.js)) — it already selects `is_admin`/`is_complimentary`; only add `past_due_since`. Call `accessLevel` on that in-hand profile rather than a second round-trip.)*

**402 Payment Required**, deliberately distinct from the tier gate's 403 and auth's 401, so the client routes it to the pay-wall unambiguously.

**`chat` — different wiring, and one honest hole (was MAJOR-5).** `chat` auth is *optional* ([chat/route.js:121,153](../../../src/app/api/chat/route.js)) — it has no `requireUserId`, so the "add after requireUserId" pattern doesn't apply verbatim. Instead: **run `requireFullAccess` only when a `userId` is present**; a token-less call keeps today's anonymous public behavior (the Anthropic call runs with no data tools). Consequence, stated plainly: a BASIC/LOCKED agent who *strips the Authorization header* drops to the same generic assistant any anonymous visitor gets — a deliberate technical bypass, not normal use (the signed-in app always sends a token). **ASSUMPTION:** accept this; the token-less tier can't touch the agent's data and is the existing public behavior. If that spend is unacceptable, require auth on `chat` outright — §11.5.

## 4. The grace clock — `past_due_since` (D7)

New column: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;` (its own migration file).

**The stamp/clear logic must live in ONE shared writer, not just the webhook (was MAJOR-4).** Rev 1 put it only in `syncSubscription`. But two other paths write the profile from a subscription — `sync-after-checkout` ([:86](../../../src/app/api/stripe/sync-after-checkout/route.js)) and the new `refresh-subscription` (§5) — and both call `subscriptionToProfileFields` ([stripe-server.js:119-132](../../../src/lib/stripe-server.js)), which does **not** touch `past_due_since`. If recovery flows through one of those, `past_due_since` is never cleared → a stale timestamp survives → a *later* second failure reuses the old `t0`, `graceEnds` is already in the past, and the agent is **locked out instantly with no grace**. So the lifecycle is centralized:

```
// New shared helper (stripe-server.js), used by webhook, sync-after-checkout,
// AND refresh-subscription — every subscription→profile writer. Third arg is
// the RAW existing timestamp (string|null), not a profile object — callers
// pass profile.past_due_since. (Signature unified with the plan after a
// round-2 review caught the two documents disagreeing; a mismatch here
// re-stamps on every dunning retry = infinite grace.)
export function applySubscriptionFields(subscription, priceIdToTier, existingPastDueSince) {
  const fields = subscriptionToProfileFields(subscription, priceIdToTier);
  if (fields.subscription_status === 'past_due') {
    fields.past_due_since = existingPastDueSince || new Date().toISOString(); // stamp once
  } else {
    fields.past_due_since = null; // active/canceled/trialing/anything → clear
  }
  return fields;
}
```

All three writers must first read the existing `past_due_since` (the webhook's profile lookup at [:59-63](../../../src/app/api/stripe/webhook/route.js) adds it to its `.select`; the other two do the same) and pass it in. Stamp-once/no-reset is safe because `syncSubscription` re-fetches the canonical subscription ([:45](../../../src/app/api/stripe/webhook/route.js)), so out-of-order `invoice.payment_failed` vs `subscription.updated` events converge on the same status.

**Why not infer from `current_period_end`:** during dunning, whether Stripe advances it depends on subscription settings and API version (it moved to the item level in recent versions). An explicit stamp is unambiguous and survives Stripe API changes. One column is cheap insurance on lockout correctness.

**Backfill for agents already `past_due` at deploy:** a one-time SQL `UPDATE profiles SET past_due_since = now() WHERE subscription_status = 'past_due' AND past_due_since IS NULL;` — gives anyone currently mid-dunning a fresh 3-day grace from deploy rather than instant lockout (fair, and avoids a support storm). Juan runs it right after deploy; §9.

## 5. Client gate — three states in PaywallGate

`PaywallGate` ([PaywallGate.jsx](../../../src/components/PaywallGate.jsx)) currently: `hasActiveSubscription(profile) ? children : <PaywallScreen>`. Becomes a three-way on `accessLevel`:

- **FULL** → `children` (unchanged).
- **BASIC** → `children` **plus** a persistent non-dismissible banner: *"Your payment failed. You have {daysLeft} days of limited access — AI features and email are paused until you update your payment."* + "Update payment" button. Paid features are already blocked server-side (§3); the client also disables their buttons with the same reason for a clean UX (no click-then-402).
  - **This requires fixing `featureFlags.js` too (was MAJOR-6).** `canAccessBetaFeature` uses its *own inlined* `hasActiveSubscription` ([featureFlags.js:39-50](../../../src/lib/featureFlags.js)) which returns **true for `past_due`** ([:48](../../../src/lib/featureFlags.js)). Left as-is, a BASIC agent's client-side feature checks report AI/email as *accessible* — buttons render enabled, contradicting the server 402. Replace that inlined check with `isFull` from `subscriptionAccess.mjs` (past_due-in-grace → not full → feature not accessible), keeping the admin/complimentary/allowlist bypasses above it intact. `featureFlags.js` is therefore a changed surface with its own test. **While here, fix the now-stale comment at [useBetaFeature.js:18-22](../../../src/lib/useBetaFeature.js)** — it claims `useSubscription`'s profile "doesn't include `is_admin`" and that an allowlist workaround is in place; `subscription.js:93` already selects `is_admin`, so the comment misleads a future reader into re-adding allowlist entries as an admin workaround.
- **LOCKED** splits by whether there is a *recoverable subscription* (plan-review finding — without this split, `canceled` users hit a dead end where the portal has nothing to update and no path back to checkout exists):
  - `subscription_status` is `null`, `canceled`, or `incomplete_expired` → the existing `PaywallScreen` (pricing pitch + `/pricing` redirect) — these users need a **new** checkout, and `/pricing` is already public ([routeAccess.mjs:3](../../../src/lib/routeAccess.mjs)).
  - `past_due` (grace expired) or `unpaid` → the new `<PaymentWall>`: explains the lockout, "Update payment method" (Customer Portal via [openCustomerPortal](../../../src/lib/subscription.js)) and "I've paid — recheck". **No "See plans" link** (round-2 correction: these two statuses have a *live* subscription, so `/pricing` → checkout would 409 `already_subscribed` at [create-checkout-session:71-79](../../../src/app/api/stripe/create-checkout-session/route.js) — a loop, not an escape hatch; the portal is the correct and sufficient path). No app chrome, no data.

The existing post-checkout `?session_id=` sync path ([PaywallGate.jsx](../../../src/components/PaywallGate.jsx)) stays. LOCKED must NOT trap a complimentary or active user — guaranteed because `accessLevel` returns FULL for both before LOCKED is ever reached.

**Recovery (D4):** returning from the portal doesn't carry a `session_id`. New route `POST /api/stripe/refresh-subscription` re-fetches the live subscription from Stripe (list by customer, as [create-checkout-session:66](../../../src/app/api/stripe/create-checkout-session/route.js) already does) and re-runs `applySubscriptionFields` (§4), so a just-paid agent is re-evaluated within one round-trip instead of waiting on webhook eventual consistency. The PaymentWall's "I've paid — recheck" calls it, then `refresh()`.

**Recovery is instant because launch is card-only (§6).** A card payment confirms synchronously → the sub flips to `active` → `refresh-subscription`'s re-pull returns FULL → unlocked in one round-trip. (This is *why* ACH is deferred: a bank payment would leave the sub `past_due`/`processing` for days, so "recheck" would keep the agent locked after they paid — see §6. When ACH is eventually added, the PaymentWall needs settlement-aware copy and the grace clock must pause during `processing`.)

## 6. Payment methods (D6)

In `create-checkout-session` ([:93](../../../src/app/api/stripe/create-checkout-session/route.js)) add:

```js
payment_method_types: ['card'],   // launch: card only (credit + debit). See ACH note.
```

This makes **only** cards appear — Cash App Pay, Venmo, Link, and other wallets disappear regardless of dashboard settings. A single credit-or-debit card covers "actual card, debit card."

**ACH deferred, and why it's not just a config flag (was MAJOR-3 + a rev-2 finding).** Adding `us_bank_account` would satisfy "or banking info," but ACH settles in **3-4 business days**, and that collides with the 3-day grace in two places:
- **Recovery:** a LOCKED agent who pays by bank stays LOCKED until settlement — the opposite of "instant unlock."
- **Trial conversion:** if Stripe marks the subscription `past_due` while a first ACH charge is `processing` at trial end, the webhook stamps `past_due_since`, the 3-day clock starts, and an agent who **did** pay can be LOCKED at day 3 while their money is still settling — over a weekend, guaranteed.

Whether Stripe holds the sub `active` vs flips it `past_due` during ACH `processing` is version/config-dependent and **not verifiable from the repo**. So ACH ships only after that behavior is confirmed *and* the grace clock is taught to pause while a payment is `processing`. Until then, **card only** — which keeps "instant unlock" honest and removes the whole lock-out-a-payer class. §11.2.

**No repeat trials (plan-review discovery — directly serves the original ask).** Today `create-checkout-session` sets `trial_period_days: TRIAL_DAYS` unconditionally, and its double-subscribe guard ([:71-79](../../../src/app/api/stripe/create-checkout-session/route.js)) only blocks *live* subscriptions — so a `canceled` customer can re-checkout and receive **another 7-day free trial**, indefinitely. That is precisely the "taking advantage of trying it for 7 days" behavior this spec exists to stop. Fix: the route already lists the customer's subscriptions; if **any** prior subscription exists (any status), omit the trial — they've had theirs, the new subscription bills immediately. First-ever checkout is unchanged.

**Purchase-flow copy must change with it *(compliance flag — informational, not legal advice; human review before merge)*.** [pricing/page.jsx:47,156](../../../src/app/pricing/page.jsx) and [PaywallGate.jsx:145](../../../src/components/PaywallGate.jsx) unconditionally say "Start {TRIAL_DAYS}-day free trial." After this change, a returning canceled customer clicks that button and is **charged immediately** — a negative-option/auto-renewal disclosure exposure (FTC ROSCA; state auto-renewal statutes require the actual charge be disclosed pre-purchase). The client can't know per-user trial eligibility without a lookup, so the copy becomes accurate-for-everyone: **"7-day free trial for new customers."** Stripe's own hosted checkout page then shows each user their true terms (trial vs. immediate charge) before they confirm — that page is the point of purchase.

**Chime — stated plainly, cannot be blocked.** A Chime card is a Visa **debit** card; Stripe reports it as `card` / `funding: 'debit'`, indistinguishable from any bank debit card. There is no reliable "is Chime" signal. Blocking prepaid cards (`card.funding === 'prepaid'`) would NOT catch most Chime cards (they're debit, not prepaid) and WOULD reject legitimate prepaid users. **ASSUMPTION (Juan to confirm): do NOT block prepaid** — accept that Chime debit rides the normal card rail. §11.3.

## 7. Error handling

| Condition | Server | Client |
|---|---|---|
| Paid route, access BASIC or LOCKED | 402 `{ subscriptionRequired, accessLevel }` | banner (basic) or wall (locked); paid buttons pre-disabled |
| **Queued post-sale email hits the 402** | — | **The queue HOLDS (reschedules), never `failed`** — [PendingEmailQueueRunner.jsx:183](../../../src/components/PendingEmailQueueRunner.jsx) adds 402 to its hold condition (today 428/503 only). Without this, a card failure on Monday permanently burns every queued client email before the agent fixes their card Wednesday — the same silent-burn class the sender-identity work eliminated. |
| Paid route, access FULL | proceeds | unchanged |
| Profile load fails in `requireFullAccess` | **fail CLOSED → 402** (transient rechecks on next call; never hand out a paid AI call on an unreadable subscription) | generic "try again" |
| `refresh-subscription` Stripe error | 503 | "Couldn't verify — try again shortly"; stays locked |
| Webhook can't stamp past_due_since | logged; status still written | grace falls back to BASIC until stamped (fail-open to basic, never to locked, on a webhook glitch) |

Invariant: **a subscription-read failure never grants a paid action, and never hard-locks a user whose only problem is our webhook.**

## 8. Testing

`npm run test:all` — node lane 683, ui lane 86 baseline, both must stay green.

**`subscriptionAccess.test.mjs`** (node, injected `now`) — the heart of it:
- **`is_admin` → FULL regardless of status/dates** (the CRITICAL-1 guard — a canceled admin must NOT be locked; assert with `subscription_status: 'canceled'`).
- **`is_complimentary` → FULL** regardless of status/dates.
- active → FULL.
- trialing + future end → FULL; **trialing + PAST end → FULL** (the safety net — assert explicitly, since this is the CRITICAL-2 resolution and its money-risk is real); trialing + no end → FULL.
- past_due + no `past_due_since` → BASIC.
- past_due + `past_due_since` 2 days ago → BASIC; **exactly at +3 days** → LOCKED (assert the strict `<`); 4 days ago → LOCKED.
- canceled / unpaid / incomplete / null / garbage status → LOCKED.
- `hasActiveSubscription` alias returns true only for FULL (protects existing callers).
- **Mutation checks:** remove the `is_admin` bypass → the canceled-admin test goes red (this is the one that would have walled Juan); flip the grace comparison to `<=` → the boundary test goes red; make past_due default to FULL → the leak test goes red.

**`requireFullAccess`** (self-contained, builds its own admin client): FULL → `{ok:true}`; BASIC/LOCKED → `{ok:false, level}` → route 402; unreadable/absent profile → `{ok:false, transient:true}` (fail closed), asserted. Its SELECT includes all five fields `accessLevel` reads — assert a profile missing `past_due_since` doesn't crash (treated as BASIC/whatever status dictates).

**`applySubscriptionFields`** (§4, node-testable pure): past_due + no prior → stamps `past_due_since=now`; past_due + prior `t0` → keeps `t0` (no reset); active/canceled/trialing → clears to null. **Mutation:** make it reset on every past_due event → the "keeps t0" test goes red (that bug = infinite grace); drop the clear-on-recovery → the "active clears it" test goes red (that bug = the MAJOR-4 skip-grace lockout).

**`featureFlags`** (extend `featureFlags.test.mjs`): a past_due-in-grace profile → `canAccessBetaFeature` returns **not** accessible for a paid feature (BASIC blocks features client-side); admin/complimentary/allowlist still bypass. Mutation: revert to the inlined `past_due→true` → the BASIC test goes red.

**Component (ui lane):**
- PaywallGate: FULL renders children; BASIC renders children + banner with correct days-left; LOCKED renders only the wall (assert no app content, exactly one primary action).
- A paid-feature button in BASIC is disabled with the reason (mutation: enable it → red).
- **Recovery:** mocked `refresh-subscription` flips access FULL → wall disappears.

**Webhook** (logic extracted pure where possible): first past_due stamps `past_due_since`; a second past_due event does NOT reset it; recovery to active clears it. Mutation: make it reset on every event → the "don't reset on retries" test goes red (that bug would give infinite grace).

## 9. Rollout

1. **Migration first:** add `past_due_since` column (idempotent `IF NOT EXISTS`).
2. **Backfill — REQUIRED, not optional (N-9):** the same migration file ends with `UPDATE profiles SET past_due_since = now() WHERE subscription_status = 'past_due' AND past_due_since IS NULL;` so currently-past_due agents get a fresh 3-day grace from deploy, not instant lockout. Folding it into the migration means it can't be forgotten.
3. **Measure BEFORE deploy:** `SELECT subscription_status, count(*) FROM profiles GROUP BY 1;` — how many are trialing / active / past_due / canceled right now, so the lockout blast radius is known. **Also confirm Juan's own account carries `is_admin = true`** (§11.1) — the one query that proves he won't lock himself out.
4. Merge, deploy, confirm `/api/version`.
5. **Stripe dashboard (Juan, out-of-band):** confirm card + ACH enabled, wallets off; confirm dunning retry settings and the "when all retries fail" behavior (cancel vs unpaid) — both map to LOCKED, but worth knowing.

**Deliberately no `[announce]`** unless Juan wants one — this tightens enforcement rather than shipping a visible feature; the agents it affects are the ones who should already be paying.

## 10. Security & compliance

- **Server-side is the real gate** (§3, D5); the client wall is UX. A bypasser can still read their **own** cached data (revenue leak, not breach) — closing that fully needs RLS-level subscription checks, which is a **separate, higher-risk spec** (a bad policy locks out paying agents). Explicitly out of scope here; noted so it's a decision, not an omission.
- **Fail closed** on every subscription-read error in a paid route; **fail open to BASIC** (never LOCKED) on a webhook stamping glitch.
- **Billing routes always reachable** while locked, or an agent can never recover.
- Blast capture path untouched.
- No PHI, no new personal data collected.

## 11. Open items for Juan

1. **Confirm your own account is safe** (the CRITICAL-1 lesson) — `accessLevel` grants FULL to `is_admin` and `is_complimentary` only, NOT the per-feature email allowlist. Your operator account near-certainly has `is_admin = true`; the §9.3 query confirms it before deploy. If any account you test from has *neither* flag, it will be walled when its sub lapses — flag it and I'll widen the bypass.
2. ~~ACH?~~ **RESOLVED 2026-08-02: "Card-only for launch is fine."** ACH remains a scoped follow-up (verify Stripe's `processing` status semantics + pause the grace clock during settlement) if ever wanted.
3. **Prepaid cards** (§6) — confirm: do NOT block them (Chime can't be caught anyway, and blocking prepaid hurts legit users). Say so if you want prepaid blocked despite that.
4. **Backfill grace (§9.2)** — confirm currently-past_due agents get a fresh 3-day grace from deploy (recommended) rather than immediate lockout.
5. **`chat` token-strip hole (§3)** — accept that a signed-in agent who deliberately drops their auth header falls to the anonymous public assistant (no data, existing behavior), or require auth on `chat` outright? Recommend accept.
6. ~~Complimentary + admin?~~ **RESOLVED 2026-08-02: Juan — "make sure users that were granted full complimentary access don't get affected by any of this."** Elevated to a named invariant: **complimentary (and admin) accounts must be provably unaffected at every layer** — `accessLevel` (checked before any status logic), `requireFullAccess`, `featureFlags`, `PaywallGate`, and the client profile query (`is_complimentary` already in the [subscription.js:93](../../../src/lib/subscription.js) SELECT). The implementation plan carries a dedicated test at each layer plus a live check on a complimentary account before merge.
```
