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

// PINS a known config hazard, not a desirable behavior: appUrl() falls back
// to the MARKETING origin when NEXT_PUBLIC_SITE_URL is absent (appUrl.mjs
// cutover-era comment; middleware.js uses the app origin — they disagree).
// If that env var ever vanishes, the rule maps marketing → marketing and the
// token burns. The env var is set in dev/preview/prod today; this test
// documents what breaks if that stops being true.
test('resetRedirectTarget: marketing appOrigin passes through unchanged (env-absence hazard, documented)', () => {
  assert.equal(resetRedirectTarget({ origin: MKT, marketingUrl: MKT, appOrigin: MKT }), MKT);
});
