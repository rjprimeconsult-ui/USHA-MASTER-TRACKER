const hasLS = () => typeof window !== 'undefined' && !!window.localStorage;

// Subscribers notified when a setItem fails (e.g. QuotaExceededError).
// LeadTracker registers a listener and pops a toast.
let quotaListener = null;
export const onStorageError = (fn) => { quotaListener = fn; };

const isQuotaError = (e) => (
  e && (
    e.code === 22 ||
    e.code === 1014 ||
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  )
);

export const storage = {
  async getItem(key) {
    if (!hasLS()) return null;
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  async setItem(key, value) {
    if (!hasLS()) return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (isQuotaError(e) && quotaListener) {
        quotaListener({ key, valueSize: typeof value === 'string' ? value.length : 0, error: e });
      } else {
        // Re-throw unexpected errors so dev can see them
        if (typeof console !== 'undefined') console.warn('storage.setItem failed', key, e);
      }
      return false;
    }
  },
  async removeItem(key) {
    if (!hasLS()) return;
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
