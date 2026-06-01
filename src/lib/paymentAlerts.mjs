/**
 * Payment Alerts — proactive draft-date reminders that protect Taken Rate.
 *
 * When a deal is submitted/closed, its first premium drafts around the
 * policy's EFFECTIVE DATE. If the client doesn't have funds that day the
 * policy bounces → NOT TAKEN → the agent's taken rate drops. This module
 * derives, live from the agent's leads, which deals are about to draft so
 * the agent can give the client a heads-up first.
 *
 * No new data store — alerts are computed from existing lead fields. Two
 * tiny per-lead flags drive lifecycle:
 *   - paymentHeadsUpSentAt : ISO string set when the agent sends a reminder
 *   - paymentConfirmedAt   : ISO string set when marked "Taken" → clears it
 *
 * Pure + self-contained (no imports) so it unit-tests in isolation.
 */

export const ALERT_TIER = { URGENT: 'urgent', HEADSUP: 'headsup' };

// Action window: effective date 3–7 days out = "send the heads-up now".
// 0–2 days out (today / tomorrow / day-after) = "keep an eye on this".
const HEADSUP_MAX = 7;
const URGENT_MAX = 2;

// Only submitted/closed deals draft a premium. (Declined / Not taken /
// Withdrawn never draft, so they never alert.)
const ALERTABLE_STAGES = new Set(['Issued', 'Pending']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' → UTC-midnight ms (date-only, TZ-safe), or null.
function parseYmd(s) {
  const m = String(s || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

// Real "today" as YYYY-MM-DD (local). Tests pass an explicit value instead.
export function todayYmd(d = new Date()) {
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

// Whole days from `today` to `effectiveDate` (negative = past). null if unparseable.
export function daysUntil(effectiveDate, today) {
  const a = parseYmd(effectiveDate);
  const b = parseYmd(today);
  if (a == null || b == null) return null;
  return Math.round((a - b) / 86400000);
}

// The client's total monthly draft = main product + add-ons + association.
export function monthlyPremiumOf(lead) {
  const main = Number(lead?.mainProductPremium) || 0;
  const addons = Array.isArray(lead?.products)
    ? lead.products.reduce((s, p) => s + (Number(p?.premium) || 0), 0)
    : 0;
  const assoc = Number(lead?.associationMonthlyPremium) || 0;
  return Math.round((main + addons + assoc) * 100) / 100;
}

/**
 * Compute the live alert list from a leads array.
 * Returns [{ id, lead, daysUntil, tier, premium, effectiveDate, sent }],
 * soonest-first (urgent on top).
 */
export function computePaymentAlerts(leads, opts = {}) {
  const today = opts.today || todayYmd();
  const out = [];
  for (const lead of leads || []) {
    if (!lead || lead.paymentConfirmedAt) continue;     // already taken/dismissed
    if (!ALERTABLE_STAGES.has(lead.stage)) continue;    // only submitted/closed deals
    const du = daysUntil(lead.effectiveDate, today);
    if (du == null) continue;                           // no effective date entered
    if (du < 0 || du > HEADSUP_MAX) continue;           // outside the 0–7 day window
    out.push({
      id: lead.id,
      lead,
      daysUntil: du,
      tier: du <= URGENT_MAX ? ALERT_TIER.URGENT : ALERT_TIER.HEADSUP,
      premium: monthlyPremiumOf(lead),
      effectiveDate: lead.effectiveDate,
      sent: !!lead.paymentHeadsUpSentAt,
    });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil || String(a.lead?.name).localeCompare(String(b.lead?.name)));
  return out;
}

// ---------- Reminder message templates ----------

function fmtDate(ymd) {
  const m = String(ymd || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd || '');
  return `${MONTHS[+m[2] - 1]} ${+m[3]}`;
}
function money(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

export const REMINDER_TONES = ['friendly', 'professional', 'stern'];

/**
 * Build a heads-up message for a deal in the chosen tone.
 * Returns { subject, body, sms }. Merge fields: first name, amount, date, plan.
 * NOTE: deliberately client-friendly wording — no policy numbers or PHI.
 */
export function buildReminderMessage(lead, tone = 'friendly', opts = {}) {
  const name = firstName(lead?.name);
  const amount = money(opts.premium != null ? opts.premium : monthlyPremiumOf(lead));
  const date = fmtDate(lead?.effectiveDate);
  const plan = lead?.mainProduct || 'your plan';

  let subject, body;
  if (tone === 'professional') {
    subject = `Reminder: your first payment of ${amount} drafts ${date}`;
    body =
`Hello ${name},

This is a courtesy reminder that your initial premium of ${amount} for ${plan} is scheduled to draft on ${date}. Please make sure the funds are available in your account so your coverage takes effect without interruption.

If anything has changed or you have any questions, just reply here.

Thank you!`;
  } else if (tone === 'stern') {
    subject = `Important: ${amount} drafts ${date} — please confirm funds are ready`;
    body =
`${name} — an important heads-up.

Your first payment of ${amount} for ${plan} drafts on ${date}. If the funds are not available on that date, the policy will not take effect and your coverage will lapse.

Please confirm you're set before then so we don't lose the policy.

Thank you.`;
  } else { // friendly (default)
    subject = `Quick heads-up — your first payment drafts ${date}`;
    body =
`Hi ${name}!

Just a friendly heads-up that your first payment of ${amount} for ${plan} drafts on ${date}. Please make sure the funds are ready so your coverage starts smoothly — that's all you need to do on your end!

Reach out anytime if you have any questions. 😊`;
  }

  const sms = body.replace(/\n{2,}/g, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return { subject, body, sms };
}
