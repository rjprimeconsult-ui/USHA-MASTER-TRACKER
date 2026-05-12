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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  const access = canAccessBetaFeature('post_sale_emails', profile);
  if (!access.canAccess) {
    return Response.json({ error: 'feature not enabled for this account', reason: access.reason }, { status: 403 });
  }

  // Parse body
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const {
    leadId,
    subject = '',
    body: emailBody = '',
    recipient = '',
    intendedRecipient = '',
    testMode = false,
    fromName = '',
  } = body || {};

  if (!leadId)               return Response.json({ error: 'leadId required' }, { status: 400 });
  if (!subject.trim())       return Response.json({ error: 'subject required' }, { status: 400 });
  if (!emailBody.trim())     return Response.json({ error: 'body required' }, { status: 400 });
  if (!/.+@.+\..+/.test(recipient)) return Response.json({ error: 'invalid recipient' }, { status: 400 });

  // Truncate to safe lengths so a runaway template doesn't blow the API.
  const safeSubject = String(subject).slice(0, 200);
  const safeBody    = String(emailBody).slice(0, 50_000);

  // Resend wiring — clean failure if not configured yet.
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.json({
      error: 'Email service not configured. RESEND_API_KEY missing in Vercel env.',
      notConfigured: true,
    }, { status: 503 });
  }

  // From address. During beta we send from Resend's onboarding-style
  // domain — no DNS setup needed. The agent's name shows in the "From"
  // display; reply-to is the agent's actual email so customer replies
  // come back to them, not to a PRIM noreply inbox.
  const fromDisplay = (fromName || (profile.email || '').split('@')[0] || 'PRIM').trim();
  const fromAddress = process.env.RESEND_FROM_ADDRESS || 'PRIM <onboarding@resend.dev>';
  const fromHeader = `${fromDisplay} <${fromAddress.match(/<([^>]+)>/)?.[1] || fromAddress}>`;
  const replyTo = profile.email;

  // Convert body to a simple HTML version with linebreaks preserved. Keep
  // it text-first — agent's template is plain text, so we don't pretend
  // to do Markdown / HTML editing yet.
  const htmlBody = safeBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

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
        text: safeBody,
        html: `<div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 14px; line-height: 1.6; color: #0f172a;">${htmlBody}</div>`,
        // Tag for analytics inside Resend's dashboard.
        tags: [
          { name: 'app', value: 'prim' },
          { name: 'kind', value: 'post-sale' },
          { name: 'test_mode', value: testMode ? 'true' : 'false' },
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

  console.log(`[email/send] userId=${userId} leadId=${leadId} recipient=${recipient} testMode=${testMode} messageId=${resendResult?.id || '?'}`);

  return Response.json({
    ok: true,
    messageId: resendResult?.id || null,
    recipient,
    intendedRecipient,
    testMode: !!testMode,
  });
}
