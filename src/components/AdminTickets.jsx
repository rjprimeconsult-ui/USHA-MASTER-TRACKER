'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/authedFetch';
import { Ticket, RefreshCw, ChevronDown, ChevronRight, Check } from 'lucide-react';

// Admin support-ticket queue. Reads client-side via the tickets_admin_read RLS
// policy (same model as the rest of the admin dashboard). All writes go through
// the service-role route POST /api/admin/tickets/[id].

const STATUS_LABEL = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const STATUS_STYLE = {
  new: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
};

export default function AdminTickets() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(() => {
    // Deep-link ?ticket=N — read once client-side (not the server searchParams prop).
    if (typeof window === 'undefined') return null;
    const t = new URLSearchParams(window.location.search).get('ticket');
    return t ? Number(t) : null;
  });
  const [shotUrls, setShotUrls] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false });
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const signShot = useCallback(async (path, id) => {
    if (!path || shotUrls[id]) return;
    const { data } = await supabase.storage.from('ticket-screenshots').createSignedUrl(path, 3600);
    if (data?.signedUrl) setShotUrls((m) => ({ ...m, [id]: data.signedUrl }));
  }, [shotUrls]);

  const update = async (id, patch) => {
    setSaving(true);
    try {
      const res = await authedFetch(`/api/admin/tickets/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (res.ok) await load();
    } finally { setSaving(false); }
  };

  const visible = rows.filter((r) => filter === 'all' || r.status === filter);
  const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

  return (
    <section className="premium-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-slate-900 flex items-center gap-2"><Ticket size={18} className="text-indigo-600" /> Support Tickets</h2>
        <button onClick={() => { setLoading(true); load(); }} className="text-slate-400 hover:text-indigo-600" title="Refresh"><RefreshCw size={16} /></button>
      </div>
      <div className="flex gap-2 mb-3 text-sm flex-wrap">
        {['all', 'new', 'in_progress', 'resolved'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-lg font-medium ${filter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {s === 'all' ? 'All' : STATUS_LABEL[s]}{s !== 'all' && counts[s] ? ` (${counts[s]})` : ''}
          </button>
        ))}
      </div>
      {loading ? <p className="text-sm text-slate-400">Loading…</p>
        : visible.length === 0 ? <p className="text-sm text-slate-400 italic">No tickets.</p>
          : (
            <div className="space-y-2">
              {visible.map((t) => {
                const isOpen = openId === t.id;
                return (
                  <div key={t.id} className="border border-slate-200 rounded-lg">
                    <button onClick={() => { setOpenId(isOpen ? null : t.id); if (!isOpen) signShot(t.screenshot_path, t.id); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left">
                      {isOpen ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                      <span className="font-mono text-xs text-slate-400">#{t.id}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_STYLE[t.status] || ''}`}>{STATUS_LABEL[t.status] || t.status}</span>
                      <span className="text-sm font-semibold">{t.category === 'Custom' ? t.custom_category : t.category}</span>
                      <span className="text-xs text-slate-500 truncate flex-1">{t.name || t.email}</span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 space-y-3 border-t border-slate-100 pt-3">
                        <div>
                          <div className="text-[11px] font-semibold text-slate-500">Description</div>
                          <p className="text-sm whitespace-pre-wrap">{t.description}</p>
                        </div>
                        <div className="text-xs text-slate-500">
                          <span className="font-semibold">Context:</span> {t.context?.page || '—'} · {t.context?.appVersion || '—'}
                          {t.context?.lastError ? <> · <span className="text-red-500">err: {t.context.lastError}</span></> : null}
                        </div>
                        {t.context?.userAgent && <div className="text-[11px] text-slate-400 break-all">{t.context.userAgent}</div>}
                        {t.screenshot_path && (shotUrls[t.id]
                          ? <a href={shotUrls[t.id]} target="_blank" rel="noopener noreferrer"><img src={shotUrls[t.id]} alt="screenshot" className="max-h-48 rounded border border-slate-200" /></a>
                          : <span className="text-xs text-slate-400">Loading screenshot…</span>)}
                        <TicketControls ticket={t} saving={saving} onUpdate={update} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
    </section>
  );
}

function TicketControls({ ticket, saving, onUpdate }) {
  const [notes, setNotes] = useState(ticket.admin_notes || '');
  const [resolution, setResolution] = useState(ticket.resolution || '');
  const ta = 'w-full border border-slate-200 rounded px-2 py-1 text-sm';
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex gap-2 flex-wrap">
        {['new', 'in_progress'].map((s) => (
          <button key={s} disabled={saving || ticket.status === s} onClick={() => onUpdate(ticket.id, { status: s })}
            className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 font-medium disabled:opacity-50">Mark {STATUS_LABEL[s]}</button>
        ))}
      </div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={ta}
        placeholder="Internal admin notes (not emailed)…" />
      <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={ta}
        placeholder="Resolution note — emailed to the agent on resolve. Keep it PHI-safe." />
      <div className="flex gap-2 flex-wrap">
        <button disabled={saving} onClick={() => onUpdate(ticket.id, { admin_notes: notes, resolution })}
          className="px-3 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 font-medium disabled:opacity-50">Save notes</button>
        <button disabled={saving} onClick={() => onUpdate(ticket.id, { status: 'resolved', admin_notes: notes, resolution })}
          className="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 font-semibold flex items-center gap-1 disabled:opacity-50"><Check size={13} /> Resolve + email agent</button>
      </div>
    </div>
  );
}
