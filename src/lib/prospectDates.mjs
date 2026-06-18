/**
 * Date-field hardening for prospect imports.
 *
 * Dependency-free on purpose: AI/CRM imports occasionally drop non-date free
 * text into date fields. A VanillaSoft screenshot whose notes mentioned "RINGY"
 * had the dialer name land in `startDate`, so the detail card rendered
 * "Desired Start: RINGY". These helpers reject such garbage at import time and
 * guard the display.
 */

// A value is a usable date only if it contains a digit AND the JS engine can
// parse it. That keeps "2026-07-01", ISO datetimes, and short forms like
// "3/1/01" while rejecting pure labels ("RINGY", "ASAP", "VanillaSoft").
export function isDateLike(v) {
  const s = String(v ?? '').trim();
  if (!s) return false;
  if (!/\d/.test(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

// Fields that must hold a date (or be empty). Anything else is blanked.
export const PROSPECT_DATE_FIELDS = ['startDate', 'lastContact', 'appointmentTime'];

// Sanitize a freshly-imported prospect: blank any date field whose value isn't
// actually a date, so garbage from AI extraction never reaches storage.
export function sanitizeImportedProspect(p) {
  if (!p || typeof p !== 'object') return p;
  const out = { ...p };
  for (const f of PROSPECT_DATE_FIELDS) {
    if (out[f] && !isDateLike(out[f])) out[f] = '';
  }
  return out;
}
