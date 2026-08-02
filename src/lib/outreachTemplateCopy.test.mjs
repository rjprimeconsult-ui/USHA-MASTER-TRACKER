/**
 * Tokenized outreach template copy — the spec §0 regression guard.
 * (docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md §7)
 *
 * The bug these tests exist to catch: one agent's identity (Julio
 * Fernandez / Prime Health Consultants / NPN 19153319) hardcoded into the
 * subject, HTML body, plain-text alternative, signature, footer, banner
 * and CTA of every outreach email ANY agent sends. Rev 2 of the spec
 * asserted only on renderShell output and missed the subject + body
 * opener + all three text closings — so every assertion here runs against
 * ALL THREE parts (subject, html, text) of the fully-rendered result.
 *
 * Everything targets outreachTemplateCopy.mjs exports directly: the
 * wrapper outreachEmails.js imports './storage' extensionlessly and
 * cannot load under `node --test` — its delegation assertions live in
 * outreachEmails.registry.test.jsx (ui lane).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_META,
  buildTemplateCopy,
  renderOutreachTemplateCore,
} from './outreachTemplateCopy.mjs';
import { OUTREACH_UNSUBSCRIBE_PLACEHOLDER } from './legalConfig.mjs';
import { missingFields } from './senderGate.mjs';

// The retired pre-tokenization literals. '1550 Sawgrass Corporate Pkwy'
// (not the shorter '1550 Sawgrass') because Mike's own legitimate address
// also starts with '1550 Sawgrass' — the guard here is about JULIO's
// address leaking, not the street.
const RETIRED = [
  'Julio Fernandez',
  'Prime Health Consultants',
  '19153319',
  '1550 Sawgrass Corporate Pkwy',
  'rjprimehealth.com',
  'phc-banner',
];

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

// Julio is a REAL agent on the roster: his correct post-tokenization
// identity legitimately renders his own name/company/NPN/address. These
// are the same five values the stale-bundle guard exempts (Task 1).
const JULIO = {
  fromName: 'Julio Fernandez',
  fromAddress: 'julio.fernandez@rjprimehealth.com',
  businessName: 'Prime Health Consultants',
  mailingAddress: '1550 Sawgrass Corporate Pkwy, Sunrise, FL 33323',
  npn: '19153319',
  signatureName: 'Julio Fernandez',
  signatureTitle: '',
  bannerUrl: '',
};

const ANA = { name: 'Ana Diaz', email: 'ana@x.com' };

const EXPECTED_IDS = [
  'phc-outreach-1-initial',
  'phc-outreach-2-followup',
  'phc-outreach-3-final',
];

function renderFor(meta, sender, prospect = ANA, opts = {}) {
  const r = renderOutreachTemplateCore(meta, prospect, sender, opts);
  assert.ok(r, `render returned null for ${meta?.id}`);
  return r;
}

// ---------- The §0 guard: no retired literal in ANY part ----------

for (const meta of TEMPLATE_META) {
  test(`${meta.id}: subject, html AND text carry none of the retired literals (Mike sending)`, () => {
    const r = renderFor(meta, MIKE);
    for (const part of ['subject', 'html', 'text']) {
      for (const lit of RETIRED) {
        assert.ok(
          !String(r[part]).includes(lit),
          `${meta.id} ${part} still contains retired literal "${lit}"`
        );
      }
    }
  });

  test(`${meta.id}: html and text carry Mike's identity`, () => {
    const r = renderFor(meta, MIKE);
    for (const part of ['html', 'text']) {
      assert.ok(r[part].includes('Michael Tolentino'), `${part} missing signature name`);
      assert.ok(r[part].includes('HealthServicesPro'), `${part} missing business name`);
      assert.ok(r[part].includes('NPN: 88113311'), `${part} missing NPN line`);
      assert.ok(r[part].includes(MIKE.mailingAddress), `${part} missing mailing address`);
    }
    assert.ok(r.html.includes('mailto:mike@healthservicespro.com'), 'html missing CTA mailto');
    assert.ok(r.text.includes('mike@healthservicespro.com'), 'text missing contact address');
  });

  test(`${meta.id}: blank bannerUrl omits the banner block entirely (no <img)`, () => {
    const r = renderFor(meta, { ...MIKE, bannerUrl: '' });
    assert.ok(!r.html.includes('<img'), 'html renders an <img with no bannerUrl');
  });

  test(`${meta.id}: preheader div contains the template previewText`, () => {
    assert.equal(typeof meta.previewText, 'string');
    assert.ok(meta.previewText.length > 0, 'previewText must be non-empty (deliverability)');
    const r = renderFor(meta, MIKE);
    assert.ok(r.html.includes(meta.previewText), 'html missing preheader previewText');
  });

  test(`${meta.id}: unsubscribe sentinel present when no unsubscribeUrl passed`, () => {
    const r = renderFor(meta, MIKE);
    assert.ok(r.html.includes(OUTREACH_UNSUBSCRIBE_PLACEHOLDER));
  });

  test(`${meta.id}: "Licensed Independent Insurance Agency" pinned verbatim in html and text (spec §7.4)`, () => {
    const r = renderFor(meta, MIKE);
    assert.ok(r.html.includes('Licensed Independent Insurance Agency'));
    assert.ok(r.text.includes('Licensed Independent Insurance Agency'));
  });
}

test('template 1 subject carries the sending agent business name', () => {
  const r = renderFor(TEMPLATE_META[0], MIKE);
  assert.ok(r.subject.includes('HealthServicesPro'));
});

test('template 1 pins "within the next two hours" verbatim in html and text (spec §7.4)', () => {
  const r = renderFor(TEMPLATE_META[0], MIKE);
  assert.ok(r.html.includes('within the next two hours'));
  assert.ok(r.text.includes('within the next two hours'));
});

// ---------- Banner validation (https-only, attr-safe) ----------

test('an https bannerUrl renders the img with that src and business-name alt', () => {
  const r = renderFor(TEMPLATE_META[0], { ...MIKE, bannerUrl: 'https://x.com/b.jpg' });
  assert.ok(r.html.includes('<img'));
  assert.ok(r.html.includes('src="https://x.com/b.jpg"'));
  const alt = r.html.match(/alt="([^"]*)"/);
  assert.ok(alt && alt[1].includes('HealthServicesPro'), 'banner alt must carry the business name');
});

test('a javascript: bannerUrl renders NO img at all (https-only validation)', () => {
  const r = renderFor(TEMPLATE_META[0], { ...MIKE, bannerUrl: 'javascript:alert(1)' });
  assert.ok(!r.html.includes('<img'));
  assert.ok(!r.html.includes('javascript:alert'));
});

// ---------- signatureTitle: blank omits the whole line ----------

test('blank signatureTitle: no empty title line in html, no "Owner," literal anywhere', () => {
  const r = renderFor(TEMPLATE_META[0], { ...MIKE, signatureTitle: '' });
  assert.ok(!r.html.includes('Owner,'), 'html leaks a title line with blank signatureTitle');
});

test('blank signatureTitle: no blank line between name and email in text', () => {
  const r = renderFor(TEMPLATE_META[0], { ...MIKE, signatureTitle: '' });
  assert.ok(
    r.text.includes('Michael Tolentino\nmike@healthservicespro.com'),
    'text signature must go straight from name to email when title is blank'
  );
});

test('set signatureTitle renders as its own line in html and text', () => {
  const r = renderFor(TEMPLATE_META[0], MIKE);
  assert.ok(r.html.includes('Owner, HealthServicesPro'));
  assert.ok(
    r.text.includes('Michael Tolentino\nOwner, HealthServicesPro\nmike@healthservicespro.com')
  );
});

// ---------- Prospect tokens still work ----------

test('prospect first-name token: "Hello Ana," in html and text', () => {
  const r = renderFor(TEMPLATE_META[0], MIKE, ANA);
  assert.ok(r.html.includes('Hello Ana,'));
  assert.ok(r.text.includes('Hello Ana,'));
});

test('empty prospect name renders "Hello," (no dangling space)', () => {
  const r = renderFor(TEMPLATE_META[0], MIKE, { name: '', email: 'x@y.com' });
  assert.ok(r.html.includes('Hello,'));
  assert.ok(!r.html.includes('Hello ,'));
  assert.ok(r.text.includes('Hello,'));
});

// ---------- Identity is REQUIRED: no sender, no render ----------

test('renderOutreachTemplateCore with an empty sender returns null', () => {
  assert.equal(renderOutreachTemplateCore(TEMPLATE_META[0], ANA, {}, {}), null);
});

test('renderOutreachTemplateCore with an incomplete sender returns null (missingFields is the predicate)', () => {
  const incomplete = { ...MIKE, npn: '' };
  assert.ok(missingFields(incomplete, 'outreach').length > 0, 'fixture must be incomplete');
  assert.equal(renderOutreachTemplateCore(TEMPLATE_META[0], ANA, incomplete, {}), null);
  const noBusiness = { ...MIKE, businessName: '' };
  assert.equal(renderOutreachTemplateCore(TEMPLATE_META[0], ANA, noBusiness, {}), null);
});

test('renderOutreachTemplateCore with a null template returns null', () => {
  assert.equal(renderOutreachTemplateCore(null, ANA, MIKE, {}), null);
});

// ---------- Julio's own sends render HIS identity (the exemption story) ----------

test("Julio's complete identity legitimately renders his own values via tokens", () => {
  const r = renderFor(TEMPLATE_META[0], JULIO);
  assert.ok(r.html.includes('Julio Fernandez'));
  assert.ok(r.html.includes('Prime Health Consultants'));
  assert.ok(r.html.includes('NPN: 19153319'));
  assert.ok(r.html.includes(JULIO.mailingAddress));
  assert.ok(r.html.includes('mailto:julio.fernandez@rjprimehealth.com'));
  assert.ok(r.subject.includes('Prime Health Consultants'));
});

// ---------- Metadata split enforced ----------

test('TEMPLATE_META keeps the three ids in order and carries NO copy keys', () => {
  assert.deepEqual(TEMPLATE_META.map((t) => t.id), EXPECTED_IDS);
  for (const meta of TEMPLATE_META) {
    assert.ok(!('subject' in meta), `${meta.id} metadata leaks subject`);
    assert.ok(!('bodyHtmlInner' in meta), `${meta.id} metadata leaks bodyHtmlInner`);
    assert.ok(!('bodyText' in meta), `${meta.id} metadata leaks bodyText`);
  }
});

// ---------- buildTemplateCopy ----------

test('buildTemplateCopy resolves sender tokens into subject/bodyHtmlInner/bodyText', () => {
  const copy = buildTemplateCopy('phc-outreach-1-initial', MIKE);
  assert.ok(copy);
  assert.ok(copy.subject.includes('HealthServicesPro'));
  assert.ok(copy.bodyHtmlInner.includes('Michael Tolentino'));
  assert.ok(copy.bodyText.includes('Michael Tolentino'));
  assert.ok(!copy.bodyText.includes('{signature_name}'));
  assert.ok(!copy.bodyText.includes('{business_name}'));
  // Prospect tokens stay unresolved until render time.
  assert.ok(copy.bodyText.includes('{first_name_greeting}'));
});

test('buildTemplateCopy with an unknown id returns null', () => {
  assert.equal(buildTemplateCopy('nope', MIKE), null);
});
