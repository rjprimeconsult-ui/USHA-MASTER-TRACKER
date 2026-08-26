# Self-service password reset + change password — design

**Date:** 2026-08-26 · **Trigger:** support ticket #4 ("I forgot my password on my
mac and I want to log in on both") · **Approved approach:** in-place gates, no new
route (Juan, 2026-08-26). MFA-enrolled accounts must clear the TOTP challenge
before setting a new password (Juan's decision A, 2026-08-26).

## 1. Problem

PRIM has **no password recovery surface at all**. `AuthGate.jsx` signs in via
`signInWithPassword` and that is the entire auth UX: no "Forgot password?" link,
no `PASSWORD_RECOVERY` handling, no change-password UI anywhere. A locked-out
agent's only path is a support ticket and a manual dashboard reset by the
operator — which also means the operator is tempted to email a temp password
(a WISP-violating channel). 23 agents, recurring ticket class.

## 2. Scope

**In:** (a) forgot-password flow from the sign-in card (email → Supabase recovery
link → in-app set-new-password screen); (b) change-password while signed in, as a
new **Security** section in Profile; (c) TOTP gate in front of the recovery
set-password screen for MFA-enrolled accounts; (d) tests in both lanes.

**Out (explicitly):** custom Resend-branded auth emails (Supabase's mailer sends
the recovery email, same channel as the already-working signup confirmations);
MFA opt-in UI in Profile (MfaSetup already exports `onCancel` for that future
use); RLS AAL hardening (see §8 risk 3); admin password resets of OTHER users.

## 3. Architecture — how recovery lands with no new route

The recovery email's link points at the **app origin** (`redirectTo:
window.location.origin`). `detectSessionInUrl: true` (already set in
`src/lib/supabase.js`) consumes the token hash on load and establishes a
session; supabase-js then emits a **`PASSWORD_RECOVERY`** auth event.

- **`AuthProvider.jsx`** (currently ignores event names): capture
  `PASSWORD_RECOVERY` in the existing `onAuthStateChange` listener → new state
  `recovery: true`, exposed via context alongside a `clearRecovery()` setter.
  The flag is **in-memory only** — a reload after the hash is consumed drops
  into a normal signed-in session, which is acceptable (the link was already
  honored; the user can use Profile → Security instead).
- **`AuthGate.jsx`**: when `user && recovery`, render `<RecoveryScreen />`
  **instead of** the app — before `LegalAcceptanceGate` and `MfaGate` (a user
  mid-recovery must not be blocked by a legal modal before securing the
  account; both gates run normally after `clearRecovery()`).

## 4. Components

### 4a. Forgot-password (AuthGate, third `mode`)

`mode: 'signin' | 'signup' | 'forgot'`. Sign-in card gains a small
"Forgot password?" button (next to the password label). Forgot mode shows only
the email field + "Send reset link".

- Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo:
  window.location.origin })`.
- **Success copy is enumeration-safe and unconditional:** "If an account exists
  for that email, a reset link is on the way. Check spam too." Shown for
  success AND for user-not-found-shaped errors; only rate-limit errors
  (`over_email_send_rate_limit` / HTTP 429) surface as "Too many requests —
  wait a minute and try again."
- Submit button disables for **60s** after a send (client-side cooldown; the
  server rate limit is the real backstop).

### 4b. `RecoveryScreen` (new: `src/components/auth/RecoveryScreen.jsx`)

Two phases, resolved by pure logic (§5):

1. **`challenge`** — the account has a verified TOTP factor and the recovery
   session is aal1: render the existing exported **`MfaChallenge`** from
   `MfaGate.jsx` (reused as-is; its `onDone` re-resolves state). This is
   decision A: an email-inbox compromise alone must not be enough to rotate an
   MFA-protected password.
2. **`set`** — new-password + confirm fields (minLength 6, parity with signup;
   Supabase leaked-password protection — enabled 2026-08-12 — rejects known-
   breached passwords server-side and its error is surfaced verbatim).
   Calls `supabase.auth.updateUser({ password })`. On success: `clearRecovery()`
   → success toast → normal gate chain renders the app (already signed in).
   "Same password" and weak-password errors surface inline.

**Fail-safe direction — opposite of MfaGate, deliberately:** if AAL/factor
lookups **fail** during recovery, treat the account as MFA-enrolled and show
the challenge (fail-closed). MfaGate fails open because a broken check must
not lock the operator out of a signed-in session; here the user is mid-recovery
from an emailed link — the risk asymmetry flips, and a locked-out-but-enrolled
user can still complete the challenge. A user with NO factor never sees it
(pure logic decides from the factor list, not from `isAdmin`).

An "I'll do this later — sign out" escape link calls `signOut()` +
`clearRecovery()`.

### 4c. Change password (Profile → new Security section)

- New entry in `SECTIONS` (`Profile.jsx`): `{ id: 'security', label:
  'Security', icon: ShieldCheck, phase: 1 }` — visible to **all** agents (no
  entitlement gate; passwords are not a paid feature).
- Form component lives in **`src/components/auth/ChangePasswordForm.jsx`**
  (Profile.jsx is 1537 lines; new code goes in its own file), imported by the
  section.
- Fields: current password, new password, confirm. **Current password is
  verified first** via `signInWithPassword({ email: user.email, password:
  current })` — Supabase's `updateUser` does not require it, but an unlocked
  machine must not be enough to silently rotate a password. Then
  `updateUser({ password })`.
- Note for MFA users: re-calling `signInWithPassword` on an existing session
  does not downgrade aal2 (verify during build; if it does, resolve by
  re-running the challenge — the pure state helper already covers it).

## 5. Pure logic (node lane): `src/lib/passwordReset.mjs`

Follows the `mfa.mjs` pattern — no Supabase imports, every branch testable:

- `recoveryPhase({ recovering, currentLevel, factors, lookupFailed })` →
  `'none' | 'challenge' | 'set'`. Uses the existing `verifiedTotpFactor`
  (imported from `mfa.mjs`, already tolerant of all three factor shapes).
  `lookupFailed: true` → `'challenge'` **if** `recovering` (fail-closed rule,
  §4b) — but `'set'` when the factor list affirmatively shows no verified
  factor.
- `newPasswordIssue(pw, confirm)` → `null | 'too_short' | 'mismatch'` — one
  shared validator for both the recovery screen and the Profile form.
- `resetRequestMessage(error)` → maps a `resetPasswordForEmail` result to the
  enumeration-safe copy vs the rate-limit copy (§4a).

## 6. Operator-side config (Juan, before merge)

1. Supabase Dashboard → Authentication → **URL Configuration**: confirm
   `https://www.primtracker.com` is the Site URL or in the redirect allowlist
   (signup confirmation emails already work, so likely already true — verify,
   don't assume; also add `http://localhost:3000` for dev testing if absent).
2. Glance at the **Reset Password email template** (default copy is fine;
   subject line "Reset Your Password" is acceptable for launch).
3. Nothing else — no env vars, no migration, no Stripe/Resend involvement.

## 7. Testing

- **Node lane** (`passwordReset.test.mjs`): every `recoveryPhase` branch incl.
  the fail-closed row and the three factor shapes; validator boundaries (5/6
  chars, mismatch); message mapping incl. 429.
- **UI lane** (vitest+RTL, per the 2026-07-28 conventions): `RecoveryScreen`
  — challenge-before-set for enrolled accounts, straight-to-set for
  unenrolled, updateUser called with the typed password, error surfacing,
  clearRecovery on success; `ChangePasswordForm` — wrong current password
  blocks update (updateUser **never called** — remember the `await act(async
  () => {})` flush before any zero-call assertion), success path. AuthGate
  forgot mode: enumeration-safe copy on success and on user-not-found.
- **Mutation checks** (manual, per house rule): neuter `recoveryPhase`'s
  challenge branch → a test must go red; drop the `signInWithPassword`
  pre-check → red; swap enumeration-safe copy condition → red.
- **Live pass** on the branch preview: real recovery email to a test account,
  link → set screen → new password works on second browser; admin (Juan's
  enrolled account) sees the TOTP challenge first.

## 8. Risks / notes on record

1. **The recovery link mints a full aal1 session before any of our UI runs** —
   that is how Supabase recovery works with `detectSessionInUrl`. For an
   MFA-enrolled account, our challenge gates the password *change*, but an
   attacker with inbox access who crafts direct REST calls with that session's
   token can still read/write the victim's OWN rows (RLS checks `auth.uid()`,
   never AAL). Admin *routes* already refuse aal1. Closing this fully needs
   AAL-aware RLS — logged as a WISP follow-up, not in this build's scope.
2. **GoTrue may or may not enforce aal2 server-side for `updateUser` password
   changes on MFA accounts.** Verify during build; if it does, our challenge
   is defense-in-depth; if not, it is the only gate — either way the client
   flow is required, and the finding gets recorded in the code comment.
3. **Recovery emails ride Supabase's default mailer** — low rate limits
   (~2-4/hour) and plain styling. Fine for 23 agents; custom SMTP via Resend
   is a known later upgrade, not a blocker.
4. `PASSWORD_RECOVERY` state is in-memory: hard reload mid-flow lands the user
   in the app signed-in without the set screen. Accepted — Profile → Security
   covers them, and the alternative (persisting the flag) risks a stuck gate.
