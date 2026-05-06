/**
 * Logs a thumbs-up / thumbs-down on an assistant message.
 *
 * Body: {
 *   rating:                  1 | -1
 *   messageText:             string  (the assistant message that was rated)
 *   precedingUserMessage?:   string
 *   currentView?:            string
 *   notes?:                  string
 * }
 *
 * Auth: Bearer <supabase access token>. Required — anonymous feedback isn't
 * useful since we'd have no way to follow up on patterns per user.
 *
 * Writes to chat_feedback (see supabase/chat-feedback-migration.sql).
 */

import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUserIdFromBearer(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    const supabase = createClient(url, anonKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req) {
  const userId = await getUserIdFromBearer(req);
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const { rating, messageText, precedingUserMessage, currentView, notes } = body || {};

  const r = Number(rating);
  if (r !== 1 && r !== -1) {
    return Response.json({ error: 'rating must be 1 or -1' }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) return Response.json({ error: 'server not configured' }, { status: 503 });

  const { error } = await supabase.from('chat_feedback').insert({
    user_id: userId,
    rating: r,
    message_text: typeof messageText === 'string' ? messageText.slice(0, 8000) : null,
    preceding_user_message: typeof precedingUserMessage === 'string' ? precedingUserMessage.slice(0, 4000) : null,
    current_view: typeof currentView === 'string' ? currentView.slice(0, 100) : null,
    notes: typeof notes === 'string' ? notes.slice(0, 2000) : null,
  });

  if (error) {
    console.error('[chat/feedback] insert failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
