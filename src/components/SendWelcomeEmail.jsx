'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  Mail, X, Send, Loader2, CheckCircle2, AlertTriangle, Beaker,
} from 'lucide-react';
import {
  loadBundle,
  renderTemplate,
  parseTestAddresses,
  findMissingValues,
} from '@/lib/postSaleEmails';
import { renderPostSaleHtml } from '@/lib/postSaleHtml';
import { loadAgentProfile } from '@/lib/agentProfile';
import { useBetaFeature } from '@/lib/useBetaFeature';
import { supabase, supabaseConfigured } from '@/lib/supabase';

/**
 * Lead-form trigger + preview modal for post-sale emails.
 *
 * Now supports multiple templates: the modal shows a template picker if
 * there's more than one enabled. When there's only one, picker is hidden
 * and the modal renders straight to preview.
 */
export default function SendWelcomeEmail({ lead, onLogged }) {
  const { canAccess, loading: accessLoading } = useBetaFeature('post_sale_emails');
  const [open, setOpen] = useState(false);

  if (accessLoading) return null;
  if (!canAccess) return null;
  if (!lead?.id) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-1.5"
        title="Send a post-sale email to this customer (beta)"
      >
        <Mail size={14} />
        Send email
        <span className="ml-1 text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1 rounded font-bold">BETA</span>
      </button>
      {open && (
        <SendModal lead={lead} onClose={() => setOpen(false)} onLogged={onLogged} />
      )}
    </>
  );
}

function SendModal({ lead, onClose, onLogged }) {
  const { profile } = useBetaFeature('post_sale_emails');
  const [bundle, setBundle] = useState(null);
  const [agentProfile, setAgentProfile] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    // Load BOTH the email templates and the agent profile in parallel.
    // Agent profile drives the polished HTML banner (accent palette +
    // display name) and signature (phone) shown in the preview.
    Promise.all([loadBundle(), loadAgentProfile()]).then(([b, ap]) => {
      if (!alive) return;
      setBundle(b);
      setAgentProfile(ap);
      const enabled = (b.templates || []).filter(t => t.enabled !== false);
      setSelectedId(enabled[0]?.id || b.templates?.[0]?.id || null);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const enabledTemplates = useMemo(
    () => (bundle?.templates || []).filter(t => t.enabled !== false),
    [bundle]
  );
  const template = useMemo(
    () => (bundle?.templates || []).find(t => t.id === selectedId) || null,
    [bundle, selectedId]
  );

  const rendered = template
    ? renderTemplate(template, lead, profile, bundle, {
        agentName: template.fromName || profile?.email?.split('@')[0],
      })
    : null;
  const missing = rendered ? findMissingValues(rendered) : [];

  // When the template uses the polished HTML shell, also render the
  // full HTML client-side so the preview matches exactly what the
  // recipient will see. Same renderer runs on the server at send
  // time — keeps the two views identical.
  const htmlPreview = useMemo(() => {
    if (!template?.useHtmlRender || !rendered || !agentProfile) return null;
    try {
      return renderPostSaleHtml({
        template: {
          subject: rendered.subject,
          closingLine: template.closingLine || '',
          verificationPhone: template.verificationPhone || '',
          referralEnabled: template.referralEnabled !== false,
          referralText: template.referralText || '',
          fromName: template.fromName,
        },
        lead: {
          name: lead?.name || '',
          policyNumber: lead?.policyNumber || '',
          effectiveDate: lead?.effectiveDate || '',
          mainProduct: lead?.mainProduct || '',
          associationPlan: lead?.associationPlan || '',
        },
        profile,
        agentProfile,
        resolvedBody: rendered.body,
        resolvedSubject: rendered.subject,
      });
    } catch {
      return null;
    }
  }, [template, rendered, agentProfile, lead, profile]);
  const testList = parseTestAddresses(bundle?.testAddresses || '');
  const noTestAddress = !!(bundle?.testMode !== false) && testList.length === 0;
  const canSend = rendered && rendered.recipient && !noTestAddress && !sending && !!template;

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
      } catch { /* fall through with no auth */ }
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
          // HTML-mode extras — server renders the full polished shell
          // when useHtmlRender is true. Lead snapshot lets the server
          // build the policy card without a separate lookup. Template
          // extras (closing line, verification phone, referral text,
          // PDF attachment flag) are all per-template settings the
          // agent edited in Post-Sale Email Settings.
          useHtmlRender: template.useHtmlRender === true,
          templateExtras: {
            closingLine: template.closingLine || '',
            verificationPhone: template.verificationPhone || '',
            referralEnabled: template.referralEnabled !== false,
            referralText: template.referralText || '',
            attachDearDoctorPdf: template.attachDearDoctorPdf !== false,
          },
          leadSnapshot: {
            name: lead.name || '',
            policyNumber: lead.policyNumber || '',
            effectiveDate: lead.effectiveDate || '',
            mainProduct: lead.mainProduct || '',
            associationPlan: lead.associationPlan || '',
          },
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
            intendedRecipient: rendered.intendedRecipient,
            testMode: !!rendered.testMode,
            messageId: data?.messageId || null,
            subject: rendered.subject,
            templateId: template.id,
            templateName: template.name,
            status: 'sent',
            trigger: 'manual',
          });
        }
      }
    } catch (e) {
      setResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-indigo-600" />
            <h2 className="font-bold text-slate-900">Send email</h2>
            <span className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1 rounded font-bold">BETA</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          )}

          {!loading && enabledTemplates.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              No enabled templates. Open Settings → Post-Sale Emails to create one.
            </div>
          )}

          {!loading && enabledTemplates.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Template
              </label>
              <select
                value={selectedId || ''}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {enabledTemplates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {!loading && rendered && (
            <>
              <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${rendered.testMode ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-900'}`}>
                {rendered.testMode ? <Beaker size={16} className="mt-0.5 flex-shrink-0 text-amber-700" /> : <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-700" />}
                <div>
                  {rendered.testMode ? (
                    <>
                      <div className="font-semibold">TEST MODE — will send to your test address.</div>
                      <div className="text-xs mt-0.5">
                        Recipient: <span className="font-mono">{rendered.recipient || '(none configured)'}</span>
                        {rendered.intendedRecipient && rendered.intendedRecipient !== rendered.recipient && (
                          <> · redirected from <span className="font-mono">{rendered.intendedRecipient}</span></>
                        )}
                      </div>
                    </>
                  ) : (
                    <div>
                      Will send to <span className="font-mono">{rendered.recipient || '(no email on lead)'}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Subject</div>
                <div className="font-semibold text-sm text-slate-900 mb-3">{rendered.subject}</div>
                {htmlPreview ? (
                  <>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      Preview
                      <span className="text-[9px] uppercase tracking-wider bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">HTML</span>
                    </div>
                    <div className="bg-white border border-slate-200 rounded overflow-hidden">
                      <iframe
                        srcDoc={htmlPreview}
                        title="Email preview"
                        sandbox=""
                        style={{ width: '100%', height: 540, border: 0, display: 'block', background: '#EEF2F7' }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Body</div>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 leading-relaxed">{rendered.body}</pre>
                  </>
                )}
              </div>

              {missing.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>Unresolved placeholders: <span className="font-mono">{missing.join(' ')}</span>. Edit the template (Settings → Emails) to fix.</div>
                </div>
              )}

              {noTestAddress && (
                <div className="flex items-start gap-2 text-xs text-rose-900 bg-rose-50 border border-rose-200 rounded-lg p-2">
                  <AlertTriangle size={14} className="text-rose-600 mt-0.5 flex-shrink-0" />
                  <div>Test mode is on but no test addresses are set. Add one in Settings → Emails before sending.</div>
                </div>
              )}

              {!rendered.recipient && (
                <div className="flex items-start gap-2 text-xs text-rose-900 bg-rose-50 border border-rose-200 rounded-lg p-2">
                  <AlertTriangle size={14} className="text-rose-600 mt-0.5 flex-shrink-0" />
                  <div>No recipient resolved. Either add a customer email to the lead or set a test address in Settings.</div>
                </div>
              )}
            </>
          )}

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

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
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
  );
}
