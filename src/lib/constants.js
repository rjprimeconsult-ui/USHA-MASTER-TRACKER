// Post-close outcome stages.
// A deal is always in one of these — app is an outcome tracker, not a prospect funnel.
// Pending    = deal submitted to underwriting, awaiting decision
// Issued     = approved + commission paid
// Declined   = underwriting rejected (negative taken rate)
// Not taken  = client chose not to proceed (negative taken rate)
// Withdrawn  = agent withdrew the app (negative taken rate)
export const STAGES = [
  { id: 'Pending',    color: '#f59e0b', bg: 'bg-amber-100',   text: 'text-amber-700',   prob: 50 },
  { id: 'Issued',     color: '#10b981', bg: 'bg-emerald-100', text: 'text-emerald-700', prob: 100 },
  { id: 'Declined',   color: '#ef4444', bg: 'bg-red-100',     text: 'text-red-700',     prob: 0 },
  { id: 'Not taken',  color: '#64748b', bg: 'bg-slate-100',   text: 'text-slate-700',   prob: 0 },
  { id: 'Withdrawn',  color: '#a855f7', bg: 'bg-purple-100',  text: 'text-purple-700',  prob: 0 },
];

// Stages that count as "taken" (positive outcome)
export const TAKEN_STAGES = ['Issued'];
// Stages that count as pending (not yet decided) — the denominator includes these too
export const PENDING_STAGES = ['Pending'];

// Taken-rate product pools
// Underwritten products require underwriting review; GI = Guaranteed Issue (faster approval)
export const UNDERWRITTEN_PRODUCTS = ['PREMIER ADVANTAGE', 'SECURE ADVANTAGE', 'PREMIER CHOICE'];
export const GI_PRODUCTS            = ['HEALTH ACCESS III'];
// Stages that count as NOT taken (negative outcome)
export const NOT_TAKEN_STAGES = ['Declined', 'Not taken', 'Withdrawn'];

export const SOURCES = ['Website', 'Referral', 'Facebook', 'Google', 'LinkedIn', 'Cold Call', 'Event', 'CRM', 'Dialer', 'Other'];

export const OWNERS = ['You', 'Maria', 'Carlos', 'Jess'];

export const CRMS = [
  { id: 'RINGY',    badge: 'bg-red-500 text-white',     color: '#ef4444' },
  { id: 'TEXTDRIP', badge: 'bg-violet-500 text-white',  color: '#8b5cf6' },
  { id: 'VANILLA',  badge: 'bg-blue-500 text-white',    color: '#3b82f6' },
  { id: 'ONLYSALES', badge: 'bg-green-500 text-white',  color: '#22c55e' },
  { id: 'GOOGLE',   badge: 'bg-amber-500 text-white',   color: '#f59e0b' },
  { id: 'BENEPATH', badge: 'bg-teal-600 text-white',   color: '#0d9488' },
];

export const CAMPAIGNS = [
  { id: 'AGED.50',           badge: 'bg-sky-200 text-slate-800',    color: '#bae6fd' },
  { id: 'AGED.25',           badge: 'bg-pink-200 text-slate-800',   color: '#fbcfe8' },
  { id: 'AGED.35',           badge: 'bg-violet-200 text-slate-800', color: '#ddd6fe' },
  { id: 'AGED1.00',          badge: 'bg-violet-500 text-white',     color: '#8b5cf6' },
  { id: 'AGED.20',           badge: 'bg-slate-300 text-slate-800',  color: '#cbd5e1' },
  { id: 'AGED.15',           badge: 'bg-red-500 text-white',        color: '#ef4444' },
  { id: 'AGED.17',           badge: 'bg-red-900 text-white',        color: '#7f1d1d' },
  { id: 'PREMIUM SHARED',    badge: 'bg-green-200 text-slate-800',  color: '#bbf7d0' },
  { id: 'STANDARD SHARED',   badge: 'bg-blue-500 text-white',       color: '#3b82f6' },
  { id: 'HIGH EXCLUSIVE',    badge: 'bg-teal-800 text-white',       color: '#115e59' },
  { id: 'ELITE EXCLUSIVE',   badge: 'bg-green-500 text-white',      color: '#22c55e' },
  { id: 'D7 BIZZ LEAD',      badge: 'bg-fuchsia-600 text-white',    color: '#c026d3' },
  { id: 'JESUS BURGA LEADS', badge: 'bg-yellow-800 text-white',     color: '#854d0e' },
  { id: 'BENEPATH (BENNYS)', badge: 'bg-teal-600 text-white',       color: '#0d9488' },
  { id: 'REFERRAL',          badge: 'bg-purple-500 text-white',     color: '#a855f7' },
];

export const LEAD_CATEGORIES = [
  { id: 'AGED',          badge: 'bg-emerald-100 text-emerald-800 border border-emerald-300', color: '#34d399' },
  { id: 'SHARED',        badge: 'bg-blue-600 text-white',       color: '#2563eb' },
  { id: 'REFERRAL',      badge: 'bg-purple-500 text-white',     color: '#a855f7' },
  { id: 'DIALER',        badge: 'bg-orange-500 text-white',     color: '#f97316' },
  { id: 'REPEAT CLIENT', badge: 'bg-red-500 text-white',        color: '#ef4444' },
  { id: 'JACKPOT',       badge: 'bg-yellow-300 text-slate-800', color: '#fde047' },
  { id: 'D7',            badge: 'bg-pink-500 text-white',       color: '#ec4899' },
  { id: 'GOOGLE LEADS',  badge: 'bg-slate-300 text-slate-800',  color: '#cbd5e1' },
  { id: 'BENEPATH',      badge: 'bg-teal-600 text-white',       color: '#0d9488' },
];

export const MAIN_PRODUCTS = [
  { id: 'PREMIER ADVANTAGE',          premium: 0 },
  { id: 'PREMIER CHOICE',             premium: 0 },
  { id: 'SECURE ADVANTAGE',           premium: 0 },
  { id: 'SECUREADVANTAGE CONVERSION', premium: 0 },
  { id: 'HEALTH ACCESS III',          premium: 0 },
  { id: 'SUPPY',                      premium: 0 },
  { id: 'ACA WRAP',                   premium: 0 },
];

export const ASSOCIATION_PLANS = [
  { id: 'EXECUTIVE DIAMOND', premium: 89.95 },
  { id: 'DIAMOND',           premium: 62.25 },
  { id: 'EMERALD',           premium: 52.95 },
  { id: 'SAPPHIRE',          premium: 42.95 },
  { id: 'RUBY',              premium: 32.95 },
  { id: 'PEARL',             premium: 0 }, // discontinued tier — $0 residual is intentional (not a missing rate)
  { id: 'NO ASS.',           premium: 0 },
  { id: 'ABC ELITE',         premium: 79.95 },
  { id: 'ABC EXECUTIVE',     premium: 49.95 },
  { id: 'ABC ENTREPRENEUR',  premium: 34.95 },
  { id: 'SUPPY',             premium: 0 },
  { id: 'PRO WRAP',          premium: 0 },
];

export const ADDON_PRODUCTS = [
  { id: 'MEDGUARD III',          premium: 65.00 },
  { id: 'PREMIERVISION',         premium: 0 },
  { id: 'DENTAL / SECUREDENTAL', premium: 0 },
  { id: 'ACCIDENT PROTECTOR',    premium: 0 },
  { id: 'INCOME PROTECTOR',      premium: 0 },
  { id: 'LIFE PROTECTOR II',     premium: 0 },
];

export const ALL_PRODUCTS = [
  ...MAIN_PRODUCTS.map(p => ({ ...p, bucket: 'Main' })),
  ...ASSOCIATION_PLANS.map(p => ({ ...p, bucket: 'Association' })),
  ...ADDON_PRODUCTS.map(p => ({ ...p, bucket: 'Add-on' })),
];

export const productPremium = (id) => ALL_PRODUCTS.find(p => p.id === id)?.premium || 0;

export const ASSOCIATION_PRICING = {
  'EXECUTIVE DIAMOND': {
    premium: 89.95, commission: 18.00,
    compatibleWith: ['PREMIER ADVANTAGE', 'PREMIER CHOICE', 'SECURE ADVANTAGE'],
  },
  'DIAMOND': {
    premium: 62.25, commission: 13.00,
    compatibleWith: ['PREMIER ADVANTAGE', 'PREMIER CHOICE', 'SECURE ADVANTAGE'],
  },
  'EMERALD': {
    premium: 52.95, commission: 9.00,
    compatibleWith: ['PREMIER ADVANTAGE', 'PREMIER CHOICE', 'SECURE ADVANTAGE'],
  },
  'SAPPHIRE': {
    premium: 42.95, commission: 5.50,
    compatibleWith: ['PREMIER ADVANTAGE', 'PREMIER CHOICE', 'SECURE ADVANTAGE'],
  },
  'RUBY': {
    premium: 32.95, commission: 4.25,
    compatibleWith: ['PREMIER ADVANTAGE', 'PREMIER CHOICE', 'SECURE ADVANTAGE'],
  },
  'ABC ELITE': {
    premium: 79.95, commission: 14.00,
    compatibleWith: ['HEALTH ACCESS III'],
  },
  'ABC EXECUTIVE': {
    premium: 49.95, commission: 6.75,
    compatibleWith: ['HEALTH ACCESS III'],
  },
  'ABC ENTREPRENEUR': {
    premium: 34.95, commission: 3.25,
    compatibleWith: ['HEALTH ACCESS III'],
  },
};

export const isPricedAssociation = (id) => ASSOCIATION_PRICING[id] !== undefined;

/**
 * Maps a USHA CommissionDetail "Product" string to our internal association
 * plan id. The CSV ships codes like:
 *   "3005 - TIER 6 EXE DMND"
 *   "3105 - SCA TIER 6 EXE DMND"
 *   "2120 - ABCELITE2020"
 *   "3020 - AIBC PRO - ACA"
 *
 * The 3000 series and 3100 (SCA) series are parallel programs that share
 * tier labels — both 3005 and 3105 are "Executive Diamond" from the agent's
 * perspective. Same applies down the tiers. We collapse them.
 *
 * Returns null when the product doesn't map to one of our priced plans
 * (e.g. AIBC PRO ACA wraps don't appear in the lead form's dropdown).
 */
export function productCodeToPlanId(productString) {
  if (!productString || typeof productString !== 'string') return null;
  const s = productString.toUpperCase();
  // Order matters — check specific tiers before generic ones.
  if (s.includes('EXE DMND') || s.includes('EXEC DMND') || s.includes('EXECUTIVE DIAMOND')) return 'EXECUTIVE DIAMOND';
  if (s.includes('TIER 5 DIAMOND') || s.includes('TIER5 DIAMOND')) return 'DIAMOND';
  if (s.includes('TIER 4 EMERALD') || s.includes('TIER4 EMERALD')) return 'EMERALD';
  if (s.includes('TIER 3 SAPPHIRE') || s.includes('TIER3 SAPPHIRE')) return 'SAPPHIRE';
  if (s.includes('TIER 2 RUBY') || s.includes('TIER2 RUBY')) return 'RUBY';
  if (s.includes('TIER1 PEARL') || s.includes('TIER 1 PEARL')) return 'PEARL';
  if (s.includes('ABCELITE') || s.includes('ABC ELITE')) return 'ABC ELITE';
  if (s.includes('ABCEXECUTIVE') || s.includes('ABC EXECUTIVE')) return 'ABC EXECUTIVE';
  if (s.includes('ABCENTREPRENEUR') || s.includes('ABC ENTREPRENEUR')) return 'ABC ENTREPRENEUR';
  return null; // unknown — gets bucketed as OTHER
}

export const compatibleAssociations = (mainProduct) => {
  const priced = Object.keys(ASSOCIATION_PRICING);
  const unpriced = ASSOCIATION_PLANS.map(p => p.id).filter(id => !priced.includes(id));
  if (!mainProduct) return [...priced, ...unpriced];
  const allowed = priced.filter(id => ASSOCIATION_PRICING[id].compatibleWith.includes(mainProduct));
  return [...allowed, ...unpriced];
};

export const QUARTERS = [
  { key: 'Q1', label: 'Q1', earningMonths: [11, 0],    payoutMonth: 1,  desc: 'Dec–Jan → Feb' },
  { key: 'Q2', label: 'Q2', earningMonths: [2, 3, 4],  payoutMonth: 5,  desc: 'Mar–May → Jun' },
  { key: 'Q3', label: 'Q3', earningMonths: [5, 6, 7],  payoutMonth: 8,  desc: 'Jun–Aug → Sep' },
  { key: 'Q4', label: 'Q4', earningMonths: [8, 9, 10], payoutMonth: 11, desc: 'Sep–Nov → Dec' },
];

export const RENAME_MAP = {
  'HEALTH ACCESS':   'HEALTH ACCESS III',
  'HA ELITE':        'ABC ELITE',
  'HA EXECUTIVE':    'ABC EXECUTIVE',
  'HA ENTREPRENEUR': 'ABC ENTREPRENEUR',
};

// Derived lead category — source overrides stale stored category.
// "Referral" source ALWAYS wins regardless of what was uploaded as leadCategory,
// so the Closed Deals chart and Lead lists reflect actual lead origin.
export function effectiveLeadCategory(lead) {
  if (!lead) return 'OTHER';
  if (lead.source === 'Referral') return 'REFERRAL';
  return lead.leadCategory || 'OTHER';
}

export const NAV_TABS = [
  { id: 'cpa',          label: 'CPA Dashboard', icon: 'Calculator' },
  { id: 'closed',       label: 'Closed Deals',  icon: 'CheckSquare' },
  { id: 'dashboard',    label: 'Overview',      icon: 'LayoutDashboard' },
  { id: 'associations', label: 'Associations',  icon: 'Repeat' },
  { id: 'leads',        label: 'Book of Business', icon: 'Users' },
  { id: 'pipeline',     label: 'Pipeline',      icon: 'Columns' },
  { id: 'prospects',    label: 'Prospects',     icon: 'UserPlus' },
  { id: 'platforms',    label: 'Platforms',     icon: 'DollarSign' },
  { id: 'books',        label: 'Books',         icon: 'BookOpen' },
  { id: 'reports',      label: 'Reports',       icon: 'FileText' },
  { id: 'calculator',   label: 'Calculator',    icon: 'Calculator' },
  { id: 'upload',       label: 'Upload',        icon: 'Upload' },
];

// ---------------- PROSPECTS / CRM ----------------
// Default stages mirror the spreadsheet pipeline most agents already use.
// Each agent can rename / reorder / add / delete via the Prospects settings.
// Default prospect stages — \"New\" was removed because real-world USHA
// pipelines almost never have a true \"new\" bucket; prospects always land
// somewhere more specific (Webby Set / Pending Decision / Ghosted / etc.).
// SOLD is the disposition stage — moving a prospect there auto-converts
// them into a Lead.
export const DEFAULT_PROSPECT_STAGES = [
  { id: 'WEBBY_SET',          label: 'Webby Set',          color: '#0ea5e9' },
  { id: 'WEBBY_CONFIRMED',    label: 'Webby Confirmed',    color: '#fb923c' },
  { id: 'APPOINTMENT_SET',    label: 'Appointment Set',    color: '#3b82f6' },
  { id: 'MISSED_APPT',        label: 'Missed Appt',        color: '#f97316' },
  { id: 'PENDING_DECISION',   label: 'Pending Decision',   color: '#facc15' },
  { id: 'FOLLOWUP_LATER',     label: 'Follow-up Later',    color: '#a855f7' },
  { id: 'GHOSTED',            label: 'Ghosted',            color: '#9ca3af' },
  { id: 'SOLD',               label: 'Sold',               color: '#10b981' },
  { id: 'LOST',               label: 'Lost',               color: '#ef4444' },
];

// Stage we land on when an unknown / removed stage (like the old \"NEW\") is
// encountered. Used for auto-migration on load.
export const PROSPECT_FALLBACK_STAGE = 'PENDING_DECISION';

export const PROSPECT_SOURCES = [
  'Referral',
  'Google Ads',
  'Facebook Ads',
  'Web Lead',
  'Aged Lead',
  'Major League',
  'Bizz Lead',
  'Benepath',
  'Cold Call',
  'Dialer',
  'Bought Lead',
  'TextDrip',
  'Other',
];

export const PROSPECT_CRMS = ['TextDrip', 'Ringy', 'VanillaSoft', 'Benepath', 'None'];

/**
 * Per-CRM display style. Drives the colored, bold rendering of the CRM
 * label anywhere it shows up (prospect detail row, kanban cards, list
 * cells). Keep this in sync with PROSPECT_CRMS — unknown values render
 * with the slate fallback. Hex colors picked to work on both light and
 * dark mode without further overrides (mid-saturation, high contrast).
 */
export const PROSPECT_CRM_STYLES = {
  Ringy:       { color: '#EC4899', colorDark: '#F472B6', label: 'Ringy' },        // pink-500 / pink-400
  TextDrip:    { color: '#A855F7', colorDark: '#C084FC', label: 'TextDrip' },     // purple-500 / purple-400
  VanillaSoft: { color: '#1E3A8A', colorDark: '#60A5FA', label: 'VanillaSoft' },  // navy / blue-400 in dark
  Benepath:    { color: '#F97316', colorDark: '#FB923C', label: 'Benepath' },    // orange-500 / orange-400
  None:        { color: '#94A3B8', colorDark: '#94A3B8', label: 'None' },         // slate-400 (muted, both)
};

export function getCrmStyle(crm) {
  return PROSPECT_CRM_STYLES[crm] || { color: '#475569', colorDark: '#94A3B8', label: crm || '' };
}

// Aligned with MAIN_PRODUCTS so a prospect's policy type maps cleanly
// to a lead's mainProduct when the prospect is converted to a Lead.
//   PA    = PREMIER ADVANTAGE
//   PC    = PREMIER CHOICE
//   SA    = SECURE ADVANTAGE
//   HA    = HEALTH ACCESS III
//   WRAP  = ACA WRAP
//   SUPPY = SUPPY
export const PROSPECT_POLICY_TYPES = [
  'PA',
  'PC',
  'SA',
  'HA',
  'WRAP',
  'SUPPY',
];

// Business Books — expense categories (money OUT beyond lead spend / platforms).
//
// CRM platforms (Ringy / TextDrip / VanillaSoft) live in Books too as of
// 2026-05 — they used to have their own isolated store but agents kept
// missing them in audits because Books wouldn't show them. Now they're
// regular Books expenses with their own categories. The Platforms tab is
// a filtered view of these categories. True CPA reads from Books only
// (see TRUE_CPA_BOOK_CATEGORIES below) so there's no double-count.
export const EXPENSE_CATEGORIES = [
  { id: 'LEAD_INVESTMENT',     label: 'Lead Investment',   color: '#dc2626', badge: 'bg-red-100 text-red-700' },
  { id: 'PLATFORM_RINGY',      label: 'Ringy',             color: '#ef4444', badge: 'bg-red-500 text-white' },
  { id: 'PLATFORM_TEXTDRIP',   label: 'TextDrip',          color: '#8b5cf6', badge: 'bg-violet-500 text-white' },
  { id: 'PLATFORM_VANILLASOFT', label: 'VanillaSoft',      color: '#3b82f6', badge: 'bg-blue-500 text-white' },
  { id: 'PLATFORM_ONLYSALES',  label: 'OnlySales',         color: '#22c55e', badge: 'bg-green-500 text-white' },
  { id: 'OFFICE_RENT',    label: 'Office Rent',       color: '#b91c1c', badge: 'bg-red-100 text-red-800' },
  { id: 'OFFICE',         label: 'Office Supplies',   color: '#0ea5e9', badge: 'bg-sky-100 text-sky-700' },
  { id: 'SOFTWARE',       label: 'Software',          color: '#6366f1', badge: 'bg-indigo-100 text-indigo-700' },
  { id: 'MARKETING',      label: 'Marketing / Ads',   color: '#ec4899', badge: 'bg-pink-100 text-pink-700' },
  { id: 'RECRUITING',     label: 'Recruiting',        color: '#d946ef', badge: 'bg-fuchsia-100 text-fuchsia-700' },
  { id: 'TEAM_INCENTIVES', label: 'Team Incentives',  color: '#f97316', badge: 'bg-orange-100 text-orange-700' },
  { id: 'TRAVEL',         label: 'Travel / Lodging',  color: '#0891b2', badge: 'bg-cyan-100 text-cyan-800' },
  { id: 'VEHICLE',        label: 'Vehicle / Mileage', color: '#f59e0b', badge: 'bg-amber-100 text-amber-700' },
  { id: 'MEALS',          label: 'Meals',             color: '#84cc16', badge: 'bg-lime-100 text-lime-700' },
  { id: 'PROFESSIONAL',   label: 'Professional Fees', color: '#8b5cf6', badge: 'bg-violet-100 text-violet-700' },
  { id: 'PHONE_INTERNET', label: 'Phone / Internet',  color: '#06b6d4', badge: 'bg-cyan-100 text-cyan-700' },
  { id: 'HEALTHCARE',     label: 'Healthcare',        color: '#10b981', badge: 'bg-emerald-100 text-emerald-700' },
  { id: 'COACHING',       label: 'Coaching / Mentor', color: '#a855f7', badge: 'bg-purple-100 text-purple-700' },
  { id: 'AGENT_PAYOUT',   label: 'Agent Payout / Split Commission', color: '#e11d48', badge: 'bg-rose-100 text-rose-700' },
  { id: 'OTHER_EXPENSE',  label: 'Other',             color: '#94a3b8', badge: 'bg-slate-100 text-slate-700' },
];

// Books expense categories that contribute to TRUE CPA (cost-per-acquisition).
// Per agent direction: Lead Investment + Software + the CRM platform
// categories (Ringy / TextDrip / VanillaSoft) qualify as direct per-deal
// acquisition costs. Other categories like office rent / recruiting /
// travel are valid business expenses but don't scale per-deal so they're
// excluded from True CPA. They DO still flow into True Net.
export const TRUE_CPA_BOOK_CATEGORIES = [
  'LEAD_INVESTMENT',
  'SOFTWARE',
  'PLATFORM_RINGY',
  'PLATFORM_TEXTDRIP',
  'PLATFORM_VANILLASOFT',
  'PLATFORM_ONLYSALES',
];

// The three "platform" expense categories. Used in places where we need
// to filter Books down to just CRM-platform spend (e.g. Platforms tab,
// True CPA breakdown, migration of legacy platform_expenses_v1 entries).
export const PLATFORM_EXPENSE_CATEGORIES = [
  'PLATFORM_RINGY',
  'PLATFORM_TEXTDRIP',
  'PLATFORM_VANILLASOFT',
  'PLATFORM_ONLYSALES',
];

// Maps legacy `platform` field values ('TD' / 'RINGY' / 'VANILLA') to the
// matching Books category id. Drives migration + Smart Import routing.
export const PLATFORM_ID_TO_CATEGORY = {
  RINGY:     'PLATFORM_RINGY',
  TD:        'PLATFORM_TEXTDRIP',
  VANILLA:   'PLATFORM_VANILLASOFT',
  OS:        'PLATFORM_ONLYSALES',
  ONLYSALES: 'PLATFORM_ONLYSALES', // alias for AI/imports that emit the full name
};

// Inverse map — derive the platform "id" from a category. Used when we
// render Platforms tab views which still group/filter by platformId.
export const CATEGORY_TO_PLATFORM_ID = {
  PLATFORM_RINGY:       'RINGY',
  PLATFORM_TEXTDRIP:    'TD',
  PLATFORM_VANILLASOFT: 'VANILLA',
  PLATFORM_ONLYSALES:   'OS',
};

// Business Books — income categories (money IN beyond commissions)
export const INCOME_CATEGORIES = [
  { id: 'MONTHLIES',           label: 'Monthlies',                color: '#0d9488', badge: 'bg-teal-100 text-teal-800' },
  { id: 'MONTHLIES_PLUS_ASSOC', label: 'Monthlies + Association', color: '#7c3aed', badge: 'bg-violet-100 text-violet-800' },
  { id: 'BONUS',      label: 'Bonus',         color: '#10b981', badge: 'bg-emerald-100 text-emerald-700' },
  { id: 'OVERRIDE',   label: 'Override',      color: '#3b82f6', badge: 'bg-blue-100 text-blue-700' },
  { id: 'RENEWAL',    label: 'Renewal',       color: '#f59e0b', badge: 'bg-amber-100 text-amber-700' },
  { id: 'OTHER_1099', label: 'Other 1099',    color: '#8b5cf6', badge: 'bg-violet-100 text-violet-700' },
  { id: 'OTHER_INCOME', label: 'Other',       color: '#94a3b8', badge: 'bg-slate-100 text-slate-700' },
];

// Platform Expenses — daily texting / dialer / CRM credit log
export const PLATFORMS = [
  { id: 'TD',      label: 'TextDrip',    color: '#8b5cf6', badge: 'bg-violet-500 text-white' },
  { id: 'RINGY',   label: 'Ringy',       color: '#ef4444', badge: 'bg-red-500 text-white' },
  { id: 'VANILLA', label: 'VanillaSoft', color: '#3b82f6', badge: 'bg-blue-500 text-white' },
  { id: 'OS',      label: 'OnlySales',   color: '#22c55e', badge: 'bg-green-500 text-white' },
];

export const PLATFORM_REASONS = [
  'CREDIT REFILL',
  'CREDIT REFILL/RENEWAL',
  'MONTHLY SUBSCRIPTION',
  'RENEWAL',
  'OTHER',
];
