'use client';
/**
 * TeamMembership — the AGENT side of the Team feature:
 *
 *  - <TeamInviteBanner/>: one-tap consent. Surfaces pending team invites at
 *    the top of the app with the transitive-consent wording (the leader AND
 *    their upline chain gain visibility). Accept/Decline; if the agent is
 *    already on a team, accepting shows an explicit "this moves you" confirm.
 *  - <TeamTransparencySection/>: lives in Profile — shows exactly who can
 *    see your data (direct leader + upline chain) and the Leave-team button.
 *
 * Both are self-contained (fetch /api/team/my-leaders themselves) so mounting
 * them costs the host component one line.
 */
import { useState, useEffect, useCallback } from 'react';
import { Users, Check, X, LogOut, ShieldCheck } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

async function authedFetch(url, options = {}) {
  if (!supabaseConfigured()) throw new Error('Not configured');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export function useMyLeaders() {
  const [data, setData] = useState(null);
  const refresh = useCallback(async () => {
    try { setData(await authedFetch('/api/team/my-leaders')); }
    catch { setData(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { data, refresh };
}

// ---------- One-tap consent banner ----------
export function TeamInviteBanner({ showToast = () => {} }) {
  const { data, refresh } = useMyLeaders();
  const [busy, setBusy] = useState(false);
  const invite = data?.pendingInvites?.[0];
  if (!invite) return null;

  const respond = async (accept) => {
    setBusy(true);
    try {
      let res = await authedFetch('/api/team/invite/respond', {
        method: 'POST',
        body: JSON.stringify({ inviteId: invite.inviteId, accept }),
      });
      if (res.requiresMoveConfirm) {
        const ok = confirm(
          `You're currently on ${res.currentLeader}'s team. Accepting will MOVE you to ${invite.leaderName}'s team — ${res.currentLeader} will lose access to your data. Continue?`
        );
        if (!ok) { setBusy(false); return; }
        res = await authedFetch('/api/team/invite/respond', {
          method: 'POST',
          body: JSON.stringify({ inviteId: invite.inviteId, accept: true, confirmMove: true }),
        });
      }
      showToast(accept ? `You're on ${invite.leaderName}'s team` : 'Invite declined');
      await refresh();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="premium-card p-4 mb-4 border-l-4 border-l-indigo-500 flex items-start gap-3 flex-wrap">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white flex-shrink-0 shadow-md shadow-indigo-500/30">
        <Users size={17} />
      </div>
      <div className="flex-1 min-w-[220px]">
        <div className="font-bold text-slate-900 text-sm">{invite.leaderName} invited you to their team</div>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
          If you accept, {invite.leaderName} <span className="font-semibold">and their upline leadership</span> will
          be able to see your production, your clients, and your books — read-only. You can leave at any time from
          your Profile.
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={() => respond(true)}
          disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center gap-1.5"
        >
          <Check size={14} /> Accept
        </button>
        <button
          onClick={() => respond(false)}
          disabled={busy}
          className="border border-slate-200 hover:bg-slate-50 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
        >
          <X size={14} /> Decline
        </button>
      </div>
    </div>
  );
}

// ---------- Profile transparency panel ----------
export function TeamTransparencySection({ showToast = () => {} }) {
  const { data, refresh } = useMyLeaders();
  const [busy, setBusy] = useState(false);
  const team = data?.team;

  const leave = async () => {
    if (!confirm(`Leave ${team.leaderName}'s team? They (and everyone above them) immediately lose access to your data.`)) return;
    setBusy(true);
    try {
      await authedFetch('/api/team/remove', { method: 'POST', body: JSON.stringify({}) });
      showToast('You left the team — access has been cut off');
      await refresh();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="premium-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={16} className="text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-900">Team membership</h3>
      </div>
      {team ? (
        <>
          <p className="text-sm text-slate-700">
            You&apos;re on <span className="font-bold">{team.leaderName}</span>&apos;s team
            {team.since ? ` since ${new Date(team.since).toLocaleDateString()}` : ''}.
          </p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Who can see your production, clients, and books (read-only):{' '}
            <span className="font-semibold text-slate-700">{(team.uplineChain || [team.leaderName]).join(' → ')}</span>.
            Every time they view your data it is access-logged.
          </p>
          <button
            onClick={leave}
            disabled={busy}
            className="mt-3 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5"
          >
            <LogOut size={14} /> Leave team
          </button>
        </>
      ) : (
        <p className="text-sm text-slate-500">
          You&apos;re not on a team — nobody else can see your data. If a leader invites you, the invite will appear
          at the top of the app and nothing is shared until you accept.
        </p>
      )}
    </div>
  );
}
