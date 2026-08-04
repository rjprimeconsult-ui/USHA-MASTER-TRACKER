'use client';
import { useEffect, useState } from 'react';
import { ScrollText, Loader2, ExternalLink } from 'lucide-react';
import { storage } from '@/lib/storage';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { LEGAL } from '@/lib/legalConfig.mjs';
import {
  ACCEPTANCE_KEY,
  CURRENT_LEGAL_VERSION,
  buildAcceptanceRecord,
  needsAcceptance,
} from '@/lib/legalAcceptance.mjs';

/**
 * Blocking acceptance gate for signed-in agents (2026-08-02 legal gap
 * analysis, finding #1).
 *
 * Covers two populations the signup checkbox cannot:
 *   1. The agents who created accounts BEFORE the clickwrap existed — they
 *      have never affirmatively accepted anything, which is precisely what
 *      makes the liability cap and indemnity shaky for the current book.
 *   2. Everyone, whenever LEGAL.documentVersion is bumped — updated terms
 *      require fresh assent.
 *
 * Deliberately NOT dismissible: an "X" would reduce this back to the
 * browsewrap it replaces. There is no skip, and the modal owns the screen
 * until Accept succeeds.
 *
 * Signup acceptances arrive in auth user_metadata (written atomically at
 * account creation, before any session exists); on first sign-in this
 * backfills them into user_kv so a user who already ticked the box at
 * signup is never prompted twice.
 */
export default function LegalAcceptanceGate() {
  // null = still checking (render nothing — never flash a legal modal at
  // someone who has already accepted)
  const [show, setShow] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stored = await storage.getItem(ACCEPTANCE_KEY);
        if (!needsAcceptance(stored)) { if (alive) setShow(false); return; }

        // Nothing usable in storage — check whether they accepted at signup.
        if (supabaseConfigured()) {
          try {
            const { data } = await supabase.auth.getUser();
            const fromSignup = data?.user?.user_metadata?.legal_acceptance;
            if (!needsAcceptance(fromSignup)) {
              // Backfill so the gate is answered from storage next time.
              await storage.setItem(ACCEPTANCE_KEY, JSON.stringify(fromSignup));
              if (alive) setShow(false);
              return;
            }
          } catch { /* fall through to prompting — fail closed */ }
        }

        if (alive) setShow(true);
      } catch {
        // Storage unreadable: prompt rather than silently treat as accepted.
        if (alive) setShow(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const record = buildAcceptanceRecord({ source: 'app' });
    try {
      // Storage first — this is the record the gate reads. It must land, or
      // the agent gets re-prompted forever.
      await storage.setItem(ACCEPTANCE_KEY, JSON.stringify(record));
      // Mirror onto the auth user for a second, independent copy.
      if (supabaseConfigured()) {
        try {
          await supabase.auth.updateUser({ data: { legal_acceptance: record } });
        } catch { /* non-fatal — storage copy is authoritative for the gate */ }
      }
      setShow(false);
    } catch {
      setError('Could not save your acceptance. Check your connection and try again.');
      setBusy(false);
    }
  };

  if (show !== true) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 md:p-7 max-h-[90vh] overflow-y-auto">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg mb-4">
          <ScrollText size={20} />
        </div>

        <h2 className="text-xl font-bold text-slate-900 mb-2">
          Please review our Terms and Privacy Policy
        </h2>
        <p className="text-sm text-slate-600 mb-4 leading-relaxed">
          Before you continue, we need your agreement to the documents that govern
          your use of PRIM. They cover what you and R&amp;J Prime are each responsible
          for, how your data and your clients&apos; data are handled, and the rules for
          outreach you send through PRIM.
        </p>

        <div className="border border-slate-200 rounded-xl divide-y divide-slate-200 mb-4">
          {[
            { href: '/terms', label: 'Terms of Service', hint: 'Your responsibilities, billing, and liability' },
            { href: '/privacy', label: 'Privacy Policy', hint: 'What we collect and who processes it' },
            { href: '/dpa', label: 'Data Processing Addendum', hint: 'How we handle your clients’ data for you' },
          ].map((d) => (
            <a
              key={d.href}
              href={d.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition group"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900 group-hover:text-indigo-700">{d.label}</span>
                <span className="block text-xs text-slate-500">{d.hint}</span>
              </span>
              <ExternalLink size={14} className="text-slate-400 flex-shrink-0" />
            </a>
          ))}
        </div>

        <p className="text-xs text-slate-500 mb-4">
          Effective {LEGAL.effectiveDate} · version {CURRENT_LEGAL_VERSION}
        </p>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800 mb-3">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="w-full bg-accent-gradient disabled:bg-slate-300 disabled:bg-none text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 shadow-accent hover:opacity-95 transition"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          I agree to these terms
        </button>
        <p className="text-[11px] text-slate-400 text-center mt-3">
          Questions? Email{' '}
          <a href={`mailto:${LEGAL.contactEmail}`} className="text-indigo-600 hover:underline">{LEGAL.contactEmail}</a>
        </p>
      </div>
    </div>
  );
}
