'use client';
import { AlertCircle } from 'lucide-react';

export default function ConfirmDialog({ open, title, message, onConfirm, onCancel, danger = true }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white/90 backdrop-blur-2xl border border-white/60 rounded-2xl max-w-md w-full p-6 shadow-2xl shadow-indigo-500/10">
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${danger ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertCircle size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-600 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="border border-slate-200 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} className={`${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white px-3 py-2 rounded-lg text-sm font-medium`}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
