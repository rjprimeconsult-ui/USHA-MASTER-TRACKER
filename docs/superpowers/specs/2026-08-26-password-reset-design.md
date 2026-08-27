# Self-service password reset + change password — design

**Date:** 2026-08-26 · **Trigger:** support ticket #4 ("I forgot my password on my
mac and I want to log in on both") · **Approved approach:** in-place gates, no new
route (Juan, 2026-08-26). MFA-enrolled accounts must clear the TOTP challenge
before setting a new password (Juan's decision A, 2026-08-26). · **Rev 4** after three
adversarial review rounds (r1: 2 blockers + 4 majors; r2: 3 majors; r3: 2
majors on the rev-3 edits themselves, fixed here).

## 1. Problem

PRIM has **no password recovery surface at all**. `AuthGate.jsx` signs in via
`signInWithPassword` and that is the entire auth UX: no "Forgot password?" link,
no `PASSWORD_RECOVERY` handling, no change-password UI anywhere. A locked-out
agent's only path is a support ticket and a manual dashboard reset by the
operator — which also tempts a WISP-violating channel (emailing a temp
password). 23 agents, recurring ticket class.

## 2. Scope

**In:** (a) forgot-password flow from the sign-in card (email → Supabase recovery
link → in-app set-new-password screen); (b) change-password while signed in, as a
new **Security** section in Profile; (c) TOTP gate in front of the recovery
set-password screen for MFA-enrolled accounts; (d) expired/used-link error
surfacing; (e) tests in both lanes.

**Out (explicitly):** custom Resend-branded auth emails (Supabase's mailer sends
the recovery email, same channel as the already-working signup confirmations);
MFA opt-in UI in Profile (`MfaSetup` already exports `onCancel` for that future
use); RLS AAL hardening (§9 risk 1); admin password resets of OTHER users.

## 3. Architecture — how recovery lands with no new route

**Host reality (verified live 2026-08-26):** the marketing split is ON in prod.
`www.primtracker.com` classifies as **marketing** (`hostRouting.mjs`; root
rewrites to `/landing`), and the app lives at **`app.primtracker.com`**. Every
recovery link must therefore land on the **app origin** — a link that falls
back to the marketing host renders the landing page while `detectSessionInUrl`
silently burns the single-use token in the hash.

- **`redirectTo` rule: use `window.location.origin` UNLESS it is the
  marketing origin — then use `appUrl()`.** Neither primitive alone is
  right. r2 proved `window.location.origin` alone is wrong in prod:
  `AuthGate` wraps every route on BOTH hosts (`layout.js:45`), and a
  non-public path on the marketing host (a stale `www.primtracker.com/leads`
  bookmark — no custom not-found exists) renders `SignInScreen` on the `www`
  origin, whose redirect the cutover-era allowlist would honor, burning the
  token on the landing page. r3 proved `appUrl()` alone is wrong everywhere
  else: `NEXT_PUBLIC_SITE_URL` is set to the PRODUCTION app origin in the
  dev env pull and on preview deploys, so `appUrl()` on localhost or a
  branch preview emails a link pointing at prod — making local testing and
  §8's live pass impossible. The browser already knows the right origin in
  every environment except the marketing host, so the rule is a pure,
  node-testable helper in `passwordReset.mjs` (fourth helper, §5):
  `resetRedirectTarget({ origin, marketingUrl, appOrigin })` → `origin`
  unless `origin` matches the marketing origin (compare via the same
  host-classification idea as `hostRouting.mjs`; `NEXT_PUBLIC_MARKETING_URL`
  supplies the marketing origin), in which case `appOrigin` (= `appUrl()`).
  Config hardening in §7 still removes the `www` allowlist entry as defense
  in depth.

**Recovery detection — belt and braces, because the event alone is racy:**
supabase-js consumes the hash and emits `PASSWORD_RECOVERY` from a
`setTimeout(…, 0)` inside `_initialize`, while `AuthProvider` subscribes in a
mount effect — subscription order vs. dispatch is not guaranteed, and
`setUser` from `getSession()` lands in an earlier task regardless.

1. **Synchronous hash sniff (primary):** initialize the `recovery` state via
   a `useState` initializer that reads `window.location.hash` once — **guarded
   with `typeof window !== 'undefined'`**. `AuthProvider` is a client
   component prerendered on the server during `next build`; a bare `window`
   read in render is a build-breaking ReferenceError (this exact class took
   down a deploy on 2026-06-12 — see the header of `src/lib/supabase.js`,
   whose line 15 shows the required guard pattern). Hydration is safe: with
   `loading: true` on both server and client, `AuthGate` renders the spinner
   branch either way, so the guarded initializer produces no visible
   mismatch. If the hash contains `type=recovery`, initialize
   `recovery: true`. This does not parse or trust the token — supabase-js
   still does the real verification; the sniff only decides *what screen to
   show while it does*.
2. **`PASSWORD_RECOVERY` event (backup):** the existing `onAuthStateChange`
   listener (currently `(_event, session)` — event discarded) also sets
   `recovery: true` on that event name.

`recovery` + `clearRecovery()` are exposed via the auth context. The flag is
**in-memory only** — a hard reload after the hash is consumed drops into a
normal signed-in session, which is accepted (§9.3): the link was honored and
Profile → Security covers them.

- **`AuthGate.jsx`**: when `user && recovery`, render `<RecoveryScreen />`
  instead of the app. Because `setUser` can land a task before the recovery
  flag when only the event path fires, one render pass may mount the normal
  gate chain first (a flash of MfaGate's "Checking security…" and one wasted
  profile query) — the hash sniff makes this near-impossible in practice, and
  it is cosmetic when it happens. Accepted, on record.
- Gate order: `RecoveryScreen` takes priority over `LegalAcceptanceGate` and
  `MfaGate` (a user mid-recovery must not be blocked by a legal modal before
  securing the account); both gates run normally after `clearRecovery()`.

## 4. Components

### 4a. Forgot-password (AuthGate, third `mode`)

`mode: 'signin' | 'signup' | 'forgot'`. Sign-in card gains a small
"Forgot password?" button next to the password label — **`type="button"`**
(it sits inside the `<form>`; the default `type="submit"` would fire
`signInWithPassword`). Forgot mode shows only the email field + "Send reset
link".

- Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo:
  resetRedirectTarget({ origin: window.location.origin, marketingUrl:
  process.env.NEXT_PUBLIC_MARKETING_URL, appOrigin: appUrl() }) })` (§3).
- **Success copy is enumeration-safe and unconditional:** "If an account exists
  for that email, a reset link is on the way. Check spam too." Shown for
  success AND for user-not-found-shaped errors; only rate-limit errors
  (`over_email_send_rate_limit` / HTTP 429) surface as "Too many requests —
  wait a minute and try again."
- Submit button disables for **60s** after a send (client-side cooldown; the
  server rate limit is the real backstop).

### 4b. Expired / already-used link surface

When a recovery link is expired (default TTL 1h) or its single-use token was
already consumed (e.g. Outlook SafeLinks prefetch), supabase-js does **not**
emit any event; it leaves `#error=access_denied&error_code=otp_expired…` in
the URL and the user would land on the plain sign-in card with no explanation.

On `SignInScreen` mount: parse `window.location.hash` once; key on
**`error_code` alone** (`otp_expired`, or `error=access_denied` generally) —
GoTrue's error fragment carries NO `type` parameter, and `otp_expired` is
shared with stale **signup-confirmation** links riding the same mailer. So the
copy stays generic and the mode does NOT auto-switch: inline notice "That link
has expired or was already used. If you were resetting your password, request
a new link below." on the sign-in card (the Forgot button is adjacent), then
clear the hash (`history.replaceState`). No token material is logged or
displayed.

### 4c. `RecoveryScreen` (new: `src/components/auth/RecoveryScreen.jsx`)

Phases resolved by pure logic (§5): `loading`, `challenge`, `set`, or
`blocked`. **`loading`** (AAL/factor lookups in flight) renders a spinner and
nothing else — the set-password form must never paint before the lookups
resolve (r2 major #2: without this, an enrolled account's first frame is the
set form, and a password-manager autofill + Enter rotates the password at
aal1 with no challenge — decision A defeated on the loading frame).

1. **`challenge`** — the account has a verified TOTP factor and the session is
   aal1 with aal2 reachable: render the existing exported **`MfaChallenge`**
   from `MfaGate.jsx` (props `{ factor, onDone }`; `factor` is the verified
   factor — this phase is only ever entered with a real factor object, see §5).
   `onDone` re-resolves; after `challengeAndVerify` the session is aal2 and
   §5's table lands on `set` (the aal2 row exists precisely so this cannot
   loop). `MfaChallenge` ships its own "Sign out instead" escape.
2. **`set`** — new-password + confirm fields (minLength 6, parity with the
   shared signup/sign-in input; Supabase leaked-password protection — enabled
   2026-08-12 — rejects known-breached passwords server-side and its error is
   surfaced verbatim). Calls `supabase.auth.updateUser({ password })`.
   On success: an **inline** "Password updated — taking you in…" state on the
   screen itself for ~1.5s, then `clearRecovery()` and the normal gate chain
   renders the app. (No global toast: `Toast.jsx` is a prop-driven
   presentational component with no provider, and anything the screen owns
   unmounts at `clearRecovery()` — review note 8.) "Same password" and
   weak-password errors surface inline.
3. **`blocked`** — the AAL/factor lookups **errored** (transient 500, MFA off
   at project level): show "We couldn't verify your account's security
   settings." with **Retry** (re-runs the lookups) and **Sign out** buttons.
   Fail-closed — the set-password form is withheld — but never an unpassable
   code prompt: review blocker #2 established that rendering `MfaChallenge`
   with a null factor is a permanent TypeError dead end for exactly the
   non-enrolled agents this build serves. Fail-closed here is safe *because*
   retry and sign-out both exist and the flow is re-enterable from a fresh
   link; MfaGate's fail-open rule protects a different asymmetry (operator
   lockout on a signed-in session) and is unchanged.

### 4d. Change password (Profile → new Security section)

- New entry in `SECTIONS` (`Profile.jsx:83-90`): `{ id: 'security', label:
  'Security', icon: ShieldCheck, phase: 1 }` — `phase` is inert (nothing reads
  it; kept for convention). Visibility: **all** agents — the only section
  filter is the id-specific `s.id !== 'sender' || emailEntitled` at
  `Profile.jsx:309`, which this entry passes untouched.
- Content pane: add `{active === 'security' && <ChangePasswordForm … />}` to
  the hardcoded chain at `Profile.jsx:347-390`.
- **Sticky footer:** extend the suppression at `Profile.jsx:397` to
  `active !== 'subscription' && active !== 'security'` — otherwise the modal's
  most prominent button is a "Save changes" that saves agent-profile fields,
  flashes "Saved", and leaves the password unchanged (review major #6).
- Form (new: `src/components/auth/ChangePasswordForm.jsx`): current password,
  new password, confirm.
- **Current-password verification must not touch the stored session.**
  `signInWithPassword` on the singleton client mints a NEW aal1 JWT and saves
  it — silently downgrading an aal2 admin session so every `/api/admin/*`
  call 403s until re-challenge (review major #5; `adminMfaOk` denies
  aal1+factor by design). Instead, verify with a **throwaway non-persisting
  client**: `createClient(url, anonKey, { auth: { persistSession: false,
  autoRefreshToken: false, detectSessionInUrl: false, storageKey:
  'prim-pw-verify' } })` — `detectSessionInUrl` off so construction never
  parses the URL, and a distinct `storageKey` so the throwaway does not share
  the singleton's auth-lock name (avoids the "Multiple GoTrueClient
  instances" warning and lock serialization against an in-flight refresh) → `signInWithPassword({ email, password:
  current })` → on success discard it (`signOut({ scope: 'local' })` on the
  throwaway; never the singleton). The singleton session — and its aal2
  claim — is never replaced. Then `supabase.auth.updateUser({ password })` on
  the singleton. Helper lives beside the form; the throwaway client is
  constructed per-verification, not module-scope.
- Wrong current password → inline error, `updateUser` never called. Success →
  inline confirmation; the session stays valid (Supabase does not revoke the
  current session on password change).

## 5. Pure logic (node lane): `src/lib/passwordReset.mjs`

Follows the `mfa.mjs` pattern — no Supabase imports, every branch testable.
Reuses `verifiedTotpFactor` (imported from `mfa.mjs`; tolerant of bare-array /
`{totp}` / `{all}` shapes).

- `recoveryPhase({ recovering, currentLevel, nextLevel, factors, lookupFailed })`
  → `'none' | 'loading' | 'challenge' | 'set' | 'blocked'`. Truth table, first match wins:

  | # | Condition | Result | Why |
  |---|---|---|---|
  | 1 | `!recovering` | `none` | not in recovery |
  | 2 | `currentLevel == null && !lookupFailed` | `loading` | lookups in flight — never `set` on the loading frame; mirrors `mfa.mjs:54-55`'s loading guard, inverted to fail CLOSED because this gate's asymmetry is the opposite of MfaGate's |
  | 3 | `lookupFailed` | `blocked` | lookups errored → fail-closed retry screen (§4c.3). `lookupFailed` means the AAL or factor **calls errored**; a successful call returning an empty list is NOT a failed lookup |
  | 4 | `currentLevel === 'aal2'` | `set` | challenge already cleared this session — this row is what terminates the challenge → onDone loop (r1 major #3) |
  | 5 | `verifiedTotpFactor(factors)` truthy `&& currentLevel === 'aal1' && nextLevel === 'aal2'` | `challenge` | enrolled, second factor outstanding — mirrors `mfa.mjs:60` exactly, both AAL inputs included |
  | 6 | otherwise | `set` | no verified factor (affirmatively known — rows 2/3 above guarantee the lookups RESOLVED by the time this row is reachable) |

  Row 3 beats row 6 by ordering (with `lookupFailed` there is no factor list
  to consult), and row 2 guarantees `set` is unreachable while
  `currentLevel` is still null.
- `newPasswordIssue(pw, confirm)` → `null | 'too_short' | 'mismatch'` — one
  shared validator for recovery and Profile forms.
- `resetRequestMessage(error)` → maps a `resetPasswordForEmail` result to the
  enumeration-safe copy vs the rate-limit copy (§4a).
- `recoveryErrorFromHash(hash)` → `null | 'expired'` — the §4b parser, pure.
- `resetRedirectTarget({ origin, marketingUrl, appOrigin })` → the §3
  redirect rule: `origin` unless it is the marketing origin, else
  `appOrigin`. Marketing comparison is by host (tolerate scheme/trailing
  slash variants); a null/absent `marketingUrl` means no marketing host is
  configured and `origin` wins.

## 6. Recorded platform dependencies (code comments required)

1. **`flowType` stays `'implicit'`** (the supabase-js default; `supabase.js`
   sets none). The ENTIRE cross-device story — "forgot on my mac, log in on
   both" — depends on it: under `pkce` the verifier lives in the requesting
   browser's localStorage and the link fails on any other device. Comment goes
   in `src/lib/supabase.js` at the auth options block.
2. **Recovery link clicked while signed in as a different user** replaces the
   existing session without a prompt (supabase-js `_saveSession`). Accepted:
   shared-machine user B is signed out and the recovery owner's screen
   appears. On record here; no code fights it.
3. **GoTrue may or may not enforce aal2 server-side for `updateUser` on MFA
   accounts** — check during build and record the finding in a
   `RecoveryScreen` comment. Either way our challenge is required: if GoTrue
   enforces, we're defense-in-depth; if not, we're the only gate.

## 7. Operator-side config (Juan, before merge)

1. Supabase Dashboard → Authentication → **URL Configuration**:
   - **Site URL must be `https://app.primtracker.com`** — NOT
     `www.primtracker.com`. The Site URL is the fallback when `redirectTo`
     isn't allowlisted; pointed at the marketing host it burns recovery
     tokens on the landing page (§3).
   - **Redirect allowlist** must contain `https://app.primtracker.com/**`,
     `http://localhost:3000/**` (dev), and the Vercel preview pattern
     `https://*-rjprimeconsult-9217s-projects.vercel.app/**` (so §8's live
     pass on a branch preview gets its link back to the preview, not prod —
     r3 finding; remove the preview entry after launch if unwanted).
   - **Remove `https://www.primtracker.com/**` from the redirect allowlist**
     (or confirm it was never added). The subdomain cutover checklist said to
     keep it "during transition" — the transition is over, and while it
     remains, any `redirectTo` pointing at `www` is HONORED and burns
     recovery tokens on the landing page (r2 major #1). `appUrl()` makes the
     app's own links safe regardless; this closes the config side.
   - Note current values before changing — signup confirmation emails also
     use the Site URL; after the change, send yourself a test signup
     confirmation to verify that flow still lands correctly.
2. Glance at the **Reset Password email template** (default copy acceptable
   for launch).
3. Nothing else — no env vars, no migration, no Stripe/Resend involvement.

## 8. Testing

- **Node lane** (`src/lib/passwordReset.test.mjs`, picked up by the existing
  `node --test` glob): every `recoveryPhase` row incl. the row-2 loading
  guard (null currentLevel NEVER yields `set`), row-3-beats-row-6 ordering,
  the aal2 terminator row, and the three factor shapes; validator
  boundaries (5/6 chars, mismatch); `resetRequestMessage` incl. 429;
  `recoveryErrorFromHash` on real hash fixtures — fixtures must match
  GoTrue's actual error fragment shape (`error`, `error_code`,
  `error_description`; NO `type` param); `resetRedirectTarget` — app
  origin passes through, marketing origin (scheme/slash variants) maps to
  appOrigin, localhost and `*.vercel.app` preview origins pass through,
  absent marketingUrl passes origin through.
- **UI lane** (vitest+RTL jsdom, matching `vitest.config.mjs` include
  `src/**/*.{test,spec}.{jsx,tsx}`; conventions per the header of
  `src/components/auth/LegalAcceptanceGate.test.jsx` and
  `FollowupNextStep.test.jsx`): `RecoveryScreen` — spinner while lookups are
  unresolved (no password input in the DOM on first paint), challenge-before-
  set for enrolled, straight-to-set for unenrolled, `blocked` retry
  re-resolves,
  updateUser called with the typed password, inline success then
  clearRecovery; `ChangePasswordForm` — wrong current password blocks update
  (`updateUser` **never called** — `await act(async () => {})` flush before
  any zero-call assertion, per the mutation-hardening lesson), throwaway
  client never replaces the singleton session (assert singleton's
  signInWithPassword NOT called), success path. AuthGate — forgot mode
  enumeration-safe copy on success and on user-not-found; expired-hash notice
  renders while mode STAYS `'signin'` (asserting the §4b no-auto-switch
  rule — a pre-switch would dump stale signup-confirmation clicks into
  password reset); Forgot button `type="button"` (assert clicking it does
  not fire signInWithPassword).
- **Mutation checks** (manual, house rule): delete row 2 (loading guard) →
  first-paint test goes red; neuter row 4 (aal2 → set) → challenge-loop test
  red; neuter row 5 → enrolled-account test red;
  swap the throwaway client for the singleton → session-preservation test
  red; drop the current-password pre-check → red; flip enumeration-safe copy
  condition → red.
- **Live pass** on the branch preview: real recovery email to a test account;
  link → set screen → new password works in a second browser (cross-device,
  the actual ticket); Juan's enrolled admin account sees the TOTP challenge
  first, and admin routes still work after a Profile password change
  (aal2 preserved); an expired link shows the §4b notice.

## 9. Risks / notes on record

1. **The recovery link mints a full aal1 session before any of our UI runs** —
   inherent to Supabase recovery with `detectSessionInUrl`. For an
   MFA-enrolled account our challenge gates the password *change*, but an
   attacker with inbox access holding that session's token can still
   read/write the victim's OWN rows via direct REST (RLS checks `auth.uid()`,
   never AAL). Admin *routes* already refuse aal1. Full closure needs
   AAL-aware RLS — logged as a WISP follow-up, out of scope here.
2. **Recovery emails ride Supabase's default mailer** — low rate limits
   (~2-4/hour) and plain styling. Fine for 23 agents; custom SMTP via Resend
   is a known later upgrade, not a blocker.
3. `PASSWORD_RECOVERY` and the hash sniff are in-memory: a hard reload
   mid-flow lands the user in the app signed-in without the set screen.
   Accepted — Profile → Security covers them; persisting the flag risks a
   stuck gate.
4. The one-render-pass gate flash when only the event path fires (§3) is
   cosmetic and accepted.
