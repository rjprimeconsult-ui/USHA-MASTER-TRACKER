/**
 * AuthGate forgot-password mode + expired-link notice (spec §4a/§4b) and the
 * RecoveryScreen swap (spec §3). Enumeration safety and the no-auto-switch
 * rule are the security assertions here.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const authState = vi.hoisted(() => ({ value: { user: null, loading: false, recovery: false, clearRecovery: vi.fn(), signOut: vi.fn() } }));
// AuthGate reads usePathname/useSearchParams; outside an App Router provider
// both return null and SignInScreen crashes on searchParams.get (AuthGate.jsx:68).
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./AuthProvider', () => ({ useAuth: () => authState.value }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn() } },
  supabaseConfigured: () => true,
}));
vi.mock('./RecoveryScreen', () => ({ default: () => <div data-testid="recovery-screen" /> }));
// Partial mock: sentinel resetRedirectTarget so the wiring test can prove the
// call site actually routes through the rule — a naive
// redirectTo: window.location.origin implementation must FAIL that test.
vi.mock('@/lib/passwordReset.mjs', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, resetRedirectTarget: vi.fn(() => 'https://sentinel.example') };
});
vi.mock('../motion/ConstellationBackground', () => ({ default: () => null }));
vi.mock('./MigrationPrompt', () => ({ default: () => null }));
vi.mock('./LegalAcceptanceGate', () => ({ default: () => null }));
vi.mock('./MfaGate', () => ({ default: ({ children }) => children }));

import { supabase } from '@/lib/supabase';
import { resetRedirectTarget } from '@/lib/passwordReset.mjs';
import AuthGate from './AuthGate';

const flush = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  // .env.local is NOT loaded into the vitest process (and CI has no .env at
  // all) — stub the marketing origin so the sentinel-args assertion below can
  // pin a LITERAL. Without this, marketingUrl is undefined on both sides and
  // toHaveBeenCalledWith treats a DROPPED key as equal to explicit undefined
  // — the exact omission that would no-op the spec §3 rule would pass.
  vi.stubEnv('NEXT_PUBLIC_MARKETING_URL', 'https://www.primtracker.com');
  authState.value = { user: null, loading: false, recovery: false, clearRecovery: vi.fn(), signOut: vi.fn() };
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllEnvs(); window.history.replaceState(null, '', '/'); });

test('user + recovery → RecoveryScreen instead of the app', async () => {
  authState.value = { ...authState.value, user: { id: 'u1' }, recovery: true };
  render(<AuthGate>app-content</AuthGate>);
  await flush();
  expect(screen.getByTestId('recovery-screen')).toBeTruthy();
  expect(screen.queryByText('app-content')).toBeNull();
});

test('Forgot password button is type=button — clicking never fires signInWithPassword', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  const btn = screen.getByRole('button', { name: /forgot password/i });
  expect(btn.getAttribute('type')).toBe('button');
  fireEvent.click(btn);
  await flush();
  expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
});

test('forgot mode: enumeration-safe copy on success', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
  await flush();
  expect(screen.getByText(/if an account exists/i)).toBeTruthy();
});

test('forgot mode: user-not-found reads IDENTICALLY (enumeration-safe)', async () => {
  supabase.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'User not found', status: 400 } });
  const { unmount } = render(<AuthGate>x</AuthGate>);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'nobody@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
  await flush();
  expect(screen.getByText(/if an account exists/i)).toBeTruthy();
  expect(screen.queryByText(/not found/i)).toBeNull();
  unmount();
});

test('forgot mode heading: reset copy, NOT the signup pitch', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  expect(screen.getByText(/reset your password/i)).toBeTruthy();
  expect(screen.queryByText(/create your account/i)).toBeNull();
});

test('redirectTo is WIRED through resetRedirectTarget (sentinel pin)', async () => {
  render(<AuthGate>x</AuthGate>);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
  await flush();
  const [, opts] = supabase.auth.resetPasswordForEmail.mock.calls[0];
  // The sentinel proves the call site routes through the rule; a naive
  // redirectTo: window.location.origin implementation fails here.
  expect(opts.redirectTo).toBe('https://sentinel.example');
  expect(resetRedirectTarget).toHaveBeenCalledWith({
    origin: window.location.origin,
    marketingUrl: 'https://www.primtracker.com', // literal — a dropped/misnamed arg goes red
    appOrigin: expect.any(String),
  });
});

test('expired hash: notice renders, mode STAYS signin, hash cleared', async () => {
  window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=x');
  render(<AuthGate>x</AuthGate>);
  await flush();
  expect(screen.getByText(/expired or was already used/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy(); // still signin mode
  expect(window.location.hash).toBe('');
});

test('60s cooldown: second send within the window is refused', async () => {
  vi.useFakeTimers();
  render(<AuthGate>x</AuthGate>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  const send = screen.getByRole('button', { name: /send reset link/i });
  fireEvent.click(send);
  await act(async () => {});
  expect(send.disabled).toBe(true);
  await act(async () => { vi.advanceTimersByTime(61_000); });
  expect(screen.getByRole('button', { name: /send reset link/i }).disabled).toBe(false);
  vi.useRealTimers();
});
