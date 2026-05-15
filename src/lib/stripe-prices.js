/**
 * Stripe Price IDs for each plan + billing period.
 *
 * IDs are NOT secret — they're created in the Stripe dashboard and
 * referenced from both client and server code. Test-mode and live-mode
 * have different IDs; this file currently holds LIVE mode IDs.
 *
 * To add/change prices: open the product in Stripe Dashboard → Pricing
 * section → Copy ID, then paste here.
 */

export const STRIPE_PRICES = {
  starter: {
    monthly: 'price_1TXM28Rr0XRmGc2ljiOUCMWc',
    yearly:  'price_1TXM3wRr0XRmGc2lAaKk4wlW',
  },
  pro: {
    monthly: 'price_1TXM4LRr0XRmGc2l9iTMeYfQ',
    yearly:  'price_1TXM4dRr0XRmGc2lVbBpp8rf',
  },
  team: {
    monthly: 'price_1TXM5KRr0XRmGc2liPAPlufy',
    yearly:  'price_1TXM5YRr0XRmGc2l91C2QDuQ',
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
