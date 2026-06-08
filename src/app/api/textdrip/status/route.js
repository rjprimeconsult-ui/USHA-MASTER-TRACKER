/**
 * GET /api/textdrip/status
 *
 * Returns the user's TextDrip config (connected, last4, importTag,
 * defaultStage, lastSyncAt), or { connected: false } if not set.
 *
 * NEVER returns the raw API key.
 *
 * Auth: Supabase bearer token → getUser.
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

export async function GET(req) {
  try {
    // ---- Auth ----
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

    // ---- Fetch config using service-role ----
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: row, error } = await admin
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'textdrip_config_v1')
      .maybeSingle();

    if (error) return jsonResponse(500, { error: `Failed to read config: ${error.message}` });

    const config = row?.value;
    if (!config || !config.connected) {
      return jsonResponse(200, { connected: false });
    }

    // Return config — NEVER the raw key
    return jsonResponse(200, {
      connected: config.connected,
      last4: config.last4,
      importTag: config.importTag,
      defaultStage: config.defaultStage,
      lastSyncAt: config.lastSyncAt ?? null,
    });
  } catch (e) {
    console.error('[textdrip/status] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
