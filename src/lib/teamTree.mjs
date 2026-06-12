/**
 * teamTree.mjs — pure org-tree helpers for the Team feature. No I/O.
 *
 * The org is a strict tree of upline→downline edges (team_members rows).
 * Only edges with status 'active' grant visibility. These helpers are the
 * single source of truth for "who can see whom":
 *
 *   - getDownlineIds(rootId, edges)  → every ACTIVE descendant of rootId
 *   - isDescendant(leader, target)   → the authorization predicate
 *   - uplineChain(userId, edges)     → ancestors walking up (for cycle guard
 *                                      + the agent transparency panel)
 *   - wouldCreateCycle(inviter, invitee) → invite-time loop guard
 *   - directReports(rootId, edges)   → active direct downline only
 *
 * EVERY walk is cycle-safe by construction (visited set) AND depth-capped,
 * so even malformed data (a cycle that slipped past the DB constraints) can
 * never infinite-loop. This module is the most correctness-critical piece
 * of the Team feature — its tests cover cycles, depth caps, sideways
 * isolation, and non-active edges.
 *
 * Edge shape: { uplineId, downlineId, status } — extra fields ignored.
 */

export const MAX_TEAM_DEPTH = 12;

// Build adjacency map of ACTIVE edges only: uplineId -> [downlineId, ...]
function activeAdjacency(edges) {
  const adj = new Map();
  for (const e of edges || []) {
    if (!e || e.status !== 'active' || !e.uplineId || !e.downlineId) continue;
    if (e.uplineId === e.downlineId) continue; // self-edge: ignore defensively
    if (!adj.has(e.uplineId)) adj.set(e.uplineId, []);
    adj.get(e.uplineId).push(e.downlineId);
  }
  return adj;
}

/**
 * All ACTIVE descendants of rootId (NOT including rootId itself).
 * BFS, visited-set, depth-capped — terminates on any input.
 *
 * @returns {Set<string>} descendant user ids
 */
export function getDownlineIds(rootId, edges, { maxDepth = MAX_TEAM_DEPTH } = {}) {
  const adj = activeAdjacency(edges);
  const visited = new Set();
  let frontier = [rootId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next = [];
    for (const upline of frontier) {
      for (const down of adj.get(upline) || []) {
        if (down === rootId || visited.has(down)) continue;
        visited.add(down);
        next.push(down);
      }
    }
    frontier = next;
  }
  return visited;
}

/** The authorization predicate: may `leaderId` view `targetId`? */
export function isDescendant(leaderId, targetId, edges, opts) {
  if (!leaderId || !targetId || leaderId === targetId) return false;
  return getDownlineIds(leaderId, edges, opts).has(targetId);
}

/** Active direct reports of rootId (one level down only). */
export function directReports(rootId, edges) {
  return (edges || [])
    .filter(e => e && e.status === 'active' && e.uplineId === rootId && e.downlineId && e.downlineId !== rootId)
    .map(e => e.downlineId);
}

/**
 * Ancestors of userId, walking UP active edges (direct upline first).
 * Cycle-safe + depth-capped. Tolerates malformed multi-upline data by
 * following the first active upline edge found per node.
 *
 * @returns {string[]} ancestor ids, nearest first
 */
export function uplineChain(userId, edges, { maxDepth = MAX_TEAM_DEPTH } = {}) {
  const parent = new Map(); // downlineId -> uplineId
  for (const e of edges || []) {
    if (!e || e.status !== 'active' || !e.uplineId || !e.downlineId) continue;
    if (e.uplineId === e.downlineId) continue;
    if (!parent.has(e.downlineId)) parent.set(e.downlineId, e.uplineId);
  }
  const chain = [];
  const seen = new Set([userId]);
  let cur = parent.get(userId);
  while (cur && !seen.has(cur) && chain.length < maxDepth) {
    chain.push(cur);
    seen.add(cur);
    cur = parent.get(cur);
  }
  return chain;
}

/**
 * Invite-time loop guard: linking invitee under inviter would create a cycle
 * iff the invitee IS the inviter, or the invitee is somewhere in the
 * inviter's upline chain (your boss can't also be your report).
 */
export function wouldCreateCycle(inviterId, inviteeId, edges, opts) {
  if (!inviterId || !inviteeId) return false;
  if (inviterId === inviteeId) return true;
  return uplineChain(inviterId, edges, opts).includes(inviteeId);
}
