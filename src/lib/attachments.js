/**
 * Cloud-aware attachment storage.
 *
 * - When user is signed in: attachments upload to Supabase Storage bucket 'receipts'
 *   under the path <user_id>/<random_id>.<ext>. RLS in the bucket restricts
 *   reads/writes to the file owner only (see supabase/schema.sql).
 * - When user is signed out / Supabase isn't configured: falls back to IndexedDB
 *   (Phase 1 behavior).
 *
 * The entry only stores a lightweight reference: { id, name, type, sizeBytes }.
 * - Cloud attachments: id = "<user_id>/<filename>" (path in the bucket)
 * - Local attachments: id = uid() (key in IndexedDB)
 *
 * On read, the helper auto-detects which storage backend to use based on
 * whether the id contains '/' (cloud paths always do, IDB ids never do).
 */

import { get, set, del, createStore } from 'idb-keyval';
import { uid } from './utils';
import { supabase, supabaseConfigured } from './supabase';

const STORE = typeof window !== 'undefined'
  ? createStore('usha-tracker-attachments', 'blobs')
  : null;
const memFallback = new Map();
const useFallback = () => typeof window === 'undefined' || !window.indexedDB;

// Cache the current user id so we don't hit getSession() on every call.
let cachedUserId = null;
if (typeof window !== 'undefined' && supabaseConfigured()) {
  supabase.auth.getSession().then(({ data }) => {
    cachedUserId = data.session?.user?.id || null;
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedUserId = session?.user?.id || null;
  });
}
const useCloud = () => supabaseConfigured() && !!cachedUserId;
const isCloudPath = (id) => typeof id === 'string' && id.includes('/');

// ---------- Conversions ----------
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---------- Public API ----------

/** Save a {name, type, dataUrl} record. Returns { id, name, type, sizeBytes }. */
export async function saveAttachment(record) {
  if (!record || !record.dataUrl) return null;

  // Try cloud first if signed in
  if (useCloud()) {
    try {
      const blob = dataUrlToBlob(record.dataUrl);
      const ext = (String(record.name || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const path = `${cachedUserId}/${uid()}.${ext}`;
      const { error } = await supabase.storage
        .from('receipts')
        .upload(path, blob, {
          contentType: record.type || 'application/octet-stream',
          upsert: false,
        });
      if (error) throw error;
      return {
        id: path,
        name: record.name,
        type: record.type,
        sizeBytes: blob.size,
      };
    } catch (e) {
      console.warn('saveAttachment cloud failed, falling back to IDB', e);
    }
  }

  // Local fallback (IndexedDB)
  const id = uid();
  const value = {
    name: record.name,
    type: record.type,
    dataUrl: record.dataUrl,
    sizeBytes: record.dataUrl.length || 0,
    createdAt: new Date().toISOString(),
  };
  if (useFallback()) {
    memFallback.set(id, value);
  } else {
    try { await set(id, value, STORE); }
    catch (e) { console.warn('saveAttachment IDB failed', e); memFallback.set(id, value); }
  }
  return { id, name: value.name, type: value.type, sizeBytes: value.sizeBytes };
}

/** Fetch the full attachment record (with dataUrl) by id. */
export async function getAttachment(id) {
  if (!id) return null;

  // Cloud path (contains '/')
  if (isCloudPath(id) && useCloud()) {
    try {
      const { data, error } = await supabase.storage.from('receipts').download(id);
      if (error || !data) throw error;
      const dataUrl = await blobToDataUrl(data);
      const fileName = id.split('/').pop() || 'receipt';
      return { name: fileName, type: data.type, dataUrl, sizeBytes: data.size };
    } catch (e) {
      console.warn('getAttachment cloud failed', e);
      return null;
    }
  }

  // Local (IDB)
  if (useFallback() || memFallback.has(id)) return memFallback.get(id) || null;
  try { return (await get(id, STORE)) || null; } catch { return null; }
}

/** Delete an attachment by id (cloud or local). */
export async function deleteAttachment(id) {
  if (!id) return;
  if (isCloudPath(id) && useCloud()) {
    try { await supabase.storage.from('receipts').remove([id]); }
    catch (e) { console.warn('deleteAttachment cloud failed', e); }
    return;
  }
  memFallback.delete(id);
  if (useFallback()) return;
  try { await del(id, STORE); } catch { /* ignore */ }
}
