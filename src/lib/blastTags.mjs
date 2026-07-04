// Distinct campaign/tag options learned from the agent's blast history.
// First-seen order preserved (caller passes rows already sorted newest-first
// if that ordering is desired). Case-insensitive dedupe, non-empty only.
export function blastTagOptions(blasts) {
  const seen = new Set(), out = [];
  for (const b of Array.isArray(blasts) ? blasts : []) {
    const t = String(b?.campaignOrTag || '').trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}
