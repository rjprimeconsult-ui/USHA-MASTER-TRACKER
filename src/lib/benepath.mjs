/**
 * benepath.mjs — Pure, (almost) dependency-free Benepath lead normalisation.
 *
 * Benepath is a paid health-insurance lead vendor. Unlike Ringy (which posts
 * dispositions for leads already being worked), Benepath posts BRAND-NEW leads
 * the moment they come in — so there is no disposition→stage mapping; every
 * Benepath lead becomes a fresh prospect at the configured default stage.
 *
 * Benepath's exact POST field names are not publicly documented and can be
 * customised per-integration, so the normaliser matches a broad set of
 * case-insensitive field aliases. The webhook also records the raw field
 * names it received so the mapping can be locked from the first real lead.
 *
 * Only import is the dependency-free isDateLike guard (so `node --test` works).
 */

import { isDateLike } from './prospectDates.mjs';

// ---------- Phone normalisation (identical to ringy.mjs / textdrip.mjs) ----------

export function phoneKey(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

// ---------- Date helpers ----------

export function ageFromDob(dob, nowIso) {
  if (!dob || typeof dob !== 'string') return null;
  const cleaned = dob.trim().replace(/\//g, '-');
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;
  const birthYear = d.getUTCFullYear();
  if (birthYear < 1900 || birthYear > 2100) return null;
  const now = nowIso ? new Date(nowIso) : new Date();
  let age = now.getUTCFullYear() - birthYear;
  const birthMMDD = d.getUTCMonth() * 100 + d.getUTCDate();
  const nowMMDD = now.getUTCMonth() * 100 + now.getUTCDate();
  if (nowMMDD < birthMMDD) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

// ---------- Field aliases ----------
// Lower-cased candidate keys per canonical field. First non-empty wins.
const ALIASES = {
  leadId:       ['leadid', 'lead_id', 'benepath_lead_id', 'benepathleadid', 'uid', 'unique_id', 'uniqueid', 'id', 'lead'],
  firstName:    ['firstname', 'first_name', 'fname', 'first'],
  lastName:     ['lastname', 'last_name', 'lname', 'last'],
  name:         ['name', 'full_name', 'fullname', 'consumer_name', 'contact_name', 'lead_name'],
  phone:        ['phone', 'phone_number', 'phonenumber', 'primary_phone', 'primaryphone', 'cell', 'cellphone', 'cell_phone', 'mobile', 'mobile_phone', 'home_phone', 'homephone', 'telephone', 'phone1', 'best_phone'],
  email:        ['email', 'email_address', 'emailaddress', 'e-mail', 'emailaddr'],
  address:      ['address', 'address1', 'address_1', 'street', 'street_address', 'streetaddress', 'addr'],
  city:         ['city', 'town'],
  state:        ['state', 'st', 'state_code', 'statecode', 'province', 'region'],
  zip:          ['zip', 'zip_code', 'zipcode', 'postal_code', 'postalcode', 'postal', 'postcode'],
  birthday:     ['dob', 'date_of_birth', 'dateofbirth', 'birthday', 'birth_date', 'birthdate'],
  age:          ['age'],
  income:       ['income', 'household_income', 'householdincome', 'annual_income', 'annualincome', 'hh_income', 'estimated_income'],
  householdSize:['household_size', 'householdsize', 'family_size', 'familysize', 'household', 'dependents', 'num_dependents', 'number_of_dependents', 'numberofdependents', 'number_of_children', 'numberofchildren', 'num_children', 'people', 'members', 'household_count'],
  coverageType: ['coverage_type', 'coveragetype', 'insurance_type', 'insurancetype', 'coverage', 'product', 'product_type', 'plan_type', 'line_of_business', 'lob', 'vertical'],
  currentlyInsured: ['currently_insured', 'currentlyinsured', 'current_insurance', 'currentinsurance', 'insured', 'has_insurance', 'existing_coverage', 'currently_covered'],
  startDate:    ['coverage_start_date', 'coveragestartdate', 'requested_start_date', 'requestedstartdate', 'start_date', 'startdate', 'effective_date', 'effectivedate', 'desired_start', 'desired_effective_date', 'desired_coverage_date'],
  gender:       ['gender', 'sex'],
  tobacco:      ['tobacco', 'tobacco_user', 'smoker', 'is_smoker'],
  maritalStatus:['marital_status', 'maritalstatus', 'marital'],
  occupation:   ['occupation', 'job', 'employment', 'job_title'],
  lifeEvent:    ['qualifying_life_event', 'qualifyinglifeevent', 'life_event', 'lifeevent', 'qle'],
  expectant:    ['expectant', 'pregnant', 'expecting', 'is_expectant'],
  notes:        ['notes', 'note', 'comments', 'comment', 'message', 'remarks', 'additional_info', 'additionalinfo', 'description', 'situation'],
  source:       ['source', 'lead_source', 'leadsource', 'campaign', 'campaign_name'],
};

/** Squash a key to lowercase alphanumerics so "Cell Phone", "cell_phone",
 *  "Cell-Phone" and "cellphone" all collide to one canonical form. */
function squash(k) {
  return String(k == null ? '' : k).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Recursively collect leaf [key, value] pairs from a payload. Flattens nested
 * objects (depth-limited) so a posted shape like {contact:{first_name:'Jo'}}
 * still maps. Arrays are walked for nested objects; scalar leaves keep their
 * own key. Guards against runaway depth.
 */
function collectLeaves(obj, out, depth) {
  if (obj == null || depth > 5) return out;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      if (v && typeof v === 'object') collectLeaves(v, out, depth + 1);
    }
    return out;
  }
  if (typeof obj !== 'object') return out;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') collectLeaves(v, out, depth + 1);
    else out.push([k, v]);
  }
  return out;
}

/** Build a squashed-key → value index from a raw body object (nested-aware). */
function buildIndex(body) {
  const idx = {};
  if (!body || typeof body !== 'object') return idx;
  for (const [k, v] of collectLeaves(body, [], 0)) {
    if (k == null) continue;
    const sk = squash(k);
    if (!sk) continue;
    // Don't clobber an earlier non-empty value with a later empty one.
    if (idx[sk] === undefined || (String(idx[sk] ?? '').trim() === '' && v != null && String(v).trim() !== '')) {
      idx[sk] = v;
    }
  }
  return idx;
}

/** Distinct leaf field NAMES in a payload (original case) — for the settings
 *  "fields received" panel. PII-free: names only, no values. */
export function payloadFieldNames(body) {
  if (!body || typeof body !== 'object') return [];
  const names = [];
  const seen = new Set();
  for (const [k] of collectLeaves(body, [], 0)) {
    const key = String(k == null ? '' : k);
    if (key && !seen.has(key)) { seen.add(key); names.push(key); }
  }
  return names;
}

/** First non-empty aliased value, trimmed to a string. */
function pick(idx, field) {
  const keys = ALIASES[field] || [];
  for (const k of keys) {
    const v = idx[squash(k)];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ---------- Situation composer ----------
// Fold qualifying context Benepath sends (coverage type, currently-insured,
// household, gender, tobacco) plus any free-text notes into one situation
// string the agent can read at a glance. Capped at 500 chars.
function buildSituation(parts, notes) {
  const bits = [];
  if (parts.coverageType)     bits.push(`Coverage: ${parts.coverageType}`);
  if (parts.currentlyInsured) bits.push(`Currently insured: ${parts.currentlyInsured}`);
  if (parts.householdSize)    bits.push(`Household: ${parts.householdSize}`);
  if (parts.maritalStatus)    bits.push(`Marital: ${parts.maritalStatus}`);
  if (parts.gender)           bits.push(`Gender: ${parts.gender}`);
  if (parts.tobacco)          bits.push(`Tobacco: ${parts.tobacco}`);
  if (parts.expectant)        bits.push(`Expectant: ${parts.expectant}`);
  if (parts.occupation)       bits.push(`Occupation: ${parts.occupation}`);
  if (parts.lifeEvent)        bits.push(`Qualifying life event: ${parts.lifeEvent}`);
  const meta = bits.join(' · ');
  const combined = [meta, String(notes || '').trim()].filter(Boolean).join('\n').trim();
  return combined.slice(0, 500);
}

// ---------- Payload normalisation ----------

/**
 * normalizeBenepathPayload(body) — convert a raw Benepath POST body (JSON or
 * already-parsed form fields) into PRIM's canonical shape. Tolerant of missing
 * keys and varied field names.
 */
export function normalizeBenepathPayload(body) {
  const idx = buildIndex(body);

  let name = pick(idx, 'name');
  if (!name) {
    const parts = [pick(idx, 'firstName'), pick(idx, 'lastName')].filter(Boolean);
    name = parts.join(' ').trim();
  }

  const phone = pick(idx, 'phone');
  const state = pick(idx, 'state').toUpperCase().slice(0, 2);
  const birthday = pick(idx, 'birthday');

  let age = ageFromDob(birthday);
  if (age == null) {
    const rawAge = parseInt(pick(idx, 'age'), 10);
    if (Number.isFinite(rawAge) && rawAge > 0 && rawAge <= 120) age = rawAge;
  }

  const householdSize = pick(idx, 'householdSize');
  const coverageType = pick(idx, 'coverageType');
  const currentlyInsured = pick(idx, 'currentlyInsured');
  const gender = pick(idx, 'gender');
  const tobacco = pick(idx, 'tobacco');
  const maritalStatus = pick(idx, 'maritalStatus');
  const occupation = pick(idx, 'occupation');
  const lifeEvent = pick(idx, 'lifeEvent');
  const expectant = pick(idx, 'expectant');
  const notes = pick(idx, 'notes');

  const startRaw = pick(idx, 'startDate');
  const startDate = isDateLike(startRaw) ? startRaw : '';

  // Family if a household size > 1 is stated.
  const hh = parseInt(householdSize, 10);
  const indvOrFamily = Number.isFinite(hh) && hh > 1 ? 'Family' : 'Indv';

  return {
    benepathLeadId: pick(idx, 'leadId'),
    name,
    phone,
    phoneKey: phoneKey(phone),
    email: pick(idx, 'email'),
    address: pick(idx, 'address'),
    city: pick(idx, 'city'),
    state,
    zip: pick(idx, 'zip'),
    birthday,
    age,
    income: pick(idx, 'income'),
    indvOrFamily,
    startDate,
    situation: buildSituation({ coverageType, currentlyInsured, householdSize, maritalStatus, gender, tobacco, expectant, occupation, lifeEvent }, notes),
  };
}

// ---------- Upsert ----------

/**
 * upsertBenepathLead(prospects, normalized, defaultStage, now)
 *
 * Immutable. Match by phoneKey OR benepathLeadId OR email.
 *  - Create: a fresh prospect at `defaultStage`, source 'Web Lead',
 *    leadVendor 'Benepath'.
 *  - Update (duplicate lead for an existing prospect): fill-empty only.
 *    NEVER overrides the stage the agent has already set (Benepath leads are
 *    new arrivals, not authoritative status updates like Ringy dispositions).
 */
export function upsertBenepathLead(prospects, normalized, defaultStage, now) {
  const list = Array.isArray(prospects) ? prospects : [];
  const ts = now || new Date().toISOString();
  const stage = defaultStage || 'PENDING_DECISION';

  const nk = normalized.phoneKey;
  const nId = normalized.benepathLeadId;
  const nEmail = String(normalized.email || '').toLowerCase();

  let matchIdx = -1;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const pk = phoneKey(p.phone || '');
    const samePhone = nk && pk && nk === pk;
    const sameId = nId && p.benepathLeadId && String(p.benepathLeadId) === String(nId);
    const sameEmail = nEmail && p.email && String(p.email).toLowerCase() === nEmail;
    if (samePhone || sameId || sameEmail) { matchIdx = i; break; }
  }

  if (matchIdx === -1) {
    const p = {
      id: _uid(),
      name: normalized.name,
      phone: normalized.phone,
      email: normalized.email,
      state: normalized.state,
      zip: normalized.zip,
      timezone: '',
      indvOrFamily: normalized.indvOrFamily || 'Indv',
      dobs: normalized.birthday || '',
      income: normalized.income || '',
      quoteSize: '',
      quotes: [],
      policyType: '',
      meds: '',
      situation: normalized.situation || '',
      startDate: normalized.startDate || '',
      source: 'Benepath',
      referrer: '',
      leadVendor: 'Benepath',
      crm: 'Benepath',
      stage,
      appointmentTime: '',
      nextSteps: '',
      lastContact: '',
      custom: {},
      createdAt: ts,
      archivedAt: null,
      convertedLeadId: null,
      touchLog: [],
      stageEnteredAt: ts,
      cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
      age: normalized.age != null ? String(normalized.age) : '',
      benepathLeadId: normalized.benepathLeadId,
      address: normalized.address,
    };
    return { prospects: [...list, p], action: 'create' };
  }

  // Duplicate lead → fill-empty only; preserve agent's stage and edits.
  const existing = list[matchIdx];
  const updated = {
    ...existing,
    benepathLeadId: existing.benepathLeadId || normalized.benepathLeadId,
    leadVendor: existing.leadVendor || 'Benepath',
    source: existing.source || 'Benepath',
    // Fill CRM only if the prospect doesn't already belong to a real CRM.
    crm: (existing.crm && existing.crm !== 'None') ? existing.crm : 'Benepath',
    email: existing.email || normalized.email,
    state: existing.state || normalized.state,
    zip: existing.zip || normalized.zip,
    income: existing.income || normalized.income,
    dobs: existing.dobs || normalized.birthday || '',
    startDate: (existing.startDate && String(existing.startDate).trim()) ? existing.startDate : (normalized.startDate || ''),
    age: (existing.age != null && existing.age !== '') ? existing.age : (normalized.age != null ? String(normalized.age) : existing.age),
    situation: existing.situation || normalized.situation || '',
    address: existing.address || normalized.address,
  };
  const newList = list.map((p, i) => (i === matchIdx ? updated : p));
  return { prospects: newList, action: 'update' };
}

// ---------- Internal ----------

function _uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
