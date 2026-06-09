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
    </div>,
    document.body
  );
}
