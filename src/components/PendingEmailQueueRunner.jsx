'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Mail, X, Loader2, Zap } from 'lucide-react';
import {
  loadQueue,
  saveQueue,
  cancelPending,
  markFired,
  reschedulePending,
  isExpiredHold,
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
 *      entry onto the lead via onAuditEntry — on failure branches too, so
 *      a burned item is always visible in the lead's email log (spec §6.1).
 *   4. Sender-setup refusals (428/503 with setupRequired, except
 *      stale_client) RESCHEDULE the item +15 min with a heldReason instead
 *      of failing it — queued client mail must survive an incomplete
 *      sender identity. Held items older than 72h are explicitly failed
 *      ('expired while sender setup incomplete') rather than flushing
 *      stale mail when setup completes.
 *   5. Held items collapse into ONE summary toast with an
 *      "Open Profile → Sender" action (dispatches 'prim:open-profile');
 *      only un-held items get the per-item countdown toast.
 *   6. Prune completed/canceled items older than 24h so storage stays slim.
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
      // Failed sends must be as visible as successful ones (spec §6.1):
      // mirror the success audit entry minus messageId, so the lead's
      // email log shows WHY nothing arrived. Uses item.leadId because the
      // lead itself may be the thing that's missing.
      const failAudit = (error, rendered = null) => {
        if (typeof onAuditEntry !== 'function') return;
        onAuditEntry(item.leadId, {
          sentAt: new Date().toISOString(),
          recipient: rendered?.recipient || null,
          intendedRecipient: rendered?.intendedRecipient || null,
          testMode: !!rendered?.testMode,
          subject: rendered?.subject || null,
          templateId: item.templateId,
          templateName: template?.name || null,
          status: 'failed',
          error,
          trigger: 'auto',
        });
      };
      if (!template || !lead) {
        const error = !lead ? 'lead deleted' : 'template missing';
        await markFired(item.id, { status: 'failed', error });
        failAudit(error);
        setQueue(await loadQueue());
        return;
      }
      const rendered = renderTemplate(template, lead, profile, bundle, {
        agentName: template.fromName || profile?.email?.split('@')[0],
      });
      // Staleness bound (spec §6.1): an item held for sender setup past 72h
      // is burned EXPLICITLY — failed + audited — before any POST. A
      // days-late "congrats on your new policy" flushing the moment the
      // agent completes setup is worse than no email at all.
      if (isExpiredHold(item, now)) {
        const error = 'expired while sender setup incomplete';
        await markFired(item.id, { status: 'failed', error });
        failAudit(error, rendered);
        setQueue(await loadQueue());
        return;
      }
      if (!rendered.recipient) {
        await markFired(item.id, { status: 'failed', error: 'no recipient resolved' });
        failAudit('no recipient resolved', rendered);
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
          const setupHold = (res.status === 428 || res.status === 503)
            && data?.setupRequired && data.setupRequired !== 'stale_client';
          if (setupHold) {
            // Sender setup incomplete (428) or identity read blip (503):
            // reschedule, never fail — the item stays pending, visible,
            // and retryable (spec §6.1). Own try/catch so a storage blip
            // inside the reschedule cannot fall through to the outer
            // catch below, which would convert a recoverable hold into a
            // terminal burn.
            try {
              await reschedulePending(item.id, {
                scheduledAt: Date.now() + 15 * 60 * 1000,
                heldReason: data.setupRequired,
              });
            } catch (reschedErr) {
              console.warn('pending email reschedule failed; item stays pending', reschedErr);
            }
          } else {
            const error = data?.error || `HTTP ${res.status}`;
            await markFired(item.id, { status: 'failed', error });
            failAudit(error, rendered);
          }
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
        const error = e?.message || String(e);
        await markFired(item.id, { status: 'failed', error });
        failAudit(error, rendered);
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
  // Held items (waiting on sender setup) collapse into ONE summary toast —
  // a per-item countdown resetting every 15 minutes would promise mail that
  // isn't coming, and N persistent toasts for 72h is noise (spec §6.1).
  const held = pending.filter(it => !!it.heldReason);
  const counting = pending.filter(it => !it.heldReason);

  return (
    <div className="fixed bottom-6 left-6 z-40 space-y-2 max-w-sm">
      {counting.map(item => {
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
      {held.length > 0 && <HeldSummaryToast count={held.length} />}
    </div>
  );
}

function HeldSummaryToast({ count }) {
  return (
    <div className="bg-white border border-amber-300 shadow-lg rounded-xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-left-2">
      <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
        <Mail size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900">
          {count} email{count === 1 ? '' : 's'} waiting on sender setup
        </div>
        <div className="text-xs text-slate-600 mt-0.5">
          Held until your sender identity is complete. Held emails expire after 72 hours.
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('prim:open-profile', { detail: { section: 'sender' } }))}
          className="text-xs text-amber-700 hover:bg-amber-50 px-2 py-1 rounded font-medium mt-1 -ml-2"
        >
          Open Profile &rarr; Sender
        </button>
      </div>
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
