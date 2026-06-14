'use client';
import { useState, useMemo, memo } from 'react';
import { Upload, File, FileSpreadsheet, FileText, CheckCircle2, AlertCircle, Loader2, Sparkles, Undo2, Target, Search, GitCompare, Wallet, X } from 'lucide-react';
import {
  readWorkbook,
  hasUshaPreset,
  previewImportFromUsha,
  buildImportFromUsha,
  buildBackfillFromUsha,
  USHA_SHEET_PORTAL,
  USHA_SHEET_BOUGHT,
  detectLeadFieldFromHeader,
  readSheetForGenericImport,
  buildImportFromGeneric,
} from '@/lib/import';
import { CRMS, CAMPAIGNS, LEAD_CATEGORIES, SOURCES, OWNERS, MAIN_PRODUCTS } from '@/lib/constants';
import SmartLeadImportWizard from '../SmartLeadImportWizard';
import { parseStatementPdf, reconcileStatement, isCommissionDetailPdf } from '@/lib/statement';
import { parseSalesReport, gapDetect, dealToLead } from '@/lib/salesreport';
import { mkLead } from '@/lib/seed';
import { authedFetch } from '@/lib/authedFetch';
import { uid } from '@/lib/utils';

const MODES = [
  { id: 'history',    label: 'Historical data (Excel)',          desc: 'Bring in prior months from your spreadsheet', Icon: FileSpreadsheet },
  { id: 'statement',  label: 'Weekly Advance Statement (PDF)',   desc: 'Match paid advances to existing leads',       Icon: FileText },
  { id: 'payout',     label: 'Monthly Payout (Account Summary)', desc: 'Capture residual + association bonus payouts', Icon: Wallet },
  { id: 'salesreport', label: 'USHA SalesReport (Gap Detector)', desc: 'Compare tracker to USHA ground truth',        Icon: GitCompare },
];

function UploadView({ onImport, onUndoImport, lastImportBatch, leads = [], onApplyStatement, onApplySalesReport, onBackfill }) {
  const [mode, setMode] = useState('history');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import</h1>
        <p className="text-sm text-slate-500 mt-0.5">Bring in historical data, reconcile paid advances, or cross-check against USHA ground truth.</p>
      </div>

      {/* Mode switch */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {MODES.map(m => {
          const Icon = m.Icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`text-left p-4 rounded-xl border-2 transition ${active ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={18} className={active ? 'text-indigo-600' : 'text-slate-500'} />
                <span className={`font-semibold text-sm ${active ? 'text-indigo-900' : 'text-slate-900'}`}>{m.label}</span>
              </div>
              <p className="text-xs text-slate-600">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {mode === 'history' && (
        <HistoryImport onImport={onImport} onUndoImport={onUndoImport} lastImportBatch={lastImportBatch} leads={leads} onBackfill={onBackfill} />
      )}
      {mode === 'statement' && (
        <StatementReconcile leads={leads} onApply={onApplyStatement} />
      )}
      {mode === 'payout' && (
        <MonthlyPayoutUpload onApply={onApplyStatement} />
      )}
      {mode === 'salesreport' && (
        <SalesReportGap leads={leads} onApply={onApplySalesReport} />
      )}
    </div>
  );
}

export default memo(UploadView);

/* ======================================================================
   Historical spreadsheet import (the existing USHA-preset flow)
   ====================================================================== */
function HistoryImport({ onImport, onUndoImport, lastImportBatch, leads = [], onBackfill }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('idle');
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [wb, setWb] = useState(null);
  const [preview, setPreview] = useState(null);
  // Default to backfill when there's already data — far more common for
  // established agents than wiping and re-creating. Fresh tracker starts in Create.
  const [backfillOnly, setBackfillOnly] = useState(leads.length > 0);
  const [backfillPlan, setBackfillPlan] = useState(null);
  // Generic fallback state — used when the workbook doesn't match the USHA
  // preset and we drop into a column-mapping wizard for the agent.
  const [genericMode, setGenericMode] = useState(false);
  const [genericSheet, setGenericSheet] = useState('');
  const [genericHeaders, setGenericHeaders] = useState([]);
  const [genericPreviewRow, setGenericPreviewRow] = useState([]);
  const [genericMapping, setGenericMapping] = useState({});
  const [genericDefaults, setGenericDefaults] = useState({
    crm: 'RINGY', source: 'CRM', leadCategory: 'AGED',
    campaign: 'AGED.25', owner: 'You', mainProduct: '',
  });

  const reset = () => {
    setStatus('idle'); setError(''); setFile(null); setWb(null); setPreview(null); setBackfillPlan(null);
    setGenericMode(false); setGenericSheet(''); setGenericHeaders([]); setGenericPreviewRow([]);
    setGenericMapping({});
  };

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f); setStatus('parsing'); setError('');
    try {
      const ln = f.name.toLowerCase();
      // PDFs route to Smart Lead Import (AI). Classic mode reads
      // structured spreadsheets only.
      if (ln.endsWith('.pdf')) {
        setStatus('error');
        setError('PDF detected — please use the "Smart Lead Import (AI)" button at the top of the Upload tab. AI mode parses PDFs perfectly; classic mode is for Excel / CSV only.');
        return;
      }
      if (!ln.endsWith('.xlsx') && !ln.endsWith('.xls') && !ln.endsWith('.csv')) {
        throw new Error('Please upload a .xlsx, .xls, or .csv file. PDFs work with Smart Lead Import (AI) instead.');
      }
      const workbook = await readWorkbook(f);
      setWb(workbook);
      if (hasUshaPreset(workbook)) {
        setPreview(previewImportFromUsha(workbook));
        // Always compute the backfill plan for the current leads
        setBackfillPlan(buildBackfillFromUsha(workbook, leads));
        setStatus('ready');
      } else {
        // Fallback: drop into the generic column-mapping wizard using the
        // FIRST sheet. This lets agents import their own \"book of business\"
        // spreadsheets without renaming tabs.
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) throw new Error('Empty workbook — no sheets found.');
        const { headers, rows } = readSheetForGenericImport(workbook, firstSheet);
        if (!headers.length || !rows.length) {
          throw new Error('Could not read any rows from the first sheet. Make sure your spreadsheet has a header row + data.');
        }
        // Auto-map any column we recognize
        const auto = {};
        headers.forEach((h, i) => {
          const f = detectLeadFieldFromHeader(h);
          if (f) auto[i] = f;
        });
        setGenericSheet(firstSheet);
        setGenericHeaders(headers);
        setGenericPreviewRow(rows[0] || []);
        setGenericMapping(auto);
        setGenericMode(true);
        setStatus('ready');
      }
    } catch (e) {
      setError(e.message || String(e)); setStatus('error');
    }
  };

  const runImport = () => {
    if (!wb) return;
    setStatus('importing');
    if (genericMode) {
      const batchId = `batch_${uid()}`;
      const { leads: newLeads, stats } = buildImportFromGeneric(wb, genericSheet, genericMapping, genericDefaults, batchId);
      onImport?.(newLeads, { batchId, stats });
    } else if (backfillOnly) {
      const plan = backfillPlan || buildBackfillFromUsha(wb, leads);
      onBackfill?.(plan);
    } else {
      const batchId = `batch_${uid()}`;
      const { leads: newLeads, stats } = buildImportFromUsha(wb, { batchId });
      onImport?.(newLeads, { batchId, stats });
    }
    setStatus('done');
  };

  return (
    <div className="space-y-4">
      {lastImportBatch && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Undo2 size={16} className="text-amber-700" />
            <span className="text-slate-700">
              Last import: <b>{lastImportBatch.count}</b> lead{lastImportBatch.count !== 1 ? 's' : ''} added{' '}
              <span className="text-slate-500">({new Date(lastImportBatch.at).toLocaleString()})</span>
            </span>
          </div>
          <button onClick={onUndoImport} className="border border-amber-300 bg-white text-amber-800 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-amber-100">Undo import</button>
        </div>
      )}

      {/* Smart Import (AI) — preferred path for any non-USHA layout */}
      {status === 'idle' && (
        <div className="bg-gradient-to-br from-indigo-50 via-violet-50 to-pink-50 border border-indigo-200 rounded-2xl p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg flex-shrink-0">
              ✨
            </div>
            <div>
              <div className="font-bold text-slate-900 text-sm">Smart Import (AI)</div>
              <div className="text-xs text-slate-600">Drop ANY lead file — Excel, CSV, PDF, or screenshot. AI figures out the structure and extracts every lead.</div>
            </div>
          </div>
          <button onClick={() => setShowSmartImport(true)}
            className="bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-lg px-4 py-2 text-sm font-semibold shadow-md shadow-indigo-500/30 flex items-center gap-2 flex-shrink-0">
            ✨ Try Smart Import
          </button>
          <SmartLeadImportWizard
            open={showSmartImport}
            onClose={() => setShowSmartImport(false)}
            existingLeads={leads}
            onImport={(newLeads, opts) => {
              onImport?.(newLeads, { batchId: opts.batchId, stats: { total: newLeads.length, smartImport: true, duplicatesSkipped: opts.duplicatesSkipped } });
            }}
          />
        </div>
      )}

      {status === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer?.files?.[0]); }}
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-4">
            <Upload size={28} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Classic import</h2>
          <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
            For USHA-style spreadsheets &mdash; auto-detects tabs like <code className="bg-slate-100 rounded px-1 text-xs">{USHA_SHEET_PORTAL}</code> and <code className="bg-slate-100 rounded px-1 text-xs">{USHA_SHEET_BOUGHT}</code>. Naming is flexible.
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5 max-w-md mx-auto">
            Got a different layout? Use <strong className="text-indigo-700">Smart Import (AI)</strong> above &mdash; it figures out any structure.
          </p>
          <label className="mt-5 inline-block">
            <input type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <span className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer inline-flex items-center gap-2">
              <FileSpreadsheet size={16} /> Choose File
            </span>
          </label>
        </div>
      )}

      {status === 'parsing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
          <Loader2 size={18} className="animate-spin" /><span>Reading {file?.name}…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-red-800">Couldn&apos;t import this file</div>
              <div className="text-sm text-red-700 mt-1">{error}</div>
            </div>
            <button onClick={reset} className="text-sm text-red-700 hover:underline">Try another</button>
          </div>
        </div>
      )}

      {/* Generic mapping wizard — shows when the workbook isn't in USHA format */}
      {status === 'ready' && genericMode && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
            We didn&apos;t recognize the standard USHA layout, so we dropped into a flexible mapper. Match each column from <b>&quot;{genericSheet}&quot;</b> to a Lead field, then import.
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Map columns ({genericHeaders.length})</h3>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {genericHeaders.map((h, i) => {
                const sample = String(genericPreviewRow[i] ?? '').slice(0, 60);
                return (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-700 truncate">{h || `(column ${i + 1})`}</div>
                      <div className="text-[11px] text-slate-400 truncate">e.g. {sample || '(empty)'}</div>
                    </div>
                    <select
                      value={genericMapping[i] || ''}
                      onChange={e => setGenericMapping(m => ({ ...m, [i]: e.target.value }))}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white w-56"
                    >
                      <option value="">— Skip —</option>
                      <option value="name">Name</option>
                      <option value="phone">Phone</option>
                      <option value="email">Email</option>
                      <option value="state">State</option>
                      <option value="zip">ZIP</option>
                      <option value="age">Age</option>
                      <option value="policyNumber">Policy Number</option>
                      <option value="mainProduct">Main Product</option>
                      <option value="mainProductPremium">Monthly Premium</option>
                      <option value="associationPlan">Association Plan</option>
                      <option value="associationStartDate">Association Start Date</option>
                      <option value="closedDate">Closed / Submitted Date</option>
                      <option value="policyStatus">Policy Status</option>
                      <option value="uwStatus">UW Status</option>
                      <option value="payType">Adv / As Earned</option>
                      <option value="leadCost">Lead Cost</option>
                      <option value="dealValue">Deal Value / Commission</option>
                      <option value="leadCategory">Lead Category</option>
                      <option value="crm">CRM</option>
                      <option value="campaign">Campaign</option>
                      <option value="source">Source</option>
                      <option value="owner">Owner</option>
                      <option value="notes">Notes</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Default fallbacks for required tracker fields */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Defaults for un-mapped columns</h3>
            <p className="text-xs text-slate-500 mb-3">Used when a row doesn&apos;t have its own value for that field.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">CRM</label>
                <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-0.5" value={genericDefaults.crm}
                  onChange={e => setGenericDefaults(d => ({ ...d, crm: e.target.value }))}>
                  {CRMS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Source</label>
                <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-0.5" value={genericDefaults.source}
                  onChange={e => setGenericDefaults(d => ({ ...d, source: e.target.value }))}>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Lead Category</label>
                <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-0.5" value={genericDefaults.leadCategory}
                  onChange={e => setGenericDefaults(d => ({ ...d, leadCategory: e.target.value }))}>
                  {LEAD_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Campaign</label>
                <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-0.5" value={genericDefaults.campaign}
                  onChange={e => setGenericDefaults(d => ({ ...d, campaign: e.target.value }))}>
                  {CAMPAIGNS.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Owner</label>
                <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-0.5" value={genericDefaults.owner}
                  onChange={e => setGenericDefaults(d => ({ ...d, owner: e.target.value }))}>
                  {OWNERS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Main Product (fallback)</label>
                <select className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm mt-0.5" value={genericDefaults.mainProduct}
                  onChange={e => setGenericDefaults(d => ({ ...d, mainProduct: e.target.value }))}>
                  <option value="">— None —</option>
                  {MAIN_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={reset} className="border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-semibold">Try another file</button>
            <button onClick={runImport}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Import leads
            </button>
          </div>
        </div>
      )}

      {status === 'ready' && preview && (
        <div className="space-y-4">
          {/* Mode toggle: full import vs backfill */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
            <div className="text-xs font-bold text-slate-500 tracking-wider">MODE</div>
            <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
              <button onClick={() => setBackfillOnly(false)} className={`px-3 py-1.5 font-medium ${!backfillOnly ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Create leads</button>
              <button onClick={() => setBackfillOnly(true)} className={`px-3 py-1.5 font-medium ${backfillOnly ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Backfill only</button>
            </div>
            <div className="text-xs text-slate-500">
              {backfillOnly
                ? 'Match existing leads and fill in missing fields (age, state, premium, lead cost) — never creates duplicates.'
                : 'Create new leads for every unique row in the spreadsheet.'}
            </div>
          </div>

          {/* Duplicate warning if Create mode + matches exist */}
          {!backfillOnly && backfillPlan && backfillPlan.stats.matched > 0 && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-900">
                <b>Heads up — this will create duplicates.</b>{' '}
                <b>{backfillPlan.stats.matched}</b> rows in the spreadsheet match leads already in your tracker. Clicking
                &ldquo;Import&rdquo; will add a second copy of each. If you just want to patch missing fields (like age),
                switch to <b>Backfill only</b> mode above.
              </div>
            </div>
          )}

          {/* Create-mode preview */}
          {!backfillOnly && (
          <>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm mb-2">
              <Sparkles size={14} /> USHA preset detected — ready to import
            </div>
            <div className="text-sm text-slate-700"><b>{preview.total}</b> unique lead{preview.total !== 1 ? 's' : ''} after merging both tabs.</div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="bg-white border border-emerald-200 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">In both tabs</div>
                <div className="text-lg font-bold text-emerald-700">{preview.fromBoth}</div>
              </div>
              <div className="bg-white border border-emerald-200 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">Portal only ($0 cost)</div>
                <div className="text-lg font-bold text-indigo-700">{preview.portalOnly}</div>
              </div>
              <div className="bg-white border border-emerald-200 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">Bought only (→ Issued)</div>
                <div className="text-lg font-bold text-amber-700">{preview.boughtOnly}</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <div className="text-xs font-bold text-slate-500 tracking-wider">OUTCOME BREAKDOWN</div>
              <div className="flex items-center gap-4 text-sm">
                <div><span className="text-slate-500">Total submitted: </span><span className="font-bold text-slate-900">{preview.total}</span></div>
                <div><span className="text-slate-500">Issued: </span><span className="font-bold text-emerald-700">{preview.byStage['Issued'] || 0}</span></div>
                <div><span className="text-slate-500">Taken rate: </span><span className="font-bold text-indigo-700">{preview.total > 0 ? ((((preview.byStage['Issued'] || 0) / preview.total) * 100).toFixed(1) + '%') : '—'}</span></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {['Issued', 'Pending', 'Declined', 'Not taken', 'Withdrawn'].map(stage => {
                const count = preview.byStage[stage] || 0;
                if (count === 0) return null;
                const color = stage === 'Issued' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                           : stage === 'Pending' ? 'bg-amber-50 text-amber-800 border-amber-200'
                           : stage === 'Declined' ? 'bg-red-50 text-red-800 border-red-200'
                           : stage === 'Not taken' ? 'bg-slate-50 text-slate-700 border-slate-200'
                           : 'bg-purple-50 text-purple-800 border-purple-200';
                return <div key={stage} className={`border rounded-lg px-3 py-1.5 ${color}`}><span className="opacity-70">{stage}: </span><span className="font-bold">{count}</span></div>;
              })}
            </div>
          </div>

          {/* Sample rows (first 5) */}
          {preview.sample && preview.sample.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 tracking-wider">
                PREVIEW (first {preview.sample.length} rows)
              </div>
              <table className="w-full text-sm premium-table">
                <thead className="bg-slate-50 text-slate-600 text-xs">
                  <tr>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Source</th>
                    <th className="text-left p-2">Stage</th>
                    <th className="text-left p-2">Main Product</th>
                    <th className="text-right p-2">Premium</th>
                    <th className="text-left p-2">Association</th>
                    <th className="text-right p-2">Lead Cost</th>
                    <th className="text-right p-2">Advance</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((s, i) => {
                    const srcBadge = s.source === 'both' ? 'bg-emerald-100 text-emerald-700'
                                 : s.source === 'bought' ? 'bg-amber-100 text-amber-700'
                                 : 'bg-indigo-100 text-indigo-700';
                    const srcLabel = s.source === 'both' ? 'Both' : s.source === 'bought' ? 'Bought' : 'Portal';
                    return (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 font-medium">{s.name}</td>
                        <td className="p-2"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide ${srcBadge}`}>{srcLabel}</span></td>
                        <td className="p-2 text-slate-700">{s.stage}</td>
                        <td className="p-2 text-slate-700">{s.mainProduct || <span className="text-slate-400">—</span>}</td>
                        <td className="text-right p-2">${(s.premium || 0).toFixed(2)}</td>
                        <td className="p-2 text-slate-700">{s.assoc || <span className="text-slate-400">—</span>}</td>
                        <td className="text-right p-2">{s.bought ? `$${s.bought.cost.toFixed(2)}` : <span className="text-slate-400">—</span>}</td>
                        <td className="text-right p-2 text-emerald-700">{s.bought ? `$${s.bought.commission.toFixed(2)}` : <span className="text-slate-400">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </>
          )}

          {/* Backfill mode preview */}
          {backfillOnly && backfillPlan && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div className="flex items-center gap-2 text-indigo-900 font-semibold text-sm mb-2">
                <Sparkles size={14} /> Backfill plan
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="bg-white border border-indigo-200 rounded-lg p-2 text-center">
                  <div className="text-xs text-slate-500">Leads to update</div>
                  <div className="text-lg font-bold text-indigo-700">{backfillPlan.updates.length}</div>
                </div>
                <div className="bg-white border border-indigo-200 rounded-lg p-2 text-center">
                  <div className="text-xs text-slate-500">Spreadsheet rows matched</div>
                  <div className="text-lg font-bold text-slate-700">{backfillPlan.stats.matched}</div>
                </div>
                <div className="bg-white border border-indigo-200 rounded-lg p-2 text-center">
                  <div className="text-xs text-slate-500">Spreadsheet rows skipped</div>
                  <div className="text-lg font-bold text-slate-500">{backfillPlan.stats.skipped}</div>
                </div>
              </div>
              <div className="text-xs text-slate-600 mt-3">
                Only fills fields that are currently empty or zero (age, state, phone, email, premium, lead cost, advance, notes, association start). Never overwrites existing non-empty values.
              </div>
              {backfillPlan.updates.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-indigo-700 hover:underline">Show sample updates</summary>
                  <div className="mt-2 bg-white border border-indigo-200 rounded-lg overflow-auto max-h-60">
                    <table className="w-full text-xs premium-table">
                      <thead className="bg-indigo-50 text-slate-600 sticky top-0">
                        <tr>
                          <th className="text-left p-2">Lead</th>
                          <th className="text-left p-2">Fields to fill</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backfillPlan.updates.slice(0, 50).map(u => {
                          const lead = leads.find(l => l.id === u.leadId);
                          return (
                            <tr key={u.leadId} className="border-t border-slate-100">
                              <td className="p-2">{lead?.name || u.leadId}</td>
                              <td className="p-2 text-slate-600">
                                {Object.entries(u.patch).map(([k, v]) => (
                                  <span key={k} className="inline-block bg-slate-100 rounded px-1.5 py-0.5 mr-1 mb-1">{k}: <b>{String(v).slice(0, 40)}</b></span>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {backfillPlan.updates.length > 50 && <div className="text-xs text-slate-400 text-center p-2">+ {backfillPlan.updates.length - 50} more</div>}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
            <button
              onClick={runImport}
              disabled={backfillOnly && (!backfillPlan || backfillPlan.updates.length === 0)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                backfillOnly && (!backfillPlan || backfillPlan.updates.length === 0)
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              <Upload size={14} />
              {backfillOnly ? `Backfill ${backfillPlan?.updates.length || 0} lead${(backfillPlan?.updates.length || 0) !== 1 ? 's' : ''}` : `Import ${preview.total} leads`}
            </button>
          </div>
        </div>
      )}

      {status === 'importing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
          <Loader2 size={18} className="animate-spin" /><span>Importing leads…</span>
        </div>
      )}

      {status === 'done' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-emerald-900">Import complete</div>
              <div className="text-sm text-emerald-800 mt-1">Head to Leads or CPA Dashboard to see them. Undo available above.</div>
            </div>
            <button onClick={reset} className="bg-white border border-emerald-300 text-emerald-800 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-100">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================================================================
   UnmatchedRow — one row per unmatched statement customer, with candidate
   suggestions (fuzzy matches) AND a free-text search to pick any lead.
   ====================================================================== */
function UnmatchedRow({ unmatched, leads, onPick }) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null); // leadId when user has chosen

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q.length < 2) return [];
    return leads
      .filter(l => (l.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [search, leads]);

  const select = (leadId) => {
    setPicked(leadId);
    onPick(leadId);
  };

  const pickedLead = picked ? leads.find(l => l.id === picked) : null;

  return (
    <div className={`bg-white border rounded-lg p-2 ${picked ? 'border-indigo-400 bg-indigo-50' : 'border-amber-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900 text-sm">{unmatched.name}</div>
          <div className="text-xs text-slate-500">
            <span className="text-emerald-700 font-semibold">${unmatched.total.toFixed(2)}</span>
            {' '}across {unmatched.rows.length} policy row{unmatched.rows.length !== 1 ? 's' : ''}
          </div>
        </div>
        {picked && (
          <div className="flex items-center gap-1">
            <span className="text-xs bg-indigo-100 text-indigo-800 rounded px-2 py-0.5 font-semibold">
              → {pickedLead?.name || 'picked'}
            </span>
            <button
              onClick={() => { setPicked(null); onPick(null); }}
              className="text-slate-400 hover:text-slate-700 text-xs"
              title="Unpick"
            >✕</button>
          </div>
        )}
      </div>

      {!picked && (
        <>
          {/* Auto-suggestions from similarity score */}
          {unmatched.candidates && unmatched.candidates.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {unmatched.candidates.map(c => {
                const pct = Math.round(c.score * 100);
                const color = pct >= 85 ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                           : pct >= 70 ? 'bg-amber-50 border-amber-300 text-amber-800'
                           : 'bg-slate-50 border-slate-300 text-slate-700';
                return (
                  <button
                    key={c.leadId}
                    onClick={() => select(c.leadId)}
                    className={`text-xs border rounded px-2 py-1 hover:shadow ${color}`}
                    title={`${pct}% similar${c.leadPolicyNumber ? ' · policy ' + c.leadPolicyNumber : ''} · stage: ${c.leadStage}`}
                  >
                    {c.leadName} <span className="opacity-60">({pct}%)</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Free-text lead search */}
          <div className="mt-1.5 flex gap-1.5 items-center">
            <Search size={12} className="text-slate-400 flex-shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Or search all leads by name…"
              className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {searchHits.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {searchHits.map(l => (
                <button
                  key={l.id}
                  onClick={() => select(l.id)}
                  className="text-[11px] bg-white border border-slate-300 rounded px-2 py-0.5 hover:bg-indigo-50 hover:border-indigo-300"
                  title={`Stage: ${l.stage}${l.policyNumber ? ' · policy ' + l.policyNumber : ''}`}
                >
                  {l.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ======================================================================
   Weekly Advance Statement reconciliation (PDF) — accepts 1 or many files
   ====================================================================== */
function StatementReconcile({ leads, onApply }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | parsing | ready | error | applying | done
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);       // File[] currently being processed
  const [statements, setStatements] = useState([]);
  const [plan, setPlan] = useState(null);
  // Manual mappings the user has confirmed for previously-unmatched customers.
  // Keyed by customer nameKey → leadId.
  const [manualMatches, setManualMatches] = useState({});
  // AI parse mode: when on, route PDFs through /api/parse-statement-ai
  // instead of the regex-based parseStatementPdf. Output shape matches.
  const [aiMode, setAiMode] = useState(false);
  const [aiUsage, setAiUsage] = useState(null); // { inputTokens, cachedReadTokens, outputTokens }

  const reset = () => { setStatus('idle'); setError(''); setFiles([]); setStatements([]); setPlan(null); setManualMatches({}); setAiUsage(null); };

  // Parse one PDF via the AI route, return same shape as parseStatementPdf
  const parseStatementWithAI = async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await authedFetch('/api/parse-statement-ai', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const handleFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const fArr = Array.from(fileList);
    // Validate extensions
    const bad = fArr.filter(f => !f.name.toLowerCase().endsWith('.pdf'));
    if (bad.length > 0) {
      setError(`Non-PDF file rejected: ${bad.map(f => f.name).join(', ')}. Please upload .pdf statements only.`);
      setStatus('error');
      return;
    }
    setFiles(fArr); setStatus('parsing'); setError(''); setAiUsage(null);
    try {
      // Parse all in parallel — either via the regex parser or the AI route
      const parser = aiMode ? parseStatementWithAI : parseStatementPdf;
      const parsedArr = await Promise.all(fArr.map(f => parser(f).then(p => ({ file: f, parsed: p }))));

      // Sum AI usage across all files for the cost telemetry footer
      if (aiMode) {
        const totals = parsedArr.reduce((acc, { parsed }) => {
          const u = parsed?._usage;
          if (!u) return acc;
          acc.inputTokens += u.inputTokens || 0;
          acc.cachedReadTokens += u.cachedReadTokens || 0;
          acc.outputTokens += u.outputTokens || 0;
          return acc;
        }, { inputTokens: 0, cachedReadTokens: 0, outputTokens: 0 });
        setAiUsage(totals);
      }

      // Combine all advance/chargeback/reinstatement rows into one merged parsed object.
      // Use the FIRST statement's header for owner/tier info (they should all
      // belong to the same agent). The period becomes the span of all uploaded weeks.
      const allAdvance = [];
      const allChargebacks = [];
      const allReinstatements = [];
      const allBonuses = [];
      const perFile = [];

      for (const { file, parsed } of parsedArr) {
        // Detect "Commission Statement Detail" PDFs (28-page override-agent
        // reports). These don't contain the agent's actual payout — the user
        // should upload the 1-page Account Summary PDF instead.
        if (parsed.isDetailOnly) {
          perFile.push({
            fileName: file.name, parsed,
            warning: 'This is a Commission Statement DETAIL PDF (multi-page override-agent rows). It doesn\'t contain your actual payout. Please upload the 1-page Account Summary PDF instead — click the "Print Summary" button on each Account Summary view in the USHA portal.',
          });
          continue;
        }
        if (!parsed.advanceRows.length && !parsed.chargebackRows.length && !(parsed.bonusRows?.length)) {
          perFile.push({
            fileName: file.name, parsed,
            warning: 'No advance / chargeback / bonus rows detected — is this a USHA statement?',
          });
          continue;
        }
        // Tag each row with its source statement's period so downstream dedup
        // and the Chargebacks panel's week filter can distinguish weeks even
        // after all statements are merged into one plan.
        const stmtPeriod = parsed.header?.periodEnd || parsed.header?.periodStart || '';
        const tag = (r) => ({ ...r, _statementPeriod: stmtPeriod });
        allAdvance.push(...parsed.advanceRows.map(tag));
        allChargebacks.push(...parsed.chargebackRows.map(tag));
        allReinstatements.push(...(parsed.reinstatementRows || []).map(tag));
        allBonuses.push(...(parsed.bonusRows || []).map(tag));
        const chargebackTotal = parsed.chargebackRows.reduce((s, r) => s + Math.abs(r.reserveWithheld || 0), 0);
        const bonusTotal = (parsed.bonusRows || []).reduce((s, b) => s + (b.amount || 0), 0);
        perFile.push({
          fileName: file.name,
          header: parsed.header,
          ownCount: parsed.advanceRows.filter(r => r.writingAgent && parsed.header.owner &&
            r.writingAgent.toUpperCase().trim() === parsed.header.owner.toUpperCase().trim()).length,
          overrideCount: parsed.advanceRows.filter(r => !(r.writingAgent && parsed.header.owner &&
            r.writingAgent.toUpperCase().trim() === parsed.header.owner.toUpperCase().trim())).length,
          chargebackCount: parsed.chargebackRows.length,
          chargebackTotal,
          bonusCount: (parsed.bonusRows || []).length,
          bonusTotal,
        });
      }

      if (allAdvance.length === 0 && allChargebacks.length === 0 && allBonuses.length === 0) {
        const detailOnlyCount = perFile.filter(p => p.parsed?.isDetailOnly).length;
        if (detailOnlyCount > 0 && detailOnlyCount === perFile.length) {
          throw new Error(
            `${detailOnlyCount} file${detailOnlyCount !== 1 ? 's are' : ' is'} a Commission Statement DETAIL PDF (the multi-page override-agent reports). ` +
            `These don't contain your actual payout. ` +
            `On the USHA Advisor portal, open each Account Summary view and click the "Print Summary" button to download a 1-page Account Summary PDF — upload those instead.`
          );
        }
        throw new Error('None of the uploaded files appear to be USHA statements (no advance, chargeback, or bonus rows detected).');
      }

      // Use the first valid header as the owner anchor
      const anchorHeader = parsedArr.find(p => p.parsed.header.owner)?.parsed.header
        || { owner: '', tier: '', periodStart: '', periodEnd: '' };
      const combinedHeader = {
        ...anchorHeader,
        periodStart: perFile[0]?.header?.periodStart || anchorHeader.periodStart,
        periodEnd:   perFile[perFile.length - 1]?.header?.periodEnd || anchorHeader.periodEnd,
      };

      const merged = {
        header: combinedHeader,
        advanceRows: allAdvance,
        chargebackRows: allChargebacks,
        reinstatementRows: allReinstatements,
        bonusRows: allBonuses,
      };
      const reconciled = reconcileStatement(merged, leads);

      setStatements(perFile);
      setPlan(reconciled);
      setStatus('ready');
    } catch (e) {
      setError(e.message || String(e)); setStatus('error');
    }
  };

  // Merge manual matches into the plan: any unmatched customer whose nameKey
  // is in `manualMatches` gets promoted to `matched`, linked to the chosen lead.
  const effectivePlan = useMemo(() => {
    if (!plan) return null;
    const manuallyMatchedKeys = new Set(Object.keys(manualMatches));
    if (manuallyMatchedKeys.size === 0) return plan;

    const extraMatched = [];
    const stillUnmatched = [];
    for (const u of plan.unmatched) {
      const chosenLeadId = manualMatches[u.key];
      if (chosenLeadId) {
        const lead = leads.find(l => l.id === chosenLeadId);
        if (lead) {
          extraMatched.push({
            ...u,
            leadId: lead.id,
            currentStage: lead.stage,
            currentDealValue: lead.dealValue,
            leadName: lead.name,
            leadPolicyNumber: lead.policyNumber || '',
            total: u.total,
            _leadCount: 1,
            _manual: true,
          });
          continue;
        }
      }
      stillUnmatched.push(u);
    }
    return {
      ...plan,
      matched: [...plan.matched, ...extraMatched],
      unmatched: stillUnmatched,
    };
  }, [plan, manualMatches, leads]);

  const apply = () => {
    if (!effectivePlan) return;
    setStatus('applying');
    onApply?.(effectivePlan);
    setStatus('done');
  };

  return (
    <div className="space-y-4">
      {status === 'idle' && (
        <>
          {/* Parser mode toggle: regex (default) vs AI */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs">
              <span className="font-bold text-slate-700">Parser mode:</span>
              <span className="text-slate-500 ml-2">
                {aiMode
                  ? 'AI handles any USHA layout — recommended for unusual statements.'
                  : 'Fast regex parser — works on standard USHA weekly statements.'}
              </span>
            </div>
            <div className="flex border border-slate-200 rounded-lg overflow-hidden text-xs">
              <button onClick={() => setAiMode(false)}
                className={`px-3 py-1.5 font-semibold ${!aiMode ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Standard
              </button>
              <button onClick={() => setAiMode(true)}
                className={`px-3 py-1.5 font-semibold ${aiMode ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                ✨ Smart (AI)
              </button>
            </div>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer?.files); }}
            className={`border-2 border-dashed rounded-2xl p-10 text-center transition ${dragging ? 'border-indigo-500 bg-indigo-50' : aiMode ? 'border-violet-300 bg-gradient-to-br from-indigo-50/30 to-violet-50/30' : 'border-slate-300 bg-white'}`}
          >
            <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${aiMode ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
              {aiMode ? <span className="text-2xl">✨</span> : <FileText size={28} />}
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              {aiMode ? 'Smart Parse — Drop any USHA statement PDF' : 'Drop your Weekly Advance Statements'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {aiMode
                ? 'AI handles any layout — weekly advance, account summary, scanned/image PDFs. Output flows through the same matching pipeline.'
                : 'One or many USHA weekly PDFs. Drop them all at once — we’ll parse each, sum up advances per customer across all weeks, and apply the combined total.'}
            </p>
            <label className="mt-5 inline-block">
              <input type="file" accept=".pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <span className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer inline-flex items-center gap-2 text-white ${aiMode ? 'bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-md shadow-indigo-500/30' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                <FileText size={16} /> Choose PDF(s)
              </span>
            </label>
            <div className="text-xs text-slate-500 mt-3">Hold Ctrl (Cmd on Mac) to select multiple files at once.</div>
          </div>
        </>
      )}

      {status === 'parsing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
          <Loader2 size={18} className="animate-spin" />
          <span>Parsing {files.length} statement{files.length !== 1 ? 's' : ''}… (about 5–15s per file)</span>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-red-800">Couldn&apos;t parse the statement</div>
              <div className="text-sm text-red-700 mt-1">{error}</div>
            </div>
            <button onClick={reset} className="text-sm text-red-700 hover:underline">Try another</button>
          </div>
        </div>
      )}

      {status === 'ready' && plan && effectivePlan && (
        <div className="space-y-4">
          {/* Header summary */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            {(() => {
              const distinctPeriods = new Set();
              statements.forEach(s => {
                const p = s.header?.periodEnd || s.header?.periodStart;
                if (p) distinctPeriods.add(p);
              });
              return (
                <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm mb-2">
                  <Sparkles size={14} /> {statements.length} statement{statements.length !== 1 ? 's' : ''} parsed · {distinctPeriods.size} distinct week{distinctPeriods.size !== 1 ? 's' : ''} detected
                  {distinctPeriods.size < statements.length && (
                    <span className="text-xs font-normal text-amber-700 ml-2">⚠ Some files share the same period (duplicate statements?)</span>
                  )}
                </div>
              );
            })()}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 text-sm mb-2">
              <div className="bg-white border border-emerald-200 rounded-lg p-2">
                <div className="text-xs text-slate-500">Agent</div>
                <div className="font-semibold text-slate-900">{plan.header.owner || '—'}</div>
              </div>
              <div className="bg-white border border-emerald-200 rounded-lg p-2">
                <div className="text-xs text-slate-500">Tier / Span</div>
                <div className="font-semibold text-slate-900">{plan.header.tier || '—'} · {plan.header.periodStart || ''}–{plan.header.periodEnd || ''}</div>
              </div>
              <div className="bg-white border border-emerald-200 rounded-lg p-2">
                <div className="text-xs text-slate-500">Your own sales (total rows)</div>
                <div className="font-semibold text-emerald-700">{plan.ownSalesCount} rows</div>
              </div>
              <div className="bg-white border border-emerald-200 rounded-lg p-2">
                <div className="text-xs text-slate-500">Override rows (total)</div>
                <div className="font-semibold text-indigo-700">{plan.overridesCount}</div>
              </div>
              {(plan.bonusRows?.length || 0) > 0 && (
                <div className="bg-white border border-emerald-300 rounded-lg p-2">
                  <div className="text-xs text-slate-500">Bonuses / Residuals → Income</div>
                  <div className="font-semibold text-emerald-700">
                    +${(plan.bonusTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-xs font-normal text-slate-500"> · {plan.bonusRows.length} entr{plan.bonusRows.length !== 1 ? 'ies' : 'y'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bonus / residual entries detail */}
            {(plan.bonusRows?.length || 0) > 0 && (
              <div className="mt-2 bg-white border border-emerald-300 rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-emerald-50 text-xs font-bold text-emerald-900 tracking-wider">
                  WILL BE ADDED TO BOOKS → OTHER INCOME
                </div>
                <table className="w-full text-sm premium-table">
                  <thead className="bg-slate-50 text-slate-500 text-xs">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Source</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.bonusRows.map((b, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 text-slate-600 whitespace-nowrap">{b.transactionDate || b._statementPeriod || '—'}</td>
                        <td className="p-2 text-slate-900">{b.label}</td>
                        <td className="text-right p-2 font-semibold text-emerald-700 whitespace-nowrap">${Number(b.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="p-2 text-xs text-slate-500">{b.breakdown || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Per-file breakdown when multiple uploaded */}
            {statements.length > 1 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-emerald-900 font-medium select-none">Show per-statement breakdown ({statements.length} files)</summary>
                <div className="mt-2 bg-white border border-emerald-200 rounded-lg overflow-auto">
                  <table className="w-full text-xs premium-table">
                    <thead className="bg-emerald-50 text-slate-600">
                      <tr>
                        <th className="text-left p-2">File</th>
                        <th className="text-left p-2">Period</th>
                        <th className="text-right p-2">Own rows</th>
                        <th className="text-right p-2">Override rows</th>
                        <th className="text-right p-2">Chargebacks</th>
                        <th className="text-right p-2">Bonuses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statements.map((s, i) => (
                        <tr key={i} className="border-t border-emerald-100">
                          <td className="p-2 font-mono text-[11px] truncate max-w-[260px]" title={s.fileName}>{s.fileName}</td>
                          <td className="p-2 text-slate-600">{s.header?.periodStart || '—'} → {s.header?.periodEnd || '—'}</td>
                          <td className="text-right p-2">{s.ownCount ?? 0}</td>
                          <td className="text-right p-2">{s.overrideCount ?? 0}</td>
                          <td className="text-right p-2 text-red-600">{s.chargebackCount ? `-$${s.chargebackTotal.toFixed(2)}` : '—'}</td>
                          <td className="text-right p-2 text-emerald-700">{s.bonusCount ? `+$${s.bonusTotal.toFixed(2)} (${s.bonusCount})` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {/* Chargebacks summary */}
            {((plan.chargebacksOwnCount || 0) + (plan.chargebacksOverrideCount || 0)) > 0 && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-white border border-red-200 rounded-lg p-2">
                  <div className="text-xs text-slate-500">Own chargebacks</div>
                  <div className="font-semibold text-red-600">
                    {plan.chargebacksOwnCount} rows · -${(plan.chargebacksOwnTotal || 0).toFixed(2)}
                  </div>
                </div>
                <div className="bg-white border border-red-200 rounded-lg p-2">
                  <div className="text-xs text-slate-500">Override chargebacks</div>
                  <div className="font-semibold text-red-600">
                    {plan.chargebacksOverrideCount} rows · -${(plan.chargebacksOverrideTotal || 0).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Matched */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 tracking-wider flex items-center justify-between">
              <span>MATCHED CUSTOMERS ({effectivePlan.matched.length})</span>
              <span className="text-slate-400">These will update the existing leads</span>
            </div>
            {effectivePlan.matched.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">No matched customers. Either the statement belongs to someone else, or the customers aren&apos;t in your tracker yet.</div>
            ) : (
              <table className="w-full text-sm premium-table">
                <thead className="bg-slate-50 text-slate-600 text-xs">
                  <tr>
                    <th className="text-left p-2">Customer</th>
                    <th className="text-left p-2">Policy #</th>
                    <th className="text-right p-2">Rows</th>
                    <th className="text-right p-2">Current</th>
                    <th className="text-right p-2">New Advance</th>
                    <th className="text-left p-2">Stage change</th>
                  </tr>
                </thead>
                <tbody>
                  {effectivePlan.matched.map((m, i) => (
                    <tr key={`${m.key}-${m.leadId}`} className="border-t border-slate-100">
                      <td className="p-2 font-medium">
                        {m.name}
                        {m._leadCount > 1 && <span className="ml-1 text-[10px] text-slate-500">(split across {m._leadCount} policies)</span>}
                        {m._manual && <span className="ml-1 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">manual</span>}
                      </td>
                      <td className="p-2 text-xs text-slate-500 font-mono">{m.leadPolicyNumber || '—'}</td>
                      <td className="text-right p-2 text-slate-500">{m.rows.length}</td>
                      <td className="text-right p-2 text-slate-500">${(m.currentDealValue || 0).toFixed(2)}</td>
                      <td className="text-right p-2 text-emerald-700 font-semibold">${m.total.toFixed(2)}</td>
                      <td className="p-2 text-xs">
                        {m.currentStage === 'Issued'
                          ? <span className="text-slate-400">already Issued</span>
                          : m.currentStage === 'Pending'
                          ? <span className="text-amber-700">Pending → <b>Issued</b></span>
                          : <span className="text-slate-400">stage kept ({m.currentStage})</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Unmatched — now interactive with "Match to this lead" suggestions */}
          {effectivePlan.unmatched.length > 0 && (() => {
            const totalUnmatched = effectivePlan.unmatched.reduce((s, u) => s + u.total, 0);
            return (
              <div className="bg-amber-50 border border-amber-300 rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b border-amber-300 bg-amber-100 text-sm font-bold text-amber-900 flex items-center justify-between">
                  <span>⚠ UNMATCHED ({effectivePlan.unmatched.length}) — will be skipped unless you match them manually below</span>
                  <span className="text-amber-800">
                    ${totalUnmatched.toFixed(2)} in advances pending
                  </span>
                </div>
                <div className="p-3 text-xs text-slate-700 space-y-2 max-h-[400px] overflow-auto">
                  {effectivePlan.unmatched.sort((a, b) => b.total - a.total).map(u => (
                    <UnmatchedRow
                      key={u.key}
                      unmatched={u}
                      leads={leads}
                      selectedLeadId={null}
                      onPick={(leadId) => setManualMatches(prev => ({ ...prev, [u.key]: leadId }))}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Manual match confirmation — shows picks that are about to be applied */}
          {Object.keys(manualMatches).length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-indigo-900 font-semibold">{Object.keys(manualMatches).length} manual match{Object.keys(manualMatches).length !== 1 ? 'es' : ''} queued</span>
                <button onClick={() => setManualMatches({})} className="text-xs text-indigo-700 hover:underline">Clear all manual picks</button>
              </div>
              <div className="text-xs text-slate-600">These customers will be applied to your chosen tracker leads when you click the apply button.</div>
            </div>
          )}

          {/* Chargebacks preview */}
          {((plan.chargebacksMatched?.length || 0) + (plan.chargebacksUnmatched?.length || 0) + (plan.overrideChargebacksByAgent?.length || 0)) > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-red-200 bg-red-100 text-xs font-bold text-red-800 tracking-wider flex items-center justify-between">
                <span>CHARGEBACKS</span>
                <span className="text-red-700">
                  Own: -${(plan.chargebacksOwnTotal || 0).toFixed(2)}
                  {plan.chargebacksOverrideTotal > 0 && <> · Override: -${plan.chargebacksOverrideTotal.toFixed(2)}</>}
                </span>
              </div>
              {plan.chargebacksMatched?.length > 0 && (
                <table className="w-full text-sm premium-table">
                  <thead className="bg-red-50 text-red-700 text-xs">
                    <tr>
                      <th className="text-left p-2">Customer (matched)</th>
                      <th className="text-right p-2">Rows</th>
                      <th className="text-right p-2">Chargeback amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.chargebacksMatched.map(m => (
                      <tr key={m.key} className="border-t border-red-100">
                        <td className="p-2 font-medium">{m.name}</td>
                        <td className="text-right p-2 text-slate-500">{m.rows.length}</td>
                        <td className="text-right p-2 text-red-700 font-semibold">-${m.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {plan.chargebacksUnmatched?.length > 0 && (
                <div className="p-3 border-t border-red-100 text-xs text-slate-600">
                  <span className="font-bold">Chargebacks for customers not in your tracker:</span>{' '}
                  {plan.chargebacksUnmatched.map((u, i) => (
                    <span key={u.key} className="inline-block bg-white border border-red-200 rounded px-2 py-0.5 mx-1" title={`-$${u.amount.toFixed(2)}`}>{u.name}</span>
                  ))}
                </div>
              )}
              {plan.overrideChargebacksByAgent?.length > 0 && (
                <div className="p-3 border-t border-red-100 text-xs">
                  <div className="font-bold text-slate-600 mb-1.5">Override chargebacks (leader responsibility):</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {plan.overrideChargebacksByAgent.slice(0, 9).map(o => (
                      <div key={o.writingAgent} className="bg-white border border-red-200 rounded-lg p-2">
                        <div className="text-slate-500 truncate">{o.writingAgent}</div>
                        <div className="font-bold text-red-700">-${o.amount.toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Overrides summary (leader income) */}
          {plan.overridesByAgent.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2 text-indigo-900 font-semibold text-sm">
                <Target size={14} /> Overrides (leader income)
              </div>
              <div className="text-sm text-slate-700 mb-3">
                Total overrides this period: <b className="text-indigo-800">${plan.overridesTotal.toFixed(2)}</b> from {plan.overridesByAgent.length} writing agent{plan.overridesByAgent.length !== 1 ? 's' : ''}.
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {plan.overridesByAgent.slice(0, 9).map(o => (
                  <div key={o.writingAgent} className="bg-white border border-indigo-200 rounded-lg p-2 text-xs">
                    <div className="text-slate-500 truncate">{o.writingAgent}</div>
                    <div className="font-bold text-indigo-700">${o.total.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
            {(() => {
              const matchedCount = effectivePlan.matched?.length || 0;
              const cbCount = (plan.chargebacksMatched?.length || 0) + (plan.chargebacksUnmatched?.length || 0);
              const ovrCount = plan.overridesByAgent?.length || 0;
              const bonusCount = plan.bonusRows?.length || 0;
              const hasWork = matchedCount + cbCount + ovrCount + bonusCount > 0;
              let label;
              if      (matchedCount > 0)              label = `Apply to ${matchedCount} lead${matchedCount !== 1 ? 's' : ''} & record statement`;
              else if (cbCount + ovrCount > 0)        label = 'Record chargebacks & overrides';
              else if (bonusCount > 0)                label = `Add ${bonusCount} bonus${bonusCount !== 1 ? 'es' : ''} to income`;
              else                                    label = 'Nothing to apply';
              return (
                <button
                  onClick={apply}
                  disabled={!hasWork}
                  className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${hasWork ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                >
                  <CheckCircle2 size={14} /> {label}
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {status === 'applying' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
          <Loader2 size={18} className="animate-spin" /><span>Applying advances…</span>
        </div>
      )}

      {status === 'done' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-emerald-900">Statement applied</div>
              <div className="text-sm text-emerald-800 mt-1">Matched leads updated with advances and (where applicable) promoted to Issued. Check the CPA Dashboard and Leads tab.</div>
            </div>
            <button onClick={reset} className="bg-white border border-emerald-300 text-emerald-800 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-100">Upload another</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================================================================
   SalesReport Gap Detector — compare tracker to USHA ground truth
   ====================================================================== */
function SalesReportGap({ leads, onApply }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | parsing | ready | error | applying | done
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [diff, setDiff] = useState(null);
  // What the user opts to do: add missing + update mismatched stages
  const [addMissing, setAddMissing] = useState(new Set());    // Set of appIdBase keys
  const [fixStages, setFixStages] = useState(new Set());      // Set of leadIds

  const reset = () => { setStatus('idle'); setError(''); setFile(null); setDiff(null); setAddMissing(new Set()); setFixStages(new Set()); };

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f); setStatus('parsing'); setError('');
    try {
      const ln = f.name.toLowerCase();
      if (!ln.endsWith('.xlsx') && !ln.endsWith('.xls')) throw new Error('Please upload a .xlsx SalesReport export.');
      const wb = await readWorkbook(f);
      const parsed = parseSalesReport(wb);
      if (!parsed.deals.length) throw new Error('No deals detected — is this a USHA SalesReport?');
      const gap = gapDetect(parsed.deals, leads);
      setDiff({ ...gap, allRows: parsed.allRows, totalDeals: parsed.deals.length });
      // Pre-select all missing & all mismatched for convenience
      setAddMissing(new Set(gap.missing.map(d => d.appIdBase)));
      setFixStages(new Set(gap.mismatched.map(m => m.lead.id)));
      setStatus('ready');
    } catch (e) {
      setError(e.message || String(e)); setStatus('error');
    }
  };

  const apply = () => {
    if (!diff) return;
    setStatus('applying');
    const dealsToAdd = diff.missing.filter(d => addMissing.has(d.appIdBase)).map(d => dealToLead(d, mkLead));
    const stageUpdates = diff.mismatched
      .filter(m => fixStages.has(m.lead.id))
      .map(m => ({ leadId: m.lead.id, issues: m.issues }))
      .filter(u => u.issues && u.issues.length > 0);
    onApply?.({ leadsToAdd: dealsToAdd, stageUpdates });
    setStatus('done');
  };

  const toggleAddMissing = (key) => setAddMissing(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleFixStage = (id) => setFixStages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="space-y-4">
      {status === 'idle' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer?.files?.[0]); }}
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mb-4">
            <GitCompare size={28} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Drop your USHA SalesReport</h2>
          <p className="text-sm text-slate-600 mt-1">
            Export all policies from the USHA portal as .xlsx and drop it here. We&apos;ll diff it against your tracker and show you what&apos;s missing, mismatched, or extra.
          </p>
          <label className="mt-5 inline-block">
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <span className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer inline-flex items-center gap-2">
              <GitCompare size={16} /> Choose SalesReport
            </span>
          </label>
        </div>
      )}

      {status === 'parsing' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
          <Loader2 size={18} className="animate-spin" /><span>Parsing {file?.name}…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-red-800">Couldn&apos;t parse the file</div>
              <div className="text-sm text-red-700 mt-1">{error}</div>
            </div>
            <button onClick={reset} className="text-sm text-red-700 hover:underline">Try another</button>
          </div>
        </div>
      )}

      {status === 'ready' && diff && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-900 font-semibold text-sm mb-2">
              <Sparkles size={14} /> {diff.totalDeals} deals in SalesReport · diff vs {leads.length} leads in tracker
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="bg-white border border-amber-200 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">Missing from tracker</div>
                <div className="text-lg font-bold text-amber-700">{diff.missing.length}</div>
              </div>
              <div className="bg-white border border-indigo-200 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">Mismatched stage/product</div>
                <div className="text-lg font-bold text-indigo-700">{diff.mismatched.length}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2 text-center">
                <div className="text-xs text-slate-500">In tracker, not in report</div>
                <div className="text-lg font-bold text-slate-600">{diff.extras.length}</div>
              </div>
            </div>
          </div>

          {/* Missing */}
          {diff.missing.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 bg-amber-50 text-xs font-bold text-amber-800 tracking-wider flex items-center justify-between">
                <span>MISSING FROM TRACKER ({diff.missing.length})</span>
                <div className="flex gap-3 text-[10px] normal-case tracking-normal">
                  <button onClick={() => setAddMissing(new Set(diff.missing.map(d => d.appIdBase)))} className="text-indigo-700 hover:underline">Select all</button>
                  <button onClick={() => setAddMissing(new Set())} className="text-slate-600 hover:underline">Clear all</button>
                </div>
              </div>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm premium-table">
                  <thead className="bg-slate-50 text-slate-600 text-xs sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="text-left p-2">Customer</th>
                      <th className="text-left p-2">Main Product</th>
                      <th className="text-right p-2">Premium/mo</th>
                      <th className="text-left p-2">Association</th>
                      <th className="text-left p-2">Stage</th>
                      <th className="text-left p-2">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.missing.map(d => (
                      <tr key={d.appIdBase} className={`border-t border-slate-100 ${addMissing.has(d.appIdBase) ? 'bg-amber-50' : ''}`}>
                        <td className="p-2"><input type="checkbox" checked={addMissing.has(d.appIdBase)} onChange={() => toggleAddMissing(d.appIdBase)} className="rounded accent-indigo-600" /></td>
                        <td className="p-2 font-medium">{d.name}</td>
                        <td className="p-2">{d.mainProduct || <span className="text-slate-400">(orphan assoc)</span>}</td>
                        <td className="text-right p-2">${d.mainMonthlyPremium.toFixed(2)}</td>
                        <td className="p-2 text-slate-600">{d.associationPlan || <span className="text-slate-300">—</span>}</td>
                        <td className="p-2"><span className="text-xs bg-slate-100 text-slate-700 rounded px-2 py-0.5">{d.stage}</span></td>
                        <td className="p-2 text-xs text-slate-500">{d.submitDate || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Mismatched */}
          {diff.mismatched.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 bg-indigo-50 text-xs font-bold text-indigo-800 tracking-wider flex items-center justify-between">
                <span>MISMATCHED ({diff.mismatched.length}) — tracker differs from SalesReport</span>
                <div className="flex gap-3 text-[10px] normal-case tracking-normal">
                  <button onClick={() => setFixStages(new Set(diff.mismatched.map(m => m.lead.id)))} className="text-indigo-700 hover:underline">Select all</button>
                  <button onClick={() => setFixStages(new Set())} className="text-slate-600 hover:underline">Clear all</button>
                </div>
              </div>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm premium-table">
                  <thead className="bg-slate-50 text-slate-600 text-xs sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="text-left p-2">Customer</th>
                      <th className="text-left p-2">Issue</th>
                      <th className="text-left p-2">Tracker has</th>
                      <th className="text-left p-2">Report says</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.mismatched.map(m => (
                      <tr key={m.lead.id} className={`border-t border-slate-100 ${fixStages.has(m.lead.id) ? 'bg-indigo-50' : ''}`}>
                        <td className="p-2"><input type="checkbox" checked={fixStages.has(m.lead.id)} onChange={() => toggleFixStage(m.lead.id)} className="rounded accent-indigo-600" /></td>
                        <td className="p-2 font-medium">{m.lead.name}</td>
                        <td className="p-2">
                          {m.issues.map((x, i) => <div key={i} className="text-xs text-slate-600">{x.kind}</div>)}
                        </td>
                        <td className="p-2 text-slate-600">
                          {m.issues.map((x, i) => <div key={i}>{x.current || <span className="text-slate-400">—</span>}</div>)}
                        </td>
                        <td className="p-2 font-medium text-indigo-700">
                          {m.issues.map((x, i) => <div key={i}>{x.expected || <span className="text-slate-400">—</span>}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Extras — informational only */}
          {diff.extras.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="text-xs font-bold text-slate-500 tracking-wider mb-2">
                IN TRACKER, NOT IN REPORT ({diff.extras.length})
                <span className="normal-case text-slate-400 font-normal ml-2">— review manually; these leads may be stale or outside the export window</span>
              </div>
              <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                {diff.extras.slice(0, 60).map(l => (
                  <span key={l.id} className="bg-slate-100 text-slate-700 text-xs rounded px-2 py-0.5" title={`stage: ${l.stage}${l.policyNumber ? ' · ' + l.policyNumber : ''}`}>{l.name}</span>
                ))}
                {diff.extras.length > 60 && <span className="text-xs text-slate-400 self-center">+ {diff.extras.length - 60} more</span>}
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
            <button
              onClick={apply}
              disabled={addMissing.size === 0 && fixStages.size === 0}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${addMissing.size + fixStages.size > 0 ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
            >
              <CheckCircle2 size={14} />
              {addMissing.size > 0 && `Add ${addMissing.size} lead${addMissing.size !== 1 ? 's' : ''}`}
              {addMissing.size > 0 && fixStages.size > 0 && ' · '}
              {fixStages.size > 0 && `Fix ${fixStages.size} stage${fixStages.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {status === 'applying' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
          <Loader2 size={18} className="animate-spin" /><span>Applying changes…</span>
        </div>
      )}

      {status === 'done' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-emerald-900">Tracker synced</div>
              <div className="text-sm text-emerald-800 mt-1">New leads added and stage mismatches corrected. Check the Leads tab to verify, then enrich lead cost / source fields manually where needed.</div>
            </div>
            <button onClick={reset} className="bg-white border border-emerald-300 text-emerald-800 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-emerald-100">Run another diff</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================================================================
   Monthly Payout (Account Summary) — capture residual + association bonus
   payouts from the 1-page Account Summary PDF download.
   ====================================================================== */
function MonthlyPayoutUpload({ onApply }) {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | parsing | ready | error | applying
  const [error, setError] = useState('');
  const [results, setResults] = useState([]); // [{file, bonusRows, rawText, error}]
  const [showDebug, setShowDebug] = useState(false);
  const [aiMode, setAiMode] = useState(false);

  const reset = () => {
    setFiles([]); setStatus('idle'); setError(''); setResults([]); setShowDebug(false);
  };

  const parseStatementWithAI = async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await authedFetch('/api/parse-statement-ai', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  const onFiles = async (selected) => {
    const fArr = Array.from(selected || []);
    if (fArr.length === 0) return;
    const bad = fArr.filter(f => !f.name.toLowerCase().endsWith('.pdf'));
    if (bad.length > 0) {
      setError(`Non-PDF file rejected: ${bad.map(f => f.name).join(', ')}.`);
      setStatus('error');
      return;
    }
    setFiles(fArr); setStatus('parsing'); setError('');
    try {
      const { isPreliminaryAccountSummary, getAccountSummaryPeriod } = await import('@/lib/statement');
      const out = [];
      const parser = aiMode ? parseStatementWithAI : parseStatementPdf;
      for (const f of fArr) {
        try {
          const parsed = await parser(f);
          const rawText = parsed._rawText || '';
          // Distinguish PRELIMINARY (still pending USHA finalization on
          // the 5th) from genuinely unparseable. Preliminary statements
          // shouldn't be imported because amounts can change.
          const isPrelim = rawText && isPreliminaryAccountSummary(rawText);
          const period = rawText ? getAccountSummaryPeriod(rawText) : null;
          out.push({
            file: f,
            bonusRows: parsed.bonusRows || [],
            rawText,
            isPreliminary: isPrelim,
            period,
          });
        } catch (e) {
          out.push({ file: f, bonusRows: [], rawText: '', error: e.message || String(e) });
        }
      }
      setResults(out);
      setStatus('ready');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('error');
    }
  };

  const allBonuses = useMemo(() => {
    const list = [];
    for (const r of results) {
      const stmtPeriod = r.bonusRows[0]?.transactionDate || '';
      list.push(...r.bonusRows.map(b => ({ ...b, _statementPeriod: stmtPeriod, _fileName: r.file.name })));
    }
    return list;
  }, [results]);

  const totalAmount = allBonuses.reduce((s, b) => s + Number(b.amount || 0), 0);
  // Split files-with-no-bonuses into two buckets so the UI can give
  // accurate guidance: preliminary statements aren't really errors, they
  // just can't be imported yet.
  const filesPreliminary = results.filter(r => r.bonusRows.length === 0 && r.isPreliminary);
  const filesWithoutBonuses = results.filter(r => r.bonusRows.length === 0 && !r.isPreliminary);

  // Format "MM/DD/YYYY" -> "May 5, 2026" for the preliminary release-date hint
  const formatReleaseDate = (periodEnd) => {
    if (!periodEnd) return null;
    const m = periodEnd.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    let yr = Number(m[3]); if (yr < 100) yr += 2000;
    const mo = Number(m[1]);
    // Final payout released on the 5th of the next month
    const next = new Date(yr, mo, 5);
    return next.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const apply = () => {
    if (allBonuses.length === 0) return;
    setStatus('applying');
    onApply({
      header: { owner: '', tier: '', periodStart: '', periodEnd: '' },
      matched: [],
      chargebacksMatched: [],
      chargebacksUnmatched: [],
      overrideChargebacksByAgent: [],
      overridesByAgent: [],
      bonusRows: allBonuses,
    });
    // Reset after a beat so UI feels responsive
    setTimeout(() => reset(), 300);
  };

  if (status === 'idle' || status === 'error') {
    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs">
            <span className="font-bold text-slate-700">Parser mode:</span>
            <span className="text-slate-500 ml-2">
              {aiMode ? 'AI handles any layout — recommended for unusual or scanned PDFs.' : 'Fast regex parser — works on standard Account Summary PDFs.'}
            </span>
          </div>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden text-xs">
            <button onClick={() => setAiMode(false)}
              className={`px-3 py-1.5 font-semibold ${!aiMode ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              Standard
            </button>
            <button onClick={() => setAiMode(true)}
              className={`px-3 py-1.5 font-semibold ${aiMode ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              ✨ Smart (AI)
            </button>
          </div>
        </div>
        <div className={`bg-white border-2 border-dashed rounded-xl p-10 text-center ${aiMode ? 'border-violet-300 bg-gradient-to-br from-indigo-50/30 to-violet-50/30' : 'border-slate-300'}`}>
          {aiMode ? <span className="text-3xl block mb-3">✨</span> : <Wallet className="mx-auto mb-3 text-indigo-500" size={36} />}
          <h2 className="text-lg font-semibold text-slate-900">
            {aiMode ? 'Smart Parse — Drop your Account Summary PDFs' : 'Drop your Account Summary PDFs'}
          </h2>
          <p className="text-sm text-slate-600 mt-1 max-w-xl mx-auto">
            One-page PDFs from the USHA portal &ldquo;Print Summary&rdquo; button. Each captures one month&rsquo;s payout
            (Primary + Secondary + Association Bonus) — flows into Books → Other Income.
            {aiMode && ' AI mode handles scanned/image PDFs and any layout variants.'}
          </p>
          <label className={`mt-4 inline-flex items-center gap-2 text-white rounded-lg px-4 py-2 text-sm font-medium cursor-pointer ${aiMode ? 'bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-md shadow-indigo-500/30' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
            <Upload size={14} /> Choose PDFs
            <input
              type="file"
              accept=".pdf"
              multiple
              onChange={(e) => onFiles(e.target.files)}
              className="hidden"
            />
          </label>
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 text-left">
              <div className="font-semibold mb-1 flex items-center gap-2">
                <AlertCircle size={14} /> {error}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (status === 'parsing') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
        <Loader2 size={18} className="animate-spin" /><span>Reading {files.length} PDF{files.length !== 1 ? 's' : ''}…</span>
      </div>
    );
  }

  if (status === 'applying') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center gap-3 text-slate-600">
        <Loader2 size={18} className="animate-spin" /><span>Adding to Books…</span>
      </div>
    );
  }

  // status === 'ready'
  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="font-semibold text-emerald-900">
            <Sparkles size={14} className="inline mr-1.5 -mt-0.5" />
            {results.length} file{results.length !== 1 ? 's' : ''} parsed · {allBonuses.length} payout{allBonuses.length !== 1 ? 's' : ''} detected · ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
          </div>
          <button onClick={reset} className="text-xs text-emerald-800 underline">Choose different files</button>
        </div>
      </div>

      {allBonuses.length > 0 && (
        <div className="bg-white border border-emerald-300 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-emerald-50 text-xs font-bold text-emerald-900 tracking-wider">
            WILL BE ADDED TO BOOKS → OTHER INCOME (Renewal category)
          </div>
          <table className="w-full text-sm premium-table">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left p-2">File</th>
                <th className="text-left p-2">Release Date</th>
                <th className="text-left p-2">Source</th>
                <th className="text-right p-2">Total</th>
                <th className="text-left p-2">Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {allBonuses.map((b, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-2 text-xs font-mono text-slate-600 truncate max-w-[200px]" title={b._fileName}>{b._fileName}</td>
                  <td className="p-2 text-slate-700 whitespace-nowrap">{b.transactionDate || '—'}</td>
                  <td className="p-2 text-slate-900">{b.label}</td>
                  <td className="text-right p-2 font-semibold text-emerald-700 whitespace-nowrap">${Number(b.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="p-2 text-xs text-slate-500">{b.breakdown || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-bold">
              <tr className="border-t-2 border-slate-300">
                <td colSpan={3} className="p-2 text-xs uppercase text-slate-600 tracking-wider">Total</td>
                <td className="text-right p-2 text-emerald-700">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {filesPreliminary.length > 0 && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
          <div className="flex items-center gap-2 font-semibold text-sky-900 mb-2">
            <AlertCircle size={14} /> {filesPreliminary.length} file{filesPreliminary.length !== 1 ? 's' : ''} {filesPreliminary.length === 1 ? 'is' : 'are'} still preliminary — not imported
          </div>
          <p className="text-sm text-sky-900 mb-2">
            USHA hasn&apos;t finalized {filesPreliminary.length === 1 ? 'this payout' : 'these payouts'} yet. Final payouts release on the <b>5th of the following month</b> — re-upload after that and PRIM will record the residual.
          </p>
          <ul className="text-sm text-sky-900 space-y-1">
            {filesPreliminary.map((r, i) => {
              const releaseLabel = formatReleaseDate(r.period?.periodEnd);
              return (
                <li key={i} className="font-mono text-xs">
                  · {r.file.name}
                  {releaseLabel && <span className="text-sky-700"> — final by {releaseLabel}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {filesWithoutBonuses.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-900 mb-2">
            <AlertCircle size={14} /> {filesWithoutBonuses.length} file{filesWithoutBonuses.length !== 1 ? 's' : ''} couldn&rsquo;t be parsed
          </div>
          <ul className="text-sm text-amber-900 space-y-1 mb-2">
            {filesWithoutBonuses.map((r, i) => (
              <li key={i} className="font-mono text-xs">· {r.file.name}{r.error ? ` — ${r.error}` : ''}</li>
            ))}
          </ul>
          <button
            onClick={() => setShowDebug(v => !v)}
            className="text-xs text-amber-900 underline"
          >
            {showDebug ? 'Hide' : 'Show'} extracted text (debug — paste this if you need help)
          </button>
          {showDebug && (
            <div className="mt-2 space-y-3">
              {filesWithoutBonuses.map((r, i) => (
                <div key={i} className="bg-white border border-amber-300 rounded-lg p-2">
                  <div className="text-xs font-mono font-bold text-slate-700 mb-1">{r.file.name}</div>
                  <pre className="text-[10px] font-mono text-slate-600 max-h-48 overflow-auto whitespace-pre-wrap">{r.rawText.slice(0, 2000) || '(no text extracted)'}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={reset} className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm hover:bg-slate-50">Cancel</button>
        <button
          onClick={apply}
          disabled={allBonuses.length === 0}
          className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${allBonuses.length > 0 ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
        >
          <CheckCircle2 size={14} /> Add {allBonuses.length} payout{allBonuses.length !== 1 ? 's' : ''} to income
        </button>
      </div>
    </div>
  );
}
