/**
 * AuthProvider recovery detection (spec §3) — both paths:
 *   PRIMARY: synchronous hash sniff at first render (the event is racy)
 *   BACKUP:  the PASSWORD_RECOVERY auth event
 * Deleting the sniff or typo'ing 'type=recovery' must go red HERE — every
 * other suite mocks AuthProvider away.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const listeners = vi.hoisted(() => ({ cb: null }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
      onAuthStateChange: vi.fn((cb) => {
        listeners.cb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(),
    },
  },
  supabaseConfigured: () => true,
}));

import { AuthProvider, useAuth } from './AuthProvider';

const flush = () => act(async () => {});

function Probe() {
  const { recovery, clearRecovery } = useAuth();
  return (
    <>
      <div data-testid="recovery">{String(recovery)}</div>
      <button onClick={clearRecovery}>clear</button>
    </>
  );
}

beforeEach(() => { vi.clearAllMocks(); listeners.cb = null; });
afterEach(() => { window.history.replaceState(null, '', '/'); });

test('hash sniff: type=recovery in the URL at first render → recovery true', async () => {
  window.history.replaceState(null, '', '/#access_token=x&type=recovery');
  render(<AuthProvider><Probe /></AuthProvider>);
  expect(screen.getByTestId('recovery').textContent).toBe('true'); // BEFORE any flush — synchronous
  await flush();
});

test('no recovery hash → recovery false (incl. a non-recovery type param)', async () => {
  window.history.replaceState(null, '', '/#access_token=x&type=signup');
  render(<AuthProvider><Probe /></AuthProvider>);
  await flush();
  expect(screen.getByTestId('recovery').textContent).toBe('false');
});

test('PASSWORD_RECOVERY event (backup path) → recovery true', async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await flush();
  act(() => { listeners.cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }); });
  expect(screen.getByTestId('recovery').textContent).toBe('true');
});

test('SIGNED_IN with NO recovery hash does NOT set recovery (ordinary sign-in)', async () => {
  // The load-bearing negative: an unconditional setRecovery(true) in the
  // event handler would trap every agent on the reset wall at every sign-in.
  render(<AuthProvider><Probe /></AuthProvider>);
  await flush();
  act(() => { listeners.cb('SIGNED_IN', { user: { id: 'u1' } }); });
  expect(screen.getByTestId('recovery').textContent).toBe('false');
  act(() => { listeners.cb('TOKEN_REFRESHED', { user: { id: 'u1' } }); });
  expect(screen.getByTestId('recovery').textContent).toBe('false');
});

test('other events do NOT set recovery; clearRecovery clears it', async () => {
  window.history.replaceState(null, '', '/#type=recovery');
  render(<AuthProvider><Probe /></AuthProvider>);
  await flush();
  act(() => { listeners.cb('SIGNED_IN', { user: { id: 'u1' } }); });
  expect(screen.getByTestId('recovery').textContent).toBe('true'); // unaffected
  act(() => { screen.getByRole('button', { name: 'clear' }).click(); });
  expect(screen.getByTestId('recovery').textContent).toBe('false');
});
