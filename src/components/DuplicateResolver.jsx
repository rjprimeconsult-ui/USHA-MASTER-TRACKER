'use client';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Merge, Repeat, ArrowRight, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  findDuplicateGroups,
  enumeratePairs,
  shouldSkipPair,
  classifyPair,
  mergeLeads,
} from '@/lib/duplicateResolver.mjs';
import { nameKey } from '@/lib/statement';
import { fmt } from '@/lib/utils';

/**
 * Duplicate Resolver modal — walks the agent through each unreviewed
 * pair of same-name leads. Per pair: Merge into one / Repeated client /
 * Keep both. Parent owns the leads state and handles the writes.
 *
 * Props:
 *   open       — bool
 *   onClose    — () => void
 *   leads      — full leads array (read-only here)
 *   onMerge    — (winner, loser) => void
 *                Parent should replace the winner lead with the merged
 *                record (mergeLeads is called inside this modal) and
 *                delete the loser. Both writes are persisted by the
 *                parent's normal save path.
 *   onTagRepeated — (newerLead, olderLeadId) => void
 *                Parent should set previousLeadId = olderLeadId on the
 *                newer lead and stamp dedupReviewedAt on both.
 *   onDismissPair — (a, b) => void
 *                Parent should stamp dedupReviewedAt on both leads so
 *                this pair doesn't reappear.
 */
export default function DuplicateResolver({
  open,
  onClose,
  leads = [],
  onMerge,
  onTagRepeated,
  onDismissPair,
}) {
  // Build the pair list once per (open, leads). Filter already-reviewed.
  const pairs = useMemo(() => {
    if (!open) return [];
    const groups = findDuplicateGroups(leads, nameKey);
    const all = [];
    for (const g of groups) {
      for (const pair of enumeratePairs(g)) {
        if (!shouldSkipPair(pair.a, pair.b)) all.push(pair);
      }
    }
    return all;
  }, [open, leads]);

  const [idx, setIdx] = useState(0);
  const [pickingWinner, setPickingWinner] = useState(false);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const pair = pairs[idx] || null;
  const classification = pair ? classifyPair(pair.a, pair.b) : null;

  const advance = () => {
    setPickingWinner(false);
    if (idx + 1 < pairs.length) setIdx(idx + 1);
    else onClose();
  };

  const onPickWinner = (winnerLead, loserLead) => {
    const merged = mergeLeads(winnerLead, loserLead);
    onMerge(merged, loserLead);
    advance();
  };

  const onClickMerge = () => setPickingWinner(true);
  const onClickRepeated = () => {
    // Older lead = the one with the earlier closedDate (or earlier
    // dateAdded as fallback). The newer one is tagged.
    const dateOf = (l) => l.closedDate || l.dateAdded || '';
    const [older, newer] = dateOf(pair.a) <= dateOf(pair.b) ? [pair.a, pair.b] : [pair.b, pair.a];
    onTagRepeated(newer, older.id);
    advance();
  };
  const onClickDismiss = () => {
    onDismissPair(pair.a, pair.b);
    advance();
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="dup-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="dup-panel"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="premium-card max-w-5xl w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent-gradient flex items-center justify-center text-white">
                <Merge size={18} />
              </div>
              <div>
                <h2 className="font-extrabold text-slate-900 dark:text-slate-100 text-lg tracking-tight">
                  Find duplicate leads
                </h2>
                <p className="text-xs text-slate-500">
                  {pairs.length === 0
                    ? 'No unreviewed duplicates'
                    : `Pair ${idx + 1} of ${pairs.length}`}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          {pairs.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-slate-500 mb-2">No duplicates to review.</div>
              <button
                onClick={onClose}
                className="text-sm text-indigo-600 font-semibold hover:underline"
              >
                Close
              </button>
            </div>
          ) : pair ? (
            <div className="p-5 space-y-4">
              <ClassificationChip classification={classification} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <LeadCard
                  lead={pair.a}
                  selectable={pickingWinner}
                  onSelect={() => onPickWinner(pair.a, pair.b)}
                />
                <LeadCard
                  lead={pair.b}
                  selectable={pickingWinner}
                  onSelect={() => onPickWinner(pair.b, pair.a)}
                />
              </div>

              {pickingWinner ? (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    <Trophy size={12} className="inline-block mr-1" />
                    Click the card you want to keep. The other will be deleted; its policy numbers and products fold into the kept lead.
                  </p>
                  <button
                    onClick={() => setPickingWinner(false)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={onClickMerge}
                    className="bg-accent-gradient text-white rounded-lg px-3.5 py-2 text-sm font-bold flex items-center gap-1.5 shadow-accent hover:opacity-95"
                  >
                    <Merge size={14} /> Merge into one
                  </button>
                  <button
                    onClick={onClickRepeated}
                    className="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 rounded-lg px-3.5 py-2 text-sm font-bold flex items-center gap-1.5"
                  >
                    <Repeat size={14} /> Repeated client
                  </button>
                  <button
                    onClick={onClickDismiss}
                    className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Keep both
                  </button>
                  <div className="ml-auto text-xs text-slate-400 flex items-center gap-1">
                    Next pair <ArrowRight size={12} />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

function ClassificationChip({ classification }) {
  const map = {
    duplicate: { label: 'Likely import duplicate', bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-800 dark:text-emerald-200', border: 'border-emerald-200 dark:border-emerald-700' },
    repeated:  { label: 'Likely repeated client',  bg: 'bg-indigo-50 dark:bg-indigo-900/30',   text: 'text-indigo-800 dark:text-indigo-200',   border: 'border-indigo-200 dark:border-indigo-700' },
    ambiguous: { label: 'Ambiguous — you decide',  bg: 'bg-amber-50 dark:bg-amber-900/30',     text: 'text-amber-800 dark:text-amber-200',     border: 'border-amber-200 dark:border-amber-700' },
  };
  const c = map[classification] || map.ambiguous;
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
    </div>
  );
}

function LeadCard({ lead, selectable, onSelect }) {
  const dollar = (n) => (Number.isFinite(Number(n)) ? fmt(Number(n)) : '—');
  const policies = String(lead.policyNumber || '').split(',').map(s => s.trim()).filter(Boolean);
  const products = Array.isArray(lead.products) ? lead.products.map(p => p?.id).filter(Boolean) : [];
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={selectable ? onSelect : undefined}
      className={`premium-card text-left p-4 transition ${selectable ? 'premium-lift cursor-pointer hover:ring-2 hover:ring-indigo-400' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-slate-900 dark:text-slate-100">{lead.name || '—'}</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{lead.stage || '—'}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Row label="Closed" value={lead.closedDate || lead.dateAdded || '—'} />
        <Row label="Source" value={lead.source || '—'} />
        <Row label="Main product" value={lead.mainProduct || '—'} />
        <Row label="Campaign" value={lead.campaign || '—'} />
        <Row label="Advance" value={dollar(lead.dealValue)} />
        <Row label="Lead cost" value={dollar(lead.leadCost)} />
      </div>
      {policies.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="text-slate-500 font-bold uppercase tracking-wider text-[10px] mb-0.5">Policy #</div>
          <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all">{policies.join(', ')}</div>
        </div>
      )}
      {products.length > 0 && (
        <div className="mt-2 text-xs">
          <div className="text-slate-500 font-bold uppercase tracking-wider text-[10px] mb-0.5">Products</div>
          <div className="text-slate-700 dark:text-slate-300">{products.join(', ')}</div>
        </div>
      )}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <>
      <div className="text-slate-500 font-medium">{label}</div>
      <div className="text-slate-900 dark:text-slate-100 truncate">{value}</div>
    </>
  );
}
