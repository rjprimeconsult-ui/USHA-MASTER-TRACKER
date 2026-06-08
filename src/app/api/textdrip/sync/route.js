/**
 * POST /api/textdrip/sync
 *
 * Loads the user's TextDrip API key + config, runs the import scan,
 * updates lastSyncAt in config, and returns normalised contact data
 * for the client to upsert/dedup.
 *
 * Returns: { contacts, scanned, pagesScanned, matchedTag }
 * The client handles all upsert/dedup/review logic.
 *
 * Auth: Supabase bearer token → getUser.
 * maxDuration = 300s (first-sync scan pages TextDrip's API sequentially).
 *
 * SECURITY: No PHI (names, message bodies) is ever logged here.
 */

import { createClient } from '@supabase/supabase-js';
import { runImportScan } from '@/lib/textdripServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

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

    // ---- Load secret + config ----
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const [{ data: secretRow, error: secretErr }, { data: configRow, error: configErr }] = await Promise.all([
      admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'textdrip_secret_v1').maybeSingle(),
      admin.from('user_kv').select('value').eq('user_id', userId).eq('key', 'textdrip_config_v1').maybeSingle(),
    ]);

    if (secretErr) return jsonResponse(500, { error: `Failed to load secret: ${secretErr.message}` });
    if (configErr) return jsonResponse(500, { error: `Failed to load config: ${configErr.message}` });

    const apiKey = secretRow?.value?.apiKey;
    const config = configRow?.value;

    if (!apiKey || !config?.connected) {
      return jsonResponse(400, { error: 'TextDrip is not connected. Please connect in Settings first.' });
    }
    if (!config.importTag) {
      return jsonResponse(400, { error: 'No import tag configured. Please finish setup in Settings.' });
    }
    if (!config.defaultStage) {
      return jsonResponse(400, { error: 'No default stage configured. Please finish setup in Settings.' });
    }

    // ---- Run the import scan ----
    let result;
    try {
      result = await runImportScan(apiKey, config.importTag, config.lastSyncAt ?? null);
    } catch (err) {
      return jsonResponse(502, { error: `TextDrip sync failed: ${err.message}` });
    }

    // ---- Update lastSyncAt in config ----
    const now = new Date().toISOString();
    const newLastSyncAt = result.lastMessageAtMax || now;
    const updatedConfig = { ...config, lastSyncAt: newLastSyncAt };

    const { error: updateErr } = await admin
      .from('user_kv')
      .upsert(
        { user_id: userId, key: 'textdrip_config_v1', value: updatedConfig, updated_at: now },
        { onConflict: 'user_id,key' }
      );
    if (updateErr) {
      // Non-fatal — log and continue; contacts are still returned
      console.warn(`[textdrip/sync] failed to update lastSyncAt for user=${userId}: ${updateErr.message}`);
    }

    // Log aggregate counts only — no PHI
    console.log(
      `[textdrip/sync] user=${userId} scanned=${result.scanned} pages=${result.pagesScanned} ` +
      `matched=${result.contacts.length} tag="${config.importTag}"`
    );

    return jsonResponse(200, {
      contacts: result.contacts,
      scanned: result.scanned,
      pagesScanned: result.pagesScanned,
      matchedTag: config.importTag,
    });
  } catch (e) {
    console.error('[textdrip/sync] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
