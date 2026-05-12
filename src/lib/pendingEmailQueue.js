/**
 * Pending email queue — agent-side "grace window before auto-send."
 *
 * When a lead's stage flips to a value matched by an auto-send template,
 * we DON'T fire the email immediately. Instead we enqueue it with a
 * scheduled fire time (now + GRACE_MS), surface a countdown toast with
 * a Cancel button, and only fire once the grace expires.
 *
 * Why a queue instead of a setTimeout?
 *   1. Persists across page reloads. If the agent closes the tab mid-grace,
 *      the queue picks back up on next load.
 *   2. Survives mid-grace edits to the lead — at fire time we re-read the
 *      lead from current state, so any field changes the agent made get
 *      included in the rendered email.
 *   3. Cancelable from anywhere via leadId (toast Cancel + lead deletion
 *      cleanup both call the same cancel path).
 *
 * Stored under `pending_email_queue_v1`. Shape:
 *   { items: [{ id, leadId, templateId, scheduledAt, enqueuedAt, status }] }
 * status: 'pending' | 'firing' | 'sent' | 'failed' | 'canceled'
 */

import { storage } from './storage';

export const QUEUE_KEY = 'pending_email_queue_v1';
export const GRACE_MS = 5 * 60 * 1000; // 5 minutes — matches the UX promise

function newQueueItemId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function loadQueue() {
  try {
    const raw = await storage.getItem(QUEUE_KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw);
    return { items: Array.isArray(parsed?.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

export async function saveQueue(q) {
  const safe = { items: Array.isArray(q?.items) ? q.items : [] };
  await storage.setItem(QUEUE_KEY, JSON.stringify(safe));
  return safe;
}

/**
 * Enqueue a pending auto-send. Returns the new item.
 *
 * If there's already a pending item for the same leadId + templateId, we
 * REPLACE it (so flipping stage twice rapidly doesn't enqueue two sends —
 * the second event just resets the timer).
 */
export async function enqueuePending({ leadId, templateId, customGraceMs }) {
  const q = await loadQueue();
  const filtered = q.items.filter(
    it => !(it.leadId === leadId && it.templateId === templateId && it.status === 'pending')
  );
  const now = Date.now();
  const item = {
    id: newQueueItemId(),
    leadId,
    templateId,
    enqueuedAt: now,
    scheduledAt: now + (customGraceMs || GRACE_MS),
    status: 'pending',
  };
  const next = { items: [...filtered, item] };
  await saveQueue(next);
  return item;
}

/**
 * Cancel a pending send. Looks up by item id OR by leadId+templateId.
 * Idempotent — calling on an already-canceled / fired item is a no-op.
 */
export async function cancelPending({ id, leadId, templateId }) {
  const q = await loadQueue();
  const next = {
    items: q.items.map(it => {
      const match = id
        ? it.id === id
        : leadId && templateId
          ? it.leadId === leadId && it.templateId === templateId && it.status === 'pending'
          : false;
      if (!match) return it;
      return { ...it, status: 'canceled', canceledAt: Date.now() };
    }),
  };
  await saveQueue(next);
}

/**
 * Cancel every pending send for a given lead. Called when a lead is
 * deleted so we never fire emails for ghost leads, and when a lead's
 * stage flips AGAIN to a different trigger (we cancel the previous one,
 * then enqueue the new one — handled by enqueuePending's dedup logic).
 */
export async function cancelAllForLead(leadId) {
  if (!leadId) return;
  const q = await loadQueue();
  let touched = false;
  const next = {
    items: q.items.map(it => {
      if (it.leadId === leadId && it.status === 'pending') {
        touched = true;
        return { ...it, status: 'canceled', canceledAt: Date.now() };
      }
      return it;
    }),
  };
  if (touched) await saveQueue(next);
}

/**
 * Mark an item as fired (success or failure) so it stops appearing in
 * "due to fire" lookups. Keeps the row around for a short while for
 * audit. Caller can later run prune to drop completed items.
 */
export async function markFired(id, { status = 'sent', error, messageId } = {}) {
  const q = await loadQueue();
  const next = {
    items: q.items.map(it => it.id === id
      ? { ...it, status, firedAt: Date.now(), error: error || undefined, messageId: messageId || undefined }
      : it
    ),
  };
  await saveQueue(next);
}

/**
 * Prune fired / canceled items older than `maxAgeMs` to keep storage tidy.
 */
export async function pruneCompleted({ maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const q = await loadQueue();
  const now = Date.now();
  const next = {
    items: q.items.filter(it => {
      if (it.status === 'pending') return true;
      const completedAt = it.firedAt || it.canceledAt || it.enqueuedAt;
      return (now - completedAt) < maxAgeMs;
    }),
  };
  await saveQueue(next);
}

/**
 * Pure helpers (no storage I/O) — for callers that already hold the queue.
 */
export function isDue(item, now = Date.now()) {
  return item.status === 'pending' && item.scheduledAt <= now;
}

export function isPending(item) {
  return item.status === 'pending';
}

export function msUntilFire(item, now = Date.now()) {
  return Math.max(0, item.scheduledAt - now);
}

export function findPendingForLead(items, leadId) {
  return items.filter(it => it.status === 'pending' && it.leadId === leadId);
}
