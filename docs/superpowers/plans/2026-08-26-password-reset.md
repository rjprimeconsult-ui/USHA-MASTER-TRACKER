# Self-Service Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forgot-password (email link → in-app set screen, TOTP-gated for MFA accounts) + change-password in Profile, per the approved spec `docs/superpowers/specs/2026-08-26-password-reset-design.md` (rev 4).

**Architecture:** No new routes. Recovery lands at `/` on the app host; `AuthProvider` detects it (hash sniff + `PASSWORD_RECOVERY` event) and `AuthGate` swaps in a `RecoveryScreen` gated by pure phase logic (`loading | challenge | set | blocked`). Profile gains a Security section with a `ChangePasswordForm` that verifies the current password on a throwaway Supabase client so the singleton's aal2 session is never downgraded.

**Tech Stack:** Next.js 16 (App Router), @supabase/supabase-js 2.110.8, node --test (node lane), vitest+RTL jsdom (UI lane).

**Read the spec first.** Every "why" in this plan is §-referenced to it. The spec is normative on behavior; this plan is normative on sequence.

**House rules that bind every task:**
- supabase-js NEVER rejects a failed query — it resolves `{ data, error }`. Check `error` explicitly.
- UI-lane zero-call assertions need `await act(async () => {})` BEFORE asserting (the runner yields a microtask before calling the API).
- Never type a unicode escape for a control character into Write/Edit — write "U+0000" as prose. Byte-check after editing docs.
- Baselines before starting: `npm run test:all` → node 754 / ui 99 (verified 2026-08-26). Lint exits 0. If your baseline differs, STOP and report.

---

### Task 1: Pure logic — `src/lib/passwordReset.mjs` (node lane, TDD)

**Files:**
- Create: `src/lib/passwordReset.mjs`
- Create: `src/lib/passwordReset.test.mjs`

- [ ] **Step 1.1: Write the failing tests** — `src/lib/passwordReset.test.mjs`:

```js
/**
 * Pure logic for the password-reset flows (spec §5). No Supabase imports.
 *
 * recoveryPhase is a SECURITY gate: the loading row (row 2) is what stops a
 * password-manager autofill from rotating an MFA-enrolled account's password
 * at aal1 before the factor lookup resolves (spec §4c). Row order is
 * normative — first match wins.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recoveryPhase,
  newPasswordIssue,
  resetRequestMessage,
  recoveryErrorFromHash,
  resetRedirectTarget,
  RESET_SENT_COPY,
  RESET_RATE_LIMIT_COPY,
} from './passwordReset.mjs';

const FACTOR = { id: 'f1', status: 'verified', factor_type: 'totp' };

// ---- recoveryPhase --------------------------------------------------------

test('row 1: not recovering → none, regardless of everything else', () => {
  assert.equal(recoveryPhase({ recovering: false, currentLevel: 'aal1', nextLevel: 'aal2', factors: [FACTOR] }), 'none');
});

test('row 2: null currentLevel while lookups in flight → loading, NEVER set', () => {
  assert.equal(recoveryPhase({ recovering: true, currentLevel: null, nextLevel: null, factors: null, lookupFailed: false }), 'loading');
  assert.equal(recoveryPhase({ recovering: true, currentLevel: undefined, factors: undefined, lookupFailed: false }), 'loading');
});

test('row 3: lookupFailed → blocked, and it beats row 6 even with null factors', () => {
  assert.equal(recoveryPhase({ recovering: true, currentLevel: null, nextLevel: null, factors: null, lookupFailed: true }), 'blocked');
  // lookupFailed with a RESOLVED currentLevel still blocks (partial failure)
  assert.equal(recoveryPhase({ recovering: true, currentLevel: 'aal1', nextLevel: 'aal1', factors: null, lookupFailed: true }), 'blocked');
});

test('row 4: aal2 → set (terminates the challenge → onDone loop)', () => {
  assert.equal(recoveryPhase({ recovering: true, currentLevel: 'aal2', nextLevel: 'aal2', factors: [FACTOR], lookupFailed: false }), 'set');
});

test('row 5: enrolled + aal1→aal2 outstanding → challenge (all three factor shapes)', () => {
  for (const factors of [[FACTOR], { totp: [FACTOR] }, { all: [FACTOR] }]) {
    assert.equal(recoveryPhase({ recovering: true, currentLevel: 'aal1', nextLevel: 'aal2', factors, lookupFailed: false }), 'challenge');
  }
});

test('row 6: resolved, no verified factor → set (empty list is NOT a failed lookup)', () => {
  assert.equal(recoveryPhase({ recovering: true, currentLevel: 'aal1', nextLevel: 'aal1', factors: [], lookupFailed: false }), 'set');
  // unverified factor does not count (abandoned enrollment)
  assert.equal(recoveryPhase({ recovering: true, currentLevel: 'aal1', nextLevel: 'aal2', factors: [{ id: 'f2', status: 'unverified', factor_type: 'totp' }], lookupFailed: false }), 'set');
});

// ---- newPasswordIssue -----------------------------------------------------

test('newPasswordIssue: 5 chars too short, 6 ok; mismatch detected; ok → null', () => {
  assert.equal(newPasswordIssue('12345', '12345'), 'too_short');
  assert.equal(newPasswordIssue('', ''), 'too_short');
  assert.equal(newPasswordIssue('123456', '123457'), 'mismatch');
  assert.equal(newPasswordIssue('123456', '123456'), null);
});

// ---- resetRequestMessage --------------------------------------------------

test('resetRequestMessage: success and user-not-found are enumeration-safe', () => {
  assert.deepEqual(resetRequestMessage(null), { kind: 'sent', text: RESET_SENT_COPY });
  assert.deepEqual(resetRequestMessage({ message: 'User not found', status: 400 }), { kind: 'sent', text: RESET_SENT_COPY });
});

test('resetRequestMessage: rate limit surfaces (code and bare 429)', () => {
  assert.deepEqual(resetRequestMessage({ code: 'over_email_send_rate_limit', status: 429 }), { kind: 'rate_limited', text: RESET_RATE_LIMIT_COPY });
  assert.deepEqual(resetRequestMessage({ status: 429 }), { kind: 'rate_limited', text: RESET_RATE_LIMIT_COPY });
});

// ---- recoveryErrorFromHash ------------------------------------------------
// Fixtures match GoTrue's ACTUAL error fragment: error, error_code,
// error_description — NO `type` param (spec §4b / §8).

test('recoveryErrorFromHash: otp_expired and access_denied → expired', () => {
  assert.equal(recoveryErrorFromHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), 'expired');
  assert.equal(recoveryErrorFromHash('#error=access_denied&error_description=Denied'), 'expired');
});

test('recoveryErrorFromHash: success hash, empty, junk → null', () => {
  assert.equal(recoveryErrorFromHash('#access_token=xyz&refresh_token=abc&type=recovery'), null);
  assert.equal(recoveryErrorFromHash(''), null);
  assert.equal(recoveryErrorFromHash(null), null);
  assert.equal(recoveryErrorFromHash('#foo=bar'), null);
});

// ---- resetRedirectTarget --------------------------------------------------
// Spec §3: origin unless it IS the marketing origin, then appOrigin.

const APP = 'https://app.primtracker.com';
const MKT = 'https://www.primtracker.com';

test('resetRedirectTarget: app origin passes through', () => {
  assert.equal(resetRedirectTarget({ origin: APP, marketingUrl: MKT, appOrigin: APP }), APP);
});

test('resetRedirectTarget: marketing origin maps to appOrigin (scheme/slash/apex variants)', () => {
  assert.equal(resetRedirectTarget({ origin: MKT, marketingUrl: MKT, appOrigin: APP }), APP);
  assert.equal(resetRedirectTarget({ origin: MKT, marketingUrl: 'https://www.primtracker.com/', appOrigin: APP }), APP);
  assert.equal(resetRedirectTarget({ origin: 'https://primtracker.com', marketingUrl: MKT, appOrigin: APP }), APP);
});

test('resetRedirectTarget: localhost and vercel previews pass through', () => {
  assert.equal(resetRedirectTarget({ origin: 'http://localhost:3000', marketingUrl: MKT, appOrigin: APP }), 'http://localhost:3000');
  assert.equal(resetRedirectTarget({ origin: 'https://primtracker-git-x-rjprimeconsult-9217s-projects.vercel.app', marketingUrl: MKT, appOrigin: APP }), 'https://primtracker-git-x-rjprimeconsult-9217s-projects.vercel.app');
});

test('resetRedirectTarget: absent marketingUrl → origin wins', () => {
  assert.equal(resetRedirectTarget({ origin: MKT, marketingUrl: undefined, appOrigin: APP }), MKT);
  assert.equal(resetRedirectTarget({ origin: MKT, marketingUrl: '', appOrigin: APP }), MKT);
});
```

- [ ] **Step 1.2: Run to verify failure**

Run: `node --test src/lib/passwordReset.test.mjs`
Expected: FAIL — `Cannot find module ... passwordReset.mjs`

- [ ] **Step 1.3: Implement** — `src/lib/passwordReset.mjs`:

```js
/**
 * Pure logic for password reset + change password (spec
 * docs/superpowers/specs/2026-08-26-password-reset-design.md §5).
 * No Supabase imports — every branch runs under node --test.
 *
 * recoveryPhase's row order is NORMATIVE (first match wins) and is a
 * security property, not style:
 *   row 2 (loading) keeps the set-password form off-screen until the AAL
 *   lookup resolves — without it, an enrolled account's first frame is the
 *   set form and an autofill+Enter rotates the password at aal1.
 *   row 3 (blocked) fails CLOSED — the opposite direction from MfaGate,
 *   deliberately: a user mid-recovery can retry or re-enter from a fresh
 *   link, while MfaGate protects against locking the operator out of a
 *   signed-in session. See spec §4c.3.
 */
import { verifiedTotpFactor } from './mfa.mjs';

export function recoveryPhase({ recovering, currentLevel, nextLevel, factors, lookupFailed } = {}) {
  if (!recovering) return 'none';
  if (currentLevel == null && !lookupFailed) return 'loading';
  if (lookupFailed) return 'blocked';
  if (currentLevel === 'aal2') return 'set';
  if (verifiedTotpFactor(factors) && currentLevel === 'aal1' && nextLevel === 'aal2') return 'challenge';
  return 'set';
}

/** Shared validator for the recovery screen and the Profile form (min 6 = parity with signup). */
export function newPasswordIssue(pw, confirm) {
  if (!pw || pw.length < 6) return 'too_short';
  if (pw !== confirm) return 'mismatch';
  return null;
}

// Enumeration-safe by design: success and "no such user" read identically
// (spec §4a). Only rate limits surface, because the user can act on those.
export const RESET_SENT_COPY = 'If an account exists for that email, a reset link is on the way. Check spam too.';
export const RESET_RATE_LIMIT_COPY = 'Too many requests — wait a minute and try again.';

export function resetRequestMessage(error) {
  if (error && (error.code === 'over_email_send_rate_limit' || error.status === 429)) {
    return { kind: 'rate_limited', text: RESET_RATE_LIMIT_COPY };
  }
  return { kind: 'sent', text: RESET_SENT_COPY };
}

/**
 * GoTrue's expired/used-link redirect leaves
 * `#error=access_denied&error_code=otp_expired&error_description=…` in the
 * URL and emits NO auth event. There is no `type` param on the error path,
 * so this cannot distinguish a stale recovery link from a stale signup
 * confirmation — callers must keep the copy generic (spec §4b).
 */
export function recoveryErrorFromHash(hash) {
  if (!hash || typeof hash !== 'string') return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('error_code') === 'otp_expired') return 'expired';
  if (params.get('error') === 'access_denied') return 'expired';
  return null;
}

const hostOf = (url) => {
  try { return new URL(String(url)).host.toLowerCase(); } catch { return null; }
};
const stripWww = (host) => (host && host.startsWith('www.') ? host.slice(4) : host);

/**
 * Spec §3 redirect rule: the browser's own origin is right everywhere
 * (localhost, previews, app host) EXCEPT the marketing host, where the
 * recovery link would burn its token on the landing page — there, the app
 * origin wins. Apex and www count as the same marketing host, matching
 * classifyHost() in hostRouting.mjs.
 */
export function resetRedirectTarget({ origin, marketingUrl, appOrigin } = {}) {
  const o = hostOf(origin);
  const m = hostOf(marketingUrl);
  if (o && m && stripWww(o) === stripWww(m)) return appOrigin;
  return origin;
}
```

- [ ] **Step 1.4: Run to verify pass**

Run: `node --test src/lib/passwordReset.test.mjs`
Expected: all tests PASS.

- [ ] **Step 1.5: Full node lane** — `npm test` → 754 + new = all pass, 0 fail.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/passwordReset.mjs src/lib/passwordReset.test.mjs
git commit -m "feat(auth): pure password-reset phase logic + redirect rule (spec §5)"
```

---

### Task 2: `AuthProvider` — recovery detection

**Files:**
- Modify: `src/components/auth/AuthProvider.jsx`

- [ ] **Step 2.1: Implement both detection paths + `clearRecovery`.** Replace the component body per spec §3 (belt and braces). Full new file content:

```jsx
'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

const AuthContext = createContext({
  user: null,
  loading: true,
  recovery: false,
  clearRecovery: () => {},
  signOut: async () => {},
});

// Password-recovery detection is belt-and-braces (spec §3): the
// PASSWORD_RECOVERY event fires from a setTimeout(0) inside supabase's
// _initialize, and our subscription below races it — so the PRIMARY signal
// is a synchronous read of the URL hash at first render, before supabase
// can have cleared it. The guard matters: this component is prerendered
// during `next build`, where `window` does not exist (an unguarded read
// took down a deploy on 2026-06-12 — see src/lib/supabase.js header).
const sniffRecoveryHash = () =>
  typeof window !== 'undefined' && window.location.hash.includes('type=recovery');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(sniffRecoveryHash);

  useEffect(() => {
    if (!supabaseConfigured()) {
      setLoading(false);
      return;
    }
    // Initial session check
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setLoading(false);
    });
    // Listen for auth state changes (sign in / sign out / token refresh /
    // password recovery — the BACKUP recovery signal, see sniff above)
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const clearRecovery = useCallback(() => setRecovery(false), []);

  const signOut = async () => {
    await supabase.auth.signOut();
    // Force a clean reload so all in-memory state resets
    window.location.reload();
  };

  return (
    <AuthContext.Provider value={{ user, loading, recovery, clearRecovery, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 2.2: Verify nothing broke and prerender survives**

Run: `npm run test:all` → both lanes green. Then `npm run build` → exits 0 (this is the prerender-guard check; a bare `window` read fails here, not in tests).

- [ ] **Step 2.3: Commit**

```bash
git add src/components/auth/AuthProvider.jsx
git commit -m "feat(auth): recovery detection — hash sniff + PASSWORD_RECOVERY event (spec §3)"
```

---

### Task 3: `RecoveryScreen` (UI lane, TDD)

**Files:**
- Create: `src/components/auth/RecoveryScreen.jsx`
- Create: `src/components/auth/RecoveryScreen.test.jsx`

- [ ] **Step 3.1: Resolve spec §6.3 FIRST** — does GoTrue enforce aal2 server-side for `updateUser` on MFA accounts? Check the installed source:

Run: `grep -n "aal" node_modules/@supabase/auth-js/dist/main/GoTrueClient.js | head -20` and inspect the `updateUser`/`_useSession` area. Record the finding (either way) in the RecoveryScreen header comment in Step 3.3. Do not skip: the comment is a spec deliverable.

- [ ] **Step 3.2: Write the failing tests** — `src/components/auth/RecoveryScreen.test.jsx`:

```jsx
/**
 * RecoveryScreen — the in-app set-new-password surface (spec §4c).
 * Security-critical assertions:
 *   - NO password input in the DOM on first paint (loading phase) — this is
 *     the autofill-at-aal1 hole (spec §4c / r2 major #2)
 *   - enrolled accounts see the TOTP challenge BEFORE the set form
 *   - failed lookups → blocked screen with Retry, never a form
 *   - updateUser is called with the TYPED password (payload, not just count)
 * Conventions: assert payloads; await flush() before any zero-call assertion.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const mfaMocks = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      signOut: vi.fn(),
      mfa: mfaMocks,
    },
  },
  supabaseConfigured: () => true,
}));

import { supabase } from '@/lib/supabase';
import RecoveryScreen from './RecoveryScreen';

const flush = () => act(async () => {});
const FACTOR = { id: 'f1', status: 'verified', factor_type: 'totp' };

// Deferred promise helper — lets a test hold the lookups "in flight".
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
});

function arm({ aal = { currentLevel: 'aal1', nextLevel: 'aal1' }, factors = { all: [], totp: [] } } = {}) {
  mfaMocks.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: aal, error: null });
  mfaMocks.listFactors.mockResolvedValue({ data: factors, error: null });
}

test('first paint: spinner, NO password input in the DOM', async () => {
  const gate = deferred();
  mfaMocks.getAuthenticatorAssuranceLevel.mockReturnValue(gate.promise);
  mfaMocks.listFactors.mockReturnValue(gate.promise);
  render(<RecoveryScreen onDone={vi.fn()} />);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  gate.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
  await flush();
});

test('unenrolled: straight to set; updateUser gets the TYPED password; onDone after success', async () => {
  vi.useFakeTimers();
  arm();
  const onDone = vi.fn();
  render(<RecoveryScreen onDone={onDone} />);
  await flush();
  const [pw, confirm] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(pw, { target: { value: 'brand-new-pass' } });
  fireEvent.change(confirm, { target: { value: 'brand-new-pass' } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
  await flush();
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'brand-new-pass' });
  expect(onDone).not.toHaveBeenCalled();          // inline success dwell first
  await act(async () => { vi.runAllTimers(); });
  expect(onDone).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test('enrolled at aal1: TOTP challenge renders BEFORE any password input', async () => {
  arm({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' }, factors: { all: [FACTOR], totp: [FACTOR] } });
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  expect(screen.getByText(/enter your code/i)).toBeTruthy();
  expect(document.querySelector('input[type="password"]')).toBeNull();
});

test('challenge → aal2 re-resolve lands on set (no loop)', async () => {
  mfaMocks.getAuthenticatorAssuranceLevel
    .mockResolvedValueOnce({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null })
    .mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
  mfaMocks.listFactors.mockResolvedValue({ data: { all: [FACTOR], totp: [FACTOR] }, error: null });
  mfaMocks.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  fireEvent.change(screen.getByLabelText(/six-digit/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /verify/i }));
  await flush();
  expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
});

test('lookup failure: blocked screen with Retry, no form; Retry re-resolves', async () => {
  mfaMocks.getAuthenticatorAssuranceLevel.mockRejectedValueOnce(new Error('boom'));
  mfaMocks.listFactors.mockRejectedValueOnce(new Error('boom'));
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  expect(screen.getByText(/couldn't verify your account's security settings/i)).toBeTruthy();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  arm();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await flush();
  expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
});

test('mismatch and short passwords never reach updateUser', async () => {
  arm();
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  const [pw, confirm] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(pw, { target: { value: 'abcdef' } });
  fireEvent.change(confirm, { target: { value: 'abcdeX' } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
  await flush();
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(screen.getByText(/don't match/i)).toBeTruthy();
});

test('updateUser error (e.g. leaked password) surfaces verbatim; onDone NOT called', async () => {
  arm();
  supabase.auth.updateUser.mockResolvedValue({ data: null, error: { message: 'Password is known to be weak and easy to guess' } });
  const onDone = vi.fn();
  render(<RecoveryScreen onDone={onDone} />);
  await flush();
  const [pw, confirm] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(pw, { target: { value: 'password' } });
  fireEvent.change(confirm, { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
  await flush();
  expect(screen.getByText(/weak and easy to guess/i)).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
});
```

- [ ] **Step 3.3: Run to verify failure** — `npx vitest run src/components/auth/RecoveryScreen.test.jsx` → FAIL (module not found).

- [ ] **Step 3.4: Implement** — `src/components/auth/RecoveryScreen.jsx`:

```jsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { recoveryPhase, newPasswordIssue } from '@/lib/passwordReset.mjs';
import { verifiedTotpFactor } from '@/lib/mfa.mjs';
import { MfaChallenge } from './MfaGate';

/**
 * RecoveryScreen — shown instead of the app while a password-recovery
 * session is active (spec §4c). Phase order is a security property:
 *
 *   loading   → spinner only. The set form must never paint before the AAL
 *               lookup resolves, or an autofill can rotate an MFA-enrolled
 *               account's password at aal1.
 *   challenge → MfaChallenge (decision A: inbox compromise alone must not
 *               be enough to rotate an MFA-protected password).
 *   set       → new password form.
 *   blocked   → lookups errored; fail CLOSED with Retry/Sign out. Opposite
 *               direction from MfaGate's fail-open — a recovery user can
 *               retry or re-enter from a fresh link; a locked-out operator
 *               on a signed-in session cannot.
 *
 * [Record §6.3 finding here after Step 3.1 — does GoTrue enforce aal2
 *  server-side for updateUser on MFA accounts? Either way this client gate
 *  is required; state which role it plays.]
 */
export default function RecoveryScreen({ onDone }) {
  const [lookup, setLookup] = useState({ currentLevel: null, nextLevel: null, factors: null, lookupFailed: false });
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const resolve = useCallback(async () => {
    setLookup({ currentLevel: null, nextLevel: null, factors: null, lookupFailed: false });
    try {
      const [aalRes, factorsRes] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      // supabase-js resolves { data, error } — a failed call is NOT a throw.
      if (aalRes?.error || factorsRes?.error) throw aalRes?.error || factorsRes?.error;
      setLookup({
        currentLevel: aalRes?.data?.currentLevel ?? null,
        nextLevel: aalRes?.data?.nextLevel ?? null,
        factors: factorsRes?.data ?? null,
        lookupFailed: aalRes?.data?.currentLevel == null, // null AAL after a "successful" call = unusable shape
      });
    } catch {
      setLookup((s) => ({ ...s, lookupFailed: true }));
    }
  }, []);

  useEffect(() => { resolve(); }, [resolve]);

  const phase = recoveryPhase({ recovering: true, ...lookup });

  const submit = async (e) => {
    e.preventDefault();
    const issue = newPasswordIssue(pw, confirm);
    if (issue) {
      setError(issue === 'too_short' ? 'Password must be at least 6 characters.' : "Those passwords don't match.");
      return;
    }
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) { setError(err.message || 'Could not update the password. Try again.'); return; }
    setSaved(true);
    setTimeout(() => onDone(), 1500); // inline success dwell, then the normal gate chain (spec §4c.2)
  };

  const signOut = async () => { await supabase.auth.signOut(); window.location.reload(); };

  if (phase === 'challenge') {
    return <MfaChallenge factor={verifiedTotpFactor(lookup.factors)} onDone={resolve} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-lg">
          <KeyRound size={26} />
        </div>

        {phase === 'loading' && (
          <div className="text-slate-500 flex items-center justify-center gap-2 py-8">
            <Loader2 size={16} className="animate-spin" /> Checking your account…
          </div>
        )}

        {phase === 'blocked' && (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Something went wrong</h1>
            <p className="text-sm text-slate-600 mb-6">
              We couldn&apos;t verify your account&apos;s security settings.
            </p>
            <button
              onClick={resolve}
              className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-lg py-2.5 text-sm font-bold"
            >
              Retry
            </button>
            <button onClick={signOut} className="mt-4 text-xs text-slate-500 hover:text-slate-700 underline">
              Sign out
            </button>
          </>
        )}

        {phase === 'set' && (saved ? (
          <div className="text-emerald-700 flex items-center justify-center gap-2 py-8 text-sm font-semibold">
            <CheckCircle2 size={18} /> Password updated — taking you in…
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Set a new password</h1>
            <p className="text-sm text-slate-600 mb-6">
              You&apos;re signed in from your reset link. Pick a new password to finish.
            </p>
            <form onSubmit={submit} className="space-y-3 text-left">
              <input
                type="password" required minLength={6} autoComplete="new-password"
                value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="New password (6+ characters)" aria-label="New password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="password" required minLength={6} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password" aria-label="Confirm new password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit" disabled={busy}
                className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />} Set new password
              </button>
              {error && (
                <p className="text-sm text-rose-600 flex items-center gap-1.5">
                  <AlertCircle size={14} className="flex-shrink-0" /> {error}
                </p>
              )}
            </form>
            <button onClick={signOut} className="mt-4 text-xs text-slate-500 hover:text-slate-700 underline">
              I&apos;ll do this later — sign out
            </button>
          </>
        ))}
      </div>
    </div>
  );
}
```

Note the `lookupFailed: aalRes?.data?.currentLevel == null` line: a "successful" AAL call that returns no level is an unusable shape — treating it as resolved would make row 6 hand out the set form on garbage. Fail closed (spec §4c.3 direction).

- [ ] **Step 3.5: Run to verify pass** — `npx vitest run src/components/auth/RecoveryScreen.test.jsx` → all PASS.

- [ ] **Step 3.6: Commit**

```bash
git add src/components/auth/RecoveryScreen.jsx src/components/auth/RecoveryScreen.test.jsx
git commit -m "feat(auth): RecoveryScreen — loading/challenge/set/blocked phases (spec §4c)"
```

---

### Task 4: `AuthGate` wiring — forgot mode, expired-link notice, recovery swap; `supabase.js` flowType comment

**Files:**
- Modify: `src/components/auth/AuthGate.jsx`
- Modify: `src/lib/supabase.js` (comment only)
- Create: `src/components/auth/AuthGate.forgot.test.jsx`

- [ ] **Step 4.1: Write the failing tests** — `src/components/auth/AuthGate.forgot.test.jsx`:

```jsx
/**
 * AuthGate forgot-password mode + expired-link notice (spec §4a/§4b) and the
 * RecoveryScreen swap (spec §3). Enumeration safety and the no-auto-switch
 * rule are the security assertions here.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const authState = vi.hoisted(() => ({ value: { user: null, loading: false, recovery: false, clearRecovery: vi.fn(), signOut: vi.fn() } }));
vi.mock('./AuthProvider', () => ({ useAuth: () => authState.value }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn() } },
  supabaseConfigured: () => true,
}));
vi.mock('./RecoveryScreen', () => ({ default: () => <div data-testid="recovery-screen" /> }));
vi.mock('../motion/ConstellationBackground', () => ({ default: () => null }));
vi.mock('./MigrationPrompt', () => ({ default: () => null }));
vi.mock('./LegalAcceptanceGate', () => ({ default: () => null }));
vi.mock('./MfaGate', () => ({ default: ({ children }) => children }));

import { supabase } from '@/lib/supabase';
import AuthGate from './AuthGate';

const flush = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  authState.value = { user: null, loading: false, recovery: false, clearRecovery: vi.fn(), signOut: vi.fn() };
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  window.history.replaceState(null, '', '/');
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

test('user + recovery → RecoveryScreen instead of the app', async () => {
  authState.value = { ...authState.value, user: { id: 'u1' }, recovery: true };
  render(<AuthGate>app-content</AuthGate>);
  await flush();
  expect(screen.getByTestId('recovery-screen')).toBeTruthy();
  expect(screen.queryByText('app-content')).toBeNull();
});

test('Forgot password button is type=button — clicking never fires signInWithPassword', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  const btn = screen.getByRole('button', { name: /forgot password/i });
  expect(btn.getAttribute('type')).toBe('button');
  fireEvent.click(btn);
  await flush();
  expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
});

test('forgot mode: enumeration-safe copy on success AND on user-not-found', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
  await flush();
  expect(screen.getByText(/if an account exists/i)).toBeTruthy();
  // user-not-found-shaped error reads identically
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'User not found', status: 400 } });
  // fresh render to reset the cooldown
  authState.value = { ...authState.value };
});

test('redirectTo goes through the marketing-host rule (payload pinned)', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
  await flush();
  const [, opts] = supabase.auth.resetPasswordForEmail.mock.calls[0];
  // jsdom origin is localhost → passes through the rule untouched
  expect(opts.redirectTo).toBe(window.location.origin);
});

test('expired hash: notice renders, mode STAYS signin, hash cleared', async () => {
  window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=x');
  render(<AuthGate>x</AuthGate>);
  await flush();
  expect(screen.getByText(/expired or was already used/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy(); // still signin mode
  expect(window.location.hash).toBe('');
});

test('60s cooldown: second send within the window is refused', async () => {
  vi.useFakeTimers();
  render(<AuthGate>x</AuthGate>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  const send = screen.getByRole('button', { name: /send reset link/i });
  fireEvent.click(send);
  await act(async () => {});
  expect(send.disabled).toBe(true);
  await act(async () => { vi.advanceTimersByTime(61_000); });
  expect(screen.getByRole('button', { name: /send reset link/i }).disabled).toBe(false);
  vi.useRealTimers();
});
```

- [ ] **Step 4.2: Run to verify failure** — `npx vitest run src/components/auth/AuthGate.forgot.test.jsx` → FAIL.

- [ ] **Step 4.3: Implement in `AuthGate.jsx`:**

1. Imports: add `RecoveryScreen`, and from `@/lib/passwordReset.mjs`: `recoveryErrorFromHash`, `resetRequestMessage`, `resetRedirectTarget`; add `appUrl` from `@/lib/appUrl.mjs`.
2. In `AuthGate` (the gate component), destructure `recovery` from `useAuth()` and add, immediately after the `if (!user) return <SignInScreen />;` line:

```jsx
  if (recovery) return <RecoveryScreen />;
```

   with `RecoveryScreen`'s `onDone` wired via a tiny wrapper: pass `clearRecovery` from `useAuth()` — i.e. `if (recovery) return <RecoveryScreen onDone={clearRecovery} />;` (destructure `clearRecovery` too). This sits ABOVE `MigrationPrompt`/`LegalAcceptanceGate`/`MfaGate` (spec §3 gate order).
3. In `SignInScreen`:
   - `mode` union gains `'forgot'`.
   - Expired-hash notice (spec §4b) — state + effect:

```jsx
  const [linkNotice, setLinkNotice] = useState(() =>
    typeof window !== 'undefined' && recoveryErrorFromHash(window.location.hash) === 'expired'
      ? 'That link has expired or was already used. If you were resetting your password, request a new link below.'
      : ''
  );
  useEffect(() => {
    if (linkNotice) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

   - Forgot button inside the form, next to the password label (only in signin mode):

```jsx
  <button
    type="button"
    onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}
    className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
  >
    Forgot password?
  </button>
```

   - Forgot mode branch in `submit` (before the signin/signup branches), plus a `cooldown` state:

```jsx
  const [cooldown, setCooldown] = useState(false);
  // in submit():
  if (mode === 'forgot') {
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectTarget({
        origin: window.location.origin,
        marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL,
        appOrigin: appUrl(),
      }),
    });
    const msg = resetRequestMessage(err);
    if (msg.kind === 'rate_limited') setError(msg.text);
    else {
      setInfo(msg.text);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 60_000);
    }
    setBusy(false);
    return;
  }
```

   - Forgot mode renders ONLY the email field + a "Send reset link" submit button (`disabled={busy || cooldown}`), the notice/info/error blocks, and a "Back to sign in" `type="button"` link. Hide the password field and the signup toggle in this mode.
   - Render `linkNotice` (amber style, same visual family as the error block) above the form when non-empty.
4. `src/lib/supabase.js` — add to the auth options block (comment only, no behavior change):

```js
      // flowType intentionally left at the 'implicit' default. Password
      // recovery depends on it: the reset email must work when opened on a
      // DIFFERENT device than the one that requested it ("forgot on my mac,
      // want to log in on both" — ticket #4). Under 'pkce' the code verifier
      // lives in the requesting browser's localStorage and the link dies on
      // every other device. Do not change without re-testing cross-device
      // recovery. (Spec §6.1, 2026-08-26.)
```

- [ ] **Step 4.4: Run tests** — `npx vitest run src/components/auth/AuthGate.forgot.test.jsx` → PASS. Then full `npm run test:all` and `npm run build` → green.

- [ ] **Step 4.5: Commit**

```bash
git add src/components/auth/AuthGate.jsx src/components/auth/AuthGate.forgot.test.jsx src/lib/supabase.js
git commit -m "feat(auth): forgot-password mode, expired-link notice, recovery swap (spec §4a/§4b)"
```

---

### Task 5: Profile Security section — `ChangePasswordForm` (UI lane, TDD)

**Files:**
- Create: `src/components/auth/ChangePasswordForm.jsx`
- Create: `src/components/auth/ChangePasswordForm.test.jsx`
- Modify: `src/components/Profile.jsx` (SECTIONS ~line 83, content chain ~line 347-390, footer ~line 397, lucide import block lines 22-45)

- [ ] **Step 5.1: Write the failing tests** — `src/components/auth/ChangePasswordForm.test.jsx`:

```jsx
/**
 * ChangePasswordForm (spec §4d). The security assertion that matters most:
 * the CURRENT-password check runs on a THROWAWAY client — the singleton's
 * signInWithPassword must NEVER be called, or an admin's aal2 session gets
 * silently downgraded and every /api/admin/* call 403s.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const throwaway = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signOut: vi.fn() },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => throwaway) }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), updateUser: vi.fn() } },
  supabaseConfigured: () => true,
}));

import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import ChangePasswordForm from './ChangePasswordForm';

const flush = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  throwaway.auth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
  throwaway.auth.signOut.mockResolvedValue({ error: null });
  supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
});

function fill({ current = 'old-pass-1', next = 'new-pass-1', confirm = 'new-pass-1' } = {}) {
  const [c, n, cf] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(c, { target: { value: current } });
  fireEvent.change(n, { target: { value: next } });
  fireEvent.change(cf, { target: { value: confirm } });
}

test('success path: throwaway verifies, singleton updates, singleton signIn NEVER called', async () => {
  render(<ChangePasswordForm email="agent@x.com" />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(throwaway.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'agent@x.com', password: 'old-pass-1' });
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass-1' });
  expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();       // the aal2-preservation pin
  expect(throwaway.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  const opts = createClient.mock.calls[0][2];
  expect(opts.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'prim-pw-verify' });
  expect(screen.getByText(/password updated/i)).toBeTruthy();
});

test('wrong current password: inline error, updateUser NEVER called', async () => {
  throwaway.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } });
  render(<ChangePasswordForm email="agent@x.com" />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(screen.getByText(/current password isn't right/i)).toBeTruthy();
});

test('mismatch / too short: nothing is called at all', async () => {
  render(<ChangePasswordForm email="agent@x.com" />);
  fill({ confirm: 'different-1' });
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(throwaway.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(screen.getByText(/don't match/i)).toBeTruthy();
});

test('updateUser error (leaked password) surfaces; form stays editable', async () => {
  supabase.auth.updateUser.mockResolvedValue({ data: null, error: { message: 'Password is known to be weak and easy to guess' } });
  render(<ChangePasswordForm email="agent@x.com" />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(screen.getByText(/weak and easy to guess/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /change password/i }).disabled).toBe(false);
});
```

- [ ] **Step 5.2: Run to verify failure** — FAIL (module not found).

- [ ] **Step 5.3: Implement** — `src/components/auth/ChangePasswordForm.jsx`:

```jsx
'use client';
import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { newPasswordIssue } from '@/lib/passwordReset.mjs';

/**
 * Change password from Profile → Security (spec §4d).
 *
 * The current-password check runs on a THROWAWAY client, never the
 * singleton: signInWithPassword on the singleton would mint and SAVE a new
 * aal1 JWT, silently downgrading an aal2 admin session so every
 * /api/admin/* call 403s until re-challenge. The throwaway is memory-only
 * (persistSession:false), parses no URL, and uses its own storageKey so it
 * shares no auth lock with the singleton. signOut({scope:'local'}) discards
 * its session without revoking the singleton's server-side refresh token.
 */
function verifyClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'prim-pw-verify' } },
  );
}

export default function ChangePasswordForm({ email }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaved(false);
    const issue = newPasswordIssue(pw, confirm);
    if (issue) {
      setError(issue === 'too_short' ? 'New password must be at least 6 characters.' : "Those passwords don't match.");
      return;
    }
    setBusy(true); setError('');
    try {
      const throwaway = verifyClient();
      const { error: verifyErr } = await throwaway.auth.signInWithPassword({ email, password: current });
      // Discard the throwaway session either way; never touches the singleton.
      await throwaway.auth.signOut({ scope: 'local' });
      if (verifyErr) {
        setError("That current password isn't right.");
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: pw });
      if (updateErr) {
        setError(updateErr.message || 'Could not update the password. Try again.');
        return;
      }
      setSaved(true);
      setCurrent(''); setPw(''); setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md">
      <h3 className="text-sm font-bold text-slate-900 mb-1">Change password</h3>
      <p className="text-xs text-slate-500 mb-4">
        Pick something you don&apos;t use anywhere else. You&apos;ll stay signed in here.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password" required autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password" aria-label="Current password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          type="password" required minLength={6} autoComplete="new-password"
          value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder="New password (6+ characters)" aria-label="New password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          type="password" required minLength={6} autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password" aria-label="Confirm new password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit" disabled={busy}
          className="bg-gradient-to-br from-indigo-600 to-violet-600 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-bold flex items-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Change password
        </button>
        {error && (
          <p className="text-sm text-rose-600 flex items-center gap-1.5">
            <AlertCircle size={14} className="flex-shrink-0" /> {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} className="flex-shrink-0" /> Password updated.
          </p>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 5.4: Run to verify pass** — `npx vitest run src/components/auth/ChangePasswordForm.test.jsx` → PASS.

- [ ] **Step 5.5: Wire into Profile.jsx** (four precise edits — read each site first, line numbers may have drifted):

1. Lucide import block (lines 22-45): add `ShieldCheck` if not present.
2. `SECTIONS` array (~line 83): after the `sender` entry add
   `{ id: 'security', label: 'Security', icon: ShieldCheck, phase: 1 },`
   (`phase` is inert — kept for convention only.)
3. Content chain (~line 347-390): after the `{active === 'sender' && …}` block add
   `{active === 'security' && <ChangePasswordForm email={authUser?.email} />}`
   and import `ChangePasswordForm` from `./auth/ChangePasswordForm`.
4. Sticky footer (~line 397): change
   `{!loading && active !== 'subscription' && (` to
   `{!loading && active !== 'subscription' && active !== 'security' && (`
   — otherwise the modal's most prominent button is a "Save changes" that saves
   agent-profile fields, flashes "Saved", and leaves the password unchanged.

- [ ] **Step 5.6: Full verification** — `npm run test:all` → both lanes green; `npm run lint` → 0 errors; `npm run build` → exits 0.

- [ ] **Step 5.7: Commit**

```bash
git add src/components/auth/ChangePasswordForm.jsx src/components/auth/ChangePasswordForm.test.jsx src/components/Profile.jsx
git commit -m "feat(profile): Security section — change password via throwaway client (spec §4d)"
```

---

### Task 6: Mutation checks (manual, house rule)

No files shipped — this task PROVES the tests bite. For each mutation: apply, run the named suite, confirm RED, revert (restore from a file copy — never `git checkout --` over uncommitted work).

- [ ] **M1:** In `recoveryPhase`, delete the loading row (row 2). Run `npx vitest run src/components/auth/RecoveryScreen.test.jsx` → the first-paint test must FAIL. Revert.
- [ ] **M2:** Change row 4 to `if (currentLevel === 'aal2') return 'challenge';`. Run the RecoveryScreen suite → the no-loop test must FAIL. Revert.
- [ ] **M3:** Neuter row 5 (`return 'set'` unconditionally after row 4). RecoveryScreen enrolled-account test must FAIL. Revert.
- [ ] **M4:** In `ChangePasswordForm`, swap the throwaway for the singleton (`supabase.auth.signInWithPassword(...)`). ChangePasswordForm suite → session-preservation test must FAIL. Revert.
- [ ] **M5:** Delete the current-password pre-check (call `updateUser` directly). ChangePasswordForm wrong-password test must FAIL. Revert.
- [ ] **M6:** In `resetRequestMessage`, return the rate-limit copy for user-not-found errors. Node lane → enumeration-safety test must FAIL. Revert.
- [ ] **Confirm tree is clean after reverts:** `git status` shows no unstaged changes; `npm run test:all` green.
- [ ] Record the mutation results (which test killed which mutant) in the final commit message or PR notes.

---

### Task 7: Branch, CI, operator config, live pass

- [ ] **Step 7.1:** All work should be on branch `feature/password-reset` (create at Task 1 start: `git checkout -b feature/password-reset`). Push: `git push -u origin feature/password-reset`. CI runs on every branch push — confirm green (node lane, UI lane, build, lint).
- [ ] **Step 7.2: STOP — operator (Juan) does spec §7 config before any live testing:**
  - Supabase → Authentication → URL Configuration: Site URL → `https://app.primtracker.com`; allowlist `https://app.primtracker.com/**`, `http://localhost:3000/**`, `https://*-rjprimeconsult-9217s-projects.vercel.app/**`; REMOVE `https://www.primtracker.com/**`.
  - Note prior values first; afterwards send a test signup confirmation to verify that flow still lands.
- [ ] **Step 7.3: Live pass on the branch preview (spec §8):**
  - Real recovery email to a test account → link → set screen → new password works in a SECOND browser (the actual ticket #4 scenario).
  - Juan's enrolled admin account: recovery link shows the TOTP challenge BEFORE the set form.
  - Profile → Security password change on the admin account, then hit an admin surface (e.g. tickets) → still works (aal2 preserved).
  - An expired link (reuse a consumed one) → generic expired notice on the sign-in card, mode stays signin.
- [ ] **Step 7.4:** Merge decision is Juan's (SEND/PUBLISH gate — merging deploys to prod). Announcement via `[announce]` commit-message convention if he wants one.

---

## Post-merge follow-ups (log, do NOT build here)

- Resolve ticket #4 in the admin panel once the feature is live (the resolution email can now say "use Forgot password on the sign-in screen").
- WISP: AAL-aware RLS follow-up (spec §9.1) stays on the gap list.
- Custom SMTP via Resend for auth emails (spec §9.2) — later upgrade.
