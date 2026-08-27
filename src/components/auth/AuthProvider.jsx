'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

const AuthContext = createContext({
  user: null,
  loading: true,
  recovery: false,
  clearRecovery: () => {},
  signOut: async () => {},
});

// Password-recovery detection is belt-and-braces (spec §3): the
// PASSWORD_RECOVERY event fires from a setTimeout(0) inside supabase's
// _initialize, and our subscription below races it — so the PRIMARY signal
// is a synchronous read of the URL hash at first render, before supabase
// can have cleared it. The guard matters: this component is prerendered
// during `next build`, where `window` does not exist (an unguarded read
// took down a deploy on 2026-06-12 — see src/lib/supabase.js header).
const sniffRecoveryHash = () =>
  typeof window !== 'undefined' && window.location.hash.includes('type=recovery');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(sniffRecoveryHash);

  useEffect(() => {
    if (!supabaseConfigured()) {
      setLoading(false);
      return;
    }
    // Initial session check
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setLoading(false);
    });
    // Listen for auth state changes (sign in / sign out / token refresh /
    // password recovery — the BACKUP recovery signal, see sniff above)
    // Note (spec §6.2): a recovery link clicked while a DIFFERENT user is
    // signed in replaces that session without a prompt (supabase-js
    // _saveSession). Accepted on record; nothing here fights it.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUser(session?.user || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const clearRecovery = useCallback(() => setRecovery(false), []);

  const signOut = async () => {
    await supabase.auth.signOut();
    // Force a clean reload so all in-memory state resets
    window.location.reload();
  };

  return (
    <AuthContext.Provider value={{ user, loading, recovery, clearRecovery, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
