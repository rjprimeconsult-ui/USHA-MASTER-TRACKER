/**
 * Signed, URL-safe unsubscribe tokens for CAN-SPAM one-click opt-out links.
 *
 * A token embeds the SENDING agent's user id (the "owner" of the suppression
 * list) plus the recipient email, so the PUBLIC /api/email/unsubscribe endpoint
 * can add the right (owner, email) pair to the suppression list without any
 * auth — the HMAC signature is what proves the link was minted by us and hasn't
 * been forged or tampered with.
 *
 * Token shape:   base64url(JSON {u, e, t}) + "." + base64url(HMAC-SHA256(payload))
 *   u = owner (sending agent) user id
 *   e = recipient email, lowercased
 *   t = mint timestamp (ms) — carried for auditing / future use; NOT used to
 *       expire the link. CAN-SPAM opt-out mechanisms must keep working for at
 *       least 30 days after a message is sent, so we intentionally do not reject
 *       old tokens.
 *
 * Pure + node-testable: no `next` imports, only node:crypto. Run the tests with
 *   node --test src/lib/unsubscribeToken.test.mjs
 *
 * Secret: reuses an existing server secret so shipping needs NO new env var.
 * Prefer UNSUBSCRIBE_SECRET (lets us rotate the unsubscribe signing key on its
 * own), fall back to SUPABASE_SERVICE_ROLE_KEY (always set in prod), and only
 * fall back to a hard-coded 'dev-secret' for local/dev where neither is set.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

function secret() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret';
}

function sign(payloadB64) {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/**
 * Build a signed unsubscribe token for a given (ownerUserId, email) pair.
 * Returns a URL-safe string usable directly as a path segment.
 */
export function makeUnsubscribeToken(ownerUserId, email) {
  const payload = {
    u: String(ownerUserId || ''),
    e: String(email || '').trim().toLowerCase(),
    t: Date.now(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a token and return { ownerUserId, email } on success, or null when the
 * token is missing, malformed, or the signature doesn't match. Never throws.
 * Uses a timing-safe comparison on the HMAC.
 */
export function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  // Need a non-empty payload segment AND a non-empty signature segment.
  if (dot <= 0 || dot >= token.length - 1) return null;

  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadB64);

  // timingSafeEqual throws on unequal lengths, so guard first. A wrong-length
  // signature is trivially invalid.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const ownerUserId = String(payload?.u || '');
  const email = String(payload?.e || '').trim().toLowerCase();
  if (!ownerUserId || !email) return null;
  return { ownerUserId, email };
}
