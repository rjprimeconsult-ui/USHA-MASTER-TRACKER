import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAKEN_RATE_HORIZON, cleanIssueDealsNeeded, issuesNeededInNext,
} from './takenRateTargets.mjs';

// Independent brute-force oracles — count upward until the ratio clears the bar.
// Deliberately NOT the closed-form the implementation uses, so a shared algebra
// mistake can't make both agree.
function bruteCleanIssue(issued, total, targetPct) {
  const R = targetPct / 100;
  for (let x = 0; x <= 100000; x++) if ((issued + x) / (total + x) >= R) return x;
  return null; // unreachable within the cap
}
function bruteNextN(issued, total, targetPct, horizon) {
  const R = targetPct / 100;
  for (let m = 0; m <= horizon * 1000; m++) if ((issued + m) / (total + horizon) >= R) return m;
  return null;
}

test('horizon constant is 10', () => {
  assert.equal(TAKEN_RATE_HORIZON, 10);
});

// ---------- the reported real-world case (screenshot: 43 of 67 @ 66%) ----------
test('43 of 67 at 66% target: 4 clean issues, or 8 of the next 10', () => {
  assert.equal(cleanIssueDealsNeeded(43, 67, 66), 4);
  assert.equal(issuesNeededInNext(43, 67, 66), 8);
  // and the resulting rates actually clear 66%
  assert.ok((43 + 4) / (67 + 4) >= 0.66);
  assert.ok((43 + 8) / (67 + 10) >= 0.66);
  // 3 is genuinely not enough — guards against an over-correction
  assert.ok((43 + 3) / (67 + 3) < 0.66);
});

// ---------- REGRESSION: the floating-point off-by-one that shipped ----------
// Each of these demanded one deal more than necessary before EPSILON.
test('regression: exact-integer answers are not inflated by float error', () => {
  assert.equal(cleanIssueDealsNeeded(43, 67, 68), 8);   // was 9
  assert.equal(cleanIssueDealsNeeded(43, 67, 76), 33);  // was 34
  assert.equal(cleanIssueDealsNeeded(43, 67, 80), 53);  // was 54
  assert.equal(cleanIssueDealsNeeded(43, 67, 90), 173); // was 174
  // each answer lands EXACTLY on the target — proof they're the true minimum
  for (const [t, x] of [[68, 8], [76, 33], [80, 53], [90, 173]]) {
    assert.equal(((43 + x) / (67 + x)) * 100, t, `${t}% should be hit exactly by ${x}`);
    assert.ok((43 + x - 1) / (67 + x - 1) < t / 100, `${x - 1} must fall short of ${t}%`);
  }
});

// ---------- already at or above target ----------
test('already at target -> 0 more needed', () => {
  assert.equal(cleanIssueDealsNeeded(33, 50, 66), 0);   // exactly 66.00%
  assert.equal(cleanIssueDealsNeeded(66, 100, 66), 0);
  assert.equal(cleanIssueDealsNeeded(80, 100, 66), 0);  // comfortably above
});

// ---------- no history ----------
test('no submitted deals -> null (nothing to project from)', () => {
  assert.equal(cleanIssueDealsNeeded(0, 0, 66), null);
  assert.equal(issuesNeededInNext(0, 0, 66), null);
});

// ---------- unreachable-in-window signalling ----------
test('a target out of reach in 10 deals returns more than the horizon', () => {
  const n = issuesNeededInNext(43, 67, 90);
  assert.ok(n > TAKEN_RATE_HORIZON, `expected >10, got ${n}`);
});
test('custom horizon is honoured', () => {
  assert.equal(issuesNeededInNext(43, 67, 66, 20), bruteNextN(43, 67, 66, 20));
});

// ---------- property sweep: closed form must equal brute force ----------
// Every slider position (30-90%) across a spread of real-looking books.
test('cleanIssueDealsNeeded matches brute force for all targets x many books', () => {
  const books = [[43, 67], [0, 1], [1, 3], [7, 10], [50, 100], [99, 150], [132, 200], [5, 40], [201, 333]];
  for (const [issued, total] of books) {
    for (let t = 30; t <= 90; t++) {
      assert.equal(
        cleanIssueDealsNeeded(issued, total, t),
        bruteCleanIssue(issued, total, t),
        `clean-issue mismatch at ${issued}/${total} target ${t}%`
      );
    }
  }
});
test('issuesNeededInNext matches brute force for all targets x many books', () => {
  const books = [[43, 67], [0, 1], [1, 3], [7, 10], [50, 100], [99, 150], [132, 200], [5, 40], [201, 333]];
  for (const [issued, total] of books) {
    for (let t = 30; t <= 90; t++) {
      assert.equal(
        issuesNeededInNext(issued, total, t),
        bruteNextN(issued, total, t, TAKEN_RATE_HORIZON),
        `next-10 mismatch at ${issued}/${total} target ${t}%`
      );
    }
  }
});
