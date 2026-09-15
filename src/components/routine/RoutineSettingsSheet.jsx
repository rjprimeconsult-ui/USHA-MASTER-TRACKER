'use client';
/**
 * Routine settings (spec §7a, §4c): timezone (device zone or one of seven
 * manual zones), default lead, active-day chips (index = Date#getDay), the
 * appointment-stages and follow-up-stages checklists, and "Start over from a
 * template". Every change calls onChange(patch) immediately.
 */
import { X } from 'lucide-react';
import { GlassModal } from '@/components/motion/MotionPrimitives';
import { DAY_LETTERS } from './constants';

const ZONES = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
];
const LEADS = [0, 5, 10, 15];
const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };

const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5';
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-accent'; // bare bg-white / border-slate-200 — the .dark remap is the house palette
const seg = (active) => `h-8 rounded-lg px-3 text-[12px] font-semibold transition ${active ? 'bg-accent-gradient text-white' : 'border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50'}`;
const chip = (active) => `h-8 w-8 rounded-full text-[11px] font-semibold transition ${active ? 'bg-accent-gradient text-white' : 'border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50'}`;

function StageChecklist({ id, title, stages, selected, onToggle }) {
  const set = new Set(selected || []);
  return (
    <div>
      <div className={label} id={`${id}-label`}>{title}</div>
      <div role="group" aria-labelledby={`${id}-label`} className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100">
        {(stages || []).length === 0 && <div className="px-3 py-2 text-[12px] text-slate-500">No stages yet.</div>}
        {(stages || []).map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[12px] text-slate-700 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={set.has(s.id)} onChange={() => onToggle(s.id)} />
            <span className="truncate">{s.label || s.id}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function RoutineSettingsSheet({ open, settings, stages = [], onChange, onStartOver, onClose }) {
  if (!open) return null;
  const s = settings || {};
  const manual = s.timezoneMode === 'manual';
  const zoneValue = manual ? (s.timezone || '') : 'auto';
  const zones = manual && s.timezone && !ZONES.some((z) => z.id === s.timezone) ? [...ZONES, { id: s.timezone, label: s.timezone }] : ZONES;
  const days = new Set(Array.isArray(s.activeDays) ? s.activeDays : []);

  const toggleIn = (key, id) => {
    const cur = Array.isArray(s[key]) ? s[key] : [];
    onChange?.({ [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const toggleDay = (d) => {
    const next = days.has(d) ? [...days].filter((x) => x !== d) : [...days, d];
    onChange?.({ activeDays: next.sort((a, b) => a - b) });
  };

  return (
    <GlassModal open onClose={onClose} maxWidth="sm:max-w-md" zIndexClass="z-[70]" sheet>
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <h3 className="text-sm font-bold text-slate-900">Routine settings</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
      </div>
      <div className="max-h-[75vh] space-y-5 overflow-y-auto p-4">
        <div>
          <label htmlFor="rs-tz" className={label}>Time zone</label>
          <select
            id="rs-tz"
            value={zoneValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'auto') onChange?.({ timezoneMode: 'auto', timezone: deviceZone() || s.timezone || null });
              else onChange?.({ timezoneMode: 'manual', timezone: v });
            }}
            className={field}
          >
            <option value="auto">Use device zone</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </div>

        <div>
          <div className={label} id="rs-lead-label">Default reminder</div>
          <div role="radiogroup" aria-labelledby="rs-lead-label" className="flex gap-1.5">
            {LEADS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={s.defaultMinutesBefore === m}
                onClick={() => onChange?.({ defaultMinutesBefore: m })}
                className={seg(s.defaultMinutesBefore === m)}
              >
                {m === 0 ? 'At start' : `${m} min`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className={label} id="rs-days-label">Active days</div>
          <div role="group" aria-labelledby="rs-days-label" className="flex gap-1.5">
            {DAY_LETTERS.map((l, d) => (
              <button key={d} type="button" aria-pressed={days.has(d)} aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]} onClick={() => toggleDay(d)} className={chip(days.has(d))}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <StageChecklist id="rs-appt" title="Appointment stages" stages={stages} selected={s.appointmentStages} onToggle={(id) => toggleIn('appointmentStages', id)} />
        <StageChecklist id="rs-fu" title="Follow-up stages" stages={stages} selected={s.followupStages} onToggle={(id) => toggleIn('followupStages', id)} />

        <div className="border-t border-slate-200/60 dark:border-slate-700/60 pt-4">
          <button type="button" onClick={onStartOver} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Start over from a template
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
