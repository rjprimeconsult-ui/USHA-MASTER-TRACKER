'use client';
import { CheckCircle2 } from 'lucide-react';

export default function Toast({ toast }) {
  if (!toast) return null;
  const bg = toast.kind === 'error' ? 'bg-red-600' : 'bg-emerald-600';
  return (
    <div className={`fixed bottom-4 right-4 z-50 ${bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2`}>
      <CheckCircle2 size={18} />
      <span className="text-sm font-medium">{toast.msg}</span>
    </div>
  );
}
