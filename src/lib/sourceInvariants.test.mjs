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
  assert.ok(auth >= 0 && refusal > auth, 'the !userId refusal must sit directly after authenticate');
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
