/**
 * GET /api/ringy/config  — load the caller's Ringy config; generates a
 *                          webhook token on first call if none exists.
 * POST /api/ringy/config — save { mapping, defaultStage, regenerateToken? }.
 *
 * Auth: bearer token → getUser (anon client).
 * Storage: service-role for profiles (ringy_webhook_token) + user_kv
 *          (ringy_config_v1).
 *
 * SECURITY: never expose another user's token; all queries scoped to userId.
 */

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cleanEnv(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

/** Generate a ~32-char URL-safe random token. */
function generateToken() {
  // Two UUIDs joined, dashes stripped → 64 hex chars; take first 32.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '').slice(0, 32);
  }
  // Fallback (should never hit in Node 18+)
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** Derive the public origin from the incoming request. */
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
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return { error: 'Server not configured', status: 500 };
  }

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData?.user) return { error: 'Invalid session', status: 401 };

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  return { userId: userData.user.id, admin };
}

/** Ensure ringy_webhook_token exists on profiles; generate one if missing. */
async function ensureToken(admin, userId, forceNew = false) {
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('ringy_webhook_token')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr) throw new Error(`Failed to load profile: ${profileErr.message}`);

  if (forceNew || !profile?.ringy_webhook_token) {
    const newToken = generateToken();
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ ringy_webhook_token: newToken })
      .eq('id', userId);
    if (updateErr) throw new Error(`Failed to store webhook token: ${updateErr.message}`);
    return newToken;
  }
  return profile.ringy_webhook_token;
}

/** Build the response shape shared by GET and POST. */
function buildResponseShape(origin, token, cfg) {
  return {
    webhookUrl:     `${origin}/api/ringy/webhook/${token}`,
    mapping:        cfg.mapping        ?? [],
    defaultStage:   cfg.defaultStage   ?? '',
    connected:      !!token,
    lastReceivedAt: cfg.lastReceivedAt ?? null,
    importedCount:  cfg.importedCount  ?? 0,
    // Native blast/repurpose capture: on by default; patterns add to the
    // built-in defaults (they never need to re-type the known tag).
    blastDetectionEnabled:    cfg.blastDetectionEnabled !== false,
    blastDispositionPatterns: Array.isArray(cfg.blastDispositionPatterns) ? cfg.blastDispositionPatterns : [],
  };
}

// ---- GET ----

export async function GET(req) {
  try {
    const auth = await authAndClients(req);
    if (auth.error) return jsonResponse(auth.status, { error: auth.error });
    const { userId, admin } = auth;

    const [token, cfgRow] = await Promise.all([
      ensureToken(admin, userId),
      admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'ringy_config_v1').maybeSingle(),
    ]);

    if (cfgRow.error) return jsonResponse(500, { error: `Failed to load config: ${cfgRow.error.message}` });

    const cfg    = cfgRow.data?.value ?? {};
    const origin = originFromRequest(req);

    return jsonResponse(200, buildResponseShape(origin, token, cfg));
  } catch (e) {
    console.error('[ringy/config GET] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}

// ---- POST ----

export async function POST(req) {
  try {
    const auth = await authAndClients(req);
    if (auth.error) return jsonResponse(auth.status, { error: auth.error });
    const { userId, admin } = auth;

    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
    const { mapping, defaultStage, regenerateToken, blastDetectionEnabled, blastDispositionPatterns } = body || {};

    const now = new Date().toISOString();

    // Load current config first (to preserve lastReceivedAt / importedCount)
    const { data: cfgRow, error: cfgErr } = await admin
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'ringy_config_v1')
      .maybeSingle();
    if (cfgErr) return jsonResponse(500, { error: `Failed to load config: ${cfgErr.message}` });

    const existingCfg = cfgRow?.value ?? {};

    // Ensure / rotate token
    const token = await ensureToken(admin, userId, !!regenerateToken);

    const updatedCfg = {
      ...existingCfg,
      mapping:      Array.isArray(mapping)      ? mapping      : existingCfg.mapping      ?? [],
      defaultStage: typeof defaultStage === 'string' ? defaultStage : existingCfg.defaultStage ?? '',
      blastDetectionEnabled:
        typeof blastDetectionEnabled === 'boolean' ? blastDetectionEnabled
        : (existingCfg.blastDetectionEnabled !== false),
      blastDispositionPatterns:
        Array.isArray(blastDispositionPatterns)
          ? blastDispositionPatterns.map(s => String(s || '').trim()).filter(Boolean)
          : (Array.isArray(existingCfg.blastDispositionPatterns) ? existingCfg.blastDispositionPatterns : []),
    };

    const { error: saveErr } = await admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'ringy_config_v1', value: updatedCfg, updated_at: now },
        { onConflict: 'user_id,key' }
      );
    if (saveErr) return jsonResponse(500, { error: `Failed to save config: ${saveErr.message}` });

    console.log(`[ringy/config POST] user=${userId} mapping_rows=${updatedCfg.mapping.length} regenerated=${!!regenerateToken}`);

    const origin = originFromRequest(req);
    return jsonResponse(200, buildResponseShape(origin, token, updatedCfg));
  } catch (e) {
    console.error('[ringy/config POST] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
