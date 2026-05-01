/**
 * USHA Commission Engine
 * Rates come from the Exhibit 1 Commission Schedules provided by the user.
 * First-year rates only (renewals deliberately ignored per user request).
 *
 * Formula:
 *   monthlyCommission = commissionablePremium * rate
 *   advancePayout     = monthlyCommission * advanceMonths
 *
 * Non-commissionable policy fees (e.g., SecureAdvantage $10/mo) are NOT
 * auto-subtracted — agent is expected to enter only the commissionable portion.
 */

export const TIERS = [
  { id: 'WA',  label: 'Writing Agent' },
  { id: 'CA',  label: 'Career Agent' },
  { id: 'FTA', label: 'Field Training Agent' },
  { id: 'FSL', label: 'Field Sales Leader' },
];

export const DEFAULT_ADVANCE_MONTHS = 7.5;

/**
 * Given a history of advance-months changes and a date, return the months
 * value that was active on that date. History entries must have ISO
 * `effectiveDate` strings. Returns the default when no history exists or
 * all entries are in the future.
 */
export function getAdvanceMonthsForDate(history = [], dateIso, fallback = DEFAULT_ADVANCE_MONTHS) {
  if (!dateIso || !Array.isArray(history) || history.length === 0) return fallback;
  // Sort newest-first, then pick the first entry with effectiveDate <= dateIso
  const sorted = [...history].sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''));
  for (const entry of sorted) {
    if (!entry.effectiveDate) continue;
    if (entry.effectiveDate <= dateIso) return Number(entry.months) || fallback;
  }
  return fallback;
}

/** The currently-active advance months (uses today). */
export function currentAdvanceMonths(history, fallback = DEFAULT_ADVANCE_MONTHS) {
  return getAdvanceMonthsForDate(history, new Date().toISOString().slice(0, 10), fallback);
}

// US states most relevant for rate variations. We keep all 50 so agents can pick,
// but only a few trigger alternate rates.
export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

// States where HealthAccess Suite has reduced rates
const HEALTH_ACCESS_REDUCED_STATES = new Set(['CO', 'MD', 'SD']);
// States where Accident Protector has reduced rates
const ACCIDENT_PROTECTOR_REDUCED_STATES = new Set(['CO', 'SD']);
// States where Income Protector has reduced rates
const INCOME_PROTECTOR_REDUCED_STATES = new Set(['CO', 'DE', 'IN', 'KS', 'OH', 'UT', 'WV']);

/**
 * Rate tables — keyed by internal product key, then tier, then variant.
 * Every leaf is a decimal (e.g., 0.20 = 20%).
 *
 * `variant` key is a string describing the state bucket; `default` applies
 * when no other variant matches.
 */
const RATES = {
  PREMIER_ADVANTAGE: {
    default: { WA: 0.2000, CA: 0.2100, FTA: 0.2290, FSL: 0.2480 },
  },
  PREMIER_CHOICE: {
    default: { WA: 0.2000, CA: 0.2100, FTA: 0.2290, FSL: 0.2480 },
  },
  SECURE_ADVANTAGE: {
    default: { WA: 0.2100, CA: 0.2200, FTA: 0.2390, FSL: 0.2580 },
  },
  HEALTH_ACCESS: {
    default: { WA: 0.1600, CA: 0.1700, FTA: 0.1875, FSL: 0.2050 },
    reducedStates: { WA: 0.1250, CA: 0.1350, FTA: 0.1500, FSL: 0.1650 },
  },
  MEDGUARD: {
    default: { WA: 0.7500, CA: 0.8000, FTA: 0.8400, FSL: 0.8800 },
  },
  PREMIER_VISION: {
    default: { WA: 0.3800, CA: 0.4000, FTA: 0.4225, FSL: 0.4450 },
  },
  DENTAL: {
    default: { WA: 0.1800, CA: 0.2000, FTA: 0.2200, FSL: 0.2400 },
  },
  // Underwritten add-ons / standalone supplemental products
  ACCIDENT_PROTECTOR: {
    default:       { WA: 0.5700, CA: 0.6000, FTA: 0.6300, FSL: 0.6600 },
    reducedStates: { WA: 0.4300, CA: 0.4600, FTA: 0.4825, FSL: 0.5050 },
  },
  INCOME_PROTECTOR: {
    default:       { WA: 0.5700, CA: 0.6000, FTA: 0.6300, FSL: 0.6600 },
    reducedStates: { WA: 0.4200, CA: 0.4500, FTA: 0.4700, FSL: 0.4900 },
  },
  // Main underwritten products
  LIFE_PROTECTOR_II: {
    // Note: $2.12/mo policy fee is non-commissionable — agent enters the
    // commissionable portion (premium minus $2.12).
    default: { WA: 0.7500, CA: 0.8000, FTA: 0.8400, FSL: 0.8800 },
  },
  SECURE_ADVANTAGE_CONVERSION: {
    // Note: $30/mo non-commissionable policy fee when sold standalone.
    default: { WA: 0.0200, CA: 0.0200, FTA: 0.0260, FSL: 0.0320 },
  },
};

// Map UI product id → rate-table key. null means non-commissionable / exempt.
const MAIN_PRODUCT_RATE_KEY = {
  'PREMIER ADVANTAGE':           'PREMIER_ADVANTAGE',
  'PREMIER CHOICE':              'PREMIER_CHOICE',
  'SECURE ADVANTAGE':            'SECURE_ADVANTAGE',
  'SECUREADVANTAGE CONVERSION':  'SECURE_ADVANTAGE_CONVERSION',
  'HEALTH ACCESS III':           'HEALTH_ACCESS',
  'LIFE PROTECTOR II':           'LIFE_PROTECTOR_II',
  'SUPPY':                       null, // no main policy — deal is add-on only
  'ACA WRAP':                    null, // non-commissionable
};

const ADDON_RATE_KEY = {
  'MEDGUARD III':           'MEDGUARD',
  'PREMIERVISION':          'PREMIER_VISION',
  'DENTAL / SECUREDENTAL':  'DENTAL',
  'ACCIDENT PROTECTOR':     'ACCIDENT_PROTECTOR',
  'INCOME PROTECTOR':       'INCOME_PROTECTOR',
};

/**
 * Resolve the tier rate for a given product key and state.
 * Returns a number (decimal rate) or 0 if product is exempt / unmapped.
 */
export function resolveRate(productRateKey, tier, state) {
  if (!productRateKey) return 0;
  const table = RATES[productRateKey];
  if (!table) return 0;

  // Product-specific state handling
  if (productRateKey === 'HEALTH_ACCESS' && state && HEALTH_ACCESS_REDUCED_STATES.has(state)) {
    return table.reducedStates?.[tier] ?? 0;
  }
  if (productRateKey === 'ACCIDENT_PROTECTOR' && state && ACCIDENT_PROTECTOR_REDUCED_STATES.has(state)) {
    return table.reducedStates?.[tier] ?? 0;
  }
  if (productRateKey === 'INCOME_PROTECTOR' && state && INCOME_PROTECTOR_REDUCED_STATES.has(state)) {
    return table.reducedStates?.[tier] ?? 0;
  }

  return table.default?.[tier] ?? 0;
}

/**
 * Project the commission for a lead given the agent's tier.
 *
 * Returns:
 * {
 *   monthlyCommission: number,        // total $/mo before advance multiplier
 *   advancePayout: number,            // upfront $, monthly × advanceMonths
 *   breakdown: [{ label, premium, rate, monthly, advance }, ...]
 * }
 *
 * Does NOT include association plan commission — that stays as its own
 * recurring monthly stream (per user: "NO, it stays the same").
 */
export function projectCommission({ mainProduct, mainProductPremium, products, state, advanceMonths = DEFAULT_ADVANCE_MONTHS }, tier = 'WA') {
  const breakdown = [];
  let monthlyCommission = 0;

  // Main product
  if (mainProduct && mainProduct in MAIN_PRODUCT_RATE_KEY) {
    const rateKey = MAIN_PRODUCT_RATE_KEY[mainProduct];
    const rate = resolveRate(rateKey, tier, state);
    const monthly = (mainProductPremium || 0) * rate;
    breakdown.push({
      label: mainProduct,
      premium: mainProductPremium || 0,
      rate,
      monthly,
      advance: monthly * advanceMonths,
    });
    monthlyCommission += monthly;
  }

  // Add-ons
  (products || []).forEach(p => {
    const rateKey = ADDON_RATE_KEY[p.id];
    const rate = resolveRate(rateKey, tier, state);
    const monthly = (p.premium || 0) * rate;
    breakdown.push({
      label: p.id,
      premium: p.premium || 0,
      rate,
      monthly,
      advance: monthly * advanceMonths,
    });
    monthlyCommission += monthly;
  });

  return {
    monthlyCommission,
    advancePayout: monthlyCommission * advanceMonths,
    breakdown,
  };
}
