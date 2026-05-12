'use client';
import { useState } from 'react';
import { Mail, ChevronDown, ChevronRight, Beaker, Zap, CheckCircle2, Eye, MousePointerClick, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { useBetaFeature } from '@/lib/useBetaFeature';

/**
 * Audit panel rendered inside the lead form, showing every post-sale email
 * that's been sent for this lead. Reads from lead.emailLog (populated by
 * the SendWelcomeEmail flow and by the auto-send queue).
 *
 * Collapsible by default — agents who don't care about email history don't
 * see a fat block taking up vertical space.
 *
 * Hidden entirely when:
 *   - User doesn't have access to the post_sale_emails beta, OR
 *   - The lead has no email history (Array empty / undefined)
 */
export default function LeadEmailAuditPanel({ lead }) {
  const { canAccess } = useBetaFeature('post_sale_emails');
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  if (!canAccess) return null;
  const entries = Array.isArray(lead?.emailLog) ? lead.emailLog : [];
  if (entries.length === 0) return null;

  return (
    <div className="border-t border-slate-200 mt-4 pt-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 w-full"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Mail size={14} />
        <span className="font-semibold">Email history</span>
        <span className="text-xs text-slate-500">({entries.length})</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {[...entries].reverse().map((e, i) => (
            <AuditRow
              key={`${e.sentAt || ''}-${i}`}
              entry={e}
              expanded={expandedId === `${e.sentAt}-${i}`}
              onToggle={() => setExpandedId(prev => (prev === `${e.sentAt}-${i}` ? null : `${e.sentAt}-${i}`))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry, expanded, onToggle }) {
  const when = formatDate(entry.sentAt);
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition flex items-center gap-2"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-slate-900 font-medium truncate">{entry.subject || entry.templateName || 'Email'}</span>
            <StatusBadge entry={entry} />
            {entry.testMode && (
              <span className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1 rounded font-bold flex items-center gap-0.5">
                <Beaker size={9} /> TEST
              </span>
            )}
            {entry.trigger === 'auto' && (
              <span className="text-[9px] uppercase tracking-wider bg-violet-100 text-violet-800 px-1 rounded font-bold flex items-center gap-0.5">
                <Zap size={9} /> AUTO
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {when} · to <span className="font-mono">{entry.recipient || '?'}</span>
            {entry.intendedRecipient && entry.intendedRecipient !== entry.recipient && (
              <> · redirected from <span className="font-mono">{entry.intendedRecipient}</span></>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 p-3 bg-slate-50 text-xs space-y-2">
          <Row k="Template" v={entry.templateName || '—'} />
          <Row k="Message ID" v={entry.messageId || '—'} mono />
          <Row k="Recipient" v={entry.recipient || '—'} mono />
          {entry.intendedRecipient && entry.intendedRecipient !== entry.recipient && (
            <Row k="Intended" v={entry.intendedRecipient} mono />
          )}
          <Row k="Sent at" v={when} />
          {entry.deliveredAt && <Row k="Delivered" v={formatDate(entry.deliveredAt)} />}
          {entry.openedAt    && <Row k="Opened"    v={formatDate(entry.openedAt)} />}
          {entry.clickedAt   && <Row k="Clicked"   v={formatDate(entry.clickedAt)} />}
          {entry.bouncedAt   && <Row k="Bounced"   v={formatDate(entry.bouncedAt)} />}
          {entry.failedAt    && <Row k="Failed"    v={formatDate(entry.failedAt)} />}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="flex">
      <div className="w-24 text-slate-500 flex-shrink-0">{k}</div>
      <div className={`text-slate-800 ${mono ? 'font-mono break-all' : ''}`}>{v}</div>
    </div>
  );
}

function StatusBadge({ entry }) {
  // Most-progressed status wins.
  if (entry.bouncedAt) {
    return <Badge icon={<AlertTriangle size={9} />} color="bg-rose-100 text-rose-800">Bounced</Badge>;
  }
  if (entry.failedAt || entry.status === 'failed') {
    return <Badge icon={<XCircle size={9} />} color="bg-rose-100 text-rose-800">Failed</Badge>;
  }
  if (entry.clickedAt) {
    return <Badge icon={<MousePointerClick size={9} />} color="bg-emerald-100 text-emerald-800">Clicked</Badge>;
  }
  if (entry.openedAt) {
    return <Badge icon={<Eye size={9} />} color="bg-blue-100 text-blue-800">Opened</Badge>;
  }
  if (entry.deliveredAt) {
    return <Badge icon={<CheckCircle2 size={9} />} color="bg-emerald-100 text-emerald-800">Delivered</Badge>;
  }
  if (entry.status === 'sent') {
    return <Badge icon={<CheckCircle2 size={9} />} color="bg-slate-100 text-slate-700">Sent</Badge>;
  }
  return <Badge icon={<Clock size={9} />} color="bg-slate-100 text-slate-500">Queued</Badge>;
}

function Badge({ icon, color, children }) {
  return (
    <span className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded font-bold flex items-center gap-0.5 ${color}`}>
      {icon} {children}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
