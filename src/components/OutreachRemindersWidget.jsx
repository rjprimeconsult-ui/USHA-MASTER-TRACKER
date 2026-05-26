'use client';
/**
 * Outreach reminders widget — small box that surfaces prospects whose
 * next outreach email is due. Designed to live on both the main
 * Dashboard (above KPIs) and on the Prospects view (above the
 * kanban) without modification — the parent decides how big it is
 * via the `compact` prop.
 *
 * Beta-gated to the post_sale_emails allowlist same as the rest of
 * the outreach feature — non-beta users see nothing.
 *
 * Behavior: COLLAPSIBLE — click the header to expand / collapse the
 * list of reminder rows. Defaults to collapsed so the surface above
 * the kanban / dashboard stays compact. Matches the visual pattern
 * of the Prospects view CalendarPanel right below it.
 *
 * Clicking a row fires `onOpenProspect(prospectId)` so the parent
 * can navigate to the Prospects view and open the matching
 * prospect's detail modal (where the Send button is wired with the
 * next-template auto-selected).
 */
import { useMemo, useState } from 'react';
import { Mail, Clock, ArrowRight, CheckCircle2, ChevronRight, ChevronDown } from 'lucide-react';
import { getOutreachReminders } from '@/lib/outreachReminders';
import { useBetaFeature } from '@/lib/useBetaFeature';

export default function OutreachRemindersWidget({
  prospects,
  onOpenProspect,
  compact = false,
  title = 'Follow-ups due',
  defaultCollapsed = true,
}) {
  const { canAccess, loading } = useBetaFeature('outreach_emails');

  // Compute reminders BEFORE the early returns so the hook order stays
  // stable across renders (React only complains if the order changes
  // on subsequent renders, but useMemo before conditional return is
  // the safer pattern anyway).
  const due = useMemo(
    () => getOutreachReminders(prospects, { filter: 'due' }),
    [prospects]
  );
  const upcoming = useMemo(
    () => getOutreachReminders(prospects, { filter: 'upcoming' }),
    [prospects]
  );

  // Collapsed by default — first impression is a single line, agents
  // expand only when they want to see the rows. Matches the CalendarPanel
  // pattern used right below this widget on the Prospects view.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (loading || !canAccess) return null;
  if (due.length === 0 && upcoming.length === 0) return null;

  const showRows = !collapsed;
  // Header subtitle reflects the current state: due count if any, else
  // upcoming count. Stays meaningful both collapsed and expanded.
  const subtitle = due.length > 0
    ? `${due.length} ${due.length === 1 ? 'prospect' : 'prospects'} ready for the next email`
    : `${upcoming.length} upcoming — nothing due yet`;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition text-left"
        aria-expanded={showRows}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white flex-shrink-0">
            <Mail size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 leading-tight truncate">{title}</div>
            <div className="text-[11px] text-slate-500 leading-tight truncate">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {due.length === 0 && (
            <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <CheckCircle2 size={10} /> All caught up
            </span>
          )}
          {showRows
            ? <ChevronDown size={16} className="text-slate-400" />
            : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </button>

      {showRows && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {due.map(({ prospect, reminder }) => (
            <ReminderRow
              key={prospect.id}
              prospect={prospect}
              reminder={reminder}
              onOpen={() => onOpenProspect?.(prospect.id)}
              urgent
            />
          ))}
          {!compact && upcoming.slice(0, due.length === 0 ? 4 : 2).map(({ prospect, reminder }) => (
            <ReminderRow
              key={prospect.id}
              prospect={prospect}
              reminder={reminder}
              onOpen={() => onOpenProspect?.(prospect.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderRow({ prospect, reminder, onOpen, urgent }) {
  const { lastSentStep, nextStep, nextTemplate, daysSinceLast, daysUntilDue, status } = reminder;
  const overdue = status === 'due' && daysUntilDue < 0;

  const dueChip = status === 'due'
    ? (overdue
      ? { label: `${Math.abs(daysUntilDue)}d overdue`, cls: 'bg-rose-50 text-rose-700 border-rose-200' }
      : { label: 'Due today', cls: 'bg-amber-50 text-amber-800 border-amber-200' })
    : { label: daysUntilDue === 1 ? 'Due tomorrow' : `Due in ${daysUntilDue}d`, cls: 'bg-slate-50 text-slate-600 border-slate-200' };

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition ${
        urgent ? 'hover:bg-rose-50/40' : 'hover:bg-slate-50'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-sm text-slate-900 truncate">
            {prospect.name || '(no name)'}
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${dueChip.cls}`}>
            {dueChip.label}
          </span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
          <Clock size={10} className="flex-shrink-0" />
          Email {lastSentStep} sent {daysSinceLast === 0 ? 'today' : `${daysSinceLast}d ago`}
          <span className="text-slate-400">·</span>
          Next: <span className="font-semibold text-slate-700">{nextTemplate?.name || `Email ${nextStep}`}</span>
        </div>
      </div>
      <ArrowRight size={14} className="text-slate-400 flex-shrink-0" />
    </button>
  );
}
