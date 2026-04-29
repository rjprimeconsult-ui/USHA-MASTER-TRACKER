/**
 * Shared lead-deduplication helpers.
 *
 * Match priority (strongest first):
 *   1. policyNumber — primary signal. Each USHA policy ID is unique per
 *      policy. A customer with 3 policies = 3 separate leads (one per
 *      policyId) — that's the natural unit. Comma-joined storage like
 *      "52Y2502220, 52Y250222F" is split on import — every individual
 *      policyId indexes the same lead.
 *   2. (normalized name + last-7-digits-of-phone) — fallback when no
 *      policyNumber on either side.
 *   3. (normalized name + state + closedDate) — very weak fallback for
 *      truly bare records.
 */

const SPLIT_POLICY_RE = /[,;|\s]+/;

// Strip whitespace, lowercase, drop punctuation. Keeps non-Latin alpha.
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Last 7 digits of a phone — robust to country codes, formatting, OCR noise.
function phoneTail(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-7) : '';
}

// Every policyId on a lead, split out from comma-joined / pipe-joined storage.
export function policyIdsOf(lead) {
  const raw = String(lead?.policyNumber || '').trim();
  if (!raw) return [];
  return raw
    .split(SPLIT_POLICY_RE)
    .map(p => p.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Build an index from a list of existing leads → fast `findExisting()` lookups.
 * Returns an object with helper methods rather than a plain map so the caller
 * doesn't need to know about the multi-key structure.
 */
export function buildLeadIndex(existingLeads) {
  const byPolicy = new Map();      // policyId (uppercase) → lead
  const byNamePhone = new Map();   // normName + ":" + phoneTail7 → lead
  const byNameState = new Map();   // normName + ":" + state + ":" + closedDate → lead

  for (const lead of existingLeads || []) {
    if (!lead) continue;
    for (const pid of policyIdsOf(lead)) {
      if (!byPolicy.has(pid)) byPolicy.set(pid, lead);
    }
    const n = normName(lead.name);
    const t = phoneTail(lead.phone);
    if (n && t) {
      const k = `${n}:${t}`;
      if (!byNamePhone.has(k)) byNamePhone.set(k, lead);
    }
    if (n && lead.state) {
      const k = `${n}:${String(lead.state).toUpperCase()}:${lead.closedDate || ''}`;
      if (!byNameState.has(k)) byNameState.set(k, lead);
    }
  }

  return {
    /**
     * Find an existing lead matching the candidate. Returns null if none.
     * Tries every available signal in priority order.
     */
    findExisting(candidate) {
      for (const pid of policyIdsOf(candidate)) {
        const hit = byPolicy.get(pid);
        if (hit) return hit;
      }
      const n = normName(candidate?.name);
      const t = phoneTail(candidate?.phone);
      if (n && t) {
        const hit = byNamePhone.get(`${n}:${t}`);
        if (hit) return hit;
      }
      if (n && candidate?.state) {
        const k = `${n}:${String(candidate.state).toUpperCase()}:${candidate.closedDate || ''}`;
        const hit = byNameState.get(k);
        if (hit) return hit;
      }
      return null;
    },

    /**
     * "Absorb" a newly-created lead into the index so subsequent candidates in
     * the same import batch dedup against it too. Important when the same
     * file lists the same customer twice.
     */
    absorb(lead) {
      for (const pid of policyIdsOf(lead)) byPolicy.set(pid, lead);
      const n = normName(lead.name);
      const t = phoneTail(lead.phone);
      if (n && t) byNamePhone.set(`${n}:${t}`, lead);
      if (n && lead.state) byNameState.set(`${n}:${String(lead.state).toUpperCase()}:${lead.closedDate || ''}`, lead);
    },
  };
}

/**
 * Split a candidate batch into fresh + duplicates against `existingLeads`.
 * Also dedupes within the batch itself (so the same Excel listing the same
 * customer twice only gets one lead).
 */
export function dedupLeads(candidateLeads, existingLeads) {
  const idx = buildLeadIndex(existingLeads);
  const fresh = [];
  const duplicates = [];
  for (const cand of candidateLeads || []) {
    const existing = idx.findExisting(cand);
    if (existing) {
      duplicates.push({ candidate: cand, existing });
    } else {
      fresh.push(cand);
      idx.absorb(cand);
    }
  }
  return { fresh, duplicates };
}

/**
 * Find duplicate groups within an existing leads list.
 *
 * Returns an array of groups where each group is 2+ leads that match each
 * other by policyId / name+phone / name+state+closedDate. The first lead in
 * each group is the "canonical" (oldest, most-complete) — we order by:
 *   1. has policyNumber (1 if yes, 0 if no)
 *   2. has phone (1/0)
 *   3. has email (1/0)
 *   4. dateAdded (older first)
 *
 * The caller can then offer "keep canonical, delete rest" UX, or let the
 * admin pick which one to keep manually.
 */
export function findDuplicateGroups(leads) {
  const idx = buildLeadIndex([]);
  const leadIdToGroup = new Map(); // leadId -> mutable group array
  for (const lead of leads || []) {
    if (!lead?.id) continue;
    const match = idx.findExisting(lead);
    if (match && leadIdToGroup.has(match.id)) {
      const group = leadIdToGroup.get(match.id);
      group.push(lead);
      leadIdToGroup.set(lead.id, group);
      idx.absorb(lead); // chain matching: catch transitively-related leads
    } else {
      idx.absorb(lead);
      const newGroup = [lead];
      leadIdToGroup.set(lead.id, newGroup);
    }
  }

  // Collect unique groups of size 2+
  const seen = new Set();
  const out = [];
  for (const g of leadIdToGroup.values()) {
    if (g.length >= 2 && !seen.has(g)) {
      seen.add(g);
      // Sort by completeness (canonical = first)
      const ranked = [...g].sort((a, b) => {
        const score = (l) => (l.policyNumber ? 1000 : 0) + (l.phone ? 100 : 0) + (l.email ? 10 : 0);
        const sa = score(a), sb = score(b);
        if (sa !== sb) return sb - sa;
        return String(a.dateAdded || '').localeCompare(String(b.dateAdded || ''));
      });
      out.push(ranked);
    }
  }
  return out;
}
