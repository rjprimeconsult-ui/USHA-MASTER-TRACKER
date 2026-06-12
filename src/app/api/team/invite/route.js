/**
 * POST /api/team/invite { email } — a leader invites a direct report.
 *
 * Edge cases handled (spec §5.5):
 *  - self-invite / malformed email → clear 400
 *  - already pending/active → friendly no-op ("already invited")
 *  - previously declined/removed → re-invite (row reset to pending)
 *  - invitee not signed up yet → row stored by email, resolved later
 *  - cycle guard: can't invite anyone in your own upline chain
 *
 * No email is sent — the invite surfaces in-app for the invitee.
 */
import { adminClient, getCaller, isTeamLeaderEntitled, fetchAllEdges, jsonResponse } from '@/lib/teamServer';
import { wouldCreateCycle } from '@/lib/teamTree.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req) {
  try {
    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });
    if (!(await isTeamLeaderEntitled(admin, caller.id))) {
      return jsonResponse(403, { error: 'Team plan required' });
    }

    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid request' }); }
    const email = String(body?.email || '').trim().toLowerCase();

    if (!EMAIL_RE.test(email)) return jsonResponse(400, { error: 'Enter a valid email address' });
    if (email === caller.email) return jsonResponse(400, { error: "You can't invite yourself" });

    // Resolve the invitee to a user id if they already have a PRIM account.
    const { data: inviteeProf } = await admin
      .from('profiles').select('id').ilike('email', email).maybeSingle();
    const inviteeId = inviteeProf?.id || null;

    const edges = await fetchAllEdges(admin);

    // Cycle guard: your boss (or their boss…) can't also become your report.
    if (inviteeId && wouldCreateCycle(caller.id, inviteeId, edges)) {
      return jsonResponse(400, { error: 'That person is in your own leadership chain — inviting them would create a loop' });
    }

    // Existing edge from THIS leader to THIS email?
    const existing = edges.find(e => e.uplineId === caller.id && e.downlineEmail === email);
    if (existing) {
      if (existing.status === 'pending') return jsonResponse(200, { ok: true, already: 'pending' });
      if (existing.status === 'active')  return jsonResponse(200, { ok: true, already: 'active' });
      // declined or removed → re-invite by resetting the same row
      const { error: updErr } = await admin.from('team_members')
        .update({ status: 'pending', downline_id: inviteeId, invited_at: new Date().toISOString(), accepted_at: null, removed_at: null })
        .eq('id', existing.id);
      if (updErr) return jsonResponse(500, { error: 'Could not re-invite — try again' });
      console.log(`[team/invite] leader=${caller.id} re-invited`);
      return jsonResponse(200, { ok: true, reinvited: true });
    }

    const { error: insErr } = await admin.from('team_members').insert({
      upline_id: caller.id,
      downline_id: inviteeId,
      downline_email: email,
      status: 'pending',
    });
    if (insErr) {
      console.error(`[team/invite] insert failed: ${insErr.message}`);
      return jsonResponse(500, { error: 'Could not send invite — try again' });
    }

    console.log(`[team/invite] leader=${caller.id} invited (resolved=${!!inviteeId})`);
    return jsonResponse(200, { ok: true, resolved: !!inviteeId });
  } catch (e) {
    console.error('[team/invite] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
