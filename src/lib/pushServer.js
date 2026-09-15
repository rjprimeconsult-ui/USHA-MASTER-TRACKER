/**
 * Server-side web push for the routine tick (spec §6b.6). Derived from
 * src/app/api/reminders/route.js:26-55 and :379-386 — that route is NOT edited.
 * Unlike the reminders helper this one RETURNS every failure so the tick can
 * stamp the ledger; it never swallows an error.
 */
import webpush from 'web-push';

const PUSH_KEY = 'push_subscriptions_v1';
let ready = false;

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function init() {
  if (ready) return true;
  if (!pushConfigured()) return false;
  try {
    webpush.setVapidDetails('mailto:rjprimeconsult@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    ready = true;
  } catch (e) {
    console.warn('[pushServer] VAPID setup failed:', e?.message);
    return false;
  }
  return true;
}

// → { sentCount, dead: [endpoint], failures: [{ endpoint, statusCode, message }] }
export async function sendPushAll(subs, payload) {
  if (!init() || !Array.isArray(subs) || subs.length === 0) return { sentCount: 0, dead: [], failures: [] };
  const body = JSON.stringify(payload);
  let sentCount = 0;
  const dead = [];
  const failures = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, body);
      sentCount++;
    } catch (e) {
      const statusCode = e?.statusCode ?? null;
      if (statusCode === 404 || statusCode === 410) dead.push(sub.endpoint);
      else failures.push({ endpoint: sub.endpoint, statusCode, message: String(e?.message || e) });
    }
  }));
  return { sentCount, dead, failures };
}

// Re-selects the row before writing so a device added since the tick's read
// is never dropped. → { ok, error? }
export async function pruneDeadSubs(supa, userId, dead) {
  if (!Array.isArray(dead) || dead.length === 0) return { ok: true };
  const { data, error } = await supa.from('user_kv').select('value').eq('user_id', userId).eq('key', PUSH_KEY).maybeSingle();
  if (error) return { ok: false, error };
  // Legacy rows may be JSON strings (§4). Never write back from a value that
  // did not parse to an array — that would wipe every device's subscription.
  let current = data?.value;
  if (typeof current === 'string') { try { current = JSON.parse(current); } catch { current = null; } }
  if (!Array.isArray(current)) return { ok: false, error: new Error('bad_shape') };
  const alive = current.filter((s) => !dead.includes(s?.endpoint));
  const { error: e2 } = await supa.from('user_kv').upsert(
    { user_id: userId, key: PUSH_KEY, value: alive, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,key' }
  );
  if (e2) return { ok: false, error: e2 };
  return { ok: true };
}
