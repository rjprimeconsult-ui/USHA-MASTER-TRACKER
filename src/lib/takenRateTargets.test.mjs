import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAKEN_RATE_HORIZON, cleanIssueDealsNeeded, issuesNeededInNext, isAtOrAboveTarget,
} from './takenRateTargets.mjs';

// Independent oracles — count upward until the ratio clears the bar. Two things
// make them a real check: (1) they are NOT the closed form the implementation
// uses, so a shared algebra mistake can't make both agree; (2) they compare with
// INTEGER arithmetic (100*issued vs targetPct*total, cross-multiplied) so the
// oracle carries no float error of its own — it is exact truth, not a second
// opinion with the same weakness.
function bruteCleanIssue(issued, total, targetPct) {
  for (let x = 0; x <= 100000; x++) {
    if (100 * (issued + x) >= targetPct * (total + x)) return x;
  }
  return null; // unreachable within the cap
}
function bruteNextN(issued, total, targetPct, horizon) {
  for (let m = 0; m <= horizon * 1000; m++) {
    if (100 * (issued + m) >= targetPct * (total + horizon)) return m;
  }
  return null;
}

// Book list for the property sweeps. Includes the reported case, degenerate
// small books, large books, and the boundary books a review flagged as missing:
// total=90 (so total+horizon lands on 100), and the exact-integer flippers.
const BOOKS = [
  [43, 67], [0, 1], [1, 3], [7, 10], [50, 100], [99, 150], [132, 200],
  [5, 40], [201, 333], [4, 15], [29, 50], [45, 90], [50, 90], [57, 100], [87, 150],
];

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
  // Each answer lands EXACTLY on the target and X-1 falls short — proof it is
  // the true minimum. Compared with INTEGER arithmetic (100*issued vs t*total)
  // rather than a computed percentage: this suite's whole subject is float
  // fragility, so the assertions must not themselves depend on float equality.
  for (const [t, x] of [[68, 8], [76, 33], [80, 53], [90, 173]]) {
    assert.equal(100 * (43 + x), t * (67 + x), `${t}% should be hit exactly by ${x}`);
    assert.ok(100 * (43 + x - 1) < t * (67 + x - 1), `${x - 1} must fall short of ${t}%`);
  }
});

// ---------- REGRESSION: the "next N" formula also needed the epsilon ----------
// A review caught that the epsilon changed this formula too (the original commit
// message wrongly claimed it did not). These are cases where the pre-fix code
// over-asked — 5/40 @56% even flipped the panel from "unreachable" to reachable.
test('regression: next-N is also exact at integer answers', () => {
  // 5 of 40 @ 56%: (5+23)/(40+10) = 28/50 = exactly 56%. Pre-fix said 24.
  assert.equal(issuesNeededInNext(5, 40, 56), 23);
  assert.equal(100 * (5 + 23), 56 * (40 + 10));
  // 4 of 15 @ 56%: (4+10)/25 = 56% exactly — reachable in 10. Pre-fix said 11
  // (> horizon), which rendered "even 10 of 10 wouldn't reach 56%" — wrong.
  assert.equal(issuesNeededInNext(4, 15, 56), 10);
  assert.ok(issuesNeededInNext(4, 15, 56) <= TAKEN_RATE_HORIZON);
});

// ---------- the at/above-target gate must agree with the formulas ----------
test('isAtOrAboveTarget tolerates float error at the exact boundary', () => {
  // 29/50 is exactly 58%, but (29/50)*100 === 57.99999999999999 in IEEE-754.
  // A naive >= sends this agent down the below-target path, where the formula
  // correctly returns 0 -> "you're at 58.0%, you need 0 more deals to hit 58%".
  assert.equal((29 / 50) * 100 >= 58, false, 'precondition: naive compare fails here');
  assert.equal(isAtOrAboveTarget((29 / 50) * 100, 58), true);
  assert.equal(cleanIssueDealsNeeded(29, 50, 58), 0, 'formula already said 0 — gate must agree');
  // same class, other known-bad books from the sweep
  for (const [i, t, target] of [[57, 100, 57], [58, 100, 58], [87, 150, 58], [114, 200, 57]]) {
    assert.equal(isAtOrAboveTarget((i / t) * 100, target), true, `${i}/${t} @${target}%`);
  }
  // genuinely below target still reads as below
  assert.equal(isAtOrAboveTarget(64.2, 66), false);
  assert.equal(isAtOrAboveTarget((43 / 67) * 100, 66), false);
  // comfortably above
  assert.equal(isAtOrAboveTarget(80, 66), true);
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
  for (const [issued, total] of BOOKS) {
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
  for (const [issued, total] of BOOKS) {
    for (let t = 30; t <= 90; t++) {
      assert.equal(
        issuesNeededInNext(issued, total, t),
        bruteNextN(issued, total, t, TAKEN_RATE_HORIZON),
        `next-10 mismatch at ${issued}/${total} target ${t}%`
      );
    }
  }
});
