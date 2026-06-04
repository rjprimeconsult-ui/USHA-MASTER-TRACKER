'use client';
/**
 * Statement Manager — view + delete statement-derived data. Delete-only.
 * Range bulk delete (with preview) + per-week / per-month / per-row delete.
 * Pure-logic from statementManager.mjs; parent owns the actual state mutations.
 */
import { useMemo, useState } from 'react';
import { Trash2, ChevronDown, ChevronRight, AlertTriangle, CalendarRange } from 'lucide-react';
import { groupStatements, statementsInRange } from '@/lib/statementManager.mjs';

const inp = 'bg-white text-slate-900 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function earliestDate(stores) {
  const all = [
    ...stores.ownAdvances.map(r => r.period),
    ...stores.overrides.map(r => r.period),
    ...stores.chargebacks.map(r => r.period),
    ...stores.businessIncome.map(r => r.date),
  ].map(d => String(d || '').slice(0, 10)).filter(Boolean).sort();
  return all[0] || new Date().toISOString().slice(0, 10);
}

export default function StatementManager({
  ownAdvances = [], overrides = [], chargebacks = [], businessIncome = [],
  onDeleteRange, onDeleteWeek, onDeleteMonth, onDeleteRow,
}) {
  const stores = { ownAdvances, overrides, chargebacks, businessIncome };
  const grouped = useMemo(() => groupStatements(stores), [ownAdvances, overrides, chargebacks, businessIncome]);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => earliestDate(stores));
  const [to, setTo] = useState(today);
  const [expanded, setExpanded] = useState(() => new Set());

  const preview = useMemo(() => statementsInRange(stores, from, to), [ownAdvances, overrides, chargebacks, businessIncome, from, to]);
  const previewTotalRows = preview.counts.own + preview.counts.override + preview.counts.chargeback + preview.counts.monthly;

  const toggle = (key) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const hasAny = grouped.weekly.length > 0 || grouped.monthly.length > 0;
  if (!hasAny) {
    return <div className="text-sm text-slate-400 italic">No uploaded statements yet.</div>;
  }

  const runRange = () => {
    if (previewTotalRows === 0) return;
    if (!confirm(`Delete ${previewTotalRows} statement entr${previewTotalRows === 1 ? 'y' : 'ies'} dated ${from} to ${to}?\n\nThis removes advances/overrides/chargebacks and monthly payouts in that range. It updates your Earned / CPA / Books totals but does NOT change lead stages. This can't be undone.`)) return;
    onDeleteRange?.(from, to);
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
        Deleting removes commission/income entries (updating Earned, CPA, and Books) — it does not un-issue leads. To fix numbers, re-upload the correct statement.
      </div>

      <div className="border border-slate-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-900">
          <CalendarRange size={15} /> Delete a date range
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">From<br /><input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-slate-600">To<br /><input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)} /></label>
          <button onClick={runRange} disabled={previewTotalRows === 0}
            className="bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-bold flex items-center gap-1.5">
            <Trash2 size={14} /> Delete range
          </button>
        </div>
        <div className="text-[11px] text-slate-500 mt-2">
          {previewTotalRows === 0 ? 'Nothing in this range.' : (
            <>Will delete <b>{preview.counts.weeks}</b> week(s) and <b>{preview.counts.months}</b> monthly payout(s):
              {' '}{preview.counts.own + preview.counts.override} advance/override rows ({money(preview.totals.own + preview.totals.override)}),
              {' '}{preview.counts.chargeback} chargebacks ({money(preview.totals.chargeback)}),
              {' '}{preview.counts.monthly} monthly ({money(preview.totals.monthlyIncome)}).</>
          )}
        </div>
      </div>

      {grouped.weekly.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Weekly statements</div>
          <div className="space-y-1.5">
            {grouped.weekly.map(w => {
              const key = `w:${w.period}`;
              const open = expanded.has(key);
              return (
                <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                    <button onClick={() => toggle(key)} className="flex items-center gap-1.5 flex-1 text-left text-sm">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="font-semibold text-slate-900">Week of {w.period}</span>
                      <span className="text-xs text-slate-500">· {w.counts.own + w.counts.override} adv/ovr · {w.counts.chargeback} cb</span>
                    </button>
                    <span className="text-xs text-slate-600">{money(w.totals.own + w.totals.override)}</span>
                    <button onClick={() => { if (confirm(`Delete the entire week of ${w.period}?`)) onDeleteWeek?.(w.period); }}
                      className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-xs font-semibold flex items-center gap-1">
                      <Trash2 size={12} /> Delete week
                    </button>
                  </div>
                  {open && (
                    <div className="divide-y divide-slate-100">
                      {[['own', w.own], ['override', w.override], ['chargeback', w.chargeback]].flatMap(([store, rows]) =>
                        rows.map(r => (
                          <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                            <span className="w-16 text-slate-400 uppercase">{store}</span>
                            <span className="flex-1 text-slate-700 truncate">{r.customer || '(no name)'} · {r.productDesc || ''}</span>
                            <span className="text-slate-600">{money(r.amount)}</span>
                            <button onClick={() => onDeleteRow?.(store, r.id)} className="text-slate-400 hover:text-red-600" title="Delete row"><Trash2 size={12} /></button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {grouped.monthly.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Monthly payouts</div>
          <div className="space-y-1.5">
            {grouped.monthly.map(m => {
              const key = `m:${m.month}`;
              const open = expanded.has(key);
              return (
                <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                    <button onClick={() => toggle(key)} className="flex items-center gap-1.5 flex-1 text-left text-sm">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="font-semibold text-slate-900">{m.month}</span>
                      <span className="text-xs text-slate-500">· {m.rows.length} payout(s)</span>
                    </button>
                    <span className="text-xs text-slate-600">{money(m.total)}</span>
                    <button onClick={() => { if (confirm(`Delete all monthly payouts for ${m.month}?`)) onDeleteMonth?.(m.month); }}
                      className="text-red-600 hover:bg-red-50 rounded px-2 py-1 text-xs font-semibold flex items-center gap-1">
                      <Trash2 size={12} /> Delete month
                    </button>
                  </div>
                  {open && (
                    <div className="divide-y divide-slate-100">
                      {m.rows.map(r => (
                        <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                          <span className="flex-1 text-slate-700 truncate">{r.source || r.category} · {r.date}</span>
                          <span className="text-slate-600">{money(r.amount)}</span>
                          <button onClick={() => onDeleteRow?.('income', r.id)} className="text-slate-400 hover:text-red-600" title="Delete row"><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
