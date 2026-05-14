'use client';
/**
 * Send outreach email modal — fires one of the hard-coded PHC outreach
 * templates from a prospect's detail view. Parallel to SendWelcomeEmail
 * (post-sale, for leads) but targets prospects and uses the new
 * `html` + `prospectId` fields on /api/email/send.
 *
 * Flow:
 *   1. Agent opens prospect → clicks "Send outreach email"
 *   2. Modal shows template picker (Email 1 / 2 / 3) with a short
 *      description for each
 *   3. Selecting one renders a preview (subject + iframed HTML)
 *   4. "Send to {prospect.email}" → POST to /api/email/send → logs
 *      to prospect.emailLog via onLogged callback
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Mail, X, Send, Loader2, CheckCircle2, AlertTriangle, Eye,
} from 'lucide-react';
import {
  OUTREACH_TEMPLATES,
  renderOutreachTemplate,
} from '@/lib/outreachEmails';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { supabase, supabaseConfigured } from '@/lib/supabase';

export default function SendOutreachEmail({ prospect, onLogged }) {
  const { canAccess, loading: accessLoading } = useBetaFeature('post_sale_emails');
  const [open, setOpen] = useState(false);

  if (accessLoading) return null;
  if (!canAccess) return null;
  if (!prospect?.id) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1.5"
        title="Send an outreach email to this prospect"
      >
        <Mail size={14} />
        Send outreach
      </button>
      {open && (
        <SendModal prospect={prospect} onClose={() => setOpen(false)} onLogged={onLogged} />
      )}
    </>
  );
}

function SendModal({ prospect, onClose, onLogged }) {
  const [selectedId, setSelectedId] = useState(OUTREACH_TEMPLATES[0]?.id || null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const template = useMemo(
    () => OUTREACH_TEMPLATES.find(t => t.id === selectedId) || null,
    [selectedId]
  );

  const rendered = useMemo(
    () => template ? renderOutreachTemplate(template, prospect) : null,
    [template, prospect]
  );

  const hasEmail = !!(prospect.email && /.+@.+\..+/.test(prospect.email));
  const canSend = rendered && hasEmail && !sending;

  const onSend = async () => {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    try {
      let bearer = null;
      try {
        if (supabaseConfigured()) {
          const { data } = await supabase.auth.getSession();
          bearer = data.session?.access_token || null;
        }
      } catch { /* no auth */ }

      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({
          prospectId: prospect.id,
          kind: 'outreach',
          subject: rendered.subject,
          // Send both: text fallback + HTML body. The server uses HTML
          // when present and synthesizes text from it if `body` is empty.
          body: rendered.text || '',
          html: rendered.html,
          recipient: rendered.recipient,
          intendedRecipient: rendered.recipient,
          testMode: false,
          templateId: template.id,
          templateName: template.name,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, error: data?.error || `HTTP ${res.status}`, notConfigured: !!data?.notConfigured });
      } else {
        setResult({ ok: true, messageId: data?.messageId, recipient: rendered.recipient });
        if (typeof onLogged === 'function') {
          onLogged({
            sentAt: new Date().toISOString(),
            recipient: rendered.recipient,
            intendedRecipient: rendered.recipient,
            testMode: false,
            messageId: data?.messageId || null,
            subject: rendered.subject,
            templateId: template.id,
            templateName: template.name,
            status: 'sent',
            trigger: 'manual',
            kind: 'outreach',
          });
        }
      }
    } catch (e) {
      setResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setSending(false);
    }
  };

  // Portal to body so the modal escapes ViewMount's transform (same fix
  // we applied to ProspectDetail).
  if (typeof document === 'undefined') return null;

  const modal = (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="min-h-full flex items-center justify-center p-4">
        <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <Mail size={18} className="text-indigo-600" />
              <h2 className="font-bold text-slate-900">Send outreach email</h2>
              <span className="text-[9px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-1 rounded font-bold">BENEPATH</span>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
          </div>

          {/* Body — scrollable middle */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Recipient */}
            <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${hasEmail ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' : 'bg-rose-50 border border-rose-200 text-rose-900'}`}>
              {hasEmail
                ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-700" />
                : <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-rose-600" />}
              <div>
                <div className="font-semibold">
                  {hasEmail ? 'Will send to ' : 'No email on this prospect'}
                  {hasEmail && <span className="font-mono">{prospect.email}</span>}
                </div>
                {hasEmail && prospect.name && (
                  <div className="text-xs mt-0.5">{prospect.name}</div>
                )}
                {!hasEmail && (
                  <div className="text-xs mt-0.5">Add an email to the prospect first, then come back.</div>
                )}
              </div>
            </div>

            {/* Template picker */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                Template
              </label>
              <div className="space-y-2">
                {OUTREACH_TEMPLATES.map((t) => {
                  const isSelected = t.id === selectedId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left rounded-lg border p-3 transition ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm text-slate-900">{t.name}</div>
                        {isSelected && (
                          <CheckCircle2 size={14} className="text-indigo-600 flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            {rendered && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Eye size={12} /> Preview
                </label>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2">
                  <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Subject</div>
                  <div className="font-semibold text-sm text-slate-900">{rendered.subject}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <PreviewIframe html={rendered.html} />
                </div>
              </div>
            )}

            {/* Result */}
            {result && result.ok && (
              <div className="flex items-start gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-900">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-700" />
                <div>
                  <div className="font-semibold">Sent to {result.recipient}.</div>
                  {result.messageId && <div className="text-xs mt-0.5 font-mono">id: {result.messageId}</div>}
                </div>
              </div>
            )}
            {result && !result.ok && (
              <div className="flex items-start gap-2 text-sm bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-900">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-rose-600" />
                <div>
                  <div className="font-semibold">{result.notConfigured ? 'Email service not configured yet' : 'Send failed'}</div>
                  <div className="text-xs mt-0.5">{result.error || ''}</div>
                  {result.notConfigured && (
                    <div className="text-xs mt-1">PRIM needs a Resend API key in Vercel (RESEND_API_KEY).</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="text-sm border border-slate-200 bg-white rounded-lg px-4 py-2 hover:bg-slate-50"
            >
              {result?.ok ? 'Close' : 'Cancel'}
            </button>
            {!result?.ok && (
              <button
                onClick={onSend}
                disabled={!canSend}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-2"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/**
 * Renders the HTML email in an iframe so its inline CSS can't leak into
 * the modal's own styles. Auto-sizes height to the content via the
 * srcdoc + onLoad measurement.
 */
function PreviewIframe({ html }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(420);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = () => {
      try {
        const doc = el.contentDocument || el.contentWindow?.document;
        if (!doc) return;
        const h = Math.min(1200, Math.max(400, doc.documentElement.scrollHeight || 420));
        setHeight(h);
      } catch { /* cross-origin guard, srcdoc shouldn't trigger but safe */ }
    };
    el.addEventListener('load', onLoad);
    return () => el.removeEventListener('load', onLoad);
  }, [html]);

  return (
    <iframe
      ref={ref}
      srcDoc={html}
      title="Email preview"
      sandbox="allow-same-origin"
      style={{ width: '100%', height, border: 0, display: 'block', background: '#EEF2F7' }}
    />
  );
}
