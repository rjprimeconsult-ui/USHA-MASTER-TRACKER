'use client';
import { useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Mail, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { PrimAppIcon } from '@/components/PrimLogo';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { isPublicRoute } from '@/lib/routeAccess.mjs';
import { useAuth } from './AuthProvider';
import ConstellationBackground from '../motion/ConstellationBackground';
import MigrationPrompt from './MigrationPrompt';

/**
 * AuthGate — wraps the app and shows the sign-in / sign-up screen until the
 * user is authenticated. If Supabase isn't configured yet (no env vars), it
 * lets the app render in "local-only" mode for development. Public routes
 * (landing, pricing, legal) skip the gate entirely so unauth visitors can
 * see them.
 */
export default function AuthGate({ children, isMarketingHost = false }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Public marketing/legal pages bypass auth completely.
  if (isPublicRoute(pathname, { isMarketingHost })) return children;

  if (!supabaseConfigured()) {
    // Dev fallback — show a banner but let the app run on localStorage
    return (
      <>
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-xs px-4 py-1 text-center font-semibold">
          ⚠ Local-only mode — Supabase env vars missing. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local
        </div>
        <div className="pt-6">{children}</div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!user) return <SignInScreen />;

  return (
    <>
      <MigrationPrompt />
      {children}
    </>
  );
}

function SignInScreen() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState(searchParams.get('signup') === '1' ? 'signup' : 'signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try {
      if (mode === 'signup') {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setInfo('Check your email to confirm your account, then sign in.');
        setMode('signin');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        // AuthProvider's onAuthStateChange will flip user → app renders
      }
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-canvas min-h-screen relative isolate flex items-center justify-center p-4 overflow-hidden">
      <ConstellationBackground intensity="prominent" />
      {/* The card is the LCP element on the public root URL. It is rendered
          fully visible (no JS-gated opacity fade) so it paints immediately on
          mobile instead of waiting for hydration — and it's the page's <main>
          landmark. A CSS-only entrance (modal-pop) keeps a subtle reveal
          without delaying the largest-contentful-paint. */}
      <main
        className="relative bg-white/80 backdrop-blur-2xl border border-white/70 rounded-2xl max-w-md w-full p-8 modal-pop"
        style={{
          boxShadow:
            '0 32px 80px -24px rgba(99,102,241,0.28), 0 12px 32px -16px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.85)',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="rounded-xl"
            style={{ boxShadow: '0 14px 38px -10px rgba(99,102,241,0.55)' }}
          >
            <PrimAppIcon size={48} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 leading-none tracking-tight">PRIM</h1>
            <p className="text-[11px] font-semibold text-slate-500 mt-1 tracking-wide uppercase">
              Performance · Revenue · Investment
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-extrabold text-slate-900 mb-1 tracking-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          {mode === 'signin'
            ? 'Pick up where you left off.'
            : 'Track every deal, every dollar, every week.'}
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 tracking-wider uppercase">Email</label>
            <div className="relative mt-1">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 tracking-wider uppercase">Password</label>
            <div className="relative mt-1">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {info && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-accent-gradient disabled:bg-slate-300 disabled:bg-none text-white rounded-lg py-2.5 text-sm font-bold transition flex items-center justify-center gap-2 shadow-accent hover:opacity-95 disabled:opacity-100 disabled:shadow-none"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          {mode === 'signin' ? (
            <>
              No account yet?{' '}
              <button onClick={() => { setMode('signup'); setError(''); setInfo(''); }} className="text-indigo-600 hover:text-indigo-700 font-semibold">
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button onClick={() => { setMode('signin'); setError(''); setInfo(''); }} className="text-indigo-600 hover:text-indigo-700 font-semibold">
                Sign in
              </button>
            </>
          )}
        </div>

        {/* Value-prop strip — short anchor of what PRIM is */}
        <div className="mt-6 pt-5 border-t border-slate-200/70 text-center">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Built for USHA agents · Track every deal, every dollar, every week ·
            <span className="text-slate-400"> Smart Import · True CPA · Post-sale automation</span>
          </p>
        </div>
      </main>
    </div>
  );
}
