/**
 * Sender identity UI tests (spec §9, §9.1 — plan Tasks 9-10).
 *
 * What these protect, in order of blast radius:
 *   1. An agent with an incomplete identity can NEVER fire /api/email/send
 *      from the outreach modal — the gate's 428 is the backstop, but the UI
 *      must refuse first, with the missing fields NAMED (not a bare
 *      disabled button).
 *   2. D8: a Starter agent sees no sender section in Profile at all — a
 *      setup form for features they can't use is how prompts get ignored.
 *   3. The checklist task appears only for email-entitled agents and its
 *      completion is DERIVED from the identity, never tracked separately.
 *
 * Conventions per FollowupNextStep.test.jsx: mock the network boundary,
 * `await flush()` before any zero-call assertion (the load path yields
 * microtasks first — a sync assertion passes even when the component
 * calls out), and assert behavior, never styling.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('@/lib/postSaleEmails', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, loadSenderIdentity: vi.fn(), saveSenderIdentity: vi.fn() };
});
vi.mock('@/lib/useBetaFeature', () => ({ useBetaFeature: vi.fn() }));
vi.mock('@/lib/authedFetch', () => ({ authedFetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseConfigured: () => false,
}));

import { loadSenderIdentity } from '@/lib/postSaleEmails';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { authedFetch } from '@/lib/authedFetch';
import { sanitizeSenderIdentity, missingFields } from '@/lib/senderGate.mjs';
import { deriveTasks } from '@/lib/setupChecklist';
import SendOutreachEmail from './SendOutreachEmail';

const flush = () => act(async () => {});

const COMPLETE = sanitizeSenderIdentity({
  fromName: 'Mike Tolentino',
  fromAddress: 'mike@healthservicespro.com',
  businessName: 'HealthServicesPro',
  mailingAddress: '1550 Sawgrass Corporate Expressway, Sunrise FL 33323',
  npn: '88113311',
  signatureName: 'Michael Tolentino',
  signatureTitle: 'Owner, HealthServicesPro',
  bannerUrl: '',
});

const INCOMPLETE = sanitizeSenderIdentity({
  fromName: 'Mike Tolentino',
  fromAddress: 'mike@healthservicespro.com',
  // businessName, mailingAddress, npn all blank — three named gaps
});

const PROSPECT = {
  id: 'sender-test-p1',
  name: 'Ana Diaz',
  email: 'ana@example.com',
  emailLog: [],
};

let fetchSpy;
beforeEach(() => {
  vi.clearAllMocks();
  useBetaFeature.mockReturnValue({ canAccess: true, loading: false, profile: { id: 'u1', email: 'mike@healthservicespro.com' } });
  authedFetch.mockResolvedValue({ ok: true, json: async () => ({ domainStatus: 'unknown', domain: '' }) });
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ messageId: 'm1' }),
  });
});

async function openModal() {
  render(<SendOutreachEmail prospect={PROSPECT} onLogged={() => {}} />);
  await flush();
  const trigger = screen.getByTitle('Send an outreach email to this prospect');
  await act(async () => { fireEvent.click(trigger); });
  await flush();
}

// ---- 1. Incomplete identity: named fields, disabled send, zero calls ----

test('incomplete identity names the missing fields and never calls the API', async () => {
  loadSenderIdentity.mockResolvedValue(INCOMPLETE);
  await openModal();

  // The setup card names each gap in missingFields() order — same
  // predicate the server gate uses, so UI and 428 can never disagree.
  const card = screen.getByText(/Finish your sender setup/i).parentElement;
  expect(card.textContent).toMatch(/business name/i);
  expect(card.textContent).toMatch(/mailing address/i);
  expect(card.textContent).toMatch(/NPN/i);

  // No preview exists (renderOutreachTemplate returned null)…
  expect(screen.queryByText(/^Preview$/i)).toBeNull();
  // …and Send is disabled.
  const send = screen.getByRole('button', { name: /send now/i });
  expect(send.disabled).toBe(true);

  // Clicking anyway must not fire — flush FIRST (lane convention: the
  // send path yields before fetching, sync assertions can't fail).
  await act(async () => { fireEvent.click(send); });
  await flush();
  const emailCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/email/send'));
  expect(emailCalls.length).toBe(0);
});

test('the setup card deep-links to Profile → Sender via prim:open-profile', async () => {
  loadSenderIdentity.mockResolvedValue(INCOMPLETE);
  const seen = [];
  const listener = (e) => seen.push(e.detail?.section);
  window.addEventListener('prim:open-profile', listener);
  try {
    await openModal();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /open profile/i })); });
    expect(seen).toEqual(['sender']);
  } finally {
    window.removeEventListener('prim:open-profile', listener);
  }
});

// ---- 2. Complete identity: preview carries the identity, send fires ----

test('complete identity renders the tokenized preview and sends', async () => {
  loadSenderIdentity.mockResolvedValue(COMPLETE);
  await openModal();

  // Preview exists and the subject carries the agent's business — and
  // none of the retired identity (the §0 regression, at the UI layer).
  const subject = await screen.findByText(/HealthServicesPro/, { selector: '.font-semibold' });
  expect(subject.textContent).not.toMatch(/Prime Health Consultants/);

  const send = screen.getByRole('button', { name: /send now/i });
  expect(send.disabled).toBe(false);

  await act(async () => { fireEvent.click(send); });
  await flush();
  const emailCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/email/send'));
  expect(emailCalls.length).toBe(1);
  // Assert the PAYLOAD, not just the call: kind outreach, html carries the
  // agent identity and none of Julio's.
  const body = JSON.parse(emailCalls[0][1].body);
  expect(body.kind).toBe('outreach');
  expect(body.html).toContain('HealthServicesPro');
  expect(body.html).toContain('88113311');
  expect(body.html).not.toContain('Julio Fernandez');
  expect(body.html).not.toContain('19153319');
});

// ---- 3. A 428 from the server names the field and offers the deep link ----

test('server 428 setupRequired surfaces the Profile deep link', async () => {
  loadSenderIdentity.mockResolvedValue(COMPLETE);
  fetchSpy.mockResolvedValue({
    ok: false,
    status: 428,
    json: async () => ({ error: 'Add your NPN in Profile → Sender before sending outreach.', setupRequired: 'npn' }),
  });
  await openModal();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /send now/i })); });
  await flush();
  expect(screen.getByText(/Add your NPN/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /open profile/i })).toBeTruthy();
});

// ---- 4. D8 checklist scoping (deriveTasks is pure — test it directly) ----

test('checklist sender task exists only for email-entitled agents and derives completion', () => {
  const base = {
    onboardingCompleted: true, leadsCount: 1, ownAdvancesCount: 1,
    businessExpensesCount: 1, businessIncomeCount: 1, issuedLeadsCount: 1,
  };
  const starter = deriveTasks({ ...base, emailEntitled: false, senderIdentityComplete: false });
  expect(starter.find(t => t.id === 'sender')).toBeUndefined();

  const proIncomplete = deriveTasks({ ...base, emailEntitled: true, senderIdentityComplete: false });
  const task = proIncomplete.find(t => t.id === 'sender');
  expect(task).toBeTruthy();
  expect(task.done).toBe(false);
  expect(task.action).toBe('openSenderSetup');

  const proComplete = deriveTasks({ ...base, emailEntitled: true, senderIdentityComplete: true });
  expect(proComplete.find(t => t.id === 'sender').done).toBe(true);

  // Completion is DERIVED: the same identity that satisfies the gate
  // satisfies the checklist — one predicate, no separate tracking.
  expect(missingFields(COMPLETE, 'outreach').length).toBe(0);
  expect(missingFields(INCOMPLETE, 'outreach').length).toBeGreaterThan(0);
});
