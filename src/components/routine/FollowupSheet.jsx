'use client';
/**
 * Follow-up queue sheet (spec §7h.2). GlassModal sheet with FollowupDueWidget's
 * row grammar — divide-y, name 14 px/600, secondary "<stage label> · 12d" (or
 * "· appt 10:00" when the prospect still carries a time today), ArrowRight —
 * and nothing else: no "Due today" chip, no "Next:" line, no checkbox per name.
 */
import { ArrowRight, X } from 'lucide-react';
import { GlassModal } from '@/components/motion/MotionPrimitives';
import { formatTime } from '@/lib/routineClock.mjs';

export default function FollowupSheet({ open, rows = [], stageLabelOf, apptTimeOf, onOpenProspect, onClose }) {
  if (!open) return null;
  return (
    <GlassModal open onClose={onClose} maxWidth="sm:max-w-md" zIndexClass="z-[70]" sheet>
      <div className="flex items-center justify-between p-4">
        <h3 className="text-sm font-bold text-slate-900">Follow-up queue · {rows.length} due · by last contact</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100 border-t border-slate-100">
        {rows.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-slate-500">Nothing due right now.</div>}
        {rows.map((r) => {
          const label = (typeof stageLabelOf === 'function' && stageLabelOf(r.stage)) || r.stage || '';
          const appt = typeof apptTimeOf === 'function' ? apptTimeOf(r.id) : null;
          const secondary = Number.isFinite(appt) ? `${label} · appt ${formatTime(appt)}` : `${label} · ${r.age}`;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenProspect?.(r.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 transition hover:bg-slate-50"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-slate-900 truncate">{r.name}</div>
                <div className="text-[11px] text-slate-500">{secondary}</div>
              </div>
              <ArrowRight size={14} className="text-slate-400 shrink-0" />
            </button>
          );
        })}
      </div>
    </GlassModal>
  );
}
