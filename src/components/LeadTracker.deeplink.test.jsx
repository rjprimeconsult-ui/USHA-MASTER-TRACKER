/**
 * LeadTracker deep link (spec §9, §12) — the two paths a push tap takes into a tab:
 * `?view=<id>` on a cold start, and the service worker's `prim:view` message when PRIM
 * is already open. Both feed one guarded helper.
 *
 * WHY THIS RENDERS THE REAL LeadTracker. The Task 13 plan said the shell was "too heavy
 * to render in jsdom" and settled for a source-text tripwire. That premise is false — it
 * mounts with the mocks below in tens of milliseconds — and the tripwire could not see
 * the things that actually break: the `allowed()` guard, its `team` clause, and above all
 * the LISTENER TARGET. Swapping `navigator.serviceWorker` for `window` silently kills
 * every warm deep link while passing a text check for `'prim:view'`. These cases assert
 * on what an agent would see (which tab is lit) and on the URL, never on source text.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const holder = vi.hoisted(() => ({
  // FULL access so PaywallGate renders children; `subscription_tier` drives teamEntitled.
  profile: { subscription_status: 'active', subscription_tier: 'starter', is_admin: false },
}));

const PROSPECT = { id: 'p_known', name: 'Ada Known', stage: 'WEBBY_SET', archivedAt: null, createdAt: '2026-09-01T12:00:00.000Z' };
vi.mock('@/lib/storage', () => ({
  storage: {
    prefetch: async () => {},
    getItem: async (k) => (k === 'prospects_v1' ? JSON.stringify([PROSPECT]) : null),
    setItem: async () => true,
    removeItem: async () => {},
  },
  onStorageError: () => {},
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseConfigured: () => false,
}));
vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' }, signOut: async () => {} }),
  AuthProvider: ({ children }) => children,
}));
// Only the hook is faked; the module's pure helpers (isComplimentary, trialDaysLeft…)
// stay real, so a case cannot pass on a stub that drifted from the real shape.
vi.mock('@/lib/subscription', async (orig) => ({
  ...(await orig()),
  useSubscription: () => ({ profile: holder.profile, loading: false, refresh: async () => {} }),
}));
vi.mock('@/lib/useBetaFeature', () => ({
  useBetaFeature: () => ({ canAccess: true, reason: 'tier_match', loading: false }),
}));
vi.mock('@/lib/realtimeSync', () => ({ subscribeUserKv: () => () => {} }));
// The views are not under test — stub the two the deep link lands on so a case asserts
// "this tab mounted", not "this tab's contents rendered".
vi.mock('./views/RoutineView', () => ({
  default: ({ onOpenProspect }) => (
    <div data-testid="routine-view">
      <button type="button" onClick={() => onOpenProspect('p_known')}>open Ada</button>
    </div>
  ),
}));
vi.mock('./views/TeamView', () => ({ default: () => <div data-testid="team-view" /> }));

import LeadTracker from './LeadTracker';

// A counting stand-in for the SW container: the real one is unavailable in jsdom, and the
// count is how a case proves the listener was attached HERE and detached on unmount.
class SWStub extends EventTarget {
  constructor() { super(); this.listeners = 0; }
  addEventListener(...a) { this.listeners += 1; return super.addEventListener(...a); }
  removeEventListener(...a) { this.listeners -= 1; return super.removeEventListener(...a); }
}
let sw;

beforeEach(() => {
  sw = new SWStub();
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.history.replaceState({}, '', '/');
  holder.profile = { subscription_status: 'active', subscription_tier: 'starter', is_admin: false };
});
afterEach(() => { vi.clearAllMocks(); });

const at = (url) => window.history.replaceState({}, '', url);
// The lit tab: the nav pill is the only bg-indigo-600 inside <nav>, and the ACTIVE
// button renders its label once (inactive ones render the roll's two copies).
const activeTab = (c) => c.querySelector('nav .bg-indigo-600')?.closest('button')?.textContent?.trim() ?? null;
const params = () => new URL(window.location.href).searchParams;
const flush = async () => { await act(async () => {}); await act(async () => {}); };
const postView = async (view) => {
  const e = new Event('message');
  e.data = { type: 'prim:view', view };
  await act(async () => { sw.dispatchEvent(e); });
};

test('?view=routine on mount lights the Routine tab, mounts it, and removes ONLY the view param', async () => {
  at('/?view=routine&keep=1');
  const { container } = render(<LeadTracker />);
  await flush();
  expect(activeTab(container)).toBe('Routine');
  expect(screen.getByTestId('routine-view')).toBeTruthy();
  expect(params().has('view')).toBe(false);
  expect(params().get('keep')).toBe('1'); // sibling params survive (ImpersonationBanner pattern)
});

test('?view=<not a tab> changes nothing and is consumed', async () => {
  at('/?view=nonsense');
  const { container } = render(<LeadTracker />);
  await flush();
  expect(activeTab(container)).toBe('CPA Dashboard');
  expect(screen.queryByTestId('routine-view')).toBeNull();
  expect(params().has('view')).toBe(false);
});

test('?view=team is NOT honoured without the entitlement, and the param survives until it flips', async () => {
  at('/?view=team');
  const { container, rerender } = render(<LeadTracker />);
  await flush();
  expect(activeTab(container)).toBe('CPA Dashboard');
  expect(screen.queryByTestId('team-view')).toBeNull();
  // Kept, not destroyed: the profile had not loaded yet, so the id is owed an answer.
  expect(params().get('view')).toBe('team');

  holder.profile = { subscription_status: 'active', subscription_tier: 'team', is_admin: false };
  rerender(<LeadTracker />);
  await flush();
  expect(activeTab(container)).toBe('View My Team');
  expect(screen.getByTestId('team-view')).toBeTruthy();
  expect(params().has('view')).toBe(false);
});

test('a prim:view message on navigator.serviceWorker switches tabs; the listener is attached there and removed on unmount', async () => {
  const { container, unmount } = render(<LeadTracker />);
  await flush();
  expect(activeTab(container)).toBe('CPA Dashboard');
  expect(sw.listeners).toBe(1); // attached to the SW container, not window

  await postView('routine');
  expect(activeTab(container)).toBe('Routine');
  expect(screen.getByTestId('routine-view')).toBeTruthy();

  unmount();
  expect(sw.listeners).toBe(0);
});

test('a prim:view message for a tab the agent cannot see is ignored', async () => {
  const { container } = render(<LeadTracker />);
  await flush();
  await postView('team');
  expect(activeTab(container)).toBe('CPA Dashboard');
  expect(screen.queryByTestId('team-view')).toBeNull();
  await postView('nonsense');
  expect(activeTab(container)).toBe('CPA Dashboard');
});

test('Routine’s onOpenProspect switches to Prospects AND opens that prospect (spec §9 plumbing)', async () => {
  at('/?view=routine');
  const { container } = render(<LeadTracker />);
  await flush();
  expect(activeTab(container)).toBe('Routine');

  await act(async () => { screen.getByRole('button', { name: 'open Ada' }).click(); });
  await flush();
  // Both halves: the tab switched, and the queued id reached ProspectsView and was used.
  expect(activeTab(container)).toBe('Prospects');
  expect(document.body.textContent).toContain('Primary Information'); // the detail bubble (portalled)
  expect(document.body.textContent).toContain('Ada Known');
});
