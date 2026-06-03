'use client';
import { Phone, MessageSquare, Mail, Voicemail, MoreHorizontal, Send } from 'lucide-react';

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

/** Merge manual touches + auto outreach emails into one reverse-chron list. */
export default function FollowupTimeline({ touchLog = [], emailLog = [] }) {
  const items = [
    ...touchLog.map(t => ({ kind: 'touch', at: t.at, channel: t.channel, outcome: t.outcome, note: t.note })),
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
