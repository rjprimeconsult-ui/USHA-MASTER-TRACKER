/**
 * textdripServer.js — Server-only TextDrip REST network client.
 *
 * NEVER import this from client components.  It uses fetch with an API key
 * that must stay server-side only.
 *
 * Base URL: https://api.textdrip.com/api
 * Auth: Authorization: Bearer <apiKey>
 *
 * The auth header format is the one remaining unconfirmed item (see spec).
 * It is isolated to the single constant `authHeader` below — change it in
 * one place if the live API turns out to use a different header name.
 */

import { normalizeContact, normalizeConversation, contactHasTag, parseTdDate } from './textdrip.mjs';

const BASE_URL = 'https://api.textdrip.com/api';

// ---- Auth header builder (single point of change) ----
function authHeader(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

// ---- Low-level fetch helper ----
async function tdFetch(apiKey, path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(apiKey),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`TextDrip API error ${res.status} on ${path}: ${body.slice(0, 200)}`),
      { status: res.status }
    );
  }
  return res.json();
}

// ---- Small async delay (ms) between page fetches to respect rate limits ----
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// getAllTags(apiKey)
// ============================================================
/**
 * Fetch the first page of tags and return an array of tag titles.
 * Note: per spec, `id` is null in this endpoint — use title only.
 *
 * @param {string} apiKey
 * @returns {Promise<string[]>}  Array of tag title strings.
 */
export async function getAllTags(apiKey) {
  const data = await tdFetch(apiKey, '/get-all-tags?page=1');
  // The response shape can vary — normalise defensively.
  const items = data?.data ?? data?.tags ?? data?.contacts?.data ?? [];
  if (!Array.isArray(items)) return [];
  return items.map((t) => t?.title).filter(Boolean);
}

// ============================================================
// getConversationsPage(apiKey, page)
// ============================================================
/**
 * Fetch a single page of conversations (newest-first, 7 per page).
 *
 * @param {string} apiKey
 * @param {number} page
 * @returns {Promise<object>}  The raw `contacts` object { data, current_page, last_page, ... }
 */
export async function getConversationsPage(apiKey, page) {
  const data = await tdFetch(apiKey, `/get-conversations?page=${page}`);
  return data?.contacts ?? data;
}

// ============================================================
// getChats(apiKey, phone)
// ============================================================
/**
 * Fetch chat messages for a phone number — pages 1 to maxPages (default 4).
 * TextDrip returns 15 per page, so 4 pages = up to 60 raw messages which
 * normalizeConversation will cap to 50.
 *
 * Phone must be passed as "+1XXXXXXXXXX" per TextDrip's get-chats endpoint.
 *
 * @param {string} apiKey
 * @param {string} phone       Raw phone from TextDrip (e.g. "19416851718")
 * @param {number} [maxPages]  Max pages to fetch (default 4)
 * @returns {Promise<object[]>}  Flat array of raw chat items.
 */
export async function getChats(apiKey, phone, maxPages = 4) {
  // TextDrip get-chats expects phone in +1XXXXXXXXXX form.
  // If phone already has digits only (11-digit leading 1), prefix with +.
  const digits = String(phone || '').replace(/\D/g, '');
  const e164 = digits.startsWith('1') && digits.length === 11
    ? `+${digits}`
    : `+1${digits}`;

  const allChats = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await tdFetch(apiKey, `/get-chats?phone=${encodeURIComponent(e164)}&page=${page}`);
    const chatPage = data?.chats?.data ?? [];
    allChats.push(...chatPage);
    const lastPage = data?.chats?.last_page ?? 1;
    if (page >= lastPage) break;
    if (page < maxPages) await delay(100);
  }
  return allChats;
}

// ============================================================
// runImportScan(apiKey, tagTitle, lastSyncAt, opts)
// ============================================================
/**
 * Implements the spec's import scan: page through get-conversations
 * newest-first, collect contacts that have the chosen tag, fetch their
 * chats, and stop when past the incremental cutoff or the page cap.
 *
 * @param {string}      apiKey
 * @param {string}      tagTitle          The import tag (case-insensitive match).
 * @param {string|null} lastSyncAt        ISO string of previous sync, or null for first sync.
 * @param {object}      [opts]
 * @param {number}      [opts.firstSyncMaxPages=30]  Page cap for first sync.
 * @returns {Promise<{
 *   contacts: object[],
 *   scanned: number,
 *   pagesScanned: number,
 *   lastMessageAtMax: string|null
 * }>}
 */
export async function runImportScan(apiKey, tagTitle, lastSyncAt, opts = {}) {
  const { firstSyncMaxPages = 30 } = opts;
  const cutoff = lastSyncAt ? new Date(lastSyncAt).getTime() : null;

  const contacts = [];
  let scanned = 0;
  let pagesScanned = 0;
  let lastMessageAtMax = null;
  let done = false;

  for (let page = 1; !done; page++) {
    if (!lastSyncAt && page > firstSyncMaxPages) {
      console.log(`[textdrip/sync] First-sync page cap (${firstSyncMaxPages}) reached — stopping.`);
      break;
    }

    let pageData;
    try {
      pageData = await getConversationsPage(apiKey, page);
    } catch (err) {
      throw new Error(`TextDrip scan failed on page ${page}: ${err.message}`);
    }

    const convs = pageData?.data ?? [];
    pagesScanned = page;

    if (convs.length === 0) break;

    for (const conv of convs) {
      scanned++;

      // Incremental stop: if this conversation's last message is older than
      // our last sync, everything beyond this point is already synced.
      if (cutoff) {
        const convAt = parseTdDate(conv.last_message_date);
        if (convAt && new Date(convAt).getTime() < cutoff) {
          done = true;
          break;
        }
      }

      const contact = normalizeContact(conv);
      if (!contactHasTag(contact, tagTitle)) continue;

      // Only fetch chats for tag-matched contacts (respects rate limits)
      let chats = [];
      try {
        chats = await getChats(apiKey, conv.phone);
      } catch (err) {
        // Log and continue with empty conversation on chat fetch failure
        console.warn(`[textdrip/sync] Failed to fetch chats for contact ${contact.textdripContactId}: ${err.message}`);
      }

      const conversation = normalizeConversation(chats);

      // Track the max lastMessageAt across all matched contacts
      if (conversation.lastMessageAt) {
        const t = new Date(conversation.lastMessageAt).getTime();
        if (!lastMessageAtMax || t > new Date(lastMessageAtMax).getTime()) {
          lastMessageAtMax = conversation.lastMessageAt;
        }
      }

      contacts.push({ ...contact, conversation });
    }

    const lastPage = pageData?.last_page ?? 1;
    if (page >= lastPage) break;

    // Small delay between pages to respect rate limits
    if (!done) await delay(150);
  }

  console.log(`[textdrip/sync] scan complete: pages=${pagesScanned} scanned=${scanned} matched=${contacts.length}`);

  return { contacts, scanned, pagesScanned, lastMessageAtMax };
}
