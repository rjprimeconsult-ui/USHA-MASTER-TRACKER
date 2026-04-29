'use client';
import { useEffect, useState, useMemo } from 'react';
import { Sparkles, X, ArrowRight, Bell, History, ExternalLink } from 'lucide-react';
import { storage } from '@/lib/storage';
import { SORTED_ANNOUNCEMENTS, ANNOUNCEMENT_ACK_KEY } from '@/lib/announcements';

/**
 * Top-of-app banner that surfaces unread announcements one at a time.
 * Tracks dismissals per-user via cloud storage so they persist across
 * devices. Also exposes a "What's New" history modal via the Bell icon.
 */
export default function AnnouncementBanner({ onNavigate }) {
  const [acked, setAcked] = useState(null); // null = not loaded yet
  const [showHistory, setShowHistory] = useState(false);

  // Load dismissed IDs from cloud storage on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await storage.getItem(ANNOUNCEMENT_ACK_KEY);
        if (cancelled) return;
        const ids = raw ? JSON.parse(raw) : [];
        setAcked(new Set(Array.isArray(ids) ? ids : []));
      } catch {
        if (!cancelled) setAcked(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = async (id) => {
    setAcked(prev => {
      const next = new Set(prev);
      next.add(id);
      // Fire-and-forget persist (non-blocking)
      storage.setItem(ANNOUNCEMENT_ACK_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  };

  const dismissAll = async () => {
    const allIds = SORTED_ANNOUNCEMENTS.map(a => a.id);
    setAcked(new Set(allIds));
    storage.setItem(ANNOUNCEMENT_ACK_KEY, JSON.stringify(allIds)).catch(() => {});
  };

  const handleCta = (announcement) => {
    if (!announcement.cta) return;
    if (announcement.cta.url) {
      window.open(announcement.cta.url, '_blank', 'noopener,noreferrer');
    } else if (announcement.cta.view && onNavigate) {
      onNavigate(announcement.cta.view);
    }
    dismiss(announcement.id);
  };

  const unacked = useMemo(() => {
    if (!acked) return [];
    return SORTED_ANNOUNCEMENTS.filter(a => !acked.has(a.id));
  }, [acked]);

  // Don't render anything until we know what's been ack'd (avoids flash)
  if (acked === null) return null;

  const current = unacked[0];
  const remaining = unacked.length - 1;

  return (
    <>
      {/* Persistent bell icon for the history panel — always visible */}
      <BellTrigger
        unreadCount={unacked.length}
        onClick={() => setShowHistory(true)}
      />

      {/* The active banner — slides in for the latest unread item */}
      {current && (
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-pink-600 text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="text-2xl flex-shrink-0">{current.emoji || '✨'}</div>
            <div className="flex-1 min-w-[250px]">
              <div className="font-bold text-sm leading-tight">{current.title}</div>
              <div className="text-xs opacity-90 mt-0.5">{current.body}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {current.cta && (
                <button
                  onClick={() => handleCta(current)}
                  className="bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  {current.cta.label}
                  {current.cta.url ? <ExternalLink size={12} /> : <ArrowRight size={12} />}
                </button>
              )}
              <button
                onClick={() => dismiss(current.id)}
                className="bg-white/10 hover:bg-white/20 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap"
                title="Dismiss this announcement"
              >
                Got it
              </button>
              {remaining > 0 && (
                <span className="text-xs opacity-80 whitespace-nowrap" title={`${remaining} more update${remaining !== 1 ? 's' : ''} after this`}>
                  +{remaining} more
                </span>
              )}
              <button
                onClick={() => dismiss(current.id)}
                className="text-white/70 hover:text-white p-1"
                title="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal — every announcement, with read/unread state */}
      {showHistory && (
        <HistoryModal
          announcements={SORTED_ANNOUNCEMENTS}
          acked={acked}
          onDismiss={dismiss}
          onDismissAll={dismissAll}
          onCta={handleCta}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
}

function BellTrigger({ unreadCount, onClick }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-4 right-4 z-30 bg-white border border-slate-200 rounded-full shadow-lg w-11 h-11 flex items-center justify-center hover:shadow-xl hover:scale-105 transition group"
      title="What's new"
    >
      <Bell size={18} className="text-indigo-600 group-hover:text-indigo-700" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ring-2 ring-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
}

function HistoryModal({ announcements, acked, onDismiss, onDismissAll, onCta, onClose }) {
  const unreadCount = announcements.filter(a => !acked.has(a.id)).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 bg-gradient-to-br from-indigo-50 to-violet-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shadow-lg">
              <History size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">What&apos;s New</h2>
              <p className="text-xs text-slate-500">
                {unreadCount > 0 ? `${unreadCount} unread update${unreadCount !== 1 ? 's' : ''}` : 'You&apos;re all caught up'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {announcements.length === 0 && (
            <div className="text-center text-slate-400 italic py-12">No announcements yet.</div>
          )}
          {announcements.map(a => {
            const isUnread = !acked.has(a.id);
            return (
              <div key={a.id}
                className={`rounded-xl border p-4 ${isUnread ? 'bg-gradient-to-br from-indigo-50/40 to-violet-50/40 border-indigo-200' : 'bg-white border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0">{a.emoji || '✨'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className={`font-bold text-sm ${isUnread ? 'text-slate-900' : 'text-slate-700'}`}>{a.title}</h3>
                      {isUnread && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-600 text-white px-1.5 py-0.5 rounded">NEW</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{a.date}</div>
                    <p className="text-sm text-slate-700 mt-2">{a.body}</p>
                    <div className="flex items-center gap-2 mt-3">
                      {a.cta && (
                        <button
                          onClick={() => { onCta(a); onClose(); }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                        >
                          {a.cta.label} {a.cta.url ? <ExternalLink size={11} /> : <ArrowRight size={11} />}
                        </button>
                      )}
                      {isUnread && (
                        <button
                          onClick={() => onDismiss(a.id)}
                          className="border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700"
                        >
                          Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {unreadCount > 0 && (
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
            <button
              onClick={() => { onDismissAll(); }}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline">
              Mark all as read
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
