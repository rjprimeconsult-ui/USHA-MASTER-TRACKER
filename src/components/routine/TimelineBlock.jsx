'use client';
/**
 * One composed segment of a routine block or make-up on the desktop timeline
 * (spec §7c, §7h.2, §7h.3). `role="button"` on a div — never <button>: the
 * global `button:active` scale would shrink it mid-drag.
 *
 * Title segment: row 1 checkbox + title (+ slate dot when past/unchecked) +
 * category icon; row 2 (≥ 44 px, full/compact) time range (+ Bell + lead in
 * full). Every other segment: its own time range + any loss marker. Nothing
 * else, at any tier. The loss marker is the ONLY amber text on the page.
 *
 * Drag: the FIRST segment is the block's move handle; a 6 px handle at the
 * bottom of the LAST segment resizes. Both set touch-action: none (without it
 * the browser fires pointercancel after a few px on touch). Callbacks:
 *   onDrag(item, { dy, done, cancelled })   onResize(item, { dy, done, cancelled })
 *   onKey(item, { kind: 'move'|'resize', delta })   onOpen(item)   onDelete(item)
 *   onToggle(ownerId)   onNames()
 */
import { useRef } from 'react';
import { Bell } from 'lucide-react';
import { formatRange, formatMinutes } from '@/lib/routineClock.mjs';
import { topPx, heightPx } from '@/lib/routineLayout.mjs';
import { usePointerDrag } from '@/lib/usePointerDrag';
import { LOSS, tint, paletteFor, leadMinutes, ICONS } from './constants';

const NAME_ROW_PX = 20;
const stop = (e) => e.stopPropagation();

export default function TimelineBlock({
  item, tier = 'full', visual = 'future', marker = null, followupRows = [], followupCount = 0,
  isDark = false, boundsStart = 360, nowMin = null, dragDy = 0, resizeDy = 0,
  onToggle, onOpen, onDrag, onResize, onKey, onNames, onDelete,
}) {
  const ownerId = item.blockId ?? item.makeupId;
  const isMakeup = item.kind === 'makeup';
  const pal = paletteFor(item);
  const Icon = ICONS[pal.icon] || ICONS.Plus; // member lookup, not a call — the compiler lint needs a static component
  const top = topPx(item.startMin, boundsStart);
  const h = Math.max(heightPx(item.endMin - item.startMin) + (item.isLast ? resizeDy : 0), heightPx(10));
  const done = item.done;
  const faded = tier === 'spent' && (done === 'done' || done === 'skipped');
  const opacity = faded ? 0.55 : visual === 'future-done' ? 0.6 : 1;
  const dashed = isMakeup || visual === 'skipped';
  // The accent ring is drawn on the current segment only — the one containing now.
  const ringed = visual === 'current' && (nowMin == null || (item.startMin <= nowMin && nowMin < item.endMin));
  const isFollowup = item.category === 'followup';
  const lead = leadMinutes(item);
  const range = formatRange(item.startMin, item.endMin);

  // A drag (finished OR cancelled by Escape) is followed by the browser's trailing
  // click. draggedRef is reset on every pointerdown, set once the drag activates,
  // and consumed exactly once by that click — so a cancelled drag never opens the
  // editor and a plain click always does.
  const draggedRef = useRef(false);
  const drag = usePointerDrag({
    onStart: () => { draggedRef.current = true; },
    onMove: ({ mode, dy }) => (mode === 'move' ? onDrag : onResize)?.(item, { dy, done: false, cancelled: false }),
    onEnd: ({ mode, dy, cancelled }) => (mode === 'move' ? onDrag : onResize)?.(item, { dy, done: true, cancelled }),
  });
  const draggable = !!item.isFirst;
  const resizable = !!item.isLast;

  const onRootPointerDown = (e) => {
    draggedRef.current = false;
    if (draggable) drag.start('move')(e);
  };
  const onClick = (e) => {
    if (draggedRef.current) { draggedRef.current = false; return; }
    onOpen?.(item, e.currentTarget.getBoundingClientRect());
  };
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return; // the checkbox and inner buttons handle their own keys
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const sign = e.key === 'ArrowUp' ? -1 : 1;
      const step = e.shiftKey ? 15 : 5;
      onKey?.(item, { kind: e.altKey ? 'resize' : 'move', delta: sign * step });
    } else if (e.key === 'Enter') { e.preventDefault(); onOpen?.(item, e.currentTarget.getBoundingClientRect()); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete?.(item); }
    else if (e.key === ' ') { e.preventDefault(); onToggle?.(ownerId); }
  };

  // Follow-up names (spec §7h.2): full tier only, on the title segment.
  const rows = isFollowup ? followupRows || [] : [];
  const count = isFollowup ? (Number.isFinite(followupCount) ? followupCount : rows.length) : 0;
  const tight = h < 78;
  const shown = isFollowup && tier === 'full' && !tight ? Math.max(0, Math.min(4, Math.floor((h - 58) / NAME_ROW_PX), rows.length)) : 0;
  const countText = isFollowup && tier === 'full' && tight ? `${count} due · oldest ${rows[0]?.age ?? '—'}` : String(count);

  const showRow2 = item.isTitle && tier !== 'spent' && h >= 44;

  const markerEl = marker ? (
    <span className={`${LOSS} shrink-0 text-[11px] font-medium tabular-nums`}>−{formatMinutes(marker.minutes)}</span>
  ) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.name} ${range}`}
      data-item-id={item.id}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={onRootPointerDown}
      {...(draggable || resizable ? drag.handlers : {})}
      className={`absolute left-0 right-0 select-none overflow-hidden rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-accent ${ringed ? 'ring-1 ring-accent' : ''} ${drag.dragging ? 'z-20 shadow-lg cursor-grabbing' : 'cursor-pointer'}`}
      style={{
        top,
        height: h,
        background: tint(pal.hex, isDark),
        opacity,
        transform: dragDy ? `translateY(${dragDy}px)` : undefined,
        touchAction: draggable ? 'none' : undefined,
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0"
        style={dashed ? { width: 0, borderLeft: `3px dashed ${pal.hex}` } : { width: 3, background: pal.hex }}
      />

      {item.isTitle ? (
        <div className="flex h-full flex-col overflow-hidden py-1 pl-3 pr-2">
          <div className="flex min-h-[20px] items-center gap-2">
            <input
              type="checkbox"
              aria-label="Done"
              className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-emerald-500"
              checked={done === 'done'}
              onChange={() => onToggle?.(ownerId)}
              onClick={stop}
              onPointerDown={stop}
            />
            <span className="min-w-0 truncate text-[12px] font-medium text-slate-900">{item.name}</span>
            {visual === 'past-unchecked' && <span data-dot className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-slate-400" />}
            {/* The count opens the names sheet, the way the phone row's "N due" button does
                (MobileRoutineList). Without this, a follow-up block that is neither current nor
                next has no route to its names at all: §7h.2 renders name rows on the `full` tier
                only, and the sheet's other two doors — tapping a name and "+N more" — live inside
                those rows. Stays slate-400 per §7h.2 ("never amber"); only the cursor and the
                hover tint mark it as live. */}
            {isFollowup && (count > 0 ? (
              <button
                type="button"
                aria-label={`Show ${count} follow-up${count === 1 ? '' : 's'}`}
                onClick={(e) => { e.stopPropagation(); onNames?.(); }}
                onPointerDown={stop}
                className="shrink-0 cursor-pointer text-[12px] font-semibold text-slate-400 tabular-nums transition-colors hover:text-accent"
              >
                {countText}
              </button>
            ) : (
              <span className="shrink-0 text-[12px] font-semibold text-slate-400 tabular-nums">{countText}</span>
            ))}
            {markerEl}
            <span className="ml-auto shrink-0" style={{ color: pal.hex }} aria-hidden="true"><Icon size={16} /></span>
          </div>
          {showRow2 && (
            <div className="flex min-h-[16px] items-center gap-1.5 text-[11px] text-slate-500">
              <span className="tabular-nums">{range}</span>
              {tier === 'full' && lead != null && (
                <>
                  <Bell size={12} className="shrink-0" aria-hidden="true" />
                  <span className="tabular-nums">{lead}</span>
                </>
              )}
            </div>
          )}
          {shown > 0 && (
            <div className="mt-0.5">
              {rows.slice(0, shown).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onNames?.(); }}
                  onPointerDown={stop}
                  className="flex h-5 w-full items-center justify-between gap-2 text-left text-[12px] font-medium text-slate-700"
                >
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 text-slate-400 tabular-nums">{r.age}</span>
                </button>
              ))}
              {count > shown && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onNames?.(); }}
                  onPointerDown={stop}
                  className="h-5 text-[11px] text-accent"
                >
                  +{count - shown} more
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 py-1 pl-3 pr-2 text-[11px] text-slate-500">
          <span className="tabular-nums">{range}</span>
          {markerEl}
        </div>
      )}

      {resizable && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => { e.stopPropagation(); draggedRef.current = false; drag.start('resize')(e); }}
          className="absolute bottom-0 left-0 right-0 h-[6px] cursor-ns-resize"
          style={{ touchAction: 'none' }}
        />
      )}
    </div>
  );
}
