/**
 * POST /api/email/webhook
 *
 * Receives Resend webhook events (email.delivered, email.opened,
 * email.clicked, email.bounced, email.complained) and updates the
 * corresponding lead's emailLog entry with timestamps so the audit
 * panel can show real status badges.
 *
 * Identity bridge: when /api/email/send fires a message, it tags the
 * Resend record with user_id + lead_id (see route.js → tags array).
 * The webhook reads those tags back to find the right lead.
 *
 * Storage: leads live in user_kv under key 'leads_v5'. We do a read-
 * modify-write on the JSON blob — small enough that this is cheap and
 * race-tolerant for a single user's traffic.
 *
 * Signature verification: Resend signs webhook payloads with HMAC-SHA256
 * using the secret you set in their dashboard. We verify with the
 * shared secret from RESEND_WEBHOOK_SECRET. Unsigned / mismatched
 * requests are rejected before any DB work.
 */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Resend signs webhooks via the Svix protocol: headers svix-id,
// svix-timestamp, svix-signature. Their signing secret starts with
// "whsec_" — we strip that prefix and use the rest as the HMAC key.
function verifySignature(rawBody, headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: 'no secret configured' };
  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing svix headers' };
  }
  // Reject if timestamp drifts too far — replay-attack guard.
  const tsMs = Number(svixTimestamp) * 1000;
  if (!isFinite(tsMs)) return { ok: false, reason: 'bad timestamp' };
  const now = Date.now();
  if (Math.abs(now - tsMs) > 5 * 60 * 1000) {
    return { ok: false, reason: 'timestamp out of range' };
  }
  const signingKey = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let key;
  try { key = Buffer.from(signingKey, 'base64'); } catch { return { ok: false, reason: 'bad secret encoding' }; }
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
  // Header may contain multiple signatures like "v1,abc... v1,def..."
  const candidates = svixSignature
    .split(' ')
    .map(s => s.split(',')[1])
    .filter(Boolean);
  const matched = candidates.some(c => safeEqual(c, expected));
  return matched ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

function safeEqual(a, b) {
  try {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

// Resend's webhook payload shapes vary slightly by event type, but the
// `tags` array is consistently present on every send-triggered event.
function tagValue(tags, name) {
  if (!Array.isArray(tags)) return null;
  const t = tags.find(t => t?.name === name);
  return t?.value || null;
}

// Map Resend event type → field name on our emailLog entry.
const EVENT_FIELD = {
  'email.delivered': 'deliveredAt',
  'email.opened':    'openedAt',
  'email.clicked':   'clickedAt',
  'email.bounced':   'bouncedAt',
  'email.complained': 'complainedAt',
  'email.delivery_delayed': null, // ignored
  'email.failed':    'failedAt',
};

export async function POST(req) {
  let rawBody;
  try {
    rawBody = await req.text();
  } catch {
    return Response.json({ error: 'unreadable body' }, { status: 400 });
  }

  // Signature check first — fail closed.
  const sig = verifySignature(rawBody, req.headers);
  if (!sig.ok) {
    // Don't echo the reason back to attackers; log it server-side instead.
    console.warn('[email/webhook] signature rejected:', sig.reason);
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const type = event?.type;
  const data = event?.data || {};
  const messageId = data.email_id || data.id;
  const tags = data.tags || [];
  const userId     = tagValue(tags, 'user_id');
  const leadId     = tagValue(tags, 'lead_id');
  const prospectId = tagValue(tags, 'prospect_id');

  if (!type || !EVENT_FIELD[type]) {
    return Response.json({ ok: true, ignored: true, reason: 'unknown event type' });
  }
  const field = EVENT_FIELD[type];
  if (field === null) {
    return Response.json({ ok: true, ignored: true, reason: 'event type intentionally skipped' });
  }
  if (!messageId || !userId || (!leadId && !prospectId)) {
    console.warn('[email/webhook] missing identifiers — type=', type, 'mid=', messageId, 'uid=', userId, 'lid=', leadId, 'pid=', prospectId);
    return Response.json({ ok: true, ignored: true, reason: 'missing identifiers' });
  }

  const supabase = getServiceClient();
  if (!supabase) return Response.json({ error: 'server not configured' }, { status: 503 });

  // Determine which store to update: lead-tagged events update leads_v5,
  // prospect-tagged events update prospects_v1. The shape of each row is
  // different but the emailLog array on it works identically.
  const storeKey = prospectId ? 'prospects_v1' : 'leads_v5';
  const targetId = prospectId || leadId;
  const idLabel  = prospectId ? 'prospectId' : 'leadId';

  const { data: kvRow, error: readErr } = await supabase
    .from('user_kv')
    .select('value')
    .eq('user_id', userId)
    .eq('key', storeKey)
    .maybeSingle();
  if (readErr) {
    console.error('[email/webhook] user_kv read failed:', readErr);
    return Response.json({ error: 'storage read failed' }, { status: 500 });
  }
  if (!kvRow?.value) {
    return Response.json({ ok: true, ignored: true, reason: `no ${storeKey} stored for user` });
  }

  let arr = kvRow.value;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { arr = null; }
  }
  if (!Array.isArray(arr)) {
    return Response.json({ ok: true, ignored: true, reason: `${storeKey} not an array` });
  }

  const eventAt = data.created_at ? new Date(data.created_at).toISOString() : new Date().toISOString();
  let touched = false;

  const next = arr.map(row => {
    if (row?.id !== targetId) return row;
    const log = Array.isArray(row.emailLog) ? row.emailLog : [];
    const nextLog = log.map(entry => {
      if (entry?.messageId !== messageId) return entry;
      // Idempotent — re-delivery of the same event doesn't move the
      // timestamp around. (Resend retries on 5xx so we'll see dupes.)
      if (entry[field]) return entry;
      touched = true;
      return { ...entry, [field]: eventAt };
    });
    return touched ? { ...row, emailLog: nextLog } : row;
  });

  if (!touched) {
    return Response.json({ ok: true, ignored: true, reason: 'no matching emailLog entry (or already recorded)' });
  }

  const { error: writeErr } = await supabase
    .from('user_kv')
    .upsert(
      { user_id: userId, key: storeKey, value: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  if (writeErr) {
    console.error('[email/webhook] user_kv write failed:', writeErr);
    return Response.json({ error: 'storage write failed' }, { status: 500 });
  }

  console.log(`[email/webhook] ${type} → userId=${userId} ${idLabel}=${targetId} mid=${messageId} field=${field}`);
  return Response.json({ ok: true, type, field, messageId });
}
