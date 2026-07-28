/**
 * Component tests for FollowupNextStep — the first PRIM component suite.
 *
 * This component earned the honor: all three bugs that motivated the
 * component-test lane lived here or in its feature —
 *   1. Copy copied the stock template instead of the draft (caught only by
 *      spec review before it shipped),
 *   2. the StrictMode double-invoke deadlock (auto-drafting would have fired
 *      zero times in development),
 *   3. unsaved edits destroyed on unmount.
 * Every test asserts BEHAVIOR an agent experiences — never styling.
 *
 * Conventions for future suites (learned the hard way — a mutation review
 * of this file's first draft found 20 surviving mutants):
 *   - network: mock '@/lib/authedFetch' (never let jsdom touch the network)
 *   - ASYNC TIMING: the draft runner yields a microtask BEFORE calling the
 *     API, so every "makes zero API calls" assertion MUST be preceded by
 *     `await flush()` — a synchronous assertion after render() passes even
 *     when the component bills. The first draft of this suite had seven
 *     assertions that could never fail because of exactly this.
 *   - assert PAYLOADS, not just call counts: a test that checks "a request
 *     happened" is blind to the wrong endpoint, method, body, or a `meds`
 *     leak. Parse opts.body and assert on it.
 *   - time: pass the `now` prop — deterministic due-state, no fake timers
 *   - fixtures: build cache entries with the REAL makeStepKey/sourceHash so
 *     they can never drift from production hashing
 *   - module-level state (inFlightDrafts): give every test a unique
 *     prospect id so the de-dup Set can't couple tests
 */
import { test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StrictMode } from 'react';

vi.mock('@/lib/authedFetch', () => ({ authedFetch: vi.fn() }));

import { authedFetch } from '@/lib/authedFetch';
import FollowupNextStep from './FollowupNextStep';
import { DEFAULT_PLAYBOOK } from '@/lib/followupEngine.mjs';
import { buildDraftSource } from '@/lib/followupDraftGate.mjs';
import { makeStepKey, sourceHash } from '@/lib/followupDraftCache.mjs';

// ---- fixtures ----

const NOW = '2026-07-28T12:00:00.000Z';

// Drain pending microtasks (the runner's pre-flight yield) so call-count
// assertions observe reality. See the header comment — this is load-bearing.
const flush = () => act(async () => {});

let seq = 0;
function mkProspect(over = {}) {
  seq += 1;
  return {
    id: `test-p${seq}`,
    name: 'Maria Ortiz',
    stage: 'PENDING_DECISION',
    situation: 'Family of 4, wants coverage before open enrollment.',
    meds: 'takes insulin daily', // MUST never appear in any request body (D5)
    appointmentTime: '',
    touchLog: [{
      id: 't1', at: '2026-07-20T15:00:00Z', channel: 'Call', outcome: 'Connected',
      note: 'Wants to compare against the benefits packet from her new job. Budget ~$400/mo.',
    }],
    // nextDueAt a week ago -> clearly 'overdue' regardless of local timezone
    cadence: { stepIndex: 0, nextDueAt: '2026-07-21T15:00:00Z', snoozedUntil: null, completedAt: null },
    ...over,
  };
}

function realKeys(prospect) {
  const steps = DEFAULT_PLAYBOOK.stages[prospect.stage].steps;
  const stepKey = makeStepKey(prospect.stage, prospect.cadence?.stepIndex, steps.length);
  const srcHash = sourceHash(stepKey, buildDraftSource(prospect));
  return { stepKey, srcHash };
}

// A cached ok entry whose stepKey/sourceHash match what the component will
// compute for this prospect — built with the REAL production functions.
function mkOkDraft(prospect, text, over = {}) {
  const { stepKey, srcHash } = realKeys(prospect);
  return {
    status: 'ok', text, edited: false, stepKey, sourceHash: srcHash,
    at: NOW, attempts: 0, previous: [], rejected: [], ...over,
  };
}

function card(p, over = {}) {
  const props = {
    prospect: p, playbook: DEFAULT_PLAYBOOK, now: NOW,
    draft: null, onSaveDraft: vi.fn(), draftsEntitled: true, onLogTouch: vi.fn(),
    ...over,
  };
  return <FollowupNextStep {...props} />;
}

const okResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });
const errResponse = (status, payload = {}) => ({ ok: false, status, json: async () => payload });

const clipboardWrites = [];
beforeEach(() => {
  clipboardWrites.length = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (t) => { clipboardWrites.push(t); }) },
  });
  authedFetch.mockReset();
  // Default: a never-settling request — a test that expects zero calls but
  // triggers one fails its count assertion after flush().
  authedFetch.mockImplementation(() => new Promise(() => {}));
});

const DRAFT_TEXT = 'Hi Maria, checking in on the benefits packet from the new job — did it arrive?';
const STOCK_STEP0 = 'Just checking in on the options we went over';

// ---- 1. the Copy bug (the one that motivated this whole lane) ----

test('Copy copies the DRAFT, not the stock template', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT) }));
  expect(screen.getByRole('textbox').value).toBe(DRAFT_TEXT);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Copy$/ })); });
  expect(clipboardWrites).toEqual([DRAFT_TEXT]);
  expect(clipboardWrites[0]).not.toContain(STOCK_STEP0);
});

test('Copy follows a live edit', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT) }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'EDITED BY AGENT' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Copy$/ })); });
  expect(clipboardWrites).toEqual(['EDITED BY AGENT']);
});

// ---- 2. edit persistence ----

test('blur persists an edit as edited:true; a no-op blur writes nothing', () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT), onSaveDraft }));
  const box = screen.getByRole('textbox');
  fireEvent.blur(box); // untouched -> no write
  expect(onSaveDraft).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'EDITED BY AGENT' } });
  fireEvent.blur(box);
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  expect(onSaveDraft).toHaveBeenCalledWith({ text: 'EDITED BY AGENT', edited: true });
});

test('an unsaved edit survives unmount — exactly one write', () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  const { unmount } = render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT), onSaveDraft }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'EDITED, NEVER BLURRED' } });
  unmount();
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  expect(onSaveDraft).toHaveBeenCalledWith({ text: 'EDITED, NEVER BLURRED', edited: true });
});

// ---- 3. the StrictMode deadlock + the request contract ----

test('StrictMode double-invoke fires EXACTLY one request, to the right endpoint, with the right body', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => okResponse({ text: 'FRESH DRAFT FROM MODEL' }));
  await act(async () => {
    render(<StrictMode>{card(p, { onSaveDraft })}</StrictMode>);
  });
  // Dev StrictMode mounts effects twice; the abort path must leave exactly
  // ONE surviving billed call — 0 is the deadlock, 2 is double-billing.
  expect(authedFetch).toHaveBeenCalledTimes(1);

  // The request contract (a call-count-only assertion is blind to all of this):
  const [url, opts] = authedFetch.mock.calls[0];
  expect(url).toBe('/api/followup-draft');
  expect(opts.method).toBe('POST');
  const body = JSON.parse(opts.body);
  expect(body.stepPurpose).toBe('clarify'); // PENDING_DECISION step 0
  expect(body.brief).toContain(STOCK_STEP0);
  expect(body.source.firstName).toBe('Maria');
  expect(body.source.agentNotes).toHaveLength(1);
  expect(body.previous).toEqual([]);
  expect(body.rejected).toEqual([]);
  // D5: meds NEVER leaves the browser — by field or by value.
  expect(body.source.meds).toBeUndefined();
  expect(opts.body).not.toContain('insulin');

  // The saved entry is usable: full shape, not a partial match. A corrupt
  // stepKey here is a permanent re-billing loop (the draft never renders,
  // rule 3 regenerates on every open).
  const { stepKey, srcHash } = realKeys(p);
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  expect(onSaveDraft.mock.calls[0][0]).toEqual({
    status: 'ok', text: 'FRESH DRAFT FROM MODEL', edited: false,
    stepKey, sourceHash: srcHash, at: expect.any(String),
    attempts: 0, previous: [], rejected: [],
  });
});

// ---- 4. re-entrancy: the in-flight Set is the ONLY guard on manual paths ----

test('double-clicking Redo fires exactly one request', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT) }));
  const redo = screen.getByRole('button', { name: /Redo/ });
  await act(async () => { fireEvent.click(redo); fireEvent.click(redo); });
  expect(authedFetch).toHaveBeenCalledTimes(1);
});

test('double-clicking Personalize fires exactly one request — and ontrack does NOT auto-fire', async () => {
  // ontrack (due in the future) + eligible + no cache -> Personalize shows
  const p = mkProspect({ cadence: { stepIndex: 0, nextDueAt: '2026-08-15T15:00:00Z', snoozedUntil: null, completedAt: null } });
  render(card(p));
  // The due-state gate: a NOT-due prospect must never auto-generate. Without
  // this pre-click assertion, deleting the overdue/due_today check passes —
  // the auto-fire consumes the in-flight key and the click count stays 1 by
  // coincidence (mutation M20).
  await flush();
  expect(authedFetch).not.toHaveBeenCalled();
  const btn = screen.getByRole('button', { name: /Personalize/ });
  await act(async () => { fireEvent.click(btn); fireEvent.click(btn); });
  expect(authedFetch).toHaveBeenCalledTimes(1);
});

// ---- 5. eligibility and entitlement gates never call the API ----
// Every zero-call assertion is AFTER flush() — see the header comment.

test('ineligible prospect (no notes, no SMS): stock script, no textarea, ZERO api calls', async () => {
  const p = mkProspect({ touchLog: [], textdripChat: null });
  render(card(p));
  await flush();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
  expect(authedFetch).not.toHaveBeenCalled();
});

test('Starter (draftsEntitled=false): stock script + Pro hint, ZERO api calls', async () => {
  const p = mkProspect();
  render(card(p, { draftsEntitled: false }));
  await flush();
  // The bold "Pro" is a nested span, so match the halves the DOM actually has.
  expect(screen.getByText(/PRIM can write this follow-up from your own notes/)).toBeTruthy();
  expect(screen.getByText('Pro')).toBeTruthy();
  expect(screen.getByText(/Upgrade in Profile → Subscription/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(authedFetch).not.toHaveBeenCalled();
});

test('entitlement UNKNOWN (null, profile loading): neither drafts nor hint, ZERO api calls', async () => {
  const p = mkProspect();
  render(card(p, { draftsEntitled: null }));
  await flush();
  expect(screen.queryByText(/PRIM can write this follow-up/)).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(authedFetch).not.toHaveBeenCalled();
});

test('entitlement resolving null→true fires generation WITHOUT a remount', async () => {
  // Pins review must-fix #2: draftsEntitled is in the effect deps. Without
  // it, a paying Pro agent's overdue prospect never drafts until the drawer
  // is closed and reopened.
  const p = mkProspect();
  authedFetch.mockImplementation(async () => okResponse({ text: 'D' }));
  const props = { draft: null, onSaveDraft: vi.fn() };
  const { rerender } = render(card(p, { ...props, draftsEntitled: null }));
  await flush();
  expect(authedFetch).not.toHaveBeenCalled();
  rerender(card(p, { ...props, draftsEntitled: true }));
  await flush();
  expect(authedFetch).toHaveBeenCalledTimes(1);
});

test('a cached draft is NOT displayed to a de-entitled agent, and makes ZERO api calls', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT), draftsEntitled: false }));
  await flush();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText(DRAFT_TEXT)).toBeNull();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
  expect(authedFetch).not.toHaveBeenCalled();
});

// ---- 6. cache discipline ----

test('a cached insufficient entry is never re-billed on render', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, '', { status: 'insufficient' }) }));
  await flush();
  expect(authedFetch).not.toHaveBeenCalled();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
});

test('a fresh cached ok draft renders with ZERO api calls', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT) }));
  await flush();
  expect(screen.getByRole('textbox').value).toBe(DRAFT_TEXT);
  expect(authedFetch).not.toHaveBeenCalled();
});

test('a draft cached for a DIFFERENT step never renders under this step', async () => {
  const p = mkProspect();
  const stale = mkOkDraft(p, DRAFT_TEXT, { stepKey: 'PENDING_DECISION:3' });
  render(card(p, { draft: stale }));
  // Regenerating IS correct here (rule 3) — the pin is display-only: the
  // old step's message must not appear under the new step's heading.
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText(DRAFT_TEXT)).toBeNull();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
});

// ---- 7. the §10 failure mapping (client side) ----

test('401 writes nothing — stock script, no cache entry', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => errResponse(401));
  render(card(p, { onSaveDraft }));
  await flush();
  expect(authedFetch).toHaveBeenCalledTimes(1);
  expect(onSaveDraft).not.toHaveBeenCalled();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
});

test('503 unavailable writes nothing and burns no attempts', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => errResponse(503, { unavailable: true }));
  render(card(p, { onSaveDraft }));
  await flush();
  expect(onSaveDraft).not.toHaveBeenCalled();
});

test('a 5xx failure writes a FULL failed entry with attempts incremented', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => errResponse(500));
  render(card(p, { onSaveDraft }));
  await flush();
  // Full shape on purpose (mutation M33): a corrupt stepKey on the FAILED
  // path is worse than on the ok path — shouldRegenerate rule 2 never
  // matches it, rule 3 resets the counters, and the attempts cap becomes
  // unreachable: the prospect is re-billed on every open, forever.
  const { stepKey, srcHash } = realKeys(p);
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  expect(onSaveDraft.mock.calls[0][0]).toEqual({
    status: 'failed', text: '', edited: false,
    stepKey, sourceHash: srcHash, at: expect.any(String),
    attempts: 1, previous: [], rejected: [],
  });
});

test('403 upgradeRequired (mid-session downgrade) writes nothing and burns no attempts', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => errResponse(403, { upgradeRequired: true }));
  render(card(p, { onSaveDraft }));
  await flush();
  expect(authedFetch).toHaveBeenCalledTimes(1);
  expect(onSaveDraft).not.toHaveBeenCalled();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
});

test('a stepKey advance ROTATES the prior draft into previous and sends it', async () => {
  // Rule 3: the model must see the immediately-preceding draft so the next
  // step's message can't repeat it (mutation M28 — rotation lost on the
  // request path survived the first two passes).
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  const stale = mkOkDraft(p, DRAFT_TEXT, { stepKey: 'PENDING_DECISION:3' });
  authedFetch.mockImplementation(async () => okResponse({ text: 'NEXT-STEP DRAFT' }));
  render(card(p, { draft: stale, onSaveDraft }));
  await flush();
  expect(authedFetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(authedFetch.mock.calls[0][1].body);
  expect(body.previous).toEqual([DRAFT_TEXT]);
  expect(onSaveDraft.mock.calls[0][0]).toMatchObject({ status: 'ok', text: 'NEXT-STEP DRAFT', previous: [DRAFT_TEXT] });
});

test('a failed Redo PRESERVES the current draft (never clobbered by an error)', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => errResponse(500));
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT), onSaveDraft }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Redo/ })); });
  await flush();
  expect(onSaveDraft).not.toHaveBeenCalled(); // no failed entry over the ok draft
  expect(screen.getByRole('textbox').value).toBe(DRAFT_TEXT);
});

// ---- 8. Redo cap ----

test('Redo disables at the cap of 3 rejected drafts, with the editing hint — ZERO api calls', async () => {
  const p = mkProspect();
  render(card(p, { draft: mkOkDraft(p, DRAFT_TEXT, { rejected: ['a', 'b', 'c'] }) }));
  const redo = screen.getByRole('button', { name: /Redo/ });
  expect(redo.disabled).toBe(true);
  expect(screen.getByText(/Try editing it directly/)).toBeTruthy();
  fireEvent.click(redo);
  await flush();
  expect(authedFetch).not.toHaveBeenCalled();
});

// ---- 9. the outer component's early returns still hold ----

test('a stage with no playbook steps renders nothing', async () => {
  const p = mkProspect({ stage: 'APPOINTMENT_SET' }); // no sequence in the playbook
  const { container } = render(card(p));
  await flush();
  expect(container.innerHTML).toBe('');
  expect(authedFetch).not.toHaveBeenCalled();
});

test('a completed sequence renders the done card, no draft machinery, ZERO api calls', async () => {
  const p = mkProspect({ cadence: { stepIndex: 4, nextDueAt: null, snoozedUntil: null, completedAt: NOW } });
  render(card(p));
  await flush();
  expect(screen.getByText(/sequence complete/)).toBeTruthy();
  expect(authedFetch).not.toHaveBeenCalled();
});
