/**
 * takenRateTargets.mjs — the two "how do I reach my target taken rate?" answers
 * shown on the Taken Rate calculator.
 *
 * SELF-CONTAINED (no imports): unit-tested under `node --test`, where sibling app
 * modules are unimportable (extensionless imports). Keep it dependency-free.
 *
 * Extracted from TakenRateCalculator.jsx 2026-07-23 because BOTH formulas
 * carried a floating-point off-by-one that shipped unnoticed. Wherever the exact
 * answer lands on a whole number, `Math.ceil` saw 173.00000000000009 and
 * demanded 174:
 *   - clean-issue, 43-of-67 agent: targets 68/76/80/90% each over-asked by one.
 *   - next-N, same class: e.g. 4 issued of 15 at 56% needs exactly 10 of the
 *     next 10, but the old code returned 11 — over the horizon — so the panel
 *     announced "even 10 of your next 10 wouldn't reach 56%" about a target that
 *     was reachable. (A first pass at this fix wrongly claimed next-N was
 *     unaffected; it changed in thousands of cases. Do not repeat that claim.)
 * It only ever OVER-asked, so nobody was told they were finished early — but 80%
 * and 90% are targets agents really set. EPSILON absorbs that representation
 * error; the accompanying tests sweep every target against an exact-integer
 * oracle so the class of bug cannot come back.
 */

// Slack for IEEE-754 representation error (0.9*67 is 60.300000000000004, not 60.3).
// Far smaller than any real deal count, so it can never mask a genuine fraction.
const EPSILON = 1e-9;

// The projection window used by the "your next N deals" panel.
export const TAKEN_RATE_HORIZON = 10;

/**
 * Fewest ADDITIONAL deals that, if every one of them issues, reach targetPct.
 * Solves (issued + X) / (total + X) >= R  ->  X >= (R*total - issued) / (1 - R).
 * @returns {number|null} null when there is no history yet (total === 0)
 */
export function cleanIssueDealsNeeded(issued, total, targetPct) {
  if (!total || total <= 0) return null;
  const R = targetPct / 100;
  // Math.max(1 - R, 0.0001) keeps a 100% target from dividing by zero.
  return Math.max(0, Math.ceil((R * total - issued) / Math.max(1 - R, 0.0001) - EPSILON));
}

/**
 * Is the agent already at or above the target, tolerating float error?
 *
 * A plain `rate >= targetPct` disagrees with the formulas above at the exact
 * boundary: 29 issued of 50 IS 58%, but (29/50)*100 evaluates to
 * 57.99999999999999, so a naive compare sends the agent down the "below target"
 * path where cleanIssueDealsNeeded correctly answers 0 — rendering the nonsense
 * "you're at 58.0%, to lift it to 58% you need 0 more deals". Both sides must
 * use the same tolerance or the UI contradicts itself.
 * @param {number} ratePct current taken rate as a percentage (e.g. 58.0)
 */
export function isAtOrAboveTarget(ratePct, targetPct) {
  return ratePct >= targetPct - EPSILON;
}

/**
 * Of the next `horizon` SUBMITTED deals, how many must issue to reach targetPct.
 * Solves (issued + M) / (total + horizon) >= R  ->  M >= R*(total+horizon) - issued.
 * A result greater than `horizon` means the target is unreachable in that window.
 * @returns {number|null} null when there is no history yet (total === 0)
 */
export function issuesNeededInNext(issued, total, targetPct, horizon = TAKEN_RATE_HORIZON) {
  if (!total || total <= 0) return null;
  const R = targetPct / 100;
  return Math.max(0, Math.ceil(R * (total + horizon) - issued - EPSILON));
}
