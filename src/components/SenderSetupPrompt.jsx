'use client';
import { Mail, ArrowRight } from 'lucide-react';
import { GlassModal } from './motion/MotionPrimitives';
import { canAccessBetaFeature } from '@/lib/featureFlags';
import { missingFields } from '@/lib/senderGate.mjs';

/**
 * Post-upgrade sender-setup walkthrough (spec §9.1 trigger 1).
 *
 * Shown once per mount by PaywallGate after a successful checkout sync,
 * when the freshly-synced tier grants an email feature AND the sender
 * identity is incomplete — Juan's "since you already upgraded, you have
 * to do this now to use what you unlocked" moment.
 *
 * Deliberately writes NO storage: completion is derived from the identity
 * itself (missingFields), so the prompt reappearing on a later upgrade
 * with a still-incomplete identity is correct behavior, not a bug.
 */

// Pure decision — the four entitled × complete combinations are pinned in
// SenderSetup.test.jsx. Entitlement checks BOTH email flags (spec §9.1):
// identical tiers today, but a future tier split must not silently kill
// the prompt. The outreach kind is the superset (npn included) — after
// the Pro tier change every entitled agent is outreach-entitled.
export function shouldShowSenderSetupPrompt({ profile, identity }) {
  if (!profile || !identity) return false;
  const entitled =
    canAccessBetaFeature('post_sale_emails', profile).canAccess ||
    canAccessBetaFeature('outreach_emails', profile).canAccess;
  if (!entitled) return false;
  return missingFields(identity, 'outreach').length > 0;
}

export default function SenderSetupPrompt({ open, onClose, onOpenProfile }) {
  if (!open) return null;
  return (
    <GlassModal open onClose={onClose} maxWidth="max-w-md" zIndexClass="z-[80]">
      <div className="p-6">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg mb-4">
          <Mail size={22} />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1.5">
          You&apos;ve unlocked email templates
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Set up your sender identity to start sending — your name, business,
          mailing address and NPN go on every email you send.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { onOpenProfile?.(); onClose?.(); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
          >
            Set up now <ArrowRight size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm border border-slate-200 bg-white rounded-lg px-4 py-2 text-slate-600 hover:bg-slate-50"
          >
            Later
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
