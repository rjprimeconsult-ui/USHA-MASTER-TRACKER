/**
 * POST /api/admin/tickets/[id] — admin updates a ticket's status/notes/resolution.
 *
 * Admin-gated the same way as broadcast/impersonate (caller's profiles.is_admin
 * must be true). This is the ONLY write path to a ticket (there is no client
 * UPDATE RLS policy). On status → 'resolved', emails the submitting agent the
 * PHI-safe resolution note (best-effort).
 *
 * Body: { status?, admin_notes?, resolution? }
 */
import { createClient } from '@supabase/supabase-js';
import { buildResolutionEmail } from '@/lib/tickets.mjs';
import { sendTicketEmail } from '@/lib/ticketEmails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const cleanEnv = (s) => String(s || '').trim().replace(/^['"]|['"]$/g, '');
const STATUSES = new Set(['new', 'in_progress', 'resolved']);

export async function POST(req, ctx) {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return json(500, { error: 'Server not configured' });

  // Admin gate (same as broadcast/route.js).
  const authHeader = req.headers.get('authorization') || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return json(401, { error: 'Missing bearer token' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userResp, error: userErr } = await admin.auth.getUser(m[1]);
  if (userErr || !userResp?.user) return json(401, { error: 'Invalid session' });
  const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', userResp.user.id).single();
  if (!profile?.is_admin) return json(401, { error: 'Admin role required' });

  // Next 16: dynamic-route params are async — MUST await.
  const { id } = await ctx.params;
  const ticketId = parseInt(id, 10);
  if (!Number.isFinite(ticketId)) return json(400, { error: 'Bad ticket id' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }

  const patch = {};
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return json(400, { error: 'Invalid status' });
    patch.status = body.status;
    if (body.status === 'resolved') patch.resolved_at = new Date().toISOString();
  }
  if (body.admin_notes !== undefined) patch.admin_notes = String(body.admin_notes || '').slice(0, 8000);
  if (body.resolution !== undefined) patch.resolution = String(body.resolution || '').slice(0, 4000);
  if (Object.keys(patch).length === 0) return json(400, { error: 'Nothing to update' });

  const { data: row, error: updErr } = await admin
    .from('tickets').update(patch).eq('id', ticketId)
    .select('id, email, resolution, status').single();
  if (updErr || !row) return json(500, { error: `Update failed: ${updErr?.message || 'not found'}` });

  // On resolve → email the agent the resolution note (best-effort).
  if (patch.status === 'resolved') {
    try {
      const { subject, html, text } = buildResolutionEmail({ id: ticketId, resolution: row.resolution });
      await sendTicketEmail({ to: row.email, subject, html, text, kind: 'ticket_resolved' });
    } catch (e) { console.warn('[admin/tickets] resolution email failed (non-fatal):', e?.message); }
  }

  return json(200, { ok: true, status: row.status });
}
