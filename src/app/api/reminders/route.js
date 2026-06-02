/**
 * Daily prospect-reminder cron.
 *
 * Triggered by Vercel Cron (see vercel.json) at 7am ET every weekday.
 * For each user, fetches today's appointments + overdue follow-ups and
 * sends one summary email if there's anything to flag.
 *
 * Env vars required:
 *   - SUPABASE_URL                  (server-side, not NEXT_PUBLIC_*)
 *   - SUPABASE_SERVICE_ROLE_KEY     (server-side service role — DO NOT EXPOSE)
 *   - RESEND_API_KEY                (Resend.com API key for sending email)
 *   - REMINDERS_FROM_EMAIL          (e.g. "PRIM <reminders@primtracker.com>")
 *   - CRON_SECRET                   (random string — required in Authorization header)
 */

import { createClient } from '@supabase/supabase-js';
import { computePaymentAlerts } from '@/lib/paymentAlerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

function formatAppt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function isOverdueFollowup(p) {
  if (!p?.lastContact) return false;
  const days = (Date.now() - new Date(p.lastContact + 'T00:00:00').getTime()) / 86400000;
  return !p.appointmentTime && days > 5 && !['SOLD', 'LOST', 'GHOSTED'].includes(p.stage);
}

function paymentRowsHtml(alerts) {
  if (!alerts || alerts.length === 0) return '';
  const rows = alerts.map(a => {
    const urgent = a.tier === 'urgent';
    const when = a.daysUntil <= 0 ? 'TODAY' : a.daysUntil === 1 ? 'tomorrow' : `in ${a.daysUntil} days`;
    return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:600;color:#0f172a;">${(a.lead?.name || '(no name)').replace(/[<>]/g, '')}</div>
          <div style="font-size:12px;color:#64748b;">${(a.lead?.mainProduct || '').replace(/[<>]/g, '')} · ${money(a.premium)}/mo</div>
        </td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">
          <div style="font-weight:600;color:${urgent ? '#e11d48' : '#d97706'};">Drafts ${when}</div>
        </td>
      </tr>`;
  }).join('');
  return `
      <h3 style="font-size:11px;font-weight:700;color:#e11d48;text-transform:uppercase;letter-spacing:1px;margin:24px 0 6px 0;">Payments drafting soon — give clients a heads-up</h3>
      <table width="100%" style="border-collapse:collapse;">${rows}</table>`;
}

function htmlBody({ name, todayAppts, overdue, paymentAlerts = [] }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const apptRows = todayAppts.length === 0
    ? '<p style="color:#94a3b8;font-style:italic;margin:8px 0;">No appointments today.</p>'
    : todayAppts.map(p => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;">${(p.name || '(no name)').replace(/[<>]/g, '')}</div>
            <div style="font-size:12px;color:#64748b;">${p.phone || ''}</div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">
            <div style="font-weight:600;color:#4f46e5;">${formatAppt(p.appointmentTime)}</div>
            ${p.nextSteps ? `<div style="font-size:11px;color:#64748b;">${p.nextSteps.replace(/[<>]/g, '').slice(0, 60)}</div>` : ''}
          </td>
        </tr>`).join('');
  const overdueRows = overdue.length === 0
    ? '<p style="color:#94a3b8;font-style:italic;margin:8px 0;">All caught up on follow-ups.</p>'
    : overdue.map(p => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;">${(p.name || '(no name)').replace(/[<>]/g, '')}</div>
            <div style="font-size:12px;color:#f97316;">last contact: ${p.lastContact}</div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:12px;color:#64748b;">
            ${(p.nextSteps || '').replace(/[<>]/g, '').slice(0, 80)}
          </td>
        </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Your Day</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:24px;">
  <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:20px 24px;color:white;">
      <div style="font-weight:800;font-size:20px;letter-spacing:-0.3px;">PRIM · Your Day</div>
      <div style="font-size:12px;opacity:0.9;margin-top:2px;">${today}</div>
    </td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 16px 0;font-size:14px;color:#475569;">Hey ${name ? name.split(' ')[0] : 'there'} — here's what's on your plate today.</p>
      <h3 style="font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:1px;margin:16px 0 6px 0;">Appointments</h3>
      <table width="100%" style="border-collapse:collapse;">${apptRows}</table>
      <h3 style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin:24px 0 6px 0;">Overdue Follow-ups</h3>
      <table width="100%" style="border-collapse:collapse;">${overdueRows}</table>
      ${paymentRowsHtml(paymentAlerts)}
      <div style="margin-top:24px;text-align:center;">
        <a href="https://primtracker.com" style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Open PRIM</a>
      </div>
    </td></tr>
    <tr><td style="border-top:1px solid #e2e8f0;padding:16px 24px;text-align:center;font-size:11px;color:#94a3b8;">
      You're receiving this because you have prospects in PRIM. Reply to this email to ask Juan to turn it off.
    </td></tr>
  </table>
</body></html>`;
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDERS_FROM_EMAIL || 'PRIM <reminders@primtracker.com>';
  if (!apiKey) {
    console.log('[reminders] RESEND_API_KEY not set — skipping send to', to);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function GET(req) {
  // Auth: require CRON_SECRET in Authorization header. Fail CLOSED if
  // the env var is missing — otherwise the endpoint would be publicly
  // callable when CRON_SECRET is unset, leaking all users' prospect
  // data via the service-role client below.
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), { status: 500 });
  }

  const supa = createClient(url, key, { auth: { persistSession: false } });

  // Pull every user's prospects_v1
  const { data: rows, error } = await supa
    .from('user_kv')
    .select('user_id, value')
    .eq('key', 'prospects_v1');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // Pull every user's leads_v5 too (for payment-draft alerts), indexed by user.
  const leadsByUser = new Map();
  {
    const { data: leadRows } = await supa
      .from('user_kv')
      .select('user_id, value')
      .eq('key', 'leads_v5');
    for (const r of leadRows || []) {
      leadsByUser.set(r.user_id, Array.isArray(r.value) ? r.value : []);
    }
  }
  // Some users have leads but no prospects — union the user set so they
  // still get payment-alert emails.
  const userIds = new Set([...(rows || []).map(r => r.user_id), ...leadsByUser.keys()]);
  const prospectsByUser = new Map((rows || []).map(r => [r.user_id, Array.isArray(r.value) ? r.value : []]));

  const summary = { users: 0, sent: 0, skipped: 0, errors: [] };

  for (const userId of userIds) {
    const prospects = prospectsByUser.get(userId) || [];
    const todayAppts = prospects
      .filter(p => p.appointmentTime && isToday(p.appointmentTime) && !p.archivedAt)
      .sort((a, b) => String(a.appointmentTime).localeCompare(String(b.appointmentTime)));
    const overdue = prospects.filter(p => isOverdueFollowup(p) && !p.archivedAt).slice(0, 8);
    // Payment-draft alerts (deals drafting in the next 7 days, not yet taken).
    const paymentAlerts = computePaymentAlerts(leadsByUser.get(userId) || []).slice(0, 12);
    if (todayAppts.length === 0 && overdue.length === 0 && paymentAlerts.length === 0) continue;
    const row = { user_id: userId };

    summary.users++;

    // Resolve user email
    const { data: userResp, error: uerr } = await supa.auth.admin.getUserById(row.user_id);
    if (uerr || !userResp?.user?.email) {
      summary.errors.push({ user_id: row.user_id, err: uerr?.message || 'no email' });
      continue;
    }
    const email = userResp.user.email;
    const name = userResp.user.user_metadata?.name || '';

    try {
      const subjectBits = [];
      if (todayAppts.length) subjectBits.push(`${todayAppts.length} appt${todayAppts.length !== 1 ? 's' : ''}`);
      if (overdue.length) subjectBits.push(`${overdue.length} follow-up${overdue.length !== 1 ? 's' : ''}`);
      if (paymentAlerts.length) subjectBits.push(`${paymentAlerts.length} payment${paymentAlerts.length !== 1 ? 's' : ''} drafting`);
      const result = await sendEmail(
        email,
        `Today: ${subjectBits.join(' · ')}`,
        htmlBody({ name, todayAppts, overdue, paymentAlerts })
      );
      if (result.skipped) summary.skipped++;
      else summary.sent++;
    } catch (e) {
      summary.errors.push({ user_id: row.user_id, err: String(e.message || e) });
    }
  }

  return Response.json(summary);
}
