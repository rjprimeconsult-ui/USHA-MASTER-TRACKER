/**
 * Admin tool: scan + delete phantom Books-income entries created by the
 * old (pre-fix) bonus parser when ingesting Account Summary PDFs.
 *
 *   GET  /api/admin/phantom-bonuses          -> scan all users, return suspects
 *   POST /api/admin/phantom-bonuses          -> body { userId, entryId } removes one
 *
 * Auth: caller must be a logged-in admin (profiles.is_admin = true).
 *
 * Detection mirrors the rejection rules added to parseBonuses() in
 * src/lib/statement.js so anything that would fail to import today is
 * also flagged as a historical phantom here.
 */

import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function cleanEnv(s) {
  return String(s || '').trim().replace(/^['"]|['"]$/g, '');
}

// Mirrors the rejection rules in parseBonuses(). True = looks like a phantom.
function isPhantomBonus(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const src = String(entry.source || '');
  const notes = String(entry.notes || '');
  const blob = `${src} ${notes}`;
  if (!src) return false;

  // Only flag entries that came from auto-import (statement parser)
  // Manually added incomes don't have the BONUS-import notes signature.
  const fromImport = /Auto-imported\s+from\s+statement/i.test(notes) || src.includes('—') || src.includes('--');
  if (!fromImport) return false;

  // Reserve / account-summary terminology — never legit on a bonus
  if (/\b(beginning\s+balance|ending\s+balance|e\s*&\s*o\s+charge|week\s+ending|reserve\s+(adjustment|short|withheld|balance)|advance\s+reserve|chargeback|reinstatement)\b/i.test(blob)) return true;

  // Multiple separate $amounts inside the label
  const dollarHits = (blob.match(/\$\s*-?\(?[\d,]+\.\d{2}\)?/g) || []).length;
  if (dollarHits >= 2) return true;

  // Parenthesized negative dollar like ($5,348.50)
  if (/\(\s*\$/.test(blob)) return true;

  // Sanity cap on label length
  if (src.length > 100) return true;

  return false;
}

async function authAdmin(req) {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return { err: 'Server not configured' };
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { err: 'Missing bearer token' };
  const accessToken = match[1];
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userResp, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userResp?.user) return { err: 'Invalid session' };
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', userResp.user.id)
    .single();
  if (profErr) return { err: `Profile lookup failed: ${profErr.message}` };
  if (!profile?.is_admin) return { err: 'Admin role required' };
  return { admin, callerEmail: userResp.user.email };
}

// ---------- GET: scan ----------
export async function GET(req) {
  try {
    const auth = await authAdmin(req);
    if (auth.err) return jsonResponse(401, { error: auth.err });
    const admin = auth.admin;

    const { data: rows, error } = await admin
      .from('user_kv')
      .select('user_id, value')
      .eq('key', 'business_income_v1');
    if (error) return jsonResponse(500, { error: error.message });

    // Collect unique user IDs to fetch their emails
    const userIds = [...new Set((rows || []).map(r => r.user_id))];
    const emailById = {};
    for (const id of userIds) {
      const { data: u } = await admin.auth.admin.getUserById(id);
      if (u?.user?.email) emailById[id] = u.user.email;
    }

    const phantoms = [];
    for (const row of rows || []) {
      const arr = Array.isArray(row.value) ? row.value : [];
      for (const entry of arr) {
        if (!isPhantomBonus(entry)) continue;
        phantoms.push({
          userId: row.user_id,
          email: emailById[row.user_id] || '(unknown)',
          entryId: entry.id,
          date: entry.date,
          source: String(entry.source || '').slice(0, 140),
          amount: Number(entry.amount || 0),
        });
      }
    }

    phantoms.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    console.log(`[phantom-bonuses] admin=${auth.callerEmail} scanned=${rows?.length || 0} found=${phantoms.length}`);
    return Response.json({ phantoms, scannedUsers: userIds.length });
  } catch (e) {
    console.error('[phantom-bonuses GET] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}

// ---------- POST: delete one ----------
export async function POST(req) {
  try {
    const auth = await authAdmin(req);
    if (auth.err) return jsonResponse(401, { error: auth.err });
    const admin = auth.admin;

    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
    const { userId, entryId } = body || {};
    if (!userId || !entryId) return jsonResponse(400, { error: 'userId and entryId are required' });

    const { data: rows, error } = await admin
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'business_income_v1')
      .single();
    if (error) return jsonResponse(500, { error: `Read failed: ${error.message}` });

    const arr = Array.isArray(rows?.value) ? rows.value : [];
    const before = arr.length;
    const filtered = arr.filter(e => e?.id !== entryId);
    if (filtered.length === before) {
      return jsonResponse(404, { error: 'Entry not found' });
    }

    const { error: writeErr } = await admin
      .from('user_kv')
      .update({ value: filtered, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('key', 'business_income_v1');
    if (writeErr) return jsonResponse(500, { error: `Write failed: ${writeErr.message}` });

    console.log(`[phantom-bonuses] admin=${auth.callerEmail} deleted entry ${entryId} from user ${userId}`);
    return Response.json({ ok: true, removedFrom: before, remaining: filtered.length });
  } catch (e) {
    console.error('[phantom-bonuses POST] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
