'use client';
import { useEffect, useState } from 'react';
import { X, Palette, Check, Trash2 } from 'lucide-react';
import {
  loadSourceColors, saveSourceColors, collectSourceLabels, CATEGORY_COLOR_PALETTE,
} from '@/lib/sourceColors';
import { PROSPECT_SOURCES } from '@/lib/constants';

/**
 * Manage colors for prospect lead sources.
 *
 * Lists every source in use (built-in + free-text from existing prospects),
 * with a per-row color swatch. Agents click a swatch to assign a color, or
 * the X to clear it. Saves on every change so there's no Save button to
 * forget.
 *
 * Props:
 *   open       — bool
 *   onClose    — () => void
 *   prospects  — current prospects (used to discover free-text sources)
 *   onChanged  — (newColorMap) => void   parent refreshes its color state
 */
export default function SourceColorManager({ open, onClose, prospects = [], onChanged }) {
  const [colors, setColors] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    loadSourceColors().then(c => { setColors(c); setLoaded(true); });
  }, [open]);

  if (!open) return null;

  const sources = collectSourceLabels(prospects, PROSPECT_SOURCES);

  const setSourceColor = async (source, color) => {
    const next = { ...colors };
    if (color) next[source] = color;
    else delete next[source];
    setColors(next);
    await saveSourceColors(next);
    onChanged?.(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-violet-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
              <Palette size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Color-code Lead Sources</h2>
              <p className="text-xs text-slate-500">Pick a color per source — prospect cards get a left-border accent matching the source.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {sources.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No lead sources to color yet.
            </div>
          ) : (
            sources.map(source => {
              const current = colors[source] || null;
              return (
                <div key={source} className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="font-medium text-sm text-slate-900 flex-1 truncate">{source}</div>
                  <div className="flex flex-wrap gap-1 flex-shrink-0">
                    {CATEGORY_COLOR_PALETTE.map(p => (
                      <button
                        key={p.color}
                        type="button"
                        onClick={() => setSourceColor(source, p.color)}
                        title={p.label}
                        className={`w-5 h-5 rounded-full transition border-2 ${current === p.color ? 'border-slate-900 scale-110' : 'border-white hover:border-slate-400'}`}
                        style={{ background: p.color }}
                      />
                    ))}
                    {current && (
                      <button
                        type="button"
                        onClick={() => setSourceColor(source, null)}
                        title="Clear color (revert to no accent)"
                        className="w-5 h-5 rounded-full bg-white border border-slate-300 hover:border-red-400 text-slate-400 hover:text-red-600 flex items-center justify-center"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            <Check size={14} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
