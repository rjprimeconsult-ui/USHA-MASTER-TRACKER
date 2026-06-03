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
import webpush from 'web-push';
import { computePaymentAlerts } from '@/lib/paymentAlerts';
import { TAKEN_STAGES, PENDING_STAGES, NOT_TAKEN_STAGES, PLATFORM_EXPENSE_CATEGORIES } from '@/lib/constants';
import { dueStatus } from '@/lib/followupEngine.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---- Web push setup ----
const PUSH_KEY = 'push_subscriptions_v1';
let pushReady = false;
try {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails('mailto:rjprimeconsult@gmail.com', pub, priv);
    pushReady = true;
  }
} catch (e) {
  console.warn('[reminders] web-push not configured:', e?.message);
}

// Send a push to all of a user's subscriptions. Returns the endpoints that
// are gone (404/410) so the caller can prune them.
async function sendPush(subs, payload) {
  if (!pushReady || !Array.isArray(subs) || subs.length === 0) return { dead: [] };
  const dead = [];
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, body);
    } catch (e) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) dead.push(sub.endpoint);
    }
  }));
  return { dead };
}

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

// ---- Weekly digest math (Monday only) ----
// Factual, app-matching numbers: this week's production + month-to-date
// taken rate, production, and CPA. CPA uses the same lead-acquisition
// invested definition as the dashboard (lead spend + CRM weekly/daily +
// platform spend) ÷ issued this month.
function buildDigest({ leads = [], investments = [], expenses = [], now = new Date() }) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const ym = now.toISOString().slice(0, 7);
  const weekAgoISO = iso(new Date(now.getTime() - 7 * 86400000));
  const inMonth = (s) => String(s || '').slice(0, 7) === ym;

  let weekIssued = 0, weekAdvance = 0;
  let monthIssued = 0, monthSubmitted = 0, monthAdvance = 0;
  for (const l of leads) {
    if (!l || !l.closedDate) continue;
    const d = String(l.closedDate).slice(0, 10);
    const isIssued = TAKEN_STAGES.includes(l.stage);
    const isPending = PENDING_STAGES.includes(l.stage);
    const isNotTaken = NOT_TAKEN_STAGES.includes(l.stage);
    if (inMonth(d)) {
      if (isIssued || isPending || isNotTaken) monthSubmitted += 1;
      if (isIssued) { monthIssued += 1; monthAdvance += Number(l.dealValue) || 0; }
    }
    if (d >= weekAgoISO && isIssued) { weekIssued += 1; weekAdvance += Number(l.dealValue) || 0; }
  }

  // Month invested (lead-acquisition slice) for CPA.
  let monthInvested = 0;
  for (const i of investments) {
    if (!inMonth(i.weekStart)) continue;
    monthInvested += (Number(i.leadSpend) || 0) + (Number(i.crmWeekly) || 0) + (Number(i.crmDaily) || 0);
  }
  for (const e of expenses) {
    if (!e || !inMonth(e.date)) continue;
    if (PLATFORM_EXPENSE_CATEGORIES.includes(e.category)) monthInvested += Number(e.amount) || 0;
  }
  const monthRate = monthSubmitted > 0 ? (monthIssued / monthSubmitted) * 100 : 0;
  const cpa = monthIssued > 0 ? monthInvested / monthIssued : 0;

  return { weekIssued, weekAdvance, monthIssued, monthSubmitted, monthRate, monthAdvance, monthInvested, cpa };
}

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

function digestHtml(d) {
  if (!d) return '';
  const stat = (label, value, sub) => `
    <td style="padding:10px 8px;text-align:center;border:1px solid #e2e8f0;border-radius:8px;">
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
      <div style="font-size:18px;font-weight:800;color:#0f172a;margin-top:2px;">${value}</div>
      ${sub ? `<div style="font-size:10px;color:#94a3b8;">${sub}</div>` : ''}
    </td>`;
  return `
      <h3 style="font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:1px;margin:24px 0 8px 0;">Weekly Snapshot</h3>
      <table width="100%" style="border-collapse:separate;border-spacing:6px 0;">
        <tr>
          ${stat('This week', `${d.weekIssued}`, `${money0(d.weekAdvance)} advance`)}
          ${stat('MTD taken rate', `${d.monthRate.toFixed(0)}%`, `${d.monthIssued}/${d.monthSubmitted}`)}
          ${stat('MTD production', money0(d.monthAdvance), `${d.monthIssued} issued`)}
          ${stat('MTD CPA', d.monthIssued > 0 ? money0(d.cpa) : '—', d.monthIssued > 0 ? 'per deal' : 'no deals')}
        </tr>
      </table>`;
}

function htmlBody({ name, todayAppts, overdueFollowups, paymentAlerts = [], digest = null }) {
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
  const overdueRows = overdueFollowups.length === 0
    ? '<p style="color:#94a3b8;font-style:italic;margin:8px 0;">All caught up on follow-ups.</p>'
    : overdueFollowups.map(({ p, s }) => {
        const label = s.state === 'overdue' ? `${s.daysLate}d overdue` : 'due today';
        return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;">${(p.name || 'Unnamed prospect').replace(/[<>]/g, '')}</div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right;">
            <div style="font-size:12px;color:#f97316;">follow-up ${label}</div>
          </td>
        </tr>`;
      }).join('');

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
      ${digestHtml(digest)}
      <h3 style="font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:1px;margin:16px 0 6px 0;">Appointments</h3>
      <table width="100%" style="border-collapse:collapse;">${apptRows}</table>
      <h3 style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin:24px 0 6px 0;">Follow-ups Due</h3>
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

  // Push subscriptions per user (for browser push alongside the email).
  const subsByUser = new Map();
  if (pushReady) {
    const { data: subRows } = await supa
      .from('user_kv')
      .select('user_id, value')
      .eq('key', PUSH_KEY);
    for (const r of subRows || []) {
      subsByUser.set(r.user_id, Array.isArray(r.value) ? r.value : []);
    }
  }
  // Some users have leads but no prospects — union the user set so they
  // still get payment-alert emails.
  const userIds = new Set([...(rows || []).map(r => r.user_id), ...leadsByUser.keys()]);
  const prospectsByUser = new Map((rows || []).map(r => [r.user_id, Array.isArray(r.value) ? r.value : []]));

  // Weekly digest runs Mondays only. Cron fires 12:00 UTC (7–8am ET), so the
  // UTC weekday matches the ET weekday at that hour. Fetch the extra stores
  // only on Mondays to keep the other days lean.
  const isMonday = new Date().getUTCDay() === 1;
  const investmentsByUser = new Map();
  const expensesByUser = new Map();
  if (isMonday) {
    const [{ data: invRows }, { data: expRows }] = await Promise.all([
      supa.from('user_kv').select('user_id, value').eq('key', 'investments_v2'),
      supa.from('user_kv').select('user_id, value').eq('key', 'business_expenses_v1'),
    ]);
    for (const r of invRows || []) investmentsByUser.set(r.user_id, Array.isArray(r.value) ? r.value : []);
    for (const r of expRows || []) expensesByUser.set(r.user_id, Array.isArray(r.value) ? r.value : []);
  }

  const summary = { users: 0, sent: 0, skipped: 0, errors: [] };

  for (const userId of userIds) {
    const prospects = prospectsByUser.get(userId) || [];
    const userLeads = leadsByUser.get(userId) || [];
    const todayAppts = prospects
      .filter(p => p.appointmentTime && isToday(p.appointmentTime) && !p.archivedAt)
      .sort((a, b) => String(a.appointmentTime).localeCompare(String(b.appointmentTime)));
    const nowIso = new Date().toISOString();
    const overdueFollowups = (prospects || [])
      .filter(p => !p.archivedAt && !['SOLD', 'LOST'].includes(p.stage))
      .map(p => ({ p, s: dueStatus(p, nowIso) }))
      .filter(x => x.s.state === 'overdue' || x.s.state === 'due_today')
      .sort((a, b) => (b.s.daysLate || 0) - (a.s.daysLate || 0));
    // Payment-draft alerts (deals drafting in the next 7 days, not yet taken).
    const paymentAlerts = computePaymentAlerts(userLeads).slice(0, 12);
    // Weekly digest (Mondays, for agents with any leads).
    const digest = (isMonday && userLeads.length > 0)
      ? buildDigest({ leads: userLeads, investments: investmentsByUser.get(userId) || [], expenses: expensesByUser.get(userId) || [] })
      : null;
    if (todayAppts.length === 0 && overdueFollowups.length === 0 && paymentAlerts.length === 0 && !digest) continue;
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
      if (overdueFollowups.length) subjectBits.push(`${overdueFollowups.length} follow-up${overdueFollowups.length !== 1 ? 's' : ''}`);
      if (paymentAlerts.length) subjectBits.push(`${paymentAlerts.length} payment${paymentAlerts.length !== 1 ? 's' : ''} drafting`);
      const subject = (digest && subjectBits.length === 0)
        ? `Your weekly snapshot — ${digest.monthRate.toFixed(0)}% taken rate MTD`
        : `Today: ${subjectBits.join(' · ')}`;
      const result = await sendEmail(
        email, subject,
        htmlBody({ name, todayAppts, overdueFollowups, paymentAlerts, digest })
      );
      if (result.skipped) summary.skipped++;
      else summary.sent++;
    } catch (e) {
      summary.errors.push({ user_id: row.user_id, err: String(e.message || e) });
    }

    // Browser push (alongside the email) for users who enabled it.
    const subs = subsByUser.get(userId) || [];
    if (pushReady && subs.length > 0) {
      const bits = [];
      if (paymentAlerts.length) bits.push(`${paymentAlerts.length} payment${paymentAlerts.length !== 1 ? 's' : ''} drafting`);
      if (todayAppts.length) bits.push(`${todayAppts.length} appt${todayAppts.length !== 1 ? 's' : ''} today`);
      if (overdueFollowups.length) bits.push(`${overdueFollowups.length} follow-up${overdueFollowups.length !== 1 ? 's' : ''}`);
      const pushBody = bits.length
        ? bits.join(' · ')
        : (digest ? `Weekly snapshot: ${digest.monthRate.toFixed(0)}% taken rate MTD` : '');
      if (pushBody) {
        try {
          const { dead } = await sendPush(subs, {
            title: 'PRIM',
            body: pushBody,
            url: 'https://www.primtracker.com',
            urgent: paymentAlerts.some(a => a.tier === 'urgent'),
          });
          // Prune expired subscriptions so we don't keep pushing to dead endpoints.
          if (dead.length) {
            const alive = subs.filter(s => !dead.includes(s.endpoint));
            await supa.from('user_kv').upsert(
              { user_id: userId, key: PUSH_KEY, value: alive, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,key' }
            );
          }
        } catch (e) {
          summary.errors.push({ user_id: userId, err: 'push: ' + String(e.message || e) });
        }
      }
    }
  }

  return Response.json(summary);
}
