'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Mail, X, Loader2, Zap } from 'lucide-react';
import {
  loadQueue,
  saveQueue,
  cancelPending,
  markFired,
  pruneCompleted,
  GRACE_MS,
  isDue,
  isPending,
  msUntilFire,
} from '@/lib/pendingEmailQueue';
import { loadBundle, renderTemplate } from '@/lib/postSaleEmails';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { supabase, supabaseConfigured } from '@/lib/supabase';

/**
 * Background runner for the pending-auto-send email queue.
 *
 * Responsibilities:
 *   1. Load the queue on mount, reconcile it with current leads.
 *   2. Surface a floating countdown toast for each pending item with a
 *      Cancel button — the agent always has a kill switch during the
 *      grace window.
 *   3. When an item is due, render the template against the latest lead
 *      state, POST to /api/email/send, mark fired, and append an audit
 *      entry onto the lead via onAuditEntry.
 *   4. Prune completed/canceled items older than 24h so storage stays slim.
 *
 * Mount this once at the top of LeadTracker, alongside other root-level
 * pieces (Toast, Chatbot, etc.). It renders the toast UI inline; the
 * actual queue plumbing happens via effects.
 *
 * Props:
 *   leads          — current array of leads (used to resolve at fire time)
 *   onAuditEntry   — (leadId, entry) => void; called when a send completes
 *                    so the parent can append entry to lead.emailLog and
 *                    persist via setLeads.
 */
export default function PendingEmailQueueRunner({ leads, onAuditEntry }) {
  const { canAccess, profile } = useBetaFeature('post_sale_emails');
  const [queue, setQueue] = useState({ items: [] });
  const [bundle, setBundle] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const firingRef = useRef(new Set()); // item ids currently in-flight (de-dup)

  // Initial load + periodic tick for countdown UI.
  useEffect(() => {
    if (!canAccess) return;
    let alive = true;
    (async () => {
      await pruneCompleted();
      const q = await loadQueue();
      const b = await loadBundle();
      if (alive) {
        setQueue(q);
        setBundle(b);
      }
    })();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(tick); };
  }, [canAccess]);

  // Refresh queue + bundle when the page becomes visible again (e.g. agent
  // switched tabs during the 5-min grace).
  useEffect(() => {
    if (!canAccess) return;
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const q = await loadQueue();
      const b = await loadBundle();
      setQueue(q);
      setBundle(b);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [canAccess]);

  // The actual fire-when-due logic. Runs on every tick. Filters items by
  // due/pending, debounces by id via firingRef, and posts to the API.
  useEffect(() => {
    if (!canAccess || !bundle) return;
    const due = queue.items.filter(it => isDue(it, now) && !firingRef.current.has(it.id));
    if (due.length === 0) return;
    for (const item of due) {
      firingRef.current.add(item.id);
      fireItem(item).finally(() => firingRef.current.delete(item.id));
    }

    async function fireItem(item) {
      const template = (bundle.templates || []).find(t => t.id === item.templateId);
      const lead = leads.find(l => l.id === item.leadId);
      if (!template || !lead) {
        await markFired(item.id, { status: 'failed', error: !lead ? 'lead deleted' : 'template missing' });
        setQueue(await loadQueue());
        return;
      }
      const rendered = renderTemplate(template, lead, profile, bundle, {
        agentName: template.fromName || profile?.email?.split('@')[0],
      });
      if (!rendered.recipient) {
        await markFired(item.id, { status: 'failed', error: 'no recipient resolved' });
        setQueue(await loadQueue());
        return;
      }

      let bearer = null;
      try {
        if (supabaseConfigured()) {
          const { data } = await supabase.auth.getSession();
          bearer = data.session?.access_token || null;
        }
      } catch { /* unauthenticated send won't pass server-side check, but try */ }

      try {
        const res = await fetch('/api/email/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify({
            leadId: lead.id,
            subject: rendered.subject,
            body: rendered.body,
            recipient: rendered.recipient,
            intendedRecipient: rendered.intendedRecipient,
            testMode: rendered.testMode,
            fromName: template.fromName || '',
            templateId: template.id,
            templateName: template.name,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          await markFired(item.id, { status: 'failed', error: data?.error || `HTTP ${res.status}` });
        } else {
          await markFired(item.id, { status: 'sent', messageId: data?.messageId });
          if (typeof onAuditEntry === 'function') {
            onAuditEntry(lead.id, {
              sentAt: new Date().toISOString(),
              recipient: rendered.recipient,
              intendedRecipient: rendered.intendedRecipient,
              testMode: !!rendered.testMode,
              messageId: data?.messageId || null,
              subject: rendered.subject,
              templateId: template.id,
              templateName: template.name,
              status: 'sent',
              trigger: 'auto',
            });
          }
        }
      } catch (e) {
        await markFired(item.id, { status: 'failed', error: e?.message || String(e) });
      }
      setQueue(await loadQueue());
    }
  }, [now, queue, bundle, leads, canAccess, profile, onAuditEntry]);

  const onCancel = useCallback(async (id) => {
    await cancelPending({ id });
    setQueue(await loadQueue());
  }, []);

  if (!canAccess) return null;
  const pending = queue.items.filter(it => isPending(it));
  if (pending.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40 space-y-2 max-w-sm">
      {pending.map(item => {
        const lead = leads.find(l => l.id === item.leadId);
        const template = (bundle?.templates || []).find(t => t.id === item.templateId);
        const ms = msUntilFire(item, now);
        return (
          <CountdownToast
            key={item.id}
            lead={lead}
            template={template}
            msLeft={ms}
            onCancel={() => onCancel(item.id)}
          />
        );
      })}
    </div>
  );
}

function CountdownToast({ lead, template, msLeft, onCancel }) {
  const mm = Math.floor(msLeft / 60_000);
  const ss = Math.floor((msLeft % 60_000) / 1000);
  const time = `${mm}:${String(ss).padStart(2, '0')}`;
  return (
    <div className="bg-white border border-amber-300 shadow-lg rounded-xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-left-2">
      <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
        <Mail size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Zap size={11} className="text-amber-600" />
          Auto-send queued
        </div>
        <div className="text-xs text-slate-600 mt-0.5">
          <span className="font-medium">{template?.name || 'Template'}</span>
          {lead?.name && <> → <span className="font-medium">{lead.name}</span></>}
        </div>
        <div className="text-xs text-amber-700 mt-1">
          Sending in <span className="font-mono font-bold">{time}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-rose-700 hover:bg-rose-50 px-2 py-1 rounded font-medium flex items-center gap-1 flex-shrink-0"
        title="Cancel this auto-send"
      >
        <X size={12} /> Cancel
      </button>
    </div>
  );
}
