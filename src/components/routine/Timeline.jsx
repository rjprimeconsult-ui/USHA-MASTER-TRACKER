'use client';
/**
 * Desktop timeline (spec §7c, ≥ 640 px). Hour gutter, dashed half-hour rules,
 * a 2 px rose now-line with a time label, auto-scroll on mount so now sits a
 * third of the way down. Renders a TimelineBlock per segment / make-up item and
 * an AppointmentCard per appointment, absolutely positioned in a relative lane.
 *
 * Move / resize commit ONCE at drag end — onMove(ownerId, startMin) /
 * onResize(ownerId, durationMin); the view snaps, clamps, slides to a gap or
 * reverts with its toast. While dragging, every segment of the block ghosts
 * together (translateY / extra height), snapped to 5-minute steps.
 *
 * Click on empty lane → "+ 10:15" pill → onAddAt(minute). Palette drag-in →
 * onAddAt(minute, paletteId). `scrollRequest = { id, n }` scrolls a block into
 * view (NowCard's "Start now" / "still open").
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/routineClock.mjs';
import { PX_PER_MIN, SNAP_MIN, topPx, heightPx, minuteFromPx } from '@/lib/routineLayout.mjs';
import { paletteById } from '@/lib/routinePalette.mjs';
import TimelineBlock from './TimelineBlock';
import AppointmentCard from './AppointmentCard';
import EventCard from './EventCard';

const GUTTER_PX = 48;
const SNAP_PX = SNAP_MIN * PX_PER_MIN;
const snapPx = (px) => Math.round(px / SNAP_PX) * SNAP_PX;
const snapMin = (px) => Math.round(px / PX_PER_MIN / SNAP_MIN) * SNAP_MIN;
const DRAG_TYPE = 'text/prim-palette';
const lookup = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]);

export default function Timeline({
  items = [], markers = [], tiers = {}, visuals = {}, followup = { rows: [], count: 0 }, bounds, nowMin = 0, isDark = false,
  onMove, onResize, onAddAt, onToggle, onOpen, onDelete, onNames, onHeld, onOpenProspect, onRemoveAppt, onDetach,
  startedOf, dragPaletteId = null, scrollRequest = null, maxHeight = 'calc(100vh - 240px)',
}) {
  const b = bounds || { start: 360, end: 1260 };
  const laneH = heightPx(b.end - b.start);
  const scrollRef = useRef(null);
  const laneRef = useRef(null);
  const [drag, setDrag] = useState(null); // { ownerId, mode: 'move'|'resize', dy }
  const [pill, setPill] = useState(null); // { minute }
  const [ghost, setGhost] = useState(null); // { minute, durationMin }

  // Auto-scroll once on mount: now a third of the way down the viewport.
  const initial = useRef({ nowMin, start: b.start });
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    el.scrollTop = Math.max(0, topPx(initial.current.nowMin, initial.current.start) - el.clientHeight / 3);
  }, []);

  useEffect(() => {
    if (!scrollRequest?.id || !laneRef.current) return;
    const id = CSS.escape(String(scrollRequest.id));
    const el = laneRef.current.querySelector(`[data-item-id="${id}"], [data-item-id^="${id}#"]`); // exact id or its segments — never b10 for b1
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, [scrollRequest]);

  useEffect(() => {
    if (!pill) return;
    const onDown = (e) => { if (!e.target.closest?.('[data-add-pill]')) setPill(null); };
    const onKey = (e) => { if (e.key === 'Escape') setPill(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [pill]);

  const ownerOf = (item) => item.blockId ?? item.makeupId;

  const handleDrag = useCallback((item, { dy, done, cancelled }) => {
    const ownerId = item.blockId ?? item.makeupId;
    if (!done) {
      const snapped = snapPx(dy);
      setDrag((prev) => (prev && prev.ownerId === ownerId && prev.mode === 'move' && prev.dy === snapped ? prev : { ownerId, mode: 'move', dy: snapped }));
      return;
    }
    setDrag(null);
    if (cancelled) return;
    const delta = snapMin(dy);
    if (delta) onMove?.(ownerId, (item.block || item.makeup || item).startMin + delta);
  }, [onMove]);

  const handleResize = useCallback((item, { dy, done, cancelled }) => {
    const ownerId = item.blockId ?? item.makeupId;
    if (!done) {
      const snapped = snapPx(dy);
      setDrag((prev) => (prev && prev.ownerId === ownerId && prev.mode === 'resize' && prev.dy === snapped ? prev : { ownerId, mode: 'resize', dy: snapped }));
      return;
    }
    setDrag(null);
    if (cancelled) return;
    const delta = snapMin(dy);
    if (delta) onResize?.(ownerId, Math.max(10, (item.block || item.makeup || item).durationMin + delta));
  }, [onResize]);

  const handleKey = useCallback((item, { kind, delta }) => {
    const ownerId = item.blockId ?? item.makeupId;
    const g = item.block || item.makeup || item;
    if (kind === 'resize') onResize?.(ownerId, Math.max(10, g.durationMin + delta));
    else onMove?.(ownerId, g.startMin + delta);
  }, [onMove, onResize]);

  const minuteAt = (clientY) => {
    const rect = laneRef.current.getBoundingClientRect();
    return minuteFromPx(clientY - rect.top, b.start);
  };
  const onLaneClick = (e) => {
    if (e.target !== laneRef.current) return; // only the empty lane
    const minute = minuteAt(e.clientY);
    setPill((p) => (p && p.minute === minute ? null : { minute }));
  };
  const hasPaletteData = (e) => Array.from(e.dataTransfer?.types || []).includes(DRAG_TYPE);
  const onDragOver = (e) => {
    if (!hasPaletteData(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const minute = minuteAt(e.clientY);
    const durationMin = paletteById(dragPaletteId)?.defaultMin || 30;
    setGhost((g) => (g && g.minute === minute && g.durationMin === durationMin ? g : { minute, durationMin }));
  };
  const onDragLeave = (e) => { if (!laneRef.current?.contains(e.relatedTarget)) setGhost(null); };
  const onDrop = (e) => {
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    setGhost(null);
    if (!id) return;
    e.preventDefault();
    onAddAt?.(minuteAt(e.clientY), id);
  };

  // Hour labels + rules.
  const hours = [];
  for (let m = Math.ceil(b.start / 60) * 60; m <= b.end; m += 60) hours.push(m);
  const halves = [];
  for (let m = Math.ceil(b.start / 30) * 30; m < b.end; m += 30) if (m % 60 !== 0) halves.push(m);
  const showNow = nowMin >= b.start && nowMin <= b.end;
  const nowTop = topPx(nowMin, b.start);

  return (
    <div ref={scrollRef} className="relative overflow-y-auto overscroll-contain rounded-xl" style={{ maxHeight }}>
      <div className="relative flex" style={{ height: laneH + 12 }}>
        <div className="relative shrink-0 select-none" style={{ width: GUTTER_PX }} aria-hidden="true">
          {hours.map((m) => (
            <div key={m} className="absolute right-2 -translate-y-1/2 text-[10px] text-slate-400 tabular-nums" style={{ top: topPx(m, b.start) }}>{formatTime(m)}</div>
          ))}
          {showNow && (
            <div className="absolute right-1 z-10 -translate-y-1/2 rounded bg-rose-500 px-1 py-px text-[10px] font-semibold leading-tight text-white tabular-nums" style={{ top: nowTop }}>{formatTime(nowMin)}</div>
          )}
        </div>

        <div
          ref={laneRef}
          className="relative flex-1 pr-1"
          style={{ height: laneH }}
          onClick={onLaneClick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {hours.map((m) => (
            <div key={m} className="pointer-events-none absolute left-0 right-0 border-t border-slate-200 dark:border-slate-700" style={{ top: topPx(m, b.start) }} />
          ))}
          {halves.map((m) => (
            <div key={m} className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-slate-200/70 dark:border-slate-700/70" style={{ top: topPx(m, b.start) }} />
          ))}

          {items.map((it) => {
            if (it.kind === 'appt') {
              const started = typeof startedOf === 'function' ? !!startedOf(it) : !!it.frozen || it.startMin <= nowMin;
              return (
                <AppointmentCard
                  key={it.id}
                  item={it}
                  started={started}
                  style={{ top: topPx(it.startMin, b.start), height: heightPx(it.endMin - it.startMin), zIndex: 5 }}
                  onHeld={onHeld}
                  onOpenProspect={onOpenProspect}
                  onRemove={onRemoveAppt}
                  onDetach={onDetach}
                />
              );
            }
            if (it.kind === 'event') {
              // rev-11: a one-off, today-only routine_day_v1 record — never a block, so it
              // is never draggable/resizable here; editing goes through the sheet (§5).
              return (
                <EventCard
                  key={it.id}
                  item={it}
                  style={{ top: topPx(it.startMin, b.start), height: heightPx(it.endMin - it.startMin), zIndex: 5 }}
                  onOpen={onOpen}
                />
              );
            }
            const ownerId = ownerOf(it);
            const marker = markers.find((m) => m.blockId === ownerId && m.segmentIndex === it.index) || null;
            const active = drag && drag.ownerId === ownerId;
            return (
              <TimelineBlock
                key={it.id}
                item={it}
                tier={lookup(tiers, ownerId) || 'full'}
                visual={lookup(visuals, ownerId) || 'future'}
                marker={marker}
                followupRows={followup?.rows || []}
                followupCount={followup?.count ?? (followup?.rows || []).length}
                isDark={isDark}
                boundsStart={b.start}
                nowMin={nowMin}
                dragDy={active && drag.mode === 'move' ? drag.dy : 0}
                resizeDy={active && drag.mode === 'resize' ? drag.dy : 0}
                onToggle={onToggle}
                onOpen={onOpen}
                onDelete={onDelete}
                onNames={onNames}
                onDrag={handleDrag}
                onResize={handleResize}
                onKey={handleKey}
              />
            );
          })}

          {ghost && (
            <div
              className="pointer-events-none absolute left-0 right-1 z-20 rounded-lg border-2 border-dashed border-slate-300 bg-slate-100/60 dark:border-slate-600 dark:bg-slate-700/40"
              style={{ top: topPx(ghost.minute, b.start), height: heightPx(ghost.durationMin) }}
            >
              <span className="px-2 text-[11px] font-medium text-slate-500 tabular-nums">{formatTime(ghost.minute)}</span>
            </div>
          )}

          {showNow && (
            <div className="pointer-events-none absolute left-0 right-0 z-10 h-[2px] bg-rose-500" style={{ top: nowTop - 1 }} aria-hidden="true" />
          )}

          {pill && (
            <button
              type="button"
              data-add-pill
              onClick={(e) => { e.stopPropagation(); onAddAt?.(pill.minute); setPill(null); }}
              className="absolute left-2 z-30 -translate-y-1/2 rounded-full bg-accent-gradient px-2.5 py-1 text-[11px] font-semibold text-white shadow-accent"
              style={{ top: topPx(pill.minute, b.start) }}
            >
              + {formatTime(pill.minute)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
