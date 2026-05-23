'use client';
import { useState, useMemo, memo } from 'react';
import { Plus, Search, Edit2, Trash2, Download, ArrowUpDown, X, Calendar, Users, Upload } from 'lucide-react';
import { STAGES, SOURCES, OWNERS, LEAD_CATEGORIES, MAIN_PRODUCTS, UNDERWRITTEN_PRODUCTS, GI_PRODUCTS } from '@/lib/constants';
import { fmt, usDate } from '@/lib/utils';
import { EmptyStateTableRow } from '../EmptyState';
import RepeatedClientBadge from '@/components/RepeatedClientBadge';

const StageBadge = ({ stage }) => {
  const s = STAGES.find(x => x.id === stage) || STAGES[0];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>{stage}</span>;
};

const CategoryBadge = ({ id }) => {
  const c = LEAD_CATEGORIES.find(x => x.id === id);
  if (!c) return <span className="text-xs text-slate-400">—</span>;
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold tracking-wide ${c.badge}`}>{id}</span>;
};

// Small color-coded badge for Main Product (grouped by family for quick scanning)
const PRODUCT_BADGE_CLASS = {
  'PREMIER ADVANTAGE':  'bg-indigo-100 text-indigo-800 border border-indigo-200',
  'PREMIER CHOICE':     'bg-violet-100 text-violet-800 border border-violet-200',
  'SECURE ADVANTAGE':   'bg-sky-100 text-sky-800 border border-sky-200',
  'HEALTH ACCESS III':  'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'ACA WRAP':           'bg-amber-100 text-amber-800 border border-amber-200',
  'SUPPY':              'bg-slate-100 text-slate-700 border border-slate-200',
};
const ProductBadge = ({ id }) => {
  if (!id) return <span className="text-xs text-slate-400">—</span>;
  const cls = PRODUCT_BADGE_CLASS[id] || 'bg-slate-100 text-slate-700 border border-slate-200';
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold tracking-wide ${cls}`}>{id}</span>;
};

function LeadsView({ leads, onNew, onEdit, onDelete, onBulkDelete, onBulkStage, onNavigate }) {
  const [q, setQ] = useState('');
  const [stageF, setStageF] = useState('');
  const [productF, setProductF] = useState('');       // family: '', 'UW', 'GI', 'OTHER', or a specific product id
  const [monthF, setMonthF] = useState('');           // 'YYYY-MM' format, or '' for all
  const [issuedNoCommissionOnly, setIssuedNoCommissionOnly] = useState(false);
  const [missingStateOnly, setMissingStateOnly] = useState(false);
  const [showRepeatedOnly, setShowRepeatedOnly] = useState(false);
  const [ageF, setAgeF] = useState(''); // '', 'over50', 'under50', 'missing'
  const [sortBy, setSortBy] = useState('closedDate');
  const [sortDir, setSortDir] = useState('desc');

  // Build the list of distinct months present in the data (from closedDate)
  const monthOptions = useMemo(() => {
    const set = new Set();
    for (const l of leads) {
      if (l.closedDate) set.add(l.closedDate.slice(0, 7));
    }
    return Array.from(set).sort().reverse();
  }, [leads]);
  const [selected, setSelected] = useState(() => new Set());

  const filtered = useMemo(() => {
    let out = leads.filter(l => {
      if (stageF && l.stage !== stageF) return false;
      // Product filter: family buckets OR specific product
      if (productF) {
        if (productF === '__none__')   { if (l.mainProduct) return false; }
        else if (productF === 'UW')    { if (!UNDERWRITTEN_PRODUCTS.includes(l.mainProduct)) return false; }
        else if (productF === 'GI')    { if (!GI_PRODUCTS.includes(l.mainProduct)) return false; }
        else if (productF === 'OTHER') {
          if (!l.mainProduct) return false;
          if (UNDERWRITTEN_PRODUCTS.includes(l.mainProduct) || GI_PRODUCTS.includes(l.mainProduct)) return false;
        }
        else if (l.mainProduct !== productF) return false;
      }
      // Month filter: closedDate must fall in the selected YYYY-MM
      if (monthF) {
        if (!l.closedDate || !l.closedDate.startsWith(monthF)) return false;
      }
      if (issuedNoCommissionOnly) {
        if (l.stage !== 'Issued') return false;
        if ((l.dealValue || 0) > 0) return false;
      }
      if (missingStateOnly) {
        if (l.state && l.state.trim() !== '') return false;
      }
      if (showRepeatedOnly && !l.previousLeadId) return false;
      // Age bucket filter — over/under 50 mirrors the USHA senior-market line.
      // Recognizes both exact age (l.age) and bucket-only entries
      // (l.ageBucket) so agents who don't track exact age aren't penalized.
      if (ageF) {
        const age = Number(l.age) || 0;
        const bucket = l.ageBucket || null;
        const isOver50 = age > 50 || bucket === 'OVER_50';
        const isUnder50 = (age > 0 && age <= 50) || bucket === 'UNDER_50';
        const isMissing = age === 0 && !bucket;
        if (ageF === 'over50' && !isOver50) return false;
        if (ageF === 'under50' && !isUnder50) return false;
        if (ageF === 'missing' && !isMissing) return false;
      }
      if (q) {
        const needle = q.toLowerCase();
        const hay = `${l.name} ${l.email} ${l.phone} ${l.notes} ${l.mainProduct || ''} ${l.policyNumber || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [leads, q, stageF, productF, monthF, issuedNoCommissionOnly, missingStateOnly, showRepeatedOnly, ageF, sortBy, sortDir]);

  const issuedNoCommissionCount = useMemo(
    () => leads.filter(l => l.stage === 'Issued' && (l.dealValue || 0) === 0).length,
    [leads]
  );
  const missingStateCount = useMemo(
    () => leads.filter(l => !l.state || l.state.trim() === '').length,
    [leads]
  );
  const ageCounts = useMemo(() => {
    let over = 0, under = 0, missing = 0;
    for (const l of leads) {
      const a = Number(l.age) || 0;
      const b = l.ageBucket || null;
      if (a > 50 || b === 'OVER_50') over++;
      else if ((a > 0 && a <= 50) || b === 'UNDER_50') under++;
      else missing++;
    }
    return { over, under, missing };
  }, [leads]);

  const sortBtn = (key, label) => (
    <button onClick={() => {
      if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setSortBy(key); setSortDir('desc'); }
    }} className="flex items-center gap-1 hover:text-slate-900">
      {label} <ArrowUpDown size={10} className={sortBy === key ? 'text-indigo-600' : 'text-slate-300'} />
    </button>
  );

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));
  const someSelected = filtered.some(l => selected.has(l.id));

  const toggleAll = () => {
    setSelected(prev => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach(l => next.delete(l.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach(l => next.add(l.id));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = () => {
    if (selected.size === 0) return;
    onBulkDelete?.([...selected], () => clearSelection());
  };

  const handleBulkStage = (stage) => {
    if (selected.size === 0 || !stage) return;
    onBulkStage?.([...selected], stage);
    clearSelection();
  };

  const exportCsv = () => {
    const headers = ['Name','Email','Phone','Age','Source','Stage','Category','Advance','Lead Cost','CRM','Campaign','Main Product','Main Premium','Association','Assoc Status','Start Date','State','Advance Mo','Day Purchased','Closed Date','Notes'];
    const rows = filtered.map(l => [
      l.name, l.email, l.phone, l.age || '', l.source, l.stage, l.leadCategory, l.dealValue, l.leadCost,
      l.crm, l.campaign, l.mainProduct, l.mainProductPremium, l.associationPlan,
      l.associationStatus, l.associationStartDate || '', l.state || '', l.advanceMonths ?? '',
      l.dateAdded, l.closedDate || '', l.notes,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="premium-card p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, phone, notes…"
                 className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
        </div>
        <select value={stageF} onChange={e => setStageF(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All stages</option>
          {STAGES.map(s => <option key={s.id}>{s.id}</option>)}
        </select>
        <select value={productF} onChange={e => setProductF(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All products</option>
          <option value="UW">UW products (Premier Adv / Choice, Secure Adv)</option>
          <option value="GI">GI products (Health Access III)</option>
          <option value="OTHER">Other (ACA Wrap, Suppy)</option>
          <option disabled>──────────</option>
          {MAIN_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
          <option value="__none__">— none —</option>
        </select>
        <select value={monthF} onChange={e => setMonthF(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" title="Filter by close date month">
          <option value="">All months</option>
          {monthOptions.map(m => {
            const [y, mo] = m.split('-');
            const label = new Date(+y, +mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            return <option key={m} value={m}>{label}</option>;
          })}
        </select>
        <select
          value={ageF}
          onChange={e => setAgeF(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          title="Filter by applicant age — over/under 50 mirrors the USHA senior-market line"
        >
          <option value="">All ages</option>
          <option value="over50">Over 50 ({ageCounts.over})</option>
          <option value="under50">Under 50 ({ageCounts.under})</option>
          <option value="missing">Age missing ({ageCounts.missing})</option>
        </select>
        <button
          onClick={() => setIssuedNoCommissionOnly(v => !v)}
          className={`border rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1 ${
            issuedNoCommissionOnly
              ? 'bg-amber-100 border-amber-300 text-amber-800'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
          title="Show only Issued leads where advance is still $0 — the ones that need a statement match or manual entry"
        >
          {issuedNoCommissionOnly ? '✓ ' : ''}Issued w/o advance{' '}
          <span className="text-xs text-slate-500">({issuedNoCommissionCount})</span>
        </button>
        <button
          onClick={() => setMissingStateOnly(v => !v)}
          className={`border rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1 ${
            missingStateOnly
              ? 'bg-amber-100 border-amber-300 text-amber-800'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
          title="Show only leads with no state assigned — quick way to spot gaps"
        >
          {missingStateOnly ? '✓ ' : ''}Missing state{' '}
          <span className="text-xs text-slate-500">({missingStateCount})</span>
        </button>
        <button
          onClick={() => setShowRepeatedOnly(v => !v)}
          className={`border rounded-lg px-3 py-2 text-sm flex items-center gap-1 ${
            showRepeatedOnly
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          Repeated clients only
        </button>
        <button onClick={exportCsv} className="border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-1">
          <Download size={14} /> Export
        </button>
        <button onClick={onNew} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-1">
          <Plus size={14} /> New Lead
        </button>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="bg-indigo-600 text-white rounded-xl px-4 py-3 flex items-center justify-between shadow">
          <div className="flex items-center gap-3">
            <button onClick={clearSelection} className="text-white/70 hover:text-white"><X size={18} /></button>
            <span className="text-sm font-medium">{selected.size} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value=""
              onChange={e => handleBulkStage(e.target.value)}
              className="bg-white text-slate-900 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
            >
              <option value="">Change stage to…</option>
              {STAGES.map(s => <option key={s.id}>{s.id}</option>)}
            </select>
            <button onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1">
              <Trash2 size={14} /> Delete {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="premium-card overflow-auto">
        <table className="w-full text-sm premium-table">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="p-2 w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allVisibleSelected; }}
                  onChange={toggleAll}
                  className="rounded accent-indigo-600 cursor-pointer"
                />
              </th>
              <th className="text-left p-2">{sortBtn('name', 'Name')}</th>
              <th className="text-left p-2">Contact</th>
              <th className="text-center p-2">{sortBtn('age', 'Age')}</th>
              <th className="text-left p-2">{sortBtn('source', 'Source')}</th>
              <th className="text-left p-2">{sortBtn('stage', 'Stage')}</th>
              <th className="text-left p-2">Category</th>
              <th className="text-left p-2">{sortBtn('mainProduct', 'Product')}</th>
              <th className="text-left p-2">Policy #</th>
              <th className="text-right p-2">{sortBtn('dealValue', 'Advance')}</th>
              <th className="text-left p-2" title="Date the deal was submitted / sold — drives Taken Rate + period filters">{sortBtn('closedDate', 'Added')}</th>
              <th className="text-left p-2" title="When you purchased the lead from your vendor">{sortBtn('dateAdded', 'Purchased')}</th>
              <th className="text-right p-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => {
              const isSel = selected.has(l.id);
              return (
                <tr
                  key={l.id}
                  className={`border-t border-slate-100 ${isSel ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="p-2" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(l.id)}
                      className="rounded accent-indigo-600 cursor-pointer"
                    />
                  </td>
                  <td className="p-2 font-medium text-slate-900 cursor-pointer" onClick={() => onEdit(l)}>
                    <div className="flex items-center gap-2">
                      <span>{l.name || <span className="text-slate-400">— no name —</span>}</span>
                      <RepeatedClientBadge lead={l} />
                    </div>
                  </td>
                  <td className="p-2 text-slate-600 text-xs cursor-pointer" onClick={() => onEdit(l)}>
                    {l.email && <div>{l.email}</div>}
                    {l.phone && <div className="text-slate-500">{l.phone}</div>}
                  </td>
                  <td className="p-2 text-center cursor-pointer" onClick={() => onEdit(l)}>
                    {l.age > 0 ? (
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold tracking-wide ${
                          l.age > 50
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                        title={l.age > 50 ? 'Over 50 — USHA senior-market rule applies' : 'Under 50'}
                      >
                        {l.age}
                      </span>
                    ) : l.ageBucket === 'OVER_50' ? (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-amber-100 text-amber-800 border border-amber-200"
                        title="Over 50 (bucket — exact age not tracked). USHA senior-market rule applies."
                      >
                        &gt;50
                      </span>
                    ) : l.ageBucket === 'UNDER_50' ? (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                        title="Under 50 (bucket — exact age not tracked)."
                      >
                        &lt;50
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-2 text-slate-700 cursor-pointer" onClick={() => onEdit(l)}>{l.source}</td>
                  <td className="p-2 cursor-pointer" onClick={() => onEdit(l)}><StageBadge stage={l.stage} /></td>
                  <td className="p-2 cursor-pointer" onClick={() => onEdit(l)}><CategoryBadge id={l.leadCategory} /></td>
                  <td className="p-2 cursor-pointer" onClick={() => onEdit(l)}><ProductBadge id={l.mainProduct} /></td>
                  <td className="p-2 text-slate-700 text-xs font-mono cursor-pointer" onClick={() => onEdit(l)} title={l.policyNumber || ''}>
                    {l.policyNumber || <span className="text-slate-300 font-sans">—</span>}
                  </td>
                  <td className="text-right p-2 text-emerald-700 font-semibold cursor-pointer" onClick={() => onEdit(l)}>{fmt(l.dealValue)}</td>
                  <td className="p-2 text-slate-500 text-xs cursor-pointer" onClick={() => onEdit(l)}>{l.closedDate ? usDate(l.closedDate) : <span className="text-slate-300">—</span>}</td>
                  <td className="p-2 text-slate-400 text-xs cursor-pointer" onClick={() => onEdit(l)}>{l.dateAdded ? usDate(l.dateAdded) : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right p-2" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => onEdit(l)} title="Edit" className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50"><Edit2 size={14} /></button>
                      <button onClick={() => onDelete(l.id)} title="Delete" className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && leads.length === 0 && (
              <EmptyStateTableRow
                colSpan={12}
                icon={Users}
                title="No leads yet"
                message="Add your first lead manually, or import your existing book of business in seconds with Smart Import."
                actions={[
                  { label: 'Add a lead', onClick: onNew, icon: Plus },
                  { label: 'Smart Import', onClick: () => onNavigate?.('upload'), icon: Upload, primary: false },
                ]}
              />
            )}
            {filtered.length === 0 && leads.length > 0 && (
              <tr><td colSpan="12" className="text-center p-8 text-slate-400">No leads match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-slate-500 text-right">Showing {filtered.length} of {leads.length}{selected.size > 0 ? ` · ${selected.size} selected` : ''}</div>
    </div>
  );
}

export default memo(LeadsView);
