/**
 * POST /api/textdrip/disconnect
 *
 * Clears both `textdrip_secret_v1` and `textdrip_config_v1` from user_kv
 * for the authenticated user.  Returns { connected: false }.
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

export async function POST(req) {
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

    // ---- Delete both kv rows using service-role ----
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const [secretResult, configResult] = await Promise.all([
      admin.from('user_kv').delete().eq('user_id', userId).eq('key', 'textdrip_secret_v1'),
      admin.from('user_kv').delete().eq('user_id', userId).eq('key', 'textdrip_config_v1'),
    ]);

    if (secretResult.error) {
      console.warn(`[textdrip/disconnect] secret delete failed for user=${userId}: ${secretResult.error.message}`);
    }
    if (configResult.error) {
      console.warn(`[textdrip/disconnect] config delete failed for user=${userId}: ${configResult.error.message}`);
    }

    console.log(`[textdrip/disconnect] user=${userId} disconnected`);
    return jsonResponse(200, { connected: false });
  } catch (e) {
    console.error('[textdrip/disconnect] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
