'use client';
/**
 * One-off event card (rev-11, spec 2026-09-07 §4b/§7h.3, §5 UI). A
 * routine_day_v1 record, never a block — it is structurally incapable of
 * editing the routine template, and it must read that way on screen too:
 * a dashed teal outline (a hex no routine category or the appointment
 * stripe uses) and a bare "Today" tag, never the block category tint and
 * never the appointment white surface. Editing (name, time, duration,
 * reminder) and removal both go through BlockEditorSheet's isEvent branch —
 * there is no drag/resize here on purpose.
 *
 * `compact` = the phone-list row treatment (static, one line, time column),
 * mirroring AppointmentCard's dual-mode split.
 */
import { formatRange } from '@/lib/routineClock.mjs';
import { heightPx } from '@/lib/routineLayout.mjs';

export const EVENT_HEX = '#14b8a6'; // teal — unused by any routine category or the appt stripe (spec §7d)

export default function EventCard({ item, style, onOpen, compact = false }) {
  const dur = Number.isFinite(item.durationMin) ? item.durationMin : item.endMin - item.startMin;
  const h = heightPx(dur);
  const range = formatRange(item.startMin, item.endMin);

  const open = (e) => onOpen?.(item, e.currentTarget.getBoundingClientRect());
  const onKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); open(e); } };
  const label = `${item.name} ${range}`;

  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        data-item-id={item.id}
        onClick={open}
        onKeyDown={onKeyDown}
        className="flex cursor-pointer select-none items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ borderColor: EVENT_HEX, background: `${EVENT_HEX}14` }}
      >
        <div className="w-14 shrink-0 text-[11px] text-slate-500 tabular-nums">{range}</div>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-900">{item.name}</span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: EVENT_HEX }}>Today</span>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-item-id={item.id}
      onClick={open}
      onKeyDown={onKeyDown}
      className="absolute left-0 right-[10px] cursor-pointer select-none overflow-hidden rounded-lg border border-dashed outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ ...style, borderColor: EVENT_HEX, background: `${EVENT_HEX}14` }}
    >
      <div className="flex h-full flex-col overflow-hidden py-1 pl-2.5 pr-2">
        <div className="flex min-h-[20px] items-center gap-1.5">
          <span className="min-w-0 truncate text-[12px] font-medium text-slate-900">{item.name}</span>
          <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: EVENT_HEX }}>Today</span>
        </div>
        {h >= 44 && <div className="text-[11px] text-slate-500 tabular-nums">{range}</div>}
      </div>
    </div>
  );
}
