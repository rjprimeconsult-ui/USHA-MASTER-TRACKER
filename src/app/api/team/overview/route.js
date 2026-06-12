/**
 * GET /api/team/overview?scope=all|direct — bundles for every ACTIVE member
 * of the caller's downline (whole subtree by default, direct reports only
 * with scope=direct). The client computes the scoreboard from these with
 * the pure teamMath lib.
 *
 * Team-tier gated; every member whose data is returned gets an audit row.
 * Payload is the members' raw blobs — fine at current team sizes; revisit
 * with server-side aggregation if teams grow past ~50.
 */
import { adminClient, getCaller, isTeamLeaderEntitled, fetchAllEdges, downlineIdsFrom, fetchMemberBundle, auditView, jsonResponse } from '@/lib/teamServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req) {
  try {
    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });
    if (!(await isTeamLeaderEntitled(admin, caller.id))) {
      return jsonResponse(403, { error: 'Team plan required' });
    }

    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') === 'direct' ? 'direct' : 'all';

    const edges = await fetchAllEdges(admin);
    const ids = downlineIdsFrom(edges, caller.id, scope);
    if (ids.length === 0) return jsonResponse(200, { members: [], scope });

    // Bounded concurrency — same batching idiom as the TextDrip scan.
    const members = [];
    const BATCH = 5;
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const settled = await Promise.allSettled(chunk.map(id => fetchMemberBundle(admin, id)));
      for (const s of settled) {
        if (s.status === 'fulfilled') members.push(s.value);
        else console.error('[team/overview] bundle failed:', s.reason?.message || s.reason);
      }
    }

    // direct-report links so the client can build the org tree for drill-down
    const links = edges
      .filter(e => e.status === 'active' && (e.uplineId === caller.id || ids.includes(e.uplineId)))
      .map(e => ({ uplineId: e.uplineId, downlineId: e.downlineId }));

    await auditView(admin, caller.id, members.map(m => m.userId), 'view_overview', scope);
    console.log(`[team/overview] leader=${caller.id} scope=${scope} members=${members.length}`);

    return jsonResponse(200, { members, links, scope });
  } catch (e) {
    console.error('[team/overview] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
