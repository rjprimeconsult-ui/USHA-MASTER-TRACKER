'use client';
import { useState, memo } from 'react';
import { Trash2 } from 'lucide-react';
import { STAGES } from '@/lib/constants';
import { fmt } from '@/lib/utils';

function Pipeline({ leads, onStageChange, onEdit, onDelete }) {
  const [dragged, setDragged] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const byStage = STAGES.map(s => ({
    ...s,
    leads: leads.filter(l => l.stage === s.id),
  }));

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max pb-2">
        {byStage.map(col => {
          const total = col.leads.reduce((s, l) => s + (l.dealValue || 0), 0);
          return (
            <div
              key={col.id}
              className={`w-64 flex-shrink-0 rounded-xl border ${overCol === col.id ? 'border-indigo-400 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}
              onDragOver={e => { e.preventDefault(); setOverCol(col.id); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={e => {
                e.preventDefault();
                setOverCol(null);
                if (dragged && dragged.stage !== col.id) onStageChange(dragged.id, col.id);
                setDragged(null);
              }}
            >
              <div className={`px-3 py-2 rounded-t-xl flex items-center justify-between ${col.bg}`}>
                <div className={`font-semibold text-sm ${col.text}`}>{col.id}</div>
                <div className={`text-xs ${col.text}`}>{col.leads.length} · {fmt(total)}</div>
              </div>
              <div className="p-2 space-y-2 min-h-[200px]">
                {col.leads.map(l => (
                  <div
                    key={l.id}
                    draggable
                    onDragStart={() => setDragged(l)}
                    onClick={() => onEdit(l)}
                    className="bg-white border border-slate-200 rounded-lg p-2 cursor-move hover:border-indigo-400 hover:shadow-sm relative group"
                  >
                    <div className="font-medium text-sm text-slate-900 pr-5">{l.name || '—'}</div>
                    <div className="text-xs text-slate-500">{l.owner} · {l.source}</div>
                    <div className="text-xs text-emerald-700 font-medium mt-1">{fmt(l.dealValue)}</div>
                    {onDelete && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete lead ${l.name || '(unnamed)'}? This can't be undone.`)) onDelete(l.id);
                        }}
                        title="Delete"
                        className="absolute top-1.5 right-1.5 text-slate-300 hover:text-red-600 p-1 rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
                {col.leads.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-6">Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(Pipeline);
