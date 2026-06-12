/**
 * GET /api/team/roster — the leader's direct invites/reports (all statuses
 * except removed), with display names for resolved members.
 * Team-tier gated. Read-only; no audit row (no agent DATA is returned).
 */
import { adminClient, getCaller, isTeamLeaderEntitled, fetchAllEdges, fetchNames, jsonResponse } from '@/lib/teamServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });
    if (!(await isTeamLeaderEntitled(admin, caller.id))) {
      return jsonResponse(403, { error: 'Team plan required' });
    }

    const edges = await fetchAllEdges(admin);
    const mine = edges.filter(e => e.uplineId === caller.id && e.status !== 'removed');
    const names = await fetchNames(admin, mine.map(e => e.downlineId).filter(Boolean));

    const roster = mine.map(e => ({
      id: e.id,
      email: e.downlineEmail,
      userId: e.downlineId,
      name: e.downlineId ? (names.get(e.downlineId)?.name || e.downlineEmail) : e.downlineEmail,
      status: e.status,
      invitedAt: e.invitedAt,
      acceptedAt: e.acceptedAt,
      // is this member themselves a leader with reports? (for tree hints)
      hasReports: e.downlineId
        ? edges.some(x => x.uplineId === e.downlineId && x.status === 'active')
        : false,
    }));

    return jsonResponse(200, { roster });
  } catch (e) {
    console.error('[team/roster] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
