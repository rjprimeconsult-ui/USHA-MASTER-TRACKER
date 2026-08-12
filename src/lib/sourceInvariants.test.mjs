// CI tripwires for money-path invariants that live in route source text and
// can't be pinned by unit tests (the routes construct Stripe/Supabase clients
// at import time, and build+lint are proven blind to undefined identifiers in
// routes). A silent revert of any of these passes every other gate green —
// reading the source is the gate. This mirrors the subscription-enforcement
// plan's manual grep gates (5.4, 9.3) into the suite so CI runs them forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p) => readFileSync(path.join(process.cwd(), p), 'utf8');
const count = (src, re) => (src.match(re) || []).length;

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

// System mail that must NEVER be subscription-gated (spec §3 EXEMPT table):
// tickets are the locked user's escape hatch, welcome/reminder mail is
// PRIM-initiated, webform capture is inbound revenue.
const EXEMPT = [
  'src/lib/ticketEmails.js',
  'src/lib/welcomeEmails.js',
  'src/app/api/reminders/route.js',
  'src/app/api/webforms/webhook/[token]/route.js',
];

test('checkout is card-only for launch (spec D6 — no Cash App/Chime/Venmo/Link)', () => {
  assert.ok(
    read(CHECKOUT).includes("payment_method_types: ['card']"),
    'payment_method_types must pin card-only; removing it re-enables wallet methods silently'
  );
});

test('free trial is conditional on hadAnySub and omitted (not zeroed) for returning customers', () => {
  const src = read(CHECKOUT);
  assert.ok(
    src.includes('let hadAnySub = false'),
    'hadAnySub must be hoisted above the lookup try (catch path must not throw ReferenceError)'
  );
  assert.ok(
    src.includes('...(hadAnySub ? {} : { trial_period_days: TRIAL_DAYS })'),
    'trial_period_days must be spread-omitted for returning customers — an unconditional key restores repeat free trials'
  );
});

test('every uniform paid AI route carries exactly one requireFullAccess(auth) gate', () => {
  for (const p of UNIFORM_GATED) {
    assert.equal(count(read(p), /requireFullAccess\(auth\)/g), 1, `${p} must gate exactly once`);
  }
});

test('chat gates via requireFullAccess(userId)', () => {
  assert.equal(count(read('src/app/api/chat/route.js'), /requireFullAccess\(userId\)/g), 1);
});

test('the SELECTs that make LOCKED reachable carry past_due_since', () => {
  // Client hook: spec §2 calls this "the one change that makes the client
  // enforcement real" — without the column, day-3 LOCKED never fires.
  assert.match(read('src/lib/subscription.js'), /\.select\('[^']*past_due_since[^']*'\)/);
  // email/send gates from its own profile SELECT rather than requireFullAccess.
  assert.match(read('src/app/api/email/send/route.js'), /\.select\('[^']*past_due_since[^']*'\)/);
});

test('exempt system mail and webform capture are never subscription-gated', () => {
  for (const p of EXEMPT) {
    const src = read(p);
    assert.ok(
      !src.includes('requireFullAccess') && !src.includes('gateFromProfile'),
      `${p} must stay ungated (spec §3 EXEMPT)`
    );
  }
});
