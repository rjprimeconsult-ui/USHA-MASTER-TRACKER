/**
 * POST /api/team/role { memberId, role }
 *
 * A leader labels one of their OWN direct reports with a USHA org role
 * (AGENT / FTA / FSL / SAT) — or clears it with role: ''. The label is the
 * leader's annotation on the team edge; it never touches the member's data.
 * Tier-gated like all leader actions.
 */
import { adminClient, getCaller, isTeamLeaderEntitled, jsonResponse, TEAM_ROLE_LABELS } from '@/lib/teamServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    const memberId = String(body?.memberId || '');
    const role = String(body?.role || '').toUpperCase();
    if (!memberId) return jsonResponse(400, { error: 'Missing member' });
    if (role && !TEAM_ROLE_LABELS.includes(role)) {
      return jsonResponse(400, { error: 'Invalid role' });
    }

    // Must be the leader's own edge.
    const { data: row } = await admin.from('team_members')
      .select('id, upline_id').eq('id', memberId).maybeSingle();
    if (!row || row.upline_id !== caller.id) return jsonResponse(403, { error: 'Not your team member' });

    const { error: updErr } = await admin.from('team_members')
      .update({ role_label: role || null }).eq('id', row.id);
    if (updErr) return jsonResponse(500, { error: 'Could not save role — try again' });

    return jsonResponse(200, { ok: true });
  } catch (e) {
    console.error('[team/role] error:', e?.message || String(e));
    return jsonResponse(500, { error: 'Server error' });
  }
}
