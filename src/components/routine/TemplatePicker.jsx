'use client';
/**
 * Template picker (spec §7e). The empty state: two premium-card cards ("Agent
 * day" with its description, "Blank"). In replace mode (from Settings) a
 * ConfirmDialog guards the pick, then onPick(template, true); an Undo toast
 * shows for 10 s while undoAvailable. `undoKey` (the view passes the backup's
 * updatedAt) remounts the toast per replace so a second replace shows it again.
 */
import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { TEMPLATES } from '@/lib/routineTemplates.mjs';

const UNDO_MS = 10000;

function UndoToast({ onUndo }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setExpired(true), UNDO_MS);
    return () => clearTimeout(t);
  }, []);
  if (expired) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-medium text-white shadow-xl dark:bg-slate-700">
      <span>Routine replaced</span>
      <button type="button" onClick={onUndo} className="font-semibold underline underline-offset-2">Undo</button>
    </div>
  );
}

export default function TemplatePicker({ templates = TEMPLATES, onPick, replaceMode = false, onUndo, undoAvailable = false, undoKey = null }) {
  const [confirm, setConfirm] = useState(null);
  const pick = (t) => { if (replaceMode) setConfirm(t); else onPick?.(t, false); };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => {
          const blank = !(t.entries || []).length;
          return (
            <div key={t.id} className="premium-card flex flex-col p-4">
              <div className="text-sm font-bold text-slate-900">{t.name}</div>
              <div className="mt-0.5 text-[12px] text-slate-500">{t.description}</div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => pick(t)}
                className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold transition ${blank ? 'border border-slate-200 dark:border-slate-700 text-slate-700 hover:bg-slate-50' : 'bg-accent-gradient text-white shadow-accent hover:opacity-95'}`}
              >
                {blank ? 'Start blank' : 'Use this routine'}
              </button>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title="Replace your routine?"
        message={`Your current blocks will be replaced with "${confirm?.name || ''}". You can undo for 10 seconds.`}
        onConfirm={() => { const t = confirm; setConfirm(null); onPick?.(t, true); }}
        onCancel={() => setConfirm(null)}
        danger
      />

      {undoAvailable && <UndoToast key={undoKey ?? 'undo'} onUndo={onUndo} />}
    </>
  );
}
