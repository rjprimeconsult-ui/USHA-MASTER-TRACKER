/**
 * webforms.mjs — Pure, dependency-free website-lead extraction/upsert helpers.
 *
 * This file intentionally has NO imports from the project so it can be run
 * directly with `node --test` for the test suite without a Next.js build
 * context. (src/lib/prospects.js uses extensionless internal imports that only
 * resolve under webpack — importing it here would fail with ERR_MODULE_NOT_FOUND.)
 * Precedent: src/lib/ringy.mjs is deliberately self-contained the same way.
 *
 * A website contact-form POST arrives as an arbitrary JSON / urlencoded body.
 * These helpers turn it into a PRIM prospect, deterministically when the keys
 * are recognizable, and expose a lean AI prompt for the route's fallback path.
 */

/** Max characters for the human-readable raw-payload block appended to notes. */
export const WEBFORM_MAX_RAW_CHARS = 4000;

// ---------- Body parsing ----------

/**
 * normalizeBody(contentType, rawText) — parse a webhook body into a plain
 * object. Pure: no streams. Multipart is handled in the route, not here.
 *
 *   application/json                    -> JSON.parse (returns null on throw)
 *   application/x-www-form-urlencoded   -> URLSearchParams -> object
 *
 * Returns null when the body can't be parsed into an object.
 *
 * @param {string} contentType  Raw Content-Type header (may include charset).
 * @param {string} rawText      The request body text.
 * @returns {object|null}
 */
export function normalizeBody(contentType, rawText) {
  const ct = String(contentType || '').toLowerCase();
  const text = String(rawText == null ? '' : rawText);

  if (ct.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    try {
      const out = {};
      const params = new URLSearchParams(text);
      for (const [k, v] of params) out[k] = v;
      return out;
    } catch {
      return null;
    }
  }

  return null;
}

// ---------- Flattening ----------

/**
 * flattenRecord(obj) — flatten ONE level of nesting into dotted keys, join
 * arrays with ", ", String()/trim every scalar, and drop empty values.
 * Non-objects (null, arrays, primitives) yield {}.
 *
 *   { form: { phone: 305 } }  -> { 'form.phone': '305' }
 *   { tags: ['a','b'] }       -> { tags: 'a, b' }
 *
 * @param {*} obj
 * @returns {Record<string,string>}
 */
export function flattenRecord(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;

  const put = (key, val) => {
    const s = scalarToString(val);
    if (s !== '') out[key] = s;
  };

  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      // One level of nesting -> dotted keys.
      for (const [ck, cv] of Object.entries(val)) put(`${key}.${ck}`, cv);
    } else {
      put(key, val);
    }
  }
  return out;
}

/** Stringify a scalar/array value the way flattenRecord wants it. */
function scalarToString(val) {
  if (val == null) return '';
  if (Array.isArray(val)) {
    return val
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter((s) => s !== '')
      .join(', ');
  }
  if (typeof val === 'object') return ''; // nested objects handled by caller
  return String(val).trim();
}

// ---------- Field extraction ----------

/**
 * Normalize a key for synonym matching: lowercase and strip [] - _ . and
 * spaces, so `your-name`, `form.phone`, `email[]`, `First Name` all collapse.
 */
function normKey(key) {
  // Collapse to bare alphanumerics so 'your-name', 'Email Address',
  // 'Pre-existing conditions?', 'ZIP Code' all match their synonym sets.
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Metadata keys that must NEVER map to a prospect field (still shown in the raw
// block). Checked FIRST so e.g. `source: 'website'` never becomes a field.
const IGNORE_KEYS = new Set([
  'source', 'submittedat', 'timestamp', 'formid', 'formname',
  'page', 'pageurl', 'url', 'referrer', 'useragent', 'ip', 'token',
]);

const NAME_KEYS  = new Set(['name', 'fullname', 'yourname', 'contactname']);
const EMAIL_KEYS = new Set(['email', 'emailaddress', 'youremail']); // 'e-mail' also normalizes to 'email'
const PHONE_KEYS = new Set(['phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell']);
const STATE_KEYS = new Set(['state', 'region', 'province']);
const ZIP_KEYS   = new Set(['zip', 'zipcode', 'postal', 'postalcode']);
const MSG_KEYS   = new Set(['message', 'comments', 'notes', 'details', 'inquiry', 'question', 'situation']);

const FIRST_KEYS = new Set(['firstname', 'fname']);
const LAST_KEYS  = new Set(['lastname', 'lname']);

// Additional structured fields (added 2026-07-04). Keys are normKey-collapsed,
// covering both clean keys (date_of_birth) and full form labels (Date of Birth).
const DOB_KEYS     = new Set(['dob', 'dateofbirth', 'birthdate', 'birthday']);
const INCOME_KEYS  = new Set(['income', 'householdincome', 'yearlyincome', 'annualincome',
  'yearlyhouseholdincome', 'annualhouseholdincome', 'approximateyearlyhouseholdincome',
  'approximateincome', 'householdincomerange', 'incomerange']);
const INDVFAM_KEYS = new Set(['whowillyouneedtoinsure', 'whowillyouinsure', 'whoneedsinsurance',
  'whoneedscoverage', 'whotoinsure', 'whoareyouinsuring', 'coveragefor', 'insurancefor',
  'whatbestdescribesyou', 'whobestdescribesyou', 'bestdescribesyou', 'describesyou', 'coveragetype']);
const HEALTH_KEYS  = new Set(['preexistingconditions', 'preexistingcondition', 'preexisting',
  'healthconditions', 'healthconcerns', 'healthstatus']);
const CITY_KEYS    = new Set(['city', 'town']);

// ---------- Field normalizers ----------
// Group an integer with thousands separators without depending on Intl/ICU.
function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Exactly the 50 codes in US_STATES (src/lib/commission.js) — the State <select>
// options. Deliberately NO 'DC': it isn't a dropdown option, so a DC lead must
// normalize to '' (unsupported) rather than a value the dropdown can't display.
const STATE_CODES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL',
  'IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']);
const STATE_NAME_TO_CODE = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
  connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID',
  illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA', maine:'ME',
  maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN', mississippi:'MS', missouri:'MO',
  montana:'MT', nebraska:'NE', nevada:'NV', newhampshire:'NH', newjersey:'NJ', newmexico:'NM',
  newyork:'NY', northcarolina:'NC', northdakota:'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
  pennsylvania:'PA', rhodeisland:'RI', southcarolina:'SC', southdakota:'SD', tennessee:'TN',
  texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA', westvirginia:'WV',
  wisconsin:'WI', wyoming:'WY',
};

/**
 * normalizeState(value) — turn a form's state value into the 2-letter code the
 * PRIM State dropdown expects (US_STATES). 'Florida'→'FL', 'fl'→'FL', 'FL'→'FL'.
 * Returns '' for anything unrecognized so garbage never lands in the dropdown.
 */
export function normalizeState(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const up = raw.toUpperCase();
  if (STATE_CODES.has(up)) return up;
  const name = raw.toLowerCase().replace(/[^a-z]/g, '');
  return STATE_NAME_TO_CODE[name] || '';
}

/**
 * normalizeIncomeBand(value) — a range band like "$35,000–$59,999" → its midpoint
 * as a grouped number ("47,500") for the income box. "Below $X" → midpoint of
 * [0,X]; "$X+" / plain number → that number. Returns { income, band }.
 */
export function normalizeIncomeBand(value) {
  const band = String(value || '').trim();
  if (!band) return { income: '', band: '' };
  const nums = (band.match(/\d[\d,]*/g) || [])
    .map(n => parseInt(n.replace(/,/g, ''), 10))
    .filter(Number.isFinite);
  if (nums.length === 0) return { income: '', band };
  let mid;
  if (nums.length >= 2) mid = Math.round((nums[0] + nums[1]) / 2);
  else if (/below|under|less than|up to/i.test(band)) mid = Math.round(nums[0] / 2);
  else mid = nums[0]; // "$100,000+", "over $X", or a plain single number
  return { income: groupThousands(mid), band };
}

/**
 * normalizeIndvFamily(value) — a coverage answer → 'Indv' | 'Family' for the
 * dropdown. Business/Self-Employed insure themselves → 'Indv'. '' if unrecognized
 * (caller keeps the default). Family is checked first so "family business" → Family.
 */
export function normalizeIndvFamily(value) {
  const v = String(value || '').toLowerCase();
  if (!v) return '';
  if (/family|spouse|kids|children|household|couple|dependents|married/.test(v)) return 'Family';
  if (/individual|just ?me|myself|single|self|business|owner/.test(v)) return 'Indv';
  return '';
}

/**
 * normalizeHealthConcern(value) — a yes/no/unsure flag → PRIM's APPROVED general
 * impression ("has health concerns" per NoPhiBanner + Terms + the Health Notes
 * placeholder). Strict matching: only clean yes/no/unsure map — any free-text
 * (e.g. "diabetes") returns '' so a specific condition is NEVER stored (PHI-safe).
 */
export function normalizeHealthConcern(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return '';
  // The `$` anchor is DELIBERATE and load-bearing: only a bare affirmation maps.
  // "Yes, type 2 diabetes" → '' (no flag) rather than leaking the condition.
  // Do NOT loosen this to a substring match — it would reintroduce PHI leakage.
  if (/^(y|yes|true|1)$/.test(v)) return 'Has health concerns';
  if (/not ?sure|unsure|maybe|don'?t know|idk/.test(v)) return 'May have health concerns (unsure)';
  return ''; // 'No', 'None', or any specifics → store nothing
}

/**
 * extractWebformFields(flatOrRaw) — deterministically map recognizable webform
 * keys to prospect fields using synonym sets (metadata ignore-list first).
 *
 * Accepts either a raw object or an already-flattened record; it flattens
 * internally so callers can pass the raw payload directly.
 *
 * @param {object} raw
 * @returns {{ fields: object, confident: boolean }}
 *   fields: { name?, email?, phone?, state?, zip?, situation? } (only present keys)
 *   confident: true when name AND (phone OR email) were found.
 */
export function extractWebformFields(raw) {
  const flat = flattenRecord(raw);
  const fields = {};
  let first = '';
  let last = '';

  for (const [origKey, value] of Object.entries(flat)) {
    const k = normKey(origKey);
    if (IGNORE_KEYS.has(k)) continue; // metadata first — never maps

    if (FIRST_KEYS.has(k)) { if (!first) first = value; continue; }
    if (LAST_KEYS.has(k))  { if (!last) last = value; continue; }
    if (NAME_KEYS.has(k))  { if (!fields.name) fields.name = value; continue; }
    if (EMAIL_KEYS.has(k)) { if (!fields.email) fields.email = value; continue; }
    if (PHONE_KEYS.has(k)) { if (!fields.phone) fields.phone = value; continue; }
    if (STATE_KEYS.has(k)) { if (!fields.state) fields.state = value; continue; }
    if (ZIP_KEYS.has(k))   { if (!fields.zip) fields.zip = value; continue; }
    if (MSG_KEYS.has(k))   { if (!fields.situation) fields.situation = value; continue; }
    if (DOB_KEYS.has(k))     { if (!fields.dob) fields.dob = value; continue; }
    if (INCOME_KEYS.has(k))  { if (!fields.income) fields.income = value; continue; }
    if (INDVFAM_KEYS.has(k)) { if (!fields.indvfam) fields.indvfam = value; continue; }
    if (HEALTH_KEYS.has(k))  { if (!fields.health) fields.health = value; continue; }
    if (CITY_KEYS.has(k))    { if (!fields.city) fields.city = value; continue; }
    // Unknown key: left for the raw block (not mapped).
  }

  // Compose name from first/last when no explicit name key was present.
  if (!fields.name) {
    const composed = [first, last].filter(Boolean).join(' ').trim();
    if (composed) fields.name = composed;
  }

  const confident = !!fields.name && !!(fields.phone || fields.email);
  return { fields, confident };
}

// ---------- Raw block ----------

/**
 * buildRawBlock(flat) — render the whole flattened payload as a human-readable
 * "key: value" block, prefixed with a header, capped at WEBFORM_MAX_RAW_CHARS
 * (truncated with an ellipsis). This preserves EVERY field for the agent even
 * when only some keys were mapped.
 *
 * @param {Record<string,string>} flat
 * @returns {string}
 */
export function buildRawBlock(flat) {
  const record = flat && typeof flat === 'object' ? flat : {};
  const lines = ['Website form submission:'];
  for (const [k, v] of Object.entries(record)) {
    lines.push(`${k}: ${v}`);
  }
  let block = lines.join('\n');
  if (block.length > WEBFORM_MAX_RAW_CHARS) {
    block = block.slice(0, WEBFORM_MAX_RAW_CHARS - 1) + '…';
  }
  return block;
}

// ---------- Prospect construction ----------

/**
 * buildWebformProspect(extraction, raw, nowIso) — build a PRIM prospect record.
 *
 * MIRRORS newProspect() (src/lib/prospects.js:75-111) — if that factory gains
 * fields, add them here. Built inline because prospects.js is unimportable
 * under `node --test` (extensionless internal imports).
 *
 * The full raw payload is appended to `situation` (after any extracted message
 * plus a blank line) so nothing the visitor submitted is lost.
 *
 * @param {{fields: object, confident: boolean}} extraction
 * @param {object} raw     The original (or flattened) payload — for the raw block.
 * @param {string} nowIso  ISO timestamp (injectable for tests).
 * @returns {object}       Prospect + { needsReview } flag.
 */
export function buildWebformProspect(extraction, raw, nowIso) {
  const { fields = {}, confident = false } = extraction || {};
  const ts = nowIso || new Date().toISOString();
  const flat = flattenRecord(raw);
  const rawBlock = buildRawBlock(flat);

  const extractedMsg = String(fields.situation || '').trim();
  const situation = extractedMsg ? `${extractedMsg}\n\n${rawBlock}` : rawBlock;

  const name = String(fields.name || '').trim() || 'Web Lead — needs review';

  return {
    // Core identity
    id:            _uid(),
    name,
    phone:         String(fields.phone || '').trim(),
    email:         String(fields.email || '').trim(),
    state:         normalizeState(fields.state),            // 'Florida' → 'FL' (dropdown-ready)
    zip:           String(fields.zip || '').trim(),
    timezone:      '',
    indvOrFamily:  normalizeIndvFamily(fields.indvfam) || 'Indv',
    dobs:          String(fields.dob || '').trim(),
    income:        normalizeIncomeBand(fields.income).income, // band → midpoint number; band stays in raw block
    quoteSize:     '',
    quotes:        [],
    policyType:    '',
    meds:          normalizeHealthConcern(fields.health),    // yes/no/unsure → approved general impression only
    situation,
    startDate:     '',
    source:        'Web Lead',
    referrer:      '',
    leadVendor:    '',
    crm:           'None',
    stage:         'PENDING_DECISION',
    appointmentTime: '',
    nextSteps:     '',
    lastContact:   '',
    custom:        {},
    createdAt:     ts,
    archivedAt:    null,
    convertedLeadId: null,
    // Follow-up system
    touchLog:      [],
    stageEnteredAt: ts,
    cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
    // Web-lead review flag — true when extraction wasn't confident.
    needsReview:   !confident,
  };
}

// ---------- Dedup ----------

/**
 * webformDedupKey(p) — mirrors prospectDedupKey (prospects.js:222): phone
 * digits -> email lowercase -> name lowercase.
 *
 * ONE deliberate divergence: when the phone normalizes to 11 digits starting
 * with `1`, strip the leading `1`. Websites commonly send +1 E.164 numbers,
 * while existing prospects store the 10-digit form — so "+13055551234" must
 * dedup against a stored "3055551234". prospectDedupKey does NOT do this; the
 * webform path does, on purpose.
 */
function webformDedupKey(p) {
  let phone = String((p && p.phone) || '').replace(/\D/g, '');
  if (phone.length === 11 && phone.startsWith('1')) phone = phone.slice(1);
  if (phone) return `phone:${phone}`;
  const email = String((p && p.email) || '').toLowerCase().trim();
  if (email) return `email:${email}`;
  return `name:${String((p && p.name) || '').toLowerCase().trim()}`;
}

// ---------- Upsert ----------

/**
 * upsertWebformProspect(list, incoming, nowIso) — dedup an incoming webform
 * prospect against existing NON-archived prospects.
 *
 * Immutable — returns a new array + new objects; never mutates input.
 *
 *   Match (first non-archived with same webformDedupKey):
 *     - fill-empty (EXISTING wins on every field);
 *     - append a touch DIRECTLY (never logTouch — that advances the cadence and
 *       clears reminders, which we must not do on a passive form re-submission):
 *       { id, at: nowIso, channel: 'Other', outcome: 'Other',
 *         note: 'Submitted your website form again' }.
 *     -> { list, created: false, prospectId }
 *   No match:
 *     -> { list: [...list, incoming], created: true, prospectId }
 *
 * @param {object[]} list      Existing prospects.
 * @param {object}   incoming  Result of buildWebformProspect().
 * @param {string}   nowIso    ISO timestamp (injectable for tests).
 * @param {string}   [incomingMessage]  The fresh message text the visitor typed
 *   on THIS submission (the extracted message, without the raw block). On a
 *   re-submission, fill-empty keeps the existing `situation`, so the new
 *   message would otherwise be lost — we carry it into the touch note instead
 *   so the agent never misses a hot re-inquiry ("call me ASAP…").
 * @returns {{ list: object[], created: boolean, prospectId: string }}
 */
export function upsertWebformProspect(list, incoming, nowIso, incomingMessage = '') {
  const arr = Array.isArray(list) ? list : [];
  const ts = nowIso || new Date().toISOString();
  const key = webformDedupKey(incoming);

  let matchIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (!p || p.archivedAt) continue; // archived prospects are not dedup matches
    if (webformDedupKey(p) === key) { matchIdx = i; break; }
  }

  // ---- No match: append ----
  if (matchIdx === -1) {
    return { list: [...arr, incoming], created: true, prospectId: incoming.id };
  }

  // ---- Match: fill-empty (existing wins) + append a passive touch ----
  const existing = arr[matchIdx];
  // Carry the fresh message into the touch note so a hot re-inquiry isn't lost
  // to fill-empty. Only when it's non-empty and not already the stored situation.
  const freshMsg = String(incomingMessage || '').trim();
  const existingSit = String(existing.situation || '').trim();
  const note = freshMsg && !existingSit.includes(freshMsg)
    ? `Submitted your website form again — "${freshMsg.slice(0, 240)}"`
    : 'Submitted your website form again';
  const touch = {
    id: _uid(),
    at: ts,
    channel: 'Other',
    outcome: 'Other',
    note,
  };
  const updated = {
    ...existing,
    name:      existing.name      || incoming.name,
    phone:     existing.phone     || incoming.phone,
    email:     existing.email     || incoming.email,
    state:     existing.state     || incoming.state,
    zip:       existing.zip       || incoming.zip,
    situation: existing.situation || incoming.situation,
    touchLog:  [...(Array.isArray(existing.touchLog) ? existing.touchLog : []), touch],
  };

  const newList = arr.map((p, i) => (i === matchIdx ? updated : p));
  return { list: newList, created: false, prospectId: existing.id };
}

// ---------- AI fallback prompt ----------

/**
 * buildWebformAiPrompt(flat) — a lean single-record prompt for the route's AI
 * fallback when deterministic extraction isn't confident. Embeds the payload as
 * key: value lines and demands the fixed JSON shape.
 *
 * @param {object} flat  The (flattened) payload.
 * @returns {string}
 */
export function buildWebformAiPrompt(flat) {
  const record = flattenRecord(flat);
  const payloadLines = Object.entries(record)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  return [
    'Extract ONE lead (a single lead) from this website form submission.',
    'Return ONLY JSON with this exact shape:',
    '{"name":"","phone":"","email":"","state":"","zip":"","situation":""}',
    'Use empty strings for unknowns. Never invent values.',
    '',
    'Website form submission:',
    payloadLines,
  ].join('\n');
}

// ---------- Internal helpers ----------

/** Inline uid() to keep this file dependency-free (matches ringy.mjs). */
function _uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
