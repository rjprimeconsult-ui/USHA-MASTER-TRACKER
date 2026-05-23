# Duplicate Lead Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tool that lets PRIM agents resolve duplicate-name lead groups, distinguishing import duplicates (merge) from repeated clients (keep both, link with a `previousLeadId`).

**Architecture:** Pure-logic library (`duplicateResolver.mjs`) handles detection, classification, and merging — unit-testable with `node:test`. A `DuplicateResolver` modal walks the agent through pairs; a small `RepeatedClientBadge` decorates leads everywhere they show. A persistent banner above LeadsView surfaces pending pairs.

**Tech Stack:** Next.js 16 / React 19, Tailwind 4, `node:test`, framer-motion (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-23-duplicate-resolver-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/duplicateResolver.mjs` | Pure logic — `findDuplicateGroups`, `enumeratePairs`, `shouldSkipPair`, `classifyPair`, `mergeLeads`. No I/O. |
| `src/lib/duplicateResolver.test.mjs` | `node:test` coverage. |
| `src/components/RepeatedClientBadge.jsx` | Tiny shared chip — renders `↻ Repeated` when a lead has `previousLeadId`. |
| `src/components/DuplicateResolver.jsx` | The full-screen review modal. |
| `src/components/LeadTracker.jsx` | Modal mount + entry button + banner + the merge/tag/dismiss handlers. |
| `src/components/views/LeadsView.jsx` | Insert badge into name cell + "Repeated clients only" filter. |
| `src/components/views/ClosedDeals.jsx` | Insert badge into name cell. |
| `src/components/views/ProspectsView.jsx` | Insert badge in the prospect detail header (for prospects that are repeat-client leads). |

Leads are stored as arbitrary JSON in `leads_v5`, so the two new optional fields (`previousLeadId`, `dedupReviewedAt`) round-trip without any schema migration.

---

## Task 1: Pure logic (`duplicateResolver.mjs`) + tests

**Files:**
- Create: `src/lib/duplicateResolver.mjs`
- Create: `src/lib/duplicateResolver.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/duplicateResolver.test.mjs`:

```js
// Tests for the duplicate-lead resolver pure logic.
//
//   Run:  node --test src/lib/duplicateResolver.test.mjs
//
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDuplicateGroups,
  enumeratePairs,
  shouldSkipPair,
  classifyPair,
  mergeLeads,
} from './duplicateResolver.mjs';

// Trivial nameKey — strips middle initials + lowercases tokens, sorts.
// Mirrors the real lib/statement.js nameKey for test purposes.
const nameKey = (name) => String(name || '')
  .toLowerCase()
  .replace(/[^a-z\s']/g, ' ')
  .replace(/\b[a-z]\b/g, ' ')
  .split(/\s+/)
  .filter(Boolean)
  .sort()
  .join(' ');

test('findDuplicateGroups — groups leads by normalized name', () => {
  const leads = [
    { id: '1', name: 'Eva G Salas' },
    { id: '2', name: 'EVA SALAS' },
    { id: '3', name: 'John Doe' },
    { id: '4', name: 'Jane Doe' },
  ];
  const groups = findDuplicateGroups(leads, nameKey);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].leads.length, 2);
  assert.deepEqual(groups[0].leads.map(l => l.id).sort(), ['1', '2']);
});

test('findDuplicateGroups — ignores leads without a name', () => {
  const leads = [
    { id: '1', name: '' },
    { id: '2' },
    { id: '3', name: 'Jane' },
    { id: '4', name: 'Jane' },
  ];
  const groups = findDuplicateGroups(leads, nameKey);
  assert.equal(groups.length, 1);
});

test('enumeratePairs — 2 leads -> 1 pair, 3 leads -> 3 pairs', () => {
  const g2 = { leads: [{ id: 'a' }, { id: 'b' }] };
  const g3 = { leads: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.equal(enumeratePairs(g2).length, 1);
  assert.equal(enumeratePairs(g3).length, 3);
});

test('shouldSkipPair — both reviewed -> skip; one only -> dont skip', () => {
  const reviewed = { dedupReviewedAt: '2026-05-20' };
  const fresh = {};
  assert.equal(shouldSkipPair(reviewed, reviewed), true);
  assert.equal(shouldSkipPair(reviewed, fresh), false);
  assert.equal(shouldSkipPair(fresh, fresh), false);
});

test('classifyPair — same close date -> duplicate', () => {
  const a = { closedDate: '2026-05-10', policyNumber: '52Z179403J' };
  const b = { closedDate: '2026-05-10', policyNumber: '72D666529S' };
  assert.equal(classifyPair(a, b), 'duplicate');
});

test('classifyPair — within 7 days -> duplicate', () => {
  const a = { closedDate: '2026-05-10' };
  const b = { closedDate: '2026-05-15' };
  assert.equal(classifyPair(a, b), 'duplicate');
});

test('classifyPair — policy-number base overlap -> duplicate even when 30d apart', () => {
  const a = { closedDate: '2026-05-10', policyNumber: '52Z179403J, 52Z179403L' };
  const b = { closedDate: '2026-04-10', policyNumber: '52Z179403S' };
  assert.equal(classifyPair(a, b), 'duplicate');
});

test('classifyPair — 60+ days apart, no overlap -> repeated', () => {
  const a = { closedDate: '2025-01-10', policyNumber: '52Z111111J' };
  const b = { closedDate: '2026-05-10', policyNumber: '52Z999999J' };
  assert.equal(classifyPair(a, b), 'repeated');
});

test('classifyPair — 30 days apart, no overlap -> ambiguous', () => {
  const a = { closedDate: '2026-04-10' };
  const b = { closedDate: '2026-05-10' };
  assert.equal(classifyPair(a, b), 'ambiguous');
});

test('classifyPair — missing dates with no policy overlap -> ambiguous', () => {
  const a = {};
  const b = {};
  assert.equal(classifyPair(a, b), 'ambiguous');
});

test('mergeLeads — winner id preserved, policy numbers combined and deduped', () => {
  const winner = { id: 'W', name: 'Eva G Salas', policyNumber: '52Z179403J, 52Z179403L', products: [{ id: 'PA' }] };
  const loser  = { id: 'L', name: 'Eva Salas',   policyNumber: '72D666529S, 52Z179403J', products: [{ id: 'MG' }] };
  const merged = mergeLeads(winner, loser);
  assert.equal(merged.id, 'W');
  const policies = merged.policyNumber.split(',').map(s => s.trim()).sort();
  assert.deepEqual(policies, ['52Z179403J', '52Z179403L', '72D666529S']);
  const prodIds = merged.products.map(p => p.id).sort();
  assert.deepEqual(prodIds, ['MG', 'PA']);
});

test('mergeLeads — winner empty fields filled from loser', () => {
  const winner = { id: 'W', name: 'Eva Salas', phone: '', email: 'eva@example.com' };
  const loser  = { id: 'L', name: 'Eva Salas', phone: '305-555-1234', email: '' };
  const merged = mergeLeads(winner, loser);
  assert.equal(merged.phone, '305-555-1234');     // filled from loser
  assert.equal(merged.email, 'eva@example.com');  // winner kept
});

test('mergeLeads — sets dedupReviewedAt', () => {
  const merged = mergeLeads({ id: 'W' }, { id: 'L' });
  assert.ok(merged.dedupReviewedAt);
  assert.match(merged.dedupReviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/duplicateResolver.test.mjs`
Expected: FAIL — `Cannot find module './duplicateResolver.mjs'`.

- [ ] **Step 3: Create `duplicateResolver.mjs`**

Create `src/lib/duplicateResolver.mjs`:

```js
/**
 * Duplicate Lead Resolver — pure logic.
 *
 * Detects same-name lead groups, classifies each pair by date proximity
 * and policy-number overlap, and merges two leads into one. No I/O, no
 * React, no storage — testable with node --test.
 *
 * See the spec: docs/superpowers/specs/2026-05-23-duplicate-resolver-design.md
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD..." -> Date | null. Robust against null / empty / garbage.
function parseISODate(s) {
  if (!s) return null;
  const head = String(s).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  const d = new Date(head + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

// Lead -> Set of 9-char policy bases (first 9 chars of each policy number
// in the comma-separated string). Used by classifyPair to spot AppIDs
// that obviously belong to the same submission family.
function policyBases(lead) {
  const raw = String(lead?.policyNumber || '');
  return raw
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.slice(0, 9));
}

/**
 * Group leads by a normalized name key. Skips leads with no name.
 * Returns only groups of size >= 2.
 *
 *   nameKey — a function (string) -> string that normalizes names for
 *             matching. Pass `nameKey` from lib/statement.js at the
 *             call site; kept as a parameter so this module stays
 *             import-free and testable.
 */
export function findDuplicateGroups(leads, nameKey) {
  const byName = new Map();
  for (const lead of leads || []) {
    if (!lead || !lead.name) continue;
    const key = nameKey(lead.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(lead);
  }
  const groups = [];
  for (const [key, leadsInGroup] of byName) {
    if (leadsInGroup.length >= 2) {
      groups.push({ nameKey: key, leads: leadsInGroup });
    }
  }
  return groups;
}

/**
 * Flatten a group into every unique pair. A group of N leads yields
 * N*(N-1)/2 pairs.
 */
export function enumeratePairs(group) {
  const leads = group?.leads || [];
  const pairs = [];
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      pairs.push({ a: leads[i], b: leads[j] });
    }
  }
  return pairs;
}

/**
 * Has this pair already been reviewed? Returns true when BOTH leads carry
 * a dedupReviewedAt timestamp — meaning the agent already made a choice
 * about them and we shouldn't re-prompt.
 */
export function shouldSkipPair(a, b) {
  return Boolean(a?.dedupReviewedAt && b?.dedupReviewedAt);
}

/**
 * Classify a pair:
 *   'duplicate' — closed dates within 7 days, or policy-number bases
 *                 overlap. Likely an import artifact; recommend merge.
 *   'repeated'  — 60+ days apart with no policy overlap. Likely the
 *                 client came back after a lapse/cancel; tag as repeat.
 *   'ambiguous' — anything in between, or missing-date cases that
 *                 can't be decided automatically.
 */
export function classifyPair(a, b) {
  const dateA = parseISODate(a?.closedDate || a?.dateAdded);
  const dateB = parseISODate(b?.closedDate || b?.dateAdded);
  const basesA = new Set(policyBases(a));
  const basesB = policyBases(b);
  const overlap = basesB.some(base => basesA.has(base));
  if (dateA && dateB) {
    const days = Math.abs(dateA - dateB) / DAY_MS;
    if (days <= 7 || overlap) return 'duplicate';
    if (days >= 60) return 'repeated';
    return 'ambiguous';
  }
  if (overlap) return 'duplicate';
  return 'ambiguous';
}

/**
 * Merge two leads into one. The winner keeps its id and any non-empty
 * fields; the loser's policy numbers + products get folded in, and any
 * scalar fields the winner is missing are filled from the loser. The
 * loser should be deleted by the caller after the merge.
 *
 * Stamps dedupReviewedAt so the merged record doesn't reappear in the
 * resolver.
 */
export function mergeLeads(winner, loser) {
  if (!winner) return loser;
  if (!loser)  return winner;

  // Policy numbers — both fields may already be comma-separated.
  const allPolicies = [winner.policyNumber, loser.policyNumber]
    .filter(Boolean)
    .flatMap(p => String(p).split(',').map(s => s.trim()))
    .filter(Boolean);
  const dedupedPolicies = [...new Set(allPolicies)].join(', ');

  // Products — combine by id, winner first.
  const winnerProds = Array.isArray(winner.products) ? winner.products : [];
  const loserProds  = Array.isArray(loser.products)  ? loser.products  : [];
  const seen = new Set(winnerProds.map(p => p?.id).filter(Boolean));
  const products = [...winnerProds];
  for (const p of loserProds) {
    if (p?.id && !seen.has(p.id)) {
      products.push(p);
      seen.add(p.id);
    }
  }

  // Winner-wins-when-set helper for scalar fields.
  const isEmpty = (v) => v === undefined || v === null || v === '';
  const pick = (key) => (isEmpty(winner[key]) ? loser[key] : winner[key]);

  return {
    ...loser,
    ...winner,
    id: winner.id,
    name:               pick('name'),
    phone:              pick('phone'),
    email:              pick('email'),
    state:              pick('state'),
    age:                pick('age'),
    mainProduct:        pick('mainProduct'),
    mainProductPremium: pick('mainProductPremium'),
    leadCost:           pick('leadCost'),
    dealValue:          pick('dealValue'),
    closedDate:         pick('closedDate'),
    dateAdded:          pick('dateAdded'),
    crm:                pick('crm'),
    source:             pick('source'),
    leadCategory:       pick('leadCategory'),
    campaign:           pick('campaign'),
    owner:              pick('owner'),
    notes:              pick('notes'),
    associationPlan:    pick('associationPlan'),
    previousLeadId:     pick('previousLeadId'),
    policyNumber: dedupedPolicies || undefined,
    products,
    dedupReviewedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify all pass**

Run: `node --test src/lib/duplicateResolver.test.mjs`
Expected: PASS — all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/duplicateResolver.mjs src/lib/duplicateResolver.test.mjs
git commit -m "Duplicate Resolver: pure logic (detection, classify, merge)"
```

---

## Task 2: RepeatedClientBadge component

**Files:**
- Create: `src/components/RepeatedClientBadge.jsx`

- [ ] **Step 1: Create the component**

Create `src/components/RepeatedClientBadge.jsx`:

```jsx
'use client';
import { Repeat } from 'lucide-react';

/**
 * Small chip rendered next to a lead's name when it carries a
 * previousLeadId — i.e. the same client wrote a previous policy with
 * this agent that later lapsed/cancelled/dropped. Returns null for
 * non-repeat leads so callers can drop it in unconditionally.
 *
 *   <RepeatedClientBadge lead={lead} />
 */
export default function RepeatedClientBadge({ lead, className = '' }) {
  if (!lead?.previousLeadId) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-wide dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700/60 ${className}`}
      title="This client previously wrote a policy that lapsed, cancelled, or dropped"
    >
      <Repeat size={10} /> Repeated
    </span>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx eslint src/components/RepeatedClientBadge.jsx`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/RepeatedClientBadge.jsx
git commit -m "Duplicate Resolver: RepeatedClientBadge component"
```

---

## Task 3: DuplicateResolver modal

**Files:**
- Create: `src/components/DuplicateResolver.jsx`

The modal mounts in `LeadTracker`. Props are kept thin — the parent
holds the leads state and the merge/tag/dismiss handlers.

- [ ] **Step 1: Create the component**

Create `src/components/DuplicateResolver.jsx`:

```jsx
'use client';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Merge, Repeat, ArrowRight, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  findDuplicateGroups,
  enumeratePairs,
  shouldSkipPair,
  classifyPair,
  mergeLeads,
} from '@/lib/duplicateResolver.mjs';
import { nameKey } from '@/lib/statement';
import { fmt } from '@/lib/utils';

/**
 * Duplicate Resolver modal — walks the agent through each unreviewed
 * pair of same-name leads. Per pair: Merge into one / Repeated client /
 * Keep both. Parent owns the leads state and handles the writes.
 *
 * Props:
 *   open       — bool
 *   onClose    — () => void
 *   leads      — full leads array (read-only here)
 *   onMerge    — (winner, loser) => void
 *                Parent should replace the winner lead with the merged
 *                record (mergeLeads is called inside this modal) and
 *                delete the loser. Both writes are persisted by the
 *                parent's normal save path.
 *   onTagRepeated — (newerLead, olderLeadId) => void
 *                Parent should set previousLeadId = olderLeadId on the
 *                newer lead and stamp dedupReviewedAt on both.
 *   onDismissPair — (a, b) => void
 *                Parent should stamp dedupReviewedAt on both leads so
 *                this pair doesn't reappear.
 */
export default function DuplicateResolver({
  open,
  onClose,
  leads = [],
  onMerge,
  onTagRepeated,
  onDismissPair,
}) {
  // Build the pair list once per (open, leads). Filter already-reviewed.
  const pairs = useMemo(() => {
    if (!open) return [];
    const groups = findDuplicateGroups(leads, nameKey);
    const all = [];
    for (const g of groups) {
      for (const pair of enumeratePairs(g)) {
        if (!shouldSkipPair(pair.a, pair.b)) all.push(pair);
      }
    }
    return all;
  }, [open, leads]);

  const [idx, setIdx] = useState(0);
  const [pickingWinner, setPickingWinner] = useState(false);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const pair = pairs[idx] || null;
  const classification = pair ? classifyPair(pair.a, pair.b) : null;

  const advance = () => {
    setPickingWinner(false);
    if (idx + 1 < pairs.length) setIdx(idx + 1);
    else onClose();
  };

  const onPickWinner = (winnerLead, loserLead) => {
    const merged = mergeLeads(winnerLead, loserLead);
    onMerge(merged, loserLead);
    advance();
  };

  const onClickMerge = () => setPickingWinner(true);
  const onClickRepeated = () => {
    // Older lead = the one with the earlier closedDate (or earlier
    // dateAdded as fallback). The newer one is tagged.
    const dateOf = (l) => l.closedDate || l.dateAdded || '';
    const [older, newer] = dateOf(pair.a) <= dateOf(pair.b) ? [pair.a, pair.b] : [pair.b, pair.a];
    onTagRepeated(newer, older.id);
    advance();
  };
  const onClickDismiss = () => {
    onDismissPair(pair.a, pair.b);
    advance();
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="dup-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="dup-panel"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="premium-card max-w-5xl w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent-gradient flex items-center justify-center text-white">
                <Merge size={18} />
              </div>
              <div>
                <h2 className="font-extrabold text-slate-900 dark:text-slate-100 text-lg tracking-tight">
                  Find duplicate leads
                </h2>
                <p className="text-xs text-slate-500">
                  {pairs.length === 0
                    ? 'No unreviewed duplicates'
                    : `Pair ${idx + 1} of ${pairs.length}`}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          {pairs.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-slate-500 mb-2">No duplicates to review.</div>
              <button
                onClick={onClose}
                className="text-sm text-indigo-600 font-semibold hover:underline"
              >
                Close
              </button>
            </div>
          ) : pair ? (
            <div className="p-5 space-y-4">
              <ClassificationChip classification={classification} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <LeadCard
                  lead={pair.a}
                  selectable={pickingWinner}
                  onSelect={() => onPickWinner(pair.a, pair.b)}
                />
                <LeadCard
                  lead={pair.b}
                  selectable={pickingWinner}
                  onSelect={() => onPickWinner(pair.b, pair.a)}
                />
              </div>

              {pickingWinner ? (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    <Trophy size={12} className="inline-block mr-1" />
                    Click the card you want to keep. The other will be deleted; its policy numbers and products fold into the kept lead.
                  </p>
                  <button
                    onClick={() => setPickingWinner(false)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={onClickMerge}
                    className="bg-accent-gradient text-white rounded-lg px-3.5 py-2 text-sm font-bold flex items-center gap-1.5 shadow-accent hover:opacity-95"
                  >
                    <Merge size={14} /> Merge into one
                  </button>
                  <button
                    onClick={onClickRepeated}
                    className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 rounded-lg px-3.5 py-2 text-sm font-bold flex items-center gap-1.5"
                  >
                    <Repeat size={14} /> Repeated client
                  </button>
                  <button
                    onClick={onClickDismiss}
                    className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Keep both
                  </button>
                  <div className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                    Next pair <ArrowRight size={12} />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function ClassificationChip({ classification }) {
  const map = {
    duplicate: { label: 'Likely import duplicate', bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-200 dark:border-emerald-700' },
    repeated:  { label: 'Likely repeated client',  bg: 'bg-indigo-50 dark:bg-indigo-900/30',   text: 'text-indigo-800 dark:text-indigo-200',   border: 'border-indigo-200 dark:border-indigo-700' },
    ambiguous: { label: 'Ambiguous — you decide',  bg: 'bg-amber-50 dark:bg-amber-900/30',     text: 'text-amber-800 dark:text-amber-200',     border: 'border-amber-200 dark:border-amber-700' },
  };
  const c = map[classification] || map.ambiguous;
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </div>
  );
}

function LeadCard({ lead, selectable, onSelect }) {
  const dollar = (n) => (Number.isFinite(Number(n)) ? fmt(Number(n)) : '—');
  const policies = String(lead.policyNumber || '').split(',').map(s => s.trim()).filter(Boolean);
  const products = Array.isArray(lead.products) ? lead.products.map(p => p?.id).filter(Boolean) : [];
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={selectable ? onSelect : undefined}
      className={`premium-card text-left p-4 transition ${selectable ? 'premium-lift cursor-pointer hover:ring-2 hover:ring-indigo-400' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-slate-900 dark:text-slate-100">{lead.name || '—'}</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{lead.stage || '—'}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Row label="Closed" value={lead.closedDate || lead.dateAdded || '—'} />
        <Row label="Source" value={lead.source || '—'} />
        <Row label="Main product" value={lead.mainProduct || '—'} />
        <Row label="Campaign" value={lead.campaign || '—'} />
        <Row label="Advance" value={dollar(lead.dealValue)} />
        <Row label="Lead cost" value={dollar(lead.leadCost)} />
      </div>
      {policies.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="text-slate-500 font-bold uppercase tracking-wider text-[10px] mb-0.5">Policy #</div>
          <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all">{policies.join(', ')}</div>
        </div>
      )}
      {products.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="text-slate-500 font-bold uppercase tracking-wider text-[10px] mb-0.5">Products</div>
          <div className="text-slate-700 dark:text-slate-300">{products.join(', ')}</div>
        </div>
      )}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <>
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-900 dark:text-slate-100 truncate">{value}</div>
    </>
  );
}
```

- [ ] **Step 2: Lint + build**

Run: `npx eslint src/components/DuplicateResolver.jsx`
Expected: No errors.

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/DuplicateResolver.jsx
git commit -m "Duplicate Resolver: review modal (pair walker + actions)"
```

---

## Task 4: LeadTracker integration (mount, button, banner, handlers)

**Files:**
- Modify: `src/components/LeadTracker.jsx`

LeadTracker holds the leads state and the persist effect. It needs:
- Three handlers that update leads and persist them.
- The modal mounted with `open` state + handlers.
- A persistent banner above the views when there are unreviewed pairs.
- A "Find duplicate leads" entry from the Settings panel (the gear-icon
  modal). For v1 the entry button lives ALSO on the banner itself, so an
  agent who has duplicates can always get to the tool from any tab.

- [ ] **Step 1: Add imports and state**

In `src/components/LeadTracker.jsx`, add to the existing imports at the top of the file:

```jsx
import DuplicateResolver from './DuplicateResolver';
import { findDuplicateGroups, enumeratePairs, shouldSkipPair } from '@/lib/duplicateResolver.mjs';
import { nameKey } from '@/lib/statement';
```

Then inside the `LeadTracker` component (next to the other `useState` declarations near the top of the component body), add:

```jsx
  // Duplicate resolver — modal open state + a derived count of unreviewed
  // same-name pairs, used to drive the persistent banner.
  const [showDupResolver, setShowDupResolver] = useState(false);
```

- [ ] **Step 2: Add the derived banner count**

Add this useMemo immediately after the leads state declarations:

```jsx
  // How many unreviewed duplicate-name pairs exist right now. Drives the
  // banner that surfaces above the main views.
  const dupPairCount = useMemo(() => {
    let count = 0;
    for (const g of findDuplicateGroups(leads || [], nameKey)) {
      for (const p of enumeratePairs(g)) {
        if (!shouldSkipPair(p.a, p.b)) count++;
      }
    }
    return count;
  }, [leads]);
```

- [ ] **Step 3: Add the three handlers**

Add these handlers in the same area as other lead mutators (e.g., near `setLeads`):

```jsx
  // Replace `winner` with merged record and delete `loser`. Single
  // setLeads call so the persist effect fires once and the merge-on-save
  // logic in storage.js sees a consistent state.
  const handleDupMerge = useCallback((mergedWinner, loser) => {
    setLeads(prev => prev
      .filter(l => l.id !== loser.id)
      .map(l => (l.id === mergedWinner.id ? mergedWinner : l)));
  }, [setLeads]);

  // Tag `newerLead` as a repeat of `olderLeadId`. Stamp dedupReviewedAt
  // on both so the pair doesn't reappear.
  const handleDupTagRepeated = useCallback((newerLead, olderLeadId) => {
    const now = new Date().toISOString();
    setLeads(prev => prev.map(l => {
      if (l.id === newerLead.id) {
        return { ...l, previousLeadId: olderLeadId, dedupReviewedAt: now };
      }
      if (l.id === olderLeadId) {
        return { ...l, dedupReviewedAt: now };
      }
      return l;
    }));
  }, [setLeads]);

  // Stamp dedupReviewedAt on both leads so the pair is excluded next time.
  const handleDupDismiss = useCallback((a, b) => {
    const now = new Date().toISOString();
    setLeads(prev => prev.map(l => {
      if (l.id === a.id || l.id === b.id) {
        return { ...l, dedupReviewedAt: now };
      }
      return l;
    }));
  }, [setLeads]);
```

- [ ] **Step 4: Render the banner above the views**

Find the place in the JSX where the main view container starts (above where any `<ViewMount>` renders, but inside the auth-gated app body — same level as the navbar). Insert:

```jsx
        {dupPairCount > 0 && (
          <div className="max-w-screen-2xl mx-auto px-4 pt-3">
            <div className="premium-card flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-accent-gradient flex items-center justify-center text-white">
                  <Merge size={14} />
                </div>
                <div className="text-sm">
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {dupPairCount} potential duplicate{dupPairCount === 1 ? '' : 's'} to review
                  </span>
                  <span className="text-slate-500 ml-2">
                    Merge import artifacts or tag a returning client.
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowDupResolver(true)}
                className="bg-accent-gradient text-white rounded-lg px-3 py-1.5 text-xs font-bold shadow-accent hover:opacity-95"
              >
                Review now
              </button>
            </div>
          </div>
        )}
```

`Merge` icon needs to be added to the existing `lucide-react` import in this file alongside the other icons. Find the lucide-react import block at the top of `LeadTracker.jsx` and append `Merge` to it.

- [ ] **Step 5: Mount the modal**

Near the bottom of the JSX tree (alongside other modals like `<LeadForm>`), mount:

```jsx
      <DuplicateResolver
        open={showDupResolver}
        onClose={() => setShowDupResolver(false)}
        leads={leads}
        onMerge={handleDupMerge}
        onTagRepeated={handleDupTagRepeated}
        onDismissPair={handleDupDismiss}
      />
```

- [ ] **Step 6: Build + verify**

Run: `node --test src/lib/duplicateResolver.test.mjs`
Expected: PASS — 12 tests.

Run: `npx eslint src/components/LeadTracker.jsx src/components/DuplicateResolver.jsx src/components/RepeatedClientBadge.jsx src/lib/duplicateResolver.mjs`
Expected: No NEW errors (pre-existing LeadTracker lint warnings are fine to leave).

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/LeadTracker.jsx
git commit -m "Duplicate Resolver: wire LeadTracker (modal, banner, handlers)"
```

---

## Task 5: Insert the badge across views + LeadsView filter

**Files:**
- Modify: `src/components/views/LeadsView.jsx` (badge in name cell, new filter)
- Modify: `src/components/views/ClosedDeals.jsx` (badge in name cell)
- Modify: `src/components/views/ProspectsView.jsx` (badge in prospect detail header — only if the prospect has a `previousLeadId`)

- [ ] **Step 1: Add the badge import + usage to `LeadsView.jsx`**

Add at the top of `LeadsView.jsx` near the other component imports:

```jsx
import RepeatedClientBadge from '@/components/RepeatedClientBadge';
```

Find the row rendering for the Name column. It currently looks like:

```jsx
<td>... lead.name ...</td>
```

Replace the name display with a flex container that includes the badge:

```jsx
<td className="...existing classes...">
  <div className="flex items-center gap-2">
    <span>{lead.name}</span>
    <RepeatedClientBadge lead={lead} />
  </div>
</td>
```

Keep the existing td classes unchanged — only the inner content is wrapped.

- [ ] **Step 2: Add the "Repeated clients only" filter to LeadsView**

LeadsView already has a row of filter buttons (e.g. "Issued w/o advance", "Missing state"). Find that block and add a new filter button next to them:

```jsx
<button
  onClick={() => setShowRepeatedOnly(v => !v)}
  className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-1 ${
    showRepeatedOnly
      ? 'bg-indigo-600 text-white border-indigo-600'
      : 'border-slate-200 hover:bg-slate-50'
  }`}
>
  Repeated clients only
</button>
```

Add the state declaration near the other filter states at the top of the component:

```jsx
const [showRepeatedOnly, setShowRepeatedOnly] = useState(false);
```

Find where leads are filtered into the displayed list (a `useMemo` or `.filter()` chain). Add this clause to the filter chain so it composes with the existing filters:

```jsx
if (showRepeatedOnly && !l.previousLeadId) return false;
```

If the filter chain is a `.filter(l => ...)` callback, add the condition inside it. If it's a `useMemo` with explicit conditions, add it there. Match the surrounding style.

- [ ] **Step 3: Add the badge to `ClosedDeals.jsx`**

Add at the top of `ClosedDeals.jsx` near other component imports:

```jsx
import RepeatedClientBadge from '@/components/RepeatedClientBadge';
```

Find the Name cell rendering inside the closed-deal row table (search for `lead.name` or `l.name` in a `<td>`). Wrap the name in a flex container with the badge:

```jsx
<td className="...existing classes...">
  <div className="flex items-center gap-2">
    <span>{l.name}</span>
    <RepeatedClientBadge lead={l} />
  </div>
</td>
```

- [ ] **Step 4: Add the badge to `ProspectsView.jsx`**

Add at the top of `ProspectsView.jsx`:

```jsx
import RepeatedClientBadge from '@/components/RepeatedClientBadge';
```

Find the prospect-detail modal header where the prospect's name is rendered (search for `{prospect.name}` or similar inside the detail modal — there is one big detail header). Insert the badge next to the name:

```jsx
<div className="flex items-center gap-2">
  <h2 className="...existing classes...">{prospect.name}</h2>
  <RepeatedClientBadge lead={prospect} />
</div>
```

The badge component looks at `previousLeadId` regardless of whether the record is a lead or a prospect — the prop name is `lead` but the only field it reads is `previousLeadId`, which can be set on a prospect record too (e.g. a prospect that came back after a previous lead lapsed). It safely renders null when the field is absent.

- [ ] **Step 5: Verify**

Run: `npx eslint src/components/views/LeadsView.jsx src/components/views/ClosedDeals.jsx src/components/views/ProspectsView.jsx`
Expected: No NEW errors.

Run: `npx next build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/views/LeadsView.jsx src/components/views/ClosedDeals.jsx src/components/views/ProspectsView.jsx
git commit -m "Duplicate Resolver: badge across views + Repeated-only filter"
```

---

## Task 6: Final end-to-end check + push

- [ ] **Step 1: Run the test suite**

Run: `node --test src/lib/duplicateResolver.test.mjs src/lib/reports.test.mjs src/lib/mergeStore.test.mjs`
Expected: All tests pass (12 duplicate-resolver + 30 reports + 9 mergeStore = 51).

- [ ] **Step 2: Final build**

Run: `npx next build`
Expected: Build succeeds; new `/api` routes unchanged; bundle size unchanged meaningfully.

- [ ] **Step 3: Manual verification — checklist**

Start the app (`npm run dev`) and sign in.
- The banner appears above the view if there are unreviewed pairs (or doesn't appear if the agent has none).
- Clicking **Review now** opens the modal at "Pair 1 of N".
- Each of the three actions advances to the next pair.
- The **Merge** action reveals a "click the winner" step; clicking a card folds the loser in and deletes it.
- The **Repeated client** action sets the badge on the newer lead, visible on LeadsView and ClosedDeals after the modal closes.
- The **Keep both** action stamps both — pair doesn't reappear on a second pass.
- LeadsView's "Repeated clients only" filter shows only tagged leads.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-review notes

- **Spec coverage:**
  - §3 Data model — `previousLeadId` + `dedupReviewedAt` are set by the handlers in Task 4 Step 3 and read by the resolver pure logic (Task 1) + badge (Task 2).
  - §4 Detection + classification — Task 1 (`findDuplicateGroups`, `classifyPair`).
  - §5 UI flow — entry button (banner in Task 4 Step 4), resolver modal (Task 3), badge (Tasks 2 + 5), "Repeated clients only" filter (Task 5 Step 2).
  - §6 Architecture — all files listed in the table are touched.
  - §7 Edge cases — three-way matches surface as multiple pairs (Task 3 modal walks them one at a time, re-checking on each pass since pair list is recomputed when leads change).
- **Placeholder scan:** no TBD / TODO / "similar to" patterns. Every step has the actual code.
- **Type consistency:** function names (`findDuplicateGroups`, `enumeratePairs`, `shouldSkipPair`, `classifyPair`, `mergeLeads`) are defined in Task 1 and used by the modal (Task 3) and LeadTracker (Task 4) with the same signatures. The `previousLeadId` and `dedupReviewedAt` fields are written in Task 4 handlers and read everywhere consistently.
- **Out-of-scope items** (3-way UI, fuzzy match, auto-merge, repeated-client analytics on the CPA Dashboard) are listed in §8 of the spec and intentionally **not** in this plan.
