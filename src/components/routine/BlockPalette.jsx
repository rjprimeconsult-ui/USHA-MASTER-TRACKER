'use client';
/**
 * Block palette (spec §7d; rev-11 §5 adds the Event chip). Ten category chips
 * (icon + name) + one visually distinct "Event (today)" chip. Hover shows the
 * why-line (title attr + one shared 11 px line under the row, so nothing
 * jumps). Click → onAdd(paletteId); drag → dataTransfer 'text/prim-palette'
 * for the timeline.
 *
 * The Event chip shares the exact same click/onAdd and drag/dataTransfer
 * wiring as a category chip, carrying the reserved id `'event'` — never a
 * real PALETTE id — so Timeline's existing drop handling needs no changes at
 * all; RoutineView branches on that one sentinel to place the event AT the
 * pointed-at minute instead of running it through nearestFit. It is styled
 * and labeled differently on purpose: a block is the recurring template, an
 * event is today only, and the two must never look interchangeable.
 */
import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { PALETTE } from '@/lib/routinePalette.mjs';
import { ICONS } from './constants';

export const EVENT_PALETTE_ID = 'event';
const EVENT_WHY = 'Today only — added on top of whatever is already there. Never edits your routine template.';
const EVENT_HEX = '#14b8a6';

export default function BlockPalette({ onAdd, onDragStart, className = '' }) {
  const [hover, setHover] = useState(null);
  const why = hover === EVENT_PALETTE_ID ? EVENT_WHY : hover ? PALETTE.find((p) => p.id === hover)?.why : '';
  const hoverHandlers = (id) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover((h) => (h === id ? null : h)),
    onFocus: () => setHover(id),
    onBlur: () => setHover((h) => (h === id ? null : h)),
  });
  const dragHandlers = (id) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/prim-palette', id);
      e.dataTransfer.effectAllowed = 'copy';
      onDragStart?.(id);
    },
    onDragEnd: () => onDragStart?.(null),
  });
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETTE.map((p) => {
          const Icon = ICONS[p.icon] || ICONS.Plus;
          return (
            <button
              key={p.id}
              type="button"
              title={p.why}
              {...dragHandlers(p.id)}
              onClick={() => onAdd?.(p.id)}
              {...hoverHandlers(p.id)}
              className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50 active:cursor-grabbing"
            >
              <Icon size={14} style={{ color: p.hex }} aria-hidden="true" />
              {p.name}
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
        <button
          type="button"
          title={EVENT_WHY}
          {...dragHandlers(EVENT_PALETTE_ID)}
          onClick={() => onAdd?.(EVENT_PALETTE_ID)}
          {...hoverHandlers(EVENT_PALETTE_ID)}
          className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] font-semibold transition hover:opacity-80 active:cursor-grabbing"
          style={{ borderColor: EVENT_HEX, color: EVENT_HEX, background: `${EVENT_HEX}14` }}
        >
          <CalendarClock size={14} aria-hidden="true" />
          Event (today)
        </button>
      </div>
      <div className="mt-1.5 min-h-[16px] text-[11px] text-slate-500" aria-live="polite">{why}</div>
    </div>
  );
}
