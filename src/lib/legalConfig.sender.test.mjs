/**
 * Sender-aware CAN-SPAM footer tests — spec §8 (docs/superpowers/specs/
 * 2026-07-29-per-agent-sender-identity-design.md).
 *
 * Two behaviors, both load-bearing:
 *
 * 1. With a `sender`, the footer is the AGENT's — business name, mailing
 *    address, contact email — and carries NEITHER `LEGAL.company` NOR the
 *    `[mailing address — to be added]` placeholder. The placeholder
 *    shipping in a commercial email is the original ticket-#3 bug.
 *
 * 2. Without a `sender` the output is BYTE-IDENTICAL to what shipped
 *    before this change. The baselines below were captured from the
 *    unmodified module (commit d410b27) — any drift in the no-sender
 *    path is a regression on the exempt system-mail surface, not a
 *    formatting nit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGAL,
  mailingAddressOrPlaceholder,
  canSpamFooterHtml,
  canSpamFooterStandaloneHtml,
} from './legalConfig.mjs';

const URL = 'https://www.primtracker.com/api/email/unsubscribe/tok123';

const SENDER = {
  businessName: 'HealthServicesPro',
  mailingAddress: '1550 Sawgrass Corporate Expressway, Sunrise FL 33323',
  fromAddress: 'mike@healthservicespro.com',
};

// ---- Baselines captured from the PRE-CHANGE module (byte-exact) ----

const BASELINE_FOOTER_WITH_URL = "\n        <tr>\n          <td style=\"background:#F8FAFC; padding:18px 36px 22px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;\">\n            <strong style=\"color:#0F172A; font-size:12px;\">R&J Prime Consultancy LLC</strong><br/>\n            " + mailingAddressOrPlaceholder() + "<br/><br/>\n            <a href=\"https://www.primtracker.com/api/email/unsubscribe/tok123\" style=\"color:#64748B; text-decoration:underline;\">Unsubscribe</a> &middot; or email <a href=\"mailto:rjprimeconsult@gmail.com\" style=\"color:#64748B; text-decoration:underline;\">rjprimeconsult@gmail.com</a>\n          </td>\n        </tr>";

const BASELINE_FOOTER_NO_URL = "\n        <tr>\n          <td style=\"background:#F8FAFC; padding:18px 36px 22px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;\">\n            <strong style=\"color:#0F172A; font-size:12px;\">R&J Prime Consultancy LLC</strong><br/>\n            " + mailingAddressOrPlaceholder() + "<br/><br/>\n            <a href=\"mailto:rjprimeconsult@gmail.com?subject=unsubscribe\" style=\"color:#64748B; text-decoration:underline;\">Unsubscribe</a> &middot; or email <a href=\"mailto:rjprimeconsult@gmail.com\" style=\"color:#64748B; text-decoration:underline;\">rjprimeconsult@gmail.com</a>\n          </td>\n        </tr>";

const BASELINE_STANDALONE_WITH_URL = "<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" width=\"100%\" style=\"max-width:600px; margin:0 auto;\">\n        <tr>\n          <td style=\"background:#F8FAFC; padding:18px 36px 22px 36px; color:#64748B; font-size:11px; line-height:1.6; text-align:center; border-top:1px solid #E2E8F0;\">\n            <strong style=\"color:#0F172A; font-size:12px;\">R&J Prime Consultancy LLC</strong><br/>\n            " + mailingAddressOrPlaceholder() + "<br/><br/>\n            <a href=\"https://www.primtracker.com/api/email/unsubscribe/tok123\" style=\"color:#64748B; text-decoration:underline;\">Unsubscribe</a> &middot; or email <a href=\"mailto:rjprimeconsult@gmail.com\" style=\"color:#64748B; text-decoration:underline;\">rjprimeconsult@gmail.com</a>\n          </td>\n        </tr></table>";

// ---- canSpamFooterHtml with sender: the agent's footer, not LEGAL's ----

test('canSpamFooterHtml with sender renders business name, address, and contact email', () => {
  const html = canSpamFooterHtml({ unsubscribeUrl: URL, sender: SENDER });
  assert.ok(html.includes('HealthServicesPro'), 'business name missing');
  assert.ok(
    html.includes('1550 Sawgrass Corporate Expressway, Sunrise FL 33323'),
    'mailing address missing'
  );
  assert.ok(
    html.includes('mailto:mike@healthservicespro.com'),
    'fromAddress contact mailto missing'
  );
  assert.ok(html.includes(URL), 'unsubscribe link must survive the sender path');
});

test('canSpamFooterHtml with sender renders neither LEGAL.company nor the placeholder', () => {
  const html = canSpamFooterHtml({ unsubscribeUrl: URL, sender: SENDER });
  assert.ok(!html.includes(LEGAL.company), 'LEGAL.company leaked into an agent footer');
  assert.ok(
    !html.includes(mailingAddressOrPlaceholder()),
    'the [mailing address — to be added] placeholder leaked — this is ticket #3'
  );
});

test('canSpamFooterHtml escapes HTML in sender fields', () => {
  const html = canSpamFooterHtml({
    unsubscribeUrl: URL,
    sender: {
      businessName: 'A & B <Insurance>',
      mailingAddress: '1 Main St & Co',
      fromAddress: 'a@b.com',
    },
  });
  assert.ok(html.includes('A &amp; B &lt;Insurance&gt;'), 'businessName not escaped');
  assert.ok(html.includes('1 Main St &amp; Co'), 'mailingAddress not escaped');
  assert.ok(!html.includes('<Insurance>'), 'raw markup reached the footer');
});

// ---- Without sender: byte-identical to the pre-change output ----

test('canSpamFooterHtml without sender is byte-identical to the pre-change output (with url)', () => {
  assert.equal(canSpamFooterHtml({ unsubscribeUrl: URL }), BASELINE_FOOTER_WITH_URL);
});

test('canSpamFooterHtml with sender: null is byte-identical to the pre-change output', () => {
  assert.equal(
    canSpamFooterHtml({ unsubscribeUrl: URL, sender: null }),
    BASELINE_FOOTER_WITH_URL
  );
});

test('canSpamFooterHtml without sender or url is byte-identical to the pre-change output', () => {
  assert.equal(canSpamFooterHtml({}), BASELINE_FOOTER_NO_URL);
});

// ---- canSpamFooterStandaloneHtml: same pair ----

test('canSpamFooterStandaloneHtml with sender renders agent identity, never LEGAL or the placeholder', () => {
  const html = canSpamFooterStandaloneHtml({ unsubscribeUrl: URL, sender: SENDER });
  assert.ok(html.includes('HealthServicesPro'), 'business name missing');
  assert.ok(
    html.includes('1550 Sawgrass Corporate Expressway, Sunrise FL 33323'),
    'mailing address missing'
  );
  assert.ok(html.includes('mailto:mike@healthservicespro.com'), 'contact mailto missing');
  assert.ok(!html.includes(LEGAL.company), 'LEGAL.company leaked');
  assert.ok(!html.includes(mailingAddressOrPlaceholder()), 'placeholder leaked');
});

test('canSpamFooterStandaloneHtml without sender is byte-identical to the pre-change output', () => {
  assert.equal(
    canSpamFooterStandaloneHtml({ unsubscribeUrl: URL }),
    BASELINE_STANDALONE_WITH_URL
  );
  assert.equal(
    canSpamFooterStandaloneHtml({ unsubscribeUrl: URL, sender: null }),
    BASELINE_STANDALONE_WITH_URL
  );
});
