/**
 * Prospect follow-up engine — pure, dependency-free cadence logic.
 * Imported by both client components and node:test. No DOM/Next imports.
 *
 * A "playbook" maps a stage id -> { steps: [{ afterDays, channel, script }], onComplete }.
 * `afterDays` = days after the previous action (stage entry for step 0,
 * last logged touch thereafter). `onComplete` = suggested stage when the
 * final (breakup) step is logged.
 */

export const CHANNELS = ['Call', 'Text', 'Email', 'Voicemail', 'Other'];
export const OUTCOMES = ['No answer', 'Left VM', 'Connected', 'Booked appt', 'Not interested', 'Other'];

export const FOLLOWUP_PLAYBOOK_KEY = 'followup_playbook_v1';

export const FOLLOWUP_DEFAULTS = {
  touchLog: [],
  stageEnteredAt: null,
  cadence: { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null },
};

export const DEFAULT_PLAYBOOK = {
  version: 1,
  stages: {
    MISSED_APPT: {
      onComplete: 'GHOSTED',
      steps: [
        { afterDays: 0, channel: 'Call', script: "Hi {first}, we just missed our call set for {time} — calling now in case you're free!" },
        { afterDays: 0, channel: 'Text', script: "Hi {first}, sorry we missed each other at {time}! Life gets busy — want me to grab another quick slot today or tomorrow?" },
        { afterDays: 1, channel: 'Call', script: "Following up on rescheduling your coverage review, {first}. I have a couple of openings — what works better, morning or afternoon?" },
        { afterDays: 3, channel: 'Text', script: "Hey {first}, still happy to find you the right plan when you're ready. Want me to text you 2 times to pick from?" },
        { afterDays: 7, channel: 'Text', script: "Hi {first}, I haven't been able to reconnect so I'll pause for now. Whenever you're ready, I'm one text away. — {agent}" },
      ],
    },
    PENDING_DECISION: {
      onComplete: 'FOLLOWUP_LATER',
      steps: [
        { afterDays: 1, channel: 'Text', script: "Hi {first}! Just checking in on the options we went over — any questions I can clear up so you feel 100% confident?" },
        { afterDays: 2, channel: 'Call', script: "Hi {first}, wanted to walk through any last questions on the plan and help you lock in your start date. Got 5 minutes?" },
        { afterDays: 4, channel: 'Text', script: "Hey {first}, checking in — the sooner we set it up the sooner you're covered. Want me to send the enrollment link?" },
        { afterDays: 7, channel: 'Call', script: "Hi {first}, rates and availability can change month to month — let's get you protected before anything shifts. Free now?" },
        { afterDays: 10, channel: 'Text', script: "Hi {first}, I'll set this aside for now so I'm not crowding you. When you're ready to move forward, just reply and I'll pick right back up. — {agent}" },
      ],
    },
    FOLLOWUP_LATER: {
      onComplete: 'FOLLOWUP_LATER',
      steps: [
        { afterDays: 3, channel: 'Text', script: "Hi {first}! Circling back as promised — has anything changed with your coverage timing?" },
        { afterDays: 7, channel: 'Call', script: "Hey {first}, checking in to see if now's a better time to look at your options. Quick call?" },
        { afterDays: 14, channel: 'Text', script: "Hi {first}, still here whenever you're ready. Want me to send a quick quote to look over on your own time?" },
        { afterDays: 30, channel: 'Call', script: "Hi {first}, monthly check-in! Any change in your situation that makes coverage a priority now?" },
      ],
    },
    GHOSTED: {
      onComplete: 'LOST',
      steps: [
        { afterDays: 1, channel: 'Text', script: "Hi {first}, lost you for a sec! Still want me to finish putting your options together?" },
        { afterDays: 2, channel: 'Voicemail', script: "Hi {first}, it's {agent} — left you a quick voicemail with next steps on your coverage. Call or text me back anytime." },
        { afterDays: 4, channel: 'Text', script: "Hey {first}, trying you one more way — even a quick 'not now' helps me know how to help. 😊" },
        { afterDays: 7, channel: 'Text', script: "Hi {first}, I haven't heard back so I'll close your file for now. If your coverage needs change, I'm one text away. — {agent}" },
      ],
    },
  },
};

export function playbookForStage(playbook, stageId) {
  const stage = playbook?.stages?.[stageId];
  return Array.isArray(stage?.steps) ? stage.steps : [];
}

export function ensureFollowupFields(prospect, now) {
  const p = { ...prospect };
  if (!Array.isArray(p.touchLog)) p.touchLog = [];
  if (!p.cadence || typeof p.cadence !== 'object') {
    p.cadence = { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null };
  } else {
    p.cadence = {
      stepIndex: Number(p.cadence.stepIndex) || 0,
      nextDueAt: p.cadence.nextDueAt ?? null,
      snoozedUntil: p.cadence.snoozedUntil ?? null,
      completedAt: p.cadence.completedAt ?? null,
    };
  }
  if (!p.stageEnteredAt) p.stageEnteredAt = prospect.createdAt || now;
  return p;
}

// Add N days to an ISO timestamp, preserving time-of-day. Returns ISO.
function addDaysIso(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString();
}

export function armCadence(prospect, playbook, now) {
  const p = { ...prospect, stageEnteredAt: now };
  const steps = playbookForStage(playbook, p.stage);
  if (steps.length === 0) {
    p.cadence = { stepIndex: 0, nextDueAt: null, snoozedUntil: null, completedAt: null };
    return p;
  }
  p.cadence = {
    stepIndex: 0,
    nextDueAt: addDaysIso(now, steps[0].afterDays),
    snoozedUntil: null,
    completedAt: null,
  };
  return p;
}

function makeId() {
  try { return globalThis.crypto.randomUUID(); }
  catch { return 'tch_' + Math.abs(Date.now()).toString(36); }
}

/**
 * Record a touch. Returns { prospect, suggestedStage }.
 */
export function logTouch(prospect, touch, playbook, now) {
  const p = { ...prospect, touchLog: [...(prospect.touchLog || [])], cadence: { ...prospect.cadence } };
  p.touchLog.push({
    id: makeId(),
    at: now,
    channel: touch.channel,
    outcome: touch.outcome,
    note: touch.note || '',
  });

  const steps = playbookForStage(playbook, p.stage);
  let suggestedStage = null;

  if (steps.length === 0) {
    p.cadence.nextDueAt = null;
    p.cadence.snoozedUntil = null;
    return { prospect: p, suggestedStage };
  }

  const loggedIndex = Math.min(Number(p.cadence.stepIndex) || 0, steps.length - 1);
  const nextIndex = loggedIndex + 1;
  p.cadence.snoozedUntil = null;

  if (nextIndex >= steps.length) {
    p.cadence.completedAt = now;
    p.cadence.nextDueAt = null;
    suggestedStage = playbook.stages[p.stage]?.onComplete || null;
    if (suggestedStage === p.stage) suggestedStage = null;
  } else {
    p.cadence.stepIndex = nextIndex;
    p.cadence.nextDueAt = addDaysIso(now, steps[nextIndex].afterDays);
  }
  return { prospect: p, suggestedStage };
}

function dayKey(iso) { return new Date(iso).toISOString().slice(0, 10); }

/**
 * Returns { state, daysLate, nextDueAt }.
 * state: 'none' | 'done' | 'snoozed' | 'overdue' | 'due_today' | 'ontrack'
 */
export function dueStatus(prospect, now) {
  const c = prospect?.cadence || {};
  if (c.completedAt) return { state: 'done', daysLate: 0, nextDueAt: null };
  if (!c.nextDueAt) return { state: 'none', daysLate: 0, nextDueAt: null };
  if (c.snoozedUntil && new Date(now) < new Date(c.snoozedUntil)) {
    return { state: 'snoozed', daysLate: 0, nextDueAt: c.nextDueAt };
  }
  const nowMs = new Date(now).getTime();
  const dueMs = new Date(c.nextDueAt).getTime();
  if (dayKey(now) === dayKey(c.nextDueAt)) return { state: 'due_today', daysLate: 0, nextDueAt: c.nextDueAt };
  if (nowMs > dueMs) {
    const daysLate = Math.floor((nowMs - dueMs) / 86400000);
    return { state: 'overdue', daysLate, nextDueAt: c.nextDueAt };
  }
  return { state: 'ontrack', daysLate: 0, nextDueAt: c.nextDueAt };
}

export function snooze(prospect, days, now) {
  return { ...prospect, cadence: { ...prospect.cadence, snoozedUntil: addDaysIso(now, days) } };
}
