/**
 * Outreach follow-up reminders — derived state, no separate storage.
 *
 * Given a prospect's emailLog (populated by SendOutreachEmail when a
 * template fires), this module computes whether the next outreach
 * email in the sequence is due, upcoming, or there's nothing left to
 * send.
 *
 * Cadence is fixed for v1: after Email 1 wait 3 days, after Email 2
 * wait 5 more days. Email 3 is the last step — once sent the
 * prospect is considered "done" with the outreach sequence and stops
 * appearing in the reminder list.
 *
 * Reminders auto-cancel without explicit action when:
 *   - The prospect's stage moves to SOLD or LOST (deal closed or
 *     dropped — no point following up further).
 *   - Email 3 has already gone out.
 */

import { OUTREACH_TEMPLATES } from './outreachEmails';

// Days to wait between consecutive outreach emails. Keyed by the
// number of the LAST template that was sent — so after Email 1 wait
// 3 days, after Email 2 wait 5 days, after Email 3 we're done.
export const OUTREACH_CADENCE_DAYS = {
  1: 3,
  2: 5,
};

// Prospect stages that auto-cancel any in-flight follow-up. Closed
// deals (SOLD) don't need more outreach; dead deals (LOST) shouldn't
// either. Anything else keeps the reminder live.
const TERMINAL_STAGES = new Set(['SOLD', 'LOST']);

/**
 * Parse the email template ID to figure out which step in the
 * sequence it is. The IDs are deterministic strings shipped in
 * outreachEmails.js (e.g. 'phc-outreach-2-followup').
 * Returns null when the ID isn't part of the known outreach set.
 */
export function parseOutreachStep(templateId) {
  if (!templateId) return null;
  const m = String(templateId).match(/phc-outreach-(\d+)-/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= OUTREACH_TEMPLATES.length ? n : null;
}

/**
 * Look up the template object for a given step number.
 */
export function templateForStep(step) {
  if (!step) return null;
  const idx = step - 1;
  return OUTREACH_TEMPLATES[idx] || null;
}

/**
 * Find the highest outreach step that's already been sent for this
 * prospect by scanning its emailLog. Outreach entries are tagged with
 * `kind: 'outreach'` by SendOutreachEmail; older entries without that
 * tag still parse correctly via the templateId.
 */
function lastSentStep(prospect) {
  const log = Array.isArray(prospect?.emailLog) ? prospect.emailLog : [];
  let highest = 0;
  let lastEntry = null;
  for (const entry of log) {
    const step = parseOutreachStep(entry?.templateId);
    if (!step) continue;
    if (step > highest) {
      highest = step;
      lastEntry = entry;
    }
  }
  return { step: highest, entry: lastEntry };
}

/**
 * Compute the reminder state for one prospect. Returns null when
 * there's nothing to remind about (sequence not started, completed,
 * or auto-cancelled by terminal stage).
 *
 * Shape:
 *   {
 *     prospectId,
 *     lastSentStep,        // 1 | 2
 *     lastSentAt,          // ISO
 *     nextStep,            // 2 | 3 — the template to send next
 *     nextTemplate,        // the template object (from OUTREACH_TEMPLATES)
 *     dueAt,               // ISO when the next email becomes due
 *     status,              // 'due' | 'upcoming'
 *     daysSinceLast,       // number, for display ("sent 4d ago")
 *     daysUntilDue,        // number, negative = overdue
 *   }
 */
export function getReminderForProspect(prospect, now = Date.now()) {
  if (!prospect?.id) return null;
  if (TERMINAL_STAGES.has(prospect.stage)) return null;

  const { step, entry } = lastSentStep(prospect);
  if (!step) return null;                          // sequence not started
  const cadence = OUTREACH_CADENCE_DAYS[step];
  if (!cadence) return null;                       // Email 3 already sent → done

  const lastSentAt = entry?.sentAt;
  if (!lastSentAt) return null;                    // missing timestamp; can't compute

  const lastTime = new Date(lastSentAt).getTime();
  if (!Number.isFinite(lastTime)) return null;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const dueTime = lastTime + cadence * DAY_MS;
  const daysSinceLast = Math.max(0, Math.floor((now - lastTime) / DAY_MS));
  const msUntilDue = dueTime - now;
  const daysUntilDue = Math.ceil(msUntilDue / DAY_MS);
  const status = now >= dueTime ? 'due' : 'upcoming';
  const nextStep = step + 1;
  const nextTemplate = templateForStep(nextStep);
  if (!nextTemplate) return null;                  // shouldn't happen at step 3+ (cadence check covers)

  return {
    prospectId: prospect.id,
    lastSentStep: step,
    lastSentAt,
    nextStep,
    nextTemplate,
    dueAt: new Date(dueTime).toISOString(),
    status,
    daysSinceLast,
    daysUntilDue,
  };
}

/**
 * Map an array of prospects to their (non-null) reminders.
 *
 * `filter` options:
 *   - 'all'      → everything: due + upcoming
 *   - 'due'      → only past-due (default — what the dashboard widget uses)
 *   - 'upcoming' → only future
 *
 * Sorted: due first (most overdue at top), then upcoming (soonest first).
 */
export function getOutreachReminders(prospects, { filter = 'due', now = Date.now() } = {}) {
  const list = (prospects || [])
    .map(p => {
      const r = getReminderForProspect(p, now);
      return r ? { prospect: p, reminder: r } : null;
    })
    .filter(Boolean);

  const filtered = filter === 'all'
    ? list
    : list.filter(({ reminder }) => reminder.status === filter);

  filtered.sort((a, b) => {
    // Due first
    if (a.reminder.status !== b.reminder.status) {
      return a.reminder.status === 'due' ? -1 : 1;
    }
    // Inside same bucket: due → most overdue first; upcoming → soonest first
    return new Date(a.reminder.dueAt).getTime() - new Date(b.reminder.dueAt).getTime();
  });

  return filtered;
}

/**
 * Picks the template the SendOutreachEmail modal should pre-select
 * when opened for a given prospect. If a reminder is in flight, jump
 * straight to the next-due template. Otherwise default to Email 1.
 */
export function nextTemplateIdForProspect(prospect, now = Date.now()) {
  const reminder = getReminderForProspect(prospect, now);
  if (reminder?.nextTemplate?.id) return reminder.nextTemplate.id;
  return OUTREACH_TEMPLATES[0]?.id || null;
}
