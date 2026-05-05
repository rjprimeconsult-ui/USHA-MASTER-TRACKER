/**
 * Stripe Price IDs for each plan + billing period.
 *
 * IDs are NOT secret — they're created in the Stripe dashboard and
 * referenced from both client and server code. Test-mode and live-mode
 * have different IDs; this file currently holds TEST mode IDs (pricing
 * confirmed working, ready to swap in live IDs at launch).
 *
 * To add/change prices: open the product in Stripe Dashboard → Pricing
 * section → Copy ID, then paste here.
 */

export const STRIPE_PRICES = {
  starter: {
    monthly: 'price_1TTqhORr0XRmGc2lrGr4OAjS',
    yearly:  'price_1TTqjdRr0XRmGc2lAVH9A4HE',
  },
  pro: {
    monthly: 'price_1TTqnqRr0XRmGc2lRw656CiQ',
    yearly:  'price_1TTqoQRr0XRmGc2l9GypMayb',
  },
  team: {
    monthly: 'price_1TTqonRr0XRmGc2lLah9zuLl',
    yearly:  'price_1TTqp2Rr0XRmGc2lK0OLMEv5',
  },
};

// Display info for the pricing page. Source of truth for amounts so
// price-page copy stays in sync with what Stripe actually charges.
export const PLAN_DISPLAY = {
  starter: {
    name: 'Starter',
    tagline: 'Solo agents tracking their own book.',
    monthly: 49.95,
    yearly: 450.00, // Set to clean $450/yr in Stripe (~25% off vs monthly × 12)
    features: [
      'Smart Import (AI) for leads, expenses, statements',
      'Vendor memory + custom categories',
      'Prospects mini-CRM with calendar',
      'Tier-aware Calculator (WA → FSL)',
      'PRIM Assistant chatbot',
    ],
  },
  pro: {
    name: 'Pro',
    tagline: 'Producers who want CPA + ROI dashboards.',
    monthly: 99.00,
    yearly: 772.20,
    features: [
      'Everything in Starter',
      'CPA Dashboard + True Net rollups',
      'Bulk AI re-categorize',
      'Statement reconciliation tools',
      'Period close-out + audit trail',
      'Priority support',
    ],
    popular: true, // Drives the "Most popular" badge on /pricing
  },
  team: {
    name: 'Team',
    tagline: 'FSL teams managing downline + overrides.',
    monthly: 200.00,
    yearly: 1560.00,
    features: [
      'Everything in Pro',
      'Override commission tracking',
      'Multi-agent admin panel',
      'Team-wide insights',
      'Statement matching across downline',
      'White-glove onboarding',
    ],
  },
};

// Reverse lookup: Stripe Price ID → { tier, period }
// Used by the webhook handler to translate an incoming Price ID into
// our internal tier/period strings.
export function priceIdToTier(priceId) {
  if (!priceId) return null;
  for (const tier of Object.keys(STRIPE_PRICES)) {
    for (const period of ['monthly', 'yearly']) {
      if (STRIPE_PRICES[tier][period] === priceId) {
        return { tier, period };
      }
    }
  }
  return null;
}

export const TRIAL_DAYS = 7;
