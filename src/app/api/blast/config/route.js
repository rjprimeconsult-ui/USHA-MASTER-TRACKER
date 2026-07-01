/**
 * GET  /api/blast/config — load the caller's blast-webhook config; generates a
 *                          webhook token on first call if none exists.
 * POST /api/blast/config — { regenerateToken: true } to rotate the token.
 *
 * Auth: bearer token → getUser (anon client).
 * Storage: service-role for profiles (blast_webhook_token) + user_kv
 *          (blast_config_v1 counters).
 */

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function cleanEnv(s) { return String(s || '').trim().replace(/^['"]|['"]$/g, ''); }

function generateToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32);
  }
  // No non-crypto fallback: never mint a security token from Math.random().
  throw new Error('No secure RNG available to generate a webhook token');
}

function originFromRequest(req) {
  const siteUrl = cleanEnv(process.env.NEXT_PUBLIC_SITE_URL);
  if (siteUrl) return siteUrl.replace(/\/$/, '');
  const host  = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.primtracker.com';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

async function authAndClients(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { error: 'Missing bearer token', status: 401 };
  const supabaseUrl = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey    = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !anonKey || !serviceKey) return { error: 'Server not configured', status: 500 };
  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData?.user) return { error: 'Invalid session', status: 401 };
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  return { userId: userData.user.id, admin };
}

async function ensureToken(admin, userId, forceNew = false) {
  const { data: profile, error } = await admin.from('profiles').select('blast_webhook_token').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (forceNew || !profile?.blast_webhook_token) {
    const newToken = generateToken();
    const { error: updErr } = await admin.from('profiles').update({ blast_webhook_token: newToken }).eq('id', userId);
    if (updErr) throw new Error(`Failed to store webhook token: ${updErr.message}`);
    return newToken;
  }
  return profile.blast_webhook_token;
}

function buildResponseShape(origin, token, cfg) {
  return {
    postingUrl:     `${origin}/api/blast/log/${token}`,
    connected:      !!token,
    lastReceivedAt: cfg.lastReceivedAt ?? null,
    blastCount:     cfg.blastCount ?? 0,
  };
}

export async function GET(req) {
  try {
    const auth = await authAndClients(req);
    if (auth.error) return jsonResponse(auth.status, { error: auth.error });
    const { userId, admin } = auth;
    const [token, cfgRow] = await Promise.all([
      ensureToken(admin, userId),
      admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'blast_config_v1').maybeSingle(),
    ]);
    if (cfgRow.error) return jsonResponse(500, { error: `Failed to load config: ${cfgRow.error.message}` });
    return jsonResponse(200, buildResponseShape(originFromRequest(req), token, cfgRow.data?.value ?? {}));
  } catch (e) {
    console.error('[blast/config GET] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}

export async function POST(req) {
  try {
    const auth = await authAndClients(req);
    if (auth.error) return jsonResponse(auth.status, { error: auth.error });
    const { userId, admin } = auth;
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const token = await ensureToken(admin, userId, !!body?.regenerateToken);
    const cfgRow = await admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'blast_config_v1').maybeSingle();
    return jsonResponse(200, buildResponseShape(originFromRequest(req), token, cfgRow.data?.value ?? {}));
  } catch (e) {
    console.error('[blast/config POST] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
