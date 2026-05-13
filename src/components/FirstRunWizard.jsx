'use client';
import { useState } from 'react';
import {
  Sparkles, X, ChevronRight, ChevronLeft, Check, Upload, Plus,
  BookOpen, Calculator, MessageCircle, BarChart3, Wand2,
} from 'lucide-react';
import { TIERS } from '@/lib/commission';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * First-run setup wizard.
 *
 * Replaces the auto-launch of the 12-step OnboardingWalkthrough for
 * brand-new agents. The old tour was a feature inventory ("here's where
 * each tab is"); this wizard is a fast setup flow that gets agents to
 * their first piece of value in under a minute.
 *
 * Four steps:
 *   1. Welcome + pick tier
 *   2. How to start (upload statement / add lead / skip)
 *   3. Books setup explainer (optional Smart Import nudge)
 *   4. You're set — quick links to explore
 *
 * Every step has Skip + Back + Continue. Skip-anywhere closes the wizard
 * and marks onboarding complete so it never auto-launches again. The
 * 12-step walkthrough is still available via a Replay button in Settings.
 *
 * Props:
 *   open                    — boolean
 *   onClose()               — called when wizard closes (skip or finish).
 *                             Parent should also call onComplete().
 *   onComplete({ tier })    — fired with final wizard state when the agent
 *                             clicks the final "Start using PRIM" button.
 *   onSelectTier(tier)      — called when the agent picks a tier on step 1.
 *                             Parent should setTier() to persist.
 *   onOpenSmartImport()     — opens the Books Smart Import wizard.
 *   onOpenLeadForm()        — opens a blank new-lead form.
 *   onNavigate(viewId)      — routes to a top-level view.
 *   onOpenChat()            — opens the PRIM Assistant chat bubble.
 *   initialTier             — current tier (default selection on step 1).
 */
export default function FirstRunWizard({
  open,
  onClose,
  onComplete,
  onSelectTier,
  onOpenSmartImport,
  onOpenLeadForm,
  onNavigate,
  onOpenChat,
  initialTier = 'WA',
}) {
  const [step, setStep] = useState(1);
  const [tier, setTier] = useState(initialTier);
  const [firstActionPicked, setFirstActionPicked] = useState(null); // 'statement' | 'lead' | 'skip' | null

  if (!open) return null;

  const totalSteps = 4;

  const finish = (deferredAction) => {
    if (typeof onComplete === 'function') onComplete({ tier, firstActionPicked });
    if (typeof onClose === 'function') onClose();
    // Fire deferred action AFTER close so the parent doesn't have stale
    // wizard state (e.g. opening Smart Import while wizard's still modal).
    if (deferredAction) setTimeout(deferredAction, 100);
  };

  const skipAll = () => finish(null);

  const next = () => setStep(s => Math.min(totalSteps, s + 1));
  const back = () => setStep(s => Math.max(1, s - 1));

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">Welcome to PRIM</div>
              <div className="text-[11px] text-slate-500">Step {step} of {totalSteps}</div>
            </div>
          </div>
          <button
            onClick={skipAll}
            className="text-xs text-slate-400 hover:text-slate-700 flex items-center gap-1"
            title="Skip setup — you can always come back to this from Settings"
          >
            Skip setup <X size={12} />
          </button>
        </div>

        {/* Progress dots */}
        <div className="px-6 pt-3 pb-2 flex items-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i + 1 === step ? 'bg-indigo-600 flex-1' : i + 1 < step ? 'bg-indigo-300 flex-1' : 'bg-slate-200 flex-1'}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 py-5 min-h-[280px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18 }}
            >
              {step === 1 && (
                <Step1Tier
                  tier={tier}
                  setTier={(t) => {
                    setTier(t);
                    if (typeof onSelectTier === 'function') onSelectTier(t);
                  }}
                />
              )}
              {step === 2 && (
                <Step2FirstAction
                  picked={firstActionPicked}
                  setPicked={setFirstActionPicked}
                />
              )}
              {step === 3 && <Step3Books />}
              {step === 4 && (
                <Step4Done
                  onJumpToCpa={() => finish(() => onNavigate?.('cpa'))}
                  onJumpToSmartImport={() => finish(() => onOpenSmartImport?.())}
                  onJumpToChat={() => finish(() => onOpenChat?.())}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between rounded-b-2xl">
          {step > 1 ? (
            <button
              onClick={back}
              className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1 font-medium"
            >
              <ChevronLeft size={14} /> Back
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            {step === 2 && firstActionPicked === 'statement' ? (
              <button
                onClick={() => finish(() => onOpenSmartImport?.())}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                Open Smart Import <ChevronRight size={14} />
              </button>
            ) : step === 2 && firstActionPicked === 'lead' ? (
              <button
                onClick={() => finish(() => onOpenLeadForm?.())}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                Add a lead <ChevronRight size={14} />
              </button>
            ) : step === 3 ? (
              <>
                <button
                  onClick={next}
                  className="text-sm text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg font-medium"
                >
                  I&apos;ll do this later
                </button>
                <button
                  onClick={() => finish(() => { onNavigate?.('books'); onOpenSmartImport?.(); })}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
                >
                  Open Books <ChevronRight size={14} />
                </button>
              </>
            ) : step === 4 ? (
              <button
                onClick={() => finish(null)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2 rounded-lg flex items-center gap-1.5"
              >
                Start using PRIM <Check size={14} />
              </button>
            ) : (
              <button
                onClick={next}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
              >
                Continue <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------- Step content components ----------------

function Step1Tier({ tier, setTier }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 mb-1">First, your contract tier.</h2>
      <p className="text-sm text-slate-500 mb-4">
        This drives every commission and CPA projection. You can change it anytime from Settings.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {TIERS.map(t => (
          <button
            key={t.id}
            onClick={() => setTier(t.id)}
            className={`rounded-xl p-3 text-left border transition ${tier === t.id ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'}`}
          >
            <div className={`font-bold text-base ${tier === t.id ? 'text-indigo-700' : 'text-slate-900'}`}>{t.id}</div>
            <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{t.label}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-3">
        Not sure? Pick your best guess — you can change it anytime.
      </p>
    </div>
  );
}

function Step2FirstAction({ picked, setPicked }) {
  const options = [
    {
      key: 'statement',
      icon: Upload,
      title: 'Upload my USHA statement',
      desc: 'Smart Import parses every deal + premium + advance automatically. Fastest path to seeing PRIM populated.',
    },
    {
      key: 'lead',
      icon: Plus,
      title: 'Add a deal manually',
      desc: 'Type in your most recent close yourself. Good if you only want to track new sales going forward.',
    },
    {
      key: 'skip',
      icon: ChevronRight,
      title: 'Skip for now',
      desc: "I'll add data later. Just show me around.",
    },
  ];
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 mb-1">How do you want to start?</h2>
      <p className="text-sm text-slate-500 mb-4">
        Get your first piece of data in to see PRIM work. Or skip and explore first.
      </p>
      <div className="space-y-2">
        {options.map(o => (
          <button
            key={o.key}
            onClick={() => setPicked(o.key)}
            className={`w-full text-left rounded-xl p-3 border transition flex gap-3 items-start ${picked === o.key ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'}`}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${picked === o.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              <o.icon size={16} />
            </div>
            <div>
              <div className="font-semibold text-sm text-slate-900">{o.title}</div>
              <div className="text-xs text-slate-500 leading-relaxed mt-0.5">{o.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step3Books() {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900 mb-1">Track expenses with Books.</h2>
      <p className="text-sm text-slate-500 mb-4">
        Books gives you a real monthly P&amp;L — commissions in, expenses out, true net. Smart Import handles
        bank statements, credit-card exports, even expense Excel files.
      </p>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <BookOpen size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Auto-categorized.</span> Drop a CSV — Smart Import classifies every
            row (Lead Investment, Software, Office, Travel, etc.) and skips totals/headers automatically.
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Calculator size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Feeds True CPA.</span> Lead Investment + Software + CRM platforms
            (Ringy / TextDrip / VanillaSoft) automatically roll into your per-deal cost basis.
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Wand2 size={18} className="text-indigo-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Learns your vendors.</span> Confirm a vendor once → PRIM auto-routes
            future imports the same way.
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3">
        This is optional during setup — you can come back to Books any time.
      </p>
    </div>
  );
}

function Step4Done({ onJumpToCpa, onJumpToSmartImport, onJumpToChat }) {
  return (
    <div>
      <div className="text-center mb-5">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-3 text-white">
          <Check size={28} />
        </div>
        <h2 className="text-xl font-bold text-slate-900">You&apos;re set.</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
          A few good places to explore from here:
        </p>
      </div>

      <div className="space-y-2">
        <button
          onClick={onJumpToCpa}
          className="w-full text-left rounded-xl p-3 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition flex gap-3 items-center"
        >
          <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
            <BarChart3 size={16} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-slate-900">Check the CPA Dashboard</div>
            <div className="text-xs text-slate-500">Your weekly KPIs once you have data in.</div>
          </div>
          <ChevronRight size={14} className="text-slate-400" />
        </button>
        <button
          onClick={onJumpToSmartImport}
          className="w-full text-left rounded-xl p-3 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition flex gap-3 items-center"
        >
          <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0">
            <Upload size={16} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-slate-900">Try Smart Import</div>
            <div className="text-xs text-slate-500">Drop any statement or expense file — AI handles the rest.</div>
          </div>
          <ChevronRight size={14} className="text-slate-400" />
        </button>
        <button
          onClick={onJumpToChat}
          className="w-full text-left rounded-xl p-3 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition flex gap-3 items-center"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
            <MessageCircle size={16} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-slate-900">Meet the PRIM Assistant</div>
            <div className="text-xs text-slate-500">Ask anything about PRIM or your own data.</div>
          </div>
          <ChevronRight size={14} className="text-slate-400" />
        </button>
      </div>
    </div>
  );
}
