'use client';
import { useState } from 'react';
import { Plus, Trash2, Clock, TrendingUp, Wand2 } from 'lucide-react';
import { uid, today, usDate } from '@/lib/utils';
import { currentAdvanceMonths, getAdvanceMonthsForDate, DEFAULT_ADVANCE_MONTHS } from '@/lib/commission';

export default function AdvanceMonthsHistoryEditor({ history, onChange, onApplyToExistingLeads, existingLeadCount = 0 }) {
  const [draftDate, setDraftDate] = useState(today());
  const [draftMonths, setDraftMonths] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const sorted = [...history].sort((a, b) => (b.effectiveDate || '').localeCompare(a.effectiveDate || ''));
  const current = currentAdvanceMonths(history, DEFAULT_ADVANCE_MONTHS);

  const add = () => {
    const months = parseFloat(draftMonths);
    if (!draftDate || !Number.isFinite(months)) return;
    const entry = {
      id: uid(),
      effectiveDate: draftDate,
      months,
      notes: draftNotes.trim(),
      createdAt: new Date().toISOString(),
    };
    onChange([...history, entry]);
    setDraftDate(today());
    setDraftMonths('');
    setDraftNotes('');
  };

  const remove = (id) => {
    onChange(history.filter(h => h.id !== id));
  };

  return (
    <div className="space-y-3">
      {/* Current value */}
      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <TrendingUp size={14} className="text-emerald-700" />
          <span className="text-slate-600">Currently active:</span>
          <span className="font-bold text-emerald-800">{current} months</span>
        </div>
        <span className="text-xs text-slate-500">drives default for new leads</span>
      </div>

      {/* Add new entry */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
        <div className="text-xs font-bold text-slate-500 tracking-wider">LOG A CHANGE</div>
        <div className="grid grid-cols-[130px_100px_1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Effective date</label>
            <input
              type="date"
              value={draftDate}
              onChange={e => setDraftDate(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Months</label>
            <input
              type="number"
              step="0.5"
              min="0"
              max="12"
              placeholder="e.g. 7.5"
              value={draftMonths}
              onChange={e => setDraftMonths(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. 60% taken rate bump"
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
            />
          </div>
          <button
            onClick={add}
            disabled={!draftDate || !draftMonths}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-1 ${draftDate && draftMonths ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* History timeline */}
      {sorted.length === 0 ? (
        <div className="text-xs text-slate-400 italic text-center py-2">No changes logged yet — defaults to {DEFAULT_ADVANCE_MONTHS} months for all leads.</div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-left p-2">Effective date</th>
                <th className="text-right p-2">Months</th>
                <th className="text-left p-2">Note</th>
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(h => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="p-2 flex items-center gap-1 text-slate-700">
                    <Clock size={11} className="text-slate-400" />
                    {usDate(h.effectiveDate)}
                  </td>
                  <td className="text-right p-2 font-bold text-indigo-700">{h.months}</td>
                  <td className="p-2 text-xs text-slate-500">{h.notes || <span className="text-slate-300">—</span>}</td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => remove(h.id)}
                      className="text-slate-400 hover:text-red-600 p-1"
                      title="Delete entry"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-500 italic">
        New leads auto-fill their &ldquo;Advance Months&rdquo; with the value active on the lead&apos;s close date. Existing leads keep whatever months value they were saved with — you can still override per-lead from the form.
      </div>

      {/* Retroactive apply */}
      {sorted.length > 0 && existingLeadCount > 0 && onApplyToExistingLeads && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <Wand2 size={14} className="text-indigo-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1 text-xs text-slate-700">
              <div className="font-semibold text-indigo-900 mb-1">Apply history to existing leads</div>
              Walk through your {existingLeadCount} existing lead{existingLeadCount !== 1 ? 's' : ''} and set each one&apos;s Advance Months to whatever was active on its close date. Handy if you uploaded leads before setting up your history.
            </div>
            <button
              onClick={onApplyToExistingLeads}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1.5 text-xs font-medium flex-shrink-0"
            >
              Apply now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
