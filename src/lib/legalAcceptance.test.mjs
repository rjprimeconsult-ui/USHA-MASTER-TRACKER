/**
 * Tests for legalAcceptance — the clickwrap record.
 *
 * What these protect: the ENFORCEABILITY of the Terms. The liability cap and
 * the indemnity clause only bind an agent who had notice and affirmatively
 * assented. This module is the record of that assent, so its failure modes
 * are legal, not cosmetic:
 *   - a record that looks valid but names no version proves nothing
 *   - a stale-version record must NOT satisfy a newer document (otherwise
 *     agents are silently bound to terms they never saw)
 *   - a corrupt/garbage record must fail CLOSED (re-prompt), never open
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_LEGAL_VERSION,
  buildAcceptanceRecord,
  parseAcceptanceRecord,
  needsAcceptance,
  ACCEPTANCE_KEY,
} from './legalAcceptance.mjs';

const AT = '2026-08-02T15:04:05.000Z';

test('CURRENT_LEGAL_VERSION is a non-empty stable string', () => {
  assert.equal(typeof CURRENT_LEGAL_VERSION, 'string');
  assert.ok(CURRENT_LEGAL_VERSION.trim().length > 0);
});

test('ACCEPTANCE_KEY is the versioned storage key', () => {
  assert.equal(ACCEPTANCE_KEY, 'legal_acceptance_v1');
});

test('buildAcceptanceRecord captures version, timestamp, documents, and source', () => {
  const r = buildAcceptanceRecord({ at: AT, source: 'signup' });
  assert.equal(r.version, CURRENT_LEGAL_VERSION);
  assert.equal(r.acceptedAt, AT);
  assert.equal(r.source, 'signup');
  // The record must name WHAT was accepted — "they agreed" is not provable
  // unless it says which documents.
  assert.deepEqual(r.documents, ['terms', 'privacy', 'dpa']);
});

test('buildAcceptanceRecord defaults source to app and stamps a real ISO time', () => {
  const r = buildAcceptanceRecord({ at: AT });
  assert.equal(r.source, 'app');
  assert.ok(!Number.isNaN(Date.parse(r.acceptedAt)));
});

test('parseAcceptanceRecord round-trips a stored JSON string', () => {
  const raw = JSON.stringify(buildAcceptanceRecord({ at: AT, source: 'signup' }));
  const parsed = parseAcceptanceRecord(raw);
  assert.equal(parsed.version, CURRENT_LEGAL_VERSION);
  assert.equal(parsed.acceptedAt, AT);
});

test('parseAcceptanceRecord accepts an already-parsed object (jsonb column)', () => {
  const obj = buildAcceptanceRecord({ at: AT });
  assert.equal(parseAcceptanceRecord(obj).version, CURRENT_LEGAL_VERSION);
});

test('parseAcceptanceRecord returns null for junk instead of throwing', () => {
  for (const junk of ['', null, undefined, 'not json', '{oops', 42, []]) {
    assert.equal(parseAcceptanceRecord(junk), null, `junk: ${JSON.stringify(junk)}`);
  }
});

// ---- the gate itself: the assertions that carry legal weight ----

test('needsAcceptance is TRUE when no record exists', () => {
  assert.equal(needsAcceptance(null), true);
  assert.equal(needsAcceptance(undefined), true);
});

test('needsAcceptance is FALSE for a current-version record', () => {
  const r = buildAcceptanceRecord({ at: AT, source: 'signup' });
  assert.equal(needsAcceptance(r), false);
});

test('needsAcceptance is TRUE when the stored version is older — agents must re-accept updated terms', () => {
  const stale = { version: '1900-01-01', acceptedAt: AT, documents: ['terms'] };
  assert.equal(needsAcceptance(stale), true);
});

test('needsAcceptance is TRUE for a record with no version — an unversioned record proves nothing', () => {
  assert.equal(needsAcceptance({ acceptedAt: AT }), true);
  assert.equal(needsAcceptance({ version: '', acceptedAt: AT }), true);
  assert.equal(needsAcceptance({ version: '   ', acceptedAt: AT }), true);
});

test('needsAcceptance is TRUE for a record with no timestamp — undated assent is not provable', () => {
  assert.equal(needsAcceptance({ version: CURRENT_LEGAL_VERSION }), true);
  assert.equal(needsAcceptance({ version: CURRENT_LEGAL_VERSION, acceptedAt: 'nonsense' }), true);
});

test('needsAcceptance FAILS CLOSED on junk — a corrupt record re-prompts, never auto-passes', () => {
  for (const junk of ['garbage', '{broken', 42, [], true]) {
    assert.equal(needsAcceptance(junk), true, `junk: ${JSON.stringify(junk)}`);
  }
});

test('needsAcceptance accepts the raw stored string form (what storage returns)', () => {
  const raw = JSON.stringify(buildAcceptanceRecord({ at: AT }));
  assert.equal(needsAcceptance(raw), false);
});
