// Split a typed lead-range string into { start, end } WITHOUT reformatting the
// dates. Only a SPACE-SURROUNDED separator splits, so a hyphenated single date
// like "03-26-2026" stays whole.
const SEP = /\s+(?:→|–|-|to)\s+/i;
export function splitLeadRange(input) {
  const s = String(input || '').trim();
  if (!s) return { start: '', end: '' };
  const parts = s.split(SEP);
  if (parts.length >= 2) return { start: parts[0].trim(), end: parts.slice(1).join(' ').trim() };
  return { start: s, end: '' };
}
export function joinLeadRange(start, end) {
  const a = String(start || '').trim(), b = String(end || '').trim();
  return a && b ? `${a} → ${b}` : (a || b || '');
}
