'use client';
import { useMemo, useState } from 'react';
import { TrendingDown, Users, Trash2, Search, Calendar, X } from 'lucide-react';

export default function ChargebacksPanel({ chargebacks = [], onDelete }) {
  const [view, setView] = useState('client');   // 'client' | 'agent'
  const [kind, setKind] = useState('all');      // 'all' | 'own' | 'override'
  const [period, setPeriod] = useState('all');  // 'all' or a specific period string
  const [query, setQuery] = useState('');

  // --- period options: every distinct period value from the chargebacks, sorted newest-first
  const periods = useMemo(() => {
    const s = new Set();
    for (const c of chargebacks) if (c.period) s.add(c.period);
    return Array.from(s).sort((a, b) => {
      // Period strings look like "4/16/2026". Compare by date value.
      const parse = (p) => {
        const m = String(p).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return 0;
        let [, mm, dd, yy] = m;
        if (yy.length === 2) yy = (parseInt(yy) > 50 ? '19' : '20') + yy;
        return new Date(+yy, +mm - 1, +dd).valueOf();
      };
      return parse(b) - parse(a);
    });
  }, [chargebacks]);

  // --- filter applied to the raw list before grouping
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chargebacks.filter(c => {
      if (kind === 'own' && !c.isOwn) return false;
      if (kind === 'override' && c.isOwn) return false;
      if (period !== 'all' && c.period !== period) return false;
      if (q) {
        const hay = `${c.customer || ''} ${c.writingAgent || ''} ${c.productDesc || ''} ${c.policyId || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [chargebacks, kind, period, query]);

  const byClient = useMemo(() => {
    const m = new Map();
    for (const c of filtered) {
      const k = (c.customer || '').toLowerCase();
      if (!m.has(k)) m.set(k, { customer: c.customer, total: 0, rows: [], isOwn: c.isOwn });
      const e = m.get(k);
      e.total += c.amount;
      e.rows.push(c);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const byAgent = useMemo(() => {
    const m = new Map();
    for (const c of filtered) {
      const k = (c.writingAgent || 'UNKNOWN').toUpperCase();
      if (!m.has(k)) m.set(k, { agent: c.writingAgent || 'UNKNOWN', total: 0, rows: [], isOwn: c.isOwn });
      const e = m.get(k);
      e.total += c.amount;
      e.rows.push(c);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  if (chargebacks.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-1">
          <TrendingDown size={16} className="text-red-600" />
          <h3 className="font-semibold text-slate-900">Chargebacks</h3>
        </div>
        <p className="text-xs text-slate-500 mb-2">Amounts pulled back when clients cancel before 12 months.</p>
        <div className="text-sm text-slate-400 text-center py-6 italic">No chargebacks recorded. Upload a weekly statement to populate this section.</div>
      </div>
    );
  }

  const ownTotal = filtered.filter(c => c.isOwn).reduce((s, c) => s + c.amount, 0);
  const ovrTotal = filtered.filter(c => !c.isOwn).reduce((s, c) => s + c.amount, 0);
  const grandTotal = ownTotal + ovrTotal;
  const anyFilter = kind !== 'all' || period !== 'all' || query.trim() !== '';

  const clearFilters = () => { setKind('all'); setPeriod('all'); setQuery(''); };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <TrendingDown size={16} className="text-red-600" />
            <h3 className="font-semibold text-slate-900">Chargebacks</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Clients that cancelled before 12 months — amount pulled back from your advance or reserve.</p>
        </div>
        <div className="flex gap-2 text-sm flex-wrap">
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500">Own: </span>
            <span className="font-bold text-red-700">-${ownTotal.toFixed(2)}</span>
          </div>
          {ovrTotal > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-slate-500">Overrides: </span>
              <span className="font-bold text-red-700">-${ovrTotal.toFixed(2)}</span>
            </div>
          )}
          <div className="bg-red-100 border border-red-300 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500">Total: </span>
            <span className="font-bold text-red-800">-${grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center bg-slate-50 border border-slate-200 rounded-lg p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search customer, agent, product, policy ID…"
            className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <div className="relative">
          <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm bg-white"
            title="Filter by statement period"
          >
            <option value="all">All weeks ({periods.length})</option>
            {periods.map(p => <option key={p} value={p}>Week ending {p}</option>)}
          </select>
        </div>
        <select
          value={kind}
          onChange={e => setKind(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">All kinds</option>
          <option value="own">Own only</option>
          <option value="override">Overrides only</option>
        </select>
        {anyFilter && (
          <button
            onClick={clearFilters}
            className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200"
            title="Clear all filters"
          >
            <X size={12} /> Clear
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} of {chargebacks.length} rows</span>
      </div>

      {/* View toggle */}
      <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm w-full max-w-sm">
        <button onClick={() => setView('client')} className={`flex-1 px-3 py-1.5 font-medium flex items-center justify-center gap-1.5 ${view === 'client' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          <Users size={14} /> By client
        </button>
        <button onClick={() => setView('agent')} className={`flex-1 px-3 py-1.5 font-medium flex items-center justify-center gap-1.5 ${view === 'agent' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
          By agent
        </button>
      </div>

      {/* Aggregated table */}
      <div className="overflow-auto max-h-96 border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs sticky top-0">
            <tr>
              <th className="text-left p-2">{view === 'client' ? 'Customer' : 'Writing Agent'}</th>
              <th className="text-center p-2">Kind</th>
              <th className="text-right p-2">Rows</th>
              <th className="text-right p-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {(view === 'client' ? byClient : byAgent).map((row, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-2 font-medium">{row.customer || row.agent}</td>
                <td className="text-center p-2">
                  {row.isOwn
                    ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Own</span>
                    : <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">Override</span>}
                </td>
                <td className="text-right p-2 text-slate-500">{row.rows.length}</td>
                <td className="text-right p-2 text-red-700 font-semibold">-${row.total.toFixed(2)}</td>
              </tr>
            ))}
            {(view === 'client' ? byClient : byAgent).length === 0 && (
              <tr><td colSpan="4" className="text-center p-6 text-slate-400 italic">No chargebacks match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail rows */}
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600 hover:text-slate-900 select-none">Show all {filtered.length} policy-level rows</summary>
        <div className="mt-2 overflow-auto max-h-64 border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="text-left p-2">Week</th>
                <th className="text-left p-2">Customer</th>
                <th className="text-left p-2">Product</th>
                <th className="text-left p-2">Writing Agent</th>
                <th className="text-left p-2">Policy ID</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-right p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="p-2 text-slate-500">{c.period || '—'}</td>
                  <td className="p-2">{c.customer}</td>
                  <td className="p-2 text-slate-500">{c.productDesc}</td>
                  <td className="p-2 text-slate-500">{c.writingAgent}</td>
                  <td className="p-2 font-mono text-[11px]">{c.policyId}</td>
                  <td className="text-right p-2 text-red-700">-${c.amount.toFixed(2)}</td>
                  <td className="text-right p-2">
                    {onDelete && <button onClick={() => onDelete(c.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
