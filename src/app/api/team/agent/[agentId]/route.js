/**
 * GET /api/team/agent/[agentId] — one downline member's full data bundle for
 * the read-only drill-down, plus their direct reports (hierarchy panel).
 *
 * Authorization: the target must be in the caller's ACTIVE downline subtree
 * (transitive, cycle-safe). 403 otherwise — leaders can never read sideways
 * or upward. Every successful read is audit-logged.
 */
import { adminClient, getCaller, isTeamLeaderEntitled, fetchAllEdges, fetchMemberBundle, fetchNames, auditView, jsonResponse } from '@/lib/teamServer';
import { isDescendant, directReports } from '@/lib/teamTree.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req, ctx) {
  try {
    // Next.js 16: dynamic-route params are ASYNC — must be awaited.
    const params = await ctx?.params;
    const agentId = params?.agentId || '';
    if (!agentId) return jsonResponse(400, { error: 'Missing agent id' });

    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });
    if (!(await isTeamLeaderEntitled(admin, caller.id))) {
      return jsonResponse(403, { error: 'Team plan required' });
    }

    const edges = await fetchAllEdges(admin);
    if (!isDescendant(caller.id, agentId, edges)) {
      return jsonResponse(403, { error: 'Not in your team' });
    }

    const member = await fetchMemberBundle(admin, agentId);

    // The member's own direct reports — lets the leader keep drilling down.
    const reportIds = directReports(agentId, edges);
    const names = await fetchNames(admin, reportIds);
    const reports = reportIds.map(id => ({
      userId: id,
      name: names.get(id)?.name || 'Agent',
      email: names.get(id)?.email || '',
      hasReports: directReports(id, edges).length > 0,
    }));

    await auditView(admin, caller.id, agentId, 'view_agent');
    console.log(`[team/agent] leader=${caller.id} viewed=${agentId}`);

    return jsonResponse(200, { ...member, reports });
  } catch (e) {
    console.error('[team/agent] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
