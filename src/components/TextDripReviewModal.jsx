'use client';
/**
 * TextDripReviewModal.jsx — "Review TextDrip duplicates" modal.
 *
 * Per review item: incoming TextDrip contact vs existing prospect from a
 * different source. Agent chooses Merge (apply conversation) or Skip.
 *
 * Reuses DuplicateResolver modal style / motion primitives.
 *
 * Props:
 *   open          — bool
 *   items         — [{ contact, matchedProspect }]
 *   onResolve     — (results: [{ action:'merge'|'skip', contact, matchedProspect }]) => void
 *   onClose       — () => void
 */
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Merge, SkipForward, MessageCircle } from 'lucide-react';
import { GlassModal } from './motion/MotionPrimitives';

export default function TextDripReviewModal({ open, items = [], onResolve, onClose }) {
  // choices[i] = 'merge' | 'skip'
  const [choices, setChoices] = useState({});

  // Default every item to 'skip' whenever the item set changes. The modal is
  // mounted permanently with `open` toggled, so re-init on each new sync batch.
  useEffect(() => {
    setChoices(Object.fromEntries((items || []).map((_, i) => [i, 'skip'])));
  }, [items]);

  if (!open || items.length === 0) return null;
  if (typeof document === 'undefined') return null;

  const setChoice = (i, val) => setChoices(prev => ({ ...prev, [i]: val }));

  const handleApply = () => {
    const results = items.map((item, i) => ({
      action: choices[i] || 'skip',
      contact: item.contact,
      matchedProspect: item.matchedProspect,
    }));
    onResolve(results);
  };

  const mergeCount = Object.values(choices).filter(v => v === 'merge').length;

  const modal = (
    <GlassModal open onClose={onClose} maxWidth="max-w-3xl" className="premium-card max-h-[88vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent-gradient flex items-center justify-center text-white">
                <MessageCircle size={18} />
              </div>
              <div>
                <h2 className="font-extrabold text-slate-900 dark:text-slate-100 text-lg tracking-tight">
                  Review TextDrip duplicates
                </h2>
                <p className="text-xs text-slate-500">
                  {items.length} contact{items.length !== 1 ? 's' : ''} matched an existing prospect from a different source
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
              <X size={20} />
            </button>
          </div>

          {/* Items */}
          <div className="p-5 space-y-4">
            {items.map((item, i) => (
              <ReviewItem
                key={i}
                index={i}
                contact={item.contact}
                existing={item.matchedProspect}
                choice={choices[i] || 'skip'}
                onChange={(val) => setChoice(i, val)}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={onClose}
              className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-4 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="bg-accent-gradient text-white rounded-lg px-4 py-2 text-sm font-bold flex items-center gap-1.5 shadow-accent hover:opacity-95"
            >
              <Merge size={14} />
              Apply ({mergeCount} merge{mergeCount !== 1 ? 's' : ''}, {items.length - mergeCount} skip{items.length - mergeCount !== 1 ? 's' : ''})
            </button>
          </div>
    </GlassModal>
  );

  return createPortal(modal, document.body);
}

function ReviewItem({ index, contact, existing, choice, onChange }) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
        #{index + 1}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-700">
        {/* Incoming */}
        <div className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-violet-600 mb-2">
            From TextDrip
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{contact.name || '—'}</div>
          <div className="text-xs text-slate-500 mt-1 space-y-0.5">
            {contact.phone && <div>{contact.phone}</div>}
            {contact.tags?.length > 0 && (
              <div>Tags: {contact.tags.join(', ')}</div>
            )}
            {contact.conversation?.messages?.length > 0 && (
              <div className="text-violet-600">
                {contact.conversation.messages.length} message{contact.conversation.messages.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>
        {/* Existing */}
        <div className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            Existing in PRIM ({existing?.source || 'Unknown source'})
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">{existing?.name || '—'}</div>
          <div className="text-xs text-slate-500 mt-1 space-y-0.5">
            {existing?.phone && <div>{existing.phone}</div>}
            {existing?.stage && <div>Stage: {existing.stage}</div>}
          </div>
        </div>
      </div>
      {/* Choice buttons */}
      <div className="px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <button
          onClick={() => onChange('merge')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            choice === 'merge'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Merge size={12} /> Merge conversation in
        </button>
        <button
          onClick={() => onChange('skip')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            choice === 'skip'
              ? 'bg-slate-700 text-white'
              : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <SkipForward size={12} /> Skip
        </button>
        <span className="ml-2 text-xs text-slate-400">
          {choice === 'merge'
            ? 'Will add TextDrip chat to this prospect'
            : 'Will leave this prospect unchanged'}
        </span>
      </div>
    </div>
  );
}
