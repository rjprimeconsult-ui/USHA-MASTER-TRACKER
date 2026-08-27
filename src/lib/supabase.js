/**
 * Supabase client — singleton browser client for the PRIM app.
 *
 * Uses the publishable (anon) key, which is safe to ship in client code
 * because Row Level Security policies on each table enforce user_id = auth.uid().
 *
 * The service_role / secret key is NEVER imported here.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (typeof window !== 'undefined' && (!url || !anonKey)) {
  // eslint-disable-next-line no-console
  console.error('Supabase env vars missing. Check .env.local — you need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
}

// IMPORTANT: never pass empty strings here. createClient THROWS on an empty
// url ("supabaseUrl is required"), and this module is evaluated at module
// scope during server prerendering (e.g. the /_not-found page) — if the env
// isn't visible to that build step, the whole `next build` fails (this took
// down a Vercel deploy on 2026-06-12). Syntactically-valid placeholders keep
// module evaluation safe everywhere; all real usage is already gated behind
// supabaseConfigured(), so behavior with real env vars is unchanged.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // flowType intentionally left at the 'implicit' default. Password
      // recovery depends on it: the reset email must work when opened on a
      // DIFFERENT device than the one that requested it ("forgot on my mac,
      // want to log in on both" — ticket #4). Under 'pkce' the code verifier
      // lives in the requesting browser's localStorage and the link dies on
      // every other device. Do not change without re-testing cross-device
      // recovery. (Spec §6.1, 2026-08-26.)
    },
  },
);

// Helper: returns true if Supabase is configured (env vars present).
// Useful for graceful fallback to local mode during dev.
export const supabaseConfigured = () => !!(url && anonKey);
