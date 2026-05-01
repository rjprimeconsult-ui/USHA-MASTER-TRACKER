import { uid, today, daysAgo, weekAgo } from './utils';
import { RENAME_MAP, isPricedAssociation } from './constants';

export const mkLead = (o = {}) => ({
  id: uid(),
  name: '',
  age: 0,
  email: '',
  phone: '',
  source: 'Website',
  stage: 'Pending',
  dealValue: 0,
  leadCost: 0,
  owner: 'You',
  notes: '',
  dateAdded: today(),
  closedDate: null,
  lastTouch: today(),
  crm: 'RINGY',
  campaign: 'AGED.25',
  leadCategory: 'AGED',
  products: [],
  mainProduct: '',
  mainProductPremium: 0,
  state: '',
  advanceMonths: 7.5,
  payType: 'advance',   // 'advance' = upfront paid as Advance Months × monthly commission
                        // 'as_earned' = no upfront; paid monthly as client pays premium
  associationPlan: '',
  associationStatus: 'active',
  associationStartDate: null,
  associationEndDate: null,
  associationPauseDate: null,
  // Family members on the policy. When the primary is declined but the
  // spouse / a dependent gets approved, the weekly statement comes back
  // under THEIR name — statement matching looks up names in this list
  // too so the advance still routes to the right lead.
  // Each entry: { name, relationship: 'spouse' | 'child' | 'other', dob? }
  dependents: [],
  ...o,
});

// Map any legacy stage value to the new 5-stage outcome model
const STAGE_REMAP = {
  'Closed Won':  'Issued',
  'Closed Lost': 'Declined',
  'New':         'Pending',
  'Contacted':   'Pending',
  'Qualified':   'Pending',
  'Proposal':    'Pending',
  // Prior name for the pending stage
  'Submitted':   'Pending',
};

export const migrateLead = (l) => {
  let mainProduct       = RENAME_MAP[l.mainProduct]     || l.mainProduct     || '';
  const associationPlan = RENAME_MAP[l.associationPlan] || l.associationPlan || '';
  const stage           = STAGE_REMAP[l.stage] || l.stage || 'Pending';

  // ASSO/DENTAL/VISION used to be a main product; now it's split into
  // PREMIERVISION and DENTAL / SECUREDENTAL add-ons. Carry any legacy
  // mainProductPremium into a Dental add-on (the previous rate was Dental's).
  let carryProducts = Array.isArray(l.products) ? [...l.products] : [];
  if (mainProduct === 'ASSO/DENTAL/VISION') {
    const oldPrem = Number(l.mainProductPremium || 0);
    if (oldPrem > 0 && !carryProducts.some(p => p.id === 'DENTAL / SECUREDENTAL')) {
      carryProducts.push({ id: 'DENTAL / SECUREDENTAL', premium: oldPrem });
    }
    mainProduct = '';
  }

  const migrated = {
    associationStatus: 'active',
    associationStartDate: null,
    associationEndDate: null,
    associationPauseDate: null,
    mainProductPremium: 0,
    state: '',
    advanceMonths: 7.5,
    age: 0,
    payType: 'advance',
    ...l,
    stage,
    mainProduct,
    associationPlan,
    products: carryProducts,
    // Reset main premium if we just cleared the main product
    ...(l.mainProduct === 'ASSO/DENTAL/VISION' ? { mainProductPremium: 0 } : {}),
  };

  // Any post-close stage should have a closedDate; backfill with dateAdded if missing
  if (!migrated.closedDate) migrated.closedDate = l.closedDate || l.dateAdded || today();

  // Ensure dependents is always an array (was added later — older leads have no field)
  if (!Array.isArray(migrated.dependents)) migrated.dependents = [];

  // CRM rename: BENNEPATH (typo, lived <1hr) → BENEPATH. Idempotent.
  if (migrated.crm === 'BENNEPATH') migrated.crm = 'BENEPATH';

  // Set association start date retroactively to the close/submission date
  // (Juan's rule: association counts retroactive to the month it was submitted,
  //  but only pays out once the deal is Issued.)
  if (associationPlan
      && isPricedAssociation(associationPlan)
      && !migrated.associationStartDate
      && (stage === 'Pending' || stage === 'Issued')) {
    migrated.associationStartDate = migrated.closedDate;
  }
  return migrated;
};

export const SEED_LEADS = [
  mkLead({ name: 'William Stolte', email: 'bstolte@gmail.com', phone: '503-351-8050',
    source: 'Google', stage: 'Issued', dealValue: 574, owner: 'You',
    dateAdded: daysAgo(8), lastTouch: daysAgo(3), closedDate: daysAgo(3),
    crm: 'RINGY', campaign: 'AGED.25', leadCategory: 'AGED', leadCost: 0.25,
    mainProduct: 'PREMIER ADVANTAGE', associationPlan: 'EXECUTIVE DIAMOND',
    products: [
      { id: 'MEDGUARD III',                premium: 65 },
      { id: 'SECUREADVANTAGE ACCIDENT',    premium: 42 },
      { id: 'SECUREADVANTAGE HEALTH PLUS', premium: 218 },
      { id: 'SECUREADVANTAGE SICKNESS',    premium: 159 },
    ],
    notes: 'Policy 52Y2444880', associationStartDate: daysAgo(3) }),
  mkLead({ name: 'Ana Ruiz', email: 'ana@acme.co', phone: '305-555-0101',
    source: 'Website', stage: 'Pending', dealValue: 480, owner: 'Maria',
    dateAdded: daysAgo(12), lastTouch: daysAgo(2), closedDate: null,
    notes: 'Family plan, 2 kids', crm: 'RINGY', campaign: 'AGED.35', leadCategory: 'AGED' }),
  mkLead({ name: 'Brian Cole', email: 'b.cole@mail.com', phone: '305-555-0102',
    source: 'Facebook', stage: 'Pending', dealValue: 320, owner: 'You',
    dateAdded: daysAgo(8), lastTouch: daysAgo(1), closedDate: null, leadCategory: 'SHARED' }),
  mkLead({ name: 'Carla Mendez', email: 'carla@mendez.com', phone: '786-555-0103',
    source: 'Referral', stage: 'Issued', dealValue: 460, owner: 'Carlos',
    dateAdded: daysAgo(10), lastTouch: daysAgo(3), closedDate: daysAgo(3),
    notes: '12-employee LLC', crm: 'RINGY', campaign: 'AGED.25', leadCategory: 'REFERRAL',
    leadCost: 0.25, mainProduct: 'SECURE ADVANTAGE', associationPlan: 'DIAMOND',
    products: [{ id: 'MEDGUARD III', premium: 65 }], associationStartDate: daysAgo(3) }),
  mkLead({ name: 'Diego Perez', email: 'dperez@pdq.com', phone: '786-555-0104',
    source: 'Google', stage: 'Pending', dealValue: 720, owner: 'Jess',
    dateAdded: daysAgo(15), lastTouch: daysAgo(4), closedDate: null, leadCategory: 'GOOGLE LEADS' }),
  mkLead({ name: "Frank O'Neil", email: 'frank@oneil.co', phone: '407-555-0106',
    source: 'LinkedIn', stage: 'Issued', dealValue: 380, owner: 'You',
    dateAdded: daysAgo(45), lastTouch: daysAgo(40), closedDate: daysAgo(40),
    crm: 'TEXTDRIP', campaign: 'AGED.35', leadCategory: 'AGED', leadCost: 0.35,
    mainProduct: 'PREMIER CHOICE', associationPlan: 'EMERALD',
    associationStartDate: daysAgo(40) }),
  mkLead({ name: 'Jorge Nieto', email: 'jn@nieto.biz', phone: '305-555-0110',
    source: 'Referral', stage: 'Issued', dealValue: 520, owner: 'You',
    dateAdded: daysAgo(62), lastTouch: daysAgo(58), closedDate: daysAgo(58),
    crm: 'RINGY', campaign: 'AGED.50', leadCategory: 'REPEAT CLIENT', leadCost: 0.50,
    mainProduct: 'PREMIER ADVANTAGE', associationPlan: 'EXECUTIVE DIAMOND',
    associationStartDate: daysAgo(58) }),
  mkLead({ name: 'Kara Smith', email: 'kara.s@gmail.com', phone: '305-555-0111',
    source: 'Facebook', stage: 'Issued', dealValue: 280, owner: 'Maria',
    dateAdded: daysAgo(6), lastTouch: daysAgo(1), closedDate: daysAgo(1),
    crm: 'VANILLA', campaign: 'ELITE EXCLUSIVE', leadCategory: 'JACKPOT', leadCost: 0,
    mainProduct: 'HEALTH ACCESS III', associationPlan: 'ABC ELITE',
    associationStartDate: daysAgo(1) }),
  mkLead({ name: 'Mia Chen', email: 'mia@chen.io', phone: '305-555-0113',
    source: 'LinkedIn', stage: 'Issued', dealValue: 340, owner: 'Jess',
    dateAdded: daysAgo(90), lastTouch: daysAgo(85), closedDate: daysAgo(85),
    crm: 'RINGY', campaign: 'AGED.35', leadCategory: 'AGED', leadCost: 0.35,
    mainProduct: 'SECURE ADVANTAGE', associationPlan: 'DIAMOND',
    associationStartDate: daysAgo(85) }),
  mkLead({ name: 'Olivia Park', email: 'opark@park.com', phone: '305-555-0115',
    source: 'Referral', stage: 'Issued', dealValue: 780, owner: 'Maria',
    dateAdded: daysAgo(120), lastTouch: daysAgo(115), closedDate: daysAgo(115),
    crm: 'RINGY', campaign: 'AGED.25', leadCategory: 'REFERRAL', leadCost: 0.25,
    mainProduct: 'PREMIER ADVANTAGE', associationPlan: 'EXECUTIVE DIAMOND',
    associationStartDate: daysAgo(115) }),
  mkLead({ name: 'Raj Patel', email: 'raj@patel.co', phone: '305-555-0120',
    source: 'Google', stage: 'Issued', dealValue: 420, owner: 'Carlos',
    dateAdded: daysAgo(75), lastTouch: daysAgo(70), closedDate: daysAgo(70),
    crm: 'TEXTDRIP', campaign: 'HIGH EXCLUSIVE', leadCategory: 'SHARED', leadCost: 2.5,
    mainProduct: 'HEALTH ACCESS III', associationPlan: 'ABC EXECUTIVE',
    associationStartDate: daysAgo(70) }),
];

export const SEED_INVESTMENTS = [
  { id: uid(), weekStart: weekAgo(3), leadSpend: 450, crmWeekly: 60, crmDaily: 25, notes: '' },
  { id: uid(), weekStart: weekAgo(2), leadSpend: 500, crmWeekly: 60, crmDaily: 30, notes: '' },
  { id: uid(), weekStart: weekAgo(1), leadSpend: 600, crmWeekly: 60, crmDaily: 28, notes: 'Tested new FB ads' },
  { id: uid(), weekStart: weekAgo(0), leadSpend: 550, crmWeekly: 60, crmDaily: 35, notes: '' },
];

export const SEED_ACTIVITIES = [
  { id: uid(), date: daysAgo(21), agent: 'You', dials: 85,  appointments: 12, pitches: 7,  closes: 2, notes: '' },
  { id: uid(), date: daysAgo(14), agent: 'You', dials: 92,  appointments: 15, pitches: 9,  closes: 3, notes: '' },
  { id: uid(), date: daysAgo(7),  agent: 'You', dials: 110, appointments: 18, pitches: 11, closes: 4, notes: '' },
  { id: uid(), date: daysAgo(3),  agent: 'You', dials: 45,  appointments: 7,  pitches: 4,  closes: 1, notes: '' },
  { id: uid(), date: daysAgo(2),  agent: 'You', dials: 52,  appointments: 8,  pitches: 5,  closes: 2, notes: '' },
  { id: uid(), date: daysAgo(1),  agent: 'You', dials: 48,  appointments: 9,  pitches: 6,  closes: 1, notes: '' },
];
