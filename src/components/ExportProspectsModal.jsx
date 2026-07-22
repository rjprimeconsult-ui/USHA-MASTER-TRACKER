'use client';

/**
 * ExportProspectsModal — pick prospects (filter by source/stage + search,
 * multi-select across filter changes) and download them as a 9-column
 * demographics CSV. All CSV/filter logic lives in lib/prospectExport.mjs.
 *
 * Selection is a Set of prospect ids that SURVIVES filter changes (select all
 * Benepath, switch to Ringy, select all — both stay selected) and RESETS every
 * time the modal opens, via unmount/remount of the inner body (see below)
 * rather than an effect. Spec: 2026-07-22-prospects-csv-export-design.md §5.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Download, Search, X } from 'lucide-react';
import { GlassModal } from './motion/MotionPrimitives';
import {
  buildProspectsCsv, prospectMatchesFilters, deriveSourceOptions,
  exportFilename, NO_SOURCE,
} from '@/lib/prospectExport.mjs';

// All picker state lives in this inner body. GlassModal returns null while
// closed, so the body UNMOUNTS on close and remounts on open — giving the
// spec's reset-on-open (§5) for free from the useState initializers, with no
// setState-in-effect (repo lint rule react-hooks/set-state-in-effect).
function ExportPickerBody({ onClose, prospects, stages }) {
  const [source, setSource] = useState('');
  const [stage, setStage] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const selectAllRef = useRef(null);

  const active = useMemo(() => prospects.filter(p => p && !p.archivedAt), [prospects]);
  const sourceOptions = useMemo(() => deriveSourceOptions(prospects), [prospects]);
  const matching = useMemo(
    () => active.filter(p => prospectMatchesFilters(p, { source, stage, query })),
    [active, source, stage, query]
  );

  const matchingSelectedCount = matching.reduce((n, p) => n + (selected.has(p.id) ? 1 : 0), 0);
  const allMatchingSelected = matching.length > 0 && matchingSelectedCount === matching.length;

  // Indeterminate is a DOM property, not an attribute (spec §5.4).
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = matchingSelectedCount > 0 && !allMatchingSelected;
    }
  }, [matchingSelectedCount, allMatchingSelected]);

  const toggleOne = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Check = select all matching; uncheck = deselect matching ONLY (out-of-
  // filter selections are untouched — spec §5.4).
  const toggleAllMatching = () => setSelected(prev => {
    const next = new Set(prev);
    if (allMatchingSelected) matching.forEach(p => next.delete(p.id));
    else matching.forEach(p => next.add(p.id));
    return next;
  });

  const stageLabel = (id) => stages.find(s => s.id === id)?.label || id || '';

  const doExport = () => {
    const rows = active.filter(p => selected.has(p.id));
    if (!rows.length) return;
    const blob = new Blob([buildProspectsCsv(rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = exportFilename();
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="flex flex-col max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
        <h2 className="font-semibold text-slate-900">Export prospects to CSV</h2>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-200">
        <select value={source} onChange={e => setSource(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">All sources</option>
          {sourceOptions.map(s => (
            <option key={s} value={s}>{s === NO_SOURCE ? '(No source)' : s}</option>
          ))}
        </select>
        <select value={stage} onChange={e => setStage(e.target.value)}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">All stages</option>
          {stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search name, phone, email"
            className="w-full border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-sm" />
        </div>
      </div>

      {/* Select-all row */}
      <div className="flex items-center gap-2 px-5 py-2 border-b border-slate-200 bg-slate-50/60">
        <input ref={selectAllRef} type="checkbox" checked={allMatchingSelected}
          onChange={toggleAllMatching} className="w-4 h-4"
          aria-label={`Select all ${matching.length} matching`} />
        <span className="text-sm text-slate-600">Select all {matching.length} matching</span>
        <span className="ml-auto text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
          {selected.size} of {active.length} selected
        </span>
      </div>

      {/* Row list — the one permitted internal scroll region */}
      <div className="flex-1 overflow-y-auto min-h-[120px]">
        {matching.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8">No prospects match these filters.</p>
        )}
        {matching.map(p => (
          <label key={p.id}
            className="flex items-center gap-2.5 px-5 py-2 border-b border-slate-100 cursor-pointer hover:bg-slate-50">
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="w-4 h-4" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-slate-900 truncate">{p.name || '(no name)'}</span>
              <span className="block text-xs text-slate-400 truncate">{[p.phone, p.state].filter(Boolean).join(' · ')}</span>
            </span>
            {String(p.source || '').trim() && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
                {String(p.source).trim()}
              </span>
            )}
            <span className="text-[11px] text-slate-400 whitespace-nowrap">{stageLabel(p.stage)}</span>
          </label>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-200">
        <span className="text-[11px] text-slate-400">
          9 columns: First, Last, Full name, Phone, Email, DOB, State, ZIP, Income
        </span>
        <button onClick={doExport} disabled={selected.size === 0}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap">
          <Download size={14} /> Export {selected.size || ''}
        </button>
      </div>
    </div>
  );
}

export default function ExportProspectsModal({ open, onClose, prospects = [], stages = [] }) {
  return (
    <GlassModal open={open} onClose={onClose} maxWidth="max-w-xl">
      <ExportPickerBody onClose={onClose} prospects={prospects} stages={stages} />
    </GlassModal>
  );
}
