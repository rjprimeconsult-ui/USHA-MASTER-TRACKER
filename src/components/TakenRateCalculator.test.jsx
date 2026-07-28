/**
 * Component tests for TakenRateCalculator — suite #2 on the component lane.
 *
 * This component shipped three display defects on 2026-07-23 that the 577
 * logic tests could not see, because the formulas were RIGHT and the JSX
 * quoted the wrong one:
 *   1. the unreachable branch quoted the 10-deal figure for an all-issue
 *      scenario ("issue 27 of the next 27" -> 74.5%, contradicting the
 *      panel beside it by 146 deals) — must quote issuedNeeded,
 *   2. the display gates lacked the formulas' float tolerance, so an agent
 *      at exactly 58% targeting 58% read "you're at 58.0%… need 0 more",
 *   3. the clean-issue panel over-asked by one deal at exact-integer
 *      targets (68/76/80/90 for a 43-of-67 book).
 * Tests pin the number AND, where two numbers share a panel, the SLOT it
 * renders in (a mutation review proved a location-blind getByText let the
 * incident pattern — "Issue 10 of your next 8" — survive green).
 *
 * Fixtures use closedDate = now, so the default Monthly period always
 * includes them — no time mocking, no timezone fragility.
 */
import { test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// storage is only touched when priorsKey is set (bonus-year priors); mock it
// so importing the component never pulls the supabase client into jsdom.
vi.mock('@/lib/storage', () => ({
  storage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

import TakenRateCalculator from './TakenRateCalculator';

// ---- fixtures ----

const NOW_ISO = new Date().toISOString();

/** A book of `issued` Issued + (total - issued) Not-taken leads, closed now. */
function mkLeads(issued, total, over = {}) {
  const leads = [];
  for (let i = 0; i < issued; i++) leads.push({ id: `i${i}`, stage: 'Issued', closedDate: NOW_ISO, age: 30, ...over });
  for (let i = issued; i < total; i++) leads.push({ id: `n${i}`, stage: 'Not taken', closedDate: NOW_ISO, age: 30, ...over });
  return leads;
}

function setTarget(pct) {
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: String(pct) } });
}

/** The two target panels, located by their headings (never by styling). */
function cleanPanel() { return within(screen.getByText(/Clean-issue scenario/i).parentElement); }
function nextTenPanel() { return within(screen.getByText(/Your next 10 deals/i).parentElement); }

/** The gauge center, located by its unique 'X of Y' line — the rate string
 * also appears in breakdown rows, so it must be scoped, not global. */
function gauge(counts) { return within(screen.getByText(counts).parentElement); }

// ---- 1. the gauge shows the real book ----

test('gauge, badge and breakdown agree — and open or out-of-month leads never count', () => {
  const leads = [
    ...mkLeads(43, 67),
    // X15: an open-pipeline lead (no closedDate) must never enter the book
    { id: 'open1', stage: 'Pending', age: 30 },
    // X14: a lead closed years ago is not in the default Monthly period
    { id: 'old1', stage: 'Issued', closedDate: '2020-01-15T12:00:00Z', age: 30 },
  ];
  render(<TakenRateCalculator leads={leads} />);
  expect(gauge('43 of 67').getByText('64.2%')).toBeTruthy();
  // X40/X18: 64.2% is >= the 60% bonus threshold -> the badge must say so
  expect(screen.getByText('On target')).toBeTruthy();
  // X13/X39: the breakdown row must agree with the gauge
  const row = screen.getByText('Issued').closest('div');
  expect(within(row).getByText('43')).toBeTruthy();
  expect(within(row).getByText('64.2%')).toBeTruthy();
});

// ---- 2. incident defect #3: exact-integer targets are not over-asked ----

test('clean-issue panel: 43/67 @66% needs exactly 4; @68% exactly 8 (the shipped bug said 9)', () => {
  render(<TakenRateCalculator leads={mkLeads(43, 67)} />);
  setTarget(66);
  expect(cleanPanel().getByText('4')).toBeTruthy();
  expect(cleanPanel().getByText(/to hit 66%/)).toBeTruthy(); // X32: the number must be labeled with ITS target
  setTarget(68);
  expect(cleanPanel().getByText('8')).toBeTruthy();
  expect(cleanPanel().getByText(/to hit 68%/)).toBeTruthy();
  expect(cleanPanel().queryByText('9')).toBeNull(); // the pre-fix over-ask
});

// ---- 3. the next-10 panel quotes ITS OWN number, with the right framing ----

test('next-10 panel: 43/67 @66% says issue 8 of 10 and projects 66.2%', () => {
  render(<TakenRateCalculator leads={mkLeads(43, 67)} />);
  setTarget(66);
  const panel = nextTenPanel();
  // X20: SLOT-pinned — a location-blind getByText('8') let the spans swap
  // ("Issue 10 of your next 8") survive a green suite.
  expect(panel.getByText('8', { selector: '.text-indigo-700' })).toBeTruthy();
  expect(panel.getByText('10', { selector: '.text-slate-900' })).toBeTruthy();
  expect(panel.getByText(/66\.2%/)).toBeTruthy();          // (43+8)/(67+10)
  expect(panel.getByText(/You can afford 2 to fall out/)).toBeTruthy();
  expect(panel.getByText(/51 issued of 77 submitted \(you.re at 43 of 67 now\)/)).toBeTruthy();
});

test('next-10 panel: 4/15 @56% is REACHABLE at exactly 10 of 10 (pre-fix called it impossible)', () => {
  render(<TakenRateCalculator leads={mkLeads(4, 15)} />);
  setTarget(56);
  const panel = nextTenPanel();
  expect(panel.getByText('10', { selector: '.text-indigo-700' })).toBeTruthy();
  expect(panel.getByText(/All 10 must issue/)).toBeTruthy();
  expect(panel.queryByText(/wouldn.t reach/)).toBeNull();
});

// ---- 4. incident defect #1: the unreachable branch quotes issuedNeeded ----

test('unreachable branch (43/67 @90%) quotes the 173-deal clean-issue figure, never the 10-deal number', () => {
  render(<TakenRateCalculator leads={mkLeads(43, 67)} />);
  setTarget(90);
  const panel = nextTenPanel();
  expect(panel.getByText(/Even/)).toBeTruthy();
  expect(panel.getByText(/wouldn.t reach 90%/)).toBeTruthy();
  // THE incident assertion: 173 = cleanIssueDealsNeeded(43,67,90). The
  // shipped bug rendered issuesNeededInNext (27) here — "issue 27 of the
  // next 27" — which yields 74.5% and contradicted the adjacent panel.
  expect(panel.getByText('173')).toBeTruthy();
  expect(panel.queryByText('27')).toBeNull();
});

// ---- 5. incident defect #2: the at-target gate tolerates float error ----

test('exactly at target (29/50 @58%): both panels say at-or-above, never "need 0 more"', () => {
  render(<TakenRateCalculator leads={mkLeads(29, 50)} />);
  setTarget(58);
  expect(gauge('29 of 50').getByText('58.0%')).toBeTruthy();
  expect(cleanPanel().getByText(/Already at or above target/)).toBeTruthy();
  expect(nextTenPanel().getByText(/maintain your 58.0% pace/)).toBeTruthy(); // X19: pace is a %, not 0.58
  // The self-contradiction the epsilon fix removed. NOT /Need 0 more/ — the
  // count sits in a child span, so that string never exists as any single
  // element's text and the assertion could never fail (proven by probe).
  // The real guard: the clean panel contains no lone '0' count node.
  expect(cleanPanel().queryByText('0')).toBeNull();
  expect(screen.queryByText(/your next deals have to issue/)).toBeNull(); // below-target explainer hidden
});

test('below target shows the explainer sentence with the real rate', () => {
  render(<TakenRateCalculator leads={mkLeads(43, 67)} />);
  setTarget(66);
  expect(screen.getByText(/64\.2%/, { selector: 'b' })).toBeTruthy();
  expect(screen.getByText(/have to issue/)).toBeTruthy();
});

// ---- 6. the over-50 USHA rule ----

test('over-50 applicants are excluded entirely when the rule applies', () => {
  // 2 issued + 1 not-taken at age 30, plus 2 over-50s that must not count
  const leads = [
    ...mkLeads(2, 3),
    { id: 'o1', stage: 'Issued', closedDate: NOW_ISO, age: 55 },
    { id: 'o2', stage: 'Not taken', closedDate: NOW_ISO, ageBucket: 'OVER_50' },
  ];
  render(<TakenRateCalculator leads={leads} />);
  expect(gauge('2 of 3').getByText('66.7%')).toBeTruthy(); // over-50s absent from both sides
  const note = screen.getByText(/over-50 applicants excluded/);
  expect(within(note).getByText('2')).toBeTruthy();
});

test('age EXACTLY 50 counts — the rule is OVER 50, not 50-and-up', () => {
  // X9: a regression to `age >= 50` silently drops a 50-year-old's deal from
  // both sides of the bonus-qualifying rate. Pin the boundary.
  const leads = [
    ...mkLeads(2, 3),
    { id: 'b50', stage: 'Issued', closedDate: NOW_ISO, age: 50 },
  ];
  render(<TakenRateCalculator leads={leads} />);
  expect(gauge('3 of 4').getByText('75.0%')).toBeTruthy();
  expect(screen.queryByText(/over-50 applicant/)).toBeNull();
});

test('productFilter scopes the book — UW and GI cards must not bleed into each other', () => {
  // X23: both production call sites pass productFilter (CpaDashboard renders
  // a UW card and a GI card side by side with different bonus thresholds).
  const leads = [
    { id: 'a1', stage: 'Issued', closedDate: NOW_ISO, age: 30, mainProduct: 'UW_PLAN' },
    { id: 'a2', stage: 'Issued', closedDate: NOW_ISO, age: 30, mainProduct: 'UW_PLAN' },
    { id: 'a3', stage: 'Not taken', closedDate: NOW_ISO, age: 30, mainProduct: 'UW_PLAN' },
    { id: 'g1', stage: 'Issued', closedDate: NOW_ISO, age: 30, mainProduct: 'GI_PLAN' },
    { id: 'g2', stage: 'Issued', closedDate: NOW_ISO, age: 30, mainProduct: 'GI_PLAN' },
  ];
  render(<TakenRateCalculator leads={leads} productFilter={['UW_PLAN']} />);
  expect(gauge('2 of 3').getByText('66.7%')).toBeTruthy(); // GI deals excluded
});

test('the over-50 rule is OFF for GI (applyOver50Rule=false): everyone counts', () => {
  const leads = [
    ...mkLeads(2, 3),
    { id: 'o1', stage: 'Issued', closedDate: NOW_ISO, age: 55 },
  ];
  render(<TakenRateCalculator leads={leads} applyOver50Rule={false} />);
  expect(screen.getByText('3 of 4')).toBeTruthy();
  expect(screen.queryByText(/excluded from taken rate/)).toBeNull();
});

// ---- 7. empty state ----

test('no deals: gauge at 0, both panels show their empty prompts, no crash', () => {
  render(<TakenRateCalculator leads={[]} />);
  expect(screen.getByText('0 of 0')).toBeTruthy();
  expect(screen.getByText(/No deals for this period yet/)).toBeTruthy();
  expect(cleanPanel().getByText(/Submit a deal first/)).toBeTruthy();
  expect(nextTenPanel().getByText(/Need history to project/)).toBeTruthy();
});

// ---- 8. pending deals sit in the denominator only ----

test('pending deals raise the denominator but not the numerator', () => {
  const leads = [
    ...mkLeads(3, 4),
    { id: 'p1', stage: 'Pending', closedDate: NOW_ISO, age: 30 },
  ];
  render(<TakenRateCalculator leads={leads} />);
  expect(gauge('3 of 5').getByText('60.0%')).toBeTruthy();
});
