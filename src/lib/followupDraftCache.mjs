/**
 * followupDraftCache.mjs — cache keys, hashing, rotation, and prune logic for
 * personalized follow-up drafts (the `followup_drafts_v1` map).
 *
 * SELF-CONTAINED (no imports): unit-tested under `node --test`, where sibling
 * app modules are unimportable (extensionless imports). Keep it dependency-free.
 *
 * Cache entries are keyed by prospect id and shaped per spec §7.2:
 *   { status, text, edited, stepKey, sourceHash, at, attempts, previous, rejected }
 * with `status` one of 'ok' | 'insufficient' | 'failed' (§10). This module
 * decides WHEN a draft regenerates (`shouldRegenerate`, the normative §7.4
 * matrix) — never HOW; the request itself lives in the component and route.
 *
 * The §7.3 hash joins its parts with U+0000 — produced via
 * String.fromCharCode(0), never typed as a literal byte — so ["a","b c"] and
 * ["a b","c"] cannot collide, and keeps fixed slots for `situation` and
 * `missedApptTime` so an absent field can never shift positions.
 *
 * Spec: docs/superpowers/specs/2026-07-27-personalized-followup-drafts-phase1-design.md (§6.1, §7, §10)
 */

// U+0000 join separator (§7.3) — built in code, never a literal control byte.
const SEP = String.fromCharCode(0);

// Statuses whose entries carry no usable draft text (§7.4 rule 0, §10).
const UNUSABLE_STATUSES = ['failed', 'insufficient'];

const ENCODER = new TextEncoder();

// FNV-1a 32-bit over the UTF-8 bytes of `str`, rendered as 8 padded hex chars.
function fnv1a32(str) {
  const bytes = ENCODER.encode(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * makeStepKey(stage, stepIndex, stepsLength) -> `${stage}:${clampedIndex}`
 *
 * The clamp mirrors what the card actually renders (§7.2):
 * Math.min(stepIndex || 0, stepsLength - 1), floored at 0 so a missing index
 * or an empty/malformed playbook can never yield a negative segment.
 */
export function makeStepKey(stage, stepIndex, stepsLength) {
  const len = Number.isFinite(stepsLength) ? stepsLength : 0;
  const idx = Math.max(0, Math.min(stepIndex || 0, len - 1));
  return `${stage}:${idx}`;
}

/**
 * sourceHash(stepKey, source) -> 8-hex-char FNV-1a 32-bit digest (§7.3).
 *
 * Join order is fixed:
 *   stepKey, firstName, situation, missedApptTime,
 *   ...agentNotes as `at|outcome|note`, textdripSummary
 *
 * `situation` and `missedApptTime` always occupy their slot — an empty string
 * when absent, never a dropped element — otherwise "situation set, no
 * appointment" and "situation cleared, appointment set" would collide and a
 * stale draft would survive a change the agent can see.
 *
 * The rule: everything buildDraftSource sends is hashed. A collision merely
 * leaves a stale draft in place; the agent can edit, and Redo forces
 * regeneration.
 */
export function sourceHash(stepKey, source) {
  const s = source || {};
  const notes = Array.isArray(s.agentNotes) ? s.agentNotes : [];
  const parts = [
    String(stepKey ?? ''),
    String(s.firstName ?? ''),
    String(s.situation ?? ''),
    String(s.missedApptTime ?? ''),
    ...notes.map((n) => `${n?.at ?? ''}|${n?.outcome ?? ''}|${n?.note ?? ''}`),
    String(s.textdripSummary ?? ''),
  ];
  return fnv1a32(parts.join(SEP));
}

/**
 * shouldRegenerate(cached, stepKey, sourceHash)
 *   -> { generate, rotatePrevious, resetCounters }   (all booleans)
 *
 * The NORMATIVE §7.4 matrix, in precedence order:
 *   0. no cache entry            -> generate; `previous` starts [] — nothing
 *                                   is ever pushed, so it can't contain null
 *   1. insufficient + same hash  -> never regenerate (D9 — a declined
 *                                   prospect is not re-billed on every open)
 *   2. failed + same hash        -> regenerate iff attempts < 2; counters
 *                                   PERSIST (resetting here would make the
 *                                   cap unreachable)
 *   3. stepKey changed           -> regenerate even when edited; rotate
 *                                   `previous`; reset attempts/rejected
 *   4. hash changed, step same   -> regenerate only when NOT edited (an
 *                                   agent's wording is never overwritten in
 *                                   place); no rotation; reset counters
 *   5. otherwise                 -> serve the cache
 *
 * Rule 3 is strictly narrower than rule 4 — stepKey is the first hash
 * segment, so a stepKey change always changes the hash; the ordering is what
 * distinguishes them. `rotatePrevious: true` means "call rotatePrevious(cached)
 * before the request"; the push-nothing guard for unusable text lives there,
 * per rule 0. `previous` is NEVER reset by any rule — it only gains entries.
 */
export function shouldRegenerate(cached, stepKey, sourceHash) {
  // Rule 0 — first-ever draft for this prospect.
  if (cached == null) return { generate: true, rotatePrevious: false, resetCounters: true };

  const sameHash = cached.sourceHash === sourceHash;
  const sameStep = cached.stepKey === stepKey;

  // Rule 1 — the model declined; identical inputs will not change its mind.
  if (cached.status === 'insufficient' && sameHash) {
    return { generate: false, rotatePrevious: false, resetCounters: false };
  }
  // Rule 2 — transient failure: the only path that consumes `attempts`.
  if (cached.status === 'failed' && sameHash) {
    return { generate: (cached.attempts || 0) < 2, rotatePrevious: false, resetCounters: false };
  }
  // Rule 3 — the cadence advanced; the old draft (even an edited one)
  // belonged to the previous step.
  if (!sameStep) return { generate: true, rotatePrevious: true, resetCounters: true };
  // Rule 4 — inputs changed in place (e.g. situation edited).
  if (!sameHash) return { generate: cached.edited !== true, rotatePrevious: false, resetCounters: true };
  // Rule 5 — nothing changed.
  return { generate: false, rotatePrevious: false, resetCounters: false };
}

/**
 * rotatePrevious(entry) -> the new `previous` array (pure — never mutates).
 *
 * Pushes entry.text on the front (newest first), cap 2. Pushes NOTHING when
 * the entry has no usable text — empty/whitespace text, or a 'failed' /
 * 'insufficient' status (§7.4 rule 0) — so `previous` can never contain
 * null, '' or a placeholder, and never loses what it already holds.
 */
export function rotatePrevious(entry) {
  const prev = Array.isArray(entry?.previous) ? entry.previous : [];
  const text = typeof entry?.text === 'string' ? entry.text : '';
  const unusable = text.trim() === '' || UNUSABLE_STATUSES.includes(entry?.status);
  if (unusable) return prev.slice(0, 2);
  return [text, ...prev].slice(0, 2);
}

/**
 * pruneDrafts(map, prospects) -> { map, changed }   (§7.5)
 *
 * Drops entries whose prospect id is absent from the loaded list, whose
 * prospect is archived (non-null archivedAt), or whose prospect is in
 * SOLD / LOST (§1 — never drafted for, so a leftover entry is dead weight).
 * Everything else is kept, GHOSTED included. When nothing drops, the
 * ORIGINAL map reference comes back with `changed: false` so the caller can
 * skip the write entirely (§7.5: write back only if something was dropped).
 */
export function pruneDrafts(map, prospects) {
  const src = map && typeof map === 'object' ? map : {};
  const keepable = new Set();
  const list = Array.isArray(prospects) ? prospects : [];
  for (const p of list) {
    if (!p || p.id == null) continue;
    if (p.archivedAt != null) continue;
    if (p.stage === 'SOLD' || p.stage === 'LOST') continue;
    keepable.add(String(p.id));
  }
  let changed = false;
  const next = {};
  for (const id of Object.keys(src)) {
    if (keepable.has(id)) next[id] = src[id];
    else changed = true;
  }
  return changed ? { map: next, changed: true } : { map: src, changed: false };
}
