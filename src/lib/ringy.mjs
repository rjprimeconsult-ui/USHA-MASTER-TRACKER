/**
 * ringy.mjs — Pure, dependency-free Ringy normalisation helpers.
 *
 * This file intentionally has NO imports from the project so it can be
 * run directly with `node --test` for the test suite without needing a
 * Next.js build context.
 */

// ---------- Phone normalisation ----------

/**
 * phoneKey(raw) — strips everything except digits, then drops a single
 * leading US country code "1" from an 11-digit number.
 *
 * Identical logic to textdrip.mjs phoneKey — shared canonical key.
 *
 * Examples:
 *   "19416851718"   → "9416851718"
 *   "+19416851718"  → "9416851718"
 *   "(941) 685-1718" → "9416851718"
 *   "9416851718"    → "9416851718"
 *   "1234"          → "1234"
 */
export function phoneKey(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

// ---------- Date helpers ----------

/**
 * ageFromDob(dob, nowIso) — compute integer age from a birthdate string.
 *
 * Accepts YYYY-MM-DD and other parseable forms (e.g. YYYY/MM/DD, MM/DD/YYYY).
 * Returns null if dob is absent, unparseable, or age is < 0 or > 120.
 * nowIso is injectable for tests.
 *
 * @param {string|null} dob
 * @param {string}      [nowIso] ISO date string for "today" (for tests).
 * @returns {number|null}
 */
export function ageFromDob(dob, nowIso) {
  if (!dob || typeof dob !== 'string') return null;
  const cleaned = dob.trim().replace(/\//g, '-');
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;
  const birthYear = d.getUTCFullYear();
  if (birthYear < 1900 || birthYear > 2100) return null;

  const now = nowIso ? new Date(nowIso) : new Date();
  let age = now.getUTCFullYear() - birthYear;
  // Subtract 1 if birthday hasn't occurred yet this year
  const birthMMDD = d.getUTCMonth() * 100 + d.getUTCDate();
  const nowMMDD   = now.getUTCMonth() * 100 + now.getUTCDate();
  if (nowMMDD < birthMMDD) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

// ---------- Payload normalisation ----------

/**
 * normalizeRingyPayload(body) — convert a raw Ringy webhook POST body into a
 * canonical shape used throughout the Ringy integration.
 *
 * Tolerate missing keys — all fields default to ''.
 *
 * @param {object} body  Raw JSON body from Ringy webhook.
 * @returns {{
 *   ringyLeadId: string,
 *   name: string,
 *   phone: string,
 *   phoneKey: string,
 *   email: string,
 *   address: string,
 *   city: string,
 *   state: string,
 *   zip: string,
 *   birthday: string,
 *   age: number|null,
 *   notes: string,
 *   status: string,
 *   source: string,
 *   disposition: string,
 * }}
 */
export function normalizeRingyPayload(body) {
  if (!body || typeof body !== 'object') {
    return {
      ringyLeadId: '', name: '', phone: '', phoneKey: '', email: '',
      address: '', city: '', state: '', zip: '', birthday: '',
      age: null, notes: '', status: '', source: '', disposition: '',
    };
  }

  // Build name: prefer body.name, else firstName + lastName
  let name = String(body.name || '').trim();
  if (!name) {
    const parts = [body.firstName, body.lastName].filter(Boolean).map(s => String(s).trim());
    name = parts.join(' ').trim();
  }

  // State: uppercase 2-char
  const rawState = String(body.state || '').trim().toUpperCase();
  const state = rawState.slice(0, 2);

  const birthday = String(body.birthday || '').trim();
  const age      = ageFromDob(birthday);

  return {
    ringyLeadId:  String(body.leadId || ''),
    name,
    phone:       String(body.phone || '').trim(),
    phoneKey:    phoneKey(body.phone),
    email:       String(body.email || '').trim(),
    address:     String(body.address || '').trim(),
    city:        String(body.city || '').trim(),
    state,
    zip:         String(body.zip || '').trim(),
    birthday,
    age,
    notes:       String(body.notes || '').trim(),
    status:      String(body.status || '').trim(),
    source:      String(body.source || '').trim(),
    disposition: String(body.disposition || '').trim(),
  };
}

// ---------- Disposition → Stage mapping ----------

/**
 * mapDispositionToStage(disposition, mapping, defaultStage) — case-insensitive
 * match of `disposition` against `mapping[].disposition`; return its `stage`.
 * Falls back to `defaultStage` when no match.
 *
 * @param {string}   disposition   The Ringy disposition string.
 * @param {Array<{disposition: string, stage: string}>} mapping
 * @param {string}   defaultStage  Fallback stage ID.
 * @returns {string}
 */
export function mapDispositionToStage(disposition, mapping, defaultStage) {
  if (!disposition || !Array.isArray(mapping)) return defaultStage || '';
  const needle = String(disposition).trim().toLowerCase();
  for (const entry of mapping) {
    if (!entry || typeof entry.disposition !== 'string') continue;
    if (entry.disposition.trim().toLowerCase() === needle) {
      return entry.stage || defaultStage || '';
    }
  }
  return defaultStage || '';
}

// ---------- Blast / repurpose tag detection ----------

/**
 * Disposition patterns (case-insensitive regexes) that mark a Ringy tag as a
 * "blast" / repurpose action rather than a real prospect disposition. Covers
 * the known "REPUROSED - AGED - POST O/E DRIP" tag (and the correctly-spelled
 * "REPURPOSED") out of the box, so native blast capture works with ZERO config.
 *
 * These are deliberately specific so they never collide with a normal USHA
 * disposition (a legit disposition matching one of these would be aggregated
 * into the Blasts log instead of creating a prospect).
 */
export const DEFAULT_BLAST_PATTERNS = ['repuro?sed', 'repurposed', 'post\\s*o/?e\\s*drip'];

/**
 * checkIsBlastDisposition(disposition, customPatterns) — true when the Ringy
 * disposition matches any custom pattern OR any default blast pattern. Each
 * pattern is tried as a case-insensitive regex, falling back to a substring
 * test if it isn't valid regex. Empty disposition → false.
 *
 * @param {string} disposition
 * @param {string[]} [customPatterns]  Extra agent-configured patterns.
 * @returns {boolean}
 */
export function checkIsBlastDisposition(disposition, customPatterns) {
  const d = String(disposition || '').trim();
  if (!d) return false;
  const patterns = [
    ...(Array.isArray(customPatterns) ? customPatterns : []),
    ...DEFAULT_BLAST_PATTERNS,
  ];
  const lc = d.toLowerCase();
  return patterns.some((p) => {
    const s = String(p || '').trim();
    if (!s) return false;
    try { return new RegExp(s, 'i').test(d); }
    catch { return lc.includes(s.toLowerCase()); }
  });
}

// ---------- Upsert ----------

/**
 * upsertRingyLead(prospects, normalized, mapping, defaultStage, now)
 *
 * Immutable — returns new array + new prospect objects; never mutates input.
 *
 * Match strategy:
 *   1. Same phoneKey (both non-empty)
 *   2. Same ringyLeadId (both non-empty)
 *
 * On create:  build a new prospect mirroring newProspect() shape.
 * On update:  fill-empty ONLY for email/state/zip/age/situation/address;
 *             ALWAYS set stage = mapped disposition (authoritative);
 *             stamp ringyLeadId + source:'Ringy' if missing.
 *
 * @param {object[]} prospects     Existing prospect array.
 * @param {object}   normalized    Result of normalizeRingyPayload().
 * @param {Array}    mapping       Disposition→stage mapping.
 * @param {string}   defaultStage  Fallback stage.
 * @param {string}   now           ISO timestamp (injectable for tests).
 * @returns {{ prospects: object[], action: 'create'|'update' }}
 */
export function upsertRingyLead(prospects, normalized, mapping, defaultStage, now) {
  const list = Array.isArray(prospects) ? prospects : [];
  const ts   = now || new Date().toISOString();

  const nk    = normalized.phoneKey;
  const nrId  = normalized.ringyLeadId;
  const stage = mapDispositionToStage(normalized.disposition, mapping, defaultStage);

  // ---- Find match ----
  let matchIdx = -1;
  for (let i = 0; i < list.length; i++) {
    const p  = list[i];
    const pk = phoneKey(p.phone || '');
    const samePhone   = nk && pk && nk === pk;
    const sameRingyId = nrId && p.ringyLeadId && String(p.ringyLeadId) === String(nrId);
    if (samePhone || sameRingyId) {
      matchIdx = i;
      break;
    }
  }

  // ---- Create ----
  if (matchIdx === -1) {
    const p = {
      // Core identity
      id:            _uid(),
      name:          normalized.name,
      phone:         normalized.phone,
      email:         normalized.email,
      state:         normalized.state,
      zip:           normalized.zip,
      timezone:      '',
      indvOrFamily:  'Indv',
      dobs:          normalized.birthday || '',
      income:        '',
      quoteSize:     '',
      policyType:    '',
      meds:          '',
      situation:     normalized.notes || '',
      startDate:     '',
      source:        'Ringy',
      referrer:      '',
      leadVendor:    '',
      crm:           'Ringy',
      stage,
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
      // Age (integer as string, e.g. "42"), or empty to match newProspect shape
      age:           normalized.age != null ? String(normalized.age) : '',
      // Ringy-specific
      ringyLeadId:   normalized.ringyLeadId,
      address:       normalized.address,
    };
    return { prospects: [...list, p], action: 'create' };
  }

  // ---- Update (fill-empty; always set stage) ----
  const existing = list[matchIdx];
  const updated = {
    ...existing,
    // Always authoritative
    stage,
    ringyLeadId: existing.ringyLeadId || normalized.ringyLeadId || existing.ringyLeadId,
    source:      existing.source || 'Ringy',
    // Fill-empty only
    email:       existing.email     || normalized.email,
    state:       existing.state     || normalized.state,
    zip:         existing.zip       || normalized.zip,
    age:         (existing.age != null && existing.age !== '') ? existing.age : (normalized.age != null ? String(normalized.age) : existing.age),
    situation:   existing.situation || normalized.notes || '',
    address:     existing.address   || normalized.address,
  };

  const newList = list.map((p, i) => (i === matchIdx ? updated : p));
  return { prospects: newList, action: 'update' };
}

// ---------- Internal helpers ----------

/** Inline uid() to keep this file dependency-free. */
function _uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
