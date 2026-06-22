'use client';
/**
 * BlastsView — the "Blasts" tab. A read-only log of every blast / repurpose
 * run, fed automatically by the Cowork ringy-textdrip-blast skill via the
 * blast webhook. Shows plain Today / last-7-day totals (no caps — caps are a
 * Cowork-side guideline, not enforced here) + a table of every blast, plus a
 * collapsible setup panel with the Posting URL.
 */
import { useState, useEffect, useMemo } from 'react';
import { Send, Copy, Check, RefreshCw, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { supabase, supabaseConfigured } from '@/lib/supabase';

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

// Bucket a blast by its run date (lenient), falling back to when PRIM received it.
function blastDate(b) {
  const d = new Date(b?.runDate);
  if (!Number.isNaN(d.getTime())) return d;
  const c = new Date(b?.createdAt);
  return Number.isNaN(c.getTime()) ? null : c;
}
const num = (n) => (Number(n) || 0).toLocaleString();

export default function BlastsView({ blasts = [], onDelete, readOnly = false }) {
  const [config, setConfig] = useState(null);
  const [copied, setCopied] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');

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
          <button onClick={() => setShowSetup(s => !s)} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1">
            Setup {showSetup ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {/* Setup panel */}
      {!readOnly && showSetup && (
        <div className="premium-card p-4 space-y-3">
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Connect your blast skill</div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            In your Cowork <strong>ringy-textdrip-blast</strong> skill, in the &ldquo;Log every blast&rdquo; step — right after it appends the row to <code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">blast-log.csv</code> — also POST that same row (JSON) to your Posting URL below. PRIM logs it automatically; re-sends are de-duped.
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
  "platform": "Ringy",
  "range_start": "2025-01-01",
  "range_end": "2026-05-31",
  "campaign_or_tag": "REPUROSED - AGED - POST O/E DRIP",
  "contacts": 2000,
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
            No blasts logged yet. {!readOnly && 'Open Setup above and connect your blast skill — each run will appear here automatically.'}
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
                  {!readOnly && <th className="w-10 p-2" />}
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
                      <td className="p-2 text-right">
                        <button onClick={() => onDelete?.(b.id)} title="Remove this blast" className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /></button>
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
