'use client';
import { useState, useEffect } from 'react';
import { X, Phone, MessageSquare, Mail, Voicemail, MoreHorizontal } from 'lucide-react';
import { CHANNELS, OUTCOMES, reminderPresetAt } from '@/lib/followupEngine.mjs';

const CHANNEL_ICON = { Call: Phone, Text: MessageSquare, Email: Mail, Voicemail, Other: MoreHorizontal };

function defaultReminderNote(channel) {
  if (channel === 'Call' || channel === 'Voicemail') return 'Call again';
  if (channel === 'Text') return 'Text again';
  if (channel === 'Email') return 'Email again';
  return 'Follow up again';
}

/**
 * Capture a single follow-up touch: channel + outcome + optional note.
 * onSave({ channel, outcome, note, reminderAt?, reminderNote? }) is called; parent persists via the engine.
 */
export default function LogTouchSheet({ open, prospectName, defaultChannel = 'Call', onSave, onClose }) {
  const [channel, setChannel] = useState(defaultChannel);
  const [outcome, setOutcome] = useState('No answer');
  const [note, setNote] = useState('');

  // Reminder state
  const [reminderPreset, setReminderPreset] = useState(null); // null | 'eod' | 'tomorrow_am' | 'in_2h' | 'custom'
  const [customAt, setCustomAt] = useState('');
  const [reminderNote, setReminderNote] = useState(() => defaultReminderNote(defaultChannel));

  // Reset reminder when outcome changes away from 'No answer'
  useEffect(() => {
    if (outcome !== 'No answer') {
      setReminderPreset(null);
      setCustomAt('');
    }
  }, [outcome]);

  // Update reminder note default when channel changes
  useEffect(() => {
    setReminderNote(defaultReminderNote(channel));
  }, [channel]);

  if (!open) return null;

  const handleClose = () => {
    setNote('');
    setReminderPreset(null);
    setCustomAt('');
    setReminderNote(defaultReminderNote(channel));
    onClose();
  };

  const save = () => {
    const payload = { channel, outcome, note: note.trim() };

    if (outcome === 'No answer' && reminderPreset) {
      const nowIso = new Date().toISOString();
      let reminderAt = null;
      if (reminderPreset === 'custom') {
        // customAt is a datetime-local string (e.g. "2026-06-09T09:00") — treat as local
        if (customAt) {
          reminderAt = new Date(customAt).toISOString();
        }
      } else {
        reminderAt = reminderPresetAt(reminderPreset, nowIso);
      }
      if (reminderAt) {
        payload.reminderAt = reminderAt;
        payload.reminderNote = reminderNote.trim();
      }
    }

    onSave(payload);
    setNote('');
    setReminderPreset(null);
    setCustomAt('');
    setReminderNote(defaultReminderNote(channel));
    onClose();
  };

  const PRESET_LABELS = [
    { id: 'eod', label: 'End of day' },
    { id: 'tomorrow_am', label: 'Tomorrow morning' },
    { id: 'in_2h', label: 'In 2 hours' },
    { id: 'custom', label: 'Custom…' },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900">Log follow-up</h3>
            {prospectName && <p className="text-xs text-slate-500">{prospectName}</p>}
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
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

          {/* Reminder section — only shown for No answer */}
          {outcome === 'No answer' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Set a reminder (optional)</div>
              <div className="flex flex-wrap gap-2">
                {PRESET_LABELS.map(({ id, label }) => {
                  const active = reminderPreset === id;
                  return (
                    <button key={id} onClick={() => setReminderPreset(active ? null : id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              {reminderPreset === 'custom' && (
                <input
                  type="datetime-local"
                  value={customAt}
                  onChange={e => setCustomAt(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              )}
              {reminderPreset && (
                <div>
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Reminder note</div>
                  <input
                    type="text"
                    value={reminderNote}
                    onChange={e => setReminderNote(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Call again"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Note (optional)</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500}
              placeholder="What happened / next angle…"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          </div>
        </div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={handleClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700">Save touch</button>
        </div>
      </div>
    </div>
  );
}
