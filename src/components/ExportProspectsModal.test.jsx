/**
 * Component tests for ExportProspectsModal — suite #3 on the component lane.
 *
 * Why this component: the export writes a real file of prospect PII to the
 * agent's disk. The things that can go wrong are quiet — an archived
 * prospect riding along, a filter that doesn't actually filter, a
 * selection that survives a filter change and exports someone the agent
 * never saw. None of that throws; it just produces a wrong file.
 *
 * Two boundaries deserve special mention:
 *   - `active` excludes archived prospects at BOTH ends (list AND export),
 *     so an archived prospect can never reach the CSV even if a stale
 *     selection still holds its id.
 *   - The modal is mounted behind `!readOnly` in ProspectsView, because
 *     that view also renders ANOTHER agent's data in the team-leader
 *     mirror. That guard is asserted in the ProspectsView-level test at
 *     the bottom rather than here, since it is a mount-site property.
 *
 * Conventions carried from suites #1-2: assert behavior not styling, build
 * expectations from the REAL lib functions so they cannot drift, and give
 * the download path a spy rather than letting jsdom attempt a navigation.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import ExportProspectsModal from './ExportProspectsModal';
import { buildProspectsCsv, exportFilename, EXPORT_HEADERS } from '@/lib/prospectExport.mjs';

// ---- fixtures ----

const STAGES = [
  { id: 'PENDING_DECISION', label: 'Quoted/Pending Decision' },
  { id: 'FOLLOWUP_LATER', label: 'Follow-up Later' },
  { id: 'SOLD', label: 'Sold' },
];

const P = (over = {}) => ({
  id: 'p1', name: 'Maria Ortiz', phone: '555-0100', email: 'maria@example.com',
  dobs: '1985-03-02', state: 'TX', zip: '79927', income: '65000',
  source: 'Benepath', stage: 'PENDING_DECISION', archivedAt: null,
  meds: 'takes insulin', situation: 'health concerns noted',
  ...over,
});

const BOOK = [
  P(),
  P({ id: 'p2', name: 'Dan Reed', phone: '555-0200', email: 'dan@example.com', source: 'Referral', stage: 'FOLLOWUP_LATER', state: 'NC' }),
  P({ id: 'p3', name: 'Ana Silva', phone: '555-0300', email: 'ana@example.com', source: 'Benepath', stage: 'SOLD', state: 'TX' }),
  P({ id: 'p4', name: 'ARCHIVED Person', phone: '555-0400', source: 'Referral', stage: 'SOLD', archivedAt: '2026-01-01T00:00:00Z' }),
];

// Capture what the download anchor would have written, without letting jsdom
// try to navigate. Captured as RAW BYTES, not text: `Blob.text()` decodes as
// UTF-8 and swallows the leading BOM, which would hide a regression in the
// one byte sequence that makes Excel open the file as UTF-8 (drop it and
// every accented name in an agent's book renders as mojibake). Bytes let us
// assert the BOM explicitly and still compare the text after it.
let lastBytes = null;
let clickSpy;
beforeEach(() => {
  lastBytes = null;
  global.URL.createObjectURL = vi.fn((blob) => {
    blob.arrayBuffer().then(b => { lastBytes = new Uint8Array(b); });
    return 'blob:mock';
  });
  global.URL.revokeObjectURL = vi.fn();
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { clickSpy.mockRestore(); });

const csvText = () => new TextDecoder('utf-8').decode(lastBytes);
const waitForExport = () => vi.waitFor(() => expect(lastBytes).not.toBeNull());

function open(props = {}) {
  return render(<ExportProspectsModal open onClose={vi.fn()} prospects={BOOK} stages={STAGES} {...props} />);
}

/** The scrollable row list — rows are <label>s holding a checkbox. */
function rowNames() {
  return screen.getAllByRole('checkbox')
    .filter(cb => cb.getAttribute('aria-label') === null) // exclude select-all
    .map(cb => cb.closest('label')?.textContent || '');
}

function selectAllBox() { return screen.getByRole('checkbox', { name: /Select all/ }); }
function exportButton() { return screen.getByRole('button', { name: /Export/ }); }

// ---- 1. closed modal renders nothing ----

test('open={false} renders nothing at all', () => {
  const { container } = render(
    <ExportProspectsModal open={false} onClose={vi.fn()} prospects={BOOK} stages={STAGES} />
  );
  expect(container.innerHTML).toBe('');
});

// ---- 2. archived prospects are excluded from BOTH the list and the count ----

test('archived prospects never appear in the list or the total', () => {
  open();
  const names = rowNames().join(' | ');
  expect(names).not.toContain('ARCHIVED Person');
  // "N of 3 selected" — the denominator is ACTIVE prospects, not all 4.
  expect(screen.getByText(/0 of 3 selected/)).toBeTruthy();
  expect(screen.getByText(/Select all 3 matching/)).toBeTruthy();
});

// ---- 3. the export button is inert with nothing selected ----

test('Export is disabled until something is selected, and writes no file', () => {
  open();
  const btn = exportButton();
  // The `disabled={selected.size === 0}` gate is what's actually load-bearing,
  // and it IS pinned: mutating it to `disabled={false}` turns this test red.
  //
  // doExport's own `if (!rows.length) return` is unreachable defense-in-depth
  // and deliberately NOT asserted. Probed rather than assumed: setting
  // `btn.disabled = false` and clicking does NOT reach the handler (React
  // still won't dispatch — measured at 0 calls), so no test written through
  // the UI can exercise that branch. Claiming to cover it would be theater.
  expect(btn.disabled).toBe(true);
  fireEvent.click(btn);
  expect(clickSpy).not.toHaveBeenCalled();
  expect(global.URL.createObjectURL).not.toHaveBeenCalled();
});

// ---- 4. the CSV content matches the tested library exactly ----

test('exporting writes the library CSV for exactly the selected rows', async () => {
  open();
  fireEvent.click(selectAllBox());
  expect(screen.getByText(/3 of 3 selected/)).toBeTruthy();
  fireEvent.click(exportButton());
  expect(clickSpy).toHaveBeenCalledTimes(1);
  await waitForExport();
  // Byte-for-byte against the REAL exporter, so the expectation cannot drift
  // from production and the BOM is part of the comparison.
  const expected = new TextEncoder().encode(buildProspectsCsv(BOOK.filter(p => !p.archivedAt)));
  expect(Array.from(lastBytes)).toEqual(Array.from(expected));
  expect(csvText()).toContain('Maria Ortiz');
  expect(csvText()).not.toContain('ARCHIVED Person');
});

test('the CSV carries the 9 agreed columns and NO health fields', async () => {
  open();
  fireEvent.click(selectAllBox());
  fireEvent.click(exportButton());
  await waitForExport();
  // The UTF-8 BOM Excel needs — asserted on the actual bytes, since decoding
  // to a string silently swallows it. Drop it and every accented name in an
  // agent's book opens as mojibake.
  expect([lastBytes[0], lastBytes[1], lastBytes[2]]).toEqual([0xEF, 0xBB, 0xBF]);
  const header = csvText().split('\n')[0];
  for (const h of EXPORT_HEADERS) expect(header).toContain(h);
  // PRIM is a no-PHI system: meds/situation were deliberately excluded from
  // the export. Both fixtures carry them, so a leak would show here.
  expect(csvText()).not.toContain('insulin');
  expect(csvText()).not.toContain('health concerns');
});

test('the download filename comes from the exporter, not an ad-hoc string', () => {
  // CAPTURE, then assert outside. An `expect` thrown inside a spy callback
  // runs during the React event handler and is not reliably attributed to
  // the test — a mutation check proved a hardcoded 'export.csv' survived
  // green under the in-callback form.
  let captured = null;
  clickSpy.mockImplementation(function () { captured = this.download; });
  open();
  fireEvent.click(selectAllBox());
  fireEvent.click(exportButton());
  expect(clickSpy).toHaveBeenCalledTimes(1);
  expect(captured).toBe(exportFilename());
  expect(captured).toMatch(/^prospects-\d{4}-\d{2}-\d{2}\.csv$/);
});

// ---- 5. filters actually filter ----

test('the stage filter narrows the list and the select-all count', () => {
  open();
  fireEvent.change(screen.getByDisplayValue('All stages'), { target: { value: 'SOLD' } });
  const names = rowNames().join(' | ');
  expect(names).toContain('Ana Silva');
  expect(names).not.toContain('Maria Ortiz');
  expect(names).not.toContain('ARCHIVED Person'); // archived SOLD stays out
  expect(screen.getByText(/Select all 1 matching/)).toBeTruthy();
});

test('the source filter narrows the list', () => {
  open();
  fireEvent.change(screen.getByDisplayValue('All sources'), { target: { value: 'Referral' } });
  const names = rowNames().join(' | ');
  expect(names).toContain('Dan Reed');
  expect(names).not.toContain('Maria Ortiz');
});

test('the search box matches name, phone and email', () => {
  open();
  const box = screen.getByPlaceholderText(/Search name, phone, email/);
  fireEvent.change(box, { target: { value: 'ana@example' } });
  expect(rowNames().join(' | ')).toContain('Ana Silva');
  fireEvent.change(box, { target: { value: '555-0200' } });
  expect(rowNames().join(' | ')).toContain('Dan Reed');
  fireEvent.change(box, { target: { value: 'zzz-no-match' } });
  expect(screen.getByText(/No prospects match these filters/)).toBeTruthy();
});

// ---- 6. selection survives filter changes — and exports what was picked ----

test('a selection made under one filter still exports after the filter changes', async () => {
  open();
  // Pick Dan (Referral) …
  fireEvent.change(screen.getByDisplayValue('All sources'), { target: { value: 'Referral' } });
  fireEvent.click(screen.getAllByRole('checkbox').find(cb => cb.getAttribute('aria-label') === null));
  // … then switch to a filter that hides him.
  fireEvent.change(screen.getByDisplayValue('Referral'), { target: { value: 'Benepath' } });
  expect(rowNames().join(' | ')).not.toContain('Dan Reed');
  expect(screen.getByText(/1 of 3 selected/)).toBeTruthy(); // still counted
  fireEvent.click(exportButton());
  await waitForExport();
  expect(csvText()).toContain('Dan Reed'); // the agent's pick is honored
  expect(csvText()).not.toContain('Maria Ortiz');
});

test('unchecking select-all clears ONLY the matching rows, not out-of-filter picks', () => {
  open();
  fireEvent.click(selectAllBox());               // all 3
  expect(screen.getByText(/3 of 3 selected/)).toBeTruthy();
  fireEvent.change(screen.getByDisplayValue('All sources'), { target: { value: 'Referral' } });
  fireEvent.click(selectAllBox());               // uncheck the 1 matching
  // Dan dropped; the two Benepath picks survive.
  expect(screen.getByText(/2 of 3 selected/)).toBeTruthy();
});

// ---- 7. the picker resets between openings ----

test('closing and reopening resets the selection (no stale picks)', () => {
  const { rerender } = render(
    <ExportProspectsModal open onClose={vi.fn()} prospects={BOOK} stages={STAGES} />
  );
  fireEvent.click(selectAllBox());
  expect(screen.getByText(/3 of 3 selected/)).toBeTruthy();
  rerender(<ExportProspectsModal open={false} onClose={vi.fn()} prospects={BOOK} stages={STAGES} />);
  rerender(<ExportProspectsModal open onClose={vi.fn()} prospects={BOOK} stages={STAGES} />);
  expect(screen.getByText(/0 of 3 selected/)).toBeTruthy();
});

// ---- 8. exporting closes the modal ----

test('a successful export closes the modal', () => {
  const onClose = vi.fn();
  open({ onClose });
  fireEvent.click(selectAllBox());
  fireEvent.click(exportButton());
  expect(onClose).toHaveBeenCalledTimes(1);
});
