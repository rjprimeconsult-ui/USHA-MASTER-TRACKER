'use client';
/**
 * Routine header (spec §7a): title with the section accent, the timezone chip
 * ("CT"), the Bell (= settings.remindersEnabled — device status lives in the
 * NowCard strip, not here), and the settings gear.
 */
import { Bell, BellOff, Settings } from 'lucide-react';

// "America/Chicago" → "CT" (strips the D/S from CDT/CST); unknown zones fall
// back to whatever Intl gives ("GMT+2") or the raw id.
export function tzShortLabel(tz) {
  if (!tz) return '—';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    const s = part?.value || tz;
    return s.replace(/^([A-Z]+)[DS]T$/, '$1T');
  } catch {
    return tz;
  }
}

const iconBtn = 'inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 dark:hover:bg-slate-700';

export default function RoutineHeader({ tzLabel, tz, remindersEnabled = false, onBell, onSettings }) {
  const chip = tzLabel || tzShortLabel(tz);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center"><span className="section-accent" />Routine</h1>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700" title={tz || undefined}>{chip}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-pressed={!!remindersEnabled}
          aria-label={remindersEnabled ? 'Reminders on' : 'Reminders off'}
          title={remindersEnabled ? 'Reminders on' : 'Reminders off'}
          onClick={onBell}
          className={`${iconBtn} ${remindersEnabled ? 'text-accent' : ''}`}
        >
          {remindersEnabled ? <Bell size={18} /> : <BellOff size={18} />}
        </button>
        <button type="button" aria-label="Routine settings" title="Settings" onClick={onSettings} className={iconBtn}>
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
