# Subscription Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 3.** Rev 1: 10 blocking findings (undefined identifiers at insertion points; the reviewer PROVED build+lint pass with undefined identifiers in routes, so grep assertions are the real gate). Rev 2: 5 more (an inert queue fix eliding a load-bearing conjunct; a plan↔spec signature conflict; a claimed mitigation that didn't exist; a non-self-contained module reference; a variable-scoping ReferenceError in checkout). This revision is **fully self-contained** — every module body is inline — and both docs are committed to git immediately (rev 1 was lost to an in-place overwrite of an untracked file; that never happens again).

**Goal:** Trial → 3-day BASIC grace on payment failure → pay-only LOCKED wall, enforced server-side on every paid route, card-only checkout, no repeat trials — complimentary/admin accounts provably untouched at every layer.

**Spec (authoritative):** `docs/superpowers/specs/2026-08-02-subscription-enforcement-design.md` (rev 3 + round-2 refinements: unified `applySubscriptionFields` signature, wired trialing self-heal, PaymentWall without "See plans", purchase-copy compliance note). On conflict, the spec wins — stop and flag.

**Baselines:** node **683** / ui **86**.

## THE COMPLIMENTARY INVARIANT (Juan: "make sure users that were granted full complimentary access don't get affected by any of this")

Asserted at five layers: (1) `accessLevel` comp/admin-first — Task 1; (2) `requireFullAccess` + the `GATE_FIELDS`-pinned SELECT — Tasks 1/4; (3) `featureFlags` bypasses — Task 6; (4) `PaywallGate` render — Task 7; (5) live on a complimentary account — Task 11. Honest exception (spec §7): fail-closed means a transient DB read error 402s one request even for comp/admin; retry succeeds; accepted.

**Hard rules:** (1) both lanes green before every commit; (2) npm/npx via Bash tool; (3) control-byte check per file; (4) mutations RED→restore→GREEN; (5) never touch blast paths / ticketEmails / welcomeEmails / reminders / webforms; (6) exact commits, no push before Task 10; (7) code-vs-plan conflict → STOP; (8) **build+lint cannot see undefined identifiers — the per-task grep gates are mandatory.**

---

## File map

| File | Action |
|---|---|
| `src/lib/subscriptionAccess.mjs` + `.test.mjs` | **Create** |
| `supabase/past-due-since-migration.sql` | **Create** |
| `src/lib/stripe-server.js` + **`src/lib/stripe-server.test.mjs`** | Modify / **Create** |
| `src/app/api/stripe/webhook/route.js`, `sync-after-checkout/route.js` | Modify |
| `src/app/api/stripe/refresh-subscription/route.js` | **Create** |
| `src/lib/subscriptionGate.server.mjs` | **Create** |
| 8 uniform paid routes + `chat` + `email/send` | Modify |
| `src/components/PendingEmailQueueRunner.jsx` + `.test.jsx`, `src/lib/pendingEmailQueue.js` | Modify |
| `src/lib/featureFlags.js` + `.test.mjs`, `src/lib/useBetaFeature.js` | Modify |
| `src/lib/subscription.js` | Modify |
| `src/components/PaywallGate.jsx` + **`.test.jsx`** | Modify / **Create** |
| `src/app/api/stripe/create-checkout-session/route.js`, **`src/app/pricing/page.jsx`** | Modify |

---

### Task 0: Branch + baseline + docs committed
- [ ] `git checkout main && git pull --ff-only && git checkout -b feature/subscription-enforcement`
- [ ] **Commit the spec + this plan FIRST** (`docs: subscription enforcement spec + plan`) — review history must be recoverable.
- [ ] `npm run test:all` → node 683 / ui 86; build green. STOP if not.

### Task 1: `subscriptionAccess.mjs` (TDD)
- [ ] **1.1 Failing tests first** (`subscriptionAccess.test.mjs`; `const NOW = Date.parse('2026-08-02T12:00:00Z')`; every call passes `NOW`): the invariant block (comp/admin FULL incl. canceled + stale-stamped); active→FULL; trialing (future/past/no end)→FULL; past_due no-stamp→BASIC, 2d→BASIC, exactly−3d→LOCKED (strict `<`), 4d→LOCKED; canceled/unpaid/incomplete/incomplete_expired/null/'garbage'/`accessLevel(null)`→LOCKED; alias⟺FULL; `graceDaysLeft` (NOW→3, 2.5d→1, ≥3d→0, no-stamp→null, status≠past_due→null); `applyPastDueStamp` (stamps ISO(NOW) / keeps t0 / clears); `gateFromProfile` (error→locked+transient, null→same, FULL→ok, BASIC/LOCKED→not-ok+level); `GATE_FIELDS` deep-equals the five columns.
- [ ] **1.2** RED (module missing). **1.3 Implement — the complete module:**

```js
/**
 * Subscription access resolver — pure and CLIENT-SAFE (no React, no fetch,
 * no server imports). Consumed by featureFlags + PaywallGate (client) and
 * subscriptionGate.server.mjs (server); fully exercised by the node lane.
 * Spec: docs/superpowers/specs/2026-08-02-subscription-enforcement-design.md §2/§4.
 *
 * THE COMPLIMENTARY INVARIANT (operator, 2026-08-02): is_complimentary and
 * is_admin yield FULL before ANY status logic. Locking one of these accounts
 * is the worst failure this module can produce.
 */

export const GRACE_DAYS = 3;
export const ACCESS = { FULL: 'full', BASIC: 'basic', LOCKED: 'locked' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The exact profile columns the server gate must SELECT. Exported so the
 * query and this list cannot drift — a dropped column goes red in the node
 * lane instead of silently 402ing complimentary accounts. */
export const GATE_FIELDS = ['is_admin', 'is_complimentary', 'subscription_status', 'trial_ends_at', 'past_due_since'];

export function accessLevel(profile, now = Date.now()) {
  if (!profile) return ACCESS.LOCKED;

  // Privileged bypasses — MIRROR canAccessBetaFeature (featureFlags.js:117,123).
  if (profile.is_admin === true) return ACCESS.FULL;
  if (profile.is_complimentary === true) return ACCESS.FULL;

  const s = profile.subscription_status;
  if (s === 'active') return ACCESS.FULL;

  if (s === 'trialing') {
    // ANY 'trialing' → FULL, expired included. Stripe moves a real failed
    // trial to past_due within seconds; a stuck 'trialing' means OUR webhook
    // lagged, and walling a just-charged paying agent over that is the worse
    // error. PaywallGate self-heals stale rows via refresh-subscription.
    return ACCESS.FULL;
  }

  if (s === 'past_due') {
    if (!profile.past_due_since) return ACCESS.BASIC; // failed, clock not stamped yet
    const graceEnds = new Date(profile.past_due_since).getTime() + GRACE_DAYS * DAY_MS;
    return now < graceEnds ? ACCESS.BASIC : ACCESS.LOCKED; // strict <: at exactly +3d → LOCKED
  }

  return ACCESS.LOCKED; // canceled | unpaid | incomplete* | null | anything
}

export const isFull = (p, now) => accessLevel(p, now) === ACCESS.FULL;
export const isLocked = (p, now) => accessLevel(p, now) === ACCESS.LOCKED;
export const hasBasicOrBetter = (p, now) => accessLevel(p, now) !== ACCESS.LOCKED;

// Compat alias — callers: PaywallGate.jsx:104, Profile.jsx:550.
export const hasActiveSubscription = (p, now) => isFull(p, now);

/** Whole days of grace remaining; null when not in a stamped past_due grace. */
export function graceDaysLeft(profile, now = Date.now()) {
  if (!profile?.past_due_since || profile.subscription_status !== 'past_due') return null;
  const remaining = new Date(profile.past_due_since).getTime() + GRACE_DAYS * DAY_MS - now;
  return remaining > 0 ? Math.ceil(remaining / DAY_MS) : 0;
}

/**
 * past_due_since lifecycle — stamp once, never reset on dunning retries,
 * clear on any non-past_due status. Reset-on-retry = infinite grace; a
 * missing clear = a later failure skips grace entirely (spec §4).
 * `fields` is a subscriptionToProfileFields() result; `existingPastDueSince`
 * is the RAW stored timestamp (string|null).
 */
export function applyPastDueStamp(fields, existingPastDueSince, now = Date.now()) {
  const out = { ...fields };
  if (out.subscription_status === 'past_due') {
    out.past_due_since = existingPastDueSince || new Date(now).toISOString();
  } else {
    out.past_due_since = null;
  }
  return out;
}

/** Pure decision for the server gate — fail CLOSED on any read problem. */
export function gateFromProfile(profile, error, now = Date.now()) {
  if (error || !profile) return { ok: false, level: ACCESS.LOCKED, transient: true };
  const level = accessLevel(profile, now);
  return level === ACCESS.FULL ? { ok: true, level } : { ok: false, level };
}
```

- [ ] **1.4** GREEN. **1.5 Mutations (6):** delete `is_admin` line / delete `is_complimentary` line / `<`→`<=` / past_due default→FULL / `applyPastDueStamp` always re-stamps / drop `'is_complimentary'` from `GATE_FIELDS`. Each RED→restore→GREEN.
- [ ] **1.6** Commit: `feat(billing): pure subscription access resolver`

### Task 2: Migration
- [ ] `supabase/past-due-since-migration.sql`: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;` then the backfill `UPDATE ... WHERE subscription_status='past_due' AND past_due_since IS NULL;`. Commit.
- [ ] ⚠️ **HARD PRECONDITION for ALL live testing AND for prod deploy. Failure modes if skipped, BOTH sides:** (READ) `requireFullAccess`'s SELECT errors → fail-closed 402 for EVERY account including complimentary, while the client wall stays absent (profile load fails → `!profile` → children) — looks like "gate broken," is actually "migration missing." (WRITE) every subscription writer's `.update()` carries `past_due_since` → column-does-not-exist → webhook **throws → 500 → Stripe retries then drops events → subscription state stops syncing for everyone**: trial→active never lands, recoveries never clear. Vercel webhook 500s + universal 402s = run the migration.

### Task 3: One writer path (TDD)
- [ ] **3.0 Failing tests first** — `src/lib/stripe-server.test.mjs` (node lane; `stripe-server.js` has only npm + explicit-`.mjs` imports, so it loads; pass a stub `priceIdToTier`): `applySubscriptionFields(subFixture(past_due), stub, null)` stamps ISO now; `(..., 't0')` keeps `'t0'`; `(subFixture(active), stub, 't0')` → `past_due_since: null`. RED (function missing).
- [ ] **3.1** `stripe-server.js`: top-level `import { applyPastDueStamp } from './subscriptionAccess.mjs';` + below `subscriptionToProfileFields` (:119-132):
```js
/** Canonical subscription→profile fields INCLUDING the past_due_since
 * lifecycle. EVERY writer (webhook, sync-after-checkout, refresh-subscription)
 * uses this — never subscriptionToProfileFields directly. Third arg: the RAW
 * existing timestamp (profile.past_due_since), string|null. */
export function applySubscriptionFields(subscription, priceIdToTier, existingPastDueSince) {
  return applyPastDueStamp(subscriptionToProfileFields(subscription, priceIdToTier), existingPastDueSince);
}
```
- [ ] **3.2 Webhook — three edits:** `:19` import swap (**add `applySubscriptionFields`, REMOVE `subscriptionToProfileFields`**); `:59-63` lookup `.select('id, email, past_due_since')`; `:70` `const fields = applySubscriptionFields(subscription, priceIdToTier, profile.past_due_since);`
- [ ] **3.3 sync-after-checkout — three edits:** `:17` same import swap; `:70` select gains `past_due_since`; `:86` same call with `profile.past_due_since`.
- [ ] **3.4 Grep gates (paren-less):** `grep -rn "subscriptionToProfileFields" src/app/` → ZERO; `grep -c "applySubscriptionFields" ` on both route files → ≥2 each. **3.5 Mutations (spec §8):** make the composer re-stamp always → "keeps t0" red; drop the clear → "active clears" red. GREEN. Commit: `feat(billing): centralize past_due_since lifecycle`

### Task 4: Server gate
- [ ] `src/lib/subscriptionGate.server.mjs`:
```js
/** SERVER-ONLY — imports the service-role client; never import from client code. */
import { getSupabaseAdmin } from './stripe-server';
import { gateFromProfile, GATE_FIELDS } from './subscriptionAccess.mjs';

export async function requireFullAccess(userId) {
  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select(GATE_FIELDS.join(', '))   // pinned by the Task-1 GATE_FIELDS test
    .eq('id', userId)
    .maybeSingle();
  return gateFromProfile(profile, error || (!profile ? new Error('no profile') : null));
}
```
  Explicit test-reduction note (spec §8): the decision matrix incl. fail-closed is fully asserted on `gateFromProfile` in Task 1; the query shape is pinned by `GATE_FIELDS`; this 10-line wrapper carries no additional logic. Build-verified only — stated, not hidden.
- [ ] Commit: `feat(billing): server-only requireFullAccess gate`

### Task 5: Wire the 402 (binding = `auth`, NOT `userId`)
Block, inserted immediately after each route's `const auth = await requireUserId(req); if (auth instanceof Response) return auth;`:
```js
  // Subscription gate (spec §3): BASIC/LOCKED never spend on AI/email.
  const { requireFullAccess } = await import('@/lib/subscriptionGate.server.mjs');
  const access = await requireFullAccess(auth);
  if (!access.ok) {
    return Response.json(
      { error: 'Your subscription is not active. Update your payment method to use this feature.',
        accessLevel: access.level, subscriptionRequired: true },
      { status: 402 }
    );
  }
```
- [ ] **5.1** The 8 uniform routes at their verified anchors: `import-leads-ai:257`, `import-prospects-ai:238`, `import-expenses-ai:410` (insert stays ABOVE the try at :415, matching the anchor), `parse-statement-ai:220`, `extract-screenshot-ai:75`, `recategorize-ai:96`, `followup-draft:154` (accepted double profile read), `textdrip/extract-conversation:77`.
- [ ] **5.2 `email/send`:** SELECT at `:146` gains `past_due_since`; insert **after the profile null-check at `:149-151`** (NOT the `:140-141` service-client check — TDZ), before the per-kind tier gate: `const { gateFromProfile } = await import('@/lib/subscriptionAccess.mjs'); const access = gateFromProfile(profile, pErr); if (!access.ok) return Response.json({ ...same body }, { status: 402 });` — note: this gates ALL kinds incl. `welcome` (accepted: welcome is an agent-initiated paid send; ticket/reminder mail doesn't route here).
- [ ] **5.3 `chat`:** after `const userId = await authenticate(req);` (:121 — chat genuinely binds `userId`): `if (userId) { ...requireFullAccess(userId)... }`.
- [ ] **5.4 Grep gates:** each uniform file `grep -c "requireFullAccess(auth)"` → 1; `grep -rn "requireFullAccess(userId)" src/app/api/` → only `chat/route.js`.
- [ ] **5.5** Lanes+build green. Commit: `feat(billing): 402 subscription gate on all paid AI/email routes`

### Task 6: featureFlags + queue hold
- [ ] **6.1 featureFlags — failing tests first, including the two existing tests the swap breaks** (they must be REWRITTEN, not left to fail): `featureFlags.test.mjs:52-54` expired-trial → now asserts `canAccess: true` ('tier_match') with a comment on the CRITICAL-2 rationale; `:62-64` past_due-grace → now asserts `false` (`no_subscription`). NEW: past_due+stamp-1d → false; comp/admin/allowlist → true.
- [ ] **6.2** Swap the inlined `hasActiveSubscription` body (featureFlags.js:39-50) to delegate to `isFull` from `./subscriptionAccess.mjs` (keep the local name). Fix the stale comment at `useBetaFeature.js:18-22`.
- [ ] **6.3 Queue hold — the FULL replacement (rev-2's version was a no-op: the surviving `data?.setupRequired` conjunct filtered out 402 bodies, which carry `subscriptionRequired` instead).** At `PendingEmailQueueRunner.jsx:183-184`, replace the single `setupHold` computation with:
```js
          const setupHold = (res.status === 428 || res.status === 503)
            && data?.setupRequired && data.setupRequired !== 'stale_client';
          const subscriptionHold = res.status === 402 && data?.subscriptionRequired === true;
          if (setupHold || subscriptionHold) {
            // reschedule (existing call), with:
            //   heldReason: setupHold ? data.setupRequired : 'subscription'
```
  and thread that `heldReason` into the existing `reschedulePending` call. Expiry copy: in the `isExpiredHold` failure branch, the error becomes reason-aware — `heldReason === 'subscription' ? 'expired while payment on hold' : 'expired while sender setup incomplete'`. Held-summary toast copy: "waiting on sender setup or payment." Tests (`PendingEmailQueueRunner.test.jsx`): 402+`subscriptionRequired:true` → item stays `pending`, `heldReason:'subscription'`; 402 WITHOUT the flag → `failed` (a non-PRIM 402 shouldn't hold forever); mutation: revert to the old condition → the 402-hold test goes red.
- [ ] **6.4** Green (record new counts). Commit: `feat(billing): BASIC blocks paid features client-side; queue holds on 402`

### Task 7: Client gate (TDD)
- [ ] **7.1 Failing tests first** (`PaywallGate.test.jsx`): invariant (comp + stale stamp → children, no banner/wall); **loading/`profile===null` → children, no wall**; active → children; BASIC stamped-1d → banner "2 days"; BASIC unstamped → banner, stamp-less copy, no "null"; past_due-stamp-4d → PaymentWall (no app content; exactly TWO actions: update payment, recheck); `canceled`/`incomplete_expired`/status-null → `PaywallScreen` (pricing), not PaymentWall; recovery (mock refresh-subscription 200 + profile flips active) → wall unmounts; **stale-trialing self-heal:** profile `trialing`+`trial_ends_at` past → children render AND exactly one POST to `/api/stripe/refresh-subscription` fires (sessionStorage-throttled — second render, no second POST).
- [ ] **7.2** `subscription.js`: SELECT `:93` gains `past_due_since` (**the line that makes LOCKED reachable**); delete the local `hasActiveSubscription`, add `export { hasActiveSubscription } from './subscriptionAccess.mjs';` — `isInTrial`/`trialDaysLeft` stay local, untouched.
- [ ] **7.3 PaywallGate** — **imports first** (rev-1-finding-1 class, called out this time): add `accessLevel, ACCESS, graceDaysLeft` from `@/lib/subscriptionAccess.mjs`, `openCustomerPortal` to the existing `@/lib/subscription` import, `authedFetch` from `@/lib/authedFetch` (for the recheck POST); drop `hasActiveSubscription` from the import if now unused. Lines **:87-102 UNTOUCHED** (syncing overlay + `loading || !profile` guard). Replace only the `:104-118` region:
```js
  // Stale-trialing self-heal (spec §2 residual): one throttled re-sync.
  useEffect(() => {
    if (profile?.subscription_status === 'trialing' && profile.trial_ends_at
        && new Date(profile.trial_ends_at).getTime() < Date.now()
        && !sessionStorage.getItem('trial_resync_v1')) {
      sessionStorage.setItem('trial_resync_v1', '1');
      authedFetch('/api/stripe/refresh-subscription', { method: 'POST' }).then(() => refresh()).catch(() => {});
    }
  }, [profile, refresh]);

  const level = accessLevel(profile);
  if (level === ACCESS.FULL) { /* existing children + SenderSetupPrompt return, unchanged */ }
  if (level === ACCESS.BASIC) return (<><GraceBanner profile={profile} />{children}</>);
  const s = profile.subscription_status;
  if (s === 'past_due' || s === 'unpaid') return <PaymentWall onRecovered={refresh} />;
  return <PaywallScreen profile={profile} />;   // null | canceled | incomplete_expired → new checkout
```
  - `GraceBanner({ profile })`: **in-flow** (above children; TrialBanner at LeadTracker.jsx:2159 is the precedent — a fixed banner covers the header). Amber, non-dismissible. Stamped: *"Your payment failed — {graceDaysLeft(profile)} day(s) of limited access left. AI features and email are paused until you update your payment."* Unstamped: same sentence without the count. "Update payment" → `openCustomerPortal`.
  - `PaymentWall({ onRecovered })`: modeled on PaywallScreen's layout, no auto-redirect. Headline "Your subscription is paused"; body "Update your payment method to get back in — your data is safe and exactly where you left it." Actions: "Update payment method" → `openCustomerPortal`; "I've paid — recheck" → `authedFetch('/api/stripe/refresh-subscription', {method:'POST'})` then `onRecovered()`; busy + error states. **No "See plans"** — past_due/unpaid have a live sub, `/pricing` checkout would 409-loop; the portal is the path.
  - Note the hooks-order constraint: the new `useEffect` sits with the existing effects ABOVE the early returns.
- [ ] **7.4 Grep gate:** `grep -n "accessLevel\|graceDaysLeft\|openCustomerPortal\|authedFetch" src/components/PaywallGate.jsx` — each appears in an import line. Green. Commit: `feat(billing): three-state client gate — grace banner + payment wall + trialing self-heal`

### Task 8: refresh-subscription route
- [ ] `src/app/api/stripe/refresh-subscription/route.js` — POST; `const auth = await requireUserId(req); if (auth instanceof Response) return auth; const userId = auth;`; admin client; profile select `stripe_customer_id, past_due_since`; no customer → 200 `{ok:false, reason:'no_customer'}`; `stripe.subscriptions.list({customer, status:'all', limit:10})`; pick live (`trialing|active|past_due|unpaid`) else most recent by `created`; none → 200 `{ok:false, reason:'no_subscription'}`; `applySubscriptionFields(sub, priceIdToTier, profile.past_due_since)` → update → `{ok:true, subscription_status}`. Stripe error → 503. Model on sync-after-checkout.
- [ ] Build green + grep gate (`applySubscriptionFields` imported + called). Commit: `feat(billing): refresh-subscription re-sync`

### Task 9: Checkout — card-only, no repeat trials, honest copy
- [ ] **9.1** In `create-checkout-session`, **hoist the flag above the try** (rev-2 finding: `existing` is block-scoped inside `:65-84`; using it at `:97` is a ReferenceError → 500 on every checkout):
```js
    let hadAnySub = false;   // fail-open: lookup failure grants the trial, never double-bills
    try {
      const existing = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
      hadAnySub = (existing?.data || []).length > 0;
      const live = (existing?.data || []).find(s => ['trialing','active','past_due','unpaid'].includes(s.status));
      if (live) { /* existing 409 return, unchanged */ }
    } catch (e) { /* existing warn, unchanged — hadAnySub stays false */ }
```
  Session config: `payment_method_types: ['card'],` and `subscription_data: { ...(hadAnySub ? {} : { trial_period_days: TRIAL_DAYS }), metadata: {...} }` — the key is **omitted** entirely for returning customers (Stripe bills immediately; `0` behaves differently).
- [ ] **9.2 Copy (compliance flag — human review; spec §6):** `pricing/page.jsx:47,156` and `PaywallGate.jsx:145` → "7-day free trial **for new customers**" (returning canceled customers are charged immediately; Stripe's hosted page shows each user their true terms pre-confirmation).
- [ ] **9.3 Grep gate:** `grep -n "hadAnySub" src/app/api/stripe/create-checkout-session/route.js` → declaration BEFORE the `try` line number, usage in `subscription_data`. Build green. Commit: `feat(billing): card-only checkout, no repeat free trials, accurate trial copy`

### Task 10: Offline gate + push
- [ ] `npm run test:all` (record counts), build, lint 0 errors, byte-checks, re-run ALL grep gates (3.4, 5.4, 7.4, 9.3), push, CI green.

### Task 11: Live pass + review + STOP
- [ ] **PRECONDITION: migration run (Task 2 — read AND write failure modes).**
- [ ] Live: complimentary account → no banner/wall, paid routes 200. Checkout shows card-only. Safe TEST profile (never a real agent) SQL'd to past_due+stamp-4d → PaymentWall + 402 + recovery; restore. No safe profile → suites carry it; say so.
- [ ] Fresh-context adversarial code review of the full diff vs spec. Fix, re-run gates.
- [ ] **STOP — no merge.** Rollout checklist for Juan: migration ✓; privileged-flag query on his accounts; `SELECT subscription_status, count(*) FROM profiles GROUP BY 1` + `SELECT count(*) FROM profiles WHERE subscription_status='trialing' AND trial_ends_at < now()` (these rows are blocked today, become FULL-then-self-healed after deploy — know the count); merge go.

**Accepted residuals:** `trial_ends_at` dead weight in GATE_FIELDS (kept for the self-heal check + future logic); no client pre-disable on the 6 import wizards (402 surfaces via each wizard's error display); 402-held queue items still expire at 72h from `enqueuedAt` (pre-existing anchor semantics; error string now reason-aware); fresh-env `schema.sql` still carries the permissive profiles UPDATE policy (prod protected by the lockdown migration).
