/**
 * Attachment storage in IndexedDB.
 *
 * Why IndexedDB instead of localStorage:
 *   - localStorage caps at ~5–10MB total per origin
 *   - Each base64 receipt at ~150KB compressed eats that quota fast
 *   - IndexedDB caps at hundreds of MB → effectively unlimited for receipts
 *   - Stores Blobs natively (no 33% base64 inflation)
 *
 * Public API:
 *   saveAttachment(id, file)      → { id, name, type, sizeBytes }
 *   getAttachmentDataUrl(id)      → "data:image/jpeg;base64,..." or null
 *   getAttachmentMeta(id)         → { name, type, sizeBytes } or null
 *   deleteAttachment(id)          → void
 *
 * Entries store only `attachmentId` (a string). The Blob lives in IDB.
 */

import { get, set, del, createStore } from 'idb-keyval';
import { uid } from './utils';

const STORE = typeof window !== 'undefined'
  ? createStore('usha-tracker-attachments', 'blobs')
  : null;

// Browser without IndexedDB (very old) — fall back to in-memory map.
const memFallback = new Map();
const useFallback = () => typeof window === 'undefined' || !window.indexedDB;

/** Save a {name, type, dataUrl} object as a Blob in IDB and return its id. */
export async function saveAttachment(record) {
  if (!record) return null;
  const id = uid();
  const value = {
    name: record.name,
    type: record.type,
    dataUrl: record.dataUrl,
    sizeBytes: record.dataUrl?.length || 0,
    createdAt: new Date().toISOString(),
  };
  if (useFallback()) {
    memFallback.set(id, value);
  } else {
    try {
      await set(id, value, STORE);
    } catch (e) {
      console.warn('saveAttachment failed, using in-memory fallback', e);
      memFallback.set(id, value);
    }
  }
  return { id, name: value.name, type: value.type, sizeBytes: value.sizeBytes };
}

export async function getAttachment(id) {
  if (!id) return null;
  if (useFallback() || memFallback.has(id)) return memFallback.get(id) || null;
  try { return (await get(id, STORE)) || null; } catch { return null; }
}

export async function deleteAttachment(id) {
  if (!id) return;
  memFallback.delete(id);
  if (useFallback()) return;
  try { await del(id, STORE); } catch { /* ignore */ }
}
