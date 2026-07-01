/**
 * Blast webhook burst smoke-test.
 *
 * Fires a rapid burst of concurrent POSTs at a Ringy/Benepath/blast webhook and
 * reports status codes + latency. Purpose: catch a capture regression on the
 * hot path (like the 2026-07-01 rate-limiter incident, where an extra per-POST
 * DB round-trip added latency under a real 6,000-lead burst and dropped ~3,700
 * hits) BEFORE it ever reaches a real blast.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *   node scripts/blast-burst-smoketest.mjs <webhook-url> [count]
 *
 *   Example (use a TEST token / test account — see SAFETY):
 *     node scripts/blast-burst-smoketest.mjs \
 *       https://www.primtracker.com/api/ringy/webhook/<TEST_TOKEN> 500
 *
 * ── WHAT IT CHECKS ────────────────────────────────────────────────────────
 *   Every POST sends a disposition of "REPURPOSED" (matches the built-in blast
 *   pattern), so each hit exercises the real blast-increment path. It asserts:
 *     1. every request returns HTTP 200, and
 *     2. p95 latency stays well under a webhook timeout (default 3000ms).
 *   Non-200s or high latency = a capture-path regression. FAIL exits non-zero.
 *
 * ── THE REAL PROOF ────────────────────────────────────────────────────────
 *   HTTP 200 means the request was accepted; the GOLD-STANDARD check is that
 *   the counter actually moved. After a run, query Supabase and confirm
 *   blast_counters for the TEST account/day/tag increased by EXACTLY <count>:
 *     SELECT contacts FROM blast_counters
 *      WHERE user_id=(SELECT id FROM profiles WHERE email='<TEST_ACCOUNT>')
 *        AND run_date=CURRENT_DATE AND platform='Ringy' AND tag='REPURPOSED';
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────
 *   • Use a DEDICATED TEST token/account. This writes real blast counts to
 *     whatever account owns the token — never point it at a live agent's token.
 *   • It only bumps blast_counters (the REPURPOSED path returns before any
 *     prospect is created), so cleanup is one row:
 *       DELETE FROM blast_counters WHERE tag='REPURPOSED' AND run_date=CURRENT_DATE
 *         AND user_id=(SELECT id FROM profiles WHERE email='<TEST_ACCOUNT>');
 *   • Keep [count] reasonable (a few hundred to ~2000).
 */

const url = process.argv[2];
const count = Math.max(1, parseInt(process.argv[3] || '500', 10));
const FAIL_P95_MS = Number(process.env.FAIL_P95_MS || 3000);

if (!url || !/^https?:\/\/.+\/api\/(ringy|benepath|blast)\/.+/.test(url)) {
  console.error('Usage: node scripts/blast-burst-smoketest.mjs <webhook-url> [count]');
  console.error('  <webhook-url> must be a ringy/benepath/blast webhook URL that ends in a TEST token.');
  process.exit(2);
}

const bodyFor = (i) => JSON.stringify({
  disposition: 'REPURPOSED',                 // matches DEFAULT_BLAST_PATTERNS
  phone: `555-01${String(i).padStart(5, '0')}`,
  first_name: 'SMOKETEST',
  last_name: `x${i}`,
});

async function oneRequest(i) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyFor(i),
    });
    await res.text().catch(() => {});
    return { ok: res.status === 200, status: res.status, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, err: String(e?.message || e) };
  }
}

const started = performance.now();
const results = await Promise.all(Array.from({ length: count }, (_, i) => oneRequest(i)));
const wallMs = performance.now() - started;

const oks = results.filter((r) => r.ok).length;
const fails = results.length - oks;
const lat = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] || 0;
const statusCounts = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

console.log('\n=== Blast webhook burst smoke-test ===');
console.log(`URL:     ${url.replace(/\/[^/]+$/, '/<token>')}`);
console.log(`Sent:    ${count} concurrent POSTs in ${Math.round(wallMs)}ms (${Math.round((count / wallMs) * 1000)}/s)`);
console.log(`200 OK:  ${oks}    non-200/failed: ${fails}`);
console.log(`Status:  ${JSON.stringify(statusCounts)}`);
console.log(`Latency: p50 ${Math.round(pct(0.5))}ms | p95 ${Math.round(pct(0.95))}ms | max ${Math.round(lat[lat.length - 1] || 0)}ms`);

const passed = fails === 0 && pct(0.95) < FAIL_P95_MS;
console.log(`\nRESULT:  ${passed ? 'PASS ✅' : 'FAIL ❌'}   (need: 0 non-200s AND p95 < ${FAIL_P95_MS}ms)`);
console.log(`Then confirm blast_counters for the test account rose by EXACTLY ${count}. That's the real proof.\n`);
process.exit(passed ? 0 : 1);
