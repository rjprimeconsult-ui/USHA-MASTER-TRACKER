/**
 * Clickwrap acceptance — the record that makes the Terms enforceable.
 *
 * Why this module exists (2026-08-02 legal gap analysis, finding #1):
 * account creation used to be email + password with no notice of the Terms
 * and no link to them anywhere on the signup screen. Terms §11 (liability
 * cap) and §12 (indemnity for the agent's own TCPA/CAN-SPAM exposure) are
 * the two clauses that actually protect R&J Prime — and courts enforce them
 * only where the user had reasonable notice and affirmatively assented.
 * "Browsewrap" with no notice is the weakest form and is routinely struck.
 *
 * So: the signup form now requires an explicit tick, and this module is the
 * durable record of WHO agreed to WHAT VERSION and WHEN.
 *
 * Design rules, all of which are legal requirements wearing engineering
 * clothes:
 *   1. The record names the document VERSION. "They accepted" is worthless
 *      without "accepted what."
 *   2. A stale version does NOT satisfy a newer document — bump
 *      LEGAL.documentVersion when the Terms/Privacy/DPA change materially
 *      and every agent is re-prompted. Silently binding someone to terms
 *      they never saw is exactly the failure we're fixing.
 *   3. Anything unparseable FAILS CLOSED (re-prompt). A corrupt record must
 *      never read as consent.
 *
 * Pure by design — no storage, no React, no fetch — so the node lane can
 * exercise every branch.
 */

import { LEGAL } from './legalConfig.mjs';

/** Storage key (user_kv via storage.setItem, so it follows the account). */
export const ACCEPTANCE_KEY = 'legal_acceptance_v1';

/**
 * The version of the legal document set. Sourced from LEGAL.documentVersion
 * so there is ONE place to bump when the documents change.
 */
export const CURRENT_LEGAL_VERSION = String(LEGAL.documentVersion || '').trim();

/** The documents covered by a single acceptance. */
export const COVERED_DOCUMENTS = ['terms', 'privacy', 'dpa'];

/**
 * Build the record written on acceptance.
 * `source` distinguishes 'signup' (accepted before the account existed) from
 * 'app' (an existing agent accepting at the in-app gate) — useful evidence
 * about how assent was obtained.
 */
export function buildAcceptanceRecord({ at, source = 'app' } = {}) {
  return {
    version: CURRENT_LEGAL_VERSION,
    acceptedAt: at || new Date().toISOString(),
    documents: [...COVERED_DOCUMENTS],
    source,
  };
}

/**
 * Normalize whatever storage handed back — a JSON string (localStorage) or an
 * already-parsed object (Supabase jsonb). Returns null for anything unusable;
 * callers treat null as "no acceptance".
 */
export function parseAcceptanceRecord(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return Array.isArray(raw) ? null : raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * THE gate. True → show the acceptance UI and block until accepted.
 *
 * Fails closed on every ambiguous input: missing record, missing/blank
 * version, stale version, missing or unparseable timestamp, or junk.
 */
export function needsAcceptance(raw) {
  const rec = parseAcceptanceRecord(raw);
  if (!rec) return true;

  const version = String(rec.version || '').trim();
  if (!version) return true;                       // unversioned proves nothing
  if (version !== CURRENT_LEGAL_VERSION) return true; // stale → re-accept

  const at = rec.acceptedAt;
  if (!at || Number.isNaN(Date.parse(at))) return true; // undated assent

  return false;
}
