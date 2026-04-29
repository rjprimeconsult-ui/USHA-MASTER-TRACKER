/**
 * Admin tool: scan all users for duplicate leads and bulk-delete them.
 *
 *   GET  /api/admin/duplicate-leads        -> scan all users, return groups
 *   POST /api/admin/duplicate-leads        -> body { userId, deleteIds[] }
 *                                              removes those leads from the
 *                                              user's leads_v5 collection
 *
 * Auth: caller must be a logged-in admin (profiles.is_admin = true).
 *
 * Detection re-uses src/lib/leadDedup.js findDuplicateGroups so it matches
 * the same rules the live import dedup uses — anything that would be caught
 * as a duplicate on a fresh import is flagged here too.
 */

import { createClient } from '@supabase/supabase-js';
import { findDuplicateGroups } from '@/lib/leadDedup';

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

// ---- GET: scan ----
export async function GET(req) {
  try {
    const auth = await authAdmin(req);
    if (auth.err) return jsonResponse(401, { error: auth.err });
    const admin = auth.admin;

    const { data: rows, error } = await admin
      .from('user_kv')
      .select('user_id, value')
      .eq('key', 'leads_v5');
    if (error) return jsonResponse(500, { error: error.message });

    // Resolve emails per user
    const userIds = [...new Set((rows || []).map(r => r.user_id))];
    const emailById = {};
    for (const id of userIds) {
      const { data: u } = await admin.auth.admin.getUserById(id);
      if (u?.user?.email) emailById[id] = u.user.email;
    }

    const usersWithDuplicates = [];
    let totalDuplicates = 0;
    for (const row of rows || []) {
      const leads = Array.isArray(row.value) ? row.value : [];
      if (leads.length < 2) continue;
      const groups = findDuplicateGroups(leads);
      if (groups.length === 0) continue;
      // Trim each lead to just the visible fields the UI needs (cuts payload)
      const slimmedGroups = groups.map(group =>
        group.map(l => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          state: l.state,
          policyNumber: l.policyNumber,
          mainProduct: l.mainProduct,
          mainProductPremium: l.mainProductPremium,
          stage: l.stage,
          closedDate: l.closedDate,
          dateAdded: l.dateAdded,
        }))
      );
      const dupCount = groups.reduce((s, g) => s + (g.length - 1), 0);
      totalDuplicates += dupCount;
      usersWithDuplicates.push({
        userId: row.user_id,
        email: emailById[row.user_id] || '(unknown)',
        totalLeads: leads.length,
        groupCount: groups.length,
        duplicateCount: dupCount,
        groups: slimmedGroups,
      });
    }

    usersWithDuplicates.sort((a, b) => b.duplicateCount - a.duplicateCount);
    console.log(`[duplicate-leads] admin=${auth.callerEmail} scanned=${rows?.length || 0} usersWithDups=${usersWithDuplicates.length} totalDups=${totalDuplicates}`);

    return Response.json({ users: usersWithDuplicates, scannedUsers: userIds.length, totalDuplicates });
  } catch (e) {
    console.error('[duplicate-leads GET] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}

// ---- POST: delete ----
export async function POST(req) {
  try {
    const auth = await authAdmin(req);
    if (auth.err) return jsonResponse(401, { error: auth.err });
    const admin = auth.admin;

    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
    const { userId, deleteIds } = body || {};
    if (!userId || !Array.isArray(deleteIds) || deleteIds.length === 0) {
      return jsonResponse(400, { error: 'userId and deleteIds[] required' });
    }

    const { data: row, error } = await admin
      .from('user_kv')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'leads_v5')
      .single();
    if (error) return jsonResponse(500, { error: `Read failed: ${error.message}` });

    const leads = Array.isArray(row?.value) ? row.value : [];
    const idSet = new Set(deleteIds);
    const filtered = leads.filter(l => !idSet.has(l?.id));
    const removed = leads.length - filtered.length;

    if (removed === 0) {
      return jsonResponse(404, { error: 'None of those lead IDs were found in this user.' });
    }

    const { error: writeErr } = await admin
      .from('user_kv')
      .update({ value: filtered, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('key', 'leads_v5');
    if (writeErr) return jsonResponse(500, { error: `Write failed: ${writeErr.message}` });

    console.log(`[duplicate-leads] admin=${auth.callerEmail} deleted ${removed} leads from user ${userId}`);
    return Response.json({ ok: true, removed, remaining: filtered.length });
  } catch (e) {
    console.error('[duplicate-leads POST] error:', e);
    return jsonResponse(500, { error: `Server error: ${e?.message || String(e)}` });
  }
}
