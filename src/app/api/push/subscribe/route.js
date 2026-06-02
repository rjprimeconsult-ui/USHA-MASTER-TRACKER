/**
 * POST   /api/push/subscribe  — store a browser push subscription for the user
 * DELETE /api/push/subscribe  — remove one (by endpoint)
 *
 * Subscriptions live in user_kv under 'push_subscriptions_v1' as an array
 * (one entry per device/browser, deduped by endpoint) so the reminders cron
 * can push to every device the agent enabled. Caller is verified via their
 * Supabase bearer token; the write uses the service-role client.
 */
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEY = 'push_subscriptions_v1';

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

async function getUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { error: 'Missing bearer token' };
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return { error: 'Server not configured' };
  const authClient = createClient(url, anon);
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return { error: 'Invalid session' };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { userId: data.user.id, admin };
}

async function loadSubs(admin, userId) {
  const { data } = await admin.from('user_kv').select('value').eq('user_id', userId).eq('key', KEY).maybeSingle();
  const v = data?.value;
  return Array.isArray(v) ? v : [];
}
async function saveSubs(admin, userId, subs) {
  await admin.from('user_kv').upsert(
    { user_id: userId, key: KEY, value: subs, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,key' }
  );
}

export async function POST(req) {
  const { userId, admin, error } = await getUser(req);
  if (error) return json(401, { error });
  const body = await req.json().catch(() => ({}));
  const sub = body?.subscription;
  if (!sub?.endpoint) return json(400, { error: 'Invalid subscription' });
  const subs = await loadSubs(admin, userId);
  const next = subs.filter(s => s?.endpoint !== sub.endpoint); // dedupe by endpoint
  next.push(sub);
  await saveSubs(admin, userId, next);
  return json(200, { ok: true, count: next.length });
}

export async function DELETE(req) {
  const { userId, admin, error } = await getUser(req);
  if (error) return json(401, { error });
  const body = await req.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  const subs = await loadSubs(admin, userId);
  const next = endpoint ? subs.filter(s => s?.endpoint !== endpoint) : [];
  await saveSubs(admin, userId, next);
  return json(200, { ok: true, count: next.length });
}
