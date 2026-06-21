'use client';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, Check } from 'lucide-react';
import { parseDateTimeLocal, composeDateTimeLocal, parseTypedTime } from '@/lib/datetimeField.mjs';

/**
 * Drop-in replacement for `<input type="datetime-local">`.
 *
 * Same contract: `value` / `onChange` speak the native "YYYY-MM-DDTHH:mm"
 * string, so nothing downstream changes. The point of this control is the
 * time half: you can TYPE it (600 -> 6:00, 1230 -> 12:30, 230p -> 2:30 PM,
 * 1400 -> 2:00 PM) for fast keyboard entry, or click an Hour dropdown +
 * quarter-hour buttons (00/15/30/45) + AM/PM. No scroll wheel, so there is
 * nothing to wrap. The date half is a normal native date input.
 */

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const QUARTERS = [0, 15, 30, 45];
const p2 = (n) => String(n).padStart(2, '0');

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

function formatDisplay(value) {
  const { date, hour12, minute, ampm } = parseDateTimeLocal(value);
  if (!date || hour12 == null) return '';
  const [y, mo, d] = date.split('-');
  return `${mo}/${d}/${y} ${hour12}:${p2(minute)} ${ampm}`;
}

export default function DateTimePicker({ value = '', onChange, className = '', disabled = false, id }) {
  const [open, setOpen] = useState(false);
  const [timeText, setTimeText] = useState('');
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const timeRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const parts = parseDateTimeLocal(value);
  const hour12 = parts.hour12 ?? 12;
  const minute = parts.minute ?? 0;
  const ampm = parts.ampm ?? 'PM';
  const date = parts.date;

  // Compose + emit. Picking a time on an empty field defaults the date to today.
  const commit = (next) => {
    const merged = { date, hour12, minute, ampm, ...next };
    if (!merged.date) merged.date = todayISO();
    onChange?.(composeDateTimeLocal(merged));
  };

  // Focus the type-able field when the popover opens (the field is seeded in
  // the trigger's onClick, so no setState happens in an effect).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => timeRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }, [open]);

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

  const onTimeInput = (e) => {
    const raw = e.target.value;
    setTimeText(raw);
    const r = parseTypedTime(raw);
    if (r) commit({ hour12: r.hour12, minute: r.minute, ...(r.ampm ? { ampm: r.ampm } : {}) });
  };
  const onTimeBlur = () => setTimeText(`${hour12}:${p2(minute)}`);
  const pickHour = (h) => { commit({ hour12: h }); setTimeText(`${h}:${p2(minute)}`); };
  const pickMinute = (m) => { commit({ minute: m }); setTimeText(`${hour12}:${p2(m)}`); };

  const display = formatDisplay(value);
  const btn = (active) =>
    `px-3 py-1.5 rounded-lg text-sm font-bold transition border ${active
      ? 'bg-indigo-600 border-indigo-600 text-white'
      : 'bg-slate-100 dark:bg-slate-700 border-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`;

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        disabled={disabled}
        onClick={() => { if (!open) setTimeText(`${hour12}:${p2(minute)}`); setOpen((o) => !o); }}
        className={`${className} flex items-center justify-between gap-2 text-left ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={display ? '' : 'text-slate-400'}>{display || 'mm/dd/yyyy --:-- --'}</span>
        <CalendarClock size={15} className="text-slate-400 shrink-0" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(pos.width, 300), zIndex: 60 }}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl p-3 space-y-3"
        >
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => commit({ date: e.target.value })}
              className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Time — type it (e.g. 600, 915, 230p)</label>
            <div className="flex items-center gap-2">
              <input
                ref={timeRef}
                type="text"
                inputMode="numeric"
                value={timeText}
                onChange={onTimeInput}
                onBlur={onTimeBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false); }}
                placeholder="h:mm"
                className="w-24 border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button type="button" onClick={() => commit({ ampm: 'AM' })} className={btn(ampm === 'AM')}>AM</button>
              <button type="button" onClick={() => commit({ ampm: 'PM' })} className={btn(ampm === 'PM')}>PM</button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Hour</label>
              <select
                value={hour12}
                onChange={(e) => pickHour(Number(e.target.value))}
                className="border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-2 py-2 text-sm"
              >
                {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Minutes</label>
              <div className="flex gap-1.5">
                {QUARTERS.map((m) => (
                  <button key={m} type="button" onClick={() => pickMinute(m)} className={btn(minute === m)}>{p2(m)}</button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg py-2 flex items-center justify-center gap-1.5"
          >
            <Check size={15} /> Done
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
