'use client';
import { useEffect, useState } from 'react';
import { Shield, LogOut, X } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import { supabase } from '@/lib/supabase';

const KEY = 'prim_impersonating';

/**
 * Sticky banner shown when the current session was opened via the admin
 * "Sign in as <user>" flow. The redirect adds ?impersonating=1 to the URL;
 * we capture that on first mount and persist a flag in sessionStorage so
 * the banner survives client-side navigation in this tab.
 */
export default function ImpersonationBanner() {
  const { user, signOut } = useAuth();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // First-load capture: ?impersonating=1 in URL
    const url = new URL(window.location.href);
    if (url.searchParams.has('impersonating')) {
      sessionStorage.setItem(KEY, '1');
      url.searchParams.delete('impersonating');
      window.history.replaceState({}, '', url.toString());
    }
    setActive(sessionStorage.getItem(KEY) === '1');
  }, []);

  if (!active || !user) return null;

  const stop = async () => {
    sessionStorage.removeItem(KEY);
    await supabase.auth.signOut();
    // Close this tab so the admin returns to their original window
    window.close();
    // Fallback if popup-blocked (cannot close): redirect home
    window.location.href = '/';
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-rose-600 text-white px-4 py-2 flex items-center justify-between gap-3 shadow-lg">
      <div className="flex items-center gap-2 text-sm">
        <Shield size={16} className="flex-shrink-0" />
        <span className="font-semibold">Admin impersonation</span>
        <span className="opacity-90">— signed in as <b>{user.email}</b></span>
      </div>
      <button
        onClick={stop}
        className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1 text-xs font-semibold transition"
      >
        <LogOut size={12} /> End impersonation
      </button>
    </div>
  );
}
