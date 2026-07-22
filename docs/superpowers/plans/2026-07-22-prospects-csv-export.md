# Prospects CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Export button on Prospects that opens a filterable multi-select picker and downloads the selected prospects as a 9-column demographics CSV, plus a one-line BOM fix to the existing Leads export.

**Architecture:** One self-contained pure-logic module (`prospectExport.mjs`, node --test testable) holds all fragile logic: name split, CSV cell encoding (quote-all + doubled quotes + formula-injection tab-guard), BOM + CRLF assembly, and row filtering. One thin modal component (`ExportProspectsModal.jsx`) renders the picker and calls the module. ProspectsView mounts the button (inside `!readOnly`) and the modal. No server code, no storage change, no new deps.

**Tech Stack:** Plain JS (.mjs/.jsx), React 19, GlassModal (existing), node --test, Blob download (same mechanism as LeadsView exportCsv).

**Spec:** `docs/superpowers/specs/2026-07-22-prospects-csv-export-design.md` — READ IT FIRST. Decisions D1–D8 are locked; do not re-litigate.

**Branch:** create `feat/prospects-csv-export` off current `main` before Task 1.

**Baseline:** `npm test` → 448 pass. `npm run build` → clean. Verify BEFORE starting; every task must keep both green.

**HARD RULES (repo-wide, standing):**
1. Do NOT touch `src/app/api/ringy/`, `src/app/api/benepath/`, `src/app/api/blast/`, or any blast/webhook capture logic.
2. `prospectExport.mjs` must be SELF-CONTAINED — zero imports (not even from `./prospects.js`, which is unimportable under node --test).
3. The ONLY LeadsView change is the BOM prepend (Task 4). No injection guard there (deferred per D7).
4. Commit after every green step; never push `main`.

---

### Task 1: `prospectExport.mjs` — pure logic module (TDD)

**Files:**
- Create: `src/lib/prospectExport.mjs`
- Create: `src/lib/prospectExport.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/prospectExport.test.mjs` with EXACTLY this content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitName, csvCell, buildProspectsCsv, prospectMatchesFilters,
  EXPORT_HEADERS, NO_SOURCE,
} from './prospectExport.mjs';

// ---------- splitName ----------
test('splitName: two words -> first/last', () => {
  assert.deepEqual(splitName('Maria Gonzalez'), { first: 'Maria', last: 'Gonzalez' });
});
test('splitName: single word -> first only', () => {
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
});
test('splitName: 4 words -> first + rest-as-last', () => {
  assert.deepEqual(splitName('Maria Elena Gonzalez Ruiz'), { first: 'Maria', last: 'Elena Gonzalez Ruiz' });
});
test('splitName: leading/trailing spaces are trimmed BEFORE the split', () => {
  assert.deepEqual(splitName('  Maria Gonzalez  '), { first: 'Maria', last: 'Gonzalez' });
});
test('splitName: empty and all-spaces -> empty first/last', () => {
  assert.deepEqual(splitName(''), { first: '', last: '' });
  assert.deepEqual(splitName('   '), { first: '', last: '' });
  assert.deepEqual(splitName(null), { first: '', last: '' });
  assert.deepEqual(splitName(undefined), { first: '', last: '' });
});

// ---------- csvCell ----------
test('csvCell: plain value gets quoted', () => {
  assert.equal(csvCell('hello'), '"hello"');
});
test('csvCell: embedded quotes doubled', () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});
test('csvCell: null/undefined -> empty quoted cell', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});
test('csvCell: numbers stringified', () => {
  assert.equal(csvCell(33073), '"33073"');
});
test('csvCell: injection guard - leading = + - @ get tab prefix INSIDE quotes', () => {
  assert.equal(csvCell('=2+2'), '"\t=2+2"');
  assert.equal(csvCell('+50k'), '"\t+50k"');
  assert.equal(csvCell('-1234'), '"\t-1234"');
  assert.equal(csvCell('@handle'), '"\t@handle"');
});
test('csvCell: injection guard inspects the RAW value - leading space/digit untouched', () => {
  assert.equal(csvCell(' =2+2'), '" =2+2"'); // leading space, not =, no guard
  assert.equal(csvCell('55'), '"55"');
});

// ---------- buildProspectsCsv ----------
const P = (over = {}) => ({
  id: 'x', name: 'Maria Gonzalez', phone: '(954) 555-0132', email: 'mg@x.com',
  dobs: '01/02/1985', state: 'FL', zip: '33073', income: '$45,000',
  source: 'Benepath', stage: 'PENDING_DECISION', archivedAt: null, ...over,
});

test('buildProspectsCsv: header row is the 9 exact columns', () => {
  assert.deepEqual(EXPORT_HEADERS,
    ['First Name', 'Last Name', 'Full Name', 'Phone', 'Email', 'Date of Birth', 'State', 'ZIP', 'Income']);
});
test('buildProspectsCsv: golden file - BOM, CRLF, quoted cells, exact string', () => {
  const csv = buildProspectsCsv([
    P(),
    P({ id: 'y', name: 'Cher', phone: '', email: '', dobs: '', state: '', zip: '', income: '' }),
  ]);
  const expected = '﻿'
    + '"First Name","Last Name","Full Name","Phone","Email","Date of Birth","State","ZIP","Income"\r\n'
    + '"Maria","Gonzalez","Maria Gonzalez","(954) 555-0132","mg@x.com","01/02/1985","FL","33073","$45,000"\r\n'
    + '"Cher","","Cher","","","","","",""';
  assert.equal(csv, expected);
});
test('buildProspectsCsv: BOM exactly once at position 0', () => {
  const csv = buildProspectsCsv([P()]);
  assert.equal(csv.indexOf('﻿'), 0);
  assert.equal(csv.lastIndexOf('﻿'), 0);
});
test('buildProspectsCsv: comma inside dobs survives inside its quotes', () => {
  const csv = buildProspectsCsv([P({ dobs: '01/02/1985, 03/04/1990' })]);
  assert.ok(csv.includes('"01/02/1985, 03/04/1990"'));
});
test('buildProspectsCsv: a cell containing a literal CRLF stays inside its quotes', () => {
  const csv = buildProspectsCsv([P({ income: 'line1\r\nline2' })]);
  assert.ok(csv.includes('"line1\r\nline2"'));
  // Still exactly 1 header + 1 data row when split on row-delimiter-after-quote:
  const rows = csv.split('\r\n');
  // naive split gives 3 pieces because of the embedded CRLF - that is EXPECTED;
  // the guarantee is the embedded CRLF sits between an opening and closing quote.
  assert.equal(rows.length, 3);
});
test('buildProspectsCsv: Full Name is as stored (untrimmed), First/Last from trimmed', () => {
  const csv = buildProspectsCsv([P({ name: ' Maria Gonzalez' })]);
  assert.ok(csv.includes('"Maria","Gonzalez"," Maria Gonzalez"'));
});

// ---------- prospectMatchesFilters ----------
test('filters: archived prospects NEVER match', () => {
  assert.equal(prospectMatchesFilters(P({ archivedAt: '2026-01-01' }), { source: '', stage: '', query: '' }), false);
});
test('filters: empty filters match any active prospect', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: '' }), true);
});
test('filters: source exact match is trim-both-sides', () => {
  assert.equal(prospectMatchesFilters(P({ source: ' Benepath ' }), { source: 'Benepath', stage: '', query: '' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: 'Ringy', stage: '', query: '' }), false);
});
test('filters: NO_SOURCE sentinel matches only trimmed-empty source', () => {
  assert.equal(prospectMatchesFilters(P({ source: '' }), { source: NO_SOURCE, stage: '', query: '' }), true);
  assert.equal(prospectMatchesFilters(P({ source: '   ' }), { source: NO_SOURCE, stage: '', query: '' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: NO_SOURCE, stage: '', query: '' }), false);
});
test('filters: stage matches by exact id', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: 'PENDING_DECISION', query: '' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: 'SOLD', query: '' }), false);
});
test('filters: query matches name and email case-insensitively', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: 'maria' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: 'MG@X' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: 'zzz' }), false);
});
test('filters: digit query matches phone digits-only', () => {
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: '(954) 555' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: '', stage: '', query: '9545550132' }), true);
});
test('filters: all-alphabetic query must NOT match via phone (empty-digits guard)', () => {
  // "abc" has no digits; digits("abc")="" which is a substring of every phone.
  // The phone branch must be skipped entirely for digitless queries.
  assert.equal(prospectMatchesFilters(P({ name: 'Zed', email: '' }), { source: '', stage: '', query: 'abc' }), false);
});
test('filters: AND-combine source+stage+query', () => {
  assert.equal(prospectMatchesFilters(P(), { source: 'Benepath', stage: 'PENDING_DECISION', query: 'maria' }), true);
  assert.equal(prospectMatchesFilters(P(), { source: 'Benepath', stage: 'SOLD', query: 'maria' }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -5`
Expected: FAIL — `Cannot find module ... prospectExport.mjs` (the 448 existing tests still pass).

- [ ] **Step 3: Write the implementation**

Create `src/lib/prospectExport.mjs` with EXACTLY this content:

```js
/**
 * prospectExport.mjs — Prospects → CSV export logic.
 *
 * SELF-CONTAINED (no imports): this module is unit-tested under `node --test`,
 * where sibling app modules (prospects.js etc.) are unimportable due to
 * extensionless imports. Keep it dependency-free (same rule as webforms.mjs).
 *
 * Spec: docs/superpowers/specs/2026-07-22-prospects-csv-export-design.md
 * Columns are demographics/contact ONLY (D4) — never meds, situation, notes.
 */

// Sentinel for the "(No source)" filter option — cannot collide with a real
// source string (repo precedent: LeadsView.jsx product filter '__none__').
export const NO_SOURCE = '__none__';

// The 9 columns, exact order and headers (D4).
export const EXPORT_HEADERS = [
  'First Name', 'Last Name', 'Full Name', 'Phone', 'Email',
  'Date of Birth', 'State', 'ZIP', 'Income',
];

// Trim, then split on the FIRST space of the trimmed value (D5).
export function splitName(name) {
  const t = String(name ?? '').trim();
  if (!t) return { first: '', last: '' };
  const i = t.indexOf(' ');
  if (i === -1) return { first: t, last: '' };
  return { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}

// One CSV cell: always quoted, embedded quotes doubled, and a tab prefixed
// INSIDE the quotes when the RAW value starts with = + - or @ so Excel/Sheets
// treat it as text, never a formula (OWASP CSV-injection neutralization).
// Prospects arrive from internet-facing webforms — this is a security guard,
// not cosmetics. The raw value is inspected (no trimming first).
export function csvCell(value) {
  let s = (value === null || value === undefined) ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = '\t' + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// Build the full file: UTF-8 BOM + header row + one row per prospect, CRLF
// row delimiter (RFC 4180), no trailing newline.
export function buildProspectsCsv(prospects) {
  const rows = [EXPORT_HEADERS.map(csvCell).join(',')];
  for (const p of (prospects || [])) {
    const { first, last } = splitName(p?.name);
    rows.push([
      first, last, p?.name, p?.phone, p?.email,
      p?.dobs, p?.state, p?.zip, p?.income,
    ].map(csvCell).join(','));
  }
  return '﻿' + rows.join('\r\n');
}

// Picker row filter. source: '' = all | NO_SOURCE = trimmed-empty | exact
// (trim-both-sides). stage: '' = all | exact stage id. query: case-insensitive
// substring on name/email; phone compared digits-only ONLY when the query
// contains at least one digit (a digitless query must never match every row
// via the empty-digits substring). All conditions AND-combine. Archived
// prospects never match.
export function prospectMatchesFilters(p, { source = '', stage = '', query = '' } = {}) {
  if (!p || p.archivedAt) return false;
  const pSource = String(p.source ?? '').trim();
  if (source === NO_SOURCE) { if (pSource !== '') return false; }
  else if (source) { if (pSource !== String(source).trim()) return false; }
  if (stage && p.stage !== stage) return false;
  const q = String(query ?? '').trim().toLowerCase();
  if (q) {
    const name = String(p.name ?? '').toLowerCase();
    const email = String(p.email ?? '').toLowerCase();
    let hit = name.includes(q) || email.includes(q);
    if (!hit) {
      const qDigits = q.replace(/\D/g, '');
      if (qDigits) {
        const pDigits = String(p.phone ?? '').replace(/\D/g, '');
        hit = pDigits.includes(qDigits);
      }
    }
    if (!hit) return false;
  }
  return true;
}

// Distinct source options for the dropdown: trimmed, deduped, sorted
// alphabetically; appends NO_SOURCE when any active prospect has a
// trimmed-empty source. (Archived prospects are ignored entirely.)
export function deriveSourceOptions(prospects) {
  const set = new Set();
  let hasEmpty = false;
  for (const p of (prospects || [])) {
    if (!p || p.archivedAt) continue;
    const s = String(p.source ?? '').trim();
    if (s) set.add(s); else hasEmpty = true;
  }
  const out = [...set].sort((a, b) => a.localeCompare(b));
  if (hasEmpty) out.push(NO_SOURCE);
  return out;
}

// Download filename: prospects-YYYY-MM-DD.csv (local date).
export function exportFilename(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `prospects-${y}-${m}-${day}.csv`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -5`
Expected: `pass` count = 448 + 23 new = **471, fail 0**. (If the count differs, count YOUR tests — all must pass and none of the original 448 may break.)

- [ ] **Step 5: Add tests for `deriveSourceOptions` + `exportFilename`** (they're exported; they get covered)

Append to `prospectExport.test.mjs`:

```js
test('deriveSourceOptions: trimmed, deduped, sorted; NO_SOURCE appended when empties exist', () => {
  const opts = deriveSourceOptions([
    P({ source: 'Ringy' }), P({ source: ' Benepath ' }), P({ source: 'Benepath' }),
    P({ source: '  ' }), P({ source: 'Aged Lead', archivedAt: '2026-01-01' }),
  ]);
  assert.deepEqual(opts, ['Benepath', 'Ringy', NO_SOURCE]);
});
test('deriveSourceOptions: no empties -> no NO_SOURCE option', () => {
  assert.deepEqual(deriveSourceOptions([P()]), ['Benepath']);
});
test('exportFilename: zero-padded local date', () => {
  assert.equal(exportFilename(new Date(2026, 6, 3)), 'prospects-2026-07-03.csv');
});
```

Also add `deriveSourceOptions, exportFilename` to the test file's import list.

- [ ] **Step 6: Run tests**

Run: `npm test 2>&1 | tail -5`
Expected: **474 pass, 0 fail**.

- [ ] **Step 7: Commit**

```bash
git add src/lib/prospectExport.mjs src/lib/prospectExport.test.mjs
git commit -m "feat: prospectExport.mjs — CSV build, name split, injection guard, filters (TDD)"
```

---

### Task 2: `ExportProspectsModal.jsx` — the picker

**Files:**
- Create: `src/components/ExportProspectsModal.jsx`

No unit test (UI; node --test can't render React — repo convention). Verified live in Task 5.

- [ ] **Step 1: Create the component**

Create `src/components/ExportProspectsModal.jsx` with EXACTLY this content:

```jsx
'use client';

/**
 * ExportProspectsModal — pick prospects (filter by source/stage + search,
 * multi-select across filter changes) and download them as a 9-column
 * demographics CSV. All CSV/filter logic lives in lib/prospectExport.mjs.
 *
 * Selection is a Set of prospect ids that SURVIVES filter changes (select all
 * Benepath, switch to Ringy, select all — both stay selected) and RESETS every
 * time the modal opens. Spec: 2026-07-22-prospects-csv-export-design.md §5.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Download, Search, X } from 'lucide-react';
import { GlassModal } from './motion/MotionPrimitives';
import {
  buildProspectsCsv, prospectMatchesFilters, deriveSourceOptions,
  exportFilename, NO_SOURCE,
} from '@/lib/prospectExport.mjs';

export default function ExportProspectsModal({ open, onClose, prospects = [], stages = [] }) {
  const [source, setSource] = useState('');
  const [stage, setStage] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const selectAllRef = useRef(null);

  // Reset ALL picker state each time the modal opens (spec §5: selection
  // resets on open; close/reopen is the clear-all escape hatch).
  useEffect(() => {
    if (open) { setSource(''); setStage(''); setQuery(''); setSelected(new Set()); }
  }, [open]);

  const active = useMemo(() => prospects.filter(p => p && !p.archivedAt), [prospects]);
  const sourceOptions = useMemo(() => deriveSourceOptions(prospects), [prospects]);
  const matching = useMemo(
    () => active.filter(p => prospectMatchesFilters(p, { source, stage, query })),
    [active, source, stage, query]
  );

  const matchingSelectedCount = matching.reduce((n, p) => n + (selected.has(p.id) ? 1 : 0), 0);
  const allMatchingSelected = matching.length > 0 && matchingSelectedCount === matching.length;

  // Indeterminate is a DOM property, not an attribute (spec §5.4).
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = matchingSelectedCount > 0 && !allMatchingSelected;
    }
  }, [matchingSelectedCount, allMatchingSelected]);

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Check = select all matching; uncheck = deselect matching ONLY (out-of-
  // filter selections are untouched — spec §5.4).
  const toggleAllMatching = () => setSelected(prev => {
    const next = new Set(prev);
    if (allMatchingSelected) matching.forEach(p => next.delete(p.id));
    else matching.forEach(p => next.add(p.id));
    return next;
  });

  const stageLabel = (id) => stages.find(s => s.id === id)?.label || id || '';

  const doExport = () => {
    const rows = active.filter(p => selected.has(p.id));
    if (!rows.length) return;
    const blob = new Blob([buildProspectsCsv(rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = exportFilename();
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <GlassModal open={open} onClose={onClose} maxWidth="max-w-xl">
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200/70">
          <h2 className="font-semibold text-slate-900">Export prospects to CSV</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-200/70">
          <select value={source} onChange={e => setSource(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
            <option value="">All sources</option>
            {sourceOptions.map(s => (
              <option key={s} value={s}>{s === NO_SOURCE ? '(No source)' : s}</option>
            ))}
          </select>
          <select value={stage} onChange={e => setStage(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
            <option value="">All stages</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search name, phone, email"
              className="w-full border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-sm" />
          </div>
        </div>

        {/* Select-all row */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-200/70 bg-slate-50/60">
          <input ref={selectAllRef} type="checkbox" checked={allMatchingSelected}
            onChange={toggleAllMatching} className="w-4 h-4"
            aria-label={`Select all ${matching.length} matching`} />
          <span className="text-sm text-slate-600">Select all {matching.length} matching</span>
          <span className="ml-auto text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
            {selected.size} of {active.length} selected
          </span>
        </div>

        {/* Row list — the one permitted internal scroll region */}
        <div className="flex-1 overflow-y-auto min-h-[120px]">
          {matching.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">No prospects match these filters.</p>
          )}
          {matching.map(p => (
            <label key={p.id}
              className="flex items-center gap-2.5 px-5 py-2 border-b border-slate-100 cursor-pointer hover:bg-slate-50/70">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="w-4 h-4" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-900 truncate">{p.name || '(no name)'}</span>
                <span className="block text-xs text-slate-400 truncate">{[p.phone, p.state].filter(Boolean).join(' · ')}</span>
              </span>
              {String(p.source || '').trim() && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
                  {String(p.source).trim()}
                </span>
              )}
              <span className="text-[11px] text-slate-400 whitespace-nowrap">{stageLabel(p.stage)}</span>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-200/70">
          <span className="text-[11px] text-slate-400">
            9 columns: First, Last, Full name, Phone, Email, DOB, State, ZIP, Income
          </span>
          <button onClick={doExport} disabled={selected.size === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap">
            <Download size={14} /> Export {selected.size || ''}
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: clean build (component is not yet imported anywhere; this catches syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/ExportProspectsModal.jsx
git commit -m "feat: ExportProspectsModal — source/stage/search picker with cross-filter multi-select"
```

---

### Task 3: Mount in ProspectsView (inside `!readOnly`)

**Files:**
- Modify: `src/components/views/ProspectsView.jsx` (imports ~line 24; state ~line 1421; header buttons ~line 1652-1677; modal mount near `<SmartProspectImportWizard` ~line 1967)

- [ ] **Step 1: Add the import** (next to the other component imports, after line 24):

```jsx
import ExportProspectsModal from '../ExportProspectsModal';
```

- [ ] **Step 2: Add state** (next to `const [showSmartImport, setShowSmartImport] = useState(false);` ~line 1420):

```jsx
const [showExport, setShowExport] = useState(false);
```

- [ ] **Step 3: Add the Export button INSIDE the `!readOnly` fragment.** Insert immediately BEFORE the Settings button (`<button onClick={() => setShowSettings(true)}` ~line 1669), inside the `{!readOnly && (<> ... </>)}` block — placement inside that gate is a spec REQUIREMENT (§5 Entry: the team-leader mirror must not export another agent's data):

```jsx
<Tooltip label="Download selected prospects as a CSV for any other CRM" side="bottom">
  <button onClick={() => setShowExport(true)}
    className="border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5">
    <Download size={14} /> Export
  </button>
</Tooltip>
```

Add `Download` to the existing `lucide-react` import list (line ~11-16) if not already imported.

- [ ] **Step 4: Mount the modal** next to the other modals (immediately before `<SmartProspectImportWizard` ~line 1967), ALSO gated:

```jsx
{!readOnly && (
  <ExportProspectsModal
    open={showExport}
    onClose={() => setShowExport(false)}
    prospects={prospects}
    stages={cfg.stages}
  />
)}
```

- [ ] **Step 5: Tests + build**

Run: `npm test 2>&1 | tail -3` → 474 pass.
Run: `npm run build 2>&1 | tail -5` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/views/ProspectsView.jsx
git commit -m "feat: Export button + modal in Prospects header (owner-only, hidden in readOnly mirror)"
```

---

### Task 4: Leads export BOM fix (D7 — this line and NOTHING else)

**Files:**
- Modify: `src/components/views/LeadsView.jsx:200`

- [ ] **Step 1: Make the one-line change.** In `exportCsv` (line 200):

```jsx
// BEFORE
const blob = new Blob([csv], { type: 'text/csv' });
// AFTER — UTF-8 BOM so Excel renders accented names (José, Nuñez) correctly
const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
```

Do NOT add the injection guard here (deferred per spec D7). No other LeadsView changes.

- [ ] **Step 2: Tests + build**

Run: `npm test 2>&1 | tail -3` → 474 pass. `npm run build 2>&1 | tail -5` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/views/LeadsView.jsx
git commit -m "fix: UTF-8 BOM on Leads CSV export so Excel renders accented names"
```

---

### Task 5: Live verification + wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `npm test 2>&1 | tail -5` → **474 pass, 0 fail**.
Run: `npm run build 2>&1 | tail -5` → clean.
Run: `git diff main --stat` → ONLY the 5 planned files (2 new lib, 1 new component, ProspectsView, LeadsView + this plan/spec if committed here). Confirm NO files under `src/app/api/`.

- [ ] **Step 2: Live browser check (local-only mode, `npm run dev` via the preview tool)**

1. Open Prospects → Export button visible next to Settings.
2. Click Export → modal opens; both dropdowns show "All sources"/"All stages"; count pill reads "0 of N selected"; Export disabled.
3. Pick a source → list narrows; "Select all N matching" checks all; pill updates; switch source and select-all again → pill = sum of both groups (cross-filter multi-select held).
4. Type an all-letters query ("zz") → list narrows correctly (must NOT show all rows).
5. Export → file `prospects-YYYY-MM-DD.csv` downloads; open it: 9 headers, BOM intact (é renders), a seeded `=2+2` name imports as text not formula.
6. Close/reopen modal → selection reset to 0.
7. Leads → Export CSV still downloads and opens.
(If local-only mode has no prospects: seed 3-4 via New Prospect first, incl. one accented name and one `=2+2` name, then delete after.)

- [ ] **Step 3: Update What's New** (OPTIONAL — only if trivially done): skip per YAGNI; announcement is Juan's call at merge.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/prospects-csv-export
```

Do NOT merge to main — merge is Juan's call, timed for tonight's window.
