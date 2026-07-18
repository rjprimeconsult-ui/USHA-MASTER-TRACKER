/**
 * GET|POST /api/email/unsubscribe/[token]
 *
 * PUBLIC CAN-SPAM opt-out endpoint — prospects/customers click the unsubscribe
 * link in a commercial email, so there is NO auth. The signed token IS the
 * credential: it embeds the sending agent's user id + the recipient email, and
 * its HMAC proves it was minted by us (see src/lib/unsubscribeToken.mjs).
 *
 * Lives under /api, which the app middleware excludes, so it resolves on both
 * the www and app hosts regardless of host routing.
 *
 * - GET  handles a normal click.
 * - POST handles Gmail/Yahoo's List-Unsubscribe=One-Click auto-POST.
 * Both add the (owner, email) pair to the agent's suppression list and return a
 * friendly HTML page. An invalid/forged token returns a neutral 200 page (no
 * detail leak). This handler NEVER throws to the client.
 */

import { createClient } from '@supabase/supabase-js';
import { verifyUnsubscribeToken } from '@/lib/unsubscribeToken.mjs';
import { addSuppression } from '@/lib/emailSuppression.mjs';
import { LEGAL } from '@/lib/legalConfig.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Minimal, self-contained HTML page. Always 200 — a public opt-out page should
// never show a scary error, and a non-200 could make some clients retry.
function page(title, message) {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex" />
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background:#EEF2F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#EEF2F7;">
    <tr><td align="center" style="padding:48px 16px;">
      <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="max-width:480px; width:100%; background:#FFFFFF; border-radius:14px; box-shadow:0 6px 18px rgba(15,23,51,0.08); overflow:hidden;">
        <tr><td style="padding:36px 36px 28px 36px; text-align:center;">
          <div style="font-size:20px; font-weight:800; color:#0F172A; margin-bottom:10px;">${title}</div>
          <div style="font-size:15px; line-height:1.6; color:#475569;">${message}</div>
          <div style="margin-top:22px; font-size:12px; color:#94A3B8; border-top:1px solid #E2E8F0; padding-top:16px;">
            ${LEGAL.company}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handle(req, ctx) {
  try {
    const params = (await ctx?.params) || {};
    const token = params.token;
    const decoded = verifyUnsubscribeToken(token);

    if (!decoded) {
      // Neutral response — don't reveal whether the token was malformed,
      // forged, or simply unrecognized.
      return page(
        'Unsubscribe link not valid',
        'This unsubscribe link is invalid or expired. If you keep receiving emails you didn\'t ask for, reply to the message with the word “unsubscribe”.'
      );
    }

    const supabase = getServiceClient();
    const added = supabase
      ? await addSuppression(supabase, decoded.ownerUserId, decoded.email)
      : false;

    if (added) {
      return page(
        'You\'ve been unsubscribed',
        'You won\'t receive these emails anymore. It can take a little time for any already-scheduled message to stop.'
      );
    }

    // Token was valid but we couldn't record the opt-out (store unavailable).
    // Be honest rather than falsely claiming success, and give a fallback.
    return page(
      'We\'ve received your request',
      `We couldn\'t fully process your unsubscribe automatically. Please email <a href="mailto:${LEGAL.contactEmail}?subject=unsubscribe" style="color:#4F46E5;">${LEGAL.contactEmail}</a> to confirm your opt-out and we\'ll take care of it.`
    );
  } catch (e) {
    // Absolutely never throw to a public visitor.
    console.error('[email/unsubscribe] unexpected error:', e?.message || e);
    return page(
      'Unsubscribe',
      `Something went wrong processing this link. Please email <a href="mailto:${LEGAL.contactEmail}?subject=unsubscribe" style="color:#4F46E5;">${LEGAL.contactEmail}</a> to opt out.`
    );
  }
}

export async function GET(req, ctx) {
  return handle(req, ctx);
}

export async function POST(req, ctx) {
  return handle(req, ctx);
}
