/**
 * Follow-up analytics — pure, read-only derivation for the scorecard.
 * Imports dueStatus from the engine to classify active/overdue.
 * All-time stats over a prospect list.
 */
import { dueStatus } from './followupEngine.mjs';

const CONNECT_OUTCOMES = new Set(['Connected', 'Booked appt']);
const TERMINAL = new Set(['SOLD', 'LOST']);

export function computeFollowupStats(prospects, now) {
  const list = (prospects || []).filter(p => !p.archivedAt);

  let totalTouches = 0;
  let connects = 0;
  const byOutcome = {};

  let activeCount = 0;
  let overdueCount = 0;

  const apptTouchCounts = [];
  const stageMap = {};

  for (const p of list) {
    const touches = Array.isArray(p.touchLog) ? p.touchLog : [];
    totalTouches += touches.length;

    let firstApptIdx = -1;
    touches.forEach((t, i) => {
      if (t.outcome) byOutcome[t.outcome] = (byOutcome[t.outcome] || 0) + 1;
      if (CONNECT_OUTCOMES.has(t.outcome)) connects++;
      if (firstApptIdx === -1 && t.outcome === 'Booked appt') firstApptIdx = i;
    });
    if (firstApptIdx !== -1) apptTouchCounts.push(firstApptIdx + 1);

    const s = dueStatus(p, now);
    const isActive = !TERMINAL.has(p.stage) && (s.state === 'ontrack' || s.state === 'due_today' || s.state === 'overdue' || s.state === 'snoozed');
    if (isActive) {
      activeCount++;
      if (s.state === 'overdue') overdueCount++;
    }

    if (!stageMap[p.stage]) stageMap[p.stage] = { stage: p.stage, count: 0, overdue: 0, touches: 0 };
    stageMap[p.stage].count++;
    stageMap[p.stage].touches += touches.length;
    if (s.state === 'overdue') stageMap[p.stage].overdue++;
  }

  const attempts = totalTouches;
  const connectRate = attempts > 0 ? connects / attempts : 0;
  const onTimeRate = activeCount > 0 ? (activeCount - overdueCount) / activeCount : null;
  const avgTouchesToAppt = apptTouchCounts.length > 0
    ? apptTouchCounts.reduce((a, b) => a + b, 0) / apptTouchCounts.length
    : null;

  const byStage = Object.values(stageMap).sort((a, b) => b.overdue - a.overdue || b.count - a.count);

  return { totalTouches, connects, connectRate, byOutcome, activeCount, overdueCount, onTimeRate, avgTouchesToAppt, byStage };
}
