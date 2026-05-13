'use client';
import { useEffect, useState } from 'react';
import {
  CheckCircle2, Circle, ChevronRight, X, Sparkles, Trophy,
} from 'lucide-react';
import {
  loadSetupChecklistState,
  saveSetupChecklistState,
  deriveTasks,
  computeProgress,
} from '@/lib/setupChecklist';

/**
 * "Getting started" widget rendered at the top of the Dashboard.
 *
 * Shows a small checklist of 5 onboarding tasks, derived from the
 * agent's actual app state (no extra tracking — completion flips
 * automatically when they do the thing). Each incomplete task has a
 * call-to-action that routes them to the right place.
 *
 * Auto-hides when:
 *   - All 5 tasks complete (replaced by a one-line "You're set" hold
 *     for one render, then disappears next mount)
 *   - User clicks "Hide" (sets dismissed=true; persists)
 *   - User's first-run experience was already finished before this
 *     widget existed (i.e. they had data before signup — opt-out)
 *
 * Props:
 *   stats     — { onboardingCompleted, leadsCount, ownAdvancesCount,
 *                 businessExpensesCount, businessIncomeCount,
 *                 issuedLeadsCount }
 *   onAction  — (action: string) => void
 *               Dispatched action strings:
 *                 'openWizard'  — open the FirstRunWizard
 *                 'newLead'     — open the new-lead form
 *                 'goLeads'     — navigate to leads view
 *                 'goUpload'    — navigate to upload view
 *                 'goBooks'     — navigate to books view
 */
export default function SetupChecklist({ stats, onAction }) {
  const [state, setState] = useState({ dismissed: false, dismissedAt: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSetupChecklistState().then(s => {
      if (!alive) return;
      setState(s);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  if (!loaded) return null;
  if (state.dismissed) return null;

  const tasks = deriveTasks(stats || {});
  const progress = computeProgress(tasks);

  // Once everything's done, hide the widget. We don't celebrate inline —
  // the agent has already moved on by the time they hit 5/5.
  if (progress.allComplete) return null;

  const onDismiss = async () => {
    const next = await saveSetupChecklistState({ dismissed: true, dismissedAt: new Date().toISOString() });
    setState(next);
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50 via-violet-50 to-amber-50 border border-indigo-200 rounded-xl p-4 mb-4 relative overflow-hidden">
      {/* Decorative sparkle in the corner */}
      <Sparkles size={48} className="absolute top-2 right-2 text-indigo-200/40 -z-0" />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Trophy size={16} className="text-indigo-600" />
              Getting started
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {progress.done} of {progress.total} done. Knock these out to unlock the full PRIM experience.
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-700 p-1"
            title="Hide checklist"
            aria-label="Hide setup checklist"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="bg-white/60 rounded-full h-2 mb-4 overflow-hidden">
          <div
            className="bg-gradient-to-r from-indigo-600 to-violet-600 h-full transition-all duration-500"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        {/* Task rows */}
        <div className="space-y-1.5">
          {tasks.map(t => (
            <TaskRow key={t.id} task={t} onAction={onAction} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, onAction }) {
  return (
    <div className={`flex items-center gap-3 bg-white/60 rounded-lg p-2.5 border ${task.done ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex-shrink-0">
        {task.done
          ? <CheckCircle2 size={20} className="text-emerald-600" />
          : <Circle size={20} className="text-slate-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-medium text-sm ${task.done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
          {task.label}
        </div>
        {!task.done && task.detail && (
          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{task.detail}</div>
        )}
      </div>
      {!task.done && task.action && (
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button
            onClick={() => onAction?.(task.action)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 whitespace-nowrap"
          >
            {task.actionLabel} <ChevronRight size={11} />
          </button>
          {task.secondary && (
            <button
              onClick={() => onAction?.(task.secondary.action)}
              className="text-[11px] text-indigo-700 hover:text-indigo-900 hover:underline whitespace-nowrap"
            >
              {task.secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
