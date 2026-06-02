'use client';
/**
 * Browser push (web push) client helpers.
 *
 * Flow: register the service worker → ask permission → subscribe with the
 * VAPID public key → POST the subscription to /api/push/subscribe (stored
 * server-side under the user's row so the reminders cron can push to them).
 *
 * Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY in the environment. If it's not set,
 * pushSupported() returns false so the UI can hide the toggle gracefully.
 */
import { supabase } from './supabase';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && !!VAPID_PUBLIC;
}

export function pushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

// VAPID public key (base64url) → Uint8Array for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function authToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

/**
 * Turn ON browser push. Returns { ok, reason }.
 * reason ∈ 'unsupported' | 'denied' | 'no-token' | 'error' | null(success)
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }

  const token = await authToken();
  if (!token) return { ok: false, reason: 'no-token' };

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub }),
  });
  if (!res.ok) return { ok: false, reason: 'error' };
  return { ok: true, reason: null };
}

/** Turn OFF browser push (unsubscribe locally + tell the server to drop it). */
export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      const token = await authToken();
      if (token) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Fire a test push to this user's subscribed devices. Returns { ok, sent, error }. */
export async function sendTestPush() {
  const token = await authToken();
  if (!token) return { ok: false, error: 'Not signed in' };
  try {
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, sent: data.sent ?? 0 };
  } catch (e) {
    return { ok: false, error: e?.message || 'Request failed' };
  }
}

/** Is this browser currently subscribed? */
export async function isPushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = reg && await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}
