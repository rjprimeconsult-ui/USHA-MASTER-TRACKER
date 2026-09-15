'use client';
/**
 * Weekly look-back (spec §7h.5). At the very bottom of the page, under a
 * hairline: collapsed every session — "This week · 2h 10m not done" +
 * ChevronRight; expanded = seven 20 px bars on a 44 px band, letters beneath.
 * Nothing else: no tooltips, no numbers.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { FadeIn } from '@/components/motion/MotionPrimitives';
import { formatMinutes } from '@/lib/routineClock.mjs';
import { DAY_LETTERS } from './constants';

const barHeight = (minutes) => Math.max(2, Math.min(44, ((minutes || 0) / 150) * 44));
// Day-key → weekday letter without a zone shift (the key is a calendar date).
const letterFor = (day) => {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return Number.isFinite(d) ? DAY_LETTERS[d] : '';
};

export default function WeeklyLookback({ week }) {
  const [open, setOpen] = useState(false);
  const days = week?.days || [];
  const total = week?.total || 0;
  return (
    <div className="border-t border-slate-200/60 pt-3 mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[12px] font-medium text-slate-500 tabular-nums">This week · {formatMinutes(total)} not done</span>
        <ChevronRight size={14} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <FadeIn y={4} duration={0.3} className="flex h-24 flex-col justify-end">
          <div className="flex h-11 items-end gap-3">
            {days.map((d, i) => (
              <div
                key={d.day || i}
                data-bar
                className={`w-5 rounded-sm ${i === days.length - 1 ? 'bg-slate-400' : 'bg-slate-300 dark:bg-slate-600'}`}
                style={{ height: `${barHeight(d.minutes)}px` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex gap-3">
            {days.map((d, i) => (
              <div key={d.day || i} className="w-5 text-center text-[10px] text-slate-400">{letterFor(d.day)}</div>
            ))}
          </div>
        </FadeIn>
      )}
    </div>
  );
}
