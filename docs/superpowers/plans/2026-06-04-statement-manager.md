# Statement Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Settings panel that lets agents view and delete statement-derived data — per item (week / month / single row) and in bulk by a custom date range with a preview — instead of all-or-nothing clears.

**Architecture:** Pure grouping/range logic in `src/lib/statementManager.mjs` (node:test). A presentational `StatementManager.jsx` renders the range bar + grouped list. `LeadTracker.jsx` mounts it in Settings and owns the delete handlers (immutable filters over the existing `ownAdvances` / `overrides` / `chargebacks` / `businessIncome` state; existing effects persist). `applyStatement` stamps `fromStatement: true` on the Books-income rows it creates so statement income is reliably identifiable.

**Tech Stack:** Next.js 16 / React 19, Tailwind, lucide-react, `node:test`. Spec: `docs/superpowers/specs/2026-06-04-statement-manager-design.md`.

**Existing data (confirmed):**
- `ownAdvances` (`own_advances_v1`), `overrides` (`overrides_v1`), `chargebacks` (`chargebacks_v1`): rows `{ id, policyId, customer, productDesc, amount, period, ... }`, grouped by `period` (ISO date).
- `businessIncome` (`business_income_v1`): rows `{ id, date, category, amount, source, notes }`. Statement rows have `notes` starting `"Auto-imported from statement"` (and, after Task 2, `fromStatement: true`).
- State setters: `setOwnAdvances`, `setOverrides`, `setChargebacks`, `setBusinessIncome`. Settings clear buttons live ~`LeadTracker.jsx:2020`.

---

## File Structure
- **Create** `src/lib/statementManager.mjs` — `isStatementIncome`, `groupStatements`, `statementsInRange`.
- **Create** `src/lib/statementManager.test.mjs` — tests.
- **Create** `src/components/StatementManager.jsx` — the panel.
- **Modify** `src/components/LeadTracker.jsx` — `applyStatement` stamp; delete handlers; mount in Settings.

---

## Task 1: Pure lib — `isStatementIncome` + `groupStatements` + `statementsInRange`

**Files:**
- Create: `src/lib/statementManager.mjs`
- Test: `src/lib/statementManager.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/statementManager.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStatementIncome, groupStatements, statementsInRange } from './statementManager.mjs';

const adv = (id, period, amount, customer = 'C') => ({ id, period, amount, customer, productDesc: 'P', policyId: 'PID' + id });
const inc = (id, date, amount, over = {}) => ({ id, date, amount, category: 'MONTHLIES', source: 'Production Bonus', notes: 'Auto-imported from statement (RENEWAL_BONUS)', ...over });

test('isStatementIncome: flag, note-prefix true; manual income false', () => {
  assert.equal(isStatementIncome({ fromStatement: true }), true);
  assert.equal(isStatementIncome({ notes: 'Auto-imported from statement (BONUS)' }), true);
  assert.equal(isStatementIncome({ notes: 'Manual entry', category: 'OTHER_INCOME' }), false);
  assert.equal(isStatementIncome({}), false);
});

test('groupStatements: weekly grouped by period (desc), monthly by month (desc)', () => {
  const g = groupStatements({
    ownAdvances: [adv('o1', '2026-01-05', 100), adv('o2', '2026-01-12', 50)],
    overrides:   [adv('v1', '2026-01-05', 20)],
    chargebacks: [adv('c1', '2026-01-12', 30)],
    businessIncome: [inc('i1', '2026-01-31', 200), inc('i2', '2026-02-28', 300), { id: 'm1', date: '2026-01-15', amount: 999, notes: 'Manual' }],
  });
  // weekly: two periods, newest first
  assert.deepEqual(g.weekly.map(w => w.period), ['2026-01-12', '2026-01-05']);
  const wk5 = g.weekly.find(w => w.period === '2026-01-05');
  assert.equal(wk5.own.length, 1);
  assert.equal(wk5.override.length, 1);
  assert.equal(wk5.totals.own, 100);
  assert.equal(wk5.totals.override, 20);
  const wk12 = g.weekly.find(w => w.period === '2026-01-12');
  assert.equal(wk12.totals.chargeback, 30);
  // monthly: only statement income (manual m1 excluded), newest first
  assert.deepEqual(g.monthly.map(m => m.month), ['2026-02', '2026-01']);
  assert.equal(g.monthly.find(m => m.month === '2026-01').total, 200);
});

test('statementsInRange: inclusive boundaries; weekly by period, monthly by date', () => {
  const stores = {
    ownAdvances: [adv('o1', '2026-01-01', 100), adv('o2', '2026-06-04', 50), adv('o3', '2026-06-05', 10)],
    overrides:   [adv('v1', '2026-03-01', 20)],
    chargebacks: [adv('c1', '2025-12-31', 30)],
    businessIncome: [inc('i1', '2026-01-01', 200), inc('i2', '2026-06-04', 300), inc('i3', '2026-07-01', 1)],
  };
  const r = statementsInRange(stores, '2026-01-01', '2026-06-04');
  assert.deepEqual([...r.ownIds].sort(), ['o1', 'o2']);          // o3 (06-05) out
  assert.deepEqual([...r.overrideIds], ['v1']);
  assert.deepEqual([...r.chargebackIds], []);                    // c1 (2025-12-31) out
  assert.deepEqual([...r.monthlyIds].sort(), ['i1', 'i2']);      // i3 (07-01) out
  assert.equal(r.totals.own, 150);
  assert.equal(r.totals.override, 20);
  assert.equal(r.totals.chargeback, 0);
  assert.equal(r.totals.monthlyIncome, 500);
  assert.equal(r.counts.own, 2);
  assert.equal(r.counts.monthly, 2);
});

test('statementsInRange: empty range → zeros', () => {
  const r = statementsInRange({ ownAdvances: [], overrides: [], chargebacks: [], businessIncome: [] }, '2026-01-01', '2026-12-31');
  assert.equal(r.counts.own, 0);
  assert.equal(r.totals.monthlyIncome, 0);
  assert.equal(r.ownIds.size, 0);
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd /c/dev/usha-master-tracker && node --test src/lib/statementManager.test.mjs` → module not found.

- [ ] **Step 3: Implement**

```js
// src/lib/statementManager.mjs
/**
 * Statement Manager logic — pure, read-only grouping + range selection over
 * statement-derived data. No storage/DOM. See spec 2026-06-04.
 *
 * Weekly stores (ownAdvances / overrides / chargebacks): rows keyed by `period`
 *   (ISO YYYY-MM-DD statement week).
 * Monthly: business-income rows that came from a statement (flag or note),
 *   keyed by `date` (ISO).
 */

const STATEMENT_NOTE_PREFIX = 'Auto-imported from statement';

/** Did a business-income row come from a statement (vs manual entry)? */
export function isStatementIncome(row) {
  if (!row) return false;
  if (row.fromStatement === true) return true;
  return typeof row.notes === 'string' && row.notes.startsWith(STATEMENT_NOTE_PREFIX);
}

const day = (s) => String(s || '').slice(0, 10);
const month = (s) => String(s || '').slice(0, 7);
const sum = (rows) => rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

/**
 * Group weekly rows by period and statement-income rows by month.
 * Returns { weekly:[{period, own, override, chargeback, counts, totals}],
 *           monthly:[{month, rows, total}] }, each sorted newest-first.
 */
export function groupStatements({ ownAdvances = [], overrides = [], chargebacks = [], businessIncome = [] }) {
  const weeks = new Map();
  const ensure = (p) => {
    const k = day(p);
    if (!weeks.has(k)) weeks.set(k, { period: k, own: [], override: [], chargeback: [] });
    return weeks.get(k);
  };
  for (const r of ownAdvances)  ensure(r.period).own.push(r);
  for (const r of overrides)    ensure(r.period).override.push(r);
  for (const r of chargebacks)  ensure(r.period).chargeback.push(r);

  const weekly = [...weeks.values()].map(w => ({
    ...w,
    counts: { own: w.own.length, override: w.override.length, chargeback: w.chargeback.length },
    totals: { own: sum(w.own), override: sum(w.override), chargeback: sum(w.chargeback) },
  })).sort((a, b) => b.period.localeCompare(a.period));

  const months = new Map();
  for (const r of businessIncome) {
    if (!isStatementIncome(r)) continue;
    const k = month(r.date);
    if (!months.has(k)) months.set(k, { month: k, rows: [] });
    months.get(k).rows.push(r);
  }
  const monthly = [...months.values()]
    .map(m => ({ ...m, total: sum(m.rows) }))
    .sort((a, b) => b.month.localeCompare(a.month));

  return { weekly, monthly };
}

/**
 * Select all statement rows whose date falls within [from, to] (inclusive).
 * Weekly rows matched by `period`; monthly statement-income rows by `date`.
 * Returns id Sets + counts + dollar totals (for preview and delete).
 */
export function statementsInRange({ ownAdvances = [], overrides = [], chargebacks = [], businessIncome = [] }, from, to) {
  const lo = day(from);
  const hi = day(to);
  const inRange = (d) => { const k = day(d); return k >= lo && k <= hi; };

  const pick = (rows, dateKey) => rows.filter(r => inRange(r[dateKey]));
  const own = pick(ownAdvances, 'period');
  const override = pick(overrides, 'period');
  const chargeback = pick(chargebacks, 'period');
  const monthly = businessIncome.filter(r => isStatementIncome(r) && inRange(r.date));

  const idSet = (rows) => new Set(rows.map(r => r.id));
  const uniqWeeks = new Set([...own, ...override, ...chargeback].map(r => day(r.period)));
  const uniqMonths = new Set(monthly.map(r => month(r.date)));

  return {
    ownIds: idSet(own),
    overrideIds: idSet(override),
    chargebackIds: idSet(chargeback),
    monthlyIds: idSet(monthly),
    counts: {
      own: own.length, override: override.length, chargeback: chargeback.length,
      monthly: monthly.length, weeks: uniqWeeks.size, months: uniqMonths.size,
    },
    totals: { own: sum(own), override: sum(override), chargeback: sum(chargeback), monthlyIncome: sum(monthly) },
  };
}
```

- [ ] **Step 4: Run, expect PASS** — `cd /c/dev/usha-master-tracker && node --test src/lib/statementManager.test.mjs`.

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/lib/statementManager.mjs src/lib/statementManager.test.mjs && git commit -m "feat(statements): grouping + date-range selection lib + tests"
```

---

## Task 2: Stamp `fromStatement` on statement-created income

**Files:**
- Modify: `src/components/LeadTracker.jsx` (the `applyStatement` bonus/monthly income mapper, ~line 953 where each candidate `{ id: uid(), date: periodIso, category, amount, source, notes }` is returned)

- [ ] **Step 1: Add the flag**

Find the object returned inside the `candidates = bonusRows...map(...)` (it currently returns `{ id: uid(), date: periodIso, category: incomeCategory, amount: b.amount, source: ..., notes: ... }`). Add `fromStatement: true,` to that returned object:

```js
        return {
          id: uid(),
          date: periodIso,
          category: incomeCategory,
          amount: b.amount,
          source: b.label || 'Production Bonus',
          notes: noteParts.join(' · '),
          fromStatement: true,
        };
```

- [ ] **Step 2: Verify build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 3: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/LeadTracker.jsx && git commit -m "feat(statements): tag statement-created Books income with fromStatement"
```

---

## Task 3: `StatementManager.jsx` component

**Files:**
- Create: `src/components/StatementManager.jsx`

- [ ] **Step 1: Implement**

```jsx
'use client';
/**
 * Statement Manager — view + delete statement-derived data. Delete-only.
 * Range bulk delete (with preview) + per-week / per-month / per-row delete.
 * Pure-logic from statementManager.mjs; parent owns the actual state mutations.
 */
import { useMemo, useState } from 'react';
import { Trash2, ChevronDown, ChevronRight, AlertTriangle, CalendarRange } from 'lucide-react';
import { groupStatements, statementsInRange } from '@/lib/statementManager.mjs';

const inp = 'bg-white text-slate-900 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function earliestDate(stores) {
  const all = [
    ...stores.ownAdvances.map(r => r.period),
    ...stores.overrides.map(r => r.period),
    ...stores.chargebacks.map(r => r.period),
    ...stores.businessIncome.map(r => r.date),
  ].map(d => String(d || '').slice(0, 10)).filter(Boolean).sort();
  return all[0] || new Date().toISOString().slice(0, 10);
}

export default function StatementManager({
  ownAdvances = [], overrides = [], chargebacks = [], businessIncome = [],
  onDeleteRange, onDeleteWeek, onDeleteMonth, onDeleteRow,
}) {
  const stores = { ownAdvances, overrides, chargebacks, businessIncome };
  const grouped = useMemo(() => groupStatements(stores), [ownAdvances, overrides, chargebacks, businessIncome]);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => earliestDate(stores));
  const [to, setTo] = useState(today);
  const [expanded, setExpanded] = useState(() => new Set());

  const preview = useMemo(() => statementsInRange(stores, from, to), [ownAdvances, overrides, chargebacks, businessIncome, from, to]);
  const previewTotalRows = preview.counts.own + preview.counts.override + preview.counts.chargeback + preview.counts.monthly;

  const toggle = (key) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const hasAny = grouped.weekly.length > 0 || grouped.monthly.length > 0;
  if (!hasAny) {
    return <div className="text-sm text-slate-400 italic">No uploaded statements yet.</div>;
  }

  const runRange = () => {
    if (previewTotalRows === 0) return;
    if (!confirm(`Delete ${previewTotalRows} statement entr${previewTotalRows === 1 ? 'y' : 'ies'} dated ${from} to ${to}?\n\nThis removes advances/overrides/chargebacks and monthly payouts in that range. It updates your Earned / CPA / Books totals but does NOT change lead stages. This can't be undone.`)) return;
    onDeleteRange?.(from, to);
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
        Deleting removes commission/income entries (updating Earned, CPA, and Books) — it does not un-issue leads. To fix numbers, re-upload the correct statement.
      </div>

      {/* Range bulk delete */}
      <div className="border border-slate-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-900">
          <CalendarRange size={15} /> Delete a date range
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">From<br /><input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-slate-600">To<br /><input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)} /></label>
          <button onClick={runRange} disabled={previewTotalRows === 0}
            className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-bold flex items-center gap-1.5">
            <Trash2 size={14} /> Delete range
          </button>
        </div>
        <div className="text-[11px] text-slate-500 mt-2">
          {previewTotalRows === 0 ? 'Nothing in this range.' : (
            <>Will delete <b>{preview.counts.weeks}</b> week(s) and <b>{preview.counts.months}</b> monthly payout(s):
              {' '}{preview.counts.own + preview.counts.override} advance/override rows ({money(preview.totals.own + preview.totals.override)}),
              {' '}{preview.counts.chargeback} chargebacks ({money(preview.totals.chargeback)}),
              {' '}{preview.counts.monthly} monthly ({money(preview.totals.monthlyIncome)}).</>
          )}
        </div>
      </div>

      {/* Weekly list */}
      {grouped.weekly.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Weekly statements</div>
          <div className="space-y-1.5">
            {grouped.weekly.map(w => {
              const key = `w:${w.period}`;
              const open = expanded.has(key);
              return (
                <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                    <button onClick={() => toggle(key)} className="flex items-center gap-1.5 flex-1 text-left text-sm">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="font-semibold text-slate-900">Week of {w.period}</span>
                      <span className="text-xs text-slate-500">· {w.counts.own + w.counts.override} adv/ovr · {w.counts.chargeback} cb</span>
                    </button>
                    <span className="text-xs text-slate-600">{money(w.totals.own + w.totals.override)}</span>
                    <button onClick={() => { if (confirm(`Delete the entire week of ${w.period}?`)) onDeleteWeek?.(w.period); }}
                      className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-xs font-semibold flex items-center gap-1">
                      <Trash2 size={12} /> Delete week
                    </button>
                  </div>
                  {open && (
                    <div className="divide-y divide-slate-100">
                      {[['own', w.own], ['override', w.override], ['chargeback', w.chargeback]].flatMap(([store, rows]) =>
                        rows.map(r => (
                          <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                            <span className="w-16 text-slate-400 uppercase">{store}</span>
                            <span className="flex-1 text-slate-700 truncate">{r.customer || '(no name)'} · {r.productDesc || ''}</span>
                            <span className="text-slate-600">{money(r.amount)}</span>
                            <button onClick={() => onDeleteRow?.(store, r.id)} className="text-slate-400 hover:text-red-600" title="Delete row"><Trash2 size={12} /></button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly list */}
      {grouped.monthly.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Monthly payouts</div>
          <div className="space-y-1.5">
            {grouped.monthly.map(m => {
              const key = `m:${m.month}`;
              const open = expanded.has(key);
              return (
                <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                    <button onClick={() => toggle(key)} className="flex items-center gap-1.5 flex-1 text-left text-sm">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="font-semibold text-slate-900">{m.month}</span>
                      <span className="text-xs text-slate-500">· {m.rows.length} payout(s)</span>
                    </button>
                    <span className="text-xs text-slate-600">{money(m.total)}</span>
                    <button onClick={() => { if (confirm(`Delete all monthly payouts for ${m.month}?`)) onDeleteMonth?.(m.month); }}
                      className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-xs font-semibold flex items-center gap-1">
                      <Trash2 size={12} /> Delete month
                    </button>
                  </div>
                  {open && (
                    <div className="divide-y divide-slate-100">
                      {m.rows.map(r => (
                        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                          <span className="flex-1 text-slate-700 truncate">{r.source || r.category} · {r.date}</span>
                          <span className="text-slate-600">{money(r.amount)}</span>
                          <button onClick={() => onDeleteRow?.('income', r.id)} className="text-slate-400 hover:text-red-600" title="Delete row"><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build** — `cd /c/dev/usha-master-tracker && npx --no-install next build` (expect pass).

- [ ] **Step 3: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/StatementManager.jsx && git commit -m "feat(statements): StatementManager panel (range + per-item delete)"
```

---

## Task 4: Wire into LeadTracker Settings + delete handlers

**Files:**
- Modify: `src/components/LeadTracker.jsx`

- [ ] **Step 1: Imports**

Add near the other component imports:
```js
import StatementManager from './StatementManager';
import { statementsInRange, isStatementIncome } from '@/lib/statementManager.mjs';
```

- [ ] **Step 2: Add delete handlers**

Add these `useCallback`s near the other data handlers (e.g. after `onDeleteChargeback`):
```js
const deleteStatementRange = useCallback((from, to) => {
  const sel = statementsInRange({ ownAdvances, overrides, chargebacks, businessIncome }, from, to);
  setOwnAdvances(prev => prev.filter(r => !sel.ownIds.has(r.id)));
  setOverrides(prev => prev.filter(r => !sel.overrideIds.has(r.id)));
  setChargebacks(prev => prev.filter(r => !sel.chargebackIds.has(r.id)));
  setBusinessIncome(prev => prev.filter(r => !sel.monthlyIds.has(r.id)));
  showToast('Deleted statements in range');
}, [ownAdvances, overrides, chargebacks, businessIncome, showToast]);

const deleteStatementWeek = useCallback((period) => {
  const p = String(period).slice(0, 10);
  setOwnAdvances(prev => prev.filter(r => String(r.period).slice(0, 10) !== p));
  setOverrides(prev => prev.filter(r => String(r.period).slice(0, 10) !== p));
  setChargebacks(prev => prev.filter(r => String(r.period).slice(0, 10) !== p));
  showToast(`Deleted week ${p}`);
}, [showToast]);

const deleteStatementMonth = useCallback((month) => {
  const m = String(month).slice(0, 7);
  setBusinessIncome(prev => prev.filter(r => !(isStatementIncome(r) && String(r.date).slice(0, 7) === m)));
  showToast(`Deleted payouts for ${m}`);
}, [showToast]);

const deleteStatementRow = useCallback((store, id) => {
  if (store === 'own')        setOwnAdvances(prev => prev.filter(r => r.id !== id));
  else if (store === 'override')   setOverrides(prev => prev.filter(r => r.id !== id));
  else if (store === 'chargeback') setChargebacks(prev => prev.filter(r => r.id !== id));
  else if (store === 'income')     setBusinessIncome(prev => prev.filter(r => r.id !== id));
}, []);
```

- [ ] **Step 3: Mount in Settings**

In the Settings section (where the `clearAll(...)` buttons render, ~line 2020), add a labeled block above or below the clear buttons:
```jsx
<div className="mt-4">
  <div className="text-sm font-bold text-slate-900 mb-2">Uploaded statements</div>
  <StatementManager
    ownAdvances={ownAdvances}
    overrides={overrides}
    chargebacks={chargebacks}
    businessIncome={businessIncome}
    onDeleteRange={deleteStatementRange}
    onDeleteWeek={deleteStatementWeek}
    onDeleteMonth={deleteStatementMonth}
    onDeleteRow={deleteStatementRow}
  />
</div>
```

- [ ] **Step 4: Verify build + manual check** — `cd /c/dev/usha-master-tracker && npx --no-install next build`. Manual: Settings shows "Uploaded statements" with weekly/monthly groups; the range preview updates as dates change; deleting a week/month/row removes it and the dashboard KPIs update.

- [ ] **Step 5: Commit**

```bash
cd /c/dev/usha-master-tracker && git add src/components/LeadTracker.jsx && git commit -m "feat(statements): mount Statement Manager in Settings + delete handlers"
```

---

## Task 5: Verify, merge, announce

- [ ] **Step 1: Full lib tests** — `cd /c/dev/usha-master-tracker && npm test` (all pass, incl. new statementManager tests).
- [ ] **Step 2: Full build** — `cd /c/dev/usha-master-tracker && npx --no-install next build`.
- [ ] **Step 3: Final review** — dispatch a code reviewer over `main..HEAD` (focus: delete handlers filter the right stores; range inclusivity; monthly delete only touches statement income, never manual Books income; no leftover refs).
- [ ] **Step 4: Merge to main + push** (per finishing-a-development-branch).
- [ ] **Step 5: Announce (standing rule — BOTH):** add a `2026-06-04-statement-manager` entry to the TOP of `ANNOUNCEMENTS` in `src/lib/announcements.js` (emoji 🗂️, title e.g. "Manage your uploaded statements", body: view + delete a week/month/row or a whole date range; cta Open Settings/`profile` view as appropriate). Commit untagged + push an `[announce]`-tagged empty commit.

---

## Self-Review notes (addressed)
- **Spec coverage:** range bulk delete + preview (Task 1 `statementsInRange`, Task 3 range bar, Task 4 `deleteStatementRange`); per-week/month/row delete (Tasks 3-4); weekly + monthly scope (Task 1 grouping); statement-income detection + `fromStatement` stamp (Tasks 1-2); Settings placement (Task 4); delete-only (no edit anywhere); does-not-un-issue-leads (UI note in Task 3, handlers only touch money stores). ✓
- **Type consistency:** `groupStatements`→`{weekly:[{period,own,override,chargeback,counts,totals}],monthly:[{month,rows,total}]}` and `statementsInRange`→`{ownIds,overrideIds,chargebackIds,monthlyIds,counts,totals}` used identically in component + handlers; store keys `'own'|'override'|'chargeback'|'income'` consistent between component row buttons and `deleteStatementRow`. ✓
- **No placeholders:** all code shown; tests concrete. ✓
- **Safety:** monthly delete + range delete filter business income by `isStatementIncome` so manually-entered Books income is never removed. ✓
