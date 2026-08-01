/**
 * Outreach template copy — tokenized per-sender, rendered per call.
 * (spec §7: docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md)
 *
 * This module owns every identity-bearing string of the outreach
 * sequence. NOTHING here names an agent: identity arrives as the
 * gate-validated `sender` argument and resolves through tokens at render
 * time. The old module constants (banner/company/NPN/address/reply-to)
 * are deleted, not defaulted — a default is how one agent's NPN reaches
 * another agent's mail (§7.2).
 *
 * Pure on purpose: imports only the unsubscribe sentinel (legalConfig)
 * and missingFields (senderGate), both node-safe — so the node test lane
 * (outreachTemplateCopy.test.mjs) exercises every template × sender
 * combination without a browser.
 *
 * Split (§7.1): TEMPLATE_META carries id/name/description/previewText/
 * pillLabel/ctaLabel/ctaSubject; the copy (subject/bodyHtmlInner/
 * bodyText) lives in buildTemplateCopy. outreachEmails.js re-exports
 * TEMPLATE_META as OUTREACH_TEMPLATES so existing importers don't move.
 */

import { OUTREACH_UNSUBSCRIBE_PLACEHOLDER } from './legalConfig.mjs';
import { missingFields } from './senderGate.mjs';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Extract a clean first name from the prospect's `name` field.
 * Title-cases the result so a lowercase entry like "joe mitchell"
 * becomes "Joe". Returns an empty string when no usable name exists
 * — callers handle the missing-name case via the token replacer.
 */
function firstNameOf(prospect) {
  const raw = String(prospect?.name || '').trim();
  if (!raw) return '';
  // Take everything before the first space, strip punctuation.
  const first = raw.split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');
  if (!first) return '';
  // Title-case (Joe, McConnell, O'Brien — first letter up, rest lower)
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// Derived sender values shared by the token replacer and renderShell.
// signatureName defaults to fromName (spec §3); the title LINE tokens
// carry their own trailing <br/> / newline so a blank title omits the
// whole line instead of leaving an empty <span> or a blank text line.
function senderValues(sender) {
  const s = sender || {};
  const trim = (v) => String(v || '').trim();
  const signatureTitle = trim(s.signatureTitle);
  return {
    businessName: trim(s.businessName),
    fromAddress: trim(s.fromAddress),
    npn: trim(s.npn),
    mailingAddress: trim(s.mailingAddress),
    signatureName: trim(s.signatureName) || trim(s.fromName),
    signatureTitle,
    bannerUrl: trim(s.bannerUrl),
  };
}

/**
 * Replace personalization tokens in a string. Used on the subject, the
 * HTML body and the plain-text fallback so all three stay in sync.
 *
 * Prospect tokens (unchanged from the pre-split module):
 *   {first_name}          → "Sarah" or "" when no name
 *   {first_name_greeting} → " Sarah" or "" — leading space included
 *                           so "Hello{first_name_greeting}," renders
 *                           as "Hello Sarah," or "Hello,"
 *   {first_name_or_there} → "Sarah" or "there" — for sentence use
 *
 * Sender tokens (resolved only when `sender` is provided — replacement
 * values go through functions so a "$&" in an agent's field can't
 * corrupt the output):
 *   {business_name} {signature_name} {npn} {mailing_address}
 *   {from_address}
 *   {signature_title_line_html} / {signature_title_line_text}
 *     → the WHOLE line incl. trailing <br/> / "\n"; empty when the
 *       title is blank (spec §3: no "Owner," prefix survives).
 */
function applyProspectTokens(str, prospect) {
  const first = firstNameOf(prospect);
  return String(str || '')
    .replace(/\{first_name\}/g, () => first)
    .replace(/\{first_name_greeting\}/g, () => (first ? ` ${first}` : ''))
    .replace(/\{first_name_or_there\}/g, () => first || 'there');
}

function applySenderTokens(str, sender) {
  if (!sender) return String(str || '');
  const v = senderValues(sender);
  const titleLineHtml = v.signatureTitle
    ? `<span style="color:#64748B; font-size:13px;">${escapeHtml(v.signatureTitle)}</span><br/>`
    : '';
  const titleLineText = v.signatureTitle ? `${v.signatureTitle}\n` : '';
  return String(str || '')
    .replace(/\{business_name\}/g, () => v.businessName)
    .replace(/\{signature_name\}/g, () => v.signatureName)
    .replace(/\{signature_title_line_html\}/g, () => titleLineHtml)
    .replace(/\{signature_title_line_text\}/g, () => titleLineText)
    .replace(/\{npn\}/g, () => v.npn)
    .replace(/\{mailing_address\}/g, () => v.mailingAddress)
    .replace(/\{from_address\}/g, () => v.fromAddress);
}

function applyTokens(str, prospect, sender) {
  return applyProspectTokens(applySenderTokens(str, sender), prospect);
}

// ---------- Shared HTML shell ----------

/**
 * Renders the full HTML email around the provided inner body markup.
 * Keeps every template visually consistent — banner, signature, footer —
 * all derived from `sender`, never from constants:
 *   - banner block included ONLY when sender.bannerUrl starts with
 *     "https://" (attribute-escaped; §13: the one free-form field that
 *     reaches markup) — blank or non-https means NO <img> at all;
 *   - signature = signatureName (default fromName) + optional title line
 *     + fromAddress mailto link;
 *   - CTA button mailto = fromAddress;
 *   - footer = businessName / "Licensed Independent Insurance Agency ·
 *     NPN: {npn}" / mailingAddress / consent line / unsubscribe.
 */
export function renderShell({ sender, subject, previewText, pillLabel, bodyInner, ctaLabel, ctaSubject, unsubscribeUrl }) {
  const v = senderValues(sender);
  const ctaSubjectEnc = encodeURIComponent(ctaSubject || `Re: ${subject}`);
  // Functional one-click unsubscribe. The email is rendered here (client-side),
  // but the signed opt-out token can only be minted server-side, so we emit a
  // sentinel that /api/email/send replaces with the real per-recipient link
  // before sending. Callers may pass an explicit `unsubscribeUrl` (e.g. a
  // server-side render) to skip the sentinel. Either way this is a real
  // unsubscribe link, honored by the suppression list — not just a mailto.
  const unsubHref = unsubscribeUrl || OUTREACH_UNSUBSCRIBE_PLACEHOLDER;
  const bannerHtml = v.bannerUrl.startsWith('https://') ? `
        <tr>
          <td style="background:#0A1733; line-height:0; font-size:0;">
            <img src="${escapeHtml(v.bannerUrl)}" alt="${escapeHtml(v.businessName)}" width="600" style="display:block; width:100%; max-width:600px; height:auto; border:0; outline:none; text-decoration:none;" />
          </td>
        </tr>` : '';
  const pillHtml = pillLabel ? `
          <tr>
            <td style="padding:24px 36px 0 36px;">
              <span style="display:inline-block; background:#EFF6FF; color:#1E40AF; font-size:11px; font-weight:bold; letter-spacing:0.8px; text-transform:uppercase; padding:5px 12px; border-radius:999px; border:1px solid #BFDBFE;">${pillLabel}</span>
            </td>
          </tr>` : '';
  const bodyPaddingTop = pillLabel ? '14px' : '32px';
  const titleLineHtml = v.signatureTitle
    ? `<span style="color:#64748B; font-size:13px;">${escapeHtml(v.signatureTitle)}</span><br/>
                `
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]>
  <style type="text/css">table, td { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#EEF2F7; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(previewText || '')}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#EEF2F7;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; width:100%; background:#FFFFFF; border-radius:14px; overflow:hidden; box-shadow:0 6px 18px rgba(10,23,51,0.08);">${bannerHtml}${pillHtml}
        <tr>
          <td style="padding:${bodyPaddingTop} 36px 8px 36px; color:#1E293B; font-size:15px; line-height:1.65;">
            ${bodyInner}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 36px 28px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="background:#2563EB; border-radius:8px;">
                <a href="mailto:${escapeHtml(v.fromAddress)}?subject=${ctaSubjectEnc}" style="display:inline-block; padding:13px 30px; color:#FFFFFF; font-size:14px; font-weight:bold; text-decoration:none; font-family:Arial, Helvetica, sans-serif; letter-spacing:0.3px;">${escapeHtml(ctaLabel)} &rarr;</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 24px 36px; color:#1E293B; font-size:14px; line-height:1.6;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
              <td style="padding:18px 0 0 0; border-top:1px solid #E2E8F0;">
                <strong style="color:#0A1733; font-size:15px;">${escapeHtml(v.signatureName)}</strong><br/>
                ${titleLineHtml}<a href="mailto:${escapeHtml(v.fromAddress)}" style="color:#2563EB; text-decoration:none; font-size:13px;">${escapeHtml(v.fromAddress)}</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#F8FAFC; padding:20px 36px 24px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;">
            <strong style="color:#0A1733; font-size:12px;">${escapeHtml(v.businessName)}</strong><br/>
            Licensed Independent Insurance Agency &middot; NPN: ${escapeHtml(v.npn)}<br/>
            ${escapeHtml(v.mailingAddress)}<br/><br/>
            You received this email because you submitted a request for health insurance quotes online.<br/>
            <a href="${unsubHref}" style="color:#64748B; text-decoration:underline;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------- Template bodies (inner HTML for each email) ----------
// Identity appears ONLY as tokens; prospect personalization unchanged.

const EMAIL_1_BODY = `
              <p style="margin:0 0 16px 0;">Hello{first_name_greeting},</p>
              <p style="margin:0 0 16px 0;">My name is <strong style="color:#0A1733;">{signature_name}</strong>, and I am the owner of <strong style="color:#0A1733;">{business_name}</strong>. I received your inquiry that you placed online for health insurance plans and prices.</p>
              <p style="margin:0 0 16px 0;"><strong>Are you still looking for a health plan?</strong></p>
              <p style="margin:0 0 20px 0;">If you would like to review quotes from major carriers that are aggressively priced, simply reply with the information below about each person you are looking to insure, and I will have quotes ready for you <strong style="color:#0A1733;">within the next two hours</strong>.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC; border:1px solid #DBE3F0; border-left:4px solid #2563EB; border-radius:8px; margin:0 0 20px 0;">
                <tr><td style="padding:18px 22px; color:#1E293B; font-size:14px; line-height:1.7;">
                  <strong style="color:#0A1733; display:block; margin-bottom:8px; font-size:13px; letter-spacing:0.5px; text-transform:uppercase;">What I need from you</strong>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                    <tr><td width="28" valign="top" style="color:#2563EB; font-weight:bold;">1.</td><td valign="top" style="color:#1E293B;">Age(s)</td></tr>
                    <tr><td width="28" valign="top" style="color:#2563EB; font-weight:bold; padding-top:4px;">2.</td><td valign="top" style="color:#1E293B; padding-top:4px;">Gender(s)</td></tr>
                    <tr><td width="28" valign="top" style="color:#2563EB; font-weight:bold; padding-top:4px;">3.</td><td valign="top" style="color:#1E293B; padding-top:4px;">Zip code</td></tr>
                  </table>
                </td></tr>
              </table>
              <p style="margin:0 0 4px 0;">Thank you for your time and I look forward to hearing from you.</p>`;

const EMAIL_2_BODY = `
              <p style="margin:0 0 16px 0;">Hi{first_name_greeting},</p>
              <p style="margin:0 0 16px 0;">Just following up to make sure you saw my previous email. I&rsquo;ve reviewed some potential health coverage options that could be a strong fit based on what you shared.</p>
              <p style="margin:0 0 16px 0;">Before I finalize everything, I just need to confirm a few additional details to ensure I&rsquo;m putting together the best possible solutions for you and your business.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC; border:1px solid #DBE3F0; border-left:4px solid #2563EB; border-radius:8px; margin:0 0 20px 0;">
                <tr><td style="padding:18px 22px; color:#0A1733; font-size:15px; line-height:1.6;">
                  Let&rsquo;s schedule a quick <strong>10&ndash;15 minute conversation</strong> so I can tailor these options to your specific needs.
                </td></tr>
              </table>
              <p style="margin:0 0 8px 0;"><strong style="color:#0A1733;">What does your availability look like later this week or early next week?</strong></p>`;

const EMAIL_3_BODY = `
              <p style="margin:0 0 16px 0;">Hi{first_name_greeting},</p>
              <p style="margin:0 0 16px 0;">Just following up on my previous message. I&rsquo;m ready to start putting together your health coverage options, but I&rsquo;ll need a couple of details before I can finalize accurate pricing.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC; border:1px solid #DBE3F0; border-left:4px solid #2563EB; border-radius:8px; margin:0 0 20px 0;">
                <tr><td style="padding:18px 22px; color:#1E293B; font-size:14px; line-height:1.7;">
                  <strong style="color:#0A1733; display:block; margin-bottom:8px; font-size:13px; letter-spacing:0.5px; text-transform:uppercase;">For each person to be quoted</strong>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                    <tr><td width="28" valign="top" style="color:#2563EB; font-weight:bold;">1.</td><td valign="top" style="color:#1E293B;">Date of birth</td></tr>
                    <tr><td width="28" valign="top" style="color:#2563EB; font-weight:bold; padding-top:4px;">2.</td><td valign="top" style="color:#1E293B; padding-top:4px;">Gender</td></tr>
                  </table>
                </td></tr>
              </table>
              <p style="margin:0 0 16px 0;">Once you send that over, I can review the best available options and help structure something that makes sense for you and your business.</p>
              <p style="margin:0 0 8px 0;">Feel free to reply here whenever you have that information ready, and we can get everything moving.</p>
              <p style="margin:0 0 4px 0;">Looking forward to helping.</p>`;

// ---------- Plain-text fallbacks ----------
// Resend recommends both — text helps deliverability + handles clients
// that strip HTML. Keeps the same voice as the HTML body. The closing
// signature/footer block is shared and fully tokenized — the §7.3 table's
// three closings AND the EMAIL_1_TEXT body opener (the ":211" line the
// spec calls out as the one a careful implementer would miss).

const TEXT_CLOSING = `—
{signature_name}
{signature_title_line_text}{from_address}

{business_name} · Licensed Independent Insurance Agency · NPN: {npn}
{mailing_address}`;

const EMAIL_1_TEXT = `Hello{first_name_greeting},

My name is {signature_name}, and I am the owner of {business_name}. I received your inquiry that you placed online for health insurance plans and prices.

Are you still looking for a health plan?

If you would like to review quotes from major carriers that are aggressively priced, simply reply with the information below about each person you are looking to insure, and I will have quotes ready for you within the next two hours.

WHAT I NEED FROM YOU
1. Age(s)
2. Gender(s)
3. Zip code

Thank you for your time and I look forward to hearing from you.

${TEXT_CLOSING}`;

const EMAIL_2_TEXT = `Hi{first_name_greeting},

Just following up to make sure you saw my previous email. I've reviewed some potential health coverage options that could be a strong fit based on what you shared.

Before I finalize everything, I just need to confirm a few additional details to ensure I'm putting together the best possible solutions for you and your business.

Let's schedule a quick 10–15 minute conversation so I can tailor these options to your specific needs.

What does your availability look like later this week or early next week?

${TEXT_CLOSING}`;

const EMAIL_3_TEXT = `Hi{first_name_greeting},

Just following up on my previous message. I'm ready to start putting together your health coverage options, but I'll need a couple of details before I can finalize accurate pricing.

FOR EACH PERSON TO BE QUOTED
1. Date of birth
2. Gender

Once you send that over, I can review the best available options and help structure something that makes sense for you and your business.

Feel free to reply here whenever you have that information ready, and we can get everything moving.

Looking forward to helping.

${TEXT_CLOSING}`;

// ---------- Metadata (spec §7.1: NO copy keys here) ----------

export const TEMPLATE_META = [
  {
    id: 'phc-outreach-1-initial',
    name: 'Email 1 — Initial outreach',
    description: 'First contact after Benepath inquiry. Asks for age, gender, zip.',
    previewText: 'Reviewing health insurance quotes for you from major carriers. Quick reply with three details and I will send pricing in two hours.',
    pillLabel: null,
    ctaLabel: 'Reply with my info',
    ctaSubject: 'Re: Health insurance quotes',
  },
  {
    id: 'phc-outreach-2-followup',
    name: 'Email 2 — Quick follow-up',
    description: 'Follow-up nudge. Asks to schedule a 10–15 min call.',
    previewText: 'Just following up on your health insurance request. Let us schedule a quick 10-15 minute call to tailor the best options for you.',
    pillLabel: 'Quick follow-up',
    ctaLabel: 'Reply with my availability',
    ctaSubject: 'Re: Scheduling a quick call',
  },
  {
    id: 'phc-outreach-3-final',
    name: 'Email 3 — Ready to finalize',
    description: 'Final ask for DOB + gender to finalize accurate pricing.',
    previewText: 'Ready to put together your health coverage options — I just need dates of birth and gender to finalize accurate pricing.',
    pillLabel: 'Ready to finalize',
    ctaLabel: 'Reply with my info',
    ctaSubject: 'Re: DOB and gender info for quotes',
  },
];

// Copy keyed by template id — module-private; consumers go through
// buildTemplateCopy / renderOutreachTemplateCore.
const TEMPLATE_COPY = {
  'phc-outreach-1-initial': {
    subject: 'Health insurance quotes for you — {business_name}',
    bodyHtmlInner: EMAIL_1_BODY,
    bodyText: EMAIL_1_TEXT,
  },
  'phc-outreach-2-followup': {
    subject: 'Following up on your health coverage options',
    bodyHtmlInner: EMAIL_2_BODY,
    bodyText: EMAIL_2_TEXT,
  },
  'phc-outreach-3-final': {
    subject: 'One more thing to finalize your quote',
    bodyHtmlInner: EMAIL_3_BODY,
    bodyText: EMAIL_3_TEXT,
  },
};

/**
 * Resolve a template's copy for a specific sender (spec §7.1).
 * Sender tokens are resolved here; prospect tokens stay in place until
 * render time, where applyTokens(str, prospect, sender) finishes the job.
 * Unknown id → null.
 */
export function buildTemplateCopy(templateId, sender) {
  const copy = TEMPLATE_COPY[templateId];
  if (!copy) return null;
  return {
    subject: applySenderTokens(copy.subject, sender),
    bodyHtmlInner: applySenderTokens(copy.bodyHtmlInner, sender),
    bodyText: applySenderTokens(copy.bodyText, sender),
  };
}

/**
 * Render a template into the final shape the /api/email/send route
 * accepts. Adds the prospect's email as recipient.
 *
 * Returns null unless `missingFields(sender, 'outreach')` is empty — the
 * SAME predicate the send gate and the status route use (§7.2), so an
 * incomplete identity is a render-time impossibility, not a silent blank.
 *
 * `opts.unsubscribeUrl` is optional: when omitted (the normal client
 * path) the footer emits the unsubscribe sentinel that the send route
 * swaps for a signed per-recipient link.
 */
export function renderOutreachTemplateCore(template, prospect, sender, opts = {}) {
  if (!template) return null;
  if (missingFields(sender || {}, 'outreach').length > 0) return null;
  const copy = buildTemplateCopy(template.id, sender);
  if (!copy) return null;
  const subject = applyTokens(copy.subject, prospect, sender);
  const bodyInner = applyTokens(copy.bodyHtmlInner, prospect, sender);
  const text = applyTokens(copy.bodyText, prospect, sender);
  const html = renderShell({
    sender,
    subject,
    previewText: template.previewText,
    pillLabel: template.pillLabel,
    bodyInner,
    ctaLabel: template.ctaLabel,
    ctaSubject: template.ctaSubject,
    unsubscribeUrl: opts.unsubscribeUrl,
  });
  return {
    templateId: template.id,
    templateName: template.name,
    subject,
    html,
    text,
    recipient: (prospect?.email || '').trim(),
  };
}
