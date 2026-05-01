'use client';
import { useMemo, useRef, useState, useEffect, memo } from 'react';
import { Plus, Trash2, DollarSign, TrendingUp, AlertCircle, Calendar, Upload, X, Check, ChevronLeft, ChevronRight, Sparkles, Lock, Unlock } from 'lucide-react';
import { PLATFORMS, PLATFORM_REASONS } from '@/lib/constants';
import { fmt, fmt2, today, uid } from '@/lib/utils';
import { storage } from '@/lib/storage';
import { parsePlatformFile, dedupAgainst } from '@/lib/platformImport';
import { useClosedPeriods } from '@/lib/closedPeriods';
import { TiltCard, CountUp, Stagger, StaggerItem, MoneyCell } from '../motion/MotionPrimitives';
import SmartImportWizard from '../SmartImportWizard';

const BUDGET_KEY = 'platform_budget_v1';

const platformLabel = (id) => PLATFORMS.find(p => p.id === id)?.label || id;
const platformColor = (id) => PLATFORMS.find(p => p.id === id)?.color || '#64748b';
const platformBadge = (id) => PLATFORMS.find(p => p.id === id)?.badge || 'bg-slate-200 text-slate-800';

// "2026-01-15" → "2026-01"
const ymOf = (date) => (date || '').slice(0, 7);
// "2026-01" → "January 2026"
const ymLabel = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};
// Days in a YYYY-MM
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

function PlatformExpensesView({ expenses, onAdd, onUpdate, onDelete, onBulkAdd, onBulkAddBooksExpenses, onBulkAddBooksIncome }) {
  const fileInputRef = useRef(null);
  const [importPreview, setImportPreview] = useState(null); // { format, entries, fresh, duplicate, error }
  const [importing, setImporting] = useState(false);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const { isClosed: isPeriodClosed, close: closePlatformMonth, reopen: reopenPlatformMonth } = useClosedPeriods();

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const { format, entries } = await parsePlatformFile(file);
      if (format === 'unknown' || format === 'empty') {
        setImportPreview({ error: `Couldn't recognize this file. Expected a Don Julio budget sheet (Date / Platform / Amount columns) or a bank statement (Date / Description / Amount).` });
      } else if (entries.length === 0) {
        setImportPreview({ error: `Read the file as a ${format === 'bank' ? 'bank statement' : 'budget sheet'} but found 0 matching expenses. For bank statements, only TextDrip / Ringy / VanillaSoft charges are detected.` });
      } else {
        const { fresh, duplicate } = dedupAgainst(entries, expenses);
        // Pre-mark every fresh row as selected
        const selected = new Set(fresh.map(e => e.id));
        setImportPreview({ format, entries, fresh, duplicate, selected });
      }
    } catch (err) {
      setImportPreview({ error: `Failed to read file: ${err.message || err}` });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const togglePreviewRow = (id) => {
    setImportPreview(p => {
      if (!p || !p.selected) return p;
      const next = new Set(p.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...p, selected: next };
    });
  };

  const updatePreviewRow = (id, patch) => {
    setImportPreview(p => {
      if (!p || !p.fresh) return p;
      return { ...p, fresh: p.fresh.map(e => e.id === id ? { ...e, ...patch } : e) };
    });
  };

  const commitImport = () => {
    if (!importPreview?.fresh) return;
    const toAdd = importPreview.fresh
      .filter(e => importPreview.selected.has(e.id))
      .map(({ _source, ...e }) => e);
    if (toAdd.length === 0) return;
    onBulkAdd?.(toAdd);
    // Jump active month to the most-recent imported month so user immediately sees results
    const newest = toAdd.reduce((max, e) => e.date > max ? e.date : max, '');
    if (newest) setActiveMonth(newest.slice(0, 7));
    setImportPreview(null);
  };

  // Default current month (or whatever month has data, fall back to today)
  const allMonths = useMemo(() => {
    const set = new Set(expenses.map(e => ymOf(e.date)));
    set.add(ymOf(today()));
    return Array.from(set).filter(Boolean).sort().reverse();
  }, [expenses]);

  const [activeMonth, _setActiveMonth] = useState(allMonths[0] || ymOf(today()));
  const [stripYear, setStripYear] = useState(() => (allMonths[0] || ymOf(today())).slice(0, 4));
  const setActiveMonth = (ym) => {
    _setActiveMonth(ym);
    if (typeof ym === 'string' && ym.length >= 4) setStripYear(ym.slice(0, 4));
  };

  // Budget persists to localStorage so it survives tab navigation
  const [budget, setBudget] = useState(4000);
  useEffect(() => {
    let alive = true;
    storage.getItem(BUDGET_KEY).then(v => {
      if (alive && v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) setBudget(n);
      }
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    storage.setItem(BUDGET_KEY, String(budget));
  }, [budget]);

  // Quick add form
  const [draft, setDraft] = useState({
    date: today(),
    platform: 'TD',
    amount: '',
    reason: 'CREDIT REFILL',
    notes: '',
  });

  const monthExpenses = useMemo(
    () => expenses.filter(e => ymOf(e.date) === activeMonth).sort((a, b) => a.date.localeCompare(b.date)),
    [expenses, activeMonth]
  );

  // Per-platform totals for active month
  const monthByPlatform = useMemo(() => {
    const out = {};
    PLATFORMS.forEach(p => { out[p.id] = 0; });
    monthExpenses.forEach(e => {
      out[e.platform] = (out[e.platform] || 0) + Number(e.amount || 0);
    });
    return out;
  }, [monthExpenses]);

  const monthTotal = useMemo(
    () => Object.values(monthByPlatform).reduce((a, b) => a + b, 0),
    [monthByPlatform]
  );

  // Previous-month diff
  const prevMonth = useMemo(() => {
    const [y, m] = activeMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [activeMonth]);

  const prevTotal = useMemo(
    () => expenses.filter(e => ymOf(e.date) === prevMonth).reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses, prevMonth]
  );

  // Weekly average for the month (total ÷ weeks elapsed, capped at 4.33)
  const weeksInMonth = useMemo(() => {
    const days = daysInMonth(activeMonth);
    return Math.max(1, days / 7);
  }, [activeMonth]);

  // YTD + projected annual (run rate × 12 from elapsed months avg)
  const yearStats = useMemo(() => {
    const yr = activeMonth.slice(0, 4);
    const yrExpenses = expenses.filter(e => (e.date || '').startsWith(yr));
    const ytdTotal = yrExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const monthSet = new Set(yrExpenses.map(e => ymOf(e.date)));
    const monthsLogged = monthSet.size || 1;
    const monthlyAvg = ytdTotal / monthsLogged;
    return {
      ytdTotal,
      monthsLogged,
      projected: monthlyAvg * 12,
    };
  }, [expenses, activeMonth]);

  const remaining = budget - monthTotal;

  // Years that have any expense data (sorted ascending) — for the year jump dropdown
  const yearsWithData = useMemo(() => {
    const set = new Set(expenses.map(e => (e.date || '').slice(0, 4)).filter(Boolean));
    set.add(activeMonth.slice(0, 4));
    set.add(stripYear);
    return Array.from(set).sort();
  }, [expenses, activeMonth, stripYear]);

  // 12-month bar history (small chart strip) — for the currently selected stripYear
  const monthHistory = useMemo(() => {
    const out = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${stripYear}-${String(m).padStart(2, '0')}`;
      const total = expenses.filter(e => ymOf(e.date) === ym).reduce((s, e) => s + Number(e.amount || 0), 0);
      out.push({ ym, total });
    }
    return out;
  }, [expenses, stripYear]);

  const maxHistory = useMemo(() => Math.max(1, ...monthHistory.map(m => m.total)), [monthHistory]);
  const stripYearTotal = useMemo(() => monthHistory.reduce((s, m) => s + m.total, 0), [monthHistory]);

  const submitDraft = () => {
    const amt = Number(draft.amount || 0);
    if (!draft.date || amt <= 0) return;
    if (isPeriodClosed('platforms', draft.date)) {
      alert(`${ymLabel(ymOf(draft.date))} is closed. Reopen it before adding entries.`);
      return;
    }
    onAdd({
      id: uid(),
      date: draft.date,
      platform: draft.platform,
      amount: amt,
      reason: draft.reason,
      notes: draft.notes || '',
    });
    // keep date + platform, reset amount/notes
    setDraft(d => ({ ...d, amount: '', notes: '' }));
  };

  return (
    <div className="space-y-5">
      {/* Top stat strip */}
      <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StaggerItem>
          <Stat
            icon={<DollarSign size={16} className="text-emerald-600" />}
            label="YTD spent"
            numeric={yearStats.ytdTotal}
            sub={`${yearStats.monthsLogged} month${yearStats.monthsLogged !== 1 ? 's' : ''} logged`}
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            icon={<TrendingUp size={16} className="text-indigo-600" />}
            label="Projected annual"
            numeric={yearStats.projected}
            decimals={0}
            sub="Run-rate × 12"
          />
        </StaggerItem>
        <StaggerItem>
          <Stat
            icon={<Calendar size={16} className="text-amber-600" />}
            label={`${ymLabel(activeMonth)} total`}
            numeric={monthTotal}
            sub={prevTotal > 0
              ? `${monthTotal - prevTotal >= 0 ? '+' : ''}${fmt(monthTotal - prevTotal)} vs prev month`
              : 'no prev month data'}
          />
        </StaggerItem>
        <StaggerItem>
          <TiltCard className="bg-white rounded-xl border border-slate-200 p-3 shine-on-hover glow-ring cursor-default">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-500 tracking-wider">MONTHLY BUDGET</div>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value || 0))}
                onClick={(e) => e.stopPropagation()}
                className="w-24 text-right border border-slate-200 rounded px-2 py-0.5 text-sm font-semibold"
              />
            </div>
            <div className="mt-2 text-lg font-bold" style={{ color: remaining >= 0 ? '#10b981' : '#ef4444', transform: 'translateZ(10px)' }}>
              {remaining >= 0
                ? <CountUp value={remaining} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} />
                : <>−<CountUp value={Math.abs(remaining)} format={(v) => '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} /></>}
            </div>
            <div className="text-[11px] text-slate-500">
              {remaining >= 0 ? 'remaining this month' : 'over budget'}
            </div>
          </TiltCard>
        </StaggerItem>
      </Stagger>

      {/* Per-platform month cards */}
      <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PLATFORMS.map(p => {
          const total = monthByPlatform[p.id] || 0;
          const weekly = total / weeksInMonth;
          const entries = monthExpenses.filter(e => e.platform === p.id).length;
          return (
            <StaggerItem key={p.id}>
              <TiltCard className="bg-white rounded-xl border border-slate-200 p-4 shine-on-hover glow-ring cursor-default">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                    <div className="font-semibold text-slate-900">{p.label}</div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${p.badge}`} style={{ transform: 'translateZ(15px)' }}>{p.id}</span>
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1" style={{ transform: 'translateZ(12px)' }}>
                  <CountUp
                    value={total}
                    format={(v) => '$' + (v || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                  />
                </div>
                <div className="text-xs text-slate-500">
                  {fmt2(weekly)} / week avg · {entries} entries
                </div>
              </TiltCard>
            </StaggerItem>
          );
        })}
      </Stagger>

      {/* Multi-year history strip — prev/next year arrows, click any month to jump */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStripYear(String(Number(stripYear) - 1))}
              className="p-1 rounded hover:bg-slate-100 text-slate-600"
              title="Previous year"
            >
              <ChevronLeft size={16} />
            </button>
            <select
              value={stripYear}
              onChange={(e) => setStripYear(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm font-semibold"
            >
              {yearsWithData.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              onClick={() => setStripYear(String(Number(stripYear) + 1))}
              className="p-1 rounded hover:bg-slate-100 text-slate-600"
              title="Next year"
            >
              <ChevronRight size={16} />
            </button>
            <div className="text-xs text-slate-500 ml-2">
              {fmt2(stripYearTotal)} total · click any month
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Jump to:</span>
            <select
              value={activeMonth}
              onChange={(e) => {
                setActiveMonth(e.target.value);
                setStripYear(e.target.value.slice(0, 4));
              }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-sm"
            >
              {allMonths.map(m => <option key={m} value={m}>{ymLabel(m)}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-12 gap-1 h-24 items-end">
          {monthHistory.map(m => {
            const h = (m.total / maxHistory) * 100;
            const active = m.ym === activeMonth;
            const empty = m.total === 0;
            return (
              <button
                key={m.ym}
                onClick={() => setActiveMonth(m.ym)}
                className="flex flex-col items-center gap-1 group"
                title={`${ymLabel(m.ym)}: ${fmt2(m.total)}`}
              >
                <div
                  className={`w-full rounded-t transition ${active ? 'bg-indigo-600' : empty ? 'bg-slate-100 group-hover:bg-slate-200' : 'bg-slate-300 group-hover:bg-slate-400'}`}
                  style={{ height: `${Math.max(2, h)}%` }}
                />
                <div className={`text-[9px] ${active ? 'text-indigo-700 font-bold' : empty ? 'text-slate-400' : 'text-slate-500'}`}>
                  {m.ym.slice(5, 7)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Upload from file */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Upload size={18} />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Upload from file</div>
              <div className="text-xs text-slate-600">
                <span className="font-semibold">Smart (AI):</span> any PDF, screenshot, or messy export — Ringy/TextDrip/VanillaSoft auto-detected.
                <span className="block">Classic: Don Julio budget sheet or bank statement (CSV/XLSX).</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSmartImport(true)}
              className="bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-indigo-500/30"
            >
              <Sparkles size={14} />
              Smart Import (AI)
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="border border-indigo-300 bg-white hover:bg-indigo-50 disabled:bg-slate-100 text-indigo-700 rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2"
            >
              <Upload size={14} />
              {importing ? 'Reading…' : 'Classic'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {/* Smart Import (AI) wizard — same as Books, but rows route correctly */}
      <SmartImportWizard
        open={showSmartImport}
        onClose={() => setShowSmartImport(false)}
        onImport={({ expenses: bookExp, income: bookInc, platforms }) => {
          // Filter rows whose dates fall in closed months (per kind)
          const skip = { books: 0, platforms: 0 };
          const okPlatforms = (platforms || []).filter(r => {
            if (isPeriodClosed('platforms', r.date)) { skip.platforms++; return false; }
            return true;
          });
          const okBookExp = (bookExp || []).filter(r => {
            if (isPeriodClosed('books', r.date)) { skip.books++; return false; }
            return true;
          });
          const okBookInc = (bookInc || []).filter(r => {
            if (isPeriodClosed('books', r.date)) { skip.books++; return false; }
            return true;
          });
          if (okPlatforms.length) {
            onBulkAdd?.(okPlatforms);
            const newest = okPlatforms.reduce((max, e) => e.date > max ? e.date : max, '');
            if (newest) setActiveMonth(newest.slice(0, 7));
          }
          // Any non-platform rows extracted from the file get routed to Books
          // automatically — so a PDF with mixed charges Just Works.
          if (okBookExp.length && onBulkAddBooksExpenses) onBulkAddBooksExpenses(okBookExp);
          if (okBookInc.length && onBulkAddBooksIncome) onBulkAddBooksIncome(okBookInc);
          if (skip.books + skip.platforms > 0) {
            const parts = [];
            if (skip.books) parts.push(`${skip.books} books row${skip.books !== 1 ? 's' : ''}`);
            if (skip.platforms) parts.push(`${skip.platforms} platforms row${skip.platforms !== 1 ? 's' : ''}`);
            alert(`Skipped ${parts.join(' + ')} that fell in closed months. Reopen those months and re-import if needed.`);
          }
        }}
      />

      {/* Quick add */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Plus size={16} className="text-indigo-600" />
          <h3 className="font-semibold text-slate-900">Add expense entry</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Date</label>
            <input
              type="date"
              value={draft.date}
              onChange={(e) => setDraft(d => ({ ...d, date: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Platform</label>
            <select
              value={draft.platform}
              onChange={(e) => setDraft(d => ({ ...d, platform: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            >
              {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Amount</label>
            <MoneyCell
              value={draft.amount}
              onChange={(v) => setDraft(d => ({ ...d, amount: v }))}
              width="w-full"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Reason</label>
            <select
              value={draft.reason}
              onChange={(e) => setDraft(d => ({ ...d, reason: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            >
              {PLATFORM_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Notes</label>
            <input
              type="text"
              placeholder="(optional)"
              value={draft.notes}
              onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={submitDraft}
              disabled={!draft.amount || Number(draft.amount) <= 0 || isPeriodClosed('platforms', draft.date)}
              title={isPeriodClosed('platforms', draft.date) ? `${ymLabel(ymOf(draft.date))} is closed — reopen to add` : ''}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition flex items-center justify-center gap-1"
            >
              {isPeriodClosed('platforms', draft.date) ? <><Lock size={12} /> Locked</> : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* Daily entries table */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            {ymLabel(activeMonth)} — Daily entries
            {isPeriodClosed('platforms', activeMonth) && (
              <span title="This month is closed for editing" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5">
                <Lock size={10} /> Closed
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {monthExpenses.length} entr{monthExpenses.length === 1 ? 'y' : 'ies'} · {fmt2(monthTotal)} total
            </span>
            {isPeriodClosed('platforms', activeMonth) ? (
              <button
                onClick={async () => {
                  if (window.confirm(`Reopen ${ymLabel(activeMonth)} (Platforms) for editing?`)) {
                    await reopenPlatformMonth('platforms', activeMonth);
                  }
                }}
                title="Reopen this month for editing"
                className="text-xs flex items-center gap-1 border border-amber-300 hover:border-amber-500 hover:bg-amber-50 text-amber-800 rounded-lg px-2.5 py-1 transition"
              >
                <Unlock size={12} /> Reopen month
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (window.confirm(`Close ${ymLabel(activeMonth)} (Platforms)? Adds, edits, deletes, and Smart Imports for this month will be blocked. You can reopen it any time.`)) {
                    await closePlatformMonth('platforms', activeMonth);
                  }
                }}
                title="Lock this month so Smart Imports and edits can't change it"
                className="text-xs flex items-center gap-1 border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-slate-700 rounded-lg px-2.5 py-1 transition"
              >
                <Lock size={12} /> Close month
              </button>
            )}
          </div>
        </div>

        {/* Closed-month banner */}
        {isPeriodClosed('platforms', activeMonth) && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
            <Lock size={13} className="flex-shrink-0" />
            <div className="flex-1">
              <span className="font-semibold">{ymLabel(activeMonth)} (Platforms) is closed.</span> Smart Import skips this month, and per-row edit/delete is disabled. Click <span className="font-semibold">Reopen month</span> to make changes.
            </div>
          </div>
        )}
        {monthExpenses.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            <AlertCircle className="mx-auto mb-2" size={20} />
            No entries yet for {ymLabel(activeMonth)}. Add one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Platform</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Amount</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Reason</th>
                  <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Notes</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {monthExpenses.map(e => {
                  const rowLocked = isPeriodClosed('platforms', e.date);
                  const lockedUpdate = (patch) => {
                    if (rowLocked) {
                      alert('This row is in a closed month. Reopen it before editing.');
                      return;
                    }
                    onUpdate(patch);
                  };
                  return (
                    <tr key={e.id} className={`border-b border-slate-100 ${rowLocked ? 'bg-amber-50/30' : 'hover:bg-slate-50'}`}>
                      <td className="py-2 px-2">
                        <input
                          type="date"
                          value={e.date}
                          onChange={(ev) => lockedUpdate({ ...e, date: ev.target.value })}
                          readOnly={rowLocked}
                          className={`border border-transparent rounded px-1 py-0.5 text-sm bg-transparent ${rowLocked ? 'text-slate-400 cursor-not-allowed' : 'hover:border-slate-200'}`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={e.platform}
                          onChange={(ev) => lockedUpdate({ ...e, platform: ev.target.value })}
                          disabled={rowLocked}
                          className={`text-xs px-2 py-1 rounded font-bold ${platformBadge(e.platform)} border-0 ${rowLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <MoneyCell
                          value={e.amount}
                          onChange={(v) => lockedUpdate({ ...e, amount: v })}
                          disabled={rowLocked}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={e.reason}
                          onChange={(ev) => lockedUpdate({ ...e, reason: ev.target.value })}
                          disabled={rowLocked}
                          className={`text-xs border border-transparent rounded px-1 py-0.5 bg-transparent ${rowLocked ? 'opacity-60 cursor-not-allowed' : 'hover:border-slate-200'}`}
                        >
                          {PLATFORM_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={e.notes || ''}
                          onChange={(ev) => lockedUpdate({ ...e, notes: ev.target.value })}
                          readOnly={rowLocked}
                          placeholder="—"
                          className={`w-full border border-transparent rounded px-1 py-0.5 text-xs bg-transparent ${rowLocked ? 'text-slate-400 cursor-not-allowed' : 'text-slate-600 hover:border-slate-200'}`}
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        {rowLocked ? (
                          <Lock size={12} className="text-amber-500 inline" title="Closed — reopen to delete" />
                        ) : (
                          <button
                            onClick={() => onDelete(e.id)}
                            className="text-slate-400 hover:text-red-600 transition"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold">
                  <td className="py-2 px-2 text-xs text-slate-500 uppercase tracking-wider" colSpan={2}>Month total</td>
                  <td className="py-2 px-2 text-right text-slate-900">{fmt2(monthTotal)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Import preview modal */}
      {importPreview && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white/90 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl shadow-indigo-500/10">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div>
                <h2 className="font-semibold text-slate-900">Review import</h2>
                {importPreview.format && (
                  <div className="text-xs text-slate-500 mt-0.5">
                    Detected as <span className="font-semibold">{importPreview.format === 'donjulio' ? 'Don Julio budget sheet' : 'Bank/credit card statement'}</span>
                  </div>
                )}
              </div>
              <button onClick={() => setImportPreview(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="overflow-auto p-5 flex-1">
              {importPreview.error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <AlertCircle size={16} /> Couldn&rsquo;t process file
                  </div>
                  <div>{importPreview.error}</div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <Stat
                      icon={<Check size={16} className="text-emerald-600" />}
                      label="New entries"
                      value={importPreview.fresh.length}
                      sub="will be added"
                    />
                    <Stat
                      icon={<AlertCircle size={16} className="text-amber-600" />}
                      label="Duplicates skipped"
                      value={importPreview.duplicate.length}
                      sub="already in tracker"
                    />
                    <Stat
                      icon={<DollarSign size={16} className="text-indigo-600" />}
                      label="Total to import"
                      value={fmt2(importPreview.fresh
                        .filter(e => importPreview.selected.has(e.id))
                        .reduce((s, e) => s + Number(e.amount || 0), 0))}
                      sub={`${importPreview.selected.size} of ${importPreview.fresh.length} selected`}
                    />
                  </div>

                  {importPreview.fresh.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      All {importPreview.duplicate.length} entries in the file are already in your tracker.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left">
                          <th className="py-2 px-2 w-8"></th>
                          <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                          <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Platform</th>
                          <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Amount</th>
                          <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Reason</th>
                          <th className="py-2 px-2 text-xs font-bold text-slate-500 uppercase tracking-wider">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.fresh.map(e => {
                          const checked = importPreview.selected.has(e.id);
                          return (
                            <tr key={e.id} className={`border-b border-slate-100 ${checked ? '' : 'opacity-40'}`}>
                              <td className="py-2 px-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => togglePreviewRow(e.id)}
                                  className="w-4 h-4"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="date"
                                  value={e.date}
                                  onChange={(ev) => updatePreviewRow(e.id, { date: ev.target.value })}
                                  className="border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-sm bg-transparent"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <select
                                  value={e.platform}
                                  onChange={(ev) => updatePreviewRow(e.id, { platform: ev.target.value })}
                                  className={`text-xs px-2 py-1 rounded font-bold ${platformBadge(e.platform)} border-0`}
                                >
                                  {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                                </select>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <MoneyCell
                                  value={e.amount}
                                  onChange={(v) => updatePreviewRow(e.id, { amount: v })}
                                />
                              </td>
                              <td className="py-2 px-2">
                                <select
                                  value={e.reason}
                                  onChange={(ev) => updatePreviewRow(e.id, { reason: ev.target.value })}
                                  className="text-xs border border-transparent hover:border-slate-200 rounded px-1 py-0.5 bg-transparent"
                                >
                                  {PLATFORM_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  value={e.notes || ''}
                                  onChange={(ev) => updatePreviewRow(e.id, { notes: ev.target.value })}
                                  className="w-full border border-transparent hover:border-slate-200 rounded px-1 py-0.5 text-xs text-slate-600 bg-transparent"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
              <button
                onClick={() => setImportPreview(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              {!importPreview.error && importPreview.fresh?.length > 0 && (
                <button
                  onClick={commitImport}
                  disabled={importPreview.selected.size === 0}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold transition flex items-center gap-2"
                >
                  <Check size={14} />
                  Import {importPreview.selected.size} {importPreview.selected.size === 1 ? 'entry' : 'entries'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(PlatformExpensesView);

function Stat({ icon, label, value, numeric, decimals = 2, isCurrency = true, sub, tilt = true }) {
  const formatNumber = (v) => {
    if (!isCurrency) return Math.round(v).toLocaleString();
    return '$' + (v || 0).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  };
  const Inner = (
    <>
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-xs font-bold text-slate-500 tracking-wider">{label}</div>
      </div>
      <div className="mt-2 text-lg font-bold text-slate-900" style={{ transform: 'translateZ(10px)' }}>
        {numeric != null ? <CountUp value={numeric} format={formatNumber} /> : value}
      </div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </>
  );
  return tilt ? (
    <TiltCard className="bg-white rounded-xl border border-slate-200 p-3 shine-on-hover glow-ring cursor-default">
      {Inner}
    </TiltCard>
  ) : (
    <div className="bg-white rounded-xl border border-slate-200 p-3">{Inner}</div>
  );
}
