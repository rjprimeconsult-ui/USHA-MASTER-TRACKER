/**
 * Outreach email templates — cold-outreach for Prime Health Consultants
 * (and other agents in the post_sale_emails beta) to send to Benepath
 * prospects who haven't yet converted to leads.
 *
 * These are intentionally hardcoded (not editable in the UI) so the
 * banner image + brand colors + layout stay consistent. If an agent
 * needs to customize, that's a Phase-2 conversation — for now, we
 * ship a known-good sequence.
 *
 * Templates are sent via the existing /api/email/send endpoint, which
 * was extended to accept an optional `html` field (full HTML body)
 * and `prospectId` (instead of leadId) for the prospects table.
 *
 * Sender: per-agent BYOD via `email_sender_identity_v1` (set in
 * Profile → Email sender). For Julio, that's
 *   julio.fernandez@rjprimehealth.com
 * on the verified rjprimehealth.com domain.
 */

import { storage } from './storage';

// ---------- Shared HTML shell ----------

const BANNER_URL = 'https://www.primtracker.com/email-assets/phc-banner.jpg';
const BANNER_ALT = 'Prime Health Consultants — Licensed Independent Insurance Agency';
const REPLY_TO   = 'julio.fernandez@rjprimehealth.com';
const COMPANY    = 'Prime Health Consultants';
const ADDRESS    = '1550 Sawgrass Corporate Pkwy, Sunrise, FL 33323';
const NPN        = '19153319';

// Renders the full HTML email around the provided inner body markup.
// Keeps every template visually consistent — banner, signature, footer.
// `bodyInner` is the HTML for the middle section only (paragraphs +
// info cards). `ctaLabel` + `ctaSubject` build the primary action
// button. `pillLabel` shows a small "QUICK FOLLOW-UP" / "READY TO
// FINALIZE" badge above the body when set.
function renderShell({ subject, previewText, pillLabel, bodyInner, ctaLabel, ctaSubject }) {
  const ctaSubjectEnc = encodeURIComponent(ctaSubject || `Re: ${subject}`);
  const pillHtml = pillLabel ? `
          <tr>
            <td style="padding:24px 36px 0 36px;">
              <span style="display:inline-block; background:#EFF6FF; color:#1E40AF; font-size:11px; font-weight:bold; letter-spacing:0.8px; text-transform:uppercase; padding:5px 12px; border-radius:999px; border:1px solid #BFDBFE;">${pillLabel}</span>
            </td>
          </tr>` : '';
  const bodyPaddingTop = pillLabel ? '14px' : '32px';

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
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; width:100%; background:#FFFFFF; border-radius:14px; overflow:hidden; box-shadow:0 6px 18px rgba(10,23,51,0.08);">
        <tr>
          <td style="background:#0A1733; line-height:0; font-size:0;">
            <img src="${BANNER_URL}" alt="${BANNER_ALT}" width="600" style="display:block; width:100%; max-width:600px; height:auto; border:0; outline:none; text-decoration:none;" />
          </td>
        </tr>${pillHtml}
        <tr>
          <td style="padding:${bodyPaddingTop} 36px 8px 36px; color:#1E293B; font-size:15px; line-height:1.65;">
            ${bodyInner}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 36px 28px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="background:#2563EB; border-radius:8px;">
                <a href="mailto:${REPLY_TO}?subject=${ctaSubjectEnc}" style="display:inline-block; padding:13px 30px; color:#FFFFFF; font-size:14px; font-weight:bold; text-decoration:none; font-family:Arial, Helvetica, sans-serif; letter-spacing:0.3px;">${escapeHtml(ctaLabel)} &rarr;</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 24px 36px; color:#1E293B; font-size:14px; line-height:1.6;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
              <td style="padding:18px 0 0 0; border-top:1px solid #E2E8F0;">
                <strong style="color:#0A1733; font-size:15px;">Julio Fernandez</strong><br/>
                <span style="color:#64748B; font-size:13px;">Owner, ${COMPANY}</span><br/>
                <a href="mailto:${REPLY_TO}" style="color:#2563EB; text-decoration:none; font-size:13px;">${REPLY_TO}</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#F8FAFC; padding:20px 36px 24px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;">
            <strong style="color:#0A1733; font-size:12px;">${COMPANY}</strong><br/>
            Licensed Independent Insurance Agency &middot; NPN: ${NPN}<br/>
            ${ADDRESS}<br/><br/>
            You received this email because you submitted a request for health insurance quotes online.<br/>
            <a href="{unsubscribe_url}" style="color:#64748B; text-decoration:underline;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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

/**
 * Replace personalization tokens in a string. Used on both the HTML
 * body and the plain-text fallback so they stay in sync.
 *   {first_name}          → "Sarah" or "" when no name
 *   {first_name_greeting} → " Sarah" or "" — leading space included
 *                           so "Hello{first_name_greeting}," renders
 *                           as "Hello Sarah," or "Hello,"
 *   {first_name_or_there} → "Sarah" or "there" — for sentence use
 */
function applyTokens(str, prospect) {
  const first = firstNameOf(prospect);
  return String(str || '')
    .replace(/\{first_name\}/g, first)
    .replace(/\{first_name_greeting\}/g, first ? ` ${first}` : '')
    .replace(/\{first_name_or_there\}/g, first || 'there');
}

// ---------- Template bodies (inner HTML for each email) ----------

const EMAIL_1_BODY = `
              <p style="margin:0 0 16px 0;">Hello{first_name_greeting},</p>
              <p style="margin:0 0 16px 0;">My name is <strong style="color:#0A1733;">Julio Fernandez</strong>, and I am the owner of <strong style="color:#0A1733;">${COMPANY}</strong>. I received your inquiry that you placed online for health insurance plans and prices.</p>
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
// that strip HTML. Keeps the same voice as the HTML body.

const EMAIL_1_TEXT = `Hello{first_name_greeting},

My name is Julio Fernandez, and I am the owner of Prime Health Consultants. I received your inquiry that you placed online for health insurance plans and prices.

Are you still looking for a health plan?

If you would like to review quotes from major carriers that are aggressively priced, simply reply with the information below about each person you are looking to insure, and I will have quotes ready for you within the next two hours.

WHAT I NEED FROM YOU
1. Age(s)
2. Gender(s)
3. Zip code

Thank you for your time and I look forward to hearing from you.

—
Julio Fernandez
Owner, Prime Health Consultants
${REPLY_TO}

${COMPANY} · Licensed Independent Insurance Agency · NPN: ${NPN}
${ADDRESS}`;

const EMAIL_2_TEXT = `Hi{first_name_greeting},

Just following up to make sure you saw my previous email. I've reviewed some potential health coverage options that could be a strong fit based on what you shared.

Before I finalize everything, I just need to confirm a few additional details to ensure I'm putting together the best possible solutions for you and your business.

Let's schedule a quick 10–15 minute conversation so I can tailor these options to your specific needs.

What does your availability look like later this week or early next week?

—
Julio Fernandez
Owner, Prime Health Consultants
${REPLY_TO}

${COMPANY} · Licensed Independent Insurance Agency · NPN: ${NPN}
${ADDRESS}`;

const EMAIL_3_TEXT = `Hi{first_name_greeting},

Just following up on my previous message. I'm ready to start putting together your health coverage options, but I'll need a couple of details before I can finalize accurate pricing.

FOR EACH PERSON TO BE QUOTED
1. Date of birth
2. Gender

Once you send that over, I can review the best available options and help structure something that makes sense for you and your business.

Feel free to reply here whenever you have that information ready, and we can get everything moving.

Looking forward to helping.

—
Julio Fernandez
Owner, Prime Health Consultants
${REPLY_TO}

${COMPANY} · Licensed Independent Insurance Agency · NPN: ${NPN}
${ADDRESS}`;

// ---------- Templates registry ----------

export const OUTREACH_TEMPLATES = [
  {
    id: 'phc-outreach-1-initial',
    name: 'Email 1 — Initial outreach',
    description: 'First contact after Benepath inquiry. Asks for age, gender, zip.',
    subject: 'Health insurance quotes for you — Prime Health Consultants',
    previewText: 'Reviewing health insurance quotes for you from major carriers. Quick reply with three details and I will send pricing in two hours.',
    pillLabel: null,
    ctaLabel: 'Reply with my info',
    ctaSubject: 'Re: Health insurance quotes',
    bodyHtmlInner: EMAIL_1_BODY,
    bodyText: EMAIL_1_TEXT,
  },
  {
    id: 'phc-outreach-2-followup',
    name: 'Email 2 — Quick follow-up',
    description: 'Follow-up nudge. Asks to schedule a 10–15 min call.',
    subject: 'Following up on your health coverage options',
    previewText: 'Just following up on your health insurance request. Let us schedule a quick 10-15 minute call to tailor the best options for you.',
    pillLabel: 'Quick follow-up',
    ctaLabel: 'Reply with my availability',
    ctaSubject: 'Re: Scheduling a quick call',
    bodyHtmlInner: EMAIL_2_BODY,
    bodyText: EMAIL_2_TEXT,
  },
  {
    id: 'phc-outreach-3-final',
    name: 'Email 3 — Ready to finalize',
    description: 'Final ask for DOB + gender to finalize accurate pricing.',
    subject: 'One more thing to finalize your quote',
    previewText: 'Ready to put together your health coverage options — I just need dates of birth and gender to finalize accurate pricing.',
    pillLabel: 'Ready to finalize',
    ctaLabel: 'Reply with my info',
    ctaSubject: 'Re: DOB and gender info for quotes',
    bodyHtmlInner: EMAIL_3_BODY,
    bodyText: EMAIL_3_TEXT,
  },
];

export function getOutreachTemplate(id) {
  return OUTREACH_TEMPLATES.find(t => t.id === id) || null;
}

/**
 * Render a template into the final shape the /api/email/send route
 * accepts. Adds the prospect's email as recipient.
 */
export function renderOutreachTemplate(template, prospect) {
  if (!template) return null;
  // Personalize the inner body + text fallback with the prospect's
  // first name. The shell (banner/signature/footer) doesn't reference
  // any tokens so it stays static.
  const bodyInnerPersonal = applyTokens(template.bodyHtmlInner, prospect);
  const html = renderShell({
    subject: template.subject,
    previewText: template.previewText,
    pillLabel: template.pillLabel,
    bodyInner: bodyInnerPersonal,
    ctaLabel: template.ctaLabel,
    ctaSubject: template.ctaSubject,
  });
  return {
    templateId: template.id,
    templateName: template.name,
    subject: template.subject,
    html,
    text: applyTokens(template.bodyText, prospect),
    recipient: (prospect?.email || '').trim(),
  };
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
