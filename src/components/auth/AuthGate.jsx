'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, Mail, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { OrbBackdrop } from '../motion/MotionPrimitives';
import MigrationPrompt from './MigrationPrompt';

// Routes that render fully WITHOUT authentication — marketing /
// pricing / legal pages. Everything else stays gated. Match by
// prefix so nested routes inherit (e.g. /landing/* ).
const PUBLIC_ROUTE_PREFIXES = ['/landing', '/pricing', '/privacy', '/terms'];

function isPublicRoute(pathname) {
  if (!pathname) return false;
  return PUBLIC_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * AuthGate — wraps the app and shows the sign-in / sign-up screen until the
 * user is authenticated. If Supabase isn't configured yet (no env vars), it
 * lets the app render in "local-only" mode for development. Public routes
 * (landing, pricing, legal) skip the gate entirely so unauth visitors can
 * see them.
 */
export default function AuthGate({ children }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  // Public marketing/legal pages bypass auth completely.
  if (isPublicRoute(pathname)) return children;

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
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
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
    <div className="min-h-screen bg-slate-50 relative flex items-center justify-center p-4">
      <OrbBackdrop />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white/85 backdrop-blur-2xl border border-white/60 rounded-2xl shadow-2xl shadow-indigo-500/10 max-w-md w-full p-8"
      >
        {/* Brand */}
        <div className="flex items-center gap-3 mb-6">
          <motion.div
            initial={{ rotate: -8, scale: 0.9 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14 }}
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30"
          >
            <Sparkles size={22} />
          </motion.div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 leading-none tracking-tight">PRIM</h1>
            <p className="text-xs text-slate-500 mt-1">Performance · Revenue · Investment Manager</p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {mode === 'signin' ? 'Sign in' : 'Create your account'}
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          {mode === 'signin'
            ? 'Welcome back. Pick up where you left off.'
            : 'Track your leads, commissions, and CPA in one place.'}
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
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg py-2.5 text-sm font-semibold transition flex items-center justify-center gap-2"
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
      </motion.div>
    </div>
  );
}
