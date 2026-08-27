'use client';
import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { newPasswordIssue } from '@/lib/passwordReset.mjs';

/**
 * Change password from Profile → Security (spec §4d).
 *
 * The current-password check runs on a THROWAWAY client, never the
 * singleton: signInWithPassword on the singleton would mint and SAVE a new
 * aal1 JWT, silently downgrading an aal2 admin session so every
 * /api/admin/* call 403s until re-challenge. The throwaway is memory-only
 * (persistSession:false), parses no URL, and uses its own storageKey so it
 * shares no auth lock with the singleton. signOut({scope:'local'}) discards
 * its session without revoking the singleton's server-side refresh token.
 */
function verifyClient() {
  // Same placeholder rule as src/lib/supabase.js: createClient THROWS on an
  // empty url, and local-only mode (no env) can still reach this form.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key-placeholder',
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'prim-pw-verify' } },
  );
}

export default function ChangePasswordForm({ email }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaved(false);
    const issue = newPasswordIssue(pw, confirm);
    if (issue) {
      setError(issue === 'too_short' ? 'New password must be at least 6 characters.' : "Those passwords don't match.");
      return;
    }
    if (!email) {
      // Wiring bug, not a user error — do not blame their password for it.
      setError('Could not determine your account email. Reload and try again.');
      return;
    }
    setBusy(true); setError('');
    try {
      const throwaway = verifyClient();
      const { error: verifyErr } = await throwaway.auth.signInWithPassword({ email, password: current });
      // Discard the throwaway session either way; never touches the singleton.
      await throwaway.auth.signOut({ scope: 'local' });
      if (verifyErr) {
        setError("That current password isn't right.");
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: pw });
      if (updateErr) {
        setError(updateErr.message || 'Could not update the password. Try again.');
        return;
      }
      setSaved(true);
      setCurrent(''); setPw(''); setConfirm('');
    } catch (e) {
      // Never swallow: a rejected call surfaces, and busy always resets.
      setError(e?.message || 'Network problem — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md">
      <h3 className="text-sm font-bold text-slate-900 mb-1">Change password</h3>
      <p className="text-xs text-slate-500 mb-4">
        Pick something you don&apos;t use anywhere else. You&apos;ll stay signed in here.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password" required autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password" aria-label="Current password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
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
          className="bg-gradient-to-br from-indigo-600 to-violet-600 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-bold flex items-center gap-2"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Change password
        </button>
        {error && (
          <p className="text-sm text-rose-600 flex items-center gap-1.5">
            <AlertCircle size={14} className="flex-shrink-0" /> {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} className="flex-shrink-0" /> Password updated.
          </p>
        )}
      </form>
    </div>
  );
}
