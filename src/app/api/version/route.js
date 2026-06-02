/**
 * GET /api/version
 *
 * Returns the currently-deployed build identifier. The browser fetches this
 * on load (storing it as the "loaded" version) and re-fetches periodically.
 * When the value changes, it means a new deployment is live and the open tab
 * is running stale JS — the UpdateBanner then prompts a refresh.
 *
 * The identifier is Vercel's git commit SHA (set automatically on every
 * deployment). Falls back to 'dev' locally. force-dynamic + no-store so the
 * response always reflects the running deployment, never a cached value.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    'dev';
  const version = String(sha).slice(0, 7);

  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
