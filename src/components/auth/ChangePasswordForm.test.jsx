/**
 * ChangePasswordForm (spec §4d). The security assertion that matters most:
 * the CURRENT-password check runs on a THROWAWAY client — the singleton's
 * signInWithPassword must NEVER be called, or an admin's aal2 session gets
 * silently downgraded and every /api/admin/* call 403s.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const throwaway = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signOut: vi.fn() },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => throwaway) }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), updateUser: vi.fn() } },
  supabaseConfigured: () => true,
}));

import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import ChangePasswordForm from './ChangePasswordForm';

const flush = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  throwaway.auth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
  throwaway.auth.signOut.mockResolvedValue({ error: null });
  supabase.auth.updateUser.mockResolvedValue({ data: {}, error: null });
});

function fill({ current = 'old-pass-1', next = 'new-pass-1', confirm = 'new-pass-1' } = {}) {
  const [c, n, cf] = document.querySelectorAll('input[type="password"]');
  fireEvent.change(c, { target: { value: current } });
  fireEvent.change(n, { target: { value: next } });
  fireEvent.change(cf, { target: { value: confirm } });
}

test('success path: throwaway verifies, singleton updates, singleton signIn NEVER called', async () => {
  render(<ChangePasswordForm email="agent@x.com" />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(throwaway.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'agent@x.com', password: 'old-pass-1' });
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'new-pass-1' });
  expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();       // the aal2-preservation pin
  expect(throwaway.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  const opts = createClient.mock.calls[0][2];
  expect(opts.auth).toMatchObject({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'prim-pw-verify' });
  expect(screen.getByText(/password updated/i)).toBeTruthy();
});

test('wrong current password: inline error, updateUser NEVER called', async () => {
  throwaway.auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid login credentials' } });
  render(<ChangePasswordForm email="agent@x.com" />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(screen.getByText(/current password isn't right/i)).toBeTruthy();
});

test('mismatch / too short: nothing is called at all', async () => {
  render(<ChangePasswordForm email="agent@x.com" />);
  fill({ confirm: 'different-1' });
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(throwaway.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  expect(screen.getByText(/don't match/i)).toBeTruthy();
});

test('updateUser error (leaked password) surfaces; form stays editable', async () => {
  supabase.auth.updateUser.mockResolvedValue({ data: null, error: { message: 'Password is known to be weak and easy to guess' } });
  render(<ChangePasswordForm email="agent@x.com" />);
  fill();
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
  await flush();
  expect(screen.getByText(/weak and easy to guess/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /change password/i }).disabled).toBe(false);
});
