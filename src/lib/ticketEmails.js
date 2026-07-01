/**
 * Server-only. Sends a ticket email via Resend (copies the fetch pattern from
 * welcomeEmails.js). Best-effort: NEVER throws — returns { sent, reason } so the
 * caller can proceed even if email fails. Do NOT import into client components.
 */
const FROM = (process.env.RESEND_FROM_ADDRESS || '').trim();

function safeTag(v) { return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256); }

export async function sendTicketEmail({ to, subject, html, text, kind } = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !FROM) return { sent: false, reason: 'not_configured' };
  if (!to || !subject) return { sent: false, reason: 'no_recipient' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM.includes('<') ? FROM : `PRIM <${FROM}>`,
        to: [to],
        subject,
        html,
        text,
        tags: [{ name: 'app', value: 'prim' }, { name: 'kind', value: safeTag(kind || 'ticket') }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('[ticketEmails] Resend rejected:', data); return { sent: false, reason: `resend_${r.status}` }; }
    return { sent: true, reason: 'ok', messageId: data.id };
  } catch (e) {
    console.error('[ticketEmails] Resend fetch failed:', e?.message || e);
    return { sent: false, reason: 'network_error' };
  }
}
