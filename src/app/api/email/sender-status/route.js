/**
 * GET /api/email/sender-status
 *
 * Per-agent sender-identity status for the UI (spec §9 —
 * docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md).
 * The browser must never hold the Resend key, so domain status is read
 * here server-side and reflected to Profile → Sender.
 *
 * Reads the CALLER's own identity only — auth via requireUserId, and the
 * user id comes from the verified session, never from the request.
 *
 * Response:
 *   200 { fromAddress, domain, domainStatus: 'verified'|'unverified'|'unknown',
 *         missing:  { 'post-sale': string[], outreach: string[] },
 *         complete: { 'post-sale': boolean, outreach: boolean } }
 *   401 unauthenticated
 *   503 identity read threw (transient — Supabase blip)
 *
 * `missing` comes from senderGate.missingFields() PER KIND (npn is
 * outreach-only) — the same function the send gate's evaluate() derives
 * from, so this route and the send path cannot disagree by construction.
 * Domain status is informational routing state (own vs shared lane, spec
 * §5); it is never a "missing" entry and never blocks a send.
 */

import { createClient } from '@supabase/supabase-js';
import { requireUserId } from '@/lib/apiAuth';
import { sanitizeSenderIdentity, missingFields } from '@/lib/senderGate.mjs';
import { listVerifiedDomains, domainStatusFor } from '@/lib/resendDomains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(req) {
  const auth = await requireUserId(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const supabase = getServiceClient();
  if (!supabase) return Response.json({ error: 'server not configured' }, { status: 503 });

  // Same reader shape as the send route (spec §3.1 whitelist #3):
  // sanitizeSenderIdentity is THE projection — an absent row is just an
  // empty identity whose missing lists name every required field.
  // supabase-js resolves with { data, error } — it never rejects on a
  // query failure, so `error` must be checked explicitly (same defect
  // class as the send route's reader; both fixed after the Task-12
  // review). A corrupt stored string degrades to an empty identity —
  // every field reads missing, which is what the UI should show.
  let identity;
  const { data: idRow, error: idErr } = await supabase
    .from('user_kv')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'email_sender_identity_v1')
    .maybeSingle();
  if (idErr) {
    console.warn('[email/sender-status] identity read failed:', idErr.message || idErr);
    return Response.json(
      { error: 'Could not load your sender settings — please try again shortly.' },
      { status: 503 }
    );
  }
  try {
    const raw = !idRow?.value
      ? {}
      : (typeof idRow.value === 'string' ? JSON.parse(idRow.value) : idRow.value);
    identity = sanitizeSenderIdentity(raw);
  } catch {
    identity = sanitizeSenderIdentity({});
  }

  const missing = {
    'post-sale': missingFields(identity, 'post-sale'),
    outreach: missingFields(identity, 'outreach'),
  };

  const fromAddress = identity.fromAddress;
  const domain = String(fromAddress || '').split('@')[1]?.trim().toLowerCase() || '';
  const domainStatus = domainStatusFor(fromAddress, await listVerifiedDomains());

  return Response.json({
    fromAddress,
    domain,
    domainStatus,
    missing,
    complete: {
      'post-sale': missing['post-sale'].length === 0,
      outreach: missing.outreach.length === 0,
    },
  });
}
