# Prospect Follow-up System — Design

**Date:** 2026-06-03
**Status:** Approved (design); ready for implementation planning
**Area:** Prospects mini-CRM (`src/components/views/ProspectsView.jsx`, `src/lib/prospects.js`)

## Goal

Turn the Prospects mini-CRM from a passive tracker into a follow-up **coach + accountability loop**. Teach agents the *right* way to follow up at each stage, capture every touch, nudge them when they fall behind, and surface analytics that reveal patterns agents can't see themselves.

## Decisions (locked)

1. **Playbook source:** PRIM ships a best-practice playbook per stage, **editable** later in settings. Out-of-the-box consistency, zero agent setup.
2. **Cadence engine:** **Auto-pilot.** Entering a stage arms a follow-up sequence; logging a touch advances it; overdue touches nudge the agent.
3. **Touch log capture:** **channel + outcome + note** per touch (richest — powers history, coaching, and smart suggestions).
4. **Scope:** Full vision (A + B + C), built in **3 phases**.
5. **Funnel rollup:** A logged prospect touch **auto-contributes** to the dashboard's daily Activity Funnel (dials/appts/pitches/closes), with a guard against double-counting on days the agent also logs the funnel manually.

## Constraints (always honor)

- **HIPAA:** Playbook scripts are generic templates with no client PHI. Merge tokens limited to `{first}`, `{agent}`, `{time}`. No policy numbers or health details in scripts.
- **ACA WRAP excluded** from all scripts/templates (supplementary product — never referenced).
- **No cross-user editing:** all data is per-agent in their own `user_kv`; nothing here reads or writes another user's data.
- Touch notes are the agent's own internal CRM data (prospect names already live there) — fine to store; never emailed externally except the existing follow-up nudge which already uses the prospect name.

## Existing surfaces this builds on (do not duplicate)

- **Stages** (`DEFAULT_PROSPECT_STAGES`): Webby Set, Webby Confirmed, Appointment Set, Missed Appt, Pending Decision, Follow-up Later, Ghosted, Sold, Lost.
- **Prospect record** (`newProspect` in `src/lib/prospects.js`): has `stage`, `lastContact`, `nextSteps`, `appointmentTime`, `emailLog` (auto outreach emails).
- **Accountability today:** `TodayPanel` (today's appts + overdue follow-ups via crude `isOverdueFollowup` >5-day rule), `OutreachRemindersWidget` ("Follow-ups due"), daily reminders cron (`/api/reminders`, email + push).
- **Dashboard daily Activity Log/Funnel** (`activities_v1`): per-day dials/appointments/pitches/closes totals. Separate layer; the new touch log rolls up INTO it.

## 1. Data model

Extend the prospect record (`newProspect`) with:

```
touchLog: [],          // [{ id, at(ISO), channel, outcome, note }]
cadence: {             // current stage's sequence position
  stepIndex: 0,        // which step of the active stage cadence
  nextDueAt: null,     // ISO; when the next touch is due
  snoozedUntil: null,  // ISO; suppresses nudges until then
  completedAt: null,   // ISO; set when cadence finishes (breakup reached)
},
stageEnteredAt: null,  // ISO; stamped on stage change (arms the cadence)
```

- **Channels:** `Call | Text | Email | Voicemail | Other`
- **Outcomes:** `No answer | Left VM | Connected | Booked appt | Not interested | Other`

New settings store: **`followup_playbook_v1`** — the editable cadences (defaults in §2). Shape:

```
{
  version: 1,
  stages: {
    MISSED_APPT: { steps: [ { afterDays, channel, script }, ... ], onComplete: 'GHOSTED' },
    ...
  }
}
```

`afterDays` = days after the previous action (stage entry for step 0, last touch thereafter). `onComplete` = suggested stage when the cadence's final ("breakup") step is logged.

Migration: on load, prospects without the new fields get them defaulted (non-destructive), and `stageEnteredAt` backfills from `createdAt` if missing.

## 2. The Playbook (editable defaults)

| Stage | Cadence (afterDays → channel) | onComplete |
|---|---|---|
| Webby Set | 0 Text confirm → (day-before) Text → (morning-of) Text | MISSED_APPT if unconfirmed |
| Webby Confirmed | (morning-of) Text reminder | — (rolls to appt) |
| Appointment Set | (day-before) reminder → (1h-before) reminder | — (rolls to appt) |
| Missed Appt | 0 Call + Text → +1 Call → +3 Text → +7 breakup | GHOSTED |
| Pending Decision | +1 Text → +2 Call → +4 Text → +7 Call → +10 breakup | FOLLOWUP_LATER |
| Follow-up Later | +3 Text → +7 Call → +14 Text → +30 Call | (loop / long nurture) |
| Ghosted | +1 Text → +2 Call+VM → +4 Text → +7 breakup | LOST |
| Sold / Lost | no cadence (terminal) | — |

Time-of-day anchored steps (Webby/Appointment "day-before", "1h-before") are computed off `appointmentTime` rather than `afterDays`.

**Sample scripts** (generic, token-merged):
- Missed Appt step 1 (Text): "Hi {first}, we had our call set for {time} — I know life gets busy! Want me to grab another quick slot today or tomorrow?"
- Ghosted breakup (Text): "Hi {first}, I haven't been able to reach you so I'll close your file for now. If your coverage needs change, I'm one text away. — {agent}"

Full default script set authored during Phase 1 build; all editable in settings.

## 3. Auto-pilot engine (`src/lib/followupEngine.mjs` — pure, tested)

- `armCadence(prospect, playbook, now)` → sets `stageEnteredAt`, `cadence.stepIndex=0`, `nextDueAt`.
- `logTouch(prospect, touch, playbook, now)` → appends to `touchLog`, advances `stepIndex`, recomputes `nextDueAt`; if final step → set `completedAt` and return `suggestedStage`.
- `dueStatus(prospect, now)` → `{ state: 'ontrack'|'due_today'|'overdue'|'snoozed'|'done', daysLate, nextDueAt }`.
- `snooze(prospect, days, now)`.
- Terminal stages (SOLD/LOST) → cadence disarmed.

## 4. UX

**Prospect detail bubble** (`ProspectsView.jsx`):
- **Next-step card** (top of bubble): "▶ Step 3 of 5 · Call · due in 1 day", the suggested script with a **Copy** button, and a primary **[Log touch]** button. When done/terminal, shows completed state.
- **Activity timeline** section: reverse-chron, merging `touchLog` + existing `emailLog` into one history (channel icon · outcome chip · note · relative time).

**Log touch sheet** (small modal/sheet): channel select, outcome select, optional note → saves via `logTouch`. Available from the detail bubble AND the kanban card.

**Kanban card:** a status **dot** (green ontrack / amber due-today / red overdue / grey snoozed) + a one-tap **[Log touch]** affordance.

**Nudges (reuse):** `isOverdueFollowup` and the cron/widget queries switch to `dueStatus` from the engine, so the TODAY panel, "Follow-ups due" widget, and daily email/push all reflect playbook due dates and lateness.

## 5. Smart outcomes (Phase 2)

Non-blocking suggestion chip after logging certain outcomes:
- Booked appt → "Move to Appointment Set?"
- Not interested → "Move to Lost?"
- No answer 3× consecutive → "Consider Ghosted?"

One tap accepts (re-arms the new stage's cadence); ignorable. Plus **snooze** UI and **breakup** prompt at cadence end.

**Funnel rollup:** logging a touch contributes to `activities_v1` for that day — each Call/Text/Voicemail/Email attempt → one **dial**; a **Booked appt** outcome → one **appointment**. Pitches and closes are NOT inferred from touches (they stay manual / sourced from sales), to avoid guessing. Guard: rollup contributions are tagged (`source: 'followup'`) and reconciled against manual entries so a day isn't double-counted.

## 6. Analytics scorecard (Phase 3) — `src/lib/followupStats.mjs` (pure, tested)

New **Follow-up** panel (Prospects view) + a summary tile on the CPA Dashboard:
- **On-time follow-up %** (touched by due date) — the headline accountability metric.
- Touches logged, **connect rate** (connected ÷ attempts), **avg touches-to-appointment**, outcomes funnel.
- **By stage:** stall points + which cadences convert.
- Feeds the parked TEAM/manager read-only view later.

## 7. Phasing / build order

- **Phase 1 — Core loop:** data model + migration, `followup_playbook_v1` defaults, `followupEngine.mjs` (+ tests), Log-touch sheet, next-step card, activity timeline, kanban status dot, nudge integration (TODAY/widget/cron read engine). Usable on its own.
- **Phase 2 — Smart outcomes:** outcome→stage suggestions, snooze, breakup prompts, daily-funnel rollup with double-count guard.
- **Phase 3 — Analytics:** `followupStats.mjs` (+ tests), Follow-up panel, dashboard tile.

Each phase ends with `npx --no-install next build` + `node --test` on the new libs, then commit/push.

## Testing

- `src/lib/followupEngine.test.mjs` — arming, advancing, due/overdue/snooze math, terminal disarm, onComplete suggestion, time-anchored steps.
- `src/lib/followupStats.test.mjs` — on-time %, connect rate, touches-to-appt, funnel-by-stage, empty/edge cases.
- Playbook editing round-trips through `followup_playbook_v1` without breaking in-flight cadences.

## Out of scope (v2+)

- AI-generated per-prospect suggestions (decided against; playbook is built-in/editable).
- Manager/team rollups beyond feeding the existing parked TEAM view.
- Automated sending of the scripts (scripts are copy-to-use; sending stays via existing outreach email flow).
