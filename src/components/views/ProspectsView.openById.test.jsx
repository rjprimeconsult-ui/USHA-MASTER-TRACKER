/**
 * ProspectsView open-by-id (spec §9) — the receiving half of the Routine → Prospects
 * hand-off. LeadTracker queues a prospect id in `pendingProspectId` and switches tabs;
 * this view opens that prospect's detail bubble once and tells the parent to clear the
 * request.
 *
 * The rule the cases exist to protect: the request is CONSUMED whatever happens. An id
 * that is unknown or archived opens nothing, but must still be cleared — a request left
 * standing re-fires on every later render of this tab and yanks the agent out of whatever
 * they were doing. The Task 13 tripwire could not see any of this: it only checked that
 * the string "openProspectId" appears in the file, which the prop destructuring alone
 * satisfies, so the entire effect could be deleted with every gate green.
 */
import { test, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import ProspectsView from './ProspectsView';
import { defaultProspectSettings } from '@/lib/prospects';

beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { vi.clearAllMocks(); });

const KNOWN = { id: 'p_known', name: 'Ada Known', stage: 'WEBBY_SET', archivedAt: null, createdAt: '2026-09-01T12:00:00.000Z' };
const GONE = { id: 'p_gone', name: 'Bo Archived', stage: 'LOST', archivedAt: '2026-09-02T12:00:00.000Z', createdAt: '2026-09-01T12:00:00.000Z' };

const noop = () => {};
const view = (p) => (
  <ProspectsView
    prospects={[KNOWN, GONE]}
    settings={defaultProspectSettings()}
    onAdd={noop} onUpdate={noop} onDelete={noop} onBulkAdd={noop} onSaveSettings={noop}
    onConvertToLead={noop} onLogTouch={noop} onOutreachEmailSent={noop} onSnoozeProspect={noop}
    onApplyStageSuggestion={noop} onResolveReminder={noop} onSyncTextDrip={noop} onExtractFromTexts={noop}
    onSaveDraft={noop}
    openProspectId={p.openProspectId}
    onOpenConsumed={p.onOpenConsumed}
  />
);
const settle = async () => { await act(async () => {}); await act(async () => {}); };
// "Primary Information" is a DetailSection heading that exists ONLY inside the detail
// bubble, which portals to document.body — so the page's own text can never fake it.
const detailOpen = () => document.body.textContent.includes('Primary Information');

test('a known, active id opens the detail bubble and consumes the request exactly once', async () => {
  const onOpenConsumed = vi.fn();
  const { rerender } = render(view({ openProspectId: null, onOpenConsumed }));
  await settle();
  expect(onOpenConsumed).not.toHaveBeenCalled();
  expect(detailOpen()).toBe(false);

  rerender(view({ openProspectId: 'p_known', onOpenConsumed }));
  await settle();
  expect(onOpenConsumed).toHaveBeenCalledTimes(1);
  expect(detailOpen()).toBe(true);
  expect(document.body.textContent).toContain('Ada Known');

  // The parent clears the request — that must not count as a new one.
  rerender(view({ openProspectId: null, onOpenConsumed }));
  await settle();
  expect(onOpenConsumed).toHaveBeenCalledTimes(1);

  // ...and asking for the SAME prospect again is a fresh request, not a swallowed one.
  rerender(view({ openProspectId: 'p_known', onOpenConsumed }));
  await settle();
  expect(onOpenConsumed).toHaveBeenCalledTimes(2);
});

test('an unknown id opens nothing but still consumes the request', async () => {
  const onOpenConsumed = vi.fn();
  const { rerender } = render(view({ openProspectId: null, onOpenConsumed }));
  await settle();
  rerender(view({ openProspectId: 'p_does_not_exist', onOpenConsumed }));
  await settle();
  expect(onOpenConsumed).toHaveBeenCalledTimes(1);
  expect(detailOpen()).toBe(false);
});

test('an archived id opens nothing but still consumes the request', async () => {
  const onOpenConsumed = vi.fn();
  const { rerender } = render(view({ openProspectId: null, onOpenConsumed }));
  await settle();
  rerender(view({ openProspectId: 'p_gone', onOpenConsumed }));
  await settle();
  expect(onOpenConsumed).toHaveBeenCalledTimes(1);
  expect(detailOpen()).toBe(false);
  expect(document.body.textContent).not.toContain('Bo Archived');
});
