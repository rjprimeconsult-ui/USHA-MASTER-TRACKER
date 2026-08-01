/**
 * Sender-identity round-trip tests for postSaleEmails.js — the §3.1
 * silent-wipe guard (spec: docs/superpowers/specs/
 * 2026-07-29-per-agent-sender-identity-design.md).
 *
 * Why this lives in the ui lane: postSaleEmails.js imports './storage'
 * extensionlessly, so it cannot load under `node --test`. Storage is
 * mocked with an in-memory Map — no jsdom rendering, just module logic.
 *
 * The failure these tests exist to catch: load/save each carrying their
 * own field whitelist. If save learns the six new fields but load does
 * not (or vice versa), the Profile flow — load into state, edit one
 * field, save the whole state back — silently wipes an agent's stored
 * identity, and the send gate blocks them forever with no visible cause.
 * One shared projection (sanitizeSenderIdentity) is the fix; these tests
 * pin that both functions actually use it.
 */
import { test, expect, vi, beforeEach } from 'vitest';

const mem = vi.hoisted(() => new Map());

vi.mock('./storage', () => ({
  storage: {
    getItem: async (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: async (key, value) => {
      mem.set(key, value);
      return true;
    },
  },
}));

import {
  loadSenderIdentity,
  saveSenderIdentity,
  DEFAULT_SENDER_IDENTITY,
  SENDER_IDENTITY_KEY,
} from './postSaleEmails';
import { sanitizeSenderIdentity } from './senderGate.mjs';

beforeEach(() => {
  mem.clear();
});

// Whitespace-free fixture (the shared sanitizer trims; trimming is not
// what these tests are about).
const FULL = {
  fromName: 'Mike Tolentino',
  fromAddress: 'mike@healthservicespro.com',
  businessName: 'HealthServicesPro',
  mailingAddress: '1550 Sawgrass Corporate Expressway, Sunrise FL 33323',
  npn: '88113311',
  signatureName: 'Michael Tolentino',
  signatureTitle: 'Owner, HealthServicesPro',
  bannerUrl: 'https://x.com/b.jpg',
};

test('save -> load round-trips all eight identity fields', async () => {
  await saveSenderIdentity(FULL);
  const loaded = await loadSenderIdentity();
  expect(loaded).toEqual(FULL);
});

test('a legacy two-field stored value loads with the six new fields as empty strings', async () => {
  mem.set(
    SENDER_IDENTITY_KEY,
    JSON.stringify({ fromName: 'J', fromAddress: 'j@x.com' })
  );
  const loaded = await loadSenderIdentity();
  expect(loaded).toEqual({
    fromName: 'J',
    fromAddress: 'j@x.com',
    businessName: '',
    mailingAddress: '',
    npn: '',
    signatureName: '',
    signatureTitle: '',
    bannerUrl: '',
  });
});

test('the Profile flow — load, edit one field, save all — wipes nothing (silent-wipe guard)', async () => {
  await saveSenderIdentity(FULL);
  const loaded = await loadSenderIdentity();
  await saveSenderIdentity({ ...loaded, fromName: 'New' });
  const after = await loadSenderIdentity();
  expect(after).toEqual({ ...FULL, fromName: 'New' });
});

test('save writes exactly what it is given, sanitized — no hidden merge with stored state', async () => {
  await saveSenderIdentity(FULL);
  const returned = await saveSenderIdentity({ fromName: 'New' });
  expect(returned).toEqual(sanitizeSenderIdentity({ fromName: 'New' }));
  expect(JSON.parse(mem.get(SENDER_IDENTITY_KEY))).toEqual(
    sanitizeSenderIdentity({ fromName: 'New' })
  );
});

test('caps flow through save (npn beyond 20 chars is truncated by the shared sanitizer)', async () => {
  await saveSenderIdentity({ ...FULL, npn: '123456789012345678901234' });
  const loaded = await loadSenderIdentity();
  expect(loaded.npn).toBe('12345678901234567890');
});

test('DEFAULT_SENDER_IDENTITY and an empty load are the sanitizer empty projection (all eight fields)', async () => {
  expect(DEFAULT_SENDER_IDENTITY).toEqual(sanitizeSenderIdentity({}));
  const loaded = await loadSenderIdentity();
  expect(loaded).toEqual(sanitizeSenderIdentity({}));
});
