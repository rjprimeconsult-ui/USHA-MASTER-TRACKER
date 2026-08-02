/**
 * Sender-identity gate — pure logic shared by /api/email/send, the
 * sender-status route, and the browser load/save path. No fetch, no env,
 * no imports beyond legalConfig's placeholder constant: everything arrives
 * as arguments so the node test lane exercises every branch.
 *
 * Spec: docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md §3.1, §5, §6.
 */

import { mailingAddressOrPlaceholder } from './legalConfig.mjs';

export const IDENTITY_FIELD_CAPS = {
  fromName: 200,
  fromAddress: 254,
  businessName: 200,
  mailingAddress: 300,
  npn: 20,
  signatureName: 200,
  signatureTitle: 120,
  bannerUrl: 500,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(addr) {
  return EMAIL_RE.test(String(addr || '').trim());
}

// THE whitelist (spec §3.1). Three call sites — postSaleEmails load, save,
// and the route's user_kv reader — one projection. A field added here is
// added everywhere; a field missing here silently vanishes on save AND
// makes the gate refuse every send, which is why there is only one.
export function sanitizeSenderIdentity(raw) {
  const out = {};
  for (const [field, cap] of Object.entries(IDENTITY_FIELD_CAPS)) {
    out[field] = String(raw?.[field] ?? '').slice(0, cap).trim();
  }
  return out;
}

// Per-kind required fields in report order. npn is outreach-only. Domain
// status is deliberately absent — it routes (selectLane), it never blocks.
export function missingFields(identity, kind) {
  const id = identity || {};
  const blank = (v) => !String(v || '').trim();
  const missing = [];
  if (blank(id.fromName)) missing.push('from_name');
  if (!isValidEmail(id.fromAddress)) missing.push('from_address');
  if (blank(id.businessName)) missing.push('business_name');
  // The legal-pages placeholder can never satisfy the requirement — the
  // literal string shipping in a commercial email is ticket #3.
  if (blank(id.mailingAddress) || id.mailingAddress === mailingAddressOrPlaceholder()) {
    missing.push('mailing_address');
  }
  if (kind === 'outreach' && blank(id.npn)) missing.push('npn');
  return missing;
}

const FIELD_ERRORS = {
  from_name: 'Add your name in Profile → Sender before sending.',
  from_address: 'Add a valid contact email in Profile → Sender before sending.',
  business_name: 'Add your business name in Profile → Sender before sending.',
  mailing_address: 'Add your business mailing address in Profile → Sender before sending.',
  npn: 'Add your NPN in Profile → Sender before sending outreach.',
};

/**
 * The gate. `readerResult` is the route reader's discriminated result:
 *   { ok: true,  identity }                    — row read + sanitized
 *   { ok: false, reason: 'threw' }             — transient (Supabase error)
 *   { ok: false, reason: 'absent' }            — no row stored
 *   { ok: false, reason: 'invalid', identity } — row read, fromAddress bad;
 *                                                the row RIDES ALONG so the
 *                                                refusal names the address,
 *                                                not fields already filled
 * Only 'threw' is transient. Everything else evaluates whatever identity is
 * available and reports the FIRST missing field (spec §6 reader trap).
 */
export function evaluate({ kind, readerResult }) {
  if (kind === 'welcome') return { ok: true, identity: null };
  if (readerResult && readerResult.ok === false && readerResult.reason === 'threw') {
    return {
      ok: false, status: 503, setupRequired: 'identity_unavailable',
      error: 'Could not load your sender settings — please try again shortly.',
    };
  }
  const identity = (readerResult && readerResult.identity) || {};
  const missing = missingFields(identity, kind);
  if (missing.length) {
    const setupRequired = missing[0];
    return { ok: false, status: 428, setupRequired, error: FIELD_ERRORS[setupRequired] };
  }
  return { ok: true, identity };
}

// Domain status routes mail, never blocks it (§5): 'own' ONLY on 'verified'.
// 'unknown' (lookup failed) rides shared — an outage reroutes mail, it can
// never send From an unverified domain and never stops a send.
// (Deliberate deviation from the spec's illustrative sketch
// `selectLane(fromAddress, domainStatus)` — the address contributed nothing;
// domainStatusFor already consumed it.)
export function selectLane(domainStatus) {
  return domainStatus === 'verified' ? 'own' : 'shared';
}

/**
 * From/Reply-To for both lanes; replaces route.js's inline if/else.
 * fallbackName/fallbackReplyTo serve ONLY the identityless welcome path
 * (request fromName + profile.email — today's behavior, kept exactly).
 */
export function buildFromHeaders({ identity, lane, globalFrom, fallbackName = '', fallbackReplyTo = '' }) {
  const g = String(globalFrom || '');
  const sharedMailbox = (g.match(/<([^>]+)>/) || [])[1] || g;
  // Display names are agent-controlled and land in a mail HEADER — strip
  // CR/LF (header injection) and angle brackets/quotes (a name of
  // "X <spoof@bank.com>" must not read as a second address). Resend's
  // domain enforcement backstops delivery, but the header must be clean
  // regardless. (Task-12 review hardening.)
  const headerSafe = (s) => String(s || '').replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = headerSafe(identity?.fromName) || headerSafe(fallbackName) || 'PRIM';
  const contact = String(identity?.fromAddress || '').trim();
  if (lane === 'own' && contact) {
    return { fromHeader: `${name} <${contact}>`, replyTo: contact };
  }
  return {
    fromHeader: `${name} <${sharedMailbox}>`,
    replyTo: contact || String(fallbackReplyTo || '').trim(),
  };
}

// Stale-bundle guard (§6): strings that exist only in the pre-tokenization
// bundle. A hit is EXEMPT when the literal is a substring of one of the
// sending agent's own gate-validated identity values — Julio Fernandez is a
// real agent whose correct identity legitimately renders five of the six;
// without the exemption every send he makes is refused forever.
export const RETIRED_LITERALS = [
  'Julio Fernandez',
  'Prime Health Consultants',
  '19153319',
  '1550 Sawgrass',
  'rjprimehealth.com',
  'phc-banner',
];

export function staleLiteralViolation({ subject, body, html }, identity) {
  const hay = [subject, body, html].map((s) => String(s || '')).join('\n');
  const ownValues = Object.values(identity || {}).map((v) => String(v || '')).filter(Boolean);
  for (const lit of RETIRED_LITERALS) {
    if (!hay.includes(lit)) continue;
    if (ownValues.some((v) => v.includes(lit))) continue;
    return lit;
  }
  return null;
}
