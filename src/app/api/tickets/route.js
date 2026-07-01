/**
 * POST /api/tickets — an agent submits a support ticket.
 *
 * Auth: agent's Supabase bearer token (requireUserId). user_id is derived from
 * the VERIFIED session, never the body. Flow: validate → INSERT the row first
 * (id is DB-generated) → best-effort screenshot upload → best-effort submit
 * email to Juan (metadata only). Email/upload failures are non-fatal — the
 * ticket still saves. The free-text description is NEVER logged or emailed.
 */
import { createClient } from '@supabase/supabase-js';
import { requireUserId } from '@/lib/apiAuth';
import { validateTicketInput, buildSubmitEmail } from '@/lib/tickets.mjs';
import { sendTicketEmail } from '@/lib/ticketEmails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TICKET_ADMIN_EMAIL = 'rjprimeconsult@gmail.com';
const ALLOWED_SHOT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SHOT_BYTES = 5 * 1024 * 1024;

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req) {
  const auth = await requireUserId(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const admin = serviceClient();
  if (!admin) return Response.json({ error: 'server not configured' }, { status: 500 });

  // Parse body — multipart (with screenshot) or plain JSON.
  let fields = {};
  let screenshot = null;
  const ct = req.headers.get('content-type') || '';
  try {
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const rawCtx = form.get('context');
      fields = {
        category: form.get('category'),
        custom_category: form.get('custom_category'),
        description: form.get('description'),
        context: rawCtx ? JSON.parse(rawCtx) : {},
      };
      const f = form.get('screenshot');
      if (f && typeof f === 'object' && f.size) screenshot = f;
    } else {
      const body = await req.json();
      fields = {
        category: body.category,
        custom_category: body.custom_category,
        description: body.description,
        context: body.context || {},
      };
    }
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  const v = validateTicketInput(fields);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  // Submitter email + name. Fall back to the auth user's email so the NOT NULL
  // email column is always satisfied (profiles.email can be null).
  let email = '';
  let name = '';
  try {
    const { data: prof } = await admin.from('profiles').select('email, display_name').eq('id', userId).maybeSingle();
    email = prof?.email || '';
    name = prof?.display_name || '';
  } catch { /* fall through */ }
  if (!email) {
    try { const { data: u } = await admin.auth.admin.getUserById(userId); email = u?.user?.email || ''; } catch { /* */ }
  }
  if (!email) return Response.json({ error: 'no account email on file' }, { status: 400 });

  // Insert the row FIRST — id is DB-generated.
  const { data: row, error: insErr } = await admin.from('tickets').insert({
    user_id: userId,
    email,
    name,
    category: fields.category,
    custom_category: fields.category === 'Custom' ? String(fields.custom_category).trim() : null,
    description: String(fields.description).trim(),
    context: fields.context || {},
    status: 'new',
  }).select('id').single();
  if (insErr || !row) {
    console.error('[tickets] insert failed:', insErr?.message); // never logs the description
    return Response.json({ error: 'could not save ticket' }, { status: 500 });
  }
  const id = row.id;

  // Screenshot (best-effort). Service-role upload bypasses storage RLS by design.
  if (screenshot) {
    try {
      if (ALLOWED_SHOT_MIME.has(screenshot.type) && screenshot.size <= MAX_SHOT_BYTES) {
        const ext = screenshot.type === 'image/png' ? 'png' : screenshot.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${userId}/${id}.${ext}`;
        const buf = Buffer.from(await screenshot.arrayBuffer());
        const up = await admin.storage.from('ticket-screenshots').upload(path, buf, { contentType: screenshot.type, upsert: true });
        if (!up.error) await admin.from('tickets').update({ screenshot_path: path }).eq('id', id);
      }
    } catch (e) { console.warn('[tickets] screenshot upload failed (non-fatal):', e?.message); }
  }

  // Submit email → Juan (best-effort, metadata only — never the description).
  let emailQueued = false;
  try {
    const { subject, html, text } = buildSubmitEmail({
      id,
      category: fields.category,
      custom_category: fields.custom_category,
      name,
      email,
      context: fields.context || {},
    });
    const res = await sendTicketEmail({ to: TICKET_ADMIN_EMAIL, subject, html, text, kind: 'ticket_new' });
    emailQueued = res.sent;
  } catch (e) { console.warn('[tickets] submit email failed (non-fatal):', e?.message); }

  return Response.json({ id, emailQueued });
}
