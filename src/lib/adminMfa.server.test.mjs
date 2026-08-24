// Server-side MFA enforcement for the 5 admin routes. This is the control
// that actually stops a stolen admin password — the client gate only stops
// someone from USING the app, not from calling the API directly.
//
// Threat model pinned here: attacker knows the admin password, signs in
// (getting an aal1 session), and calls /api/admin/impersonate to mint a
// login link for any agent. Every test below exists to keep that denied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminMfaOk } from './mfa.mjs';
import { decodeAalFromJwt, requireAdminMfa } from './adminMfa.server.mjs';

const verified = { id: 'f1', status: 'verified', factor_type: 'totp' };
const unverified = { id: 'f2', status: 'unverified', factor_type: 'totp' };

// Build an unsigned JWT with the given payload — signature is irrelevant
// here because getUser() has already verified the token upstream; this only
// reads a claim out of an already-trusted string.
const jwt = (payload) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(payload)).toString('base64url'),
  'sig',
].join('.');

// ---- adminMfaOk (pure decision) ----

test('aal2 session is allowed — the enrolled admin who completed the code prompt', () => {
  assert.equal(adminMfaOk({ aal: 'aal2', factors: [verified] }), true);
});

test('THE ATTACK: enrolled admin at aal1 is DENIED (stolen password, no code)', () => {
  assert.equal(adminMfaOk({ aal: 'aal1', factors: [verified] }), false);
});

test('admin with no factor yet is allowed — pre-enrollment, client gate forces setup', () => {
  // Denying here would brick a not-yet-enrolled admin's own tools with no
  // way to fix it from inside the product.
  assert.equal(adminMfaOk({ aal: 'aal1', factors: [] }), true);
});

test('an abandoned unverified enrollment does not trigger denial', () => {
  assert.equal(adminMfaOk({ aal: 'aal1', factors: [unverified] }), true);
});

test('unreadable factor list at aal1 degrades to allow, never to a locked-out admin', () => {
  // If the factors API shape ever changes, admin tooling must not vanish.
  for (const factors of [null, undefined, {}, 'garbage']) {
    assert.equal(adminMfaOk({ aal: 'aal1', factors }), true);
  }
});

test('missing aal claim with an enrolled factor is still denied', () => {
  // A token with no aal claim must not read as "verified".
  assert.equal(adminMfaOk({ aal: null, factors: [verified] }), false);
  assert.equal(adminMfaOk({ aal: undefined, factors: [verified] }), false);
});

// ---- decodeAalFromJwt ----

test('decodeAalFromJwt reads the aal claim', () => {
  assert.equal(decodeAalFromJwt(jwt({ aal: 'aal2', sub: 'u1' })), 'aal2');
  assert.equal(decodeAalFromJwt(jwt({ aal: 'aal1', sub: 'u1' })), 'aal1');
});

test('decodeAalFromJwt returns null on a token with no aal claim', () => {
  assert.equal(decodeAalFromJwt(jwt({ sub: 'u1' })), null);
});

test('decodeAalFromJwt never throws on garbage', () => {
  for (const bad of [null, undefined, '', 'not.a.jwt', 'a.b', 'a.!!!.c', 42, {}]) {
    assert.equal(decodeAalFromJwt(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// ---- requireAdminMfa (glue) ----

test('requireAdminMfa allows an aal2 caller without any factor lookup', async () => {
  let looked = false;
  const client = { auth: { admin: { getUserById: async () => { looked = true; return {}; } } } };
  const res = await requireAdminMfa({
    accessToken: jwt({ aal: 'aal2' }), user: { id: 'u1' }, adminClient: client,
  });
  assert.equal(res.ok, true);
  assert.equal(looked, false, 'aal2 is conclusive — no extra round-trip');
});

test('requireAdminMfa denies an aal1 caller whose account carries a verified factor', async () => {
  const res = await requireAdminMfa({
    accessToken: jwt({ aal: 'aal1' }),
    user: { id: 'u1', factors: [verified] },
    adminClient: null,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /two-factor/i);
});

test('requireAdminMfa falls back to getUserById when the session user carries no factors field', async () => {
  const client = {
    auth: { admin: { getUserById: async () => ({ data: { user: { factors: [verified] } } }) } },
  };
  const res = await requireAdminMfa({
    accessToken: jwt({ aal: 'aal1' }), user: { id: 'u1' }, adminClient: client,
  });
  assert.equal(res.ok, false, 'the lookup must be consulted, not skipped');
});

test('requireAdminMfa allows when the fallback lookup itself throws', async () => {
  const client = {
    auth: { admin: { getUserById: async () => { throw new Error('network'); } } },
  };
  const res = await requireAdminMfa({
    accessToken: jwt({ aal: 'aal1' }), user: { id: 'u1' }, adminClient: client,
  });
  assert.equal(res.ok, true, 'a transient lookup failure must not lock admins out');
});
