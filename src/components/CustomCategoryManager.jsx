'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Check, AlertCircle, Tag } from 'lucide-react';
import {
  loadCustomCategories, saveCustomCategories, makeCustomCategoryId,
  CATEGORY_COLOR_PALETTE, badgeForColor,
} from '@/lib/customCategories';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/constants';
import { GlassModal } from './motion/MotionPrimitives';

/**
 * Manage custom expense/income categories.
 *
 * Built-in categories show as read-only entries (so users see the full
 * picture and don't double up). Custom entries are editable: rename,
 * recolor, delete.
 *
 * Props:
 *   open         — bool
 *   onClose      — () => void
 *   onChanged    — (newCustomMap) => void   parent reloads merged list
 *   direction    — 'expense' | 'income' (which tab to manage)
 *   usageCounts  — optional { [categoryId]: count } to warn before delete
 *   onMigrate    — optional (deletedId, fallbackId) => void  re-tag rows
 */
export default function CustomCategoryManager({
  open, onClose, onChanged, direction = 'expense', usageCounts = {}, onMigrate,
}) {
  const [customs, setCustoms] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftColor, setDraftColor] = useState(CATEGORY_COLOR_PALETTE[0].color);
  const [error, setError] = useState('');

  const builtin = direction === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const fallbackId = direction === 'expense' ? 'OTHER_EXPENSE' : 'OTHER_INCOME';
  const fallbackLabel = direction === 'expense' ? 'Other (Expense)' : 'Other (Income)';

  useEffect(() => {
    if (!open) { setLoaded(false); setError(''); return; }
    loadCustomCategories().then(map => {
      setCustoms(map[direction] || []);
      setLoaded(true);
    });
  }, [open, direction]);

  // All labels (built-in + custom) lowercased for duplicate detection
  const takenLabels = useMemo(
    () => new Set([...builtin.map(c => c.label.toLowerCase()), ...customs.map(c => c.label.toLowerCase())]),
    [builtin, customs]
  );

  if (!open) return null;

  const persist = async (nextList) => {
    const fullMap = await loadCustomCategories();
    const next = { ...fullMap, [direction]: nextList };
    await saveCustomCategories(next);
    setCustoms(nextList);
    onChanged?.(next);
  };

  const addCategory = async () => {
    const label = draftLabel.trim();
    setError('');
    if (label.length < 2) { setError('Name must be at least 2 characters.'); return; }
    if (label.length > 30) { setError('Name must be 30 characters or less.'); return; }
    if (takenLabels.has(label.toLowerCase())) {
      setError('That name is already taken (built-in or custom).');
      return;
    }
    const palette = CATEGORY_COLOR_PALETTE.find(p => p.color === draftColor) || CATEGORY_COLOR_PALETTE[0];
    const newCat = {
      id: makeCustomCategoryId(label),
      label,
      color: palette.color,
      badge: palette.badge,
      custom: true,
    };
    await persist([...customs, newCat]);
    setDraftLabel('');
    // keep color so user can rapid-fire add several in the same shade
  };

  const updateCategory = async (id, patch) => {
    const next = customs.map(c => c.id === id ? { ...c, ...patch, badge: patch.color ? badgeForColor(patch.color) : c.badge } : c);
    await persist(next);
  };

  const deleteCategory = async (id) => {
    const cat = customs.find(c => c.id === id);
    const usage = usageCounts[id] || 0;
    if (usage > 0) {
      const ok = window.confirm(
        `"${cat?.label}" is currently used on ${usage} ${direction} ${usage === 1 ? 'entry' : 'entries'}. ` +
        `Delete the category and re-tag those rows as "${fallbackLabel}"?`
      );
      if (!ok) return;
      onMigrate?.(id, fallbackId);
    }
    await persist(customs.filter(c => c.id !== id));
  };

  return (
    <GlassModal open maxWidth="max-w-2xl" className="max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-violet-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
              <Tag size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Manage Categories</h2>
              <p className="text-xs text-slate-500">
                {direction === 'expense' ? 'Books expense' : 'Books income'} buckets — built-in + your own
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Add new */}
          <div className="bg-gradient-to-br from-indigo-50/60 to-violet-50/60 border border-indigo-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Plus size={14} className="text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-900">Add a custom category</h3>
            </div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="e.g. Subscriptions, Tax Reserve, Conference Fees"
                value={draftLabel}
                onChange={e => setDraftLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCategory(); }}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                maxLength={30}
              />
              <button
                onClick={addCategory}
                disabled={!draftLabel.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg px-4 py-2 text-sm font-semibold flex items-center gap-1.5"
              >
                <Plus size={14} /> Add
              </button>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Pick a color</label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_COLOR_PALETTE.map(p => (
                  <button
                    key={p.color}
                    onClick={() => setDraftColor(p.color)}
                    title={p.label}
                    className={`w-7 h-7 rounded-full border-2 transition ${draftColor === p.color ? 'border-slate-900 scale-110' : 'border-white hover:border-slate-400'}`}
                    style={{ background: p.color, boxShadow: draftColor === p.color ? '0 0 0 2px white inset' : 'none' }}
                  />
                ))}
              </div>
            </div>
            {error && (
              <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                <AlertCircle size={12} /> {error}
              </div>
            )}
          </div>

          {/* Custom list */}
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Your custom categories ({customs.length})
            </h3>
            {customs.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
                None yet — add one above.
              </div>
            ) : (
              <div className="space-y-1.5">
                {customs.map(c => (
                  <CustomRow
                    key={c.id}
                    cat={c}
                    usage={usageCounts[c.id] || 0}
                    onRename={(label) => updateCategory(c.id, { label })}
                    onRecolor={(color) => updateCategory(c.id, { color })}
                    onDelete={() => deleteCategory(c.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Built-in (read-only reference) */}
          <details className="border border-slate-200 rounded-xl">
            <summary className="cursor-pointer px-4 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider hover:bg-slate-50 rounded-xl">
              Built-in categories ({builtin.length}) — read only
            </summary>
            <div className="p-3 pt-0 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {builtin.map(c => (
                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                  <span className="text-xs text-slate-700 truncate">{c.label}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50">
          <button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5">
            <Check size={14} /> Done
          </button>
        </div>
    </GlassModal>
  );
}

function CustomRow({ cat, usage, onRename, onRecolor, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.label);
  const [showPalette, setShowPalette] = useState(false);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 transition">
      {/* Color swatch / picker trigger */}
      <button
        onClick={() => setShowPalette(s => !s)}
        title="Change color"
        className="w-5 h-5 rounded-full flex-shrink-0 border-2 border-white shadow-sm hover:scale-110 transition"
        style={{ background: cat.color }}
      />
      {showPalette && (
        <div className="absolute z-10 mt-12 bg-white border border-slate-200 rounded-lg p-2 shadow-lg flex flex-wrap gap-1 max-w-[200px]">
          {CATEGORY_COLOR_PALETTE.map(p => (
            <button
              key={p.color}
              onClick={() => { onRecolor(p.color); setShowPalette(false); }}
              title={p.label}
              className="w-5 h-5 rounded-full hover:scale-110 transition border border-slate-200"
              style={{ background: p.color }}
            />
          ))}
        </div>
      )}

      {/* Label */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (draft.trim() && draft !== cat.label) onRename(draft.trim()); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { if (draft.trim() && draft !== cat.label) onRename(draft.trim()); setEditing(false); }
            if (e.key === 'Escape') { setDraft(cat.label); setEditing(false); }
          }}
          className="flex-1 text-sm border border-indigo-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          maxLength={30}
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-sm text-slate-900 text-left hover:underline">
          {cat.label}
        </button>
      )}

      {/* Usage count */}
      {usage > 0 && (
        <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
          {usage} {usage === 1 ? 'entry' : 'entries'}
        </span>
      )}

      {/* Delete */}
      <button
        onClick={onDelete}
        title="Delete category"
        className="text-slate-400 hover:text-red-600 transition p-1"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
