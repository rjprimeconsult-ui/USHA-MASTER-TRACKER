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
// TextDrip's REST endpoints are POST with a JSON body; auth is a Bearer token
// in the Authorization header (confirmed against the Postman collection).
async function tdFetch(apiKey, path, body = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...authHeader(apiKey),
    },
    body: JSON.stringify(body || {}),
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

// ---- Run an async fn over items in bounded-concurrency batches ----
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const res = await Promise.all(chunk.map(fn));
    out.push(...res);
    if (i + size < items.length) await delay(40);
  }
  return out;
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
  const data = await tdFetch(apiKey, '/get-all-tags', { page: '1' });
  // Response shape: { status, tags: { data: [...] } }
  const items = data?.tags?.data ?? data?.data ?? [];
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
  const data = await tdFetch(apiKey, '/get-conversations', { search: '', page: String(page) });
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
export async function getChats(apiKey, phone, maxPages = 1) {
  // TextDrip get-chats expects phone in +1XXXXXXXXXX form.
  // If phone already has digits only (11-digit leading 1), prefix with +.
  const digits = String(phone || '').replace(/\D/g, '');
  const e164 = digits.startsWith('1') && digits.length === 11
    ? `+${digits}`
    : `+1${digits}`;

  const allChats = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await tdFetch(apiKey, '/get-chats', { phone: e164, page: String(page) });
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
export async function runImportScan(apiKey, tagTitle, _lastSyncAt, opts = {}) {
  // Scan the most-recent `maxPages` of conversations every time and import all
  // tag matches found. No time-based incremental cutoff: re-syncs re-scan the
  // recent window and dedup/update via classifyImport (by phone). Conversation
  // PAGES and per-contact CHATS are fetched in bounded-concurrency batches so
  // the scan finishes several-fold faster than one-at-a-time.
  const { maxPages = 25, concurrency = 6 } = opts;

  // 1) First page tells us how many pages exist.
  const first = await getConversationsPage(apiKey, 1);
  const lastPage = first?.last_page ?? 1;
  const totalPages = Math.max(1, Math.min(maxPages, lastPage));

  // 2) Fetch the remaining pages in parallel batches.
  const restNums = [];
  for (let p = 2; p <= totalPages; p++) restNums.push(p);
  const restPages = await inBatches(restNums, concurrency, (p) =>
    getConversationsPage(apiKey, p).catch((err) => {
      console.warn(`[textdrip/sync] page ${p} failed: ${err.message}`);
      return null;
    })
  );
  const allPages = [first, ...restPages.filter(Boolean)];

  // 3) Collect all tag-matched contacts across the scanned pages.
  let scanned = 0;
  const matched = [];
  for (const pg of allPages) {
    for (const conv of (pg?.data ?? [])) {
      scanned++;
      const contact = normalizeContact(conv);
      if (contactHasTag(contact, tagTitle)) matched.push({ contact, phone: conv.phone });
    }
  }

  // 4) Fetch each matched contact's chats in parallel batches.
  const fetched = await inBatches(matched, concurrency, (m) =>
    getChats(apiKey, m.phone)
      .then((chats) => ({ m, chats }))
      .catch((err) => {
        console.warn(`[textdrip/sync] chats failed for ${m.contact.textdripContactId}: ${err.message}`);
        return { m, chats: [] };
      })
  );

  const contacts = [];
  let lastMessageAtMax = null;
  for (const { m, chats } of fetched) {
    const conversation = normalizeConversation(chats);
    if (conversation.lastMessageAt) {
      const t = new Date(conversation.lastMessageAt).getTime();
      if (!lastMessageAtMax || t > new Date(lastMessageAtMax).getTime()) {
        lastMessageAtMax = conversation.lastMessageAt;
      }
    }
    contacts.push({ ...m.contact, conversation });
  }

  console.log(`[textdrip/sync] scan complete: pages=${totalPages} scanned=${scanned} matched=${contacts.length}`);
  return { contacts, scanned, pagesScanned: totalPages, lastMessageAtMax };
}
