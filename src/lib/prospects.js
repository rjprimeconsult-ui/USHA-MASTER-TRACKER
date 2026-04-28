/**
 * Prospect helpers — timezone detection, schema defaults, CSV parsing utilities.
 */

import { uid } from './utils';
import { DEFAULT_PROSPECT_STAGES } from './constants';

// ----- US state -> timezone mapping (covers continental US + AK/HI) -----
const STATE_TZ = {
  AL:'CT', AK:'AKT', AZ:'MT', AR:'CT', CA:'PT', CO:'MT', CT:'ET', DC:'ET',
  DE:'ET', FL:'ET', GA:'ET', HI:'HT', ID:'MT', IL:'CT', IN:'ET', IA:'CT',
  KS:'CT', KY:'ET', LA:'CT', ME:'ET', MD:'ET', MA:'ET', MI:'ET', MN:'CT',
  MS:'CT', MO:'CT', MT:'MT', NE:'CT', NV:'PT', NH:'ET', NJ:'ET', NM:'MT',
  NY:'ET', NC:'ET', ND:'CT', OH:'ET', OK:'CT', OR:'PT', PA:'ET', RI:'ET',
  SC:'ET', SD:'CT', TN:'CT', TX:'CT', UT:'MT', VT:'ET', VA:'ET', WA:'PT',
  WV:'ET', WI:'CT', WY:'MT',
};

export function timezoneFromState(stateAbbr) {
  if (!stateAbbr) return '';
  const k = String(stateAbbr).trim().toUpperCase().slice(0, 2);
  return STATE_TZ[k] || '';
}

// ----- Default custom-field set (empty by default; user adds via settings) -----
export function defaultProspectSettings() {
  return {
    stages: DEFAULT_PROSPECT_STAGES.map(s => ({ ...s })),
    customFields: [], // [{ id, label, type: 'text'|'number'|'date'|'dropdown', options?:[] }]
  };
}

// ----- Empty prospect record -----
export function newProspect(overrides = {}) {
  return {
    id: uid(),
    name: '',
    phone: '',
    email: '',
    state: '',
    zip: '',
    timezone: '',
    indvOrFamily: 'Indv', // 'Indv' | 'Family'
    dobs: '',             // free text — single DOB or comma-separated for family
    income: '',           // string-money (free text)
    quoteSize: '',        // string-money
    policyType: '',
    meds: '',
    situation: '',
    startDate: '',
    source: '',
    referrer: '',         // only meaningful when source = Referral
    crm: 'None',
    stage: 'NEW',
    appointmentTime: '',  // ISO datetime string
    nextSteps: '',
    lastContact: '',      // YYYY-MM-DD
    custom: {},           // map of customFieldId -> value
    createdAt: new Date().toISOString(),
    archivedAt: null,
    convertedLeadId: null,
    ...overrides,
  };
}

// ----- Header normalization for CSV/Excel imports -----
//
// Maps free-form header strings to canonical prospect field keys. Patterns
// are checked in order; first match wins, so list more-specific patterns
// before more-general ones. Stage detection runs BEFORE last-contact (so
// "STAGE_OVERRIDE" doesn't get caught by a generic "last" pattern).
const HEADER_MAP = [
  // Stage / pipeline indicators — checked first so "STAGE_OVERRIDE" wins
  { keys: [/stage[\s_-]*override/i, /^stage$/i, /^pipeline$/i, /^status$/i], field: 'stage' },

  // Appointment time — anchor on "appoint" anywhere; tolerate parens/notes
  { keys: [/appoint/i, /^appt/i, /^when$/i, /sched/i], field: 'appointmentTime' },

  // Last contact / follow-up — also catches plain \"date\" and \"f/u\"
  { keys: [/last.*contact/i, /last.*follow/i, /follow.?up/i, /^f\/u$/i, /^date$/i], field: 'lastContact' },

  // Identity
  { keys: [/^name$/i, /full\s*name/i, /^client$/i, /^prospect$/i, /first.*last/i], field: 'name' },
  { keys: [/phone/i, /^cell$/i, /mobile/i, /^tel/i, /\bnumber\b/i], field: 'phone' },
  { keys: [/^e-?mail$/i, /email/i], field: 'email' },

  // Location
  { keys: [/^state$/i, /^st$/i], field: 'state' },
  { keys: [/^zip/i, /postal/i], field: 'zip' },
  { keys: [/time\s*zone/i, /^tz$/i, /\(our\s*time\)/i], field: 'timezone' },

  // Person details
  { keys: [/^indv/i, /individual/i, /family/i, /\bfam\b/i], field: 'indvOrFamily' },
  { keys: [/^dob/i, /birth/i, /date\s*of\s*birth/i], field: 'dobs' },
  { keys: [/^income$/i, /annual.*income/i, /\bsalary\b/i], field: 'income' },

  // Coverage / sale info
  { keys: [/quote.*size/i, /^quote$/i, /premium/i, /^budget$/i], field: 'quoteSize' },
  { keys: [/policy.*type/i, /^plan$/i, /coverage/i, /^product$/i], field: 'policyType' },
  { keys: [/meds/i, /medication/i, /^rx$/i, /condition/i, /health/i], field: 'meds' },
  { keys: [/start.*date/i, /effective.*date/i, /^eff\b/i], field: 'startDate' },

  // Source / origin
  { keys: [/lead.*from/i, /^source$/i, /referral.*source/i, /\borigin/i, /lead.*src/i], field: 'source' },
  { keys: [/^referr/i, /referred.*by/i, /referrer/i], field: 'referrer' },
  { keys: [/^crm$/i, /textdrip|ringy|vanilla/i], field: 'crm' },

  // Notes / actions
  { keys: [/situation/i, /^notes?$/i, /^memo$/i, /comments?/i, /summary/i], field: 'situation' },
  { keys: [/next.*step/i, /^action$/i, /to.?do/i], field: 'nextSteps' },
];

export function detectFieldFromHeader(header) {
  const s = String(header || '').trim();
  if (!s) return null;
  for (const { keys, field } of HEADER_MAP) {
    if (keys.some(re => re.test(s))) return field;
  }
  return null;
}

// ----- Stage label fuzzy-match for import wizard -----
export function detectStageId(stageLabel, configuredStages) {
  if (!stageLabel) return 'NEW';
  const s = String(stageLabel).toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // Try exact label match first
  for (const stg of configuredStages) {
    if (String(stg.label).toLowerCase() === s) return stg.id;
    if (String(stg.id).toLowerCase() === s)    return stg.id;
  }
  // Common aliases
  const aliases = [
    [/(sold|won|paid|closed)/, 'SOLD'],
    [/(lost|dead|not\s*interested|no\s*interest)/, 'LOST'],
    [/ghost/, 'GHOSTED'],
    [/(missed|no\s*show)/, 'MISSED_APPT'],
    [/pending/, 'PENDING_DECISION'],
    [/follow.*up|f\/u|shopping/, 'FOLLOWUP_LATER'],
    [/confirm/, 'WEBBY_CONFIRMED'],
    [/web/, 'WEBBY_SET'],
    [/(appointment|appt)\s*set/, 'APPOINTMENT_SET'],
    [/^new$|fresh|just\s*added/, 'NEW'],
  ];
  for (const [re, id] of aliases) {
    if (re.test(s) && configuredStages.some(stg => stg.id === id)) return id;
  }
  return configuredStages[0]?.id || 'NEW';
}

// ----- Source fuzzy-match -----
export function detectSource(sourceLabel) {
  if (!sourceLabel) return '';
  const s = String(sourceLabel).toLowerCase();
  if (/referr/.test(s))                return 'Referral';
  if (/google/.test(s))                return 'Google Ads';
  if (/facebook|meta\b/.test(s))       return 'Facebook Ads';
  if (/web/.test(s))                   return 'Web Lead';
  if (/aged/.test(s))                  return 'Aged Lead';
  if (/major\s*league/.test(s))        return 'Major League';
  if (/bizz|business/.test(s))         return 'Bizz Lead';
  if (/cold/.test(s))                  return 'Cold Call';
  return 'Other';
}

export function detectIndvOrFamily(s) {
  const t = String(s || '').toLowerCase();
  if (/family|fam/.test(t))      return 'Family';
  if (/indv|individual|single/.test(t)) return 'Indv';
  return 'Indv';
}

// ----- Dedup key: phone (digits only) is the strongest unique signal -----
export function prospectDedupKey(p) {
  const phone = String(p.phone || '').replace(/\D/g, '');
  if (phone) return `phone:${phone}`;
  const email = String(p.email || '').toLowerCase().trim();
  if (email) return `email:${email}`;
  return `name:${String(p.name || '').toLowerCase().trim()}`;
}
