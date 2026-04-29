'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CloudUpload, Check, X, Loader2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { inspectStorage, migrateLocalToCloud, storage } from '@/lib/storage';

const DISMISS_KEY = 'prim_migration_dismissed_v1';

/**
 * One-time prompt that appears when:
 *   - User is signed in
 *   - Cloud has no data
 *   - localStorage has data from prior local-only sessions
 *
 * Lets user upload everything to cloud with one click. Dismissable.
 */
export default function MigrationPrompt() {
  const { user, loading } = useAuth();
  const [state, setState] = useState({ checking: true, show: false, local: {} });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (loading || !user) return;
    // Don't re-prompt after user dismisses — go through the cloud-aware
    // adapter so dismissal syncs across devices for this user.
    let alive = true;
    (async () => {
      const dismissed = await storage.getItem(DISMISS_KEY);
      if (!alive) return;
      if (dismissed) {
        setState({ checking: false, show: false, local: {} });
        return;
      }
      const { local, hasLocal, hasCloud } = await inspectStorage();
      if (!alive) return;
      setState({
        checking: false,
        show: hasLocal && !hasCloud,
        local,
      });
    })();
    return () => { alive = false; };
  }, [loading, user]);

  if (loading || state.checking || !state.show) return null;

  const summarize = (obj) => {
    const parts = [];
    if (obj.leads_v5)            parts.push(`${obj.leads_v5} leads`);
    if (obj.investments_v2)      parts.push(`${obj.investments_v2} investments`);
    if (obj.platform_expenses_v1) parts.push(`${obj.platform_expenses_v1} platform entries`);
    if (obj.business_expenses_v1) parts.push(`${obj.business_expenses_v1} expenses`);
    if (obj.business_income_v1)   parts.push(`${obj.business_income_v1} income entries`);
    if (obj.chargebacks_v1)       parts.push(`${obj.chargebacks_v1} chargebacks`);
    if (obj.activities_v1)        parts.push(`${obj.activities_v1} activities`);
    return parts.length > 0 ? parts.join(' · ') : 'no data';
  };

  const dismiss = () => {
    storage.setItem(DISMISS_KEY, '1').catch(() => {});
    setState(s => ({ ...s, show: false }));
  };

  const upload = async () => {
    setBusy(true);
    try {
      const result = await migrateLocalToCloud();
      setDone(result);
      await storage.setItem(DISMISS_KEY, '1').catch(() => {});
      // Reload after a beat so the app re-fetches from cloud
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      alert('Upload failed: ' + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-[calc(100%-1.5rem)] bg-white border border-indigo-300 shadow-xl shadow-indigo-500/20 rounded-2xl p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shrink-0">
          <CloudUpload size={18} />
        </div>
        <div className="flex-1 min-w-0">
          {done ? (
            <>
              <div className="font-semibold text-emerald-900 flex items-center gap-2">
                <Check size={16} className="text-emerald-600" />
                Uploaded {done.migrated} collection{done.migrated !== 1 ? 's' : ''} to cloud
              </div>
              <div className="text-xs text-slate-600 mt-1">Reloading to sync from cloud…</div>
            </>
          ) : (
            <>
              <div className="font-semibold text-slate-900">Upload your local data to cloud?</div>
              <div className="text-xs text-slate-600 mt-1">
                We found data in your browser from before you signed in: <span className="font-semibold text-slate-900">{summarize(state.local)}</span>.
                Upload it now so it's available on every device, or dismiss to start fresh in the cloud.
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={upload}
                  disabled={busy}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-semibold flex items-center gap-2 transition"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  Upload to cloud
                </button>
                <button
                  onClick={dismiss}
                  disabled={busy}
                  className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5"
                >
                  Start fresh
                </button>
              </div>
            </>
          )}
        </div>
        {!done && (
          <button onClick={dismiss} disabled={busy} className="text-slate-400 hover:text-slate-600 -mt-1">
            <X size={16} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
