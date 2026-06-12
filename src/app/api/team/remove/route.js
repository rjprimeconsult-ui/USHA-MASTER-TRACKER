/**
 * POST /api/team/remove { memberId? }
 *
 * Two directions, one endpoint:
 *  - Leader removes a direct report: pass memberId (the team_members row id).
 *    Only that edge is cut — the removed member keeps their own downline.
 *  - Member leaves their team: pass nothing; their active upline edge is cut.
 * Either way, access (including the whole upline chain's) ends immediately.
 */
import { adminClient, getCaller, isTeamLeaderEntitled, jsonResponse } from '@/lib/teamServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });

    let body = {};
    try { body = await req.json(); } catch { /* empty body = leave-team */ }
    const memberId = body?.memberId ? String(body.memberId) : null;
    const now = new Date().toISOString();

    if (memberId) {
      // Leader removing a direct report — must own the edge AND still be a
      // Team-tier leader (a lapsed leader manages nothing; the agent-side
      // leave path below intentionally has no tier requirement).
      if (!(await isTeamLeaderEntitled(admin, caller.id))) {
        return jsonResponse(403, { error: 'Team plan required' });
      }
      const { data: row } = await admin.from('team_members')
        .select('id, upline_id, status').eq('id', memberId).maybeSingle();
      if (!row || row.upline_id !== caller.id) return jsonResponse(403, { error: 'Not your team member' });
      if (row.status === 'removed') return jsonResponse(200, { ok: true });
      const { error: updErr } = await admin.from('team_members')
        .update({ status: 'removed', removed_at: now }).eq('id', row.id);
      if (updErr) return jsonResponse(500, { error: 'Could not remove — try again' });
      console.log(`[team/remove] leader=${caller.id} removed edge=${row.id}`);
      return jsonResponse(200, { ok: true });
    }

    // Member leaving their team (cuts their own active upline edge).
    const { data: act } = await admin.from('team_members')
      .select('id').eq('downline_id', caller.id).eq('status', 'active').maybeSingle();
    if (!act) return jsonResponse(200, { ok: true, noTeam: true });
    const { error: leaveErr } = await admin.from('team_members')
      .update({ status: 'removed', removed_at: now }).eq('id', act.id);
    if (leaveErr) return jsonResponse(500, { error: 'Could not leave — try again' });
    console.log(`[team/remove] member=${caller.id} left their team`);
    return jsonResponse(200, { ok: true, left: true });
  } catch (e) {
    console.error('[team/remove] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
