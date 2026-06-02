'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

/**
 * Slim sticky bar that appears when a NEW deployment of PRIM is live but the
 * user's open tab is still running the old build. Guarantees nobody is stuck
 * on a stale version (the #1 cause of "it's broken" / "I don't see the new
 * feature" reports), independent of whether they saw the Slack announcement.
 *
 * How it works:
 *   1. On mount, fetch /api/version and remember it as the build this tab loaded.
 *   2. Re-check on tab focus / visibility change, and every CHECK_MS as a backstop.
 *   3. If the server reports a different version, show the bar.
 *
 * The check is cheap (a few bytes), never cached, and fails silent — if the
 * network hiccups we simply don't prompt.
 */
const CHECK_MS = 5 * 60 * 1000; // backstop poll every 5 min

async function fetchVersion() {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.version || null;
  } catch {
    return null;
  }
}

export default function UpdateBanner() {
  const loadedVersion = useRef(null);
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const v = await fetchVersion();
      if (cancelled || !v || v === 'dev') return;
      if (loadedVersion.current === null) {
        loadedVersion.current = v; // first read = the build this tab is running
        return;
      }
      if (v !== loadedVersion.current) setStale(true);
    };

    check(); // establish baseline immediately

    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    const id = setInterval(check, CHECK_MS);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      clearInterval(id);
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[60] bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-2xl">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <RefreshCw size={16} className="flex-shrink-0" />
        <div className="flex-1 text-sm font-medium leading-tight">
          A new version of PRIM is available.
          <span className="opacity-90 font-normal"> Refresh to get the latest features and fixes.</span>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="bg-white text-emerald-700 hover:bg-emerald-50 rounded-lg px-3 py-1.5 text-sm font-bold whitespace-nowrap flex items-center gap-1.5"
        >
          <RefreshCw size={13} /> Refresh now
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-white/70 hover:text-white p-1"
          title="Dismiss (you can refresh later)"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
