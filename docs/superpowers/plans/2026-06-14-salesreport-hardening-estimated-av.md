# SalesReport hardening + Estimated AV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the USHA SalesReport import bulletproof for non-technical agents — never silently mislabel a Not Taken/Cancelled status, keep policy numbers/premiums complete on re-upload so weekly-statement advances always attach, and fill an **Estimated AV** (from the statement's commission data) for clients who have an advance but no real AV.

**Architecture:** Pure logic lives in `src/lib` (`commission.js`, `reports.mjs`, `salesreport.js`, `statement.js`) and is unit-tested with `node:test`. Estimated AV flows into **all** KPIs through the single existing choke point `leadPremium()` in `reports.mjs` (every AV/premium total is `leadPremium(l) * 12`), so no KPI call site changes. A strict guardrail — estimate only when an advance attached AND no real premium exists — lives in `buildAdvancePatch()` and `leadPremium()`. UI adds an "est." badge and an aggregate "$X of $Y is estimated" notation.

**Tech Stack:** Next.js 16 / React 19, plain ES modules, `node --test` for unit tests, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-14-salesreport-hardening-estimated-av-design.md`

---

## File structure

- `src/lib/commission.js` — add `estimateAvFromAdvance()` + `productKeyFromDesc()` (pure inverse of the commission math).
- `src/lib/reports.mjs` — teach `leadPremium()` to fall back to the estimate; add `isEstimatedAV()` and `estimatedAvTotals()`.
- `src/lib/salesreport.js` — `normalizeStatus()` + expanded map + `unknownStatus` flag; `gapDetect` detects new policy numbers + premium diffs; `mergePolicyNumbers()` + `buildSalesReportPatch()` helpers for the apply step.
- `src/lib/statement.js` — in `reconcileStatement`, compute per-lead `estimatedAV`; extend `buildAdvancePatch()` to set/clear `estimatedAV`/`avEstimated` under the guardrail.
- `src/components/LeadTracker.jsx` — pass `m.estimatedAV` into `buildAdvancePatch`; use `buildSalesReportPatch` in the SalesReport apply path.
- `src/components/views/UploadView.jsx` — surface unrecognized statuses in the SalesReport preview.
- `src/components/views/LeadsView.jsx`, `ClosedDeals.jsx` — "est." badge on the AV/Premium cells.
- `src/components/views/Dashboard.jsx` + `src/lib/reports.mjs` (ReportSheet totals) — aggregate estimated-portion notation.
- Tests: `src/lib/commission.test.mjs` (new), `src/lib/reports.test.mjs`, `src/lib/salesreport.test.mjs`, `src/lib/statement.test.mjs`.

**Lead fields added:** `estimatedAV?: number`, `avEstimated?: boolean`. Real `mainProductPremium`/`products[].premium` stay authoritative and untouched.

---

## Task 1: `estimateAvFromAdvance` + `productKeyFromDesc` (commission.js)

**Files:**
- Modify: `src/lib/commission.js` (append exports)
- Test: `src/lib/commission.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/commission.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAvFromAdvance, productKeyFromDesc, projectCommission } from './commission.js';

test('estimateAvFromAdvance: prefers commPremium × 12 (basis=premium)', () => {
  const r = estimateAvFromAdvance({ commPremium: 100, netAdvance: 999, rate: 0.2, advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);
  assert.equal(r.basis, 'premium');
});

test('estimateAvFromAdvance: reverses from advance when no commPremium (basis=reverse)', () => {
  // monthly = 100, rate 0.20 → monthlyCommission 20; advance = 20 × 7.5 = 150.
  const r = estimateAvFromAdvance({ netAdvance: 150, rate: 0.20, advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);      // (150 / 7.5 / 0.20) × 12
  assert.equal(r.basis, 'reverse');
});

test('estimateAvFromAdvance: percent-style rate (20) is normalized to 0.20', () => {
  const r = estimateAvFromAdvance({ netAdvance: 150, rate: 20, advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);
});

test('estimateAvFromAdvance: resolves rate from product+tier when no rate given', () => {
  // PREMIER ADVANTAGE WA = 0.20. advance 150, months 7.5 → AV 1200.
  const r = estimateAvFromAdvance({ netAdvance: 150, productKey: 'PREMIER_ADVANTAGE', tier: 'WA', advanceMonths: 7.5 });
  assert.equal(r.estimatedAV, 1200);
});

test('estimateAvFromAdvance: unknown/zero rate and no premium → 0, basis=unknown', () => {
  assert.deepEqual(estimateAvFromAdvance({ netAdvance: 150, rate: 0, advanceMonths: 7.5 }),
    { estimatedAV: 0, basis: 'unknown' });
  assert.deepEqual(estimateAvFromAdvance({ netAdvance: 0, commPremium: 0 }),
    { estimatedAV: 0, basis: 'unknown' });
});

test('estimateAvFromAdvance: round-trips projectCommission (premium → advance → AV)', () => {
  const proj = projectCommission({ mainProduct: 'HEALTH ACCESS III', mainProductPremium: 300, products: [] }, 'WA');
  const r = estimateAvFromAdvance({ netAdvance: proj.advancePayout, productKey: 'HEALTH_ACCESS', tier: 'WA', advanceMonths: 7.5 });
  assert.ok(Math.abs(r.estimatedAV - 300 * 12) < 0.01);
});

test('productKeyFromDesc: maps common statement product descriptions', () => {
  assert.equal(productKeyFromDesc('PremierAdvantage Sickness'), 'PREMIER_ADVANTAGE');
  assert.equal(productKeyFromDesc('SECURE ADVANTAGE - ACCIDENT'), 'SECURE_ADVANTAGE');
  assert.equal(productKeyFromDesc('Health Access III'), 'HEALTH_ACCESS');
  assert.equal(productKeyFromDesc('Some Unknown Product'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/commission.test.mjs`
Expected: FAIL — `estimateAvFromAdvance is not a function`.

- [ ] **Step 3: Implement (append to `src/lib/commission.js`)**

```js
// Map a free-text statement product description → a RATES key (for the reverse
// fallback when the statement row carries no rate). Returns null if unknown.
export function productKeyFromDesc(desc) {
  const s = String(desc || '').toUpperCase();
  if (/PREMIER\s*ADVANTAGE/.test(s)) return 'PREMIER_ADVANTAGE';
  if (/PREMIER\s*CHOICE/.test(s))    return 'PREMIER_CHOICE';
  if (/SECURE\s*ADVANTAGE\s*CONVERSION/.test(s)) return 'SECURE_ADVANTAGE_CONVERSION';
  if (/SECURE\s*ADVANTAGE/.test(s))  return 'SECURE_ADVANTAGE';
  if (/HEALTH\s*ACCESS/.test(s))     return 'HEALTH_ACCESS';
  if (/MEDGUARD/.test(s))            return 'MEDGUARD';
  if (/PREMIER\s*VISION/.test(s))    return 'PREMIER_VISION';
  if (/DENTAL/.test(s))              return 'DENTAL';
  if (/ACCIDENT\s*PROTECTOR/.test(s)) return 'ACCIDENT_PROTECTOR';
  if (/INCOME\s*PROTECTOR/.test(s))  return 'INCOME_PROTECTOR';
  if (/LIFE\s*PROTECTOR/.test(s))    return 'LIFE_PROTECTOR_II';
  return null;
}

/**
 * Inverse of the commission math — estimate a policy's Annualized Value (AV)
 * from the weekly statement. Prefers the statement's own commissionable
 * premium; otherwise reverses the advance.
 *
 *   AV (premium basis) = commPremium × 12
 *   AV (reverse basis) = (netAdvance ÷ advanceMonths ÷ rate) × 12
 *
 * `rate` may be a decimal (0.20) or a percent (20); both are accepted. When no
 * rate is supplied it is resolved from productKey + tier (+ state) via the rate
 * table. Returns { estimatedAV, basis: 'premium'|'reverse'|'unknown' }.
 */
export function estimateAvFromAdvance({ commPremium = 0, netAdvance = 0, rate, productKey, tier = 'WA', state, advanceMonths = DEFAULT_ADVANCE_MONTHS } = {}) {
  const round2 = (n) => Math.round(n * 100) / 100;
  // Preferred: the statement already gives the commissionable premium.
  if (Number(commPremium) > 0) {
    return { estimatedAV: round2(Number(commPremium) * 12), basis: 'premium' };
  }
  // Fallback: reverse the advance. Normalize percent-style rates (>1) to decimal.
  let r = Number(rate) || 0;
  if (r > 1) r = r / 100;
  if (!r) r = resolveRate(productKey, tier, state);
  const months = Number(advanceMonths) || 0;
  if (!(Number(netAdvance) > 0) || !r || !months) {
    return { estimatedAV: 0, basis: 'unknown' };
  }
  const monthlyPremium = Number(netAdvance) / months / r;
  return { estimatedAV: round2(monthlyPremium * 12), basis: 'reverse' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/commission.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/commission.js src/lib/commission.test.mjs
git commit -m "Add estimateAvFromAdvance — inverse commission math for Estimated AV"
```

---

## Task 2: `leadPremium` estimate fallback + helpers (reports.mjs)

This is the DRY choke point: every AV/premium KPI is `leadPremium(l) * 12`. Teaching `leadPremium` to fall back to the estimate makes all KPIs include it automatically, gated by the guardrail (real premium wins).

**Files:**
- Modify: `src/lib/reports.mjs:97-101`
- Test: `src/lib/reports.test.mjs`

- [ ] **Step 1: Write the failing test (append to `src/lib/reports.test.mjs`)**

```js
import { leadPremium, isEstimatedAV, estimatedAvTotals } from './reports.mjs';

test('leadPremium: real premium wins, estimate ignored', () => {
  const l = { mainProductPremium: 200, products: [], avEstimated: true, estimatedAV: 9999 };
  assert.equal(leadPremium(l), 200);
  assert.equal(isEstimatedAV(l), false);
});

test('leadPremium: falls back to estimatedAV/12 when no real premium', () => {
  const l = { mainProductPremium: 0, products: [], avEstimated: true, estimatedAV: 1200 };
  assert.equal(leadPremium(l), 100);   // 1200 / 12
  assert.equal(isEstimatedAV(l), true);
});

test('leadPremium: no premium and no estimate → 0', () => {
  assert.equal(leadPremium({ mainProductPremium: 0, products: [] }), 0);
});

test('estimatedAvTotals: sums estimated AV vs total AV', () => {
  const leads = [
    { mainProductPremium: 100, products: [] },                                  // real AV 1200
    { mainProductPremium: 0, products: [], avEstimated: true, estimatedAV: 600 }, // est AV 600
  ];
  assert.deepEqual(estimatedAvTotals(leads), { estimatedAV: 600, totalAV: 1800 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/reports.test.mjs`
Expected: FAIL — `isEstimatedAV is not a function` / leadPremium returns 0 for the estimate case.

- [ ] **Step 3: Implement — replace `src/lib/reports.mjs:97-101`**

```js
export function leadPremium(lead) {
  const main = Number(lead.mainProductPremium) || 0;
  const addons = (lead.products || []).reduce((s, p) => s + (Number(p?.premium) || 0), 0);
  const real = main + addons;
  if (real > 0) return real;
  // Gap-fill ONLY when there's no real premium and an Estimated AV is on file
  // (set by the statement apply path when an advance lands on a client missing
  // AV — the Not Taken / Cancelled case). AV = premium × 12, so premium = AV/12.
  if (lead.avEstimated && Number(lead.estimatedAV) > 0) return Number(lead.estimatedAV) / 12;
  return 0;
}

// True when this lead's premium/AV is the reverse-engineered estimate, not real.
export function isEstimatedAV(lead) {
  const real = (Number(lead.mainProductPremium) || 0)
    + (lead.products || []).reduce((s, p) => s + (Number(p?.premium) || 0), 0);
  return real === 0 && !!lead.avEstimated && Number(lead.estimatedAV) > 0;
}

// Aggregate for the transparency notation: how much AV is estimated vs the total.
export function estimatedAvTotals(leads = []) {
  let estimatedAV = 0, totalAV = 0;
  for (const l of leads) {
    const av = leadPremium(l) * 12;
    totalAV += av;
    if (isEstimatedAV(l)) estimatedAV += av;
  }
  return { estimatedAV: Math.round(estimatedAV * 100) / 100, totalAV: Math.round(totalAV * 100) / 100 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/reports.test.mjs`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.mjs src/lib/reports.test.mjs
git commit -m "leadPremium falls back to Estimated AV; add isEstimatedAV + estimatedAvTotals"
```

---

## Task 3: Status normalization + surface unknowns (salesreport.js)

**Files:**
- Modify: `src/lib/salesreport.js` (STATUS_MAP region ~70-77; status resolution ~285-298)
- Test: `src/lib/salesreport.test.mjs`

- [ ] **Step 1: Write the failing test (append to `src/lib/salesreport.test.mjs`)**

If `salesreport.test.mjs` does not import `parseSalesReport`, add it to the existing import line. Then:

```js
import { normalizeStatus } from './salesreport.js';

test('normalizeStatus: maps real-world variants case/space-insensitively', () => {
  assert.equal(normalizeStatus('In Force'), 'Issued');
  assert.equal(normalizeStatus('  active '), 'Issued');
  assert.equal(normalizeStatus('Not Taken'), 'Not taken');
  assert.equal(normalizeStatus('NOTTAKEN'), 'Not taken');
  assert.equal(normalizeStatus('Declined'), 'Declined');
  assert.equal(normalizeStatus('Withdrawn'), 'Withdrawn');
  assert.equal(normalizeStatus('Canceled'), 'Withdrawn');
  assert.equal(normalizeStatus('Cancelled'), 'Withdrawn');
  assert.equal(normalizeStatus('Cancelled - NSF'), 'Withdrawn');
  assert.equal(normalizeStatus('Lapsed'), 'Withdrawn');
  assert.equal(normalizeStatus('Termed'), 'Withdrawn');
  assert.equal(normalizeStatus('Pending'), 'Pending');
  assert.equal(normalizeStatus('Submitted'), 'Pending');
});

test('normalizeStatus: unknown status returns null (NOT silently Pending)', () => {
  assert.equal(normalizeStatus('Frobnicated'), null);
  assert.equal(normalizeStatus(''), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/salesreport.test.mjs`
Expected: FAIL — `normalizeStatus is not a function`.

- [ ] **Step 3: Implement**

Replace the `STATUS_MAP` block (`src/lib/salesreport.js:70-77`) with:

```js
// Canonical status buckets. Keyed by normalized (lowercased, single-spaced)
// status text. Anything not here is treated as UNKNOWN and surfaced to the
// user — never silently defaulted to Pending.
const STATUS_RULES = [
  { re: /^(in ?force|active|issued)$/,                'Issued' },
  { re: /^not ?taken$/,                               'Not taken' },
  { re: /^declined$/,                                 'Declined' },
  { re: /^(withdrawn|lapsed|termed|terminated|rescinded)$/, 'Withdrawn' },
  { re: /^cancell?ed\b/,                              'Withdrawn' }, // Canceled / Cancelled / Cancelled - NSF
  { re: /^cancel$/,                                   'Withdrawn' },
  { re: /^(pending|submitted|received)$/,             'Pending' },
];

// Normalize a raw SalesReport status → a PRIM stage, or null if unrecognized.
export function normalizeStatus(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  for (const rule of STATUS_RULES) if (rule.re.test(s)) return rule[1];
  return null;
}
```

Note: each rule is `{ re, <stage> }` — read the stage as `rule[1]` (the second own-enumerable value is the string after `re`). To avoid index ambiguity, define rules as `{ re, stage }` and return `rule.stage`. Use this exact form:

```js
const STATUS_RULES = [
  { re: /^(in ?force|active|issued)$/, stage: 'Issued' },
  { re: /^not ?taken$/, stage: 'Not taken' },
  { re: /^declined$/, stage: 'Declined' },
  { re: /^(withdrawn|lapsed|termed|terminated|rescinded)$/, stage: 'Withdrawn' },
  { re: /^cancell?ed\b/, stage: 'Withdrawn' },
  { re: /^cancel$/, stage: 'Withdrawn' },
  { re: /^(pending|submitted|received)$/, stage: 'Pending' },
];
export function normalizeStatus(raw) {
  const s = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  for (const rule of STATUS_RULES) if (rule.re.test(s)) return rule.stage;
  return null;
}
```

Then update the "Finalize stages" loop (`src/lib/salesreport.js:285-298`). Replace:

```js
    d.stage = STATUS_MAP[chosenStatus] || 'Pending';
```

with:

```js
    const mapped = normalizeStatus(chosenStatus);
    if (mapped) {
      d.stage = mapped;
    } else {
      // Unrecognized status — do NOT silently call it Pending. Default to
      // Pending for now but flag the raw value so the UI can surface it.
      d.stage = 'Pending';
      d.unknownStatus = chosenStatus || '(blank)';
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/salesreport.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/salesreport.js src/lib/salesreport.test.mjs
git commit -m "SalesReport: normalize status variants; flag unknown instead of silent Pending"
```

---

## Task 4: gapDetect — detect new policy numbers + premium diffs (salesreport.js)

**Files:**
- Modify: `src/lib/salesreport.js:359-374` (the mismatch-building block in `gapDetect`)
- Test: `src/lib/salesreport.test.mjs`

- [ ] **Step 1: Write the failing test (append to `src/lib/salesreport.test.mjs`)**

```js
import { gapDetect } from './salesreport.js';

const deal = (over = {}) => ({
  nameKey: 'jane doe', name: 'Jane Doe', stage: 'Issued', mainProduct: 'HEALTH ACCESS III',
  mainMonthlyPremium: 100, addons: [], policyNumbers: ['52Y100000F'], ...over,
});

test('gapDetect: flags a new policy number not yet on the matched lead', () => {
  const deals = [deal({ policyNumbers: ['52Y100000F', '52Y100000G'] })];
  const leads = [{ id: 'L1', name: 'Jane Doe', stage: 'Issued', mainProduct: 'HEALTH ACCESS III', mainProductPremium: 100, policyNumber: '52Y100000F' }];
  const { mismatched } = gapDetect(deals, leads);
  const issue = mismatched[0].issues.find(i => i.kind === 'policyNumbers');
  assert.ok(issue, 'should flag new policy numbers');
  assert.deepEqual(issue.expected, ['52Y100000F', '52Y100000G']);
});

test('gapDetect: flags a premium difference', () => {
  const deals = [deal({ mainMonthlyPremium: 150 })];
  const leads = [{ id: 'L1', name: 'Jane Doe', stage: 'Issued', mainProduct: 'HEALTH ACCESS III', mainProductPremium: 100, policyNumber: '52Y100000F' }];
  const { mismatched } = gapDetect(deals, leads);
  const issue = mismatched[0].issues.find(i => i.kind === 'premium');
  assert.ok(issue);
  assert.equal(issue.expected, 150);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/salesreport.test.mjs`
Expected: FAIL — no `policyNumbers`/`premium` issue kinds.

- [ ] **Step 3: Implement — in `gapDetect`, extend the issues block (`src/lib/salesreport.js:363-373`)**

After the existing `stage` and `mainProduct` checks, before `if (issues.length > 0)`, add:

```js
      // New policy numbers discovered this upload (union, normalized). Keeping
      // the lead's policy list complete is what lets weekly-statement advances
      // attach by policy #.
      const existingPids = new Set(
        String(matchedLead.policyNumber || '')
          .split(/[,;|\s]+/).map(p => p.trim().toUpperCase()).filter(Boolean),
      );
      const dealPids = (d.policyNumbers || []).map(p => String(p).trim().toUpperCase()).filter(Boolean);
      const hasNewPid = dealPids.some(p => !existingPids.has(p));
      if (hasNewPid) {
        const merged = [...existingPids, ...dealPids.filter(p => !existingPids.has(p))];
        issues.push({ kind: 'policyNumbers', current: matchedLead.policyNumber || '', expected: merged });
      }

      // Premium correction (main monthly premium). Compare at cent precision.
      const dealPremium = Math.round((d.mainMonthlyPremium || 0) * 100) / 100;
      const leadPrem = Math.round((Number(matchedLead.mainProductPremium) || 0) * 100) / 100;
      if (dealPremium > 0 && dealPremium !== leadPrem) {
        issues.push({ kind: 'premium', current: leadPrem, expected: dealPremium });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/salesreport.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/salesreport.js src/lib/salesreport.test.mjs
git commit -m "gapDetect: detect new policy numbers + premium corrections on re-upload"
```

---

## Task 5: `buildSalesReportPatch` apply helper (salesreport.js)

The apply step needs to turn detected issues into a lead patch (merging, never dropping). Make it a pure, tested helper.

**Files:**
- Modify: `src/lib/salesreport.js` (append export)
- Test: `src/lib/salesreport.test.mjs`

- [ ] **Step 1: Write the failing test (append)**

```js
import { buildSalesReportPatch } from './salesreport.js';

test('buildSalesReportPatch: applies stage, product, merged policies, premium', () => {
  const lead = { id: 'L1', stage: 'Pending', mainProduct: '', mainProductPremium: 0, policyNumber: '52Y100000F' };
  const issues = [
    { kind: 'stage', expected: 'Not taken' },
    { kind: 'mainProduct', expected: 'HEALTH ACCESS III' },
    { kind: 'policyNumbers', expected: ['52Y100000F', '52Y100000G'] },
    { kind: 'premium', expected: 150 },
  ];
  const patch = buildSalesReportPatch(lead, issues);
  assert.equal(patch.stage, 'Not taken');
  assert.equal(patch.mainProduct, 'HEALTH ACCESS III');
  assert.equal(patch.policyNumber, '52Y100000F, 52Y100000G');
  assert.equal(patch.mainProductPremium, 150);
});

test('buildSalesReportPatch: empty issues → empty patch', () => {
  assert.deepEqual(buildSalesReportPatch({ id: 'L1' }, []), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/salesreport.test.mjs`
Expected: FAIL — `buildSalesReportPatch is not a function`.

- [ ] **Step 3: Implement (append to `src/lib/salesreport.js`)**

```js
/**
 * Turn gapDetect issues into a lead patch. Merges (never drops) — policy
 * numbers become a comma-joined union; stage/product/premium update in place.
 */
export function buildSalesReportPatch(lead, issues = []) {
  const patch = {};
  for (const i of issues) {
    if (i.kind === 'stage')        patch.stage = i.expected;
    else if (i.kind === 'mainProduct') patch.mainProduct = i.expected;
    else if (i.kind === 'premium')     patch.mainProductPremium = i.expected;
    else if (i.kind === 'policyNumbers') {
      patch.policyNumber = (i.expected || []).join(', ');
    }
  }
  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/salesreport.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/salesreport.js src/lib/salesreport.test.mjs
git commit -m "Add buildSalesReportPatch — merge gapDetect issues into a lead patch"
```

---

## Task 6: Per-lead Estimated AV in reconcileStatement (statement.js)

**Files:**
- Modify: `src/lib/statement.js` (import commission helpers near top; `reconcileStatement` matched-building loop ~778-791)
- Test: `src/lib/statement.test.mjs`

- [ ] **Step 1: Write the failing test (append to `src/lib/statement.test.mjs`)**

```js
test('reconcileStatement: attaches per-lead estimatedAV from commPremium', () => {
  // commPremium 100 → estimated AV 1200, attached to the single matched lead.
  const advanceRows = [
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLA', netAdvance: 150, commPremium: 100 },
  ];
  const leads = [{ id: 'L1', name: 'DOE, JANE', policyNumber: 'POLA', stage: 'Not taken', dealValue: 0 }];
  const m = run(advanceRows, leads).matched.find(x => x.leadId === 'L1');
  assert.equal(m.estimatedAV, 1200);
});

test('reconcileStatement: splits estimatedAV across leads in proportion to advance', () => {
  // Two policies, commPremium 100 each → customer est AV 2400; advance 600 total,
  // attributed 300/300, so est AV splits 1200/1200.
  const advanceRows = [
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLA', netAdvance: 300, commPremium: 100 },
    { writingAgent: OWNER, customer: 'DOE, JANE', policyId: 'POLB', netAdvance: 300, commPremium: 100 },
  ];
  const leads = [
    { id: 'A', name: 'DOE, JANE', policyNumber: 'POLA', stage: 'Issued', dealValue: 0 },
    { id: 'B', name: 'DOE, JANE', policyNumber: 'POLB', stage: 'Issued', dealValue: 0 },
  ];
  const byId = Object.fromEntries(run(advanceRows, leads).matched.map(m => [m.leadId, m]));
  assert.equal(byId.A.estimatedAV, 1200);
  assert.equal(byId.B.estimatedAV, 1200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/statement.test.mjs`
Expected: FAIL — `m.estimatedAV` is undefined.

- [ ] **Step 3: Implement**

Add the import near the top of `src/lib/statement.js` (after the existing imports/constants, before `reconcileStatement`):

```js
import { estimateAvFromAdvance, productKeyFromDesc } from './commission.js';
```

In `reconcileStatement`, inside the `if (matches.length > 0)` block, AFTER computing `leadTotals`/`unmatchedTotal` and BEFORE the `matches.forEach(...)` push (i.e., right after the existing `const share = ...` line), add the customer-level estimate:

```js
      // Customer-level Estimated AV: sum each advance row's estimated AV. Tier
      // comes from the statement header; per-lead state is unknown here so the
      // default rate applies (estimate only — real AV always wins downstream).
      const tier = header?.tier || 'WA';
      const customerEstAV = entry.rows.reduce((s, r) => {
        const { estimatedAV } = estimateAvFromAdvance({
          commPremium: r.commPremium,
          netAdvance: r.netAdvance,
          rate: r.rate,
          productKey: productKeyFromDesc(r.productDesc),
          tier,
        });
        return s + estimatedAV;
      }, 0);
```

Then in the existing `matches.forEach(lead => { matched.push({ ... }) })`, add an `estimatedAV` field computed proportionally to the lead's advance share. Replace the push object's `total:` line area so the object also includes:

```js
          total: leadTotals.get(lead.id) + (recipientIds.has(lead.id) ? share : 0),
          estimatedAV: (() => {
            const leadTotal = leadTotals.get(lead.id) + (recipientIds.has(lead.id) ? share : 0);
            if (entry.total > 0) return Math.round(customerEstAV * (leadTotal / entry.total) * 100) / 100;
            // No advance total to apportion by — give the whole estimate to a
            // lone lead; otherwise split evenly across matches.
            return Math.round((customerEstAV / matches.length) * 100) / 100;
          })(),
```

(Keep all other fields — `leadId`, `currentStage`, `currentDealValue`, `leadName`, `leadPolicyNumber`, `_fullTotal`, `_leadCount` — exactly as they are.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/statement.test.mjs`
Expected: PASS (including the prior split/advance tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/statement.js src/lib/statement.test.mjs
git commit -m "reconcileStatement: compute per-lead Estimated AV from advance rows"
```

---

## Task 7: Guardrail in `buildAdvancePatch` — set/clear estimatedAV (statement.js)

**Files:**
- Modify: `src/lib/statement.js` (`buildAdvancePatch`, appended earlier in the file)
- Test: `src/lib/statement.test.mjs`

- [ ] **Step 1: Write the failing test (append)**

```js
test('buildAdvancePatch: sets estimatedAV ONLY when lead has no real premium', () => {
  // No real AV → estimate applied + flagged.
  const p1 = buildAdvancePatch({ stage: 'Not taken', mainProductPremium: 0, products: [] }, 150, 'd', 1200);
  assert.equal(p1.estimatedAV, 1200);
  assert.equal(p1.avEstimated, true);

  // Real premium present → estimate ignored + any prior flag cleared.
  const p2 = buildAdvancePatch({ stage: 'Issued', mainProductPremium: 300, products: [] }, 150, 'd', 1200);
  assert.equal(p2.avEstimated, false);
  assert.equal(p2.estimatedAV, 0);

  // No estimate available → no flag.
  const p3 = buildAdvancePatch({ stage: 'Not taken', mainProductPremium: 0, products: [] }, 150, 'd', 0);
  assert.equal(p3.avEstimated, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/statement.test.mjs`
Expected: FAIL — `buildAdvancePatch` ignores the 4th arg.

- [ ] **Step 3: Implement — replace the existing `buildAdvancePatch` in `src/lib/statement.js`**

```js
export function buildAdvancePatch(lead, total, todayISO, estimatedAV = 0) {
  const patch = {
    lastTouch: todayISO,
    dealValue: Math.round((Number(total) || 0) * 100) / 100,
  };
  if (lead?.stage === 'Pending') patch.stage = 'Issued';

  // Estimated AV gap-fill (strict guardrail): only when this lead has NO real
  // premium on file AND the statement produced an estimate. Real AV always
  // wins — when present, clear any prior estimate flag.
  const realPremium = (Number(lead?.mainProductPremium) || 0)
    + (lead?.products || []).reduce((s, p) => s + (Number(p?.premium) || 0), 0);
  if (realPremium === 0 && Number(estimatedAV) > 0) {
    patch.estimatedAV = Math.round(Number(estimatedAV) * 100) / 100;
    patch.avEstimated = true;
  } else {
    patch.estimatedAV = 0;
    patch.avEstimated = false;
  }
  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/statement.test.mjs`
Expected: PASS. Also run the full lib suite: `npm test` — expect all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statement.js src/lib/statement.test.mjs
git commit -m "buildAdvancePatch: set/clear Estimated AV under strict no-real-premium guardrail"
```

---

## Task 8: Wire applyStatement + SalesReport apply (LeadTracker.jsx)

**Files:**
- Modify: `src/components/LeadTracker.jsx` — `applyStatement` (~781-797) and `applySalesReport` (~1021-1059)

- [ ] **Step 1: Pass estimatedAV into buildAdvancePatch in `applyStatement`**

In the `plan.matched` loop, change the patch line from:

```js
        const patch = buildAdvancePatch(l, m.total, today());
```

to:

```js
        const patch = buildAdvancePatch(l, m.total, today(), m.estimatedAV || 0);
```

(Leave the association-start-date line and `return { ...l, ...patch };` unchanged.)

- [ ] **Step 2: Use buildSalesReportPatch in `applySalesReport`**

Add to the import from salesreport at the top of LeadTracker.jsx (find the existing `import { ... } from '@/lib/salesreport'` or add one) the name `buildSalesReportPatch`. If salesreport is imported indirectly, add:

```js
import { buildSalesReportPatch } from '@/lib/salesreport';
```

In `applySalesReport`, the `stageUpdates` currently apply `newStage`/`newMainProduct`. Locate where each update is applied to a lead (the `setLeads(prev => prev.map(...))` that handles stage updates, ~1040-1055) and replace the per-lead field assignment with the full patch. Concretely, where a matched stage-update lead `l` is rebuilt, change it to merge the SalesReport patch built from that update's issues. The apply payload from `SalesReportGap.apply` (UploadView.jsx:1340-1346) must carry the issues — update it in Step 3 — then here:

```js
      setLeads(prev => prev.map(l => {
        const upd = stageUpdates.find(u => u.leadId === l.id);
        if (!upd) return l;
        const patch = buildSalesReportPatch(l, upd.issues || []);
        // Preserve existing association-start stamping when promoted to Issued.
        if (patch.stage === 'Issued' && l.associationPlan && isPricedAssociation(l.associationPlan) && !l.associationStartDate) {
          patch.associationStartDate = l.closedDate || today();
        }
        return { ...l, ...patch };
      }));
```

- [ ] **Step 3: Pass issues through the SalesReport apply payload (UploadView.jsx:1340-1346)**

In `SalesReportGap.apply`, change the `stageUpdates` map so each entry carries the full issues array (not just stage/product):

```js
    const stageUpdates = diff.mismatched
      .filter(m => fixStages.has(m.lead.id))
      .map(m => ({ leadId: m.lead.id, issues: m.issues }))
      .filter(u => u.issues && u.issues.length > 0);
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/LeadTracker.jsx src/components/views/UploadView.jsx
git commit -m "Wire Estimated AV into applyStatement; merge SalesReport policy#/premium on apply"
```

---

## Task 9: "est." badge on AV/Premium cells (LeadsView.jsx, ClosedDeals.jsx)

**Files:**
- Modify: `src/components/views/LeadsView.jsx` (AV/Premium cells ~409-414; import)
- Modify: `src/components/views/ClosedDeals.jsx` (AV cell, if it renders one)

- [ ] **Step 1: Import the helper in LeadsView.jsx**

Change `import { leadPremium } from '@/lib/reports.mjs';` (line 6) to:

```js
import { leadPremium, isEstimatedAV } from '@/lib/reports.mjs';
```

- [ ] **Step 2: Add the badge to the Premium + AV cells (LeadsView.jsx ~409-414)**

Replace the Premium and AV `<td>` bodies so an estimated lead shows the value plus a small "est." badge:

```jsx
                  <td className="text-right p-2 text-slate-700 font-semibold cursor-pointer" onClick={() => onEdit(l)} title="Monthly premium = main product + add-ons">
                    {leadPremium(l) > 0
                      ? <>{fmt(leadPremium(l))}{isEstimatedAV(l) && <span className="ml-1 align-middle text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded px-1 py-0.5">est</span>}</>
                      : <span className="text-slate-300 font-normal">—</span>}
                  </td>
                  <td className="text-right p-2 text-indigo-700 font-semibold cursor-pointer" onClick={() => onEdit(l)} title="Annualized Value = monthly premium × 12">
                    {leadPremium(l) > 0
                      ? <>{fmt(leadPremium(l) * 12)}{isEstimatedAV(l) && <span className="ml-1 align-middle text-[9px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded px-1 py-0.5">est</span>}</>
                      : <span className="text-slate-300 font-normal">—</span>}
                  </td>
```

(Confirm the exact surrounding markup before editing — the two cells are adjacent at LeadsView.jsx:409-414.)

- [ ] **Step 3: ClosedDeals badge (if applicable)**

Open `src/components/views/ClosedDeals.jsx`. If it imports `leadPremium` and renders an AV/Premium column, apply the same `isEstimatedAV(l)` badge pattern. If it does not render AV, skip (note in commit).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add src/components/views/LeadsView.jsx src/components/views/ClosedDeals.jsx
git commit -m "Show 'est.' badge on estimated AV/premium cells"
```

---

## Task 10: Aggregate estimated-portion notation (Dashboard + Reports)

**Files:**
- Modify: `src/components/views/Dashboard.jsx` (KPI strip)
- Modify: `src/lib/reports.mjs` (P&L / Leads-sold totals area ~130-172) or `ReportSheet` consumer

- [ ] **Step 1: Dashboard notation**

In `src/components/views/Dashboard.jsx`, import the helper:

```js
import { estimatedAvTotals } from '@/lib/reports.mjs';
```

Compute near the other KPI derivations:

```js
  const avEst = estimatedAvTotals(leads);
```

Under the AV KPI (or the KPI strip footer), render a notation when there is any estimated AV:

```jsx
      {avEst.estimatedAV > 0 && (
        <p className="text-[11px] text-amber-700 mt-1">
          {fmt(avEst.estimatedAV)} of {fmt(avEst.totalAV)} AV is estimated
          (reverse-engineered from commissions due to missing SalesReport data).
        </p>
      )}
```

(Use the Dashboard's existing currency formatter — match whatever `fmt`/`money` import it already uses.)

- [ ] **Step 2: Reports notation**

In `src/lib/reports.mjs`, the Leads-Sold / P&L builders compute `t.av`. Add the estimated portion to the returned totals so the ReportSheet can show it. In the totals object (~123-127) add:

```js
  }), { premium: 0, av: 0, advance: 0, leadCost: 0 });
  const avEstimated = leads.reduce((s, l) => s + (isEstimatedAV(l) ? leadPremium(l) * 12 : 0), 0);
```

Then include a footnote row/string in the report payload (where the report returns its `kpis`/`note`), e.g. add to the returned object:

```js
    estimatedAvNote: avEstimated > 0
      ? `${money(avEstimated)} of ${money(t.av)} AV is estimated (reverse-engineered from commissions due to missing SalesReport data).`
      : '',
```

Render `estimatedAvNote` in the `ReportSheet` component beneath the totals (find where the report's KPIs/title render and add a small amber line when the note is non-empty).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src/components/views/Dashboard.jsx src/lib/reports.mjs src/components/*ReportSheet*
git commit -m "Show aggregate estimated-AV portion on Dashboard + Reports"
```

---

## Task 11: Surface unrecognized statuses in the SalesReport preview (UploadView.jsx)

**Files:**
- Modify: `src/components/views/UploadView.jsx` (SalesReportGap `ready` view, near the diff summary ~1377+)

- [ ] **Step 1: Compute unknown-status deals**

In `SalesReportGap`, after `diff` is set, derive the list of deals carrying `unknownStatus`:

```js
  const unknownStatusDeals = (diff?.allRows ? [] : [])  // placeholder removed below
```

Replace with a real derivation from the parsed deals. `gapDetect` returns `missing`/`mismatched`/`extras`; the `unknownStatus` flag lives on the deal objects in `missing` and on `mismatched[].deal`. Compute:

```js
  const unknownStatusItems = [
    ...(diff?.missing || []).filter(d => d.unknownStatus),
    ...(diff?.mismatched || []).map(m => m.deal).filter(d => d?.unknownStatus),
  ];
```

- [ ] **Step 2: Render a warning panel when there are unknowns**

In the `status === 'ready'` branch (alongside the missing/mismatched panels), add:

```jsx
      {unknownStatusItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-900">
          <div className="font-bold mb-1">
            {unknownStatusItems.length} row{unknownStatusItems.length !== 1 ? 's' : ''} had a status PRIM didn’t recognize
          </div>
          <div className="text-xs mb-2">We left them as <b>Pending</b> — please confirm their real status after import.</div>
          <ul className="text-xs list-disc ml-5 space-y-0.5">
            {unknownStatusItems.slice(0, 12).map((d, i) => (
              <li key={i}><span className="font-semibold">{d.name}</span> — “{d.unknownStatus}”</li>
            ))}
          </ul>
        </div>
      )}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add src/components/views/UploadView.jsx
git commit -m "SalesReport preview: surface unrecognized statuses instead of silent Pending"
```

---

## Task 12: Full verification + deploy

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass (prior 284 + new commission/reports/salesreport/statement tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Confirm live**

Run: `git rev-parse --short HEAD` then poll `https://www.primtracker.com/api/version` until it returns that SHA.

---

## Self-review

**Spec coverage:**
- Part 1 (status robustness + surface unknowns) → Tasks 3, 11. ✓
- Part 2 (re-upload merges policy#/premium) → Tasks 4, 5, 8. ✓
- Part 3 (Estimated AV strict trigger + math) → Tasks 1, 6, 7. ✓
- Part 4 (KPIs include estimate + per-client badge + aggregate note in Dashboard AND Reports) → Tasks 2, 9, 10. ✓
- Testing → Tasks 1–7 TDD; Task 12 full suite. ✓
- Guardrail (estimate only when advance attached AND no real AV; real AV wins) → Tasks 2 (`leadPremium`/`isEstimatedAV`) + 7 (`buildAdvancePatch`). ✓

**Type/name consistency:** `estimateAvFromAdvance` returns `{ estimatedAV, basis }` (Tasks 1, 6 consume `.estimatedAV`). Lead fields `estimatedAV`/`avEstimated` set in Task 7, read in Tasks 2/9/10. `buildSalesReportPatch(lead, issues)` issue kinds (`stage`/`mainProduct`/`premium`/`policyNumbers`) match Task 4's emitted kinds. `buildAdvancePatch(lead, total, todayISO, estimatedAV)` 4th arg matches Task 8's call.

**Placeholder scan:** Task 11 Step 1 originally showed a placeholder line — it is explicitly replaced by the real `unknownStatusItems` derivation in the same step. No other placeholders.
