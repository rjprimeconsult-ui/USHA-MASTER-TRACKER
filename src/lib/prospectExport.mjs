/**
 * prospectExport.mjs — Prospects → CSV export logic.
 *
 * SELF-CONTAINED (no imports): this module is unit-tested under `node --test`,
 * where sibling app modules (prospects.js etc.) are unimportable due to
 * extensionless imports. Keep it dependency-free (same rule as webforms.mjs).
 *
 * Spec: docs/superpowers/specs/2026-07-22-prospects-csv-export-design.md
 * Columns are demographics/contact ONLY (D4) — never meds, situation, notes.
 */

// Sentinel for the "(No source)" filter option — cannot collide with a real
// source string (repo precedent: LeadsView.jsx product filter '__none__').
export const NO_SOURCE = '__none__';

// The 9 columns, exact order and headers (D4).
export const EXPORT_HEADERS = [
  'First Name', 'Last Name', 'Full Name', 'Phone', 'Email',
  'Date of Birth', 'State', 'ZIP', 'Income',
];

// Trim, then split on the FIRST space of the trimmed value (D5).
export function splitName(name) {
  const t = String(name ?? '').trim();
  if (!t) return { first: '', last: '' };
  const i = t.indexOf(' ');
  if (i === -1) return { first: t, last: '' };
  return { first: t.slice(0, i), last: t.slice(i + 1).trim() };
}

// One CSV cell: always quoted, embedded quotes doubled, and a tab prefixed
// INSIDE the quotes when the RAW value starts with = + - or @ so Excel/Sheets
// treat it as text, never a formula (OWASP CSV-injection neutralization).
// Prospects arrive from internet-facing webforms — this is a security guard,
// not cosmetics. The raw value is inspected (no trimming first).
export function csvCell(value) {
  let s = (value === null || value === undefined) ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = '\t' + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// Build the full file: UTF-8 BOM + header row + one row per prospect, CRLF
// row delimiter (RFC 4180), no trailing newline.
export function buildProspectsCsv(prospects) {
  const rows = [EXPORT_HEADERS.map(csvCell).join(',')];
  for (const p of (prospects || [])) {
    const { first, last } = splitName(p?.name);
    rows.push([
      first, last, p?.name, p?.phone, p?.email,
      p?.dobs, p?.state, p?.zip, p?.income,
    ].map(csvCell).join(','));
  }
  return '\uFEFF' + rows.join('\r\n');
}

// Picker row filter. source: '' = all | NO_SOURCE = trimmed-empty | exact
// (trim-both-sides). stage: '' = all | exact stage id. query: case-insensitive
// substring on name/email; phone compared digits-only ONLY when the query
// contains at least one digit (a digitless query must never match every row
// via the empty-digits substring). All conditions AND-combine. Archived
// prospects never match.
export function prospectMatchesFilters(p, { source = '', stage = '', query = '' } = {}) {
  if (!p || p.archivedAt) return false;
  const pSource = String(p.source ?? '').trim();
  if (source === NO_SOURCE) { if (pSource !== '') return false; }
  else if (source) { if (pSource !== String(source).trim()) return false; }
  if (stage && p.stage !== stage) return false;
  const q = String(query ?? '').trim().toLowerCase();
  if (q) {
    const name = String(p.name ?? '').toLowerCase();
    const email = String(p.email ?? '').toLowerCase();
    let hit = name.includes(q) || email.includes(q);
    if (!hit) {
      const qDigits = q.replace(/\D/g, '');
      if (qDigits) {
        const pDigits = String(p.phone ?? '').replace(/\D/g, '');
        hit = pDigits.includes(qDigits);
      }
    }
    if (!hit) return false;
  }
  return true;
}

// Distinct source options for the dropdown: trimmed, deduped, sorted
// alphabetically; appends NO_SOURCE when any active prospect has a
// trimmed-empty source. (Archived prospects are ignored entirely.)
export function deriveSourceOptions(prospects) {
  const set = new Set();
  let hasEmpty = false;
  for (const p of (prospects || [])) {
    if (!p || p.archivedAt) continue;
    const s = String(p.source ?? '').trim();
    if (s) set.add(s); else hasEmpty = true;
  }
  const out = [...set].sort((a, b) => a.localeCompare(b));
  if (hasEmpty) out.push(NO_SOURCE);
  return out;
}

// Download filename: prospects-YYYY-MM-DD.csv (local date).
export function exportFilename(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `prospects-${y}-${m}-${day}.csv`;
}
