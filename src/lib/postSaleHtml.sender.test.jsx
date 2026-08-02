/**
 * renderPostSaleHtml sender-threading tests — spec §8 (docs/superpowers/
 * specs/2026-07-29-per-agent-sender-identity-design.md).
 *
 * Why this lives in the ui lane: postSaleHtml.js imports './agentProfile'
 * extensionlessly (which itself imports './storage'), so the module
 * cannot load under `node --test`. Storage is mocked with an in-memory
 * Map — no jsdom rendering, just module logic.
 *
 * The failure these tests exist to catch: canSpamFooterHtml learns the
 * `sender` param but renderPostSaleHtml never threads it through — then
 * every real post-sale send (route.js:361 and the SendWelcomeEmail
 * preview) keeps rendering LEGAL + the placeholder while the footer
 * tests stay green. The footer function has no direct production
 * callers; this file pins the intermediary.
 */
import { test, expect, vi } from 'vitest';

vi.mock('./storage', () => ({
  storage: {
    getItem: async () => null,
    setItem: async () => true,
  },
}));

import { renderPostSaleHtml } from './postSaleHtml';
import { LEGAL, mailingAddressOrPlaceholder } from './legalConfig.mjs';

const SENDER = {
  businessName: 'HealthServicesPro',
  mailingAddress: '1550 Sawgrass Corporate Expressway, Sunrise FL 33323',
  fromAddress: 'mike@healthservicespro.com',
};

// Minimal render fixture — every renderPostSaleHtml input is optional,
// but a realistic body/subject keeps the output honest.
const FIXTURE = {
  template: { fromName: 'Mike Tolentino', subject: 'Your new policy' },
  lead: { name: 'Ana Diaz', policyNumber: 'PN-1' },
  profile: { email: 'mike@healthservicespro.com' },
  agentProfile: { displayName: 'Mike Tolentino', accent: 'indigo' },
  resolvedBody: 'Welcome aboard, Ana.',
  resolvedSubject: 'Your new policy',
  unsubscribeUrl: 'https://www.primtracker.com/api/email/unsubscribe/tok123',
};

test('renderPostSaleHtml with sender renders the agent footer, not LEGAL or the placeholder', () => {
  const html = renderPostSaleHtml({ ...FIXTURE, sender: SENDER });
  expect(html).toContain('HealthServicesPro');
  expect(html).toContain('1550 Sawgrass Corporate Expressway, Sunrise FL 33323');
  expect(html).not.toContain(LEGAL.company);
  expect(html).not.toContain(mailingAddressOrPlaceholder());
});

test('renderPostSaleHtml without sender keeps the LEGAL footer exactly as today', () => {
  const html = renderPostSaleHtml({ ...FIXTURE });
  expect(html).toContain(LEGAL.company);
});
