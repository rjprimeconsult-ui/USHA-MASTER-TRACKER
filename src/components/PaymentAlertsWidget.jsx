'use client';
/**
 * Payment Alerts widget — collapsible panel that surfaces deals whose first
 * premium drafts soon, so the agent can give the client a heads-up and avoid
 * a NOT TAKEN (protecting Taken Rate).
 *
 * Same collapsible card pattern as OutreachRemindersWidget / CalendarPanel.
 * Mounts on both the CPA Dashboard and Closed Deals.
 *
 * Delivery is 100% client-side (no backend, no tier gating, works for every
 * agent): "Copy text" → clipboard (for SMS), and "Email" → mailto: link that
 * opens the agent's own mail client pre-filled. Both mark the deal as
 * "messaged"; "✓ Taken" clears the alert once the payment goes through.
 *
 * Props:
 *   leads          — array of leads (alerts derived live)
 *   onMarkTaken    — (leadId) => void   sets paymentConfirmedAt
 *   onSentHeadsUp  — (leadId) => void   sets paymentHeadsUpSentAt
 *   defaultCollapsed (default true)
 */
import { useMemo, useState } from 'react';
import {
  Bell, ChevronDown, ChevronRight, CheckCircle2, Copy, Mail, Clock, AlertTriangle, Check,
} from 'lucide-react';
import {
  computePaymentAlerts, buildReminderMessage, REMINDER_TONES, ALERT_TIER,
} from '@/lib/paymentAlerts';

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE_LABEL = { friendly: 'Friendly', professional: 'Professional', stern: 'Stern' };

function draftChip(daysUntil) {
  if (daysUntil <= 0) return { text: 'Drafts TODAY', urgent: true };
  if (daysUntil === 1) return { text: 'Drafts tomorrow', urgent: true };
  return { text: `Drafts in ${daysUntil} days`, urgent: daysUntil <= 2 };
}

export default function PaymentAlertsWidget({
  leads = [],
  onMarkTaken,
  onSentHeadsUp,
  defaultCollapsed = true,
}) {
  const alerts = useMemo(() => computePaymentAlerts(leads), [leads]);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [openId, setOpenId] = useState(null);   // which row's composer is open
  const [tone, setTone] = useState('friendly');
  const [copiedId, setCopiedId] = useState(null);

  if (alerts.length === 0) {
    // Still render the header (collapsed, "all clear") so agents know the
    // feature exists and that nothing is drafting — reassuring, not noise.
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="w-full px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white flex-shrink-0">
              <Bell size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 leading-tight truncate">Payment Alerts</div>
              <div className="text-[11px] text-slate-500 leading-tight truncate">No payments drafting in the next 7 days</div>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1 flex-shrink-0">
            <CheckCircle2 size={10} /> All clear
          </span>
        </div>
      </div>
    );
  }

  const urgentCount = alerts.filter(a => a.tier === ALERT_TIER.URGENT).length;
  const subtitle = `${alerts.length} drafting soon${urgentCount ? ` · ${urgentCount} urgent` : ''} · protecting your taken rate`;

  const markSent = (leadId) => { onSentHeadsUp?.(leadId); };

  const doCopy = async (alert) => {
    const { sms } = buildReminderMessage(alert.lead, tone, { premium: alert.premium });
    try {
      await navigator.clipboard.writeText(sms);
      setCopiedId(alert.id);
      setTimeout(() => setCopiedId(c => (c === alert.id ? null : c)), 2000);
    } catch { /* clipboard blocked — the textarea below is still selectable */ }
    markSent(alert.lead.id);
  };

  const mailtoHref = (alert) => {
    const { subject, body } = buildReminderMessage(alert.lead, tone, { premium: alert.premium });
    const to = encodeURIComponent(alert.lead.email || '');
    return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition text-left"
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white flex-shrink-0">
            <Bell size={14} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 leading-tight truncate">Payment Alerts</div>
            <div className="text-[11px] text-slate-500 leading-tight truncate">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{alerts.length}</span>
          {collapsed ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </div>
      </button>

      {!collapsed && (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {alerts.map((a) => {
            const chip = draftChip(a.daysUntil);
            const isOpen = openId === a.id;
            const msg = isOpen ? buildReminderMessage(a.lead, tone, { premium: a.premium }) : null;
            return (
              <div key={a.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900 truncate">{a.lead.name || '(no name)'}</span>
                      {a.lead.mainProduct && <span className="text-xs text-slate-500 truncate">{a.lead.mainProduct}</span>}
                      <span className="text-xs font-semibold text-indigo-600">{money(a.premium)}/mo</span>
                      {a.sent && (
                        <span className="text-[10px] uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <Check size={9} /> messaged
                        </span>
                      )}
                    </div>
                    <div className="mt-1">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                        chip.urgent
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {chip.urgent ? <AlertTriangle size={10} /> : <Clock size={10} />}
                        {chip.urgent && a.daysUntil > 1 ? 'Keep an eye — ' : ''}{chip.text}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setOpenId(isOpen ? null : a.id)}
                      className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 transition"
                    >
                      {isOpen ? 'Close' : 'Send heads-up'}
                    </button>
                    <button
                      onClick={() => onMarkTaken?.(a.lead.id)}
                      className="text-xs font-semibold border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg px-3 py-1.5 transition flex items-center gap-1"
                      title="Payment went through — clear this alert"
                    >
                      <CheckCircle2 size={12} /> Taken
                    </button>
                  </div>
                </div>

                {/* Inline composer */}
                {isOpen && msg && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mr-1">Tone:</span>
                      {REMINDER_TONES.map(t => (
                        <button
                          key={t}
                          onClick={() => setTone(t)}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
                            tone === t
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                          }`}
                        >
                          {TONE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                    <textarea
                      readOnly
                      value={msg.body}
                      onFocus={(e) => e.target.select()}
                      rows={6}
                      className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-700 resize-none"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => doCopy(a)}
                        className="text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-3 py-1.5 transition flex items-center gap-1.5"
                      >
                        {copiedId === a.id ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy text</>}
                      </button>
                      {a.lead.email ? (
                        <a
                          href={mailtoHref(a)}
                          onClick={() => markSent(a.lead.id)}
                          className="text-xs font-semibold border border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded-lg px-3 py-1.5 transition flex items-center gap-1.5"
                        >
                          <Mail size={12} /> Email {a.lead.email}
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">No email on file — use Copy text for SMS</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
