'use client';
/**
 * "Needs a touch" widget — the in-app accountability list for the follow-up
 * playbook. Surfaces prospects whose next playbook touch is DUE TODAY or
 * OVERDUE (any channel: call/text/voicemail/etc.), sorted most-overdue first.
 *
 * Distinct from OutreachRemindersWidget, which tracks the automated outreach
 * EMAIL sequence. This one is driven by the cadence engine (dueStatus) and
 * covers manual touches. Collapsible, matches the OutreachRemindersWidget /
 * CalendarPanel pattern so the top-of-page widgets cluster consistently.
 *
 * Clicking a row fires onOpenProspect(id) so the parent opens that prospect's
 * detail (where the next-step card + Log touch live).
 */
import { useMemo, useState } from 'react';
import { PhoneCall, ArrowRight, CheckCircle2, ChevronRight, ChevronDown } from 'lucide-react';
import { dueStatus, playbookForStage } from '@/lib/followupEngine.mjs';

export default function FollowupDueWidget({
  prospects = [],
  playbook,
  onOpenProspect,
  defaultCollapsed = true,
}) {
  const rows = useMemo(() => {
    const now = new Date().toISOString();
    return (prospects || [])
      .filter(p => !p.archivedAt && !['SOLD', 'LOST'].includes(p.stage))
      .map(p => ({ p, s: dueStatus(p, now) }))
      .filter(x => x.s.state === 'overdue' || x.s.state === 'due_today')
      .sort((a, b) => {
        // overdue before due_today, then most days late first
        if (a.s.state !== b.s.state) return a.s.state === 'overdue' ? -1 : 1;
        return (b.s.daysLate || 0) - (a.s.daysLate || 0);
      });
  }, [prospects]);

  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (rows.length === 0) return null;

  const showRows = !collapsed;
  const overdueCount = rows.filter(r => r.s.state === 'overdue').length;
  const subtitle = overdueCount > 0
    ? `${overdueCount} overdue · ${rows.length} need a touch`
    : `${rows.length} due today`;

  return (
    <div className="premium-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition text-left"
        aria-expanded={showRows}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center text-white flex-shrink-0">
            <PhoneCall size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 leading-tight truncate">Needs a touch</div>
            <div className="text-[11px] text-slate-500 leading-tight truncate">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {overdueCount > 0
            ? <span className="text-[10px] uppercase tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">{overdueCount} overdue</span>
            : <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">Due today</span>}
          {showRows
            ? <ChevronDown size={16} className="text-slate-400" />
            : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </button>

      {showRows && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map(({ p, s }) => {
            const steps = playbookForStage(playbook, p.stage);
            const idx = Math.min(p.cadence?.stepIndex || 0, Math.max(steps.length - 1, 0));
            const channel = steps[idx]?.channel;
            const chip = s.state === 'overdue'
              ? { label: `${s.daysLate}d overdue`, cls: 'bg-rose-50 text-rose-700 border-rose-200' }
              : { label: 'Due today', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProspect?.(p.id)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 transition hover:bg-rose-50/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold text-sm text-slate-900 truncate">{p.name || '(no name)'}</div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${chip.cls}`}>
                      {chip.label}
                    </span>
                  </div>
                  {channel && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Next: <span className="font-semibold text-slate-700">{channel}</span>
                    </div>
                  )}
                </div>
                <ArrowRight size={14} className="text-slate-400 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
