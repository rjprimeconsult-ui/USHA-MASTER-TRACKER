/**
 * Wrapper/registry tests for outreachEmails.js after the Task-5 split
 * (spec §7.1): metadata stays on OUTREACH_TEMPLATES, copy moves to
 * outreachTemplateCopy.mjs, and renderOutreachTemplate delegates to the
 * core with opts.sender.
 *
 * Why this lives in the ui lane: outreachEmails.js imports './storage'
 * extensionlessly, so it cannot load under `node --test` (verified:
 * ERR_MODULE_NOT_FOUND). Storage is mocked with an in-memory Map — no
 * jsdom rendering, just module logic.
 */
import { test, expect, vi } from 'vitest';

const mem = vi.hoisted(() => new Map());

vi.mock('./storage', () => ({
  storage: {
    getItem: async (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: async (key, value) => {
      mem.set(key, value);
      return true;
    },
  },
}));

import {
  OUTREACH_TEMPLATES,
  getOutreachTemplate,
  renderOutreachTemplate,
} from './outreachEmails';

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

const ANA = { name: 'Ana Diaz', email: 'ana@x.com' };

test('importing outreachEmails does not throw and the registry keeps the ids outreachReminders depends on, in order', () => {
  // The import at the top of this file IS the §0 ReferenceError guard —
  // nothing may interpolate identity at module load any more.
  expect(OUTREACH_TEMPLATES.map((t) => t.id)).toEqual([
    'phc-outreach-1-initial',
    'phc-outreach-2-followup',
    'phc-outreach-3-final',
  ]);
});

test('registry entries are metadata only — no copy keys', () => {
  for (const t of OUTREACH_TEMPLATES) {
    expect(t).not.toHaveProperty('subject');
    expect(t).not.toHaveProperty('bodyHtmlInner');
    expect(t).not.toHaveProperty('bodyText');
  }
});

test('getOutreachTemplate finds by id and returns null for unknown ids', () => {
  expect(getOutreachTemplate('phc-outreach-2-followup')?.id).toBe('phc-outreach-2-followup');
  expect(getOutreachTemplate('nope')).toBeNull();
});

test('renderOutreachTemplate delegates to the core: complete sender renders that identity', () => {
  const r = renderOutreachTemplate(OUTREACH_TEMPLATES[0], ANA, { sender: MIKE });
  expect(r).not.toBeNull();
  expect(r.subject).toContain('HealthServicesPro');
  expect(r.html).toContain('Michael Tolentino');
  expect(r.html).toContain('NPN: 88113311');
  expect(r.text).toContain('Michael Tolentino');
  expect(r.html).not.toContain('Julio Fernandez');
  expect(r.text).not.toContain('Julio Fernandez');
  expect(r.recipient).toBe('ana@x.com');
});

test('renderOutreachTemplate without opts.sender returns null — identity is required (spec §7.2)', () => {
  expect(renderOutreachTemplate(OUTREACH_TEMPLATES[0], ANA)).toBeNull();
  expect(renderOutreachTemplate(OUTREACH_TEMPLATES[0], ANA, {})).toBeNull();
});

test('renderOutreachTemplate passes opts.unsubscribeUrl through to the core', () => {
  const r = renderOutreachTemplate(OUTREACH_TEMPLATES[0], ANA, {
    sender: MIKE,
    unsubscribeUrl: 'https://u.example/opt-out',
  });
  expect(r.html).toContain('https://u.example/opt-out');
});
