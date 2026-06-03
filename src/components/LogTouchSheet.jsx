'use client';
import { useState } from 'react';
import { X, Phone, MessageSquare, Mail, Voicemail, MoreHorizontal } from 'lucide-react';
import { CHANNELS, OUTCOMES } from '@/lib/followupEngine.mjs';

const CHANNEL_ICON = { Call: Phone, Text: MessageSquare, Email: Mail, Voicemail, Other: MoreHorizontal };

/**
 * Capture a single follow-up touch: channel + outcome + optional note.
 * onSave({ channel, outcome, note }) is called; parent persists via the engine.
 */
export default function LogTouchSheet({ open, prospectName, defaultChannel = 'Call', onSave, onClose }) {
  const [channel, setChannel] = useState(defaultChannel);
  const [outcome, setOutcome] = useState('No answer');
  const [note, setNote] = useState('');
  if (!open) return null;

  const save = () => { onSave({ channel, outcome, note: note.trim() }); setNote(''); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">Log follow-up</h3>
            {prospectName && <p className="text-xs text-slate-500">{prospectName}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Channel</div>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map(c => {
                const Icon = CHANNEL_ICON[c] || MoreHorizontal;
                const active = c === channel;
                return (
                  <button key={c} onClick={() => setChannel(c)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                    <Icon size={14} /> {c}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Outcome</div>
            <div className="flex flex-wrap gap-2">
              {OUTCOMES.map(o => {
                const active = o === outcome;
                return (
                  <button key={o} onClick={() => setOutcome(o)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Note (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500}
              placeholder="What happened / next angle…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          </div>
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700">Save touch</button>
        </div>
      </div>
    </div>
  );
}
