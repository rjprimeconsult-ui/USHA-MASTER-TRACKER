'use client';
import { Phone, MessageSquare, Mail, Voicemail, MoreHorizontal, Send, Clock, CheckCircle2 } from 'lucide-react';
import { touchReminderState } from '@/lib/followupEngine.mjs';

const CHANNEL_ICON = { Call: Phone, Text: MessageSquare, Email: Mail, Voicemail, Other: MoreHorizontal };
const OUTCOME_CLS = {
  'Connected': 'bg-emerald-100 text-emerald-700',
  'Booked appt': 'bg-indigo-100 text-indigo-700',
  'Not interested': 'bg-rose-100 text-rose-700',
  'No answer': 'bg-slate-100 text-slate-600',
  'Left VM': 'bg-amber-100 text-amber-800',
  'Other': 'bg-slate-100 text-slate-600',
};

function rel(at) {
  const ms = Date.now() - new Date(at).getTime();
  const d = Math.floor(ms / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Format a reminder datetime as "Today 6:00 PM", "Tomorrow 9:00 AM", or "Jun 12, 2:30 PM".
 */
function fmtReminderWhen(isoAt) {
  if (!isoAt) return '';
  const d = new Date(isoAt);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const atStr = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${tomorrow.getMonth()}-${tomorrow.getDate()}`;

  if (atStr === todayStr) return `Today ${timePart}`;
  if (atStr === tomorrowStr) return `Tomorrow ${timePart}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + timePart;
}

/** Merge manual touches + auto outreach emails into one reverse-chron list. */
export default function FollowupTimeline({ touchLog = [], emailLog = [], onResolveReminder }) {
  const now = new Date().toISOString();

  const items = [
    ...touchLog.map(t => ({ kind: 'touch', at: t.at, id: t.id, channel: t.channel, outcome: t.outcome, note: t.note, reminderAt: t.reminderAt, reminderNote: t.reminderNote, reminderDoneAt: t.reminderDoneAt, _touch: t })),
    ...emailLog.map(e => ({ kind: 'email', at: e.sentAt || e.at, label: e.templateName || e.name || 'Outreach email' })),
  ].filter(i => i.at).sort((a, b) => new Date(b.at) - new Date(a.at));

  if (items.length === 0) return <div className="text-xs text-slate-400 italic">No follow-up activity yet.</div>;

  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        if (it.kind === 'email') {
          return (
            <div key={i} className="flex items-start gap-2 text-sm">
              <div className="w-6 h-6 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0"><Send size={12} /></div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-800">{it.label}</span>
                <span className="text-slate-400"> · sent {rel(it.at)}</span>
              </div>
            </div>
          );
        }
        const Icon = CHANNEL_ICON[it.channel] || MoreHorizontal;
        const reminderState = touchReminderState(it._touch, now);
        const when = fmtReminderWhen(it.reminderAt);
        const noteText = it.reminderNote ? ` · ${it.reminderNote}` : '';

        return (
          <div key={i} className="flex items-start gap-2 text-sm">
            <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0"><Icon size={12} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-slate-800">{it.channel}</span>
                {it.outcome && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${OUTCOME_CLS[it.outcome] || OUTCOME_CLS.Other}`}>{it.outcome}</span>}
                <span className="text-slate-400 text-xs">{rel(it.at)}</span>
              </div>
              {it.note && <div className="text-xs text-slate-500 mt-0.5">{it.note}</div>}

              {/* Reminder line */}
              {reminderState === 'pending' && (
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                  <Clock size={11} className="flex-shrink-0" />
                  <span>Reminder set for {when}{noteText}</span>
                </div>
              )}
              {reminderState === 'due' && (
                <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="flex items-center gap-1 text-amber-700 font-semibold bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    <Clock size={11} className="flex-shrink-0" />
                    Follow up now — was due {when}{noteText}
                  </span>
                  {onResolveReminder && (
                    <button
                      onClick={() => onResolveReminder(it.id)}
                      className="px-2 py-0.5 rounded bg-amber-500 text-white text-[11px] font-bold hover:bg-amber-600 transition"
                    >
                      Done
                    </button>
                  )}
                </div>
              )}
              {reminderState === 'done' && (
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-300">
                  <CheckCircle2 size={11} className="flex-shrink-0" />
                  <span>followed up</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
