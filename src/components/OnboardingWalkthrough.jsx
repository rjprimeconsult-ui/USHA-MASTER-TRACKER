'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  X, ChevronLeft, ChevronRight, MessageCircle,
  Calculator, CheckSquare, LayoutDashboard, Repeat, Users, Columns,
  UserPlus, DollarSign, BookOpen, Upload, Sparkles, ArrowRight,
} from 'lucide-react';
import {
  loadOnboardingProgress, saveOnboardingProgress, markStep,
  markSkipped, markCompleted, startOnboarding,
} from '@/lib/onboarding';

/**
 * In-app tour for new agents. ~90 seconds end-to-end. Shows once on
 * first sign-in (auto-launch); re-runnable from Settings.
 *
 * Props:
 *   open       — bool
 *   onClose    — () => void
 *   onNavigate — (viewId: string) => void   switch the active tab
 *   onOpenChat — () => void                 open PRIM Assistant
 *   onOpenSmartImport — () => void          open Books → Smart Import wizard
 */
export default function OnboardingWalkthrough({
  open, onClose, onNavigate, onOpenChat, onOpenSmartImport,
}) {
  const [stepIndex, setStepIndex] = useState(0);

  // Resume from saved progress when opening
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const progress = await loadOnboardingProgress();
      if (!alive) return;
      if (!progress) {
        // First-time launch — record the start
        await startOnboarding();
        setStepIndex(0);
      } else {
        // Resume at saved step (clamped to valid range)
        setStepIndex(Math.min(Math.max(0, progress.currentStep || 0), STEPS.length - 1));
      }
    })();
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const goNext = async () => {
    if (isLast) {
      await markCompleted();
      onClose();
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    await markStep(next);
  };

  const goBack = async () => {
    if (isFirst) return;
    const next = stepIndex - 1;
    setStepIndex(next);
    await markStep(next);
  };

  const skipForever = async () => {
    await markSkipped();
    onClose();
  };

  const closeWithProgress = async () => {
    await saveOnboardingProgress({
      currentStep: stepIndex,
      skipped: false,
      completed: false,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    onClose();
  };

  // Each step's primary CTA action — switches view, opens chat, or
  // opens Smart Import wizard, then closes the tour cleanly.
  const handleStepCta = async () => {
    if (!step.cta) return;
    if (step.cta.action === 'navigate' && step.cta.viewId) {
      onNavigate(step.cta.viewId);
      // Mark as completed if we're on the final step (sample upload),
      // otherwise just preserve progress
      if (isLast) {
        await markCompleted();
      } else {
        await saveOnboardingProgress({
          currentStep: stepIndex,
          skipped: false,
          completed: false,
          startedAt: new Date().toISOString(),
          completedAt: null,
        });
      }
      onClose();
    } else if (step.cta.action === 'openChat') {
      await markStep(stepIndex);
      onClose();
      onOpenChat?.();
    } else if (step.cta.action === 'openSmartImport') {
      await markCompleted();
      onClose();
      onOpenSmartImport?.();
    }
  };

  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-gradient-to-r ${step.gradient || 'from-indigo-50 to-violet-50'}`}>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
            <Sparkles size={12} className="text-indigo-600" />
            PRIM Tour
            <span className="text-slate-400 font-normal normal-case">
              · Step {stepIndex + 1} of {STEPS.length}
            </span>
          </div>
          <button
            onClick={closeWithProgress}
            className="text-slate-400 hover:text-slate-700 p-1"
            title="Close (saves your progress)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 min-h-[260px] flex flex-col">
          {/* Icon + tagline */}
          <div className="flex items-start gap-3 mb-3">
            {Icon && (
              <div className={`w-12 h-12 rounded-xl ${step.iconBg || 'bg-indigo-100 text-indigo-700'} flex items-center justify-center flex-shrink-0`}>
                <Icon size={22} />
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900 leading-tight">{step.title}</h2>
              {step.tagline && (
                <p className="text-sm font-semibold text-indigo-700 mt-0.5">{step.tagline}</p>
              )}
            </div>
          </div>

          {/* Body copy */}
          <p className="text-sm text-slate-700 leading-relaxed mb-4">{step.body}</p>

          {/* Optional sub-list */}
          {step.bullets && (
            <ul className="text-sm text-slate-700 space-y-1 mb-4 ml-1">
              {step.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-indigo-500 mt-0.5">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Optional starter prompts (PRIM Assistant step) */}
          {step.examples && (
            <div className="space-y-1.5 mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Try asking:</div>
              {step.examples.map((ex, i) => (
                <div
                  key={i}
                  className="text-xs italic text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5"
                >
                  &ldquo;{ex}&rdquo;
                </div>
              ))}
            </div>
          )}

          {/* Spacer pushes CTA to bottom */}
          <div className="flex-1" />

          {/* CTA */}
          {step.cta && (
            <button
              onClick={handleStepCta}
              className="w-full mt-2 bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl py-2.5 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30"
            >
              {step.cta.label}
              <ArrowRight size={14} />
            </button>
          )}

          {/* Welcome screen secondary action */}
          {step.id === 'welcome' && (
            <button
              onClick={skipForever}
              className="w-full mt-2 text-xs text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline"
            >
              Skip — don&apos;t ask again
            </button>
          )}
        </div>

        {/* Footer — progress dots + back/next */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIndex ? 'w-5 bg-indigo-600' :
                  i < stepIndex ? 'w-1.5 bg-indigo-300' :
                  'w-1.5 bg-slate-300'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={goBack}
              disabled={isFirst}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={12} /> Back
            </button>
            <button
              onClick={goNext}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1"
            >
              {isLast ? 'Done' : 'Next'} <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Step content ----------
// Order matches the nav reorder. Tone: direct, lead with what the agent
// can DO, no marketing words. Each body under 25 words.
const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to PRIM.',
    body: '60-second tour of every tab, then we\'ll try Smart Import on a real file of yours. Skip if you\'ve used PRIM before.',
    icon: Sparkles,
    iconBg: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
    gradient: 'from-indigo-50 to-violet-50',
  },
  {
    id: 'assistant',
    title: 'Meet the PRIM Assistant',
    tagline: 'Bottom-right chat bubble.',
    body: 'Ask anything. It knows the app and can read your data to give specific answers — so help is always one click away while you explore.',
    icon: MessageCircle,
    iconBg: 'bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white',
    gradient: 'from-violet-50 to-fuchsia-50',
    examples: [
      'Why is my Earned different from my statement?',
      'Show me my YTD numbers.',
      'How do I import my book of business?',
    ],
    cta: { label: 'Open the chat', action: 'openChat' },
  },
  {
    id: 'cpa',
    title: 'CPA Dashboard',
    tagline: 'Your top-line view.',
    body: 'True CPA, weekly performance, deal counts. Updates automatically as you log leads and expenses — nothing to maintain.',
    icon: Calculator,
    iconBg: 'bg-emerald-100 text-emerald-700',
    cta: { label: 'Open CPA Dashboard', action: 'navigate', viewId: 'cpa' },
  },
  {
    id: 'closed',
    title: 'Closed Deals',
    tagline: 'Every deal you\'ve submitted.',
    body: 'Stage, product, advance amount, dates — searchable and sortable. Statement matches land your commissions here.',
    icon: CheckSquare,
    iconBg: 'bg-sky-100 text-sky-700',
    cta: { label: 'Open Closed Deals', action: 'navigate', viewId: 'closed' },
  },
  {
    id: 'other-dashboards',
    title: 'Overview · Associations · Pipeline',
    tagline: 'Three quick views.',
    body: 'Three more views for different angles on your book:',
    bullets: [
      'Overview — pipeline value, taken rate, recent activity at a glance.',
      'Associations — who\'s on which plan, when terms end, upcoming renewals.',
      'Pipeline — drag-drop kanban view of leads by stage.',
    ],
    icon: LayoutDashboard,
    iconBg: 'bg-amber-100 text-amber-700',
    cta: { label: 'Open Overview', action: 'navigate', viewId: 'dashboard' },
  },
  {
    id: 'leads',
    title: 'Leads',
    tagline: 'All your closed deals.',
    body: 'Filter by stage, product family, age bucket, or month. Bulk select to delete, change stage, or re-categorize multiple at once.',
    icon: Users,
    iconBg: 'bg-blue-100 text-blue-700',
    cta: { label: 'Open Leads', action: 'navigate', viewId: 'leads' },
  },
  {
    id: 'prospects',
    title: 'Prospects',
    tagline: 'Pre-deal pipeline.',
    body: 'Track appointments and follow-ups before deals close. Compact calendar widget shows the month at a glance. Color-code by lead source.',
    icon: UserPlus,
    iconBg: 'bg-violet-100 text-violet-700',
    cta: { label: 'Open Prospects', action: 'navigate', viewId: 'prospects' },
  },
  {
    id: 'platforms',
    title: 'Platforms',
    tagline: 'Ringy · TextDrip · VanillaSoft.',
    body: 'Tracked separately from Books because they feed your True CPA calculation. Drop a Ringy billing CSV and Smart Import auto-files it here.',
    icon: DollarSign,
    iconBg: 'bg-rose-100 text-rose-700',
    cta: { label: 'Open Platforms', action: 'navigate', viewId: 'platforms' },
  },
  {
    id: 'books',
    title: 'Books',
    tagline: 'Your full business P&L.',
    body: 'Income, expenses, custom categories. Smart Import (AI) lives here — drop any bank statement (PDF, CSV, Excel, multiple files at once) and AI parses every line.',
    icon: BookOpen,
    iconBg: 'bg-indigo-100 text-indigo-700',
    cta: { label: 'Open Books', action: 'navigate', viewId: 'books' },
  },
  {
    id: 'calculator',
    title: 'Calculator',
    tagline: 'Tier-aware commission calculator.',
    body: 'Pick the product + state, see WA / CA / FTA / FSL rates side by side. Includes Accident, Income, and Life Protector — rates current to April 2026.',
    icon: Calculator,
    iconBg: 'bg-purple-100 text-purple-700',
    cta: { label: 'Open Calculator', action: 'navigate', viewId: 'calculator' },
  },
  {
    id: 'upload',
    title: 'Upload',
    tagline: 'Statements + bulk imports.',
    body: 'Drop USHA weekly advance statements or monthly payouts. PRIM auto-matches every commission row to the right closed deal — even when USHA pays under a spouse\'s name.',
    icon: Upload,
    iconBg: 'bg-cyan-100 text-cyan-700',
    cta: { label: 'Open Upload', action: 'navigate', viewId: 'upload' },
  },
  {
    id: 'try-it',
    title: 'You\'re set. Try Smart Import on a real file?',
    tagline: 'The magic moment.',
    body: 'Drop your existing tracker — Excel, PDF, USHA portal export, even a screenshot. The wizard runs in preview mode so nothing saves until you confirm.',
    icon: Sparkles,
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
    gradient: 'from-emerald-50 to-teal-50',
    cta: { label: 'Open Books → Smart Import', action: 'openSmartImport' },
  },
];

export const ONBOARDING_STEP_COUNT = STEPS.length;
