/**
 * GET /api/webforms/config  — ensure the caller's webforms webhook token
 *                             exists (generating one on first call), then
 *                             return the webhook URL + capture stats.
 * POST /api/webforms/config — { regenerateToken: true } rotates the token.
 *
 * Auth: bearer token → requireUserId (anon client, verified session).
 * Storage: service-role for profiles.webforms_webhook_token + user_kv
 *          (webforms_config_v1, written by the public webhook route).
 *
 * SECURITY: never expose another user's token; all queries scoped to userId.
 * No settings besides the token are managed here (YAGNI) — mirrors the shape
 * of /api/ringy/config but deliberately smaller.
 */

import { createClient } from '@supabase/supabase-js';
import { requireUserId } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cleanEnv(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

function serviceClient() {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Generate a ~32-char URL-safe random token. */
function generateToken() {
  // Two UUIDs joined, dashes stripped → 64 hex chars; take first 32.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32);
  }
  // No non-crypto fallback: never mint a security token from Math.random().
  throw new Error('No secure RNG available to generate a webhook token');
}

/** Derive the public origin from the incoming request. */
function originFromRequest(req) {
  const siteUrl = cleanEnv(process.env.NEXT_PUBLIC_SITE_URL);
  if (siteUrl) return siteUrl.replace(/\/$/, '');

  const host  = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.primtracker.com';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

/** Ensure webforms_webhook_token exists on profiles; generate one if missing. */
async function ensureToken(admin, userId, forceNew = false) {
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('webforms_webhook_token')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) throw new Error(`Failed to load profile: ${profileErr.message}`);

  if (forceNew || !profile?.webforms_webhook_token) {
    const newToken = generateToken();
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ webforms_webhook_token: newToken })
      .eq('id', userId);
    if (updateErr) throw new Error(`Failed to store webhook token: ${updateErr.message}`);
    return newToken;
  }
  return profile.webforms_webhook_token;
}

/** Build the response shape shared by GET and POST. */
function buildResponseShape(origin, token, cfg) {
  return {
    webhookUrl:     `${origin}/api/webforms/webhook/${token}`,
    connected:      (cfg.receivedCount || 0) > 0,
    lastReceivedAt: cfg.lastReceivedAt ?? null,
    receivedCount:  cfg.receivedCount ?? 0,
  };
}

// ---- GET ----

export async function GET(req) {
  try {
    const auth = await requireUserId(req);
    if (auth instanceof Response) return auth;
    const userId = auth;

    const admin = serviceClient();
    if (!admin) return Response.json({ error: 'Server not configured' }, { status: 500 });

    const [token, cfgRow] = await Promise.all([
      ensureToken(admin, userId),
      admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'webforms_config_v1').maybeSingle(),
    ]);

    if (cfgRow.error) return Response.json({ error: `Failed to load config: ${cfgRow.error.message}` }, { status: 500 });

    const cfg    = cfgRow.data?.value ?? {};
    const origin = originFromRequest(req);

    return Response.json(buildResponseShape(origin, token, cfg));
  } catch (e) {
    console.error('[webforms/config GET] error:', e?.message || String(e));
    return Response.json({ error: `Server error: ${e?.message || String(e)}` }, { status: 500 });
  }
}

// ---- POST ----

export async function POST(req) {
  try {
    const auth = await requireUserId(req);
    if (auth instanceof Response) return auth;
    const userId = auth;

    const admin = serviceClient();
    if (!admin) return Response.json({ error: 'Server not configured' }, { status: 500 });

    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { regenerateToken } = body || {};

    const [token, cfgRow] = await Promise.all([
      ensureToken(admin, userId, !!regenerateToken),
      admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'webforms_config_v1').maybeSingle(),
    ]);

    if (cfgRow.error) return Response.json({ error: `Failed to load config: ${cfgRow.error.message}` }, { status: 500 });

    const cfg = cfgRow.data?.value ?? {};

    console.log(`[webforms/config POST] user=${userId} regenerated=${!!regenerateToken}`);

    const origin = originFromRequest(req);
    return Response.json(buildResponseShape(origin, token, cfg));
  } catch (e) {
    console.error('[webforms/config POST] error:', e?.message || String(e));
    return Response.json({ error: `Server error: ${e?.message || String(e)}` }, { status: 500 });
  }
}
