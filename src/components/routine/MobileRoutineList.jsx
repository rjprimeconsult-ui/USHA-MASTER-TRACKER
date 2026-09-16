'use client';
/**
 * Phone list (spec §7f, < 640 px). Rows = 4 px category stripe, time column,
 * title, Bell + lead, a 28 px right-thumb checkbox; a rose "now" divider before
 * the first item after now; the follow-up row carries "14 due" in its time
 * column (tap the count → the sheet, tap the title → the editor); the
 * appointment row is the white treatment with the Held checkbox and no visible
 * text; a shortened row shows "−30m" (the only amber) in its time column.
 * "+ Add block" FAB → the palette sheet. Long-press (500 ms) → an action sheet:
 * routine rows → Skip today / Delete; make-ups → Remove; attached-not-started →
 * Detach (today); frozen → Remove from today; derived-not-started → none.
 *
 * Rows deliberately keep the default touch-action: a long-press must not block
 * the page from scrolling, and a scroll gesture cancels the press (pointercancel).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Plus, X } from 'lucide-react';
import { GlassModal } from '@/components/motion/MotionPrimitives';
import { formatTime, formatRange, formatMinutes } from '@/lib/routineClock.mjs';
import { usePointerDrag } from '@/lib/usePointerDrag';
import { LOSS, tint, paletteFor, leadMinutes } from './constants';
import AppointmentCard from './AppointmentCard';
import EventCard from './EventCard';
import BlockPalette from './BlockPalette';

const LONG_PRESS_MS = 500;
const stop = (e) => e.stopPropagation();
const lookup = (m, k) => (m instanceof Map ? m.get(k) : m?.[k]);

// Long-press via usePointerDrag's start (pointer capture, 4 px threshold cancels)
// plus a 500 ms timer. The timer only ARMS the press; the menu opens from
// pointerup, after the finger lifts — a sheet mounted while the finger is still
// down gets the release click hit-tested onto its overlay (iOS Safari) and closes
// itself. The click that follows a fired press is swallowed once.
function useLongPress(onFire) {
  const timer = useRef(null);
  const fired = useRef(false);
  const fireRef = useRef(onFire);
  useEffect(() => { fireRef.current = onFire; });
  const clear = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
  useEffect(() => clear, [clear]); // unmount clears the timer
  const drag = usePointerDrag({ onStart: clear, onEnd: clear });
  return {
    onPointerDown: (e) => {
      drag.start('press')(e);
      fired.current = false;
      clear();
      timer.current = setTimeout(() => { timer.current = null; fired.current = true; }, LONG_PRESS_MS);
    },
    onPointerMove: drag.handlers.onPointerMove,
    onPointerUp: (e) => {
      clear();
      drag.handlers.onPointerUp(e);
      if (fired.current) fireRef.current?.();
    },
    onPointerCancel: (e) => { clear(); fired.current = false; drag.handlers.onPointerCancel(e); },
    onClickCapture: (e) => { if (fired.current) { fired.current = false; e.preventDefault(); e.stopPropagation(); } },
    onContextMenu: (e) => e.preventDefault(),
  };
}

function BlockRow({ item, tier, visual, marker, followupCount, isDark, onToggle, onOpen, onNames, onMenu }) {
  const press = useLongPress(() => onMenu?.(item));
  const ownerId = item.blockId ?? item.makeupId;
  const pal = paletteFor(item);
  const done = item.done;
  const faded = tier === 'spent' && (done === 'done' || done === 'skipped');
  const opacity = faded ? 0.55 : visual === 'future-done' ? 0.6 : 1;
  const dashed = item.kind === 'makeup' || visual === 'skipped';
  const isFollowup = item.category === 'followup';
  const lead = leadMinutes(item);
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') { e.preventDefault(); onOpen?.(item); }
    else if (e.key === ' ') { e.preventDefault(); onToggle?.(ownerId); }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      data-item-id={item.id}
      {...press}
      onClick={() => onOpen?.(item)}
      onKeyDown={onKeyDown}
      className={`relative flex select-none items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent ${visual === 'current' ? 'ring-1 ring-accent' : ''}`}
      style={{ background: tint(pal.hex, isDark), opacity }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0"
        style={dashed ? { width: 0, borderLeft: `4px dashed ${pal.hex}` } : { width: 4, background: pal.hex }}
      />
      <div className="w-14 shrink-0 text-[11px] leading-tight text-slate-500 tabular-nums">
        <div>{formatTime(item.startMin)}</div>
        {isFollowup && item.isTitle && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onNames?.(); }} onPointerDown={stop} className="font-semibold text-accent">
            {followupCount} due
          </button>
        )}
        {marker && <div className={`${LOSS} font-medium`}>−{formatMinutes(marker.minutes)}</div>}
      </div>
      {item.isTitle ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-medium text-slate-900">{item.name}</span>
              {visual === 'past-unchecked' && <span data-dot className="inline-block h-[6px] w-[6px] shrink-0 rounded-full bg-slate-400" />}
            </div>
            {lead != null && (
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <Bell size={12} aria-hidden="true" />
                <span className="tabular-nums">{lead}</span>
              </div>
            )}
          </div>
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">
            <input
              type="checkbox"
              aria-label="Done"
              className="h-7 w-7 cursor-pointer accent-emerald-500"
              checked={done === 'done'}
              onChange={() => onToggle?.(ownerId)}
              onClick={stop}
              onPointerDown={stop}
            />
          </span>
        </>
      ) : (
        <div className="flex-1 text-[11px] text-slate-500 tabular-nums">{formatRange(item.startMin, item.endMin)}</div>
      )}
    </div>
  );
}

function ApptRow({ item, started, onHeld, onOpenProspect, onMenu }) {
  const hasMenu = item.frozen || (item.source === 'attached' && !started);
  const press = useLongPress(() => { if (hasMenu) onMenu?.(item); });
  return (
    <div {...press} className="select-none">
      <AppointmentCard compact item={item} started={started} onHeld={onHeld} onOpenProspect={onOpenProspect} />
    </div>
  );
}

// rev-11 (spec 2026-09-07 §5): a one-off, today-only routine_day_v1 record — never a
// block. Tap opens the editor; long-press offers only "Remove event" (menuFor below),
// mirroring the make-up row's single "Remove" action.
function EventRow({ item, onOpen, onMenu }) {
  const press = useLongPress(() => onMenu?.(item));
  return (
    <div {...press} className="select-none">
      <EventCard compact item={item} onOpen={onOpen} />
    </div>
  );
}

function NowDivider({ nowMin }) {
  return (
    <div className="flex items-center gap-2 py-0.5" aria-hidden="true">
      <span className="text-[10px] font-semibold text-rose-500 tabular-nums">{formatTime(nowMin)}</span>
      <span className="h-[2px] flex-1 rounded-full bg-rose-500" />
    </div>
  );
}

function menuFor(item, started) {
  if (item.kind === 'appt') {
    if (item.frozen) return [{ id: 'removeAppt', label: 'Remove from today', danger: true }];
    if (item.source === 'attached' && !started) return [{ id: 'detach', label: 'Detach (today)' }];
    return [];
  }
  if (item.kind === 'makeup') return [{ id: 'removeMakeup', label: 'Remove', danger: true }];
  if (item.kind === 'event') return [{ id: 'removeEvent', label: 'Remove event', danger: true }];
  return [{ id: 'skip', label: 'Skip today' }, { id: 'delete', label: 'Delete', danger: true }];
}

export default function MobileRoutineList({
  items = [], markers = [], tiers = {}, visuals = {}, followup = { rows: [], count: 0 }, nowMin = 0, isDark = false,
  onToggle, onOpen, onNames, onHeld, onOpenProspect, onAdd, onLongPress,
  onSkipToday, onDelete, onRemoveMakeup, onRemoveEvent, onDetach, onRemoveAppt, startedOf,
}) {
  const [menuItem, setMenuItem] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const isStarted = (it) => (typeof startedOf === 'function' ? !!startedOf(it) : !!it.frozen || it.startMin <= nowMin);
  const openMenu = (item) => { onLongPress?.(item); setMenuItem(item); };
  const run = (id) => {
    const it = menuItem; setMenuItem(null);
    if (!it) return;
    if (id === 'skip') onSkipToday?.(it);
    else if (id === 'delete') onDelete?.(it);
    else if (id === 'removeMakeup') onRemoveMakeup?.(it);
    else if (id === 'removeEvent') onRemoveEvent?.(it);
    else if (id === 'detach') onDetach?.(it);
    else if (id === 'removeAppt') onRemoveAppt?.(it);
  };

  const dividerBefore = items.findIndex((it) => it.startMin > nowMin);
  const rows = [];
  items.forEach((it, i) => {
    if (i === dividerBefore) rows.push(<NowDivider key="now" nowMin={nowMin} />);
    if (it.kind === 'appt') {
      rows.push(<ApptRow key={it.id} item={it} started={isStarted(it)} onHeld={onHeld} onOpenProspect={onOpenProspect} onMenu={openMenu} />);
      return;
    }
    if (it.kind === 'event') {
      rows.push(<EventRow key={it.id} item={it} onOpen={onOpen} onMenu={openMenu} />);
      return;
    }
    const ownerId = it.blockId ?? it.makeupId;
    rows.push(
      <BlockRow
        key={it.id}
        item={it}
        tier={lookup(tiers, ownerId) || 'full'}
        visual={lookup(visuals, ownerId) || 'future'}
        marker={markers.find((m) => m.blockId === ownerId && m.segmentIndex === it.index) || null}
        followupCount={followup?.count ?? (followup?.rows || []).length}
        isDark={isDark}
        onToggle={onToggle}
        onOpen={onOpen}
        onNames={onNames}
        onMenu={openMenu}
      />,
    );
  });
  if (dividerBefore === -1 && items.length > 0) rows.push(<NowDivider key="now" nowMin={nowMin} />);

  const menu = menuItem ? menuFor(menuItem, isStarted(menuItem)) : [];

  return (
    <div className="pb-20">
      {items.length === 0
        ? <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-4 py-8 text-center text-[12px] text-slate-500">Nothing on the routine today.</div>
        : <div className="space-y-1.5">{rows}</div>}

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="fixed bottom-5 right-4 z-40 inline-flex h-11 items-center gap-1.5 rounded-full bg-accent-gradient px-4 text-[13px] font-semibold text-white shadow-accent"
      >
        <Plus size={16} aria-hidden="true" /> Add block
      </button>

      {paletteOpen && (
        <GlassModal open onClose={() => setPaletteOpen(false)} maxWidth="sm:max-w-md" zIndexClass="z-[70]" sheet>
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Add a block</h3>
            <button type="button" onClick={() => setPaletteOpen(false)} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <div className="p-4">
            <BlockPalette onAdd={(id) => { onAdd?.(id); setPaletteOpen(false); }} />
          </div>
        </GlassModal>
      )}

      {menuItem && menu.length > 0 && (
        <GlassModal open onClose={() => setMenuItem(null)} maxWidth="sm:max-w-sm" zIndexClass="z-[70]" sheet>
          <div className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">{menuItem.name}</div>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {menu.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => run(m.id)}
                className={`w-full px-4 py-3 text-left text-sm font-medium transition hover:bg-slate-50 ${m.danger ? 'text-rose-600' : 'text-slate-700'}`}
              >
                {m.label}
              </button>
            ))}
            <button type="button" onClick={() => setMenuItem(null)} className="w-full px-4 py-3 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50">Cancel</button>
          </div>
        </GlassModal>
      )}
    </div>
  );
}
