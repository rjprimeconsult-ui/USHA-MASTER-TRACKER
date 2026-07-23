'use client';
/**
 * BlastsView — the "Blasts" tab. Plain Today / last-7-day totals + a table of
 * every Ringy / TextDrip blast, a "Log a blast" form (manual TextDrip entries),
 * per-row edit/delete, and a collapsible setup panel with the step-by-step for
 * getting Ringy blasts to auto-log. Ringy rows come from the blast_counters
 * table (via LeadTracker); manual rows from blast_log_v1.
 */
import { useState, useMemo, useRef } from 'react';
import { Send, Trash2, Pencil, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { splitLeadRange, joinLeadRange } from '@/lib/blastRange.mjs';
import { blastTagOptions } from '@/lib/blastTags.mjs';
import { BLAST_PERIODS, DEFAULT_BLAST_PERIOD, BLAST_PERIOD_LABELS, blastPeriodRange } from '@/lib/blastPeriod.mjs';

// Local-time YYYY-MM-DD for the manual form's default date.
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const EMPTY_FORM = { platform: 'Textdrip', runDate: '', campaignOrTag: '', contacts: '', sendTime: '', rangeStart: '', rangeEnd: '', notes: '' };

const PLATFORM_STYLE = {
  Ringy:    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  Textdrip: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
};

// Bucket a blast by its run date (lenient), falling back to when PRIM received
// it. A date-only run date is parsed as LOCAL midnight so the Today / Last-7-day
// buckets line up with the agent's calendar — new Date('YYYY-MM-DD') is UTC
// midnight, which mis-buckets in western timezones.
function blastDate(b) {
  const raw = String(b?.runDate || '').trim();
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;
  const c = new Date(b?.createdAt);
  return Number.isNaN(c.getTime()) ? null : c;
}
const num = (n) => (Number(n) || 0).toLocaleString();

// True when a blast's run date falls within the selected period range (inclusive).
// range is { start, end } from blastPeriodRange, or null (incomplete custom) -> no match.
function inBlastRange(b, range) {
  if (!range) return false;
  const d = blastDate(b);
  return !!d && d >= range.start && d <= range.end;
}

// Period rollup card: total contacts + blast count + Ringy/TextDrip split.
function RollupCard({ label, t }) {
  return (
    <div className="premium-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{num(t.contacts)}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">contacts · {t.count} {t.count === 1 ? 'blast' : 'blasts'}</div>
      <div className="mt-2 flex gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <span><span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1 align-middle" />Ringy {num(t.ringy.contacts)}</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1 align-middle" />TextDrip {num(t.textdrip.contacts)}</span>
      </div>
    </div>
  );
}

export default function BlastsView({ blasts = [], onDelete, onAdd, onEdit, readOnly = false }) {
  const [showSetup, setShowSetup] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [period, setPeriod] = useState(DEFAULT_BLAST_PERIOD);   // 'today'|'week'|'30d'|'ytd'|'custom'
  const [customStart, setCustomStart] = useState('');           // 'YYYY-MM-DD'
  const [customEnd, setCustomEnd] = useState('');               // 'YYYY-MM-DD'
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);  // null = new; else the row id being edited
  const [editKind, setEditKind] = useState(null);    // 'auto' (Ringy counter) | 'log' (manual/skill)

  // Form lead-range field: raw draft while focused so the user can type a
  // trailing " - " mid-keystroke; canonical joinLeadRange() display when idle
  // (mirrors the MoneyCell focused/draft pattern in MotionPrimitives.jsx).
  const [rangeFocused, setRangeFocused] = useState(false);
  const [rangeDraft, setRangeDraft] = useState('');
  // Inline cell editing in the log table: one cell at a time.
  const [inline, setInline] = useState(null); // { rowId, field: 'range'|'tag'|'notes', draft } | null
  const inlineCancelRef = useRef(false);      // set by Escape so the ensuing blur skips the commit

  const autoEdit = editKind === 'auto';
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const tagOptions = useMemo(() => blastTagOptions(blasts), [blasts]);

  const isInline = (id, field) => !readOnly && inline?.rowId === id && inline?.field === field;
  const startInline = (b, field) => {
    if (readOnly) return;
    inlineCancelRef.current = false;
    setInline({
      rowId: b.id, field,
      draft: field === 'range' ? joinLeadRange(b.rangeStart, b.rangeEnd)
        : field === 'tag' ? (b.campaignOrTag || '')
        : (b.notes || ''),
    });
  };
  // count-safety: send the row's full field set, overriding just the edited one.
  // This field list MUST mirror openEdit()'s form shape (see openEdit below);
  // if a blast field is ever added there, add it here too, or onEdit will blank it.
  const commitInline = (b, changed) => onEdit?.(b.id, {
    platform: b.platform, runDate: b.runDate, campaignOrTag: b.campaignOrTag,
    contacts: String(b.contacts ?? ''), sendTime: b.sendTime || '',
    rangeStart: b.rangeStart || '', rangeEnd: b.rangeEnd || '', notes: b.notes || '',
    ...changed, // { campaignOrTag } | { rangeStart, rangeEnd } | { notes }
  });
  const finishInline = (b) => {
    if (!inline) return;
    const { field, draft } = inline;
    if (field === 'range') {
      // Untouched draft → true no-op. Guards legacy ranges whose stored text
      // itself contains a separator (e.g. "05/01 to 05/31"): re-splitting the
      // joined display would rewrite them on a mere click+blur.
      if (draft === joinLeadRange(b.rangeStart, b.rangeEnd)) return;
      const { start, end } = splitLeadRange(draft);
      if (start !== (b.rangeStart || '') || end !== (b.rangeEnd || '')) commitInline(b, { rangeStart: start, rangeEnd: end });
    } else if (field === 'tag') {
      if (draft !== (b.campaignOrTag || '')) commitInline(b, { campaignOrTag: draft });
    } else if (field === 'notes') {
      if (draft !== (b.notes || '')) commitInline(b, { notes: draft });
    } // value unchanged → no-op: just close the editor, never call onEdit
  };
  const inlineKeyDown = (e) => {
    if (e.key === 'Enter') e.currentTarget.blur(); // blur commits
    else if (e.key === 'Escape') { inlineCancelRef.current = true; e.currentTarget.blur(); } // blur skips commit
  };
  const blurInline = (b) => {
    const cancelled = inlineCancelRef.current;
    inlineCancelRef.current = false;
    if (!cancelled) finishInline(b);
    setInline(null);
  };

  const openNew = () => {
    const wasNew = showForm && !editingId;
    setForm(EMPTY_FORM); setEditingId(null); setEditKind(null); setShowSetup(false);
    setShowForm(!wasNew); // toggle off if already on the new form, else open fresh
  };
  const openEdit = (b) => {
    setForm({
      platform: b.platform || 'Textdrip',
      runDate: b.runDate || '',
      campaignOrTag: b.campaignOrTag || '',
      contacts: String(b.contacts ?? ''),
      sendTime: b.sendTime || '',
      rangeStart: b.rangeStart || '',
      rangeEnd: b.rangeEnd || '',
      notes: b.notes || '',
    });
    setEditingId(b.id);
    setEditKind(b.source === 'auto' ? 'auto' : 'log');
    setShowSetup(false);
    setShowForm(true);
  };
  const closeForm = () => { setForm(EMPTY_FORM); setEditingId(null); setEditKind(null); setShowForm(false); };
  const submitForm = () => {
    const contacts = parseInt(String(form.contacts).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(contacts) || contacts <= 0) return;
    if (editingId) {
      onEdit?.(editingId, { ...form, runDate: form.runDate || todayStr() });
    } else {
      if (!form.platform) return;
      onAdd?.({ ...form, runDate: form.runDate || todayStr() });
    }
    closeForm();
  };

  // The selected period's concrete { start, end } window (null while a custom
  // range is incomplete/invalid).
  const range = useMemo(
    () => blastPeriodRange(period, { customStart, customEnd }),
    [period, customStart, customEnd]
  );

  // Rollup total for the selected period (all zeros when range is null).
  const periodTotals = useMemo(() => {
    const rows = blasts.filter(b => inBlastRange(b, range));
    const by = (plat) => rows.filter(b => !plat || b.platform === plat);
    const sum = (rs) => rs.reduce((s, b) => s + (Number(b.contacts) || 0), 0);
    return {
      contacts: sum(rows), count: rows.length,
      ringy: { contacts: sum(by('Ringy')), count: by('Ringy').length },
      textdrip: { contacts: sum(by('Textdrip')), count: by('Textdrip').length },
    };
  }, [blasts, range]);

  // Blast list: filtered by BOTH the platform pill and the selected period.
  const sorted = useMemo(() => {
    const rows = blasts.filter(b =>
      (platformFilter === 'all' || b.platform === platformFilter) && inBlastRange(b, range)
    );
    return [...rows].sort((a, b) => (blastDate(b)?.getTime() || 0) - (blastDate(a)?.getTime() || 0));
  }, [blasts, platformFilter, range]);

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-4 space-y-4">
      {/* Shared tag suggestions — rendered ONCE; used by the form combobox and inline tag editors */}
      {!readOnly && (
        <datalist id="blast-tags">
          {tagOptions.map(t => <option key={t} value={t} />)}
        </datalist>
      )}
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-violet-600 flex items-center justify-center text-white"><Send size={18} /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight">Blasts</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Every Ringy / TextDrip repurpose, logged automatically.</p>
          </div>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5">
              <Plus size={14} /> Log a blast
            </button>
            <button onClick={() => { setShowSetup(s => !s); closeForm(); }} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1">
              Setup {showSetup ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        )}
      </div>

      {/* Blast form — log a new blast or edit an existing row */}
      {!readOnly && showForm && (
        <div className="premium-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{editingId ? 'Edit blast' : 'Log a blast'}</div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {autoEdit
                ? 'Auto-captured Ringy blast — fix the count, campaign/tag, lead range, or notes. Date & time are set automatically.'
                : 'For TextDrip blasts. Ringy blasts log themselves automatically.'}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Platform</span>
              {editingId ? (
                <input type="text" value={form.platform === 'Textdrip' ? 'TextDrip' : form.platform} disabled className="w-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 dark:text-slate-300 rounded-lg px-2 py-1.5 text-xs opacity-70" />
              ) : (
                <select value={form.platform} onChange={e => setField('platform', e.target.value)} className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs">
                  <option value="Textdrip">TextDrip</option>
                </select>
              )}
            </label>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Date {autoEdit && <span className="font-normal text-slate-400">(auto)</span>}</span>
              <input type="date" value={form.runDate || todayStr()} onChange={e => setField('runDate', e.target.value)} disabled={autoEdit} className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
            </label>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Contacts <span className="text-rose-500">*</span></span>
              <input type="text" inputMode="numeric" value={form.contacts} onChange={e => setField('contacts', e.target.value)} placeholder="2000" className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs" />
            </label>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Send time {autoEdit && <span className="font-normal text-slate-400">(auto)</span>}</span>
              <input type="time" value={form.sendTime} onChange={e => setField('sendTime', e.target.value)} disabled={autoEdit} className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed" />
            </label>
            <label className="col-span-2 text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Campaign / Tag</span>
              <input type="text" list="blast-tags" value={form.campaignOrTag} onChange={e => setField('campaignOrTag', e.target.value)} placeholder="New Aged leads" className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs" />
            </label>
            <label className="col-span-2 text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Lead range</span>
              <input
                type="text"
                value={rangeFocused ? rangeDraft : joinLeadRange(form.rangeStart, form.rangeEnd)}
                onFocus={() => { setRangeDraft(joinLeadRange(form.rangeStart, form.rangeEnd)); setRangeFocused(true); }}
                onChange={e => {
                  const raw = e.target.value;
                  setRangeDraft(raw);
                  const { start, end } = splitLeadRange(raw);
                  setForm(f => ({ ...f, rangeStart: start, rangeEnd: end }));
                }}
                onBlur={() => setRangeFocused(false)}
                placeholder="01/01/2025 → 05/31/2026"
                className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs"
              />
            </label>
            <label className="col-span-2 sm:col-span-4 text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Notes</span>
              <input type="text" value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="optional" className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs" />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={submitForm} disabled={!(parseInt(String(form.contacts).replace(/[^0-9]/g, ''), 10) > 0)} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-semibold">{editingId ? 'Save changes' : 'Add blast'}</button>
            <button onClick={closeForm} className="text-slate-500 dark:text-slate-400 hover:text-slate-700 text-sm px-3 py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Setup panel — how blasts get logged */}
      {!readOnly && showSetup && (
        <div className="premium-card p-4 space-y-4">
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">How blasts get logged</div>

          {/* Ringy — automatic */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">Ringy</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Automatic — one-time setup per agent</span>
            </div>
            <ol className="list-decimal list-inside text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <li>In PRIM: <strong>Prospects → Settings → Ringy</strong> → under <strong>&ldquo;Your blast tags&rdquo;</strong> type the exact tag you apply for a blast → <strong>Save</strong>.</li>
              <li>On that same page, <strong>Copy your Webhook URL</strong>.</li>
              <li>In Ringy, open that tag&rsquo;s <strong>Automated Action</strong> → check <strong>Post to a custom webhook</strong> → paste the Webhook URL.</li>
              <li>Click <strong>ADD VALUE</strong> → key <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">disposition</code> → <strong>Custom</strong> → type your tag name → <strong>Save</strong>.</li>
            </ol>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Then every lead you tag rolls up here as one daily entry — no prospects created. The standard <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">REPUROSED&nbsp;…&nbsp;DRIP</code> tag is recognized automatically (skip step 1).</p>
          </div>

          {/* TextDrip — manual */}
          <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-700 pt-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">TextDrip</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Manual</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">TextDrip can&rsquo;t report campaign adds automatically, so log those by hand: click <strong>&ldquo;Log a blast&rdquo;</strong> above and enter the count, campaign, date, and lead range.</p>
          </div>
        </div>
      )}

      {/* Period selector + roll-up */}
      <div className="space-y-3">
        <div className="flex items-center gap-1 text-xs flex-wrap">
          {BLAST_PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-lg font-semibold ${period === p ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              {BLAST_PERIOD_LABELS[p]}
            </button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} aria-label="Custom range start"
                className="border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1 text-xs" />
              <span className="text-slate-400" aria-hidden="true">→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} aria-label="Custom range end"
                className="border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1 text-xs" />
            </div>
          )}
        </div>
        {period === 'custom' && !range ? (
          <div className="premium-card p-4 text-sm text-slate-400 dark:text-slate-500">Pick a start and end date to see the total.</div>
        ) : (
          <div className="max-w-sm">
            <RollupCard label={BLAST_PERIOD_LABELS[period]} t={periodTotals} />
          </div>
        )}
      </div>

      {/* Table */}
      <div className="premium-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">Blast Log</h3>
          <div className="flex items-center gap-1 text-xs">
            {['all', 'Ringy', 'Textdrip'].map(p => (
              <button key={p} onClick={() => setPlatformFilter(p)} className={`px-2.5 py-1 rounded-lg font-semibold ${platformFilter === p ? 'bg-indigo-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                {p === 'all' ? 'All' : p === 'Textdrip' ? 'TextDrip' : p}
              </button>
            ))}
          </div>
        </div>
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400 dark:text-slate-500">
            {blasts.length === 0
              ? <>No blasts logged yet. {!readOnly && 'Ringy repurpose tags log here automatically — use “Log a blast” above for TextDrip or anything else.'}</>
              : 'No blasts in this period.'}
          </div>
        ) : (
          <div className="overflow-auto scroll-fade-x">
            <table className="w-full text-sm premium-table">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs">
                <tr>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Platform</th>
                  <th className="text-left p-2">Lead Range</th>
                  <th className="text-left p-2">Campaign / Tag</th>
                  <th className="text-right p-2">Contacts</th>
                  <th className="text-left p-2">Send Time</th>
                  <th className="text-left p-2">Numbers</th>
                  <th className="text-left p-2">Notes</th>
                  {!readOnly && <th className="w-20 p-2" />}
                </tr>
              </thead>
              <tbody>
                {sorted.map(b => (
                  <tr key={b.id} className="border-t border-slate-100 dark:border-slate-700/60 align-top">
                    <td className="p-2 font-medium whitespace-nowrap">{b.runDate || '—'}</td>
                    <td className="p-2"><span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${PLATFORM_STYLE[b.platform] || 'bg-slate-100 text-slate-600'}`}>{b.platform === 'Textdrip' ? 'TextDrip' : b.platform || '—'}</span></td>
                    <td
                      className={`p-2 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs ${!readOnly && !isInline(b.id, 'range') ? 'cursor-text hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''}`}
                      onClick={!readOnly && !isInline(b.id, 'range') ? () => startInline(b, 'range') : undefined}
                      title={!readOnly && !isInline(b.id, 'range') ? 'Click to edit' : undefined}
                    >
                      {isInline(b.id, 'range') ? (
                        <input
                          autoFocus
                          type="text"
                          value={inline.draft}
                          onChange={e => { const v = e.target.value; setInline(s => s && { ...s, draft: v }); }}
                          onKeyDown={inlineKeyDown}
                          onBlur={() => blurInline(b)}
                          placeholder="01/01/2025 → 05/31/2026"
                          className="w-44 border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1 text-xs"
                        />
                      ) : (
                        <>{b.rangeStart || '—'}{b.rangeEnd ? ` → ${b.rangeEnd}` : ''}</>
                      )}
                    </td>
                    <td
                      className={`p-2 text-slate-600 dark:text-slate-300 text-xs ${!readOnly && !isInline(b.id, 'tag') ? 'cursor-text hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''}`}
                      onClick={!readOnly && !isInline(b.id, 'tag') ? () => startInline(b, 'tag') : undefined}
                      title={!readOnly && !isInline(b.id, 'tag') ? 'Click to edit' : undefined}
                    >
                      {isInline(b.id, 'tag') ? (
                        <input
                          autoFocus
                          type="text"
                          list="blast-tags"
                          value={inline.draft}
                          onChange={e => { const v = e.target.value; setInline(s => s && { ...s, draft: v }); }}
                          onKeyDown={inlineKeyDown}
                          onBlur={() => blurInline(b)}
                          placeholder="New Aged leads"
                          className="w-40 border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1 text-xs"
                        />
                      ) : (
                        b.campaignOrTag || '—'
                      )}
                    </td>
                    <td className="p-2 text-right font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">{num(b.contacts)}</td>
                    <td className="p-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{b.sendTime || '—'}</td>
                    <td className="p-2 text-slate-400 dark:text-slate-500 text-[10px] font-mono max-w-[160px] truncate" title={b.numbersUsed}>{b.numbersUsed || '—'}</td>
                    <td
                      className={`p-2 text-slate-500 dark:text-slate-400 text-xs max-w-[220px] ${!readOnly && !isInline(b.id, 'notes') ? 'cursor-text hover:bg-slate-50 dark:hover:bg-slate-700/40' : ''}`}
                      onClick={!readOnly && !isInline(b.id, 'notes') ? () => startInline(b, 'notes') : undefined}
                      title={!readOnly && !isInline(b.id, 'notes') ? 'Click to edit' : undefined}
                    >
                      {isInline(b.id, 'notes') ? (
                        <input
                          autoFocus
                          type="text"
                          value={inline.draft}
                          onChange={e => { const v = e.target.value; setInline(s => s && { ...s, draft: v }); }}
                          onKeyDown={inlineKeyDown}
                          onBlur={() => blurInline(b)}
                          placeholder="optional"
                          className="w-52 max-w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1 text-xs"
                        />
                      ) : (
                        b.notes || '—'
                      )}
                    </td>
                    {!readOnly && (
                      <td className="p-2 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(b)} title="Edit this blast" className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20"><Pencil size={14} /></button>
                        <button onClick={() => onDelete?.(b.id)} title="Remove this blast" className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 ml-1"><Trash2 size={14} /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
