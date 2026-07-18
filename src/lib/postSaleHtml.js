/**
 * Server-rendered HTML shell for post-sale emails.
 *
 * Agents in Post-Sale Email Settings can edit the wording of the body
 * paragraphs, the verification phone, the referral text, and the
 * closing line — but the HTML structure around them (banner, policy
 * info card, signature block, footer) is locked in this module so
 * agents can't accidentally break the layout.
 *
 * Banner is text-on-color: pulls the agent's accent palette from their
 * `agent_profile_v1` user_kv row + agent display name. A future
 * upgrade can render an uploaded banner image when one is set.
 *
 * Used by /api/email/send for templates with `useHtmlRender: true`.
 */

import { getPalette } from './agentProfile';
import { canSpamFooterHtml } from './legalConfig.mjs';

// ---------- Product → "Dear Doctor Letter" PDF ----------
//
// Hosted in public/dear-doctor/ so they're served at
// https://www.primtracker.com/dear-doctor/<name>.pdf and can be
// attached via Resend's `path` field (Resend fetches the URL itself).
//
// Products without an entry here (ACA WRAP, SUPPY) ship with no
// attachment — supplementary products don't carry the Dear Doctor
// instructions on their own.
export const DEAR_DOCTOR_PDFS = {
  'PREMIER ADVANTAGE':          '/dear-doctor/dear-doctor-premier-advantage.pdf',
  'PREMIER CHOICE':             '/dear-doctor/dear-doctor-premier-choice.pdf',
  'SECURE ADVANTAGE':           '/dear-doctor/dear-doctor-secure-advantage.pdf',
  'SECUREADVANTAGE CONVERSION': '/dear-doctor/dear-doctor-secure-advantage.pdf',
  'HEALTH ACCESS III':          '/dear-doctor/dear-doctor-health-access-plus.pdf',
};

export function dearDoctorPdfPath(mainProduct) {
  return DEAR_DOCTOR_PDFS[String(mainProduct || '').toUpperCase()] || null;
}

// ---------- HTML escape (defensive — agent body text is user-controlled) ----------

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Render plain-text body paragraphs to safe HTML. Splits on blank
// lines into <p> blocks; preserves single newlines inside a paragraph
// as <br>. Escapes all HTML in the source so an agent typing
// "<script>" into the body field can't break out.
function paragraphsToHtml(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(block => {
      const safe = escapeHtml(block.trim()).replace(/\n/g, '<br/>');
      return safe ? `<p style="margin:0 0 14px 0;">${safe}</p>` : '';
    })
    .filter(Boolean)
    .join('');
}

// ---------- Banner ----------
//
// Hero band at the top of the email. Three layered behaviors:
//
//   1. If the agent uploaded a banner image in Profile -> Appearance,
//      reference it via /api/banners/[userId] — that endpoint serves
//      the data-URL-stored banner as a real https:// image so email
//      clients (which strip data: URLs) can load it. A dark overlay
//      sits on top so the agent's name + role stay readable.
//   2. If no banner image, fall back to the agent's accent gradient
//      (Indigo / Emerald / Rose / Amber / Teal) — still vivid and
//      personalized via Profile -> Appearance.
//   3. Image loads ON TOP of the accent gradient, so if the banner
//      ever fails to load, the agent's brand color shows through
//      instead of a grey wash.
//
// `appOrigin` is the absolute URL prefix for the API endpoint (e.g.
// `https://www.primtracker.com`) — required because email clients
// won't resolve relative URLs.
function renderBanner(agentProfile, userId, appOrigin) {
  const accent = agentProfile?.accent || 'indigo';
  const palette = getPalette(accent);
  const displayName = escapeHtml(agentProfile?.displayName || 'Your insurance agent');
  const hasBanner = !!(agentProfile?.bannerUrl && userId && appOrigin);

  // CSS background stack: dark overlay → banner image → accent gradient.
  // If the image fails to load, the accent gradient shows through.
  // Without a banner, the accent gradient alone is used.
  const bgStyle = hasBanner
    ? `background:
         linear-gradient(135deg, rgba(15,23,42,0.55), rgba(15,23,42,0.30)),
         url(${appOrigin}/api/banners/${encodeURIComponent(userId)}) center/cover no-repeat,
         linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%);`
    : `background: linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%);`;

  return `
        <tr>
          <td style="${bgStyle} padding:38px 36px 32px 36px; text-align:center;">
            <div style="font-size:11px; letter-spacing:3px; text-transform:uppercase; color:rgba(255,255,255,0.85); font-weight:bold; margin-bottom:8px;">Your new policy</div>
            <div style="font-size:26px; line-height:1.2; color:#FFFFFF; font-weight:bold; letter-spacing:-0.3px; margin-bottom:4px;">${displayName}</div>
            <div style="font-size:13px; color:rgba(255,255,255,0.85); font-weight:500;">Licensed Insurance Agent</div>
          </td>
        </tr>`;
}

// ---------- Policy info card ----------

function renderPolicyCard({ policyNumber, effectiveDate, mainProduct, associationPlan }) {
  const rows = [
    policyNumber     && ['Policy number',    escapeHtml(policyNumber)],
    effectiveDate    && ['Effective date',   escapeHtml(effectiveDate)],
    mainProduct      && ['Plan',             escapeHtml(mainProduct)],
    associationPlan  && ['Association',      escapeHtml(associationPlan)],
  ].filter(Boolean);

  if (rows.length === 0) return '';
  const rowsHtml = rows.map(([label, value]) => `
                    <tr>
                      <td style="padding:6px 0; color:#64748B; font-size:12px; letter-spacing:0.3px; text-transform:uppercase; font-weight:bold; width:130px; vertical-align:top;">${label}</td>
                      <td style="padding:6px 0; color:#0F172A; font-size:14px; font-weight:600;">${value}</td>
                    </tr>`).join('');

  return `
        <tr>
          <td style="padding:0 36px 18px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC; border:1px solid #DBE3F0; border-left:4px solid var(--accent, #6366F1); border-radius:8px;">
              <tr>
                <td style="padding:16px 22px;">
                  <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; font-weight:bold; color:#0F172A; margin-bottom:8px;">Your Policy</div>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${rowsHtml}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

// ---------- Verification call card ----------

function renderVerificationCard(verificationPhone) {
  const phone = String(verificationPhone || '').trim();
  if (!phone) return '';
  return `
        <tr>
          <td style="padding:0 36px 18px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px;">
              <tr>
                <td style="padding:14px 18px; color:#1E3A8A; font-size:14px; line-height:1.55;">
                  <strong style="display:block; margin-bottom:4px;">Verification call</strong>
                  You&rsquo;ll receive a call from the company at <strong style="white-space:nowrap;">${escapeHtml(phone)}</strong> to verify your application answers. Once that&rsquo;s done, underwriting begins and we&rsquo;ll keep you posted.
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

// ---------- Referral card ----------

function renderReferralCard({ referralEnabled, referralText }) {
  if (!referralEnabled) return '';
  const text = String(referralText || '').trim() || defaultReferralText();
  return `
        <tr>
          <td style="padding:6px 36px 18px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px;">
              <tr>
                <td style="padding:16px 20px; color:#14532D; font-size:14px; line-height:1.6;">
                  <strong style="display:block; color:#166534; margin-bottom:6px; font-size:11px; letter-spacing:1px; text-transform:uppercase;">Referral program</strong>
                  ${paragraphsToHtml(text).replace(/style="margin:0 0 14px 0;"/g, 'style="margin:0 0 10px 0;"')}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

export function defaultReferralText() {
  return `The most gratifying recognition for my work is a referral. I have included you in my referral program. If you know individuals who have encountered similar situations — overpaying for insurance, dissatisfaction with their current coverage, or simply needing guidance — I would be honored to help. As a token of appreciation, I offer a referral bonus of $150 to $200 upon a successful referral.`;
}

// ---------- Signature ----------

function renderSignature({ agentName, agentPhone, agentEmail }) {
  return `
        <tr>
          <td style="padding:8px 36px 22px 36px; color:#1E293B; font-size:14px; line-height:1.55;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="padding:14px 0 0 0; border-top:1px solid #E2E8F0;">
                  <div style="margin-bottom:6px;">Welcome aboard,</div>
                  <strong style="color:#0F172A; font-size:15px; display:block;">${escapeHtml(agentName || '')}</strong>
                  ${agentPhone ? `<div style="color:#64748B; font-size:13px;">${escapeHtml(agentPhone)}</div>` : ''}
                  ${agentEmail ? `<div><a href="mailto:${escapeHtml(agentEmail)}" style="color:#2563EB; text-decoration:none; font-size:13px;">${escapeHtml(agentEmail)}</a></div>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

// ---------- Full shell renderer ----------

/**
 * Render the complete HTML email.
 *
 * Inputs:
 *   template        — { subject, body, verificationPhone, referralEnabled,
 *                       referralText, closingLine }  (from postSaleEmails bundle)
 *   lead            — { name, mainProduct, associationPlan, policyNumber,
 *                       effectiveDate }
 *   profile         — Supabase profiles row (for agent email fallback)
 *   agentProfile    — agent_profile_v1 row (displayName, phone, accent, bannerUrl)
 *   resolvedBody    — body text AFTER {token} substitution (caller does
 *                     the token pass since the existing render pipeline
 *                     already handles them)
 *   unsubscribeUrl  — per-recipient signed CAN-SPAM opt-out URL (built by the
 *                     send route). When present, the footer shows a working
 *                     unsubscribe link; when absent it falls back to a mailto.
 *
 * Output: string of complete HTML email.
 */
export function renderPostSaleHtml({ template, lead, profile, agentProfile, resolvedBody, resolvedSubject, userId, appOrigin, unsubscribeUrl }) {
  const agentName  = template?.fromName || agentProfile?.displayName || (profile?.email || '').split('@')[0] || '';
  const agentPhone = agentProfile?.phone || '';
  const agentEmail = profile?.email || '';
  // userId + appOrigin are required to render the banner image via
  // /api/banners/[userId]. Without them, we silently fall back to
  // the accent-only banner.
  const safeUserId = String(userId || '');
  const safeOrigin = String(appOrigin || '').replace(/\/$/, '');

  const closing = String(template?.closingLine || 'Thank you for your business.').trim();
  const closingHtml = closing ? `<p style="margin:0 0 14px 0; color:#0F172A; font-weight:600;">${escapeHtml(closing)}</p>` : '';

  const policyHtml = renderPolicyCard({
    policyNumber:    lead?.policyNumber,
    effectiveDate:   lead?.effectiveDate,
    mainProduct:     lead?.mainProduct,
    associationPlan: lead?.associationPlan,
  });
  const verificationHtml = renderVerificationCard(template?.verificationPhone);
  const referralHtml = renderReferralCard({
    referralEnabled: template?.referralEnabled !== false,
    referralText:    template?.referralText,
  });

  // Accent CSS var for the policy card left-border. Inline a fallback
  // hex so email clients that strip custom properties still see a color.
  const palette = getPalette(agentProfile?.accent || 'indigo');
  const accentVar = `style="--accent: ${palette.solid};"`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(resolvedSubject || template?.subject || 'Your new policy')}</title>
  <!--[if mso]><style type="text/css">table, td { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
</head>
<body ${accentVar} style="margin:0; padding:0; background-color:#EEF2F7; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing:antialiased;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#EEF2F7;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; width:100%; background:#FFFFFF; border-radius:14px; overflow:hidden; box-shadow:0 6px 18px rgba(15,23,51,0.10);">
${renderBanner(agentProfile, safeUserId, safeOrigin)}
        <tr>
          <td style="padding:24px 36px 4px 36px; color:#1E293B; font-size:15px; line-height:1.65;">
            ${paragraphsToHtml(resolvedBody)}
            ${closingHtml}
          </td>
        </tr>
${policyHtml}
${verificationHtml}
${referralHtml}
${renderSignature({ agentName, agentPhone, agentEmail })}
        <tr>
          <td style="background:#F8FAFC; padding:18px 36px 8px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;">
            This email is from ${escapeHtml(agentName)} regarding your new policy.
          </td>
        </tr>
${canSpamFooterHtml({ unsubscribeUrl })}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
