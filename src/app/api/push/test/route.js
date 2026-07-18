/**
 * POST /api/push/test — send a one-off test push to the caller's own
 * subscribed devices. Lets an agent (or admin) verify push is working
 * without waiting for the daily cron. Verified via the caller's Supabase
 * token; sends with the server VAPID keys.
 */
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { appUrl } from '@/lib/appUrl.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KEY = 'push_subscriptions_v1';

let pushReady = false;
try {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) { webpush.setVapidDetails('mailto:rjprimeconsult@gmail.com', pub, priv); pushReady = true; }
} catch { /* ignore */ }

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(req) {
  if (!pushReady) return json(503, { error: 'Push not configured (VAPID keys missing on the server). Add them in Vercel and redeploy.' });

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(401, { error: 'Missing bearer token' });

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return json(500, { error: 'Server not configured' });

  const authClient = createClient(url, anon);
  const { data: u, error: uerr } = await authClient.auth.getUser(token);
  if (uerr || !u?.user) return json(401, { error: 'Invalid session' });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data } = await admin.from('user_kv').select('value').eq('user_id', u.user.id).eq('key', KEY).maybeSingle();
  const subs = Array.isArray(data?.value) ? data.value : [];
  if (subs.length === 0) return json(400, { error: 'No subscribed devices. Turn on notifications first, then test.' });

  const payload = JSON.stringify({
    title: 'PRIM — test notification',
    body: '🔔 Push is working! You\'ll get alerts here for payments drafting, follow-ups, and your weekly snapshot.',
    url: appUrl(),
  });

  let sent = 0;
  const dead = [];
  await Promise.all(subs.map(async (sub) => {
    try { await webpush.sendNotification(sub, payload); sent++; }
    catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(sub.endpoint); }
  }));

  if (dead.length) {
    const alive = subs.filter(s => !dead.includes(s.endpoint));
    await admin.from('user_kv').upsert(
      { user_id: u.user.id, key: KEY, value: alive, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  }

  return json(200, { ok: true, sent, devices: subs.length, pruned: dead.length });
}
