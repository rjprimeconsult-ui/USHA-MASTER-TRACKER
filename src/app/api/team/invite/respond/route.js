/**
 * POST /api/team/invite/respond { inviteId, accept, confirmMove? }
 *
 * The INVITEE accepts or declines. Accepting is the consent moment (the
 * leader + their whole upline chain gain visibility). If the invitee already
 * has an active upline, the first accept call returns requiresMoveConfirm
 * with the current leader's name; a second call with confirmMove=true cuts
 * the old edge and activates the new one (never two active uplines — the DB
 * partial unique index backs this up).
 */
import { adminClient, getCaller, fetchAllEdges, fetchNames, jsonResponse } from '@/lib/teamServer';
import { wouldCreateCycle } from '@/lib/teamTree.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { admin, error } = adminClient();
    if (error) return jsonResponse(500, { error });
    const caller = await getCaller(req);
    if (!caller) return jsonResponse(401, { error: 'Not signed in' });
    // NOTE: no Team-tier gate here — any agent can respond to an invite.

    let body;
    try { body = await req.json(); } catch { return jsonResponse(400, { error: 'Invalid request' }); }
    const inviteId = String(body?.inviteId || '');
    const accept = !!body?.accept;
    const confirmMove = !!body?.confirmMove;
    if (!inviteId) return jsonResponse(400, { error: 'Missing invite' });

    const { data: row, error: rowErr } = await admin
      .from('team_members')
      .select('id, upline_id, downline_id, downline_email, status')
      .eq('id', inviteId).maybeSingle();
    if (rowErr || !row) return jsonResponse(404, { error: 'Invite not found' });

    // The invite must be FOR the caller (by resolved id or by email).
    // Defensive lowercase on the stored side: the DB CHECK enforces lowercase,
    // but rows that predate the constraint must still match.
    const isMine = row.downline_id === caller.id
      || String(row.downline_email || '').toLowerCase() === caller.email;
    if (!isMine) return jsonResponse(403, { error: 'This invite is not for you' });
    if (row.status !== 'pending') return jsonResponse(400, { error: 'This invite is no longer pending' });

    if (!accept) {
      await admin.from('team_members')
        .update({ status: 'declined', downline_id: caller.id })
        .eq('id', row.id);
      return jsonResponse(200, { ok: true, declined: true });
    }

    const edges = await fetchAllEdges(admin);

    // Cycle guard with the RESOLVED id (the invite may have predated signup).
    if (wouldCreateCycle(row.upline_id, caller.id, edges)) {
      return jsonResponse(400, { error: 'Accepting would create a loop in the team structure' });
    }

    // Already on a team? Make the move explicit before cutting anything.
    // The cut-then-activate pair below cannot be a single transaction through
    // the Supabase client, so the activate failure path RESTORES the old
    // active edge — an agent can never be left teamless by a half-completed
    // move. (The partial unique index still guarantees ≤1 active upline.)
    const currentActive = edges.find(e => e.downlineId === caller.id && e.status === 'active');
    const isMove = !!(currentActive && currentActive.id !== row.id);
    if (isMove) {
      if (!confirmMove) {
        const names = await fetchNames(admin, [currentActive.uplineId]);
        return jsonResponse(200, {
          requiresMoveConfirm: true,
          currentLeader: names.get(currentActive.uplineId)?.name || 'your current leader',
        });
      }
      const { error: cutErr } = await admin.from('team_members')
        .update({ status: 'removed', removed_at: new Date().toISOString() })
        .eq('id', currentActive.id).eq('status', 'active');
      if (cutErr) return jsonResponse(500, { error: 'Could not switch teams — try again' });
    }

    const { error: actErr } = await admin.from('team_members')
      .update({ status: 'active', downline_id: caller.id, accepted_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending');
    if (actErr) {
      console.error(`[team/respond] activate failed: ${actErr.message}`);
      if (isMove) {
        // Compensate: put the old team edge back so the agent isn't stranded.
        const { error: restoreErr } = await admin.from('team_members')
          .update({ status: 'active', removed_at: null })
          .eq('id', currentActive.id);
        if (restoreErr) console.error(`[team/respond] RESTORE FAILED user=${caller.id}: ${restoreErr.message}`);
        return jsonResponse(409, {
          error: restoreErr
            ? 'Could not switch teams. Contact support — your team link needs attention.'
            : 'Could not switch teams — you are still on your current team. Refresh and try again.',
        });
      }
      return jsonResponse(409, { error: 'Could not join — you may already be on a team. Refresh and try again.' });
    }

    console.log(`[team/respond] member=${caller.id} accepted upline=${row.upline_id}`);
    return jsonResponse(200, { ok: true, accepted: true });
  } catch (e) {
    console.error('[team/respond] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
