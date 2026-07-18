// Tests for the signed unsubscribe token used by the CAN-SPAM one-click
// opt-out links. The security property that matters: a token we minted
// round-trips to the same owner+email, and any tampering (payload or
// signature) fails closed to null. Never throws on garbage input.
//
// Run: node --test src/lib/unsubscribeToken.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribeToken.mjs';

test('round-trip: make -> verify returns the same owner + email', () => {
  const token = makeUnsubscribeToken('user-123', 'prospect@example.com');
  const out = verifyUnsubscribeToken(token);
  assert.ok(out, 'expected a verified payload');
  assert.equal(out.ownerUserId, 'user-123');
  assert.equal(out.email, 'prospect@example.com');
});

test('email is lowercased + trimmed on the way in and out', () => {
  const token = makeUnsubscribeToken('u1', '  Prospect@Example.COM  ');
  const out = verifyUnsubscribeToken(token);
  assert.ok(out);
  assert.equal(out.email, 'prospect@example.com');
});

test('tampered payload (attacker swaps owner, keeps old signature) -> null', () => {
  const token = makeUnsubscribeToken('victim-user', 'a@b.com');
  const sig = token.slice(token.indexOf('.') + 1);
  const forgedPayload = Buffer
    .from(JSON.stringify({ u: 'attacker-user', e: 'a@b.com', t: Date.now() }), 'utf8')
    .toString('base64url');
  const forged = `${forgedPayload}.${sig}`;
  assert.equal(verifyUnsubscribeToken(forged), null);
});

test('tampered token (single char flip) -> null', () => {
  const token = makeUnsubscribeToken('user-123', 'a@b.com');
  const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
  assert.equal(verifyUnsubscribeToken(flipped), null);
});

test('tampered signature -> null', () => {
  const token = makeUnsubscribeToken('user-9', 'x@y.com');
  const payload = token.slice(0, token.indexOf('.'));
  assert.equal(verifyUnsubscribeToken(`${payload}.deadbeef`), null);
});

test('malformed tokens never throw and return null', () => {
  assert.equal(verifyUnsubscribeToken(''), null);
  assert.equal(verifyUnsubscribeToken(null), null);
  assert.equal(verifyUnsubscribeToken(undefined), null);
  assert.equal(verifyUnsubscribeToken(42), null);
  assert.equal(verifyUnsubscribeToken('no-dot-here'), null);
  assert.equal(verifyUnsubscribeToken('.'), null);
  assert.equal(verifyUnsubscribeToken('payloadonly.'), null);
  assert.equal(verifyUnsubscribeToken('.sigonly'), null);
});

test('different owners produce different tokens for the same email', () => {
  const t1 = makeUnsubscribeToken('u1', 'a@b.com');
  const t2 = makeUnsubscribeToken('u2', 'a@b.com');
  assert.notEqual(t1, t2);
  assert.equal(verifyUnsubscribeToken(t1).ownerUserId, 'u1');
  assert.equal(verifyUnsubscribeToken(t2).ownerUserId, 'u2');
});
