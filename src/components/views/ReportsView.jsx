'use client';
import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import ReportSheet from './ReportSheet';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import {
  resolvePeriod, isSingleMonth,
  buildLeadsSoldReport, buildOverridesReport, buildChargebacksReport,
  buildExpensesReport, buildPnlReport,
} from '@/lib/reports.mjs';
import { REPORT_IDENTITY } from '@/lib/reportColors.mjs';

const REPORT_TYPES = [
  { id: 'leadsSold',   label: 'Leads Sold',  color: REPORT_IDENTITY.leadsSold },
  { id: 'overrides',   label: 'Overrides',   color: REPORT_IDENTITY.overrides },
  { id: 'chargebacks', label: 'Chargebacks', color: REPORT_IDENTITY.chargebacks },
  { id: 'expenses',    label: 'Expenses',    color: REPORT_IDENTITY.expenses },
  { id: 'pnl',         label: 'P&L Summary', color: '#10B981' },
];

const PRESETS = [
  { id: 'thisMonth',   label: 'This Month' },
  { id: 'lastMonth',   label: 'Last Month' },
  { id: 'thisQuarter', label: 'This Quarter' },
  { id: 'ytd',         label: 'YTD' },
  { id: 'lastYear',    label: 'Last Year' },
  { id: 'custom',      label: 'Custom' },
];

/**
 * Reports page. Props are the existing in-memory data stores from LeadTracker:
 *   leads, overrides, chargebacks, businessExpenses
 * plus agentName (display name) and platformBudget (number, monthly).
 */
export default function ReportsView({
  leads = [], overrides = [], chargebacks = [], businessExpenses = [],
  agentName = '', platformBudget = 0,
}) {
  const [reportId, setReportId] = useState('leadsSold');
  const [presetId, setPresetId] = useState('thisMonth');
  const [custom, setCustom] = useState({ from: '', to: '' });

  const period = useMemo(
    () => resolvePeriod(presetId, new Date(), custom),
    [presetId, custom],
  );

  // id -> label map for expense categories (built-ins; custom categories
  // fall back to their raw id, which is acceptable for v1).
  const categoryLabels = useMemo(() => {
    const m = {};
    for (const c of EXPENSE_CATEGORIES) m[c.id] = c.label;
    return m;
  }, []);

  const report = useMemo(() => {
    switch (reportId) {
      case 'overrides':   return buildOverridesReport(overrides, period);
      case 'chargebacks': return buildChargebacksReport(chargebacks, period);
      case 'expenses':    return buildExpensesReport(businessExpenses, period, {
        categoryLabels,
        budget: platformBudget,
        showBudget: isSingleMonth(presetId),
      });
      case 'pnl':         return buildPnlReport(
        { leads, overrides, chargebacks, expenses: businessExpenses }, period);
      case 'leadsSold':
      default:            return buildLeadsSoldReport(leads, period);
    }
  }, [reportId, period, presetId, leads, overrides, chargebacks,
      businessExpenses, categoryLabels, platformBudget]);

  const downloadPdf = () => {
    const prev = document.title;
    document.title = `PRIM - ${report.title} - ${period.label}`;
    window.print();
    setTimeout(() => { document.title = prev; }, 800);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="report-no-print">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileText size={22} /> Reports
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Pick a report and a period. View it here or download it as a PDF.
        </p>
      </div>

      {/* Report-type picker */}
      <div className="report-no-print grid grid-cols-2 md:grid-cols-5 gap-2">
        {REPORT_TYPES.map(t => {
          const active = t.id === reportId;
          return (
            <button
              key={t.id}
              onClick={() => setReportId(t.id)}
              className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold text-left transition ${
                active ? 'shadow-md' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              }`}
              style={active ? { borderColor: t.color, color: t.color } : undefined}
            >
              <span
                className="block w-6 h-1.5 rounded-full mb-2"
                style={{ background: t.color }}
              />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Period bar */}
      <div className="report-no-print bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden text-sm">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setPresetId(p.id)}
              className={`px-3 py-1.5 font-medium ${
                presetId === p.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {presetId === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={custom.from}
              onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-800"
            />
            <span className="text-slate-400 text-sm">to</span>
            <input
              type="date"
              value={custom.to}
              onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-800"
            />
          </div>
        )}

        <button
          onClick={downloadPdf}
          className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5"
        >
          <Download size={14} /> Download PDF
        </button>
      </div>

      {/* The report sheet */}
      <ReportSheet report={report} period={period} agentName={agentName} />
    </div>
  );
}
