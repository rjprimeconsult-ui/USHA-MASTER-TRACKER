'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { recoveryPhase, newPasswordIssue } from '@/lib/passwordReset.mjs';
import { verifiedTotpFactor } from '@/lib/mfa.mjs';
import { MfaChallenge } from './MfaGate';

/**
 * RecoveryScreen — shown instead of the app while a password-recovery
 * session is active (spec §4c). Phase order is a security property:
 *
 *   loading   → spinner only. The set form must never paint before the AAL
 *               lookup resolves, or an autofill can rotate an MFA-enrolled
 *               account's password at aal1.
 *   challenge → MfaChallenge (decision A: inbox compromise alone must not
 *               be enough to rotate an MFA-protected password).
 *   set       → new password form.
 *   blocked   → lookups errored; fail CLOSED with Retry/Sign out. Opposite
 *               direction from MfaGate's fail-open — a recovery user can
 *               retry or re-enter from a fresh link; a locked-out operator
 *               on a signed-in session cannot.
 *
 * Spec §6.3: Server-side aal2 enforcement for updateUser is UNVERIFIED
 * until the Task 7.3 live pass — until then, treat this client gate as the
 * only gate. (Update this sentence with the live-pass finding in the same
 * session that runs it.)
 */
export default function RecoveryScreen({ onDone }) {
  const [lookup, setLookup] = useState({ currentLevel: null, nextLevel: null, factors: null, lookupFailed: false });
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const resolve = useCallback(async () => {
    setLookup({ currentLevel: null, nextLevel: null, factors: null, lookupFailed: false });
    try {
      const [aalRes, factorsRes] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);
      // supabase-js resolves { data, error } — a failed call is NOT a throw.
      if (aalRes?.error || factorsRes?.error) throw aalRes?.error || factorsRes?.error;
      setLookup({
        currentLevel: aalRes?.data?.currentLevel ?? null,
        nextLevel: aalRes?.data?.nextLevel ?? null,
        factors: factorsRes?.data ?? null,
        // Null AAL or null factor data after a "successful" call = unusable
        // shape — fail CLOSED (blocked), symmetric for both lookups.
        lookupFailed: aalRes?.data?.currentLevel == null || factorsRes?.data == null,
      });
    } catch {
      setLookup((s) => ({ ...s, lookupFailed: true }));
    }
  }, []);

  useEffect(() => { resolve(); }, [resolve]);

  const phase = recoveryPhase({ recovering: true, ...lookup });

  const submit = async (e) => {
    e.preventDefault();
    const issue = newPasswordIssue(pw, confirm);
    if (issue) {
      setError(issue === 'too_short' ? 'Password must be at least 6 characters.' : "Those passwords don't match.");
      return;
    }
    setBusy(true); setError('');
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) { setError(err.message || 'Could not update the password. Try again.'); return; }
      setSaved(true);
      setTimeout(() => onDone(), 1500); // inline success dwell, then the normal gate chain (spec §4c.2)
    } catch (e) {
      // A rejected call (network drop on a phone) must not strand the screen
      // with a permanently disabled button — this form is the only way in.
      setError(e?.message || 'Network problem — try again.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); window.location.reload(); };

  if (phase === 'challenge') {
    return <MfaChallenge factor={verifiedTotpFactor(lookup.factors)} onDone={resolve} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-lg">
          <KeyRound size={26} />
        </div>

        {phase === 'loading' && (
          <div className="text-slate-500 flex items-center justify-center gap-2 py-8">
            <Loader2 size={16} className="animate-spin" /> Checking your account…
          </div>
        )}

        {phase === 'blocked' && (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Something went wrong</h1>
            <p className="text-sm text-slate-600 mb-6">
              We couldn&apos;t verify your account&apos;s security settings.
            </p>
            <button
              onClick={resolve}
              className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-lg py-2.5 text-sm font-bold"
            >
              Retry
            </button>
            <button onClick={signOut} className="mt-4 text-xs text-slate-500 hover:text-slate-700 underline">
              Sign out
            </button>
          </>
        )}

        {phase === 'set' && (saved ? (
          <div className="text-emerald-700 flex items-center justify-center gap-2 py-8 text-sm font-semibold">
            <CheckCircle2 size={18} /> Password updated — taking you in…
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Set a new password</h1>
            <p className="text-sm text-slate-600 mb-6">
              You&apos;re signed in from your reset link. Pick a new password to finish.
            </p>
            <form onSubmit={submit} className="space-y-3 text-left">
              <input
                type="password" required minLength={6} autoComplete="new-password"
                value={pw} onChange={(e) => setPw(e.target.value)}
                placeholder="New password (6+ characters)" aria-label="New password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="password" required minLength={6} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password" aria-label="Confirm new password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit" disabled={busy}
                className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={14} className="animate-spin" />} Set new password
              </button>
              {error && (
                <p className="text-sm text-rose-600 flex items-center gap-1.5">
                  <AlertCircle size={14} className="flex-shrink-0" /> {error}
                </p>
              )}
            </form>
            <button onClick={signOut} className="mt-4 text-xs text-slate-500 hover:text-slate-700 underline">
              I&apos;ll do this later — sign out
            </button>
          </>
        ))}
      </div>
    </div>
  );
}
