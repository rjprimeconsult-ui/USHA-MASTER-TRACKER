import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_FIELD_CAPS,
  sanitizeSenderIdentity,
  missingFields,
  evaluate,
  selectLane,
  buildFromHeaders,
  RETIRED_LITERALS,
  staleLiteralViolation,
} from './senderGate.mjs';
import { mailingAddressOrPlaceholder } from './legalConfig.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_FIELDS = [
  'fromName', 'fromAddress', 'businessName', 'mailingAddress',
  'npn', 'signatureName', 'signatureTitle', 'bannerUrl',
];

// A complete, outreach-ready identity that contains NONE of the retired
// literals — safe for both gate tests and stale-guard non-exemption tests.
function completeIdentity(over = {}) {
  return {
    fromName: 'Ana Smith',
    fromAddress: 'ana@example.com',
    businessName: 'Acme Insurance Group',
    mailingAddress: '12 Main Street, Miami, FL 33101',
    npn: '5551234',
    signatureName: 'Ana Smith',
    signatureTitle: 'Licensed Agent',
    bannerUrl: '',
    ...over,
  };
}

// Task 5's MIKE fixture — the sending agent whose stale bundle must be caught.
const MIKE = {
  fromName: 'Mike Tolentino',
  fromAddress: 'mike@healthservicespro.com',
  businessName: 'HealthServicesPro',
  mailingAddress: '1550 Sawgrass Corporate Expressway, Sunrise FL 33323',
  npn: '88113311',
  signatureName: 'Michael Tolentino',
  signatureTitle: 'Owner, HealthServicesPro',
  bannerUrl: '',
};

// Julio's real identity (spec §6) — five of the six retired literals are
// substrings of his own gate-validated values, so every hit must be exempt.
const JULIO = {
  signatureName: 'Julio Fernandez',
  businessName: 'Prime Health Consultants',
  npn: '19153319',
  mailingAddress: '1550 Sawgrass Corporate Pkwy, Sunrise, FL 33323',
  fromAddress: 'julio.fernandez@rjprimehealth.com',
};

// ---------------------------------------------------------------------------
// sanitizeSenderIdentity — THE whitelist (spec §3.1)
// ---------------------------------------------------------------------------

test('sanitizeSenderIdentity preserves all eight fields', () => {
  const raw = {
    fromName: 'Mike Tolentino',
    fromAddress: 'mike@healthservicespro.com',
    businessName: 'HealthServicesPro',
    mailingAddress: '1550 Sawgrass Corporate Expressway, Sunrise FL 33323',
    npn: '88113311',
    signatureName: 'Michael Tolentino',
    signatureTitle: 'Owner, HealthServicesPro',
    bannerUrl: 'https://x.com/banner.jpg',
  };
  const out = sanitizeSenderIdentity(raw);
  assert.deepEqual(out, raw);
  // Exact key set — a field dropped from IDENTITY_FIELD_CAPS vanishes here.
  assert.deepEqual(Object.keys(out).sort(), [...ALL_FIELDS].sort());
});

test('sanitizeSenderIdentity enforces the per-field caps', () => {
  const expectedCaps = {
    fromName: 200,
    fromAddress: 254,
    businessName: 200,
    mailingAddress: 300,
    npn: 20,
    signatureName: 200,
    signatureTitle: 120,
    bannerUrl: 500,
  };
  assert.deepEqual(IDENTITY_FIELD_CAPS, expectedCaps);
  for (const [field, cap] of Object.entries(expectedCaps)) {
    const out = sanitizeSenderIdentity({ [field]: 'x'.repeat(cap + 50) });
    assert.equal(out[field].length, cap, `${field} not capped at ${cap}`);
  }
});

test('sanitizeSenderIdentity maps absent/null/undefined to empty strings', () => {
  for (const raw of [{}, null, undefined, { fromName: null, npn: undefined }]) {
    const out = sanitizeSenderIdentity(raw);
    for (const field of ALL_FIELDS) {
      assert.equal(out[field], '', `${field} should be '' for ${JSON.stringify(raw)}`);
    }
  }
});

test('sanitizeSenderIdentity coerces a stored number via String() — deliberately', () => {
  const out = sanitizeSenderIdentity({ npn: 19153319 });
  assert.equal(out.npn, '19153319');
});

test('sanitizeSenderIdentity trims and is idempotent', () => {
  const messy = {
    fromName: '  Mike Tolentino  ',
    fromAddress: ' mike@healthservicespro.com ',
    businessName: '  HealthServicesPro',
    mailingAddress: `  ${'1550 Sawgrass '.repeat(40)}`, // overlong + padded
    npn: 88113311,
    signatureName: 'Michael Tolentino   ',
    signatureTitle: '',
    bannerUrl: null,
  };
  const once = sanitizeSenderIdentity(messy);
  assert.equal(once.fromName, 'Mike Tolentino');
  assert.deepEqual(sanitizeSenderIdentity(once), once);
});

// ---------------------------------------------------------------------------
// missingFields — per-kind requirements in precedence order (spec §6)
// ---------------------------------------------------------------------------

test('missingFields: empty identity, outreach — all five in report order', () => {
  assert.deepEqual(
    missingFields({}, 'outreach'),
    ['from_name', 'from_address', 'business_name', 'mailing_address', 'npn']
  );
});

test('missingFields: empty identity, post-sale — same minus npn', () => {
  assert.deepEqual(
    missingFields({}, 'post-sale'),
    ['from_name', 'from_address', 'business_name', 'mailing_address']
  );
});

test('missingFields never contains a domain entry — domain routes, never blocks (D2)', () => {
  const identities = [
    {},
    completeIdentity(),
    completeIdentity({ fromAddress: 'someone@totally-unverified-domain.example' }),
  ];
  for (const id of identities) {
    for (const kind of ['outreach', 'post-sale']) {
      for (const entry of missingFields(id, kind)) {
        assert.ok(!/domain/i.test(entry), `unexpected domain entry '${entry}'`);
      }
    }
  }
});

test('missingFields: blank fromName with all else filled — the "My name is , …" guard', () => {
  assert.deepEqual(missingFields(completeIdentity({ fromName: '' }), 'outreach'), ['from_name']);
  assert.deepEqual(missingFields(completeIdentity({ fromName: '   ' }), 'outreach'), ['from_name']);
});

test('missingFields: invalid fromAddress with all else filled', () => {
  assert.deepEqual(missingFields(completeIdentity({ fromAddress: 'not-an-email' }), 'outreach'), ['from_address']);
});

test('missingFields: the legal-pages placeholder can never satisfy mailing_address (ticket #3)', () => {
  const id = completeIdentity({ mailingAddress: mailingAddressOrPlaceholder() });
  assert.deepEqual(missingFields(id, 'outreach'), ['mailing_address']);
  assert.deepEqual(missingFields(id, 'post-sale'), ['mailing_address']);
});

test('missingFields: complete identity is complete; npn is outreach-only', () => {
  assert.deepEqual(missingFields(completeIdentity(), 'outreach'), []);
  assert.deepEqual(missingFields(completeIdentity(), 'post-sale'), []);
  const noNpn = completeIdentity({ npn: '' });
  assert.deepEqual(missingFields(noNpn, 'post-sale'), []);
  assert.deepEqual(missingFields(noNpn, 'outreach'), ['npn']);
});

// ---------------------------------------------------------------------------
// evaluate — the gate (spec §6)
// ---------------------------------------------------------------------------

test('evaluate: kind welcome passes regardless of readerResult', () => {
  const readerResults = [
    undefined,
    { ok: false, reason: 'threw' },
    { ok: false, reason: 'absent' },
    { ok: false, reason: 'invalid', identity: completeIdentity({ fromAddress: 'bad' }) },
    { ok: true, identity: completeIdentity() },
  ];
  for (const readerResult of readerResults) {
    const r = evaluate({ kind: 'welcome', readerResult });
    assert.equal(r.ok, true);
  }
});

test('evaluate: reader threw — 503 identity_unavailable (transient, not setup)', () => {
  for (const kind of ['outreach', 'post-sale']) {
    const r = evaluate({ kind, readerResult: { ok: false, reason: 'threw' } });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.equal(r.setupRequired, 'identity_unavailable');
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
  }
});

test("evaluate: reason 'absent' — 428 from_name (the empty identity's first gap)", () => {
  const r = evaluate({ kind: 'outreach', readerResult: { ok: false, reason: 'absent' } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 428);
  assert.equal(r.setupRequired, 'from_name');
});

test("evaluate: reason 'invalid' with a full row — 428 from_address, not fields already filled", () => {
  // The reader CARRIES the row it read (spec §6 reader trap): an agent with
  // every field filled and a typo'd address is told about the address.
  const fullBadAddress = completeIdentity({ fromAddress: 'mike-at-healthservicespro' });
  const r = evaluate({
    kind: 'outreach',
    readerResult: { ok: false, reason: 'invalid', identity: fullBadAddress },
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 428);
  assert.equal(r.setupRequired, 'from_address');
});

test('evaluate: complete identity passes and returns it', () => {
  const identity = completeIdentity();
  const r = evaluate({ kind: 'outreach', readerResult: { ok: true, identity } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.identity, identity);
});

test('evaluate binding invariant: setupRequired === missingFields(identityUsed, kind)[0] for every non-threw case', () => {
  const fullBadAddress = completeIdentity({ fromAddress: 'nope' });
  const cases = [
    { readerResult: { ok: false, reason: 'absent' }, identityUsed: {} },
    { readerResult: { ok: false, reason: 'invalid', identity: fullBadAddress }, identityUsed: fullBadAddress },
    { readerResult: { ok: true, identity: completeIdentity({ businessName: '' }) }, identityUsed: completeIdentity({ businessName: '' }) },
    { readerResult: { ok: true, identity: completeIdentity({ mailingAddress: '' }) }, identityUsed: completeIdentity({ mailingAddress: '' }) },
    { readerResult: { ok: true, identity: completeIdentity({ npn: '' }) }, identityUsed: completeIdentity({ npn: '' }) },
    { readerResult: { ok: true, identity: completeIdentity() }, identityUsed: completeIdentity() },
  ];
  for (const kind of ['outreach', 'post-sale']) {
    for (const { readerResult, identityUsed } of cases) {
      const expected = missingFields(identityUsed, kind);
      const r = evaluate({ kind, readerResult });
      if (expected.length === 0) {
        assert.equal(r.ok, true, `${kind}: expected pass, got ${JSON.stringify(r)}`);
      } else {
        assert.equal(r.ok, false);
        assert.equal(r.status, 428);
        assert.equal(r.setupRequired, expected[0],
          `${kind}: setupRequired must be the first missing field`);
      }
    }
  }
});

test('evaluate: every refusal carries a non-empty error string', () => {
  const refusals = [
    evaluate({ kind: 'outreach', readerResult: { ok: false, reason: 'threw' } }),
    evaluate({ kind: 'outreach', readerResult: { ok: false, reason: 'absent' } }),
    evaluate({ kind: 'outreach', readerResult: { ok: false, reason: 'invalid', identity: completeIdentity({ fromAddress: 'bad' }) } }),
    evaluate({ kind: 'outreach', readerResult: { ok: true, identity: completeIdentity({ fromName: '' }) } }),
    evaluate({ kind: 'outreach', readerResult: { ok: true, identity: completeIdentity({ businessName: '' }) } }),
    evaluate({ kind: 'outreach', readerResult: { ok: true, identity: completeIdentity({ mailingAddress: '' }) } }),
    evaluate({ kind: 'outreach', readerResult: { ok: true, identity: completeIdentity({ npn: '' }) } }),
    evaluate({ kind: 'post-sale', readerResult: { ok: true, identity: completeIdentity({ mailingAddress: '' }) } }),
  ];
  for (const r of refusals) {
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.trim().length > 0,
      `refusal missing error string: ${JSON.stringify(r)}`);
  }
});

// ---------------------------------------------------------------------------
// selectLane — domain status routes, never blocks (spec §5)
// ---------------------------------------------------------------------------

test("selectLane: 'verified' → 'own'", () => {
  assert.equal(selectLane('verified'), 'own');
});

test("selectLane: 'unverified' → 'shared'", () => {
  assert.equal(selectLane('unverified'), 'shared');
});

test("selectLane: 'unknown' → 'shared', never 'own' (a Resend outage must not forge From)", () => {
  assert.equal(selectLane('unknown'), 'shared');
});

// ---------------------------------------------------------------------------
// buildFromHeaders — both lanes (spec §5, §6)
// ---------------------------------------------------------------------------

const GLOBAL_FROM = 'PRIM <mail@primtracker.com>';

test('buildFromHeaders: own lane — From the agent, reply-to the agent', () => {
  const { fromHeader, replyTo } = buildFromHeaders({
    identity: MIKE, lane: 'own', globalFrom: GLOBAL_FROM,
  });
  assert.equal(fromHeader, 'Mike Tolentino <mike@healthservicespro.com>');
  assert.equal(replyTo, 'mike@healthservicespro.com');
});

test('buildFromHeaders: shared lane — shared mailbox, agent display name, reply-to the IDENTITY address (not fallbackReplyTo)', () => {
  const { fromHeader, replyTo } = buildFromHeaders({
    identity: MIKE, lane: 'shared', globalFrom: GLOBAL_FROM,
    fallbackName: 'someone-else', fallbackReplyTo: 'profile@elsewhere.com',
  });
  assert.equal(fromHeader, 'Mike Tolentino <mail@primtracker.com>');
  assert.equal(replyTo, 'mike@healthservicespro.com');
  assert.notEqual(replyTo, 'profile@elsewhere.com');
});

test('buildFromHeaders: identityless (welcome) — fallbackName + fallbackReplyTo on the shared lane', () => {
  const { fromHeader, replyTo } = buildFromHeaders({
    identity: null, lane: 'shared', globalFrom: GLOBAL_FROM,
    fallbackName: 'juan', fallbackReplyTo: 'juan@gmail.com',
  });
  assert.equal(fromHeader, 'juan <mail@primtracker.com>');
  assert.equal(replyTo, 'juan@gmail.com');
});

test('buildFromHeaders: bare globalFrom without angle brackets works', () => {
  const { fromHeader } = buildFromHeaders({
    identity: MIKE, lane: 'shared', globalFrom: 'mail@primtracker.com',
  });
  assert.equal(fromHeader, 'Mike Tolentino <mail@primtracker.com>');
});

// ---------------------------------------------------------------------------
// staleLiteralViolation — stale-bundle guard with identity exemption (spec §6)
// ---------------------------------------------------------------------------

test('RETIRED_LITERALS pins exactly the six pre-tokenization strings', () => {
  assert.deepEqual(RETIRED_LITERALS, [
    'Julio Fernandez',
    'Prime Health Consultants',
    '19153319',
    '1550 Sawgrass',
    'rjprimehealth.com',
    'phc-banner',
  ]);
});

test('staleLiteralViolation: Julio literal in a Mike send is refused', () => {
  const hit = staleLiteralViolation({
    subject: 'Health insurance quotes',
    body: '',
    html: '<p>My name is Julio Fernandez, and I am the owner of…</p>',
  }, MIKE);
  assert.equal(hit, 'Julio Fernandez');
});

test('staleLiteralViolation scans subject, body AND html', () => {
  const neutral = completeIdentity();
  assert.equal(staleLiteralViolation({ subject: 'From Prime Health Consultants', body: '', html: '' }, neutral), 'Prime Health Consultants');
  assert.equal(staleLiteralViolation({ subject: '', body: 'NPN: 19153319', html: '' }, neutral), '19153319');
  assert.equal(staleLiteralViolation({ subject: '', body: '', html: '<img src="cdn/phc-banner.png"/>' }, neutral), 'phc-banner');
});

test('staleLiteralViolation: every retired literal is caught for a non-exempt sender', () => {
  const neutral = completeIdentity(); // contains none of the literals
  for (const lit of RETIRED_LITERALS) {
    const hit = staleLiteralViolation({ subject: '', body: '', html: `payload with ${lit} inside` }, neutral);
    assert.equal(hit, lit);
  }
});

test("staleLiteralViolation: Julio's own five literals are exempt for Julio", () => {
  const julioLiterals = [
    'Julio Fernandez',
    'Prime Health Consultants',
    '19153319',
    '1550 Sawgrass',
    'rjprimehealth.com',
  ];
  for (const lit of julioLiterals) {
    const hit = staleLiteralViolation({ subject: '', body: '', html: `signed by ${lit} today` }, JULIO);
    assert.equal(hit, null, `'${lit}' must be exempt for Julio's own identity`);
  }
});

test("staleLiteralViolation: 'phc-banner' is never exempt — not for Mike, not even for Julio", () => {
  const payload = { subject: '', body: '', html: '<img src="https://cdn/phc-banner.jpg"/>' };
  assert.equal(staleLiteralViolation(payload, MIKE), 'phc-banner');
  assert.equal(staleLiteralViolation(payload, JULIO), 'phc-banner');
});

test('staleLiteralViolation: clean payload → null', () => {
  const payload = {
    subject: 'Health insurance quotes for you — HealthServicesPro',
    body: 'My name is Michael Tolentino, and I am the owner of HealthServicesPro.',
    html: '<p>My name is Michael Tolentino.</p>',
  };
  assert.equal(staleLiteralViolation(payload, MIKE), null);
  assert.equal(staleLiteralViolation(payload, {}), null);
});
