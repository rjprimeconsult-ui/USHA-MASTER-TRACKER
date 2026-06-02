/**
 * POST /api/admin/broadcast
 *
 * Lets a PRIM admin push a message to the team Slack channel on demand —
 * "new feature is live, refresh", "bug X is fixed", etc. Admin-gated the
 * same way as the impersonate endpoint (caller's profile.is_admin must be
 * true). Posts via the SLACK_WEBHOOK_URL incoming webhook.
 *
 * Body: { title: string, message?: string, emoji?: string }
 * Returns: { ok } on success, or { error } with a helpful reason.
 */

import { createClient } from '@supabase/supabase-js';
import { postToSlack, announcementBlocks, slackConfigured } from '@/lib/slack';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

const cleanEnv = (s) => String(s || '').trim().replace(/^['"]|['"]$/g, '');

export async function POST(req) {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return json(500, { error: 'Server not configured (Supabase)' });

  // 1. Verify caller + admin role
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return json(401, { error: 'Missing bearer token' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userResp, error: userErr } = await admin.auth.getUser(match[1]);
  if (userErr || !userResp?.user) return json(401, { error: 'Invalid session' });

  const { data: profile } = await admin
    .from('profiles').select('is_admin').eq('id', userResp.user.id).single();
  if (!profile?.is_admin) return json(401, { error: 'Admin role required' });

  // 2. Validate input
  if (!slackConfigured()) {
    return json(503, { error: 'Slack is not connected yet. Add SLACK_WEBHOOK_URL in Vercel and redeploy.' });
  }
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const title = String(body?.title || '').trim();
  const message = String(body?.message || '').trim();
  const emoji = String(body?.emoji || '📣').trim() || '📣';
  if (!title) return json(400, { error: 'A title is required' });

  // 3. Post to Slack
  const result = await postToSlack({
    text: `${emoji} ${title}${message ? ` — ${message}` : ''}`,
    blocks: announcementBlocks({ emoji, title, body: message, url: 'https://www.primtracker.com' }),
  });
  if (!result.ok) {
    return json(502, { error: `Slack post failed (${result.reason}${result.detail ? `: ${result.detail}` : ''})` });
  }

  console.log(`[broadcast] admin=${userResp.user.email} title="${title}"`);
  return json(200, { ok: true });
}
