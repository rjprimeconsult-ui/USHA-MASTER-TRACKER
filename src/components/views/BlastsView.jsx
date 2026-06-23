'use client';
/**
 * BlastsView — the "Blasts" tab. A read-only log of every blast / repurpose
 * run, fed automatically by the Cowork ringy-textdrip-blast skill via the
 * blast webhook. Shows plain Today / last-7-day totals (no caps — caps are a
 * Cowork-side guideline, not enforced here) + a table of every blast, plus a
 * collapsible setup panel with the Posting URL.
 */
import { useState, useEffect, useMemo } from 'react';
import { Send, Copy, Check, RefreshCw, Trash2, Pencil, ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

// Local-time YYYY-MM-DD for the manual form's default date.
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const EMPTY_FORM = { platform: 'Textdrip', runDate: '', campaignOrTag: '', contacts: '', sendTime: '', rangeStart: '', rangeEnd: '', notes: '' };

async function bearer() {
  if (!supabaseConfigured()) return null;
  try { const { data } = await supabase.auth.getSession(); return data.session?.access_token || null; } catch { return null; }
}
async function authedFetch(url, options = {}) {
  const token = await bearer();
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

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

export default function BlastsView({ blasts = [], onDelete, onAdd, onEdit, readOnly = false }) {
  const [config, setConfig] = useState(null);
  const [copied, setCopied] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);  // null = new; else the row id being edited
  const [editKind, setEditKind] = useState(null);    // 'auto' (Ringy counter) | 'log' (manual/skill)

  const autoEdit = editKind === 'auto';
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

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

  useEffect(() => {
    if (readOnly) return;
    let alive = true;
    (async () => {
      try { const data = await authedFetch('/api/blast/config'); if (alive) setConfig(data); }
      catch { if (alive) setConfig({ postingUrl: '', connected: false }); }
    })();
    return () => { alive = false; };
  }, [readOnly]);

  const { todayTotals, weekTotals } = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start7 = new Date(startToday); start7.setDate(start7.getDate() - 6);
    const tally = (since) => {
      const rows = blasts.filter(b => { const d = blastDate(b); return d && d >= since; });
      const by = (plat) => rows.filter(b => !plat || b.platform === plat);
      const sum = (rs) => rs.reduce((s, b) => s + (Number(b.contacts) || 0), 0);
      return {
        contacts: sum(rows), count: rows.length,
        ringy: { contacts: sum(by('Ringy')), count: by('Ringy').length },
        textdrip: { contacts: sum(by('Textdrip')), count: by('Textdrip').length },
      };
    };
    return { todayTotals: tally(startToday), weekTotals: tally(start7) };
  }, [blasts]);

  const sorted = useMemo(() => {
    const rows = platformFilter === 'all' ? blasts : blasts.filter(b => b.platform === platformFilter);
    return [...rows].sort((a, b) => (blastDate(b)?.getTime() || 0) - (blastDate(a)?.getTime() || 0));
  }, [blasts, platformFilter]);

  const copy = async (text, which) => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(''), 2000); } catch { /* clipboard unavailable */ }
  };
  const regenerate = async () => {
    if (!confirm('Regenerate the Posting URL? Your blast skill will stop logging to PRIM until you paste the new URL into it.')) return;
    setRegenerating(true);
    try { const data = await authedFetch('/api/blast/config', { method: 'POST', body: JSON.stringify({ regenerateToken: true }) }); setConfig(data); }
    catch { /* ignore */ } finally { setRegenerating(false); }
  };

  const RollupCard = ({ label, t }) => (
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

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-4 space-y-4">
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
              <input type="text" value={form.campaignOrTag} onChange={e => setField('campaignOrTag', e.target.value)} placeholder="New Aged leads" className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs" />
            </label>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Range start</span>
              <input type="text" value={form.rangeStart} onChange={e => setField('rangeStart', e.target.value)} placeholder="optional" className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs" />
            </label>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 space-y-1">
              <span className="block">Range end</span>
              <input type="text" value={form.rangeEnd} onChange={e => setField('rangeEnd', e.target.value)} placeholder="optional" className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 text-xs" />
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

      {/* Setup panel */}
      {!readOnly && showSetup && (
        <div className="premium-card p-4 space-y-3">
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Connect your blast skill</div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <strong>Ringy blasts log themselves</strong> — applying a repurpose tag in Ringy rolls up here automatically. <strong>Using your own tag name?</strong> Add it under <strong>Prospects → Settings → Ringy → &ldquo;Your blast tags&rdquo;</strong> so PRIM recognizes it. For <strong>TextDrip</strong>, use &ldquo;Log a blast&rdquo; above, or connect the Cowork skill below.
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            In your Cowork <strong>ringy-textdrip-blast</strong> skill, in the &ldquo;Log every blast&rdquo; step — right after it appends the row to <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">blast-log.csv</code> — POST the <strong>TextDrip</strong> rows (JSON) to your Posting URL below. PRIM logs them automatically; re-sends are de-duped. <strong>Skip Ringy rows</strong> — Ringy is counted natively and POSTing it here would double-count.
          </p>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Posting URL</label>
            <div className="flex items-center gap-2">
              <input readOnly value={config?.postingUrl || (config ? '' : 'Loading…')} className="flex-1 border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 select-all" />
              <button onClick={() => copy(config?.postingUrl, 'url')} className="border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0">
                {copied === 'url' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}{copied === 'url' ? 'Copied' : 'Copy'}
              </button>
              <button onClick={regenerate} disabled={regenerating} title="Regenerate (old URL stops working)" className="border border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-400 disabled:opacity-60 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 shrink-0">
                {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}Regenerate
              </button>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 mb-1">Example POST body (same fields as blast-log.csv)</div>
            <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto text-[10px] leading-relaxed font-mono whitespace-pre">{`{
  "run_date": "2026-06-22",
  "platform": "Textdrip",
  "range_start": "2025-01-01",
  "range_end": "2026-05-31",
  "campaign_or_tag": "New Aged leads",
  "contacts": 4587,
  "send_time": "10:30",
  "numbers_used": "",
  "notes": "blast 1 of 2"
}`}</pre>
          </div>
        </div>
      )}

      {/* Roll-up */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <RollupCard label="Today" t={todayTotals} />
        <RollupCard label="Last 7 days" t={weekTotals} />
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
            No blasts logged yet. {!readOnly && 'Ringy repurpose tags log here automatically — use “Log a blast” above for TextDrip or anything else.'}
          </div>
        ) : (
          <div className="overflow-auto">
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
                    <td className="p-2 text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">{b.rangeStart || '—'}{b.rangeEnd ? ` → ${b.rangeEnd}` : ''}</td>
                    <td className="p-2 text-slate-600 dark:text-slate-300 text-xs">{b.campaignOrTag || '—'}</td>
                    <td className="p-2 text-right font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">{num(b.contacts)}</td>
                    <td className="p-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{b.sendTime || '—'}</td>
                    <td className="p-2 text-slate-400 dark:text-slate-500 text-[10px] font-mono max-w-[160px] truncate" title={b.numbersUsed}>{b.numbersUsed || '—'}</td>
                    <td className="p-2 text-slate-500 dark:text-slate-400 text-xs max-w-[220px]">{b.notes || '—'}</td>
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
