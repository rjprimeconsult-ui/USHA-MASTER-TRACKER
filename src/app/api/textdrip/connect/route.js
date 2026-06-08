/**
 * POST /api/textdrip/connect
 *
 * Body: { apiKey, importTag, defaultStage }
 *
 * Validates the TextDrip API key by calling getAllTags.
 * On success: stores { apiKey } under `textdrip_secret_v1` and
 * { importTag, defaultStage, connected, last4, lastSyncAt } under
 * `textdrip_config_v1` in user_kv (service-role, for the authed user).
 * Returns the config without the raw key.
 *
 * Auth: Supabase bearer token → getUser.
 */

import { createClient } from '@supabase/supabase-js';
import { getAllTags } from '@/lib/textdripServer';

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

export async function POST(req) {
  try {
    // ---- Auth: bearer token → Supabase user ----
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return jsonResponse(401, { error: 'Missing bearer token' });

    const supabaseUrl = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const anonKey    = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return jsonResponse(500, { error: 'Server not configured' });
    }

    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse(401, { error: 'Invalid session' });
    const userId = userData.user.id;

    // ---- Parse body ----
    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
    const { apiKey, importTag, defaultStage } = body || {};
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return jsonResponse(400, { error: 'apiKey is required' });
    }
    if (!importTag || typeof importTag !== 'string' || importTag.trim().length === 0) {
      return jsonResponse(400, { error: 'importTag is required' });
    }
    if (!defaultStage || typeof defaultStage !== 'string') {
      return jsonResponse(400, { error: 'defaultStage is required' });
    }

    // ---- Validate the API key by calling TextDrip ----
    let tags;
    try {
      tags = await getAllTags(apiKey.trim());
    } catch (err) {
      // 401 from TextDrip = bad key; other errors = connectivity/server issue
      if (err?.status === 401) {
        return jsonResponse(400, { error: "Couldn't connect to TextDrip — check your API key." });
      }
      return jsonResponse(502, { error: `TextDrip connection failed: ${err.message}` });
    }
    // getAllTags returning an empty array (not an error) means the key is valid
    void tags;

    // ---- Persist using service-role (to write for specific userId) ----
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const secret = { apiKey: apiKey.trim() };
    const config = {
      importTag: importTag.trim(),
      defaultStage,
      connected: true,
      last4: apiKey.trim().slice(-4),
      lastSyncAt: null,
    };

    // Upsert secret
    const { error: secretErr } = await admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'textdrip_secret_v1', value: secret, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );
    if (secretErr) return jsonResponse(500, { error: `Failed to save secret: ${secretErr.message}` });

    // Upsert config
    const { error: configErr } = await admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'textdrip_config_v1', value: config, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );
    if (configErr) return jsonResponse(500, { error: `Failed to save config: ${configErr.message}` });

    console.log(`[textdrip/connect] user=${userId} connected last4=${config.last4} tag="${config.importTag}"`);

    // Return config — NEVER the raw key
    return jsonResponse(200, { ...config });
  } catch (e) {
    console.error('[textdrip/connect] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
