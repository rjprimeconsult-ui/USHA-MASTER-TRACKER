/**
 * Two-layer color system for PRIM Reports. See the design spec §5.
 * Layer 1: per-report identity color (header band).
 * Layer 2: per-value semantic color (good / bad / warn / neutral).
 */

// Layer 2 — value semantics. Same logic in every report.
export const SEMANTIC = {
  good:    '#059669', // emerald — profit, income, money earned, net positive
  bad:     '#DC2626', // red — net loss, chargebacks, over-budget spend
  warn:    '#D97706', // amber — approaching a threshold
  neutral: '#475569', // slate — routine costs, dates, labels, counts
};

// Layer 1 — per-report identity color (header band).
export const REPORT_IDENTITY = {
  leadsSold:   '#10B981', // emerald
  overrides:   '#6366F1', // indigo
  chargebacks: '#EF4444', // red
  expenses:    '#F59E0B', // amber
  // pnl is dynamic — see identityForPnl()
};

// P&L header color flips with the net result.
export function identityForPnl(net) {
  return net >= 0 ? '#10B981' : '#EF4444';
}

// Color for a value given its financial meaning.
//   kind: 'good' | 'bad' | 'warn' | 'neutral'
export function valueColor(kind) {
  return SEMANTIC[kind] || SEMANTIC.neutral;
}

// Net-result color — emerald when >= 0, red when negative.
export function netColor(net) {
  return net >= 0 ? SEMANTIC.good : SEMANTIC.bad;
}

// Budget status for an expense total against a budget.
// Returns { status, color }; status is 'none' | 'under' | 'near' | 'over'.
//   under: < 90% of budget   → good   near: 90%-100% → warn   over: > 100% → bad
//   none: no budget set (falsy or <= 0).
export function budgetStatus(spent, budget) {
  if (!budget || budget <= 0) return { status: 'none', color: SEMANTIC.neutral };
  const ratio = spent / budget;
  if (ratio > 1)    return { status: 'over',  color: SEMANTIC.bad };
  if (ratio >= 0.9) return { status: 'near',  color: SEMANTIC.warn };
  return { status: 'under', color: SEMANTIC.good };
}
