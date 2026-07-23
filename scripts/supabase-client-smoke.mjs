/**
 * supabase-js client smoke test — run this after ANY @supabase/supabase-js bump.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *   `npm test` is `node --test src/lib/*.test.mjs` — pure-logic tests that
 *   never import supabase-js or storage.js. So a client upgrade passes 448
 *   tests and a clean build while being completely unverified at runtime.
 *   This script closes that gap: it exercises the EXACT supabase-js API
 *   surface PRIM depends on, against the real project, with whatever client
 *   version is currently installed.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *   node scripts/supabase-client-smoke.mjs <SUPABASE_URL> <ANON_KEY>
 *
 *   (Values are NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.)
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 *   READ-ONLY. Anon key only, so RLS blocks every row (empty results are the
 *   expected PASS). The one RPC call uses an all-zeros UUID and expects a
 *   permission error; even if grants regressed, blast_counters.user_id has a
 *   FK to auth.users so nothing can be written. No inserts, no updates.
 *
 * ── WHAT IT COVERS ────────────────────────────────────────────────────────
 *   1. storage.prefetch()'s .select().eq().in()  — the batched mount read
 *   2. cloudGet()'s .maybeSingle()
 *   3. .order().limit()
 *   4. auth.getSession()
 *   5. auth.onAuthStateChange() subscription shape
 *   6. .rpc() surfacing a permission error (revoke still enforced)
 *   7. realtime .channel().on().subscribe() reaching SUBSCRIBED
 *      (#7 is the important one after the 2.110 bump dropped the `ws`
 *      dependency in favour of native WebSocket.)
 *
 * Exits non-zero if any check fails.
 */
import { createClient } from '@supabase/supabase-js';

const [, , URL, KEY] = process.argv;
if (!URL || !KEY) {
  console.error('Usage: node scripts/supabase-client-smoke.mjs <SUPABASE_URL> <ANON_KEY>');
  process.exit(2);
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

console.log('\n=== supabase-js client smoke test ===');

// 1. The batched prefetch query (storage.prefetch)
try {
  const { data, error } = await supabase
    .from('user_kv').select('key,value')
    .eq('user_id', ZERO_UUID)
    .in('key', ['leads_v5', 'investments_v2', 'activities_v1']);
  check('prefetch .select().eq().in()', !error && Array.isArray(data), error ? error.message : `rows=${data.length}`);
} catch (e) { check('prefetch .select().eq().in()', false, e.message); }

// 2. Per-key read (storage.cloudGet)
try {
  const { error } = await supabase
    .from('user_kv').select('value')
    .eq('user_id', ZERO_UUID).eq('key', 'leads_v5').maybeSingle();
  check('cloudGet .maybeSingle()', !error, error?.message);
} catch (e) { check('cloudGet .maybeSingle()', false, e.message); }

// 3. Ordering / pagination
try {
  const { error } = await supabase.from('user_kv').select('key').order('key').limit(1);
  check('.order().limit()', !error, error?.message);
} catch (e) { check('.order().limit()', false, e.message); }

// 4. Session read
try {
  const { data, error } = await supabase.auth.getSession();
  check('auth.getSession()', !error && data && 'session' in data, error?.message);
} catch (e) { check('auth.getSession()', false, e.message); }

// 5. Auth listener shape (storage.js attaches one of these at module load)
try {
  const { data } = supabase.auth.onAuthStateChange(() => {});
  const ok = !!data?.subscription?.unsubscribe;
  if (ok) data.subscription.unsubscribe();
  check('auth.onAuthStateChange() shape', ok);
} catch (e) { check('auth.onAuthStateChange() shape', false, e.message); }

// 6. RPC path + the public-grant revoke still being enforced
try {
  const { error } = await supabase.rpc('increment_blast', {
    p_user: ZERO_UUID, p_date: '2000-01-01', p_platform: 'PROBE', p_tag: 'PROBE', p_inc: 0,
  });
  check('.rpc() surfaces permission error', !!error && /permission denied/i.test(error.message),
    error?.message || 'NO ERROR — anon can call increment_blast, revoke regressed!');
} catch (e) { check('.rpc() surfaces permission error', false, e.message); }

// 7. Realtime websocket (no `ws` package as of 2.110 — native WebSocket)
const status = await new Promise((resolve) => {
  const t = setTimeout(() => resolve('TIMEOUT'), 15000);
  try {
    const ch = supabase.channel('client-smoke')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_kv' }, () => {})
      .subscribe((s) => {
        if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(s)) {
          clearTimeout(t); supabase.removeChannel(ch); resolve(s);
        }
      });
  } catch (e) { clearTimeout(t); resolve('THREW: ' + e.message); }
});
check('realtime .channel().on().subscribe()', status === 'SUBSCRIBED', `status=${status}`);

console.log(`\nRESULT: ${fail === 0 ? 'PASS ✅' : 'FAIL ❌'}  (${pass} passed, ${fail} failed)\n`);
process.exit(fail === 0 ? 0 : 1);
