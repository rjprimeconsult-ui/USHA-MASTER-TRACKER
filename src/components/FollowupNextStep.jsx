'use client';
import { Copy, Check, Clock, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { playbookForStage, dueStatus } from '@/lib/followupEngine.mjs';

const STATE_STYLE = {
  overdue:   { cls: 'border-rose-200 bg-rose-50',    chip: 'bg-rose-100 text-rose-700' },
  due_today: { cls: 'border-amber-200 bg-amber-50',  chip: 'bg-amber-100 text-amber-800' },
  ontrack:   { cls: 'border-indigo-200 bg-indigo-50/40', chip: 'bg-indigo-100 text-indigo-700' },
  snoozed:   { cls: 'border-slate-200 bg-slate-50',  chip: 'bg-slate-100 text-slate-600' },
};

function mergeScript(script, prospect, agentName) {
  const first = (prospect.name || '').trim().split(/\s+/)[0] || 'there';
  const time = prospect.appointmentTime
    ? new Date(prospect.appointmentTime).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : 'our scheduled time';
  return String(script).replace(/{first}/g, first).replace(/{agent}/g, agentName || 'your agent').replace(/{time}/g, time);
}

export default function FollowupNextStep({ prospect, playbook, agentName, onLogTouch, now = new Date().toISOString() }) {
  const [copied, setCopied] = useState(false);
  const steps = playbookForStage(playbook, prospect.stage);
  if (steps.length === 0) return null;

  const status = dueStatus(prospect, now);
  if (status.state === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-sm text-emerald-800">
        <CheckCircle2 size={16} /> Follow-up sequence complete for this stage.
      </div>
    );
  }

  const idx = Math.min(prospect.cadence?.stepIndex || 0, steps.length - 1);
  const step = steps[idx];
  const text = mergeScript(step.script, prospect, agentName);
  const style = STATE_STYLE[status.state] || STATE_STYLE.ontrack;
  const dueLabel = status.state === 'overdue' ? `${status.daysLate}d overdue`
    : status.state === 'due_today' ? 'Due today'
    : status.state === 'snoozed' ? 'Snoozed'
    : status.nextDueAt ? `Due ${new Date(status.nextDueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div className={`rounded-xl border p-3 ${style.cls}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Clock size={14} /> Step {idx + 1} of {steps.length} · {step.channel}
        </div>
        {dueLabel && <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.chip}`}>{dueLabel}</span>}
      </div>
      <div className="text-sm text-slate-700 bg-white/70 border border-white rounded-lg p-2.5 whitespace-pre-wrap">{text}</div>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={copy} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy script'}
        </button>
        <button onClick={onLogTouch} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-sm font-bold">
          Log touch
        </button>
      </div>
    </div>
  );
}
