/**
 * Shared bearer-token verifier for API routes.
 *
 * AI routes (smart imports, parse-statement, recategorize, vision
 * screenshot extract) used to be unauthenticated, so anyone with the
 * URL could trigger Anthropic API calls billed to PRIM. This helper
 * verifies the Supabase access token and returns the userId, or null
 * when the token is missing/invalid. Wrap with `requireUserId` to
 * fail fast with a 401 Response.
 */

import { createClient } from '@supabase/supabase-js';

export async function getUserIdFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const client = createClient(url, anon);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper for routes that always require auth. Returns
 * either the userId string or a 401 Response — caller checks
 * `instanceof Response` to short-circuit.
 *
 *   const auth = await requireUserId(req);
 *   if (auth instanceof Response) return auth;
 *   const userId = auth;
 */
export async function requireUserId(req) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return userId;
}
