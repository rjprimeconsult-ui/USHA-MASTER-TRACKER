'use client';
/**
 * Appointment card (spec §7h.1) — the ONLY white surface on the timeline.
 * bg-white (.dark remaps it), bare border-slate-200 / dark:border-slate-700,
 * a 4 px violet left stripe, inset 10 px from the lane's right edge. Nothing
 * else distinguishes it: no icon, no label, no avatar, no stage chip, no bell.
 * Row 1: Held checkbox (violet, disabled before start) + the prospect's name.
 * Row 2 (≥ 44 px): the time range. Nothing more at any height.
 *
 * `compact` = the phone-list row treatment (static, one line, time column).
 */
import { useEffect, useRef, useState } from 'react';
import { formatRange } from '@/lib/routineClock.mjs';
import { heightPx } from '@/lib/routineLayout.mjs';
import { APPT_STRIPE } from './constants';

export default function AppointmentCard({ item, style, onHeld, onOpenProspect, onRemove, onDetach, started = false, compact = false }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const dur = Number.isFinite(item.durationMin) ? item.durationMin : item.endMin - item.startMin;
  const h = heightPx(dur);
  const held = !!item.heldAt;

  // Desktop menu: frozen → Remove from today; attached & not started → Detach (today);
  // derived & not started → none (the stage or time is changed in Prospects).
  const action = item.frozen
    ? { label: 'Remove from today', run: () => onRemove?.(item) }
    : item.source === 'attached' && !started
      ? { label: 'Detach (today)', run: () => onDetach?.(item) }
      : null;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const checkbox = (
    <input
      type="checkbox"
      aria-label="Held"
      disabled={!started}
      checked={held}
      onChange={() => onHeld?.(item)}
      onClick={(e) => e.stopPropagation()}
      className={`h-[18px] w-[18px] shrink-0 accent-violet-600 ${started ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
    />
  );
  const name = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpenProspect?.(item.prospectId); }}
      className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-slate-900"
    >
      {item.name || 'Appointment'}
    </button>
  );

  if (compact) {
    return (
      <div
        className="bg-white border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-3 px-3 py-2.5"
        style={{ ...style, boxShadow: `inset 4px 0 0 ${APPT_STRIPE}` }}
      >
        <div className="w-14 shrink-0 text-[11px] text-slate-500 tabular-nums">{formatRange(item.startMin, item.endMin)}</div>
        {name}
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">{checkbox}</span>
      </div>
    );
  }

  return (
    <div
      className="group absolute left-0 right-[10px] bg-white border border-slate-200 dark:border-slate-700 rounded-lg overflow-visible px-2.5 py-1.5"
      style={{ ...style, boxShadow: `inset 4px 0 0 ${APPT_STRIPE}` }}
    >
      <div className="flex items-center gap-2 pl-1">
        {checkbox}
        {name}
        {action && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              className={`h-5 w-5 rounded text-[12px] font-bold leading-none text-slate-400 hover:text-slate-700 transition-opacity ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
            >
              …
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-6 z-20 min-w-[160px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-1 shadow-xl">
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); action.run(); }}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  {action.label}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {h >= 44 && <div className="pl-1 text-[11px] text-slate-500 tabular-nums">{formatRange(item.startMin, item.endMin)}</div>}
    </div>
  );
}
