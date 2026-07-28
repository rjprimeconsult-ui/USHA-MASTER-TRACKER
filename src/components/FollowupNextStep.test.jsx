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
 * Conventions for future suites:
 *   - network: mock '@/lib/authedFetch' (never let jsdom touch the network)
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

let seq = 0;
function mkProspect(over = {}) {
  seq += 1;
  return {
    id: `test-p${seq}`,
    name: 'Maria Ortiz',
    stage: 'PENDING_DECISION',
    situation: 'Family of 4, wants coverage before open enrollment.',
    meds: '',
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

// A cached ok entry whose stepKey/sourceHash match what the component will
// compute for this prospect — built with the REAL production functions.
function mkOkDraft(prospect, text, over = {}) {
  const steps = DEFAULT_PLAYBOOK.stages[prospect.stage].steps;
  const stepKey = makeStepKey(prospect.stage, prospect.cadence?.stepIndex, steps.length);
  const srcHash = sourceHash(stepKey, buildDraftSource(prospect));
  return {
    status: 'ok', text, edited: false, stepKey, sourceHash: srcHash,
    at: NOW, attempts: 0, previous: [], rejected: [], ...over,
  };
}

function renderCard(ui) {
  return render(ui);
}

const clipboardWrites = [];
beforeEach(() => {
  clipboardWrites.length = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async (t) => { clipboardWrites.push(t); }) },
  });
  authedFetch.mockReset();
  // Default: a never-settling request, so tests that must NOT fire a call
  // fail loudly if one sneaks through, and firing tests control resolution.
  authedFetch.mockImplementation(() => new Promise(() => {}));
});

const DRAFT_TEXT = 'Hi Maria, checking in on the benefits packet from the new job — did it arrive?';
const STOCK_STEP0 = 'Just checking in on the options we went over';

// ---- 1. the Copy bug (the one that motivated this whole lane) ----

test('Copy copies the DRAFT, not the stock template', async () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT)} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  // The draft renders in the textarea
  expect(screen.getByRole('textbox').value).toBe(DRAFT_TEXT);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Copy$/ })); });
  expect(clipboardWrites).toEqual([DRAFT_TEXT]);
  expect(clipboardWrites[0]).not.toContain(STOCK_STEP0);
});

test('Copy follows a live edit', async () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT)} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'EDITED BY AGENT' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Copy$/ })); });
  expect(clipboardWrites).toEqual(['EDITED BY AGENT']);
});

// ---- 2. edit persistence ----

test('blur persists an edit as edited:true; a no-op blur writes nothing', () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT)} onSaveDraft={onSaveDraft} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  const box = screen.getByRole('textbox');
  fireEvent.blur(box); // untouched -> no write
  expect(onSaveDraft).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'EDITED BY AGENT' } });
  fireEvent.blur(box);
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  expect(onSaveDraft).toHaveBeenCalledWith({ text: 'EDITED BY AGENT', edited: true });
});

test('an unsaved edit survives unmount (drawer closed without blur)', () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  const { unmount } = renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT)} onSaveDraft={onSaveDraft} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'EDITED, NEVER BLURRED' } });
  unmount();
  expect(onSaveDraft).toHaveBeenCalledWith({ text: 'EDITED, NEVER BLURRED', edited: true });
});

// ---- 3. the StrictMode deadlock ----

test('StrictMode double-invoke fires the generation request EXACTLY once', async () => {
  const p = mkProspect();
  const onSaveDraft = vi.fn();
  authedFetch.mockImplementation(async () => ({
    ok: true, status: 200, json: async () => ({ text: 'FRESH DRAFT FROM MODEL' }),
  }));
  await act(async () => {
    renderCard(
      <StrictMode>
        <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
          draft={null} onSaveDraft={onSaveDraft} draftsEntitled={true} onLogTouch={vi.fn()} />
      </StrictMode>
    );
  });
  // Dev StrictMode mounts effects twice; the in-flight Set's synchronous
  // cleanup delete must leave exactly ONE surviving billed call.
  expect(authedFetch).toHaveBeenCalledTimes(1);
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
  expect(onSaveDraft.mock.calls[0][0]).toMatchObject({ status: 'ok', text: 'FRESH DRAFT FROM MODEL' });
});

// ---- 4. eligibility and entitlement gates never call the API ----

test('ineligible prospect (no notes, no SMS): stock script, no textarea, ZERO api calls', () => {
  const p = mkProspect({ touchLog: [], textdripChat: null });
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={null} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
  expect(authedFetch).not.toHaveBeenCalled();
});

test('Starter (draftsEntitled=false): stock script + Pro hint, ZERO api calls', () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={null} onSaveDraft={vi.fn()} draftsEntitled={false} onLogTouch={vi.fn()} />
  );
  // The bold "Pro" is a nested span, so match the two halves the way the
  // DOM actually splits them (RTL matches an element's direct text only).
  expect(screen.getByText(/PRIM can write this follow-up from your own notes/)).toBeTruthy();
  expect(screen.getByText('Pro')).toBeTruthy();
  expect(screen.getByText(/Upgrade in Profile → Subscription/)).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(authedFetch).not.toHaveBeenCalled();
});

test('entitlement UNKNOWN (null, profile still loading): neither drafts nor hint, ZERO api calls', () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={null} onSaveDraft={vi.fn()} draftsEntitled={null} onLogTouch={vi.fn()} />
  );
  expect(screen.queryByText(/PRIM can write this follow-up/)).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(authedFetch).not.toHaveBeenCalled();
});

test('a cached draft is NOT displayed to a de-entitled agent (no Pro remnant)', () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT)} onSaveDraft={vi.fn()} draftsEntitled={false} onLogTouch={vi.fn()} />
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText(DRAFT_TEXT)).toBeNull();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
});

// ---- 5. cache discipline ----

test('a cached insufficient entry is never re-billed on render', () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, '', { status: 'insufficient' })} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  expect(authedFetch).not.toHaveBeenCalled();
  expect(screen.getByText(new RegExp(STOCK_STEP0))).toBeTruthy();
});

test('a fresh cached ok draft renders with ZERO api calls', () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT)} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  expect(screen.getByRole('textbox').value).toBe(DRAFT_TEXT);
  expect(authedFetch).not.toHaveBeenCalled();
});

// ---- 6. Redo cap ----

test('Redo disables at the cap of 3 rejected drafts, with the editing hint', () => {
  const p = mkProspect();
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={mkOkDraft(p, DRAFT_TEXT, { rejected: ['a', 'b', 'c'] })}
      onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  const redo = screen.getByRole('button', { name: /Redo/ });
  expect(redo.disabled).toBe(true);
  expect(screen.getByText(/Try editing it directly/)).toBeTruthy();
  fireEvent.click(redo);
  expect(authedFetch).not.toHaveBeenCalled();
});

// ---- 7. the outer component's early returns still hold ----

test('a stage with no playbook steps renders nothing', () => {
  const p = mkProspect({ stage: 'APPOINTMENT_SET' }); // no sequence in the playbook
  const { container } = renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={null} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  expect(container.innerHTML).toBe('');
});

test('a completed sequence renders the done card, no draft machinery', () => {
  const p = mkProspect({ cadence: { stepIndex: 4, nextDueAt: null, snoozedUntil: null, completedAt: NOW } });
  renderCard(
    <FollowupNextStep prospect={p} playbook={DEFAULT_PLAYBOOK} now={NOW}
      draft={null} onSaveDraft={vi.fn()} draftsEntitled={true} onLogTouch={vi.fn()} />
  );
  expect(screen.getByText(/sequence complete/)).toBeTruthy();
  expect(authedFetch).not.toHaveBeenCalled();
});
