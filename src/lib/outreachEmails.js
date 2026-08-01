/**
 * Outreach email registry + storage helpers.
 *
 * Template METADATA (ids, names, descriptions, preview text, CTA labels)
 * lives here as OUTREACH_TEMPLATES so existing importers
 * (SendOutreachEmail.jsx, outreachReminders.js) keep their import paths.
 * The COPY — subject, HTML body, plain-text alternative — lives in
 * ./outreachTemplateCopy.mjs, fully tokenized per sender: NO agent
 * identity is hardcoded anywhere any more (spec §0/§7 of
 * docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md).
 *
 * renderOutreachTemplate REQUIRES opts.sender — the sending agent's
 * identity from `email_sender_identity_v1` (Profile → Sender). When the
 * sender is missing or incomplete (missingFields(sender, 'outreach')
 * non-empty, the same predicate the send gate uses) it returns null: an
 * email with a blank signature or someone else's NPN is a render-time
 * impossibility, not a silent fallback.
 *
 * Templates are sent via the existing /api/email/send endpoint, which
 * accepts an optional `html` field (full HTML body) and `prospectId`
 * (instead of leadId) for the prospects table.
 */

import { storage } from './storage';
import {
  TEMPLATE_META,
  renderOutreachTemplateCore,
} from './outreachTemplateCopy.mjs';

// ---------- Templates registry (metadata only — no copy, no identity) ----------

export const OUTREACH_TEMPLATES = TEMPLATE_META;

export function getOutreachTemplate(id) {
  return OUTREACH_TEMPLATES.find(t => t.id === id) || null;
}

/**
 * Render a template into the final shape the /api/email/send route
 * accepts. Adds the prospect's email as recipient. Thin wrapper over
 * renderOutreachTemplateCore (which the node test lane exercises
 * directly) — every template part is personalized per prospect AND per
 * sender; nothing in the shell or copy is static identity any more.
 *
 * `opts.sender` is REQUIRED for a non-null result (see module header).
 * `opts.unsubscribeUrl` is optional: when omitted (the normal client path)
 * the footer emits the unsubscribe sentinel that the send route swaps for a
 * signed per-recipient link. A server-side caller that already has the link
 * can pass it here to render it directly.
 */
export function renderOutreachTemplate(template, prospect, opts = {}) {
  return renderOutreachTemplateCore(template, prospect, opts.sender, opts);
}

// ---------- Per-prospect email log (parallel to lead.emailLog) ----------

// Append an entry to the prospect's emailLog field and return the
// updated prospect. Used by the SendOutreachEmail flow after a
// successful send so the audit trail is preserved alongside the
// prospect record.
export function appendProspectEmailEntry(prospect, entry) {
  const log = Array.isArray(prospect?.emailLog) ? prospect.emailLog : [];
  return {
    ...prospect,
    emailLog: [...log, entry],
  };
}

// ---------- Storage helpers (test addresses, reused config) ----------

// Outreach reuses the same sender-identity key as post-sale emails, so
// agents configure their From once in Profile → Email sender and it
// applies to both surfaces. Test addresses are reused too (set in
// Settings → Post-Sale Emails); when present, an optional "send test"
// path can route there. For MVP we ship without the test-route UI —
// agent sends to the actual prospect.

const TEST_ADDRESSES_KEY = 'outreach_test_addresses_v1';

export async function loadOutreachTestAddresses() {
  try {
    const raw = await storage.getItem(TEST_ADDRESSES_KEY);
    if (!raw) return '';
    return typeof raw === 'string' ? raw : String(raw || '');
  } catch {
    return '';
  }
}

export async function saveOutreachTestAddresses(value) {
  await storage.setItem(TEST_ADDRESSES_KEY, String(value || ''));
}
