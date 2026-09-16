'use client';
/**
 * "Needs a touch" widget — the single in-app follow-up accountability list.
 * Surfaces prospects whose next follow-up is DUE TODAY or OVERDUE, sorted
 * most-overdue first. Driven by the cadence engine (dueStatus); ANY touch —
 * call, text, or sending an outreach email — advances that one clock and clears
 * the prospect from this list (the separate "emails due" list was retired).
 * Collapsible, matches the CalendarPanel pattern so the top-of-page widgets
 * cluster consistently.
 *
 * Clicking a row fires onOpenProspect(id) so the parent opens that prospect's
 * detail (where the next-step card + Log touch live).
 *
 * Bulk backlog clearing: when the operator has a large pile of overdue rows
 * the list stops being a usable accountability tool. `onBulkCadence(ids,
 * action)` (owned by LeadTracker) lets the header's "Clear N overdue" button
 * snooze or permanently clear every OVERDUE row in one shot — due_today rows
 * are never touched, since today's work is not backlog. Hidden entirely in
 * readOnly (the Team-leader mirror of another user's data) and when the
 * parent doesn't wire the handler up.
 */
import { useMemo, useState } from 'react';
import { PhoneCall, ArrowRight, CheckCircle2, ChevronRight, ChevronDown, X } from 'lucide-react';
import { dueStatus, playbookForStage } from '@/lib/followupEngine.mjs';
import { GlassModal } from '@/components/motion/MotionPrimitives';

export default function FollowupDueWidget({
  prospects = [],
  playbook,
  onOpenProspect,
  onBulkCadence,
  readOnly = false,
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
  const [showBulkModal, setShowBulkModal] = useState(false);

  if (rows.length === 0) return null;

  const showRows = !collapsed;
  const overdueCount = rows.filter(r => r.s.state === 'overdue').length;
  const subtitle = overdueCount > 0
    ? `${overdueCount} overdue · ${rows.length} need a touch`
    : `${rows.length} due today`;

  // Gate: only when the parent actually wants this wired up, only when this
  // isn't the read-only Team-leader mirror, and only when there's a backlog
  // to clear at all.
  const canBulk = !!onBulkCadence && !readOnly && overdueCount > 0;

  const runBulkAction = (action) => {
    const ids = rows.filter(r => r.s.state === 'overdue').map(r => r.p.id);
    onBulkCadence?.(ids, action);
    setShowBulkModal(false);
  };

  const toggleCollapsed = () => setCollapsed(c => !c);

  return (
    <div className="premium-card overflow-hidden">
      {/* Not a real <button> — the "Clear N overdue" control below has to
          live inside this clickable header, and a <button> can't contain
          another <button> (React 19/Next 16 hydration is strict about it).
          role="button" + onKeyDown keeps it keyboard-operable. */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleCollapsed}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(); } }}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition text-left cursor-pointer"
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
          {canBulk && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowBulkModal(true); }}
              className="text-[10px] uppercase tracking-wider bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 px-2 py-0.5 rounded-full font-bold transition"
            >
              Clear {overdueCount} overdue
            </button>
          )}
          {overdueCount > 0
            ? <span className="text-[10px] uppercase tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">{overdueCount} overdue</span>
            : <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">Due today</span>}
          {showRows
            ? <ChevronDown size={16} className="text-slate-400" />
            : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </div>

      {canBulk && (
        <GlassModal open={showBulkModal} onClose={() => setShowBulkModal(false)} maxWidth="max-w-md" className="p-5">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h3 className="font-bold text-slate-900 text-base">
              Clear {overdueCount} overdue follow-up{overdueCount !== 1 ? 's' : ''}?
            </h3>
            <button
              type="button"
              onClick={() => setShowBulkModal(false)}
              className="text-slate-400 hover:text-slate-700 p-1 -m-1 flex-shrink-0"
            >
              <X size={18} />
            </button>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Today&rsquo;s due-today follow-ups aren&rsquo;t touched — this only affects the {overdueCount} that are overdue right now.
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => runBulkAction('snooze7')}
              className="w-full text-left rounded-xl border border-slate-200 hover:bg-slate-50 px-3.5 py-3 transition"
            >
              <div className="flex items-center gap-1.5 font-semibold text-sm text-slate-900">
                <CheckCircle2 size={14} className="text-slate-400" /> Snooze a week
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                They disappear from this list for seven days, then come back. Nothing is lost.
              </div>
            </button>
            <button
              type="button"
              onClick={() => runBulkAction('clear')}
              className="w-full text-left rounded-xl border border-rose-200 hover:bg-rose-50 px-3.5 py-3 transition"
            >
              <div className="font-semibold text-sm text-rose-700">Clear them</div>
              <div className="text-xs text-rose-600/80 mt-0.5">
                They leave the follow-up list for good, and only a stage change will bring them back.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setShowBulkModal(false)}
              className="w-full text-center rounded-xl px-3.5 py-2 text-sm text-slate-500 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
          </div>
        </GlassModal>
      )}

      {showRows && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map(({ p, s }) => {
            const steps = playbook ? playbookForStage(playbook, p.stage) : [];
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
