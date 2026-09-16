'use client';
import { CheckCircle2 } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function Toast({ toast }) {
  if (!toast) return null;
  if (typeof document === 'undefined') return null;
  const bg = toast.kind === 'error' ? 'bg-red-600' : 'bg-emerald-600';
  // Portal to <body> at a very high z-index so it always sits above modals.
  return createPortal(
    <div className={`fixed bottom-4 right-4 z-[100] ${bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-[90vw]`}>
      <CheckCircle2 size={18} className="flex-shrink-0" />
      <span className="text-sm font-medium">{toast.msg}</span>
      {/* Optional inline action (e.g. Undo) — only rendered when the caller
          supplies both a label and a handler via showToast's opts. */}
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={toast.onAction}
          className="ml-1 text-sm font-bold underline underline-offset-2 hover:opacity-80 flex-shrink-0"
        >
          {toast.actionLabel}
        </button>
      )}
    </div>,
    document.body
  );
}
