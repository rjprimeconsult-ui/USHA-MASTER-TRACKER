// CI tripwires for money-path invariants that live in route source text and
// can't be pinned by unit tests (the routes construct Stripe/Supabase clients
// at import time, and build+lint are proven blind to undefined identifiers in
// routes). A silent revert of any of these passes every other gate green —
// reading the source is the gate. This mirrors the subscription-enforcement
// plan's manual grep gates (5.4, 9.3) into the suite so CI runs them forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const read = (p) => readFileSync(path.join(process.cwd(), p), 'utf8');
const count = (src, re) => (src.match(re) || []).length;
const selectStrings = (src) => [...src.matchAll(/\.select\('([^']*)'\)/g)].map((m) => m[1]);

const CHECKOUT = 'src/app/api/stripe/create-checkout-session/route.js';

// The 8 uniform paid AI routes gated in plan Task 5.1.
const UNIFORM_GATED = [
  'src/app/api/import-leads-ai/route.js',
  'src/app/api/import-prospects-ai/route.js',
  'src/app/api/import-expenses-ai/route.js',
  'src/app/api/parse-statement-ai/route.js',
  'src/app/api/extract-screenshot-ai/route.js',
  'src/app/api/recategorize-ai/route.js',
  'src/app/api/followup-draft/route.js',
  'src/app/api/textdrip/extract-conversation/route.js',
];

// Surfaces that must NEVER be subscription-gated (spec §3 EXEMPT table):
// tickets are the locked user's escape hatch (both the mail helper AND the
// HTTP route a future gate would land on), welcome/reminder mail is
// PRIM-initiated, webform capture is inbound revenue.
const EXEMPT = [
  'src/lib/ticketEmails.js',
  'src/lib/welcomeEmails.js',
  'src/app/api/tickets/route.js',
  'src/app/api/reminders/route.js',
  'src/app/api/webforms/webhook/[token]/route.js',
];

const GATE_IDENTIFIERS = ['requireFullAccess', 'gateFromProfile'];

test('checkout is card-only for launch (spec D6 — no Cash App/Chime/Venmo/Link)', () => {
  assert.ok(
    read(CHECKOUT).includes("payment_method_types: ['card']"),
    'payment_method_types must pin card-only; removing it re-enables wallet methods silently'
  );
});

test('free trial is conditional on hadAnySub, omitted not zeroed, declared above the lookup try', () => {
  const src = read(CHECKOUT);
  const decl = src.indexOf('let hadAnySub = false');
  const listCall = src.indexOf('const existing = await stripe.subscriptions.list');
  const lookupTry = src.lastIndexOf('try {', listCall);
  assert.ok(decl >= 0 && listCall >= 0 && lookupTry >= 0, 'expected anchors missing from checkout route');
  assert.ok(
    decl < lookupTry,
    'hadAnySub must be declared ABOVE the lookup try — moved inside, the catch path throws ReferenceError (the rev-2 bug)'
  );
  assert.ok(
    src.includes('...(hadAnySub ? {} : { trial_period_days: TRIAL_DAYS })'),
    'trial_period_days must be spread-omitted for returning customers — an unconditional key restores repeat free trials'
  );
});

test('every uniform paid AI route gates once AND refuses with a 402 subscriptionRequired body', () => {
  for (const p of UNIFORM_GATED) {
    const src = read(p);
    assert.equal(count(src, /requireFullAccess\(auth\)/g), 1, `${p} must gate exactly once`);
    // The call alone is a no-op if the refusal block is deleted — pin both.
    assert.ok(
      /status: 402/.test(src) && src.includes('subscriptionRequired: true'),
      `${p} must actually refuse (402 + subscriptionRequired body), not just call the gate`
    );
  }
});

test('chat gates via requireFullAccess(userId) and refuses with a 402', () => {
  const src = read('src/app/api/chat/route.js');
  assert.equal(count(src, /requireFullAccess\(userId\)/g), 1);
  assert.ok(/status: 402/.test(src) && src.includes('subscriptionRequired: true'));
});

test('chat refuses anonymous requests (token-cost loophole closed, spec §11.5)', () => {
  const src = read('src/app/api/chat/route.js');
  const auth = src.indexOf('const userId = await authenticate(req)');
  const refusal = src.indexOf('if (!userId)');
  const spend = src.indexOf('new Anthropic(');
  assert.ok(auth >= 0 && refusal > auth, 'the !userId refusal must sit directly after authenticate');
  assert.ok(spend > refusal, 'the refusal must sit BEFORE the Anthropic client — after it, the tokens are already spent');
  assert.ok(/status: 401/.test(src), 'anonymous chat must 401 — an unauthenticated reply bills PRIM for tokens');
});

test('email/send gates from its profile SELECT and refuses with a 402 (the Resend spend path)', () => {
  const src = read('src/app/api/email/send/route.js');
  assert.ok(src.includes('gateFromProfile'), 'email/send must gate via gateFromProfile');
  assert.ok(
    /status: 402/.test(src) && src.includes('subscriptionRequired: true'),
    'email/send must refuse with a 402 subscriptionRequired body'
  );
  // The gate is only as good as its input: the PROFILE select (the one that
  // carries subscription_status) must also carry past_due_since.
  assert.ok(
    selectStrings(src).some((s) => s.includes('subscription_status') && s.includes('past_due_since')),
    'email/send profile SELECT must carry past_due_since alongside subscription_status'
  );
});

test('the client subscription hook SELECTs past_due_since (makes LOCKED reachable — spec §2)', () => {
  assert.ok(
    selectStrings(read('src/lib/subscription.js')).some(
      (s) => s.includes('subscription_status') && s.includes('past_due_since')
    ),
    'useSubscription SELECT must carry past_due_since or day-3 LOCKED never fires client-side'
  );
});

test('exempt surfaces (system mail, tickets, webform capture) are never subscription-gated', () => {
  for (const p of EXEMPT) {
    const src = read(p);
    for (const id of GATE_IDENTIFIERS) {
      assert.ok(!src.includes(id), `${p} must stay ungated (spec §3 EXEMPT) — found ${id}`);
    }
  }
});

test('the blast capture path carries no subscription gates (standing never-touch rule)', () => {
  const apiRoot = path.join(process.cwd(), 'src/app/api');
  const files = readdirSync(apiRoot, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('route.js') && /ringy|benepath|blast/i.test(f));
  assert.ok(files.length > 0, 'expected blast-path routes to exist under src/app/api');
  for (const f of files) {
    const src = readFileSync(path.join(apiRoot, f), 'utf8');
    for (const id of GATE_IDENTIFIERS) {
      assert.ok(!src.includes(id), `src/app/api/${f} must stay ungated — found ${id}`);
    }
  }
});

test('every admin route enforces MFA server-side (WISP gap #1 residual)', () => {
  // The client gate only controls rendering. If these calls disappear, a
  // stolen admin password reaches /api/admin/* directly again — including
  // impersonate, which mints a login link for ANY agent.
  const ADMIN_ROUTES = [
    'src/app/api/admin/broadcast/route.js',
    'src/app/api/admin/duplicate-leads/route.js',
    'src/app/api/admin/impersonate/route.js',
    'src/app/api/admin/phantom-bonuses/route.js',
    'src/app/api/admin/tickets/[id]/route.js',
  ];
  for (const p of ADMIN_ROUTES) {
    const src = read(p);
    assert.equal(count(src, /requireAdminMfa\(/g), 1, `${p} must call requireAdminMfa exactly once`);
    assert.ok(
      /if \(!mfa\.ok\)/.test(src),
      `${p} must ACT on the result — a call without the refusal is a no-op`
    );
    // The check has to sit behind the is_admin gate, not replace it.
    assert.ok(src.includes('is_admin'), `${p} must still check is_admin`);
  }
});

// ---- Routine Builder tripwires (spec §12) ----
const TICK = 'src/app/api/routine/tick/route.js';

test('routine tick: CRON_SECRET fail-closed, every query result checked, never a direct user_kv write', () => {
  const src = read(TICK);
  assert.ok(src.includes('process.env.CRON_SECRET') && /status: 401/.test(src) && src.includes('if (!expected ||'), 'fail-closed auth block');
  for (const id of ['sErr', 'pErr', 'subErr', 'logQ.error', 'blocksQ', 'dayQ', 'apptQ', 'fErr', 'cErr', 'rErr', 'uErr', 'hErr', 'phase B read failed', '.canAccess !== true']) assert.ok(src.includes(id), `missing error handling anchor ${id}`);
  assert.ok(src.includes(".rpc('routine_day_write'") && src.includes(".rpc('routine_appt_rows'"));
  for (const bad of [".from('user_kv').upsert(", ".from('user_kv').update(", ".from('user_kv').delete(", ".from('user_kv').insert("]) assert.ok(!src.includes(bad), `tick must never write user_kv directly: ${bad}`);
  assert.ok(!src.includes("eq('key', 'prospects_v1')"), 'tick must never select the prospects blob');
  assert.ok(selectStrings(src).some((s) => s.includes('subscription_tier') && s.includes('past_due_since')), 'profile SELECT must carry the 8 gate columns');
  assert.ok(src.includes('ignoreDuplicates: true'), 'claim-before-send');
});

test('pushServer checks error after select and upsert and returns failures', () => {
  const src = read('src/lib/pushServer.js');
  assert.ok(src.includes('if (error)') && src.includes('if (e2)'));
  assert.ok(src.includes('failures'));
  assert.ok(count(src, /return \{ ok: false, error/g) >= 2, 'prune returns failures instead of throwing');
});

test('routineLive has exactly one Date.parse (parseAppointmentTime); routineTick has none', () => {
  assert.equal(count(read('src/lib/routineLive.mjs'), /Date\.parse\(/g), 1);
  assert.equal(count(read('src/lib/routineTick.mjs'), /Date\.parse\(/g), 0);
});

test('payload builder is name-free: fixed appointment copy, "an appointment" for next items', () => {
  const src = read('src/lib/routineTick.mjs');
  const fn = src.slice(src.indexOf('export function buildPayload'));
  assert.ok(fn.includes("title: 'PRIM'") && fn.includes("'Appointment"));
  assert.ok(src.includes("'an appointment'"));
  assert.ok(!/prospect(Name|\.name)/.test(fn));
});

test('vercel.json keeps only daily crons (never sub-daily — Hobby build fails)', () => {
  const cfg = JSON.parse(read('vercel.json'));
  for (const c of cfg.crons || []) { const [min, hour] = c.schedule.split(' '); assert.ok(min !== '*' && hour !== '*', `sub-daily cron: ${c.schedule}`); }
});

test('sw.js: payload contract untouched; notificationclick picks the "/" client on the app origin and otherwise opens a window', () => {
  const src = read('public/sw.js');
  for (const k of ['data.title', 'data.body', 'data.tag', 'data.url', 'data.urgent']) assert.ok(src.includes(k), k);
  assert.ok(src.includes("pathname === '/'") && src.includes('self.location.origin') && src.includes("'prim:view'") && src.includes('openWindow'));
  assert.ok(src.indexOf('self.location.origin') < src.indexOf("pathname === '/'"), 'origin guard precedes the app-shell pick');
  assert.ok(src.includes("self.location.origin + '/'"), 'default url is the app origin');
});

test('routine SQL functions are security definer, legacy-string safe, and service-role only', () => {
  for (const f of ['supabase/routine-appt-rows-function.sql', 'supabase/routine-day-write-function.sql']) {
    const src = read(f).toLowerCase();
    for (const needle of ['security definer', 'jsonb_typeof', 'revoke execute', 'grant execute', 'to service_role', 'set search_path = public']) assert.ok(src.includes(needle), `${f} missing ${needle}`);
  }
  const w = read('supabase/routine-day-write-function.sql').toLowerCase();
  assert.ok(w.includes('on conflict (user_id, key) do nothing') && w.includes('for update'), 'row created empty and locked before read');
  assert.ok(w.includes("'expect'"), 'expected-version CAS');
  assert.ok(read('supabase/routine-tick-cron.sql').includes("'prim-routine-tick'"));
});

test('routine UI copy never says behind/missed/streak; amber hex nowhere in routine sources (spec §7b, §7d)', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['src/components/routine/NowCard.jsx', 'src/components/routine/Timeline.jsx', 'src/components/routine/TimelineBlock.jsx', 'src/components/routine/MobileRoutineList.jsx']) {
    const src = strip(read(f));
    const literals = src.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) || [];
    for (const lit of literals) assert.ok(!/\b(behind|missed|streak)\b/i.test(lit), `${f}: forbidden copy in ${lit}`);
  }
  const dir = path.join(process.cwd(), 'src/components/routine');
  for (const f of readdirSync(dir).filter((n) => !/\.test\.jsx?$/.test(n))) assert.ok(!strip(readFileSync(path.join(dir, f), 'utf8')).toLowerCase().includes('#f59e0b'), `${f} uses amber hex`);
  for (const f of readdirSync(path.join(process.cwd(), 'src/lib')).filter((n) => n.startsWith('routine') && !n.endsWith('.test.mjs'))) assert.ok(!strip(read('src/lib/' + f)).toLowerCase().includes('#f59e0b'), f);
});
