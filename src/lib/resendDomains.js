/**
 * Verified-domain lookup against Resend. SERVER-ONLY (reads RESEND_API_KEY).
 * Source of truth is Resend's own domain list (spec §5): Juan verifies in
 * the dashboard, PRIM reflects. Module-memory cache, 5-minute TTL, success
 * only — a failure is never cached, so one bad call can't stick.
 */

const TTL_MS = 5 * 60 * 1000;
let cache = null; // { domains: Set<string>, at: number }

export async function listVerifiedDomains({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return { ok: true, domains: cache.domains };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false };
  try {
    const r = await fetchImpl('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return { ok: false };
    const data = await r.json();
    const domains = new Set(
      (Array.isArray(data?.data) ? data.data : [])
        .filter((d) => d?.status === 'verified')
        .map((d) => String(d.name || '').toLowerCase())
        .filter(Boolean)
    );
    cache = { domains, at: now };
    return { ok: true, domains };
  } catch {
    return { ok: false };
  }
}

// Tri-state (spec §5): 'verified' | 'unverified' | 'unknown'. The two
// non-verified states send identically (shared lane) but the status UI
// must tell them apart — "ask Juan to verify" vs "couldn't check".
export function domainStatusFor(addr, result) {
  if (!result || result.ok !== true) return 'unknown';
  const domain = String(addr || '').split('@')[1]?.trim().toLowerCase();
  if (!domain) return 'unknown';
  return result.domains.has(domain) ? 'verified' : 'unverified';
}

export function __resetDomainCacheForTests() { cache = null; }
