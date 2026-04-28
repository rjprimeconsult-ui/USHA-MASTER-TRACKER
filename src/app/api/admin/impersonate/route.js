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

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req) {
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return jsonResponse(500, { error: 'Server not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
    }

    // 1. Read access token from Authorization header
    const authHeader = req.headers.get('authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return jsonResponse(401, { error: 'Missing bearer token' });
    const accessToken = match[1];

    // 2. Verify the caller via service-role client + getUser(accessToken)
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: userResp, error: userErr } = await admin.auth.getUser(accessToken);
    if (userErr) {
      console.error('[impersonate] getUser error:', userErr);
      return jsonResponse(401, { error: `Auth check failed: ${userErr.message}` });
    }
    if (!userResp?.user) return jsonResponse(401, { error: 'Invalid session' });
    const callerId = userResp.user.id;
    const callerEmail = userResp.user.email;

    // 3. Verify caller is an admin (profiles.is_admin = true)
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', callerId)
      .single();
    if (profErr) {
      console.error('[impersonate] profile lookup error:', profErr);
      return jsonResponse(401, { error: `Profile lookup failed: ${profErr.message}` });
    }
    if (!profile?.is_admin) return jsonResponse(401, { error: 'Admin role required' });

    // 4. Parse target email
    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON body' }); }
    const targetEmail = String(body?.email || '').trim().toLowerCase();
    if (!targetEmail) return jsonResponse(400, { error: 'email is required' });
    if (callerEmail && targetEmail === callerEmail.toLowerCase()) {
      return jsonResponse(400, { error: "You're already signed in as this user." });
    }

    // 5. Generate a magic-link for the target. type=magiclink requires the
    //    user to already exist — we don't want silent account creation here.
    const origin = req.headers.get('origin') || `https://primtracker.com`;
    let linkData, linkErr;
    try {
      const result = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: targetEmail,
        options: { redirectTo: `${origin}/?impersonating=1` },
      });
      linkData = result.data;
      linkErr = result.error;
    } catch (e) {
      console.error('[impersonate] generateLink threw:', e);
      return jsonResponse(500, { error: `generateLink threw: ${e?.message || String(e)}` });
    }
    if (linkErr) {
      console.error('[impersonate] generateLink error:', linkErr);
      return jsonResponse(500, {
        error: `generateLink failed: ${linkErr.message || JSON.stringify(linkErr)}`,
        status: linkErr.status,
      });
    }

    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) {
      console.error('[impersonate] no action_link in response. Got:', JSON.stringify(linkData).slice(0, 500));
      return jsonResponse(500, { error: 'No action_link returned from Supabase' });
    }

    console.log(`[impersonate] admin=${callerEmail} target=${targetEmail}`);
    return Response.json({ url: actionLink });
  } catch (e) {
    console.error('[impersonate] uncaught error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
