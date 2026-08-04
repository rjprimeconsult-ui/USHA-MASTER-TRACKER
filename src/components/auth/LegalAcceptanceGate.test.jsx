/**
 * Component tests for the clickwrap acceptance gate.
 *
 * Every assertion here is a legal guarantee, not a UI preference:
 *   - an agent with no acceptance on file MUST be blocked (that's the assent)
 *   - an agent who already accepted the CURRENT version must NOT be nagged
 *   - a signup-time acceptance must carry through to the app (no double prompt)
 *   - a STALE-version acceptance MUST re-prompt (nobody is silently bound to
 *     terms they never saw)
 *   - the modal must have NO dismiss path (a skip button would reduce this
 *     back to the unenforceable browsewrap it replaces)
 *   - a failed write must NOT close the gate (we'd have no record of assent)
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('@/lib/storage', () => ({
  storage: { getItem: vi.fn(), setItem: vi.fn() },
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn(), updateUser: vi.fn() } },
  supabaseConfigured: () => true,
}));

import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { buildAcceptanceRecord, CURRENT_LEGAL_VERSION } from '@/lib/legalAcceptance.mjs';
import LegalAcceptanceGate from './LegalAcceptanceGate';

const flush = () => act(async () => {});
const HEADING = /Please review our Terms and Privacy Policy/i;

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.getUser.mockResolvedValue({ data: { user: { user_metadata: {} } } });
  supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
  storage.setItem.mockResolvedValue(undefined);
});

test('blocks an agent with no acceptance on file', async () => {
  storage.getItem.mockResolvedValue(null);
  render(<LegalAcceptanceGate />);
  await flush();
  expect(screen.getByText(HEADING)).toBeTruthy();
  // All three documents are linked and open in a new tab — reasonable notice
  // requires the terms actually be reachable at the moment of assent.
  for (const [label, href] of [['Terms of Service', '/terms'], ['Privacy Policy', '/privacy'], ['Data Processing Addendum', '/dpa']]) {
    const link = screen.getByRole('link', { name: new RegExp(label, 'i') });
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
  }
});

test('does NOT prompt an agent who already accepted the current version', async () => {
  storage.getItem.mockResolvedValue(JSON.stringify(buildAcceptanceRecord({ source: 'app' })));
  render(<LegalAcceptanceGate />);
  await flush();
  expect(screen.queryByText(HEADING)).toBeNull();
});

test('re-prompts when the stored acceptance is for an OLDER document version', async () => {
  storage.getItem.mockResolvedValue(JSON.stringify({
    version: '1900-01-01', acceptedAt: '2026-01-01T00:00:00.000Z', documents: ['terms'],
  }));
  render(<LegalAcceptanceGate />);
  await flush();
  expect(screen.getByText(HEADING)).toBeTruthy();
});

test('a signup-time acceptance in auth metadata carries through — no double prompt', async () => {
  storage.getItem.mockResolvedValue(null); // nothing in storage yet (first sign-in)
  const signupRecord = buildAcceptanceRecord({ source: 'signup' });
  supabase.auth.getUser.mockResolvedValue({
    data: { user: { user_metadata: { legal_acceptance: signupRecord } } },
  });

  render(<LegalAcceptanceGate />);
  await flush();

  expect(screen.queryByText(HEADING)).toBeNull();
  // and it is backfilled into storage so the next load answers locally
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  const [key, value] = storage.setItem.mock.calls[0];
  expect(key).toBe('legal_acceptance_v1');
  expect(JSON.parse(value).source).toBe('signup');
});

test('accepting writes a versioned, timestamped record and closes the gate', async () => {
  storage.getItem.mockResolvedValue(null);
  render(<LegalAcceptanceGate />);
  await flush();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /i agree to these terms/i })); });

  const [key, value] = storage.setItem.mock.calls[0];
  expect(key).toBe('legal_acceptance_v1');
  const rec = JSON.parse(value);
  expect(rec.version).toBe(CURRENT_LEGAL_VERSION);        // WHAT they agreed to
  expect(Number.isNaN(Date.parse(rec.acceptedAt))).toBe(false); // WHEN
  expect(rec.documents).toEqual(['terms', 'privacy', 'dpa']);
  expect(rec.source).toBe('app');
  // mirrored onto the auth user as a second independent copy
  expect(supabase.auth.updateUser).toHaveBeenCalled();
  expect(screen.queryByText(HEADING)).toBeNull();
});

test('the modal offers NO way out but accepting', async () => {
  storage.getItem.mockResolvedValue(null);
  render(<LegalAcceptanceGate />);
  await flush();
  // Exactly one button, and it is the accept button. A dismiss/skip/close
  // control would return this to unenforceable browsewrap.
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toMatch(/i agree/i);
  expect(screen.queryByRole('button', { name: /close|dismiss|skip|later|cancel/i })).toBeNull();
});

test('a failed write keeps the gate OPEN — never claim assent we did not record', async () => {
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockRejectedValue(new Error('offline'));
  render(<LegalAcceptanceGate />);
  await flush();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /i agree to these terms/i })); });

  expect(screen.getByText(HEADING)).toBeTruthy();
  expect(screen.getByText(/could not save your acceptance/i)).toBeTruthy();
});

test('unreadable storage fails CLOSED (prompts) rather than assuming acceptance', async () => {
  storage.getItem.mockRejectedValue(new Error('storage exploded'));
  render(<LegalAcceptanceGate />);
  await flush();
  expect(screen.getByText(HEADING)).toBeTruthy();
});

test('renders nothing while the check is still in flight — no legal modal flash', () => {
  storage.getItem.mockReturnValue(new Promise(() => {})); // never resolves
  const { container } = render(<LegalAcceptanceGate />);
  expect(container.firstChild).toBeNull();
});
