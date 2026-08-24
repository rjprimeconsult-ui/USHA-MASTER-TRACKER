'use client';
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { MFA, mfaState, verifiedTotpFactor } from '@/lib/mfa.mjs';

/**
 * MfaGate — two-factor authentication for admin accounts (WISP §9 gap #1).
 *
 * Sits between AuthGate and the app. Three outcomes, resolved by the pure
 * logic in mfa.mjs:
 *   CHALLENGE        → enrolled, this session needs the 6-digit code
 *   ENROLL_REQUIRED  → admin with no factor; setup is forced before the app
 *   OK               → render the app
 *
 * FAIL-SAFE DIRECTION (deliberate, and opposite to the subscription gate):
 * if any lookup here fails, this renders the app rather than a wall. A
 * broken MFA check must never lock the operator out of his own product —
 * there is no in-app recovery path. The enforcement that must not fail open
 * is server-side on the admin routes, where a missing aal2 denies outright.
 */
export default function MfaGate({ children }) {
  const [state, setState] = useState(null); // null = still resolving
  const [factors, setFactors] = useState(null);

  const resolve = useCallback(async () => {
    if (!supabaseConfigured()) { setState(MFA.OK); return; }
    try {
      const [{ data: aal }, { data: factorList }] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      let isAdmin = false;
      if (userId) {
        const { data: profile, error } = await supabase
          .from('profiles').select('is_admin').eq('id', userId).maybeSingle();
        // supabase-js resolves {data,error} — a failed query is NOT a throw.
        // Unknown admin status must not force enrollment (fail-safe above).
        if (!error) isAdmin = profile?.is_admin === true;
      }

      setFactors(factorList);
      setState(mfaState({
        currentLevel: aal?.currentLevel,
        nextLevel: aal?.nextLevel,
        factors: factorList,
        isAdmin,
      }));
    } catch (e) {
      console.warn('[MfaGate] check failed, allowing through:', e?.message);
      setState(MFA.OK);
    }
  }, []);

  useEffect(() => { resolve(); }, [resolve]);

  if (state === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Checking security…
      </div>
    );
  }
  if (state === MFA.CHALLENGE) {
    return <MfaChallenge factor={verifiedTotpFactor(factors)} onDone={resolve} />;
  }
  if (state === MFA.ENROLL_REQUIRED) {
    // onUnavailable: enrollment could not even be STARTED (e.g. MFA is off
    // at the project level). Trapping the operator on an error screen he
    // cannot clear — and would hit again on every sign-in — is the exact
    // lockout this component's fail-safe rule exists to prevent.
    return <MfaSetup onDone={resolve} onUnavailable={() => setState(MFA.OK)} />;
  }
  return children;
}

function Shell({ icon, title, subtitle, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-lg">
          {icon}
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-1">{title}</h1>
        <p className="text-sm text-slate-600 mb-6">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function CodeForm({ onSubmit, busy, error, cta }) {
  const [code, setCode] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(code.trim()); }}
      className="space-y-3"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        aria-label="Six-digit authentication code"
        autoFocus
        className="w-full text-center tracking-[0.4em] text-lg font-mono border border-slate-300 rounded-lg py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}{cta}
      </button>
      {error && (
        <p className="text-sm text-rose-600 flex items-center justify-center gap-1.5">
          <AlertCircle size={14} /> {error}
        </p>
      )}
    </form>
  );
}

/** Sign-in code prompt for an account that already has a verified factor. */
export function MfaChallenge({ factor, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (code) => {
    setBusy(true); setError('');
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id, code,
      });
      if (err) throw err;
      await onDone();
    } catch (e) {
      setError(e?.message || 'That code did not work. Try the next one.');
      setBusy(false);
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); window.location.reload(); };

  return (
    <Shell
      icon={<KeyRound size={26} />}
      title="Enter your code"
      subtitle="Open your authenticator app and enter the 6-digit code for PRIM."
    >
      <CodeForm onSubmit={submit} busy={busy} error={error} cta="Verify" />
      <button onClick={signOut} className="mt-5 text-xs text-slate-500 hover:text-slate-700 underline">
        Sign out instead
      </button>
    </Shell>
  );
}

/** First-time TOTP enrollment. Shown forced (admins) or from Profile. */
export function MfaSetup({ onDone, onCancel, onUnavailable }) {
  const [enrolling, setEnrolling] = useState(true);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Clear abandoned enrollments first: a stale unverified factor makes
        // enroll() fail on a duplicate friendly name and leaves the account
        // in the half-set-up state mfa.mjs deliberately treats as unprotected.
        const { data: existing } = await supabase.auth.mfa.listFactors();
        const stale = [...(existing?.all || [])].filter(f => f.status === 'unverified');
        for (const f of stale) await supabase.auth.mfa.unenroll({ factorId: f.id });

        const { data, error: err } = await supabase.auth.mfa.enroll({
          factorType: 'totp', friendlyName: 'PRIM',
        });
        if (err) throw err;
        setQr(data?.totp?.qr_code || '');
        setSecret(data?.totp?.secret || '');
        setFactorId(data?.id || '');
      } catch (e) {
        setError(e?.message || 'Could not start setup. Reload and try again.');
        setUnavailable(true);
      } finally {
        setEnrolling(false);
      }
    })();
  }, []);

  const verify = async (code) => {
    setBusy(true); setError('');
    try {
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (err) throw err;
      await onDone();
    } catch (e) {
      setError(e?.message || 'That code did not work. Try the next one.');
      setBusy(false);
    }
  };

  return (
    <Shell
      icon={<ShieldCheck size={26} />}
      title="Set up two-factor authentication"
      subtitle="Your account can reach every agent's data, so it needs a second factor. This takes about a minute."
    >
      {enrolling ? (
        <div className="text-slate-500 flex items-center justify-center gap-2 py-8">
          <Loader2 size={16} className="animate-spin" /> Preparing…
        </div>
      ) : (
        <>
          {qr && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
              {/* Supabase returns the QR as an SVG data URI. */}
              <img src={qr} alt="Two-factor setup QR code" className="w-40 h-40 mx-auto" />
              <p className="text-xs text-slate-500 mt-3">
                Scan with Google Authenticator, 1Password, Authy, or any TOTP app.
              </p>
              {secret && (
                <details className="mt-2 text-left">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
                    Can&apos;t scan? Enter this key manually
                  </summary>
                  <code className="mt-1.5 block text-[11px] font-mono break-all bg-slate-50 border border-slate-200 rounded p-2 text-slate-700">
                    {secret}
                  </code>
                </details>
              )}
            </div>
          )}
          {unavailable ? (
            <div className="space-y-3">
              <p className="text-sm text-rose-600 flex items-center justify-center gap-1.5">
                <AlertCircle size={14} /> {error}
              </p>
              {onUnavailable && (
                <button
                  onClick={onUnavailable}
                  className="w-full border border-slate-300 hover:border-slate-400 text-slate-700 rounded-lg py-2.5 text-sm font-semibold"
                >
                  Continue to PRIM
                </button>
              )}
            </div>
          ) : (
            <CodeForm onSubmit={verify} busy={busy} error={error} cta="Turn on two-factor" />
          )}
          <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
            Keep a backup: save the manual key above in your password manager. If you
            lose your authenticator, the factor must be removed from the Supabase
            dashboard to regain access.
          </p>
          {onCancel && (
            <button onClick={onCancel} className="mt-3 text-xs text-slate-500 hover:text-slate-700 underline">
              Cancel
            </button>
          )}
        </>
      )}
    </Shell>
  );
}
