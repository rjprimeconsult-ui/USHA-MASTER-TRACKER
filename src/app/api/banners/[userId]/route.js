/**
 * GET /api/banners/[userId]
 *
 * Serves the agent's profile banner image as a real HTTP-accessible
 * resource. Backing store is the `agent_profile_v1` user_kv row,
 * where the banner is saved as a base64 data URL by the Profile -> Appearance
 * upload flow.
 *
 * Why this endpoint exists:
 *   Email clients (Gmail in particular) strip data: URLs in <img> /
 *   background-image rules as a security precaution. To make the
 *   agent's banner appear in post-sale emails to customers, we need
 *   a real https:// URL. This endpoint decodes the stored data URL
 *   and serves the raw image bytes with the correct Content-Type.
 *
 * Why no auth:
 *   Banners are intended to appear in customer-facing emails — they
 *   are public by design. The user ID in the URL is enough to address
 *   the banner; we don't expose anything else through this route.
 *
 * Caching:
 *   `public, max-age=86400, s-maxage=86400` — banners change rarely.
 *   When an agent re-uploads, the new banner replaces the old one in
 *   user_kv but the public URL is the same; CDN cache flushes within
 *   24h naturally. Agents who want the new banner immediately can
 *   bust the cache with a `?v=...` query param when constructing
 *   the URL (see postSaleHtml.js).
 */

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Map data-URL media-type strings to safe response Content-Types.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function GET(req, { params }) {
  const { userId } = (await params) || {};
  if (!userId || typeof userId !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return new Response('Server not configured', { status: 503 });
  }

  // Read the agent's profile from user_kv. supabase-js auto-parses JSONB.
  const { data, error } = await supabase
    .from('user_kv')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'agent_profile_v1')
    .maybeSingle();
  if (error) {
    console.error('[api/banners] read failed:', error.message);
    return new Response('Not found', { status: 404 });
  }
  let profile = data?.value;
  if (typeof profile === 'string') {
    try { profile = JSON.parse(profile); } catch { profile = null; }
  }
  const dataUrl = profile?.bannerUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return new Response('No banner', { status: 404 });
  }

  // Parse data URL: `data:image/jpeg;base64,XXXXX`
  const m = dataUrl.match(/^data:([a-zA-Z0-9+/-]+);base64,(.+)$/);
  if (!m) {
    return new Response('Malformed banner', { status: 422 });
  }
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return new Response('Unsupported image type', { status: 415 });
  }

  // Decode and return as a real binary response.
  let buffer;
  try {
    buffer = Buffer.from(m[2], 'base64');
  } catch {
    return new Response('Decode failed', { status: 422 });
  }

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
