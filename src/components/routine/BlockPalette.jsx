'use client';
/**
 * Block palette (spec §7d): ten chips (icon + name). Hover shows the why-line
 * (title attr + one shared 11 px line under the row, so nothing jumps). Click →
 * onAdd(paletteId); drag → dataTransfer 'text/prim-palette' for the timeline.
 */
import { useState } from 'react';
import { PALETTE } from '@/lib/routinePalette.mjs';
import { ICONS } from './constants';

export default function BlockPalette({ onAdd, onDragStart, className = '' }) {
  const [hover, setHover] = useState(null);
  const why = hover ? PALETTE.find((p) => p.id === hover)?.why : '';
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((p) => {
          const Icon = ICONS[p.icon] || ICONS.Plus;
          return (
            <button
              key={p.id}
              type="button"
              title={p.why}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/prim-palette', p.id);
                e.dataTransfer.effectAllowed = 'copy';
                onDragStart?.(p.id);
              }}
              onDragEnd={() => onDragStart?.(null)}
              onClick={() => onAdd?.(p.id)}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
              onFocus={() => setHover(p.id)}
              onBlur={() => setHover((h) => (h === p.id ? null : h))}
              className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50 active:cursor-grabbing"
            >
              <Icon size={14} style={{ color: p.hex }} aria-hidden="true" />
              {p.name}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 min-h-[16px] text-[11px] text-slate-500" aria-live="polite">{why}</div>
    </div>
  );
}
