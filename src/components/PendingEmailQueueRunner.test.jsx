/**
 * Queue-protection tests for PendingEmailQueueRunner — spec §6.1
 * (docs/superpowers/specs/2026-07-29-per-agent-sender-identity-design.md).
 *
 * The failure this suite exists to catch: the send route's sender-identity
 * gate answers 428/503 for every entitled agent whose identity is
 * incomplete — which on deploy day is ALL of them. The old runner marked
 * any non-OK response `failed` (terminal, invisible, pruned in 24h), so
 * every queued post-sale email to a real client would be silently burned.
 * These tests pin the protection: setup refusals reschedule (item stays
 * pending + retryable), only the explicit 72h expiry burns an item, every
 * failure branch writes an audit entry, and held items collapse into one
 * honest summary toast instead of a countdown that lies.
 *
 * Conventions (per FollowupNextStep.test.jsx, learned the hard way):
 *   - storage mocked in-memory; the REAL pendingEmailQueue module runs on
 *     top of it so reschedulePending's storage semantics are exercised,
 *     with markFired/reschedulePending wrapped in spies via importOriginal.
 *   - every "zero fetch calls" assertion is preceded by `await act(async
 *     () => {})` — a synchronous assertion after render() cannot fail.
 *   - assert stored state via loadQueue(), not component internals.
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mem = vi.hoisted(() => new Map());
const holder = vi.hoisted(() => ({}));

vi.mock('@/lib/storage', () => ({
  storage: {
    getItem: async (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: async (key, value) => {
      mem.set(key, value);
      return true;
    },
    removeItem: async (key) => {
      mem.delete(key);
    },
  },
}));

// Real queue module on top of mocked storage, with the two mutation points
// wrapped in spies so tests can assert "markFired was NOT called" and make
// reschedulePending throw (the storage-blip test).
vi.mock('@/lib/pendingEmailQueue', async (importOriginal) => {
  const actual = await importOriginal();
  holder.actual = actual;
  return {
    ...actual,
    markFired: vi.fn(actual.markFired),
    reschedulePending: vi.fn(actual.reschedulePending),
  };
});

vi.mock('@/lib/postSaleEmails', () => ({
  loadBundle: vi.fn(async () => ({
    templates: [{ id: 'tpl-1', name: 'Welcome aboard', fromName: '' }],
  })),
  renderTemplate: vi.fn(() => ({
    subject: 'Congrats on your new policy',
    body: 'Body text',
    recipient: 'client@x.com',
    intendedRecipient: 'client@x.com',
    testMode: false,
  })),
}));

vi.mock('@/lib/useBetaFeature', () => ({
  useBetaFeature: () => ({ canAccess: true, profile: { email: 'agent@x.com' } }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  supabaseConfigured: () => false,
}));

import PendingEmailQueueRunner from './PendingEmailQueueRunner';
import {
  loadQueue,
  saveQueue,
  markFired,
  reschedulePending,
  QUEUE_KEY,
} from '@/lib/pendingEmailQueue';

const flush = () => act(async () => {});

const LEADS = [{ id: 'lead-1', name: 'Ana Diaz' }];

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

let seq = 0;
function mkItem(over = {}) {
  seq += 1;
  const now = Date.now();
  return {
    id: `q_test_${seq}`,
    leadId: 'lead-1',
    templateId: 'tpl-1',
    enqueuedAt: now - 60_000,
    scheduledAt: now - 1000, // due
    status: 'pending',
    ...over,
  };
}

async function storedItem(id) {
  const q = await loadQueue();
  return q.items.find(it => it.id === id);
}

const jsonResponse = (ok, status, payload) => ({
  ok,
  status,
  json: async () => payload,
});

let audit;
beforeEach(() => {
  mem.clear();
  audit = vi.fn();
  markFired.mockClear();
  markFired.mockImplementation(holder.actual.markFired);
  reschedulePending.mockClear();
  reschedulePending.mockImplementation(holder.actual.reschedulePending);
  fetchMock.mockReset();
  // Default: a never-settling request — a test that expects zero calls but
  // triggers one fails its count assertion after flush().
  fetchMock.mockImplementation(() => new Promise(() => {}));
});

// ---- (a) 428 sender-setup: reschedule, never fail ----

test('428 setupRequired reschedules the item — pending, pushed >= 14 min, heldReason set, markFired untouched', async () => {
  const item = mkItem();
  await saveQueue({ items: [item] });
  const t0 = Date.now();
  fetchMock.mockResolvedValue(
    jsonResponse(false, 428, { setupRequired: 'business_name', error: 'Add your business name in Profile.' })
  );

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);

  await waitFor(async () => {
    const it = await storedItem(item.id);
    expect(it.heldReason).toBe('business_name');
  }, { timeout: 3000 });

  const it = await storedItem(item.id);
  expect(it.status).toBe('pending');
  expect(it.scheduledAt).toBeGreaterThanOrEqual(t0 + 14 * 60 * 1000);
  expect(markFired).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/email/send');
});

// ---- (b) 503 identity_unavailable: same reschedule path (mutation-critical) ----

test('503 identity_unavailable reschedules too — a transient read blip must not burn queued client mail', async () => {
  const item = mkItem();
  await saveQueue({ items: [item] });
  const t0 = Date.now();
  fetchMock.mockResolvedValue(
    jsonResponse(false, 503, { setupRequired: 'identity_unavailable', error: 'Could not load your sender settings.' })
  );

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);

  await waitFor(async () => {
    const it = await storedItem(item.id);
    expect(it.heldReason).toBe('identity_unavailable');
  }, { timeout: 3000 });

  const it = await storedItem(item.id);
  expect(it.status).toBe('pending');
  expect(it.scheduledAt).toBeGreaterThanOrEqual(t0 + 14 * 60 * 1000);
  expect(markFired).not.toHaveBeenCalled();
});

// ---- (c) genuine failure still fails, and now audibly ----

test('500 marks the item failed AND writes a failed audit entry to the lead', async () => {
  const item = mkItem();
  await saveQueue({ items: [item] });
  fetchMock.mockResolvedValue(jsonResponse(false, 500, { error: 'boom' }));

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);

  await waitFor(async () => {
    const it = await storedItem(item.id);
    expect(it.status).toBe('failed');
  }, { timeout: 3000 });

  const it = await storedItem(item.id);
  expect(it.error).toBe('boom');
  expect(audit).toHaveBeenCalledWith(
    'lead-1',
    expect.objectContaining({
      status: 'failed',
      error: 'boom',
      templateId: 'tpl-1',
      templateName: 'Welcome aboard',
      recipient: 'client@x.com',
      subject: 'Congrats on your new policy',
      trigger: 'auto',
    })
  );
});

// ---- (d) 72h expiry: explicit burn with audit, no POST ----

test('a held item older than 72h is failed with the expiry error, audited, and never POSTed', async () => {
  const item = mkItem({
    heldReason: 'business_name',
    enqueuedAt: Date.now() - 73 * 60 * 60 * 1000,
  });
  await saveQueue({ items: [item] });
  // If the runner wrongly POSTs, let it "succeed" — the status assertion
  // below then fails loudly with sent-vs-failed instead of a timeout.
  fetchMock.mockResolvedValue(jsonResponse(true, 200, { messageId: 'm1' }));

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);

  await waitFor(async () => {
    const it = await storedItem(item.id);
    expect(it.status).toBe('failed');
  }, { timeout: 3000 });

  const it = await storedItem(item.id);
  expect(it.error).toBe('expired while sender setup incomplete');
  expect(audit).toHaveBeenCalledWith(
    'lead-1',
    expect.objectContaining({
      status: 'failed',
      error: 'expired while sender setup incomplete',
    })
  );
  await flush();
  expect(fetchMock).not.toHaveBeenCalled();
});

// ---- (e) held toast: one honest summary, no countdown ----

test('a held item renders the summary toast (not a countdown) with the Open Profile action', async () => {
  const item = mkItem({
    heldReason: 'business_name',
    scheduledAt: Date.now() + 10 * 60 * 1000, // not due — nothing fires
  });
  await saveQueue({ items: [item] });

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);
  await flush();

  expect(await screen.findByText('1 email waiting on sender setup')).toBeTruthy();
  expect(screen.queryByText(/Sending in/)).toBeNull();

  const events = [];
  const onOpen = (e) => events.push(e);
  window.addEventListener('prim:open-profile', onOpen);
  try {
    fireEvent.click(screen.getByRole('button', { name: /Open Profile/ }));
  } finally {
    window.removeEventListener('prim:open-profile', onOpen);
  }
  expect(events).toHaveLength(1);
  expect(events[0].detail).toEqual({ section: 'sender' });
  await flush();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('two held items collapse into ONE summary toast saying 2', async () => {
  const a = mkItem({ heldReason: 'business_name', scheduledAt: Date.now() + 10 * 60 * 1000 });
  const b = mkItem({
    heldReason: 'mailing_address',
    scheduledAt: Date.now() + 10 * 60 * 1000,
    templateId: 'tpl-1',
    leadId: 'lead-1',
  });
  await saveQueue({ items: [a, b] });

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);
  await flush();

  expect(await screen.findByText('2 emails waiting on sender setup')).toBeTruthy();
  expect(screen.queryAllByText(/waiting on sender setup/)).toHaveLength(1);
  expect(screen.queryByText(/Sending in/)).toBeNull();
});

// ---- (f) a reschedule that throws must NOT convert the hold into a burn ----

test('a throwing reschedulePending leaves the item pending and never reaches markFired', async () => {
  const item = mkItem();
  await saveQueue({ items: [item] });
  fetchMock.mockResolvedValue(
    jsonResponse(false, 428, { setupRequired: 'business_name', error: 'Add your business name in Profile.' })
  );
  // A transient storage blip: the FIRST reschedule throws, the retry (the
  // item stays due, so the runner re-attempts) succeeds via the real
  // implementation restored in beforeEach. A permanently-throwing mock
  // would starve the event loop (due item -> refire microtask chain), and
  // the spec's scenario is a blip, not a dead store.
  reschedulePending.mockImplementationOnce(async () => {
    throw new Error('storage blip');
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  render(<PendingEmailQueueRunner leads={LEADS} onAuditEntry={audit} />);

  await waitFor(async () => {
    expect(reschedulePending).toHaveBeenCalled();
    // The retry after the blip lands the hold — proving the blip cost nothing.
    const it = await storedItem(item.id);
    expect(it.heldReason).toBe('business_name');
  }, { timeout: 3000 });
  await flush();

  const it = await storedItem(item.id);
  expect(it.status).toBe('pending');
  expect(markFired).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
  warn.mockRestore();
});
