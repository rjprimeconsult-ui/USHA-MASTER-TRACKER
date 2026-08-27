/**
 * RecoveryScreen — the in-app set-new-password surface (spec §4c).
 * Security-critical assertions:
 *   - NO password input in the DOM on first paint (loading phase) — this is
 *     the autofill-at-aal1 hole (spec §4c / r2 major #2)
 *   - enrolled accounts see the TOTP challenge BEFORE the set form
 *   - failed lookups → blocked screen with Retry, never a form
 *   - updateUser is called with the TYPED password (payload, not just count)
 * Conventions: assert payloads; await flush() before any zero-call assertion.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const mfaMocks = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      signOut: vi.fn(),
      mfa: mfaMocks,
    },
  },
  supabaseConfigured: () => true,
}));

import { supabase } from '@/lib/supabase';
import RecoveryScreen from './RecoveryScreen';

const flush = () => act(async () => {});
const FACTOR = { id: 'f1', status: 'verified', factor_type: 'totp' };

// Deferred promise helper — lets a test hold the lookups "in flight".
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
});

function arm({ aal = { currentLevel: 'aal1', nextLevel: 'aal1' }, factors = { all: [], totp: [] } } = {}) {
  mfaMocks.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: aal, error: null });
  mfaMocks.listFactors.mockResolvedValue({ data: factors, error: null });
}

test('first paint: spinner, NO password input in the DOM', async () => {
  const gate = deferred();
  mfaMocks.getAuthenticatorAssuranceLevel.mockReturnValue(gate.promise);
  mfaMocks.listFactors.mockReturnValue(gate.promise);
  render(<RecoveryScreen onDone={vi.fn()} />);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  gate.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null });
  await flush();
});

test('unenrolled: straight to set; updateUser gets the TYPED password; onDone after success', async () => {
  vi.useFakeTimers();
  arm();
  const onDone = vi.fn();
  render(<RecoveryScreen onDone={onDone} />);
  await flush();
  const [pw, confirm] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(pw, { target: { value: 'brand-new-pass' } });
  fireEvent.change(confirm, { target: { value: 'brand-new-pass' } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
  await flush();
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'brand-new-pass' });
  expect(onDone).not.toHaveBeenCalled();          // inline success dwell first
  await act(async () => { vi.runAllTimers(); });
  expect(onDone).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test('enrolled at aal1: TOTP challenge renders BEFORE any password input', async () => {
  arm({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' }, factors: { all: [FACTOR], totp: [FACTOR] } });
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  expect(screen.getByText(/enter your code/i)).toBeTruthy();
  expect(document.querySelector('input[type="password"]')).toBeNull();
});

test('challenge → aal2 re-resolve lands on set (no loop)', async () => {
  mfaMocks.getAuthenticatorAssuranceLevel
    .mockResolvedValueOnce({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null })
    .mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });
  mfaMocks.listFactors.mockResolvedValue({ data: { all: [FACTOR], totp: [FACTOR] }, error: null });
  mfaMocks.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  fireEvent.change(screen.getByLabelText(/six-digit/i), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /verify/i }));
  await flush();
  expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
});

test('lookup failure: blocked screen with Retry, no form; Retry re-resolves', async () => {
  mfaMocks.getAuthenticatorAssuranceLevel.mockRejectedValueOnce(new Error('boom'));
  mfaMocks.listFactors.mockRejectedValueOnce(new Error('boom'));
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  expect(screen.getByText(/couldn't verify your account's security settings/i)).toBeTruthy();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  arm();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await flush();
  expect(document.querySelectorAll('input[type="password"]').length).toBe(2);
});

test('mismatch and short passwords never reach updateUser', async () => {
  arm();
  render(<RecoveryScreen onDone={vi.fn()} />);
  await flush();
  const [pw, confirm] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(pw, { target: { value: 'abcdef' } });
  fireEvent.change(confirm, { target: { value: 'abcdeX' } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
  await flush();
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(screen.getByText(/don't match/i)).toBeTruthy();
});

test('updateUser error (e.g. leaked password) surfaces verbatim; onDone NOT called', async () => {
  arm();
  supabase.auth.updateUser.mockResolvedValue({ data: null, error: { message: 'Password is known to be weak and easy to guess' } });
  const onDone = vi.fn();
  render(<RecoveryScreen onDone={onDone} />);
  await flush();
  const [pw, confirm] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(pw, { target: { value: 'password' } });
  fireEvent.change(confirm, { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: /set new password/i }));
  await flush();
  expect(screen.getByText(/weak and easy to guess/i)).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
});
