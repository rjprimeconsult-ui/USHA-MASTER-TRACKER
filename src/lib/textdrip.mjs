/**
 * textdrip.mjs — Pure, dependency-free TextDrip normalisation helpers.
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
 * TextDrip phones arrive as e.g. "19416851718" (11 digits, leading 1).
 * PRIM stores phones in various formats.  The canonical key lets us
 * match across formats without storing yet another field.
 *
 * Examples:
 *   "19416851718"   → "9416851718"
 *   "+19416851718"  → "9416851718"
 *   "(941) 685-1718" → "9416851718"
 *   "9416851718"    → "9416851718"  (already clean)
 *   "14155552671"   → "4155552671"
 *   "1234"          → "1234"        (short number — left as-is)
 */
export function phoneKey(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

// ---------- Date parsing ----------

/**
 * parseTdDate(human) — parse TextDrip's human-readable date strings like
 * "8th Jun, 2026 6:29 PM" into an ISO 8601 string.
 *
 * Steps:
 *  1. Strip ordinal suffixes (st, nd, rd, th) from the day number.
 *  2. Delegate to the built-in Date parser (works in Node and browsers).
 *  3. Return null on any parse failure.
 */
export function parseTdDate(human) {
  if (!human || typeof human !== 'string') return null;
  // Strip ordinal suffixes: "8th" → "8", "21st" → "21", "2nd" → "2", etc.
  const cleaned = human.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1');
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;
  // Reject implausibly old dates that arise from bad parse fallbacks
  if (d.getFullYear() < 2000) return null;
  return d.toISOString();
}

// ---------- Contact normalisation ----------

/**
 * normalizeContact(conv) — convert a get-conversations item into a
 * canonical contact shape used throughout the integration.
 *
 * @param {object} conv  Raw conversation object from TextDrip API.
 * @returns {{ textdripContactId, name, phone, phoneKey, tags, pipelineId, lastMessage, lastMessageAt }}
 */
export function normalizeContact(conv) {
  if (!conv) return null;
  const nameParts = [conv.name, conv.last_name].filter(Boolean);
  return {
    textdripContactId: String(conv.id),
    name: nameParts.join(' ').trim(),
    phone: conv.phone || '',
    phoneKey: phoneKey(conv.phone),
    tags: Array.isArray(conv.tags) ? conv.tags.map(t => t.title) : [],
    pipelineId: conv.pipeline?.pipeline_id ?? null,
    lastMessage: conv.last_message || '',
    lastMessageAt: parseTdDate(conv.last_message_date),
  };
}

// ---------- Chat / message normalisation ----------

/**
 * normalizeMessage(chat) — convert a single chat item from get-chats into a
 * normalised message.
 *
 * TextDrip direction convention:
 *   type === 'receiver' → OUTBOUND (agent sent to contact)
 *   type === 'sender'   → INBOUND  (contact sent to agent)
 *
 * @param {object} chat  Raw chat item from TextDrip API.
 * @returns {{ at, direction, body, deliveryStatus, isDrip }}
 */
export function normalizeMessage(chat) {
  if (!chat) return null;
  return {
    at: parseTdDate(chat.date),
    direction: chat.type === 'receiver' ? 'out' : 'in',
    body: chat.message || '',
    deliveryStatus: chat.delivery_status || '',
    isDrip: !!chat.is_drip,
  };
}

/**
 * normalizeConversation(chatsDataArray) — normalise an array of raw chat
 * items, sort descending by time, cap to the 50 most recent, and return
 * the composite shape.
 *
 * @param {object[]} chatsDataArray  Array of raw chat items.
 * @returns {{ messages: object[], lastMessageAt: string|null }}
 */
export function normalizeConversation(chatsDataArray) {
  if (!Array.isArray(chatsDataArray)) {
    return { messages: [], lastMessageAt: null };
  }

  const messages = chatsDataArray
    .map(normalizeMessage)
    .filter(Boolean)
    .sort((a, b) => {
      // Sort descending (newest first) so slicing gives most-recent 50
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 50);

  // lastMessageAt = the most-recent message timestamp
  const lastMessageAt = messages.length > 0 ? messages[0].at : null;

  return { messages, lastMessageAt };
}

// ---------- Tag helpers ----------

/**
 * contactHasTag(conv, tagTitle) — case-insensitive check whether a
 * normalised contact has a specific tag.
 *
 * @param {object} contact  Normalised contact (has .tags: string[]).
 * @param {string} tagTitle  The tag title to look for.
 */
export function contactHasTag(contact, tagTitle) {
  if (!contact || !Array.isArray(contact.tags) || !tagTitle) return false;
  const needle = String(tagTitle).toLowerCase();
  return contact.tags.some(t => String(t).toLowerCase() === needle);
}

// ---------- Import classification ----------

/**
 * classifyImport(contact, existingProspects) — decide what to do with a
 * TextDrip contact given the current prospect list.
 *
 * Match strategy: compare contact.phoneKey against each prospect's
 * phoneKey (digits-only, leading-1-dropped).  Also accept match on
 * textdripContactId for reliability when phone changes.
 *
 * Returns:
 *   { action: 'create'  }             — no phone match at all
 *   { action: 'update', matchId }     — match is a TextDrip-origin prospect
 *                                        OR same textdripContactId
 *   { action: 'review', matchId }     — match exists from a different source
 *
 * @param {object}   contact           Normalised contact object.
 * @param {object[]} existingProspects Array of prospect objects from PRIM.
 * @returns {{ action: string, matchId?: string }}
 */
export function classifyImport(contact, existingProspects) {
  if (!contact) return { action: 'create' };
  const prospects = Array.isArray(existingProspects) ? existingProspects : [];
  const ck = contact.phoneKey;
  const tdId = contact.textdripContactId;

  let matched = null;

  for (const p of prospects) {
    const pk = phoneKey(p.phone || '');
    const samePhone = ck && pk && ck === pk;
    const sameTdId = tdId && p.textdripContactId && String(p.textdripContactId) === String(tdId);
    if (samePhone || sameTdId) {
      matched = p;
      break;
    }
  }

  if (!matched) return { action: 'create' };

  // Update in-place if it came from TextDrip OR has same textdripContactId
  if (matched.source === 'TextDrip' || (tdId && String(matched.textdripContactId) === String(tdId))) {
    return { action: 'update', matchId: matched.id };
  }

  // Otherwise it's from a different source — hold for review
  return { action: 'review', matchId: matched.id };
}

// ---------- Prospect mapping ----------

/**
 * mapToProspect(contact, defaultStage, conversation, now) — build a new
 * prospect object from a TextDrip contact.
 *
 * Shape mirrors `newProspect()` from src/lib/prospects.js (read that file
 * to understand all fields).  Only the TextDrip-relevant fields are set;
 * the rest default to empty/null to match the newProspect shape.
 *
 * @param {object} contact       Normalised TextDrip contact.
 * @param {string} defaultStage  Stage ID to assign on creation.
 * @param {object} conversation  Result of normalizeConversation().
 * @param {string} [now]         ISO timestamp for syncedAt (defaults to now).
 * @returns {object}  New prospect object.
 */
export function mapToProspect(contact, defaultStage, conversation, now) {
  const syncedAt = now || new Date().toISOString();
  return {
    // Core identity — matches newProspect() field list
    id: _uid(),
    name: contact.name || '',
    phone: contact.phone || '',
    email: '',
    state: '',
    zip: '',
    timezone: '',
    indvOrFamily: 'Indv',
    dobs: '',
    income: '',
    quoteSize: '',
    policyType: '',
    meds: '',
    situation: '',
    startDate: '',
    source: 'TextDrip',
    referrer: '',
    leadVendor: '',
    crm: 'TextDrip',
    stage: defaultStage || 'PENDING_DECISION',
    appointmentTime: '',
    nextSteps: '',
    lastContact: '',
    custom: {},
    createdAt: syncedAt,
    archivedAt: null,
    convertedLeadId: null,
    // Follow-up system fields (mirrors FOLLOWUP_DEFAULTS)
    touchLog: [],
    stageEnteredAt: syncedAt,
    cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
    // TextDrip-specific
    textdripContactId: contact.textdripContactId,
    textdripChat: {
      messages: conversation ? conversation.messages : [],
      lastMessageAt: conversation ? conversation.lastMessageAt : null,
      syncedAt,
    },
  };
}

/**
 * mergeConversationIntoProspect(prospect, contact, now) — return an updated
 * copy of an existing prospect with refreshed TextDrip chat data.
 *
 * Preserves all unrelated fields; updates textdripChat and STAMPS
 * textdripContactId (if not already set) so future syncs classify this
 * prospect as an in-place `update` instead of re-prompting for review.
 * Keeps the prospect's existing source if it has one (e.g. a merged
 * Google-Ads prospect stays 'Google Ads'); only defaults to 'TextDrip'
 * when there is no source.
 *
 * Accepts either a normalised contact ({ conversation, textdripContactId })
 * or a bare conversation ({ messages, lastMessageAt }) for back-compat.
 *
 * @param {object} prospect            Existing PRIM prospect.
 * @param {object} contactOrConversation Normalised contact or conversation.
 * @param {string} [now]               ISO timestamp for syncedAt.
 * @returns {object}  Updated prospect (new object, no mutation).
 */
export function mergeConversationIntoProspect(prospect, contactOrConversation, now) {
  const syncedAt = now || new Date().toISOString();
  const arg = contactOrConversation || null;
  const isContact = !!arg && typeof arg === 'object' && 'conversation' in arg;
  const conversation = isContact ? arg.conversation : arg;
  const incomingTdId = isContact ? arg.textdripContactId : null;
  return {
    ...prospect,
    source: prospect.source || 'TextDrip',
    textdripContactId: prospect.textdripContactId || incomingTdId || null,
    textdripChat: {
      messages: conversation ? conversation.messages : [],
      lastMessageAt: conversation ? conversation.lastMessageAt : null,
      syncedAt,
    },
  };
}

// ---------- Internal helpers ----------

/** Inline uid() to keep this file dependency-free. */
function _uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
