/**
 * Admin impersonation endpoint.
 *
 * The admin posts { email } with their own access token in the
 * Authorization header. We:
 *   1. Verify the caller is signed in
 *   2. Verify the caller's profile has is_admin = true
 *   3. Generate a magic-link sign-in URL for the target email via the
 *      Supabase admin API (service-role key, server-side only)
 *   4. Return the action_link
 *
 * The admin's frontend opens that URL in a new tab — the target user is
 * signed in there, while the admin's original session continues in the
 * original tab.
 *
 * Required env vars on Vercel:
 *   SUPABASE_URL                  (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY     (server-only — never expose)
 */

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function unauthorized(msg = 'Unauthorized') {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Read access token from Authorization header
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized('Missing bearer token');
  const accessToken = match[1];

  // 2. Verify the caller via service-role client + getUser(accessToken)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userResp, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userResp?.user) return unauthorized('Invalid session');
  const callerId = userResp.user.id;
  const callerEmail = userResp.user.email;

  // 3. Verify caller is an admin (profiles.is_admin = true)
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', callerId)
    .single();
  if (profErr) return unauthorized(`Profile lookup failed: ${profErr.message}`);
  if (!profile?.is_admin) return unauthorized('Admin role required');

  // 4. Parse target email
  let body;
  try { body = await req.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const targetEmail = String(body?.email || '').trim().toLowerCase();
  if (!targetEmail) {
    return new Response(JSON.stringify({ error: 'email is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (targetEmail === callerEmail.toLowerCase()) {
    return new Response(JSON.stringify({ error: "You're already signed in as this user." }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. Generate a magic-link for the target. We use type=magiclink so the
  //    user already has to exist (we don't want to silently create accounts).
  const origin = req.headers.get('origin') || `https://primtracker.com`;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo: `${origin}/?impersonating=1` },
  });
  if (linkErr) {
    return new Response(JSON.stringify({ error: `generateLink failed: ${linkErr.message}` }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) {
    return new Response(JSON.stringify({ error: 'No action_link returned' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Audit log (visible in Vercel logs — no PII beyond what's already in DB)
  console.log(`[impersonate] admin=${callerEmail} target=${targetEmail}`);

  return Response.json({ url: actionLink });
}
