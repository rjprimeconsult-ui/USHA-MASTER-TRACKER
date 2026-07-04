'use client';
import { useRef, useState } from 'react';
import { Upload, FileText, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import {
  parseCommissionDetail,
  mergeResidualRows,
  deriveAgentRates,
  netEarned,
  activeBook,
} from '@/lib/associationResiduals';
import { fmt2 } from '@/lib/utils';
import { GlassModal } from './motion/MotionPrimitives';

/**
 * CommissionDetail.csv uploader for the Associations tab.
 *
 * Two-step flow: parse + preview, then commit. The preview shows what
 * we'll add (period, agent name, row counts, net total) so the user
 * can sanity-check before writing to storage. Re-imports of the same
 * file are idempotent — duplicates are silently skipped.
 *
 * Props:
 *   existingRows  — current array from association_bonus_detail_v1
 *   onCommit({ rows, rates, addedCount }) — caller persists + closes
 *   onClose()
 */
export default function AssociationCommissionDetailImport({ existingRows = [], onCommit, onClose }) {
  const fileInputRef = useRef(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);  // { parse, merge, rates }
  const [error, setError] = useState('');
  const [committing, setCommitting] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setError('');
    setPreview(null);
    setParsing(true);
    try {
      const text = await file.text();
      const parse = parseCommissionDetail(text);
      if (parse.rows.length === 0) {
        throw new Error('No Association Bonus rows found in this file.');
      }
      const merge = mergeResidualRows(existingRows, parse.rows);
      const rates = deriveAgentRates(merge.merged);
      setPreview({ parse, merge, rates, fileName: file.name });
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setParsing(false);
    }
  };

  const onPick = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  const onCommitClick = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      await onCommit({
        rows: preview.merge.merged,
        rates: preview.rates,
        addedCount: preview.merge.added,
        skippedCount: preview.merge.skipped,
      });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <GlassModal open onClose={onClose} maxWidth="max-w-2xl" zIndexClass="z-40" className="max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <FileText size={18} className="text-indigo-600" />
              Import CommissionDetail.csv
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Loads your Association Bonus residual book for accurate per-tier rates.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {!preview && (
            <>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-xl p-8 text-center cursor-pointer transition bg-indigo-50/30"
              >
                <Upload className="mx-auto text-indigo-500 mb-2" size={32} />
                <p className="font-semibold text-slate-700 text-sm">Drop CommissionDetail.csv here</p>
                <p className="text-xs text-slate-500 mt-1">or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onPick}
                  className="hidden"
                />
              </div>

              <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1.5">
                <div className="font-semibold text-slate-700">What this does</div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Reads <span className="font-mono">MarketChannel = &quot;Association Bonus&quot;</span> rows only — non-AB rows are ignored.</li>
                  <li>Derives your <em>actual</em> per-tier rate from observed payouts. (Your tier upgrades automatically when you upload a newer file.)</li>
                  <li>Stores in an isolated table — never affects Leads, Books, Earned KPI, or True CPA.</li>
                  <li>Re-uploading the same file is safe — duplicates are skipped.</li>
                </ul>
              </div>

              {parsing && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Loader2 size={14} className="animate-spin" /> Parsing file…
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          {preview && (
            <PreviewPanel
              preview={preview}
              onCancel={() => setPreview(null)}
              onCommit={onCommitClick}
              committing={committing}
            />
          )}
        </div>
    </GlassModal>
  );
}

function PreviewPanel({ preview, onCancel, onCommit, committing }) {
  const { parse, merge, rates } = preview;
  const newRowsOnly = parse.rows.slice(0, parse.rows.length); // for net total display
  const incomingNet = netEarned(newRowsOnly);
  const mergedActive = activeBook(merge.merged);
  const planCount = Object.keys(rates).length;

  return (
    <>
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
        <CheckCircle2 size={18} className="text-emerald-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-emerald-900">
          <div className="font-semibold">Looks good. Review and import.</div>
          <div className="text-xs mt-0.5">
            Agent: <span className="font-mono">{parse.agentName || '—'}</span>{parse.agentNumber ? ` (${parse.agentNumber})` : ''}
            {parse.periods.length > 0 && <> · Production months: {parse.periods.join(', ')}</>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Rows in file" value={parse.rows.length} />
        <Stat label="Net total in this file" value={fmt2(incomingNet)} />
        <Stat label="New rows (will be added)" value={merge.added} highlight />
        <Stat label="Already imported (skipped)" value={merge.skipped} muted />
      </div>

      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs text-indigo-900">
        <div className="font-semibold mb-1.5">Derived agent rates ({planCount} tier{planCount !== 1 ? 's' : ''})</div>
        {planCount === 0
          ? <div className="text-indigo-700">No mappable plan tiers detected — file may contain only ACA wraps or unknown products.</div>
          : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {Object.entries(rates)
                .sort(([, a], [, b]) => (b.currentRate || 0) - (a.currentRate || 0))
                .map(([planId, info]) => (
                  <div key={planId} className="flex justify-between border-b border-indigo-100 pb-0.5 last:border-0">
                    <span className="font-medium">{planId}</span>
                    <span className="font-mono">{fmt2(info.currentRate)}/mo</span>
                  </div>
                ))}
            </div>
          )}
      </div>

      {parse.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 space-y-1">
          {parse.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600">
        After import: <span className="font-semibold">{mergedActive.count}</span> active subscribers paying
        you <span className="font-semibold">{fmt2(mergedActive.monthly)}/mo</span>
        {mergedActive.period && <> as of <span className="font-mono">{mergedActive.period}</span></>}.
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          disabled={committing}
          className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          Choose different file
        </button>
        <button
          onClick={onCommit}
          disabled={committing || merge.added === 0}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-2 disabled:bg-slate-300"
        >
          {committing
            ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
            : <><CheckCircle2 size={14} /> Import {merge.added} new row{merge.added !== 1 ? 's' : ''}</>}
        </button>
      </div>
    </>
  );
}

function Stat({ label, value, highlight, muted }) {
  return (
    <div className={`rounded-lg p-3 border ${highlight ? 'bg-indigo-50 border-indigo-200' : muted ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'}`}>
      <div className={`text-xs ${muted ? 'text-slate-500' : 'text-slate-500'}`}>{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-indigo-700' : muted ? 'text-slate-500' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}
