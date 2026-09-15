'use client';
/**
 * Block editor (spec §7f). Desktop: a fixed popover next to the block — portal
 * to document.body, outside-click + Escape close (DateTimePicker's pattern).
 * Phone: GlassModal sheet. Fields: name ≤ 60, palette, start, duration, lead
 * (off/0/5/10/15), note ≤ 200 with the tray hint. `appt` category (not a
 * make-up) → "Attach prospect (today)" native select from attachOptions.
 * Make-up → "Remove make-up" instead of Skip today / Delete. Frozen appointment
 * → only "Remove from today".
 *
 * Text fields (name, note) commit through a 400 ms debounce and flush on close
 * and on unmount; every other field commits immediately via onSave(patch).
 * `anchor` = the opening block's DOMRect (desktop popover placement).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { GlassModal } from '@/components/motion/MotionPrimitives';
import { PALETTE, paletteById, paletteForCategory } from '@/lib/routinePalette.mjs';
import { formatMinutes } from '@/lib/routineClock.mjs';

const DURATIONS = [];
for (let m = 10; m <= 120; m += 5) DURATIONS.push(m);
for (let m = 135; m <= 720; m += 15) DURATIONS.push(m);
const LEADS = [
  { value: 'off', label: 'Off' },
  { value: '0', label: 'At start' },
  { value: '5', label: '5 min before' },
  { value: '10', label: '10 min before' },
  { value: '15', label: '15 min before' },
];
const POP_W = 320;
const p2 = (n) => String(n).padStart(2, '0');
const toHHMM = (min) => `${p2(Math.floor((min || 0) / 60))}:${p2((min || 0) % 60)}`;
const fromHHMM = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';
const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-accent'; // bare bg-white / border-slate-200 — the .dark remap is the house palette
const btnQuiet = 'rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50';
const btnDanger = 'rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/50';

function Popover({ anchor, onClose, children }) {
  const ref = useRef(null);
  // Focus lands on the first field (fallback: first button) once mounted; the
  // element that opened the popover (the block) gets focus back on unmount.
  useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.activeElement : null;
    const el = ref.current;
    const first = el?.querySelector('input, select, textarea') || el?.querySelector('button');
    const t = setTimeout(() => first?.focus(), 0);
    return () => {
      clearTimeout(t);
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const H = el.offsetHeight || 420;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = anchor ? anchor.right + 8 : (vw - POP_W) / 2;
    if (left + POP_W > vw - 8) left = anchor ? anchor.left - POP_W - 8 : vw - POP_W - 8;
    if (left < 8) left = 8;
    let top = anchor ? anchor.top : (vh - H) / 2;
    top = Math.max(8, Math.min(top, vh - H - 8));
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [anchor]);
  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Edit block"
      style={{ position: 'fixed', top: 8, left: 8, width: POP_W, zIndex: 90 }}
      className="bg-white border border-slate-200 rounded-xl shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}

function Editor({
  block, isMakeup, isFrozenAppt, attachOptions = [], defaultMinutesBefore = 5,
  onSave, onDelete, onSkipToday, onAttach, onRemoveMakeup, onRemoveFromToday, onClose, sheet, anchor,
}) {
  const pending = useRef({});
  const timer = useRef(null);
  const saveRef = useRef(onSave);
  useEffect(() => { saveRef.current = onSave; });
  // The time input commits on blur / Enter (never per keystroke — Chrome updates
  // the value per segment while typing). A typed-but-not-blurred value is folded
  // into the close/unmount flush so it is never lost.
  const startDraft = useRef(null);
  const blockStart = useRef(block.startMin);
  useEffect(() => { blockStart.current = block.startMin; });
  const takeStart = useCallback(() => {
    if (startDraft.current == null) return null;
    const m = fromHHMM(startDraft.current);
    startDraft.current = null;
    return m != null && m !== blockStart.current ? m : null;
  }, []);
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current; pending.current = {};
    const m = takeStart();
    if (m != null) p.startMin = m;
    if (Object.keys(p).length) saveRef.current?.(p);
  }, [takeStart]);
  useEffect(() => () => flush(), [flush]); // unmount flushes
  const queueText = (patch) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  };
  const handleClose = useCallback(() => { flush(); onClose?.(); }, [flush, onClose]);

  const [name, setName] = useState(block.name || '');
  const [note, setNote] = useState(block.note || '');
  const [startText, setStartText] = useState(null); // null = not editing → show the block's value
  const commitStart = () => {
    const m = takeStart();
    setStartText(null);
    if (m != null) saveRef.current?.({ startMin: m });
  };
  const pal = paletteById(block.paletteId) || paletteForCategory(block.category);
  const leadValue = block.remind?.enabled === false ? 'off' : String(Number.isFinite(block.remind?.minutesBefore) ? block.remind.minutesBefore : defaultMinutesBefore);
  const durations = DURATIONS.includes(block.durationMin) ? DURATIONS : [...DURATIONS, block.durationMin].sort((a, b) => a - b);
  const groups = [];
  for (const o of attachOptions) {
    let g = groups.find((x) => x.group === o.group);
    if (!g) { g = { group: o.group || 'Other', options: [] }; groups.push(g); }
    g.options.push(o);
  }
  const canAttach = pal.category === 'appt' && !isMakeup;

  let body;
  if (isFrozenAppt) {
    body = (
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Appointment</h3>
          <button type="button" onClick={handleClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <p className="mt-1 text-[12px] text-slate-500">On today&apos;s timeline. Removing it also clears the minutes it displaced.</p>
        <button type="button" onClick={() => { onRemoveFromToday?.(); handleClose(); }} className={`${btnDanger} mt-3 w-full`}>Remove from today</button>
      </div>
    );
  } else {
    body = (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">{isMakeup ? 'Make-up' : 'Edit block'}</h3>
          <button type="button" onClick={handleClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div>
          <label htmlFor={`rb-name-${block.id}`} className={label}>Name</label>
          <input
            id={`rb-name-${block.id}`}
            type="text"
            maxLength={60}
            value={name}
            onChange={(e) => { setName(e.target.value); queueText({ name: e.target.value }); }}
            className={field}
          />
        </div>

        {!isMakeup && (
          <div>
            <label htmlFor={`rb-pal-${block.id}`} className={label}>Type</label>
            <select
              id={`rb-pal-${block.id}`}
              value={pal.id}
              onChange={(e) => { const p = paletteById(e.target.value); if (p) onSave?.({ paletteId: p.id, category: p.category }); }}
              className={field}
            >
              {PALETTE.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`rb-start-${block.id}`} className={label}>Start</label>
            <input
              id={`rb-start-${block.id}`}
              type="time"
              step="300"
              value={startText ?? toHHMM(block.startMin)}
              onChange={(e) => { startDraft.current = e.target.value; setStartText(e.target.value); }}
              onBlur={commitStart}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitStart(); } }}
              className={field}
            />
          </div>
          <div>
            <label htmlFor={`rb-dur-${block.id}`} className={label}>Duration</label>
            <select
              id={`rb-dur-${block.id}`}
              value={block.durationMin}
              onChange={(e) => onSave?.({ durationMin: Number(e.target.value) })}
              className={field}
            >
              {durations.map((d) => <option key={d} value={d}>{formatMinutes(d)}</option>)}
            </select>
          </div>
        </div>

        {/* No per-record lead exists for a make-up (§4b gives it no `remind`): the tick reminds it
            at settings.defaultMinutesBefore, so offering the control would be a dead field. */}
        {!isMakeup && (
        <div>
          <label htmlFor={`rb-lead-${block.id}`} className={label}>Reminder</label>
          <select
            id={`rb-lead-${block.id}`}
            value={leadValue}
            onChange={(e) => {
              const v = e.target.value;
              onSave?.({ remind: v === 'off' ? { enabled: false, minutesBefore: block.remind?.minutesBefore ?? defaultMinutesBefore } : { enabled: true, minutesBefore: Number(v) } });
            }}
            className={field}
          >
            {LEADS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        )}

        <div>
          <label htmlFor={`rb-note-${block.id}`} className={label}>Note</label>
          <textarea
            id={`rb-note-${block.id}`}
            maxLength={200}
            rows={2}
            value={note}
            onChange={(e) => { setNote(e.target.value); queueText({ note: e.target.value }); }}
            className={`${field} resize-none`}
          />
          <div className="mt-1 text-[11px] text-slate-500">keep block names generic — they show in your notification tray</div>
        </div>

        {canAttach && (
          <div>
            <label htmlFor={`rb-attach-${block.id}`} className={label}>Attach prospect (today)</label>
            <select
              id={`rb-attach-${block.id}`}
              value=""
              onChange={(e) => { if (e.target.value) { onAttach?.(e.target.value); handleClose(); } }}
              className={field}
            >
              <option value="">— none —</option>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {isMakeup
            ? <button type="button" onClick={() => { onRemoveMakeup?.(); handleClose(); }} className={btnDanger}>Remove make-up</button>
            : (
              <>
                <button type="button" onClick={() => { onSkipToday?.(); handleClose(); }} className={btnQuiet}>Skip today</button>
                <button type="button" onClick={() => { onDelete?.(); handleClose(); }} className={btnDanger}>Delete</button>
              </>
            )}
        </div>
      </div>
    );
  }

  if (sheet) {
    return (
      <GlassModal open onClose={handleClose} maxWidth="sm:max-w-md" zIndexClass="z-[70]" sheet>
        {body}
      </GlassModal>
    );
  }
  return <Popover anchor={anchor} onClose={handleClose}>{body}</Popover>;
}

export default function BlockEditorSheet({ open, block, ...rest }) {
  if (!open || !block) return null;
  return <Editor key={block.id} block={block} {...rest} />;
}
