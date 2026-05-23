/**
 * Duplicate Lead Resolver — pure logic.
 *
 * Detects same-name lead groups, classifies each pair by date proximity
 * and policy-number overlap, and merges two leads into one. No I/O, no
 * React, no storage — testable with node --test.
 *
 * See the spec: docs/superpowers/specs/2026-05-23-duplicate-resolver-design.md
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD..." -> Date | null. Robust against null / empty / garbage.
function parseISODate(s) {
  if (!s) return null;
  const head = String(s).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  const d = new Date(head + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

// Lead -> Set of 9-char policy bases (first 9 chars of each policy number
// in the comma-separated string). Used by classifyPair to spot AppIDs
// that obviously belong to the same submission family.
function policyBases(lead) {
  const raw = String(lead?.policyNumber || '');
  return raw
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.slice(0, 9));
}

/**
 * Group leads by a normalized name key. Skips leads with no name.
 * Returns only groups of size >= 2.
 *
 *   nameKey — a function (string) -> string that normalizes names for
 *             matching. Pass `nameKey` from lib/statement.js at the
 *             call site; kept as a parameter so this module stays
 *             import-free and testable.
 */
export function findDuplicateGroups(leads, nameKey) {
  const byName = new Map();
  for (const lead of leads || []) {
    if (!lead || !lead.name) continue;
    const key = nameKey(lead.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(lead);
  }
  const groups = [];
  for (const [key, leadsInGroup] of byName) {
    if (leadsInGroup.length >= 2) {
      groups.push({ nameKey: key, leads: leadsInGroup });
    }
  }
  return groups;
}

/**
 * Flatten a group into every unique pair. A group of N leads yields
 * N*(N-1)/2 pairs.
 */
export function enumeratePairs(group) {
  const leads = group?.leads || [];
  const pairs = [];
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      pairs.push({ a: leads[i], b: leads[j] });
    }
  }
  return pairs;
}

/**
 * Has this pair already been reviewed? Returns true when BOTH leads carry
 * a dedupReviewedAt timestamp — meaning the agent already made a choice
 * about them and we shouldn't re-prompt.
 */
export function shouldSkipPair(a, b) {
  return Boolean(a?.dedupReviewedAt && b?.dedupReviewedAt);
}

/**
 * Classify a pair:
 *   'duplicate' — closed dates within 7 days, or policy-number bases
 *                 overlap. Likely an import artifact; recommend merge.
 *   'repeated'  — 60+ days apart with no policy overlap. Likely the
 *                 client came back after a lapse/cancel; tag as repeat.
 *   'ambiguous' — anything in between, or missing-date cases that
 *                 can't be decided automatically.
 */
export function classifyPair(a, b) {
  const dateA = parseISODate(a?.closedDate || a?.dateAdded);
  const dateB = parseISODate(b?.closedDate || b?.dateAdded);
  const basesA = new Set(policyBases(a));
  const basesB = policyBases(b);
  const overlap = basesB.some(base => basesA.has(base));
  if (dateA && dateB) {
    const days = Math.abs(dateA - dateB) / DAY_MS;
    if (days <= 7 || overlap) return 'duplicate';
    if (days >= 60) return 'repeated';
    return 'ambiguous';
  }
  if (overlap) return 'duplicate';
  return 'ambiguous';
}

/**
 * Merge two leads into one. The winner keeps its id and any non-empty
 * fields; the loser's policy numbers + products get folded in, and any
 * scalar fields the winner is missing are filled from the loser. The
 * loser should be deleted by the caller after the merge.
 *
 * Stamps dedupReviewedAt so the merged record doesn't reappear in the
 * resolver.
 */
export function mergeLeads(winner, loser) {
  if (!winner) return loser;
  if (!loser)  return winner;

  // Policy numbers — both fields may already be comma-separated.
  const allPolicies = [winner.policyNumber, loser.policyNumber]
    .filter(Boolean)
    .flatMap(p => String(p).split(',').map(s => s.trim()))
    .filter(Boolean);
  const dedupedPolicies = [...new Set(allPolicies)].join(', ');

  // Products — combine by id, winner first.
  const winnerProds = Array.isArray(winner.products) ? winner.products : [];
  const loserProds  = Array.isArray(loser.products)  ? loser.products  : [];
  const seen = new Set(winnerProds.map(p => p?.id).filter(Boolean));
  const products = [...winnerProds];
  for (const p of loserProds) {
    if (p?.id && !seen.has(p.id)) {
      products.push(p);
      seen.add(p.id);
    }
  }

  // Winner-wins-when-set helper for scalar fields.
  const isEmpty = (v) => v === undefined || v === null || v === '';
  const pick = (key) => (isEmpty(winner[key]) ? loser[key] : winner[key]);

  return {
    ...loser,
    ...winner,
    id: winner.id,
    name:               pick('name'),
    phone:              pick('phone'),
    email:              pick('email'),
    state:              pick('state'),
    age:                pick('age'),
    mainProduct:        pick('mainProduct'),
    mainProductPremium: pick('mainProductPremium'),
    leadCost:           pick('leadCost'),
    dealValue:          pick('dealValue'),
    closedDate:         pick('closedDate'),
    dateAdded:          pick('dateAdded'),
    crm:                pick('crm'),
    source:             pick('source'),
    leadCategory:       pick('leadCategory'),
    campaign:           pick('campaign'),
    owner:              pick('owner'),
    notes:              pick('notes'),
    associationPlan:    pick('associationPlan'),
    previousLeadId:     pick('previousLeadId'),
    policyNumber: dedupedPolicies || undefined,
    products,
    dedupReviewedAt: new Date().toISOString(),
  };
}
