// Pure MFA gate-state logic. The states this resolves decide whether an
// agent sees the app, a code prompt, or a forced enrollment screen — a wrong
// answer here either locks the operator out of his own admin account or
// silently lets a stolen password straight in, so every branch is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MFA, mfaState, verifiedTotpFactor } from './mfa.mjs';

const verified = { id: 'f1', status: 'verified', factor_type: 'totp' };
const unverified = { id: 'f2', status: 'unverified', factor_type: 'totp' };

// ---- verifiedTotpFactor ----

test('verifiedTotpFactor accepts a bare array, the listFactors {totp} shape, and {all}', () => {
  assert.equal(verifiedTotpFactor([verified])?.id, 'f1');
  assert.equal(verifiedTotpFactor({ totp: [verified], all: [verified] })?.id, 'f1');
  assert.equal(verifiedTotpFactor({ all: [verified] })?.id, 'f1');
});

test('verifiedTotpFactor ignores unverified factors (abandoned enrollments)', () => {
  // An abandoned enrollment leaves an unverified factor behind. Treating it
  // as real would challenge the user for a code they can never produce.
  assert.equal(verifiedTotpFactor([unverified]), null);
  assert.equal(verifiedTotpFactor([unverified, verified])?.id, 'f1');
});

test('verifiedTotpFactor is null-safe on every empty/garbage shape', () => {
  for (const input of [null, undefined, [], {}, { totp: null }, 'nonsense', 42]) {
    assert.equal(verifiedTotpFactor(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

// ---- mfaState ----

test('enrolled admin who has NOT completed the code prompt is challenged', () => {
  assert.equal(
    mfaState({ currentLevel: 'aal1', nextLevel: 'aal2', factors: [verified], isAdmin: true }),
    MFA.CHALLENGE
  );
});

test('enrolled admin who completed the code prompt reaches the app', () => {
  assert.equal(
    mfaState({ currentLevel: 'aal2', nextLevel: 'aal2', factors: [verified], isAdmin: true }),
    MFA.OK
  );
});

test('admin with NO factor is forced into enrollment (WISP gap #1)', () => {
  assert.equal(
    mfaState({ currentLevel: 'aal1', nextLevel: 'aal1', factors: [], isAdmin: true }),
    MFA.ENROLL_REQUIRED
  );
});

test('admin whose only factor is an abandoned unverified enrollment is forced to enroll, not challenged', () => {
  // The dangerous middle state: a half-finished setup must not read as
  // "protected" (skips enrollment) OR as "challenge" (unanswerable prompt).
  assert.equal(
    mfaState({ currentLevel: 'aal1', nextLevel: 'aal1', factors: [unverified], isAdmin: true }),
    MFA.ENROLL_REQUIRED
  );
});

test('ordinary agent without MFA is never blocked — this rollout is admin-only', () => {
  assert.equal(
    mfaState({ currentLevel: 'aal1', nextLevel: 'aal1', factors: [], isAdmin: false }),
    MFA.OK
  );
  // is_admin absent/null/undefined must behave as non-admin, never as admin.
  for (const notAdmin of [undefined, null, false, 0, '']) {
    assert.equal(
      mfaState({ currentLevel: 'aal1', nextLevel: 'aal1', factors: [], isAdmin: notAdmin }),
      MFA.OK,
      `isAdmin=${JSON.stringify(notAdmin)} must not force enrollment`
    );
  }
});

test('an ordinary agent who opted into MFA still gets challenged', () => {
  assert.equal(
    mfaState({ currentLevel: 'aal1', nextLevel: 'aal2', factors: [verified], isAdmin: false }),
    MFA.CHALLENGE
  );
});

test('a still-loading AAL never forces enrollment or a challenge', () => {
  // Callers render a spinner while AAL is unknown; if this returned
  // ENROLL_REQUIRED on nulls, every admin would flash the setup screen on
  // each page load.
  assert.equal(
    mfaState({ currentLevel: null, nextLevel: null, factors: null, isAdmin: true }),
    MFA.OK
  );
});
