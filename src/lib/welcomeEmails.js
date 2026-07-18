/**
 * Welcome emails — tier-specific HTML templates fired on signup.
 *
 * Triggered by the Stripe `checkout.session.completed` webhook handler
 * after the profile's subscription_tier is synced. Sends once per
 * agent (idempotent via a `welcome_email_sent_v1` flag in user_kv).
 *
 * Sender: PRIM default — `welcome@contact.primtracker.com` via the
 * verified contact.primtracker.com Resend domain. Reply-To is Juan's
 * inbox so trial agents who reply can reach support directly.
 *
 * Personalization: pulls `display_name` from the agent's profile
 * (user_kv key `agent_profile_v1`) when present, falls back to the
 * email's local part, falls back again to a generic greeting.
 */

import { createClient } from '@supabase/supabase-js';
import { appUrl } from '@/lib/appUrl.mjs';

// ---------- Brand constants ----------

const PRIM_REPLY_TO   = 'juantrejo9082@gmail.com';
const PRIM_FROM_EMAIL = 'welcome@contact.primtracker.com';
const PRIM_FROM_NAME  = 'Juan @ PRIM';
const APP_URL         = appUrl();

// ---------- Token replacement ----------

function firstNameFromProfile(displayName, email) {
  const dn = String(displayName || '').trim();
  if (dn) {
    const first = dn.split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');
    if (first) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  // Fallback to email's local part
  const local = String(email || '').split('@')[0];
  if (local && /^[A-Za-z]/.test(local)) {
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }
  return '';
}

function applyTokens(str, firstName) {
  return String(str || '')
    .replace(/\{first_name\}/g, firstName)
    .replace(/\{first_name_greeting\}/g, firstName ? ` ${firstName}` : '');
}

// ---------- Tier-specific content ----------
//
// Each entry holds the tier's distinctive parts. The shell wraps them
// with the shared header/banner/footer so the brand layout stays
// consistent.

const TIER_CONTENT = {
  starter: {
    subject: 'Welcome to PRIM{first_name_greeting} — your Starter trial is live',
    previewText: 'Your 7-day Starter trial is live. Three quick wins to get the most out of PRIM in the first week.',
    heroGradient: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 55%, #EC4899 100%)',
    heroEyebrow: 'PRIM',
    heroTitle: 'Welcome aboard{first_name_greeting}.',
    heroSubtitle: 'Your Starter trial is live.',
    heroPill: null,
    trialAccent: '#6366F1',
    trialLead: '7 days, no charge.',
    trialBody: 'Cancel anytime from your Profile → Subscription before the trial ends and you won&rsquo;t be billed.',
    bodyOpening: 'I&rsquo;m Juan, founder of PRIM. Thanks for trying us out. Starter is built for solo agents who want their book of business + commissions tracked in one clean place, without spreadsheets.',
    bodyClosing: 'Here&rsquo;s how to get the most out of your first week:',
    quickWinsTitle: 'Three quick wins this week',
    quickWinsAccent: '#4F46E5',
    quickWins: [
      ['Smart Import your last statement.', 'Drop the USHA Account Summary PDF and PRIM auto-parses every advance, residual, chargeback. No retyping.', '#6366F1'],
      ['Run a Calculator scenario.', 'See your projected advance for any deal across all four tiers (WA → FSL). Save your default tier.', '#8B5CF6'],
      ['Open the Prospects tab.', 'Drag-and-drop Kanban with appointment reminders. Track every lead from quoted to closed.', '#EC4899'],
    ],
    features: [
      'Smart Import (AI) for leads, expenses, statements',
      'Vendor memory + custom expense categories',
      'Prospects mini-CRM with appointment calendar',
      'Tier-aware Commission Calculator (WA → FSL)',
      'PRIM Assistant — your AI co-pilot',
    ],
    ctaGradient: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
    ctaShadow: '0 6px 16px rgba(99,102,241,0.35)',
    ctaLabel: 'Open my dashboard',
    helpLine: 'Stuck on anything? Just reply to this email — it lands in my inbox.',
  },

  pro: {
    subject: 'Welcome to PRIM Pro{first_name_greeting} — your CPA dashboard is live',
    previewText: 'Pro unlocks True CPA, ROI dashboards, bulk AI re-categorize, and statement reconciliation tools.',
    heroGradient: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 55%, #DB2777 100%)',
    heroEyebrow: 'PRIM · PRO',
    heroTitle: 'Welcome to Pro{first_name_greeting}.',
    heroSubtitle: 'Your trial is live — let&rsquo;s dial in your numbers.',
    heroPill: 'Most popular tier',
    trialAccent: '#7C3AED',
    trialLead: '7 days free.',
    trialBody: 'Full Pro access — no feature gates during the trial. Cancel from Profile → Subscription anytime before day 7 and you&rsquo;re not billed.',
    bodyOpening: 'Pro is built for producers who care about <strong>where their money actually goes</strong>. Most agents track commissions. Pro tracks the math behind every deal — what it cost to get there, what your real take-home is, where to double down.',
    bodyClosing: 'Three things to do first:',
    quickWinsTitle: 'Your first 48 hours',
    quickWinsAccent: '#7C3AED',
    quickWins: [
      ['Open the CPA Dashboard.', 'Six KPIs at the top tell you the truth about this week vs last vs YTD. Switch the period selector to YTD and screenshot what you see.', '#4F46E5'],
      ['Bulk AI Re-categorize Books.', 'Drop your last 3 months of expenses, hit Re-categorize, and watch every Stripe / Vanilla / Ringy charge get tagged correctly in seconds.', '#7C3AED'],
      ['Reconcile your last statement.', 'Upload a USHA Account Summary — PRIM matches every line to a lead, flags anything unmatched. You&rsquo;ll spot missing residuals in minutes.', '#DB2777'],
    ],
    features: [
      'Everything in Starter',
      'CPA Dashboard + True Net rollups',
      'Bulk AI Re-categorize (100 expenses at a time)',
      'Statement reconciliation tools',
      'Period close-out + audit trail',
      'Priority support',
    ],
    ctaGradient: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
    ctaShadow: '0 6px 16px rgba(99,102,241,0.35)',
    ctaLabel: 'Take me to CPA',
    helpLine: 'Pro plans get <strong style="color:#0F172A;">priority support</strong>. Reply to this email and I&rsquo;ll get back to you the same day.',
  },

  team: {
    subject: 'Welcome to PRIM Team{first_name_greeting} — let\'s onboard your FSL',
    previewText: 'Team unlocks override tracking, multi-agent admin, and team-wide insights. White-glove onboarding included.',
    heroGradient: 'linear-gradient(135deg, #1E1B4B 0%, #4338CA 45%, #7C3AED 100%)',
    heroEyebrow: 'PRIM · TEAM',
    heroTitle: 'Welcome to the top tier{first_name_greeting}.',
    heroSubtitle: 'Your trial is live &mdash; and so is your white-glove onboarding.',
    heroPill: 'FSL & Team Leaders',
    trialAccent: '#7C3AED',
    trialLead: '✦ You get a personal kickoff call.',
    trialBody: 'Team plans include white-glove onboarding. Reply to this email with two times that work for you this week and I&rsquo;ll send a calendar invite.',
    bodyOpening: 'Team is the version of PRIM that scales past one producer. If you&rsquo;re running a downline, dealing with override commissions, or trying to keep multiple agents&rsquo; books visible without spreadsheets &mdash; this is what it&rsquo;s built for.',
    bodyClosing: 'Here&rsquo;s the order I recommend setting things up:',
    quickWinsTitle: 'Your team rollout plan',
    quickWinsAccent: '#7C3AED',
    quickWins: [
      ['Your numbers first.', 'Get your own book imported and the CPA dashboard talking to your statements. One agent fully dialed in before you scale across the team.', '#4338CA'],
      ['Overrides flowing in.', 'Add your override sheets — PRIM tracks per-agent residuals + flags missing payouts the next time you upload a statement.', '#7C3AED'],
      ['Roll out to the team.', 'Once you&rsquo;ve seen what your data looks like, we invite your downline and replicate your config. On the kickoff call I&rsquo;ll walk you through it.', '#A855F7'],
    ],
    features: [
      'Everything in Pro',
      'Override commission tracking',
      'Multi-agent admin panel',
      'Team-wide insights + leaderboards',
      'Statement matching across downline',
      'White-glove onboarding (kickoff call + setup help)',
    ],
    ctaGradient: 'linear-gradient(135deg, #4338CA 0%, #7C3AED 100%)',
    ctaShadow: '0 6px 16px rgba(124,58,237,0.4)',
    ctaLabel: 'Schedule my kickoff',
    ctaMailto: PRIM_REPLY_TO,
    ctaMailtoSubject: 'PRIM Team kickoff call',
    secondaryCta: 'Or jump into the dashboard now',
    helpLine: 'Team plans get my direct line. Reply to this email anytime &mdash; I check it before the team support inbox.',
  },
};

// ---------- Render shell ----------

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderShell(content, firstName) {
  const t = (s) => applyTokens(s, firstName);
  const heroPillHtml = content.heroPill ? `
            <div style="display:inline-block; background:rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.3); color:#FFFFFF; font-size:10px; font-weight:bold; letter-spacing:1.5px; text-transform:uppercase; padding:4px 12px; border-radius:999px; margin-bottom:10px;">${escapeHtml(content.heroPill)}</div>` : '';

  const quickWinsHtml = content.quickWins.map(([title, body, color]) => `
                    <tr>
                      <td width="32" valign="top" style="font-size:18px; font-weight:bold; color:${color}; line-height:1.5; padding-bottom:10px;">${'•'}</td>
                      <td valign="top" style="color:#1E293B; font-size:14px; line-height:1.55; padding-bottom:10px;">
                        <strong style="color:#0F172A;">${title}</strong> ${body}
                      </td>
                    </tr>`).join('');

  const featuresHtml = content.features.map(f => `
              <tr><td valign="top" style="padding:3px 0; font-size:14px;"><span style="color:#10B981; font-weight:bold; margin-right:6px;">✓</span> ${f}</td></tr>`).join('');

  const ctaUrl = content.ctaMailto
    ? `mailto:${content.ctaMailto}?subject=${encodeURIComponent(content.ctaMailtoSubject || content.subject)}`
    : APP_URL;
  const secondaryCtaHtml = content.secondaryCta ? `
            <div style="margin-top:12px;">
              <a href="${APP_URL}" style="color:#4338CA; text-decoration:none; font-size:13px; font-weight:600;">${escapeHtml(content.secondaryCta)} &rarr;</a>
            </div>` : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(t(content.subject))}</title>
  <!--[if mso]><style type="text/css">table, td { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0; padding:0; background-color:#EEF2F7; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(content.previewText)}</div>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#EEF2F7;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px; width:100%; background:#FFFFFF; border-radius:14px; overflow:hidden; box-shadow:0 6px 18px rgba(99,102,241,0.12);">
        <tr>
          <td style="background:${content.heroGradient}; padding:42px 36px 36px 36px; text-align:center;">${heroPillHtml}
            <div style="font-size:13px; letter-spacing:3px; text-transform:uppercase; color:rgba(255,255,255,0.85); font-weight:bold; margin-bottom:6px;">${escapeHtml(content.heroEyebrow)}</div>
            <div style="font-size:30px; line-height:1.15; color:#FFFFFF; font-weight:bold; letter-spacing:-0.4px; margin-bottom:4px;">${t(content.heroTitle)}</div>
            <div style="font-size:14px; color:rgba(255,255,255,0.92); font-weight:500;">${content.heroSubtitle}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 36px 0 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC; border:1px solid #DBE3F0; border-left:4px solid ${content.trialAccent}; border-radius:8px;">
              <tr>
                <td style="padding:14px 18px; color:#0F172A; font-size:14px; line-height:1.55;">
                  <strong style="color:${content.trialAccent};">${content.trialLead}</strong> ${content.trialBody}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px 8px 36px; color:#1E293B; font-size:15px; line-height:1.65;">
            <p style="margin:0 0 14px 0;">Hey${firstName ? ` ${firstName}` : ''},</p>
            <p style="margin:0 0 14px 0;">${content.bodyOpening}</p>
            <p style="margin:0 0 18px 0;">${content.bodyClosing}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px;">
              <tr>
                <td style="padding:18px 22px;">
                  <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; font-weight:bold; color:${content.quickWinsAccent}; margin-bottom:10px;">${escapeHtml(content.quickWinsTitle)}</div>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${quickWinsHtml}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 36px 0 36px; color:#1E293B; font-size:14px; line-height:1.6;">
            <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; font-weight:bold; color:#64748B; margin-bottom:8px;">Everything you get</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${featuresHtml}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:26px 36px 18px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="background:${content.ctaGradient}; border-radius:10px; box-shadow:${content.ctaShadow};">
                  <a href="${ctaUrl}" style="display:inline-block; padding:14px 30px; color:#FFFFFF; font-size:15px; font-weight:bold; text-decoration:none; font-family:Arial, Helvetica, sans-serif; letter-spacing:0.3px;">${escapeHtml(content.ctaLabel)} &rarr;</a>
                </td>
              </tr>
            </table>${secondaryCtaHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 24px 36px; color:#64748B; font-size:13px; line-height:1.55; text-align:center;">${content.helpLine}</td>
        </tr>
        <tr>
          <td style="padding:0 36px 22px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td style="padding:16px 0 0 0; border-top:1px solid #E2E8F0; color:#1E293B; font-size:14px; line-height:1.5;">
                  <strong style="color:#0F172A;">Juan Trejo</strong><br/>
                  <span style="color:#64748B; font-size:12px;">Founder, PRIM</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#F8FAFC; padding:18px 36px 22px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;">
            <strong style="color:#0F172A; font-size:12px;">PRIM</strong> &middot; Performance, Revenue &amp; Investment Manager<br/>
            www.primtracker.com<br/><br/>
            You&rsquo;re receiving this because you signed up for a PRIM trial.<br/>
            <a href="${APP_URL}" style="color:#64748B; text-decoration:underline;">Manage preferences</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------- Plain-text fallback ----------

function renderText(content, firstName) {
  const t = (s) => applyTokens(s, firstName);
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';
  const winsText = content.quickWins.map(([title, body]) => `• ${title} ${stripHtml(body)}`).join('\n');
  const featuresText = content.features.map(f => `✓ ${f}`).join('\n');

  return [
    t(content.heroTitle).replace(/<[^>]+>/g, ''),
    content.heroSubtitle.replace(/&[a-z]+;/gi, '').replace(/<[^>]+>/g, ''),
    '',
    `${content.trialLead.replace(/<[^>]+>/g, '')} ${stripHtml(content.trialBody)}`,
    '',
    greeting,
    '',
    stripHtml(content.bodyOpening),
    '',
    stripHtml(content.bodyClosing),
    '',
    content.quickWinsTitle,
    winsText,
    '',
    'Everything you get:',
    featuresText,
    '',
    `${content.ctaLabel}: ${APP_URL}`,
    '',
    stripHtml(content.helpLine),
    '',
    '—',
    'Juan Trejo',
    'Founder, PRIM',
    'www.primtracker.com',
  ].join('\n');
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '·');
}

// ---------- Public API ----------

export function renderWelcomeEmail(tier, { displayName = '', email = '' } = {}) {
  const content = TIER_CONTENT[tier] || TIER_CONTENT.starter;
  const firstName = firstNameFromProfile(displayName, email);
  return {
    subject: applyTokens(content.subject, firstName),
    html: renderShell(content, firstName),
    text: renderText(content, firstName),
  };
}

/**
 * Fire a welcome email for a freshly subscribed user. Called from the
 * Stripe webhook handler after subscription state is synced. Idempotent
 * via the `welcome_email_sent_v1` flag in user_kv — re-running the
 * Stripe event (or hitting subscription.created + checkout.session.completed
 * back-to-back) won't double-send.
 *
 * Looks up the agent's display_name from user_kv → agent_profile_v1
 * for personalization. Falls back to email-local-part, then generic.
 *
 * Returns { sent: boolean, reason: string } — for logging only,
 * doesn't throw on Resend failures (the user is already paying, we
 * don't want a missing welcome to break the webhook).
 */
export async function sendWelcomeEmailForUser({ userId, email, tier }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('[welcomeEmails] RESEND_API_KEY missing — skipping welcome send');
    return { sent: false, reason: 'no_api_key' };
  }
  if (!email) return { sent: false, reason: 'no_email' };
  const safeTier = TIER_CONTENT[tier] ? tier : 'starter';

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[welcomeEmails] Supabase service config missing — skipping welcome send');
    return { sent: false, reason: 'no_supabase' };
  }
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Idempotency check — was this user already welcomed?
  try {
    const { data: sentRow } = await supabase
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'welcome_email_sent_v1')
      .maybeSingle();
    if (sentRow?.value) {
      return { sent: false, reason: 'already_sent' };
    }
  } catch (e) {
    // Don't block on idempotency lookup failure — worst case we send twice
    console.warn('[welcomeEmails] idempotency check failed (continuing):', e?.message);
  }

  // Pull display_name from agent_profile_v1 for personalization
  let displayName = '';
  try {
    const { data: profileRow } = await supabase
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'agent_profile_v1')
      .maybeSingle();
    if (profileRow?.value) {
      const parsed = typeof profileRow.value === 'string' ? JSON.parse(profileRow.value) : profileRow.value;
      if (typeof parsed?.displayName === 'string') displayName = parsed.displayName;
    }
  } catch (e) {
    // Personalization is best-effort
    console.warn('[welcomeEmails] display_name lookup failed (continuing):', e?.message);
  }

  const { subject, html, text } = renderWelcomeEmail(safeTier, { displayName, email });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${PRIM_FROM_NAME} <${PRIM_FROM_EMAIL}>`,
        to: [email],
        reply_to: PRIM_REPLY_TO,
        subject,
        html,
        text,
        tags: [
          { name: 'app', value: 'prim' },
          { name: 'kind', value: 'welcome' },
          { name: 'tier', value: String(safeTier) },
          { name: 'user_id', value: safeTagValue(userId) },
        ],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[welcomeEmails] Resend rejected:', data);
      return { sent: false, reason: `resend_${r.status}` };
    }

    // Mark as sent so the next Stripe event for this user is a no-op
    await supabase
      .from('user_kv')
      .upsert(
        {
          user_id: userId,
          key: 'welcome_email_sent_v1',
          value: { tier: safeTier, sentAt: new Date().toISOString(), messageId: data.id || null },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,key' }
      );

    console.log(`[welcomeEmails] sent ${safeTier} welcome to ${email} (user ${userId}) mid=${data.id}`);
    return { sent: true, reason: 'ok', messageId: data.id };
  } catch (e) {
    console.error('[welcomeEmails] Resend fetch failed:', e?.message || e);
    return { sent: false, reason: 'network_error' };
  }
}

function safeTagValue(v) {
  const s = String(v || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256);
  return s || '_unknown';
}
