/**
 * GET /api/team/my-leaders — the AGENT side: pending invites for me + who
 * can currently see my data (direct leader and the chain above them).
 * Powers the consent banner and the transparency panel. No tier required.
 *
 * Also resolves invite rows that were created before this user signed up
 * (matching by email) so the consent banner appears on first login.
 */
import { adminClient, getCaller, fetchAllEdges, fetchNames, jsonResponse } from '@/lib/teamServer';
import { uplineChain } from '@/lib/teamTree.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });

    // Backfill any pending invites that match my email but predate my account.
    await admin.from('team_members')
      .update({ downline_id: caller.id })
      .eq('downline_email', caller.email)
      .is('downline_id', null)
      .eq('status', 'pending');

    const edges = await fetchAllEdges(admin);

    const pending = edges.filter(e =>
      e.status === 'pending' &&
      (e.downlineId === caller.id || e.downlineEmail === caller.email));
    const active = edges.find(e => e.downlineId === caller.id && e.status === 'active');
    const chainIds = active ? uplineChain(caller.id, edges) : [];

    const names = await fetchNames(admin, [
      ...pending.map(p => p.uplineId),
      ...chainIds,
    ]);

    return jsonResponse(200, {
      pendingInvites: pending.map(p => ({
        inviteId: p.id,
        leaderName: names.get(p.uplineId)?.name || 'A team leader',
        invitedAt: p.invitedAt,
      })),
      team: active ? {
        leaderName: names.get(active.uplineId)?.name || 'Your leader',
        since: active.acceptedAt,
        uplineChain: chainIds.map(id => names.get(id)?.name || 'Leader'),
      } : null,
    });
  } catch (e) {
    console.error('[team/my-leaders] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
