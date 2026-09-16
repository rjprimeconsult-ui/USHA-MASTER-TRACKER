'use client';
/**
 * NOW card (spec §7b). Sticky premium-card: category tile left, the phase copy,
 * the primary action right, a 2 px accent progress bar along the bottom edge.
 * ONE 11 px meta line, first match: offer → still open → owed note → yesterday.
 * Below it the reminder strip, first match. No amber anywhere on this card —
 * the loss marker on the timeline is the only amber text on the page.
 */
import { motion } from 'framer-motion';
import { Check, Clock } from 'lucide-react';
import { useIsDark } from '@/lib/useIsDark';
import { formatTime, formatRange, formatMinutes } from '@/lib/routineClock.mjs';
import { tint, paletteFor, leadMinutes, ICONS } from './constants';

const STRIP_COPY = {
  off: 'Reminders are off',
  ios: 'To get reminders on iPhone: tap Share → Add to Home Screen, then open PRIM from there and turn on notifications.',
  denied: 'Reminders are blocked in your browser settings',
  device: 'Reminders are off on this device',
  tz: "PRIM doesn't know your time zone",
  days: 'All days off',
};

// Noun table (spec §7b): all dial → "dial time"; all followup → "follow-up time"; else "routine time".
function nounFor(displacedByBlock, categoryOf) {
  const ids = Object.keys(displacedByBlock || {});
  if (!ids.length || typeof categoryOf !== 'function') return 'routine time';
  const cats = new Set(ids.map((id) => categoryOf(id)));
  if (cats.size === 1 && cats.has('dial')) return 'dial time';
  if (cats.size === 1 && cats.has('followup')) return 'follow-up time';
  return 'routine time';
}

const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export default function NowCard({
  state, nowMin = 0, projected, offer, slot, yesterday, behind: behindProp, strip,
  onDone, onHeld, onAccept, onSkip, onAck, onEnable, onScrollTo, categoryOf, started = true,
}) {
  const isDark = useIsDark();
  const phase = state?.phase || 'dayDone';
  const current = state?.current || null;
  const next = state?.next || null;
  const behind = behindProp ?? state?.behind ?? null;

  const focus = phase === 'now' ? current : next; // the item the tile represents
  const pal = focus ? paletteFor(focus) : null;
  const Icon = pal ? ICONS[pal.icon] || ICONS.Plus : null; // member lookup, not a call — the compiler lint needs a static component
  const focusIsAppt = focus?.kind === 'appt';

  const thenClause = next ? `then ${next.kind === 'appt' ? 'an appointment' : next.name} at ${formatTime(next.startMin)}` : '';
  const lead = leadMinutes(next);
  const reminderClause = next && lead != null ? ` · reminder ${formatTime(next.startMin - lead)}` : '';

  const minutesLeft = current ? Math.max(0, current.endMin - nowMin) : 0;
  const progress = current ? clamp01((nowMin - current.startMin) / (current.endMin - current.startMin)) : 0;
  const currentIsAppt = current?.kind === 'appt';
  // rev-11: a one-off event has no done/skip concept (§4b's shape carries no status field) —
  // it must never render the Done checkbox, which would otherwise write a bogus record keyed
  // `${today}|undefined` (an event item has neither blockId nor makeupId).
  const currentIsEvent = current?.kind === 'event';
  const currentDone = !currentIsAppt && !currentIsEvent && current?.done === 'done';

  // ---- ONE meta line, first match ----
  const unrecovered = projected?.unrecovered || 0;
  let meta = null;
  if (offer?.offerOpen && slot && unrecovered > 0) {
    meta = (
      <>
        <span className="text-slate-500">{formatMinutes(unrecovered)} of {nounFor(projected?.displacedByBlock, categoryOf)} displaced.</span>
        <button type="button" onClick={onAccept} className="font-semibold text-accent">Add {formatRange(slot.startMin, slot.endMin)}</button>
        <span className="text-slate-400">·</span>
        <button type="button" onClick={onSkip} className="text-slate-400 hover:text-slate-600">Skip</button>
      </>
    );
  } else if (behind) {
    meta = (
      <button type="button" onClick={() => onScrollTo?.(behind.blockId)} className="text-slate-500 hover:text-slate-700 text-left">{behind.name} · still open</button>
    );
  } else if (unrecovered > 0) {
    meta = <span className="text-slate-400">{formatMinutes(unrecovered)} owed</span>;
  } else if (yesterday && !yesterday.hidden && yesterday.minutes > 0) {
    meta = (
      <>
        <span className="text-slate-400">Yesterday · {formatMinutes(yesterday.minutes)} of {yesterday.noun || 'routine time'} not done</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onAck}
          className="relative ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[12px] leading-none text-slate-400 hover:text-slate-600 before:absolute before:-inset-3 before:content-[''] sm:before:hidden"
        >
          ×
        </button>
      </>
    );
  }

  const stripCopy = strip ? STRIP_COPY[strip] : null;

  return (
    // `.premium-card` is unlayered CSS with `position: relative`, which beats the
    // `sticky` utility — the inline position is what actually makes it stick.
    <div className="premium-card sticky top-2 z-10 overflow-hidden px-4 py-3" style={{ position: 'sticky' }}>
      <div className="flex items-start gap-3">
        <div
          className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${focusIsAppt ? 'bg-accent-gradient' : ''} ${!focus ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
          style={focus && !focusIsAppt ? { background: tint(pal.hex, isDark), color: pal.hex } : undefined}
          aria-hidden="true"
        >
          {focus && !focusIsAppt && <Icon size={16} />}
          {!focus && (phase === 'dayDone' ? <Check size={16} className="text-slate-400" /> : <Clock size={16} className="text-slate-400" />)}
        </div>

        <div className="flex-1 min-w-0">
          {phase === 'upFirst' && next && (
            // One pinned line (spec §7b): "{name} · starts {time} · reminder {time}" — no label.
            <div className="truncate text-[12px] text-slate-500">
              <span className="text-[14px] font-semibold text-slate-900">{next.name}</span> · starts {formatTime(next.startMin)}{reminderClause}
            </div>
          )}
          {phase === 'now' && current && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <span className="text-accent">NOW</span>
                <span>· {formatRange(current.startMin, current.endMin)}</span>
              </div>
              <div className="text-[14px] font-semibold text-slate-900 truncate">{current.name}</div>
              <div className="text-[11px] text-slate-500">
                {currentDone
                  ? `Done ✓${thenClause ? ` — ${thenClause}` : ''}`
                  : `${minutesLeft} min left${thenClause ? ` · ${thenClause}` : ''}`}
              </div>
            </>
          )}
          {phase === 'free' && (
            <>
              <div className="text-[14px] font-semibold text-slate-900">{next ? `Free until ${formatTime(next.startMin)}` : 'Free'}</div>
              {next && <div className="text-[11px] text-slate-500 truncate">{next.name}{reminderClause}</div>}
            </>
          )}
          {phase === 'dayDone' && (
            <>
              <div className="text-[14px] font-semibold text-slate-900">Day done</div>
              <div className="text-[11px] text-slate-500">Nothing else on the routine today.</div>
            </>
          )}
        </div>

        {phase === 'now' && current && !currentIsAppt && !currentIsEvent && (
          <motion.label
            whileTap={{ scale: 0.88 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="shrink-0 -mr-2 -mt-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center"
          >
            <input
              type="checkbox"
              aria-label="Done"
              className="h-[22px] w-[22px] cursor-pointer accent-emerald-500"
              checked={currentDone}
              onChange={() => onDone?.(current.blockId ?? current.makeupId)}
            />
          </motion.label>
        )}
        {phase === 'now' && current && currentIsAppt && started && (
          <button
            type="button"
            aria-label="Held"
            aria-pressed={!!current.heldAt}
            onClick={() => onHeld?.(current)}
            className={`shrink-0 h-8 rounded-lg px-3 text-[12px] font-semibold transition ${current.heldAt ? 'bg-violet-600 text-white hover:bg-violet-700' : 'border border-slate-200 dark:border-slate-700 text-slate-700 hover:bg-slate-50'}`}
          >
            {current.heldAt ? 'Held ✓' : 'Held'}
          </button>
        )}
        {phase === 'free' && next && (
          <button type="button" onClick={() => onScrollTo?.(next.id)} className="shrink-0 text-[12px] font-semibold text-accent">Start now</button>
        )}
      </div>

      {meta && <div data-meta-line className="mt-2 flex flex-wrap items-center gap-x-1 text-[11px]">{meta}</div>}

      {stripCopy && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
          <span>{stripCopy}</span>
          {strip === 'device' && <button type="button" onClick={onEnable} className="font-semibold text-accent">Enable</button>}
        </div>
      )}

      {phase === 'now' && current && (
        <div className="absolute bottom-0 left-0 h-[2px] bg-accent-gradient transition-[width] duration-700 ease-out" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      )}
    </div>
  );
}
