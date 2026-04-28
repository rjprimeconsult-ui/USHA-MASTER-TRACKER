'use client';
import { useState, useEffect } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { storage } from '@/lib/storage';

const ACK_KEY = 'no_phi_ack_v1';

/**
 * One-time acknowledgement banner. Shown to every user until they click
 * \"Got it.\" The acknowledgement is stored per-user (via cloud storage when
 * signed in, localStorage otherwise), so it persists across devices.
 *
 * Tells agents: don't enter clinical info (medication names, diagnoses)
 * into the app — keeps us out of HIPAA scope.
 */
export default function NoPhiBanner() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await storage.getItem(ACK_KEY);
        if (!cancelled && !v) setShow(true);
      } catch {
        // If storage fails, default to showing (safer).
        if (!cancelled) setShow(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const dismiss = async () => {
    setBusy(true);
    try {
      await storage.setItem(ACK_KEY, JSON.stringify({ ackAt: new Date().toISOString() }));
    } catch { /* non-fatal */ }
    setShow(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <ShieldAlert size={20} className="text-amber-700" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Heads up — about health info</h2>
            <p className="text-xs text-slate-500 mt-0.5">One-time notice for new agents</p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-slate-700">
          <p>
            PRIM is built for tracking your business — leads, pipeline, commissions, expenses. It is <strong>not a HIPAA-compliant platform</strong> for clinical health information.
          </p>
          <p>
            When you take notes on prospects, please <strong>don&apos;t enter</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-1 bg-red-50 border border-red-200 rounded-lg p-3 text-red-900 text-sm">
            <li>Medication names (e.g. &quot;takes Metformin&quot;)</li>
            <li>Diagnoses (e.g. &quot;Type 2 Diabetes&quot;)</li>
            <li>Lab results, treatment plans, or doctor names</li>
          </ul>
          <p>
            Use general impressions instead — e.g. <em>&quot;has health concerns&quot;</em> or <em>&quot;wants better coverage.&quot;</em>
          </p>
          <p className="text-xs text-slate-500">
            See the <a href="/terms" target="_blank" className="text-indigo-600 hover:underline">Terms of Service</a> for the full policy. Continued use means you agree to the no-PHI rule.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
          <button
            onClick={dismiss}
            disabled={busy}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-5 py-2 text-sm font-semibold"
          >
            Got it — I understand
          </button>
        </div>
      </div>
    </div>
  );
}
