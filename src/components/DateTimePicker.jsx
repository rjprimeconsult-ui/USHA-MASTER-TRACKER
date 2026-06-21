'use client';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { parseDateTimeLocal, composeDateTimeLocal, clampIndex } from '@/lib/datetimeField.mjs';

/**
 * Drop-in replacement for `<input type="datetime-local">`.
 *
 * Same contract: `value` and `onChange` speak the native "YYYY-MM-DDTHH:mm"
 * string, so nothing downstream changes. The difference is the time half:
 * Hour (1-12) / Minute (00-59) / AM-PM are CLAMPING columns — scrolling or
 * stepping past an end STOPS instead of wrapping (59 never rolls to 00, 12
 * never rolls to 1), which is the whole reason this exists. The date half is
 * a normal native date input (date pickers never had the wrap problem).
 */

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);   // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i);     // 0..59
const MERIDIEM = ['AM', 'PM'];
const p2 = (n) => String(n).padStart(2, '0');

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

// Human label for the trigger button.
function formatDisplay(value) {
  const { date, hour12, minute, ampm } = parseDateTimeLocal(value);
  if (!date || hour12 == null) return '';
  const [y, mo, d] = date.split('-');
  return `${mo}/${d}/${y} ${hour12}:${p2(minute)} ${ampm}`;
}

export default function DateTimePicker({ value = '', onChange, className = '', disabled = false, id }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const parts = parseDateTimeLocal(value);
  // Working defaults when the field is empty — shown highlighted but not
  // committed until the user actually picks something.
  const hour12 = parts.hour12 ?? 12;
  const minute = parts.minute ?? 0;
  const ampm = parts.ampm ?? 'PM';
  const date = parts.date;

  // Emit a new value. Picking a time on an empty field defaults the date to
  // today so the result is a complete, valid datetime.
  const emit = (next) => {
    const merged = { date, hour12, minute, ampm, ...next };
    if (!merged.date && (next.hour12 != null || next.minute != null || next.ampm != null)) {
      merged.date = todayISO();
    }
    onChange?.(composeDateTimeLocal(merged));
  };

  const setDate = (d) => onChange?.(composeDateTimeLocal({ date: d, hour12, minute, ampm }));
  const setHour = (h) => emit({ hour12: HOURS[clampIndex(HOURS.indexOf(h), HOURS.length)] });
  const setMinute = (m) => emit({ minute: MINUTES[clampIndex(MINUTES.indexOf(m), MINUTES.length)] });
  const setMeridiem = (a) => emit({ ampm: a });
  const stepHour = (dir) => emit({ hour12: HOURS[clampIndex(HOURS.indexOf(hour12) + dir, HOURS.length)] });
  const stepMinute = (dir) => emit({ minute: MINUTES[clampIndex(MINUTES.indexOf(minute) + dir, MINUTES.length)] });

  // Position the popover under the trigger.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const display = formatDisplay(value);

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`${className} flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={display ? '' : 'text-slate-400'}>{display || 'mm/dd/yyyy --:-- --'}</span>
        <CalendarClock size={15} className="text-slate-400 shrink-0" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 300), zIndex: 60 }}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl p-3"
        >
          {/* Date — native (no wrap problem) */}
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
          />

          {/* Time — custom clamping columns */}
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Time</label>
          <div className="flex items-stretch gap-2">
            <Column label="Hour" items={HOURS} render={(h) => h} selected={hour12} onPick={setHour} onStep={stepHour} />
            <span className="self-center text-lg font-bold text-slate-400 pt-4">:</span>
            <Column label="Min" items={MINUTES} render={(m) => p2(m)} selected={minute} onPick={setMinute} onStep={stepMinute} />
            <div className="flex flex-col justify-center gap-1 pl-1">
              {MERIDIEM.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setMeridiem(a)}
                  className={`px-3 py-2 rounded-lg text-sm font-bold transition ${ampm === a ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg py-2 flex items-center justify-center gap-1.5"
          >
            <Check size={15} /> Done
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

// A single clamping column: ▲ stepper, a scrollable list of clickable items
// (scroll/step both STOP at the ends — never wrap), ▼ stepper.
function Column({ label, items, render, selected, onPick, onStep }) {
  const listRef = useRef(null);
  const selRef = useRef(null);

  // Keep the selected item centered when it changes / on open.
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'center' });
  }, [selected]);

  return (
    <div className="flex flex-col items-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</div>
      <button type="button" onClick={() => onStep(-1)} className="text-slate-400 hover:text-indigo-600 py-0.5" aria-label={`${label} up`}>
        <ChevronUp size={16} />
      </button>
      <div
        ref={listRef}
        className="h-32 w-14 overflow-y-auto snap-y snap-mandatory rounded-lg bg-slate-50 dark:bg-slate-900/40 [scrollbar-width:thin]"
      >
        {items.map((it) => {
          const isSel = it === selected;
          return (
            <button
              key={it}
              type="button"
              ref={isSel ? selRef : null}
              onClick={() => onPick(it)}
              className={`snap-center block w-full h-9 text-sm font-semibold transition ${isSel ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
            >
              {render(it)}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => onStep(1)} className="text-slate-400 hover:text-indigo-600 py-0.5" aria-label={`${label} down`}>
        <ChevronDown size={16} />
      </button>
    </div>
  );
}
