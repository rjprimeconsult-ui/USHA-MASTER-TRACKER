/**
 * Three-state client gate tests for PaywallGate — 2026-08-02 subscription
 * enforcement spec §2/§5, plan Task 7.
 *
 * What this suite pins, in invariant order:
 *   1. THE COMPLIMENTARY INVARIANT layer 4: comp/admin accounts render the
 *      app even with a stale past_due stamp — no banner, no wall. Locking
 *      one of these accounts is the worst failure this gate can produce.
 *   2. loading / profile===null NEVER wall (auth handles signed-out; a wall
 *      flash on first paint would hit every user on every load).
 *   3. FULL → children; BASIC → in-flow GraceBanner + children; LOCKED
 *      splits: past_due/unpaid → PaymentWall (portal path, exactly two
 *      actions, no "See plans" — checkout on a live sub 409-loops);
 *      canceled/incomplete_expired/null → PaywallScreen (new checkout).
 *   4. Recovery: "I've paid — recheck" → refresh-subscription POST → profile
 *      flips active → the wall unmounts without a reload.
 *   5. Stale-trialing self-heal: an expired 'trialing' row still renders
 *      children AND fires exactly ONE throttled refresh-subscription POST
 *      (sessionStorage 'trial_resync_v1' — a second mount must not re-POST).
 *
 * Conventions (per PendingEmailQueueRunner.test.jsx): assert behavior, never
 * styling; module state lives in vi.hoisted holders; useSubscription is a
 * stateful mock whose refresh() re-renders so recovery is a real unmount.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const holder = vi.hoisted(() => ({ state: { loading: false, profile: null } }));
const portalMock = vi.hoisted(() => vi.fn(async () => {}));
const authedFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseConfigured: () => false,
}));

// Real subscription module (isInTrial/trialDaysLeft/isComplimentary stay
// genuine) with the three side-effectful exports replaced: useSubscription
// reads the holder and its refresh() forces a re-render, portal + checkout
// sync are spies.
vi.mock('@/lib/subscription', async (importOriginal) => {
  const actual = await importOriginal();
  const { useState, useCallback } = await import('react');
  return {
    ...actual,
    useSubscription: () => {
      const [, setTick] = useState(0);
      const refresh = useCallback(async () => { setTick((t) => t + 1); }, []);
      return { loading: holder.state.loading, profile: holder.state.profile, refresh };
    },
    openCustomerPortal: portalMock,
    syncAfterCheckout: vi.fn(async () => null),
  };
});

vi.mock('@/lib/authedFetch', () => ({ authedFetch: authedFetchMock }));

vi.mock('@/lib/postSaleEmails', () => ({
  loadSenderIdentity: vi.fn(async () => null),
}));

vi.mock('./SenderSetupPrompt', () => ({
  default: () => null,
  shouldShowSenderSetupPrompt: () => false,
}));

import PaywallGate from './PaywallGate';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const CHILD_TEXT = 'APP-CONTENT-SENTINEL';
const child = <div>{CHILD_TEXT}</div>;

const WALL_HEADLINE = 'Your subscription is paused';
const BANNER_RE = /Your payment failed/;

function setProfile(profile, loading = false) {
  holder.state = { loading, profile };
}

const flush = () => act(async () => {});

beforeEach(() => {
  holder.state = { loading: false, profile: null };
  sessionStorage.clear();
  portalMock.mockClear();
  authedFetchMock.mockReset();
  authedFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
});

// ---- 1. THE COMPLIMENTARY INVARIANT (layer 4: render) ----

test('complimentary + stale past_due stamp renders children — no banner, no wall', async () => {
  setProfile({
    is_complimentary: true,
    subscription_status: 'past_due',
    past_due_since: iso(Date.now() - 10 * DAY),
  });
  const { unmount } = render(<PaywallGate>{child}</PaywallGate>);
  await flush();

  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.queryByText(BANNER_RE)).toBeNull();
  expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
  unmount();

  // Same invariant for is_admin (mirrors accessLevel's privileged bypasses).
  setProfile({
    is_admin: true,
    subscription_status: 'past_due',
    past_due_since: iso(Date.now() - 10 * DAY),
  });
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.queryByText(BANNER_RE)).toBeNull();
  expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
});

// ---- 2. loading / signed-out never wall ----

test('loading and profile===null both render children with no wall', async () => {
  setProfile(null, true); // loading
  const { unmount } = render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
  expect(screen.queryByText('Subscription required')).toBeNull();
  unmount();

  setProfile(null, false); // signed out / no profile row
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
  expect(screen.queryByText('Subscription required')).toBeNull();
});

// ---- 3a. FULL ----

test('active subscription renders children with no banner', async () => {
  setProfile({ subscription_status: 'active' });
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.queryByText(BANNER_RE)).toBeNull();
  expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
});

// ---- 3b. BASIC → GraceBanner + children ----

test('past_due stamped 1 day ago shows the "2 days" grace banner ABOVE the still-rendered app', async () => {
  setProfile({
    subscription_status: 'past_due',
    past_due_since: iso(Date.now() - 1 * DAY),
  });
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();

  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.getByText(
    'Your payment failed — 2 days of limited access left. AI features and email are paused until you update your payment.'
  )).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Update payment' }));
  expect(portalMock).toHaveBeenCalledTimes(1);
});

test('past_due WITHOUT a stamp shows the stamp-less banner copy — and never the string "null"', async () => {
  setProfile({ subscription_status: 'past_due', past_due_since: null });
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();

  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(screen.getByText(
    'Your payment failed — limited access. AI features and email are paused until you update your payment.'
  )).toBeTruthy();
  expect(screen.queryByText(/null/)).toBeNull();
  expect(screen.queryByText(/\d+ days? of limited access/)).toBeNull();
});

// ---- 3c. LOCKED with a live-but-delinquent sub → PaymentWall ----

test('past_due stamped 4 days ago shows the PaymentWall: no app content, exactly two actions, no "See plans"', async () => {
  setProfile({
    subscription_status: 'past_due',
    past_due_since: iso(Date.now() - 4 * DAY),
  });
  const { unmount } = render(<PaywallGate>{child}</PaywallGate>);
  await flush();

  expect(screen.queryByText(CHILD_TEXT)).toBeNull();
  expect(screen.getByText(WALL_HEADLINE)).toBeTruthy();
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Update payment method' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /I've paid — recheck/ })).toBeTruthy();
  expect(screen.queryByText(/See plans/)).toBeNull();
  unmount();

  // 'unpaid' (post-dunning) has a live sub too — same wall, portal path.
  setProfile({ subscription_status: 'unpaid' });
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(screen.queryByText(CHILD_TEXT)).toBeNull();
  expect(screen.getByText(WALL_HEADLINE)).toBeTruthy();
  expect(screen.queryByText(/See plans/)).toBeNull();
});

// ---- 3d. LOCKED without a live sub → PaywallScreen (new checkout) ----

test('canceled / incomplete_expired / status-null get the pricing PaywallScreen, never the PaymentWall', async () => {
  for (const subscription_status of ['canceled', 'incomplete_expired', null]) {
    setProfile({ subscription_status });
    const { unmount } = render(<PaywallGate>{child}</PaywallGate>);
    await flush();

    expect(screen.queryByText(CHILD_TEXT)).toBeNull();
    expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
    expect(screen.getByText(/See plans/)).toBeTruthy();
    unmount();
  }
});

// ---- 4. Recovery: recheck → profile flips active → wall unmounts ----

test('"I\'ve paid — recheck" POSTs refresh-subscription and unmounts the wall once the profile is active', async () => {
  setProfile({
    subscription_status: 'past_due',
    past_due_since: iso(Date.now() - 4 * DAY),
  });
  authedFetchMock.mockImplementation(async () => {
    // Server re-synced from Stripe; the next refresh() sees an active row.
    setProfile({ subscription_status: 'active' });
    return { ok: true, status: 200, json: async () => ({ ok: true, subscription_status: 'active' }) };
  });

  render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(screen.getByText(WALL_HEADLINE)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /I've paid — recheck/ }));

  await waitFor(() => {
    expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
    expect(screen.queryByText(WALL_HEADLINE)).toBeNull();
  });
  expect(authedFetchMock).toHaveBeenCalledWith(
    '/api/stripe/refresh-subscription',
    expect.objectContaining({ method: 'POST' })
  );
});

// ---- 5. Stale-trialing self-heal (throttled) ----

test('expired trialing renders children AND fires exactly one throttled refresh-subscription POST', async () => {
  setProfile({
    subscription_status: 'trialing',
    trial_ends_at: iso(Date.now() - 1 * DAY),
  });
  const { unmount } = render(<PaywallGate>{child}</PaywallGate>);
  await flush();

  // Stale 'trialing' is still FULL — walling a just-charged agent over our
  // own webhook lag is the worse error (accessLevel's documented choice).
  expect(screen.getByText(CHILD_TEXT)).toBeTruthy();
  expect(authedFetchMock).toHaveBeenCalledTimes(1);
  expect(authedFetchMock).toHaveBeenCalledWith(
    '/api/stripe/refresh-subscription',
    expect.objectContaining({ method: 'POST' })
  );
  unmount();

  // Second mount: sessionStorage throttle — no second POST.
  render(<PaywallGate>{child}</PaywallGate>);
  await flush();
  expect(authedFetchMock).toHaveBeenCalledTimes(1);
});
