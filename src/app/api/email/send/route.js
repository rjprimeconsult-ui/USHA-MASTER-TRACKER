/**
 * POST /api/email/send
 *
 * Sends a post-sale email on behalf of an authenticated agent.
 *
 * Body: {
 *   leadId:            string
 *   subject:           string
 *   body:              string
 *   recipient:         string  (already resolved by client — test mode
 *                               redirection happens client-side, server
 *                               just validates and sends)
 *   intendedRecipient: string  (for audit log only)
 *   testMode:          boolean
 *   fromName:          string  (optional)
 * }
 *
 * Required: Bearer <supabase access token>.
 *
 * Three failure modes the client cares about:
 *   - 401  not signed in / invalid token
 *   - 403  user doesn't have access to the post_sale_emails beta
 *   - 503  RESEND_API_KEY not set (notConfigured: true)
 *
 * On success, returns { ok: true, messageId, recipient, testMode }.
 */

import { createClient } from '@supabase/supabase-js';
import { canAccessBetaFeature } from '@/lib/featureFlags';
import { appUrl } from '@/lib/appUrl.mjs';
import { isSuppressed } from '@/lib/emailSuppression.mjs';
import { makeUnsubscribeToken } from '@/lib/unsubscribeToken.mjs';
import {
  LEGAL,
  OUTREACH_UNSUBSCRIBE_PLACEHOLDER,
  canSpamFooterStandaloneHtml,
} from '@/lib/legalConfig.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Resend rejects tag values with anything outside [a-zA-Z0-9_-]. Coerce
// whatever the caller hands us to a safe string. Empty / invalid → '_unknown'.
function safeTagValue(v) {
  const s = String(v || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256);
  return s || '_unknown';
}

// Best-effort plain-text fallback derived from HTML. Resend recommends
// both for deliverability — when a caller ships HTML-only we synthesize
// a readable text version so the multipart/alternative is real.
function stripHtmlForText(html) {
  if (!html) return '';
  return String(html)
    // Drop script/style content entirely
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Block-level tags become newlines so paragraph spacing survives
    .replace(/<\/(p|div|tr|li|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Strip everything else
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rarr;/g, '→')
    .replace(/&ndash;/g, '–')
    .replace(/&middot;/g, '·')
    .replace(/&rsquo;/g, "'")
    // Collapse runs of blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50_000);
}

async function getUserId(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const client = createClient(url, anon);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Ensure a commercial email carries a working CAN-SPAM unsubscribe link.
//   1. Outreach HTML is rendered client-side with a sentinel in place of the
//      unsubscribe URL (the signing secret is server-only) — swap it for the
//      real per-recipient signed link.
//   2. Any commercial HTML that ends up WITHOUT our footer (the legacy
//      plain-text post-sale wrap, or a caller-supplied html) gets a standalone
//      compliance footer appended before </body>.
// The post-sale useHtmlRender path already renders the footer via
// renderPostSaleHtml({ unsubscribeUrl }), so it needs neither.
function ensureUnsubscribeFooter(html, unsubscribeUrl, { alreadyHasFooter }) {
  let out = String(html || '');
  if (out.includes(OUTREACH_UNSUBSCRIBE_PLACEHOLDER)) {
    return out.split(OUTREACH_UNSUBSCRIBE_PLACEHOLDER).join(unsubscribeUrl);
  }
  if (alreadyHasFooter) return out;
  const footer = canSpamFooterStandaloneHtml({ unsubscribeUrl });
  // Function replacer so any `$` in the footer/address isn't treated as a
  // replacement pattern ($&, $1, ...).
  return out.includes('</body>')
    ? out.replace('</body>', () => `${footer}</body>`)
    : out + footer;
}

export async function POST(req) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = getServiceClient();
  if (!supabase) return Response.json({ error: 'server not configured' }, { status: 503 });

  // Profile + access check (defense in depth — UI also gates this)
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('id, email, subscription_status, subscription_tier, trial_ends_at, is_complimentary, is_admin')
    .eq('id', userId)
    .maybeSingle();
  if (pErr || !profile) {
    return Response.json({ error: 'profile not found' }, { status: 403 });
  }

  // Parse body
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const {
    leadId,
    prospectId,            // optional — when set, this is an outreach email
    kind = 'post-sale',    // 'post-sale' | 'outreach' | 'welcome'
    subject = '',
    body: emailBody = '',
    html: emailHtml = '',  // optional — full HTML body. When present,
                           // overrides the auto-generated wrap from text.
    recipient = '',
    intendedRecipient = '',
    testMode = false,
    fromName = '',
    templateId = '',
    templateName = '',
    // Polished HTML rendering for post-sale (server-side wrap).
    // When useHtmlRender is true, the server pulls the agent's
    // accent palette from user_kv and renders the full shell
    // (banner + policy card + signature + footer) around the
    // resolved body text. templateExtras + leadSnapshot give the
    // server the bits it needs to render without re-fetching.
    useHtmlRender = false,
    templateExtras = {},
    leadSnapshot = {},
  } = body || {};

  // Per-kind feature-flag check. Different email kinds gate to
  // different flags so tier-policy is enforced server-side regardless
  // of UI state:
  //   - post-sale → post_sale_emails  (Pro+)
  //   - outreach  → outreach_emails   (Team+)
  //   - welcome   → no flag check     (PRIM-triggered system email)
  if (kind === 'outreach') {
    const access = canAccessBetaFeature('outreach_emails', profile);
    if (!access.canAccess) {
      return Response.json({ error: 'outreach not enabled for this account', reason: access.reason }, { status: 403 });
    }
  } else if (kind === 'post-sale') {
    const access = canAccessBetaFeature('post_sale_emails', profile);
    if (!access.canAccess) {
      return Response.json({ error: 'post-sale emails not enabled for this account', reason: access.reason }, { status: 403 });
    }
  }
  // 'welcome' bypasses the per-tier gate — but is LOCKED to the caller's
  // own email address. Without this lock, kind:'welcome' is an open relay:
  // any signed-in user could POST an arbitrary subject/body/recipient and
  // send mail through our Resend domain (spam / phishing / quota abuse).
  // The real welcome path is the Stripe webhook calling
  // sendWelcomeEmailForUser server-side — NOT this user-facing endpoint —
  // so a legitimate welcome request here only ever targets the user
  // themselves.
  if (kind === 'welcome') {
    const self = (profile.email || '').trim().toLowerCase();
    if (!self || recipient.trim().toLowerCase() !== self) {
      return Response.json({ error: 'welcome emails can only be sent to your own account email' }, { status: 403 });
    }
  }

  // Either a leadId (post-sale) or a prospectId (outreach) is required.
  // Welcome emails don't need either — they're addressed to the user
  // themselves on signup.
  if (kind !== 'welcome' && !leadId && !prospectId) {
    return Response.json({ error: 'leadId or prospectId required' }, { status: 400 });
  }
  if (!subject.trim())       return Response.json({ error: 'subject required' }, { status: 400 });
  if (!emailBody.trim() && !emailHtml.trim()) {
    return Response.json({ error: 'body or html required' }, { status: 400 });
  }
  if (!/.+@.+\..+/.test(recipient)) return Response.json({ error: 'invalid recipient' }, { status: 400 });

  // Ownership check — confirm the leadId/prospectId actually belongs
  // to this user before sending. Prevents an authenticated agent from
  // crafting a POST with someone else's lead/prospect ID and getting
  // the server to send an email tagged with the victim's audit log
  // (IDOR). Looks up the relevant user_kv row and bails with 404 if
  // the ID isn't found in that user's records.
  // Welcome emails (kind='welcome') skip this check — they target the
  // user themselves, not a lead or prospect.
  if (kind !== 'welcome') {
    const storeKey = prospectId ? 'prospects_v1' : 'leads_v5';
    const targetId = prospectId || leadId;
    const { data: kvRow } = await supabase
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', storeKey)
      .maybeSingle();
    let arr = kvRow?.value;
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr); } catch { arr = null; }
    }
    if (!Array.isArray(arr) || !arr.some(r => r?.id === targetId)) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
  }

  // ---- CAN-SPAM: commercial-only compliance (suppression + unsubscribe) ----
  // Outreach and post-sale are commercial/outreach messages subject to CAN-SPAM
  // (physical address + working unsubscribe + honor opt-outs). Welcome is a
  // transactional message (and locked to the caller's own address above), so it
  // is not gated by the suppression list.
  const isCommercial = kind === 'outreach' || kind === 'post-sale';

  // Honor opt-outs BEFORE doing any send work: if this recipient has
  // unsubscribed from this agent, skip the Resend call entirely and report it
  // as a successful no-op so the caller's audit trail can record the skip.
  if (isCommercial) {
    const suppressed = await isSuppressed(supabase, userId, recipient);
    if (suppressed) {
      console.log(`[email/send] suppressed userId=${userId} kind=${kind} (recipient on opt-out list)`);
      return Response.json({ ok: true, suppressed: true, messageId: null, recipient, intendedRecipient });
    }
  }

  // Per-recipient signed unsubscribe link (owner = the sending agent). Built for
  // commercial sends only; used in the in-body footer AND the List-Unsubscribe
  // headers. Origin mirrors how the rest of the route resolves the app origin.
  const appOriginForUnsub = (req.headers.get('origin') || appUrl()).replace(/\/$/, '');
  const unsubscribeUrl = isCommercial
    ? `${appOriginForUnsub}/api/email/unsubscribe/${makeUnsubscribeToken(userId, recipient)}`
    : null;

  // Truncate to safe lengths so a runaway template doesn't blow the API.
  // HTML allowance is bigger because banner-heavy templates run ~10-20KB.
  const safeSubject = String(subject).slice(0, 200);
  const safeBody    = String(emailBody).slice(0, 50_000);
  const safeHtml    = String(emailHtml).slice(0, 200_000);

  // Resend wiring — clean failure if not configured yet.
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({
      error: 'Email service not configured. RESEND_API_KEY missing in Vercel env.',
      notConfigured: true,
    }, { status: 503 });
  }

  // Sender identity resolution order:
  //   1. Per-agent override from user_kv (set in Settings → Post-Sale Emails)
  //   2. Per-template fromName + global RESEND_FROM_ADDRESS env var
  //   3. Hard-coded fallback (Resend's onboarding domain)
  // Reply-To follows the From address when an override is set so customer
  // replies land in the agent's actual sending mailbox.
  let senderOverride = null;
  try {
    const { data: idRow } = await supabase
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'email_sender_identity_v1')
      .maybeSingle();
    if (idRow?.value) {
      const raw = typeof idRow.value === 'string' ? JSON.parse(idRow.value) : idRow.value;
      const addr = String(raw?.fromAddress || '').trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
        senderOverride = {
          fromName: String(raw?.fromName || '').trim(),
          fromAddress: addr,
        };
      }
    }
  } catch (e) {
    console.warn('[email/send] sender identity load failed (falling back):', e?.message || e);
  }

  const globalFrom = process.env.RESEND_FROM_ADDRESS || 'PRIM <onboarding@resend.dev>';
  let fromHeader;
  let replyTo;
  if (senderOverride) {
    const display = senderOverride.fromName || (profile.email || '').split('@')[0] || 'PRIM';
    fromHeader = `${display} <${senderOverride.fromAddress}>`;
    replyTo = senderOverride.fromAddress;
  } else {
    const fromDisplay = (fromName || (profile.email || '').split('@')[0] || 'PRIM').trim();
    fromHeader = `${fromDisplay} <${globalFrom.match(/<([^>]+)>/)?.[1] || globalFrom}>`;
    replyTo = profile.email;
  }

  // HTML body resolution. Three paths:
  //   1. Outreach (passes full pre-rendered HTML)        → use as-is
  //   2. Post-sale + useHtmlRender                       → render the
  //      polished shell server-side using the agent's accent palette
  //   3. Default (legacy post-sale plain-text)           → simple
  //      <br>-converted wrap
  let htmlBody;
  let dearDoctorAttachment = null;
  if (safeHtml) {
    htmlBody = safeHtml;
  } else if (kind === 'post-sale' && useHtmlRender) {
    // Pull the agent's accent + banner from user_kv for the HTML shell.
    let agentProfile = { accent: 'indigo', displayName: '', phone: '', bannerUrl: '' };
    try {
      const { data: apRow } = await supabase
        .from('user_kv')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'agent_profile_v1')
        .maybeSingle();
      if (apRow?.value) {
        const parsed = typeof apRow.value === 'string' ? JSON.parse(apRow.value) : apRow.value;
        agentProfile = {
          accent: parsed?.accent || 'indigo',
          displayName: parsed?.displayName || '',
          phone: parsed?.phone || '',
          bannerUrl: parsed?.bannerUrl || '',
        };
      }
    } catch (e) {
      console.warn('[email/send] agent profile load failed (using defaults):', e?.message);
    }
    const { renderPostSaleHtml, dearDoctorPdfPath } = await import('@/lib/postSaleHtml');
    const appOrigin = req.headers.get('origin') || appUrl();
    htmlBody = renderPostSaleHtml({
      template: {
        subject: safeSubject,
        closingLine: templateExtras?.closingLine || '',
        verificationPhone: templateExtras?.verificationPhone || '',
        referralEnabled: templateExtras?.referralEnabled !== false,
        referralText: templateExtras?.referralText || '',
        fromName,
      },
      lead: {
        name: leadSnapshot?.name || '',
        policyNumber: leadSnapshot?.policyNumber || '',
        effectiveDate: leadSnapshot?.effectiveDate || '',
        mainProduct: leadSnapshot?.mainProduct || '',
        associationPlan: leadSnapshot?.associationPlan || '',
      },
      profile,
      agentProfile,
      resolvedBody: safeBody,
      resolvedSubject: safeSubject,
      userId,
      appOrigin,
      unsubscribeUrl,
    });

    // Attach the matching "Dear Doctor Letter" PDF when the template
    // wants it AND a PDF exists for this lead's main product. ACA
    // Wrap + Suppy don't get a PDF — handled by the lookup returning
    // null. Resend takes the public URL and fetches it itself.
    if (templateExtras?.attachDearDoctorPdf !== false) {
      const pdfPath = dearDoctorPdfPath(leadSnapshot?.mainProduct);
      if (pdfPath) {
        const origin = req.headers.get('origin') || appUrl();
        dearDoctorAttachment = {
          filename: pdfPath.split('/').pop(),
          path: `${origin}${pdfPath}`,
        };
      }
    }
  } else {
    htmlBody = `<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 14px; line-height: 1.6; color: #0f172a;">${safeBody
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')}</div>`;
  }

  // CAN-SPAM footer / unsubscribe link for commercial sends. The post-sale
  // useHtmlRender path already embeds the footer (renderPostSaleHtml receives
  // unsubscribeUrl); every other commercial path gets the sentinel swapped or a
  // standalone footer appended here.
  if (isCommercial && unsubscribeUrl) {
    const alreadyHasFooter = !safeHtml && kind === 'post-sale' && useHtmlRender;
    htmlBody = ensureUnsubscribeFooter(htmlBody, unsubscribeUrl, { alreadyHasFooter });
  }

  let resendResult;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [recipient],
        reply_to: replyTo,
        subject: safeSubject,
        text: safeBody || stripHtmlForText(safeHtml),
        html: htmlBody,
        ...(dearDoctorAttachment ? { attachments: [dearDoctorAttachment] } : {}),
        // CAN-SPAM / one-click unsubscribe. Gmail + Yahoo surface a native
        // "Unsubscribe" control from these headers and POST the link for
        // List-Unsubscribe=One-Click. Commercial sends only.
        ...(isCommercial && unsubscribeUrl ? {
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${LEGAL.contactEmail}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        } : {}),
        // Tags double as analytics in Resend's dashboard AND as the
        // identity bridge for webhook events — the /api/email/webhook
        // handler reads user_id + lead_id / prospect_id back to find
        // which record to update with delivered/opened/clicked status.
        // Resend tag values: ASCII alphanumeric / _ / - only.
        tags: [
          { name: 'app', value: 'prim' },
          { name: 'kind', value: safeTagValue(kind || 'post-sale') },
          { name: 'test_mode', value: testMode ? 'true' : 'false' },
          { name: 'user_id', value: safeTagValue(userId) },
          ...(leadId     ? [{ name: 'lead_id',     value: safeTagValue(leadId) }]     : []),
          ...(prospectId ? [{ name: 'prospect_id', value: safeTagValue(prospectId) }] : []),
          ...(templateId ? [{ name: 'template_id', value: safeTagValue(templateId) }] : []),
        ],
      }),
    });
    resendResult = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[email/send] Resend rejected:', resendResult);
      return Response.json({
        error: resendResult?.message || `Resend HTTP ${r.status}`,
        details: resendResult,
      }, { status: 502 });
    }
  } catch (e) {
    console.error('[email/send] Resend fetch failed:', e);
    return Response.json({ error: e?.message || 'network error' }, { status: 502 });
  }

  // No recipient email in logs (customer PII) — leadId + Resend messageId
  // give full correlation for debugging without it.
  console.log(`[email/send] userId=${userId} leadId=${leadId} testMode=${testMode} messageId=${resendResult?.id || '?'}`);

  return Response.json({
    ok: true,
    messageId: resendResult?.id || null,
    recipient,
    intendedRecipient,
    testMode: !!testMode,
  });
}
