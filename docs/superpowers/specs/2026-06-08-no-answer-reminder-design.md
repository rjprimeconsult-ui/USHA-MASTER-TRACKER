# No-answer → set a reminder (per-touch) — Design

**Date:** 2026-06-08
**Status:** Approved → implementation

## Purpose
When an agent logs a manual touch with outcome **"No answer,"** let them optionally set a reminder (EOD / tomorrow AM / in 2h / custom date+time). The reminder shows **next to that touch** in the prospect's follow-up timeline — pending, then "follow up now" when due — and clears either automatically (next touch logged) or manually (Done button). Purely in-app on the prospect's file; **no cron, push, email, or global/Kanban alerts.**

## Decisions (from brainstorming)
- Trigger outcome: **"No answer"** only.
- Reach: **only next to the touch** in the prospect timeline.
- Timing: **presets + custom** (End of day, Tomorrow morning, In 2 hours, Custom date/time).
- Clearing: **both** — auto-clear on next touch + manual Done button.

## Data model
Each `touchLog` entry gains three OPTIONAL fields (absent when no reminder):
- `reminderAt`: ISO datetime the reminder is due.
- `reminderNote`: short string (e.g. "Call again"), optional.
- `reminderDoneAt`: ISO datetime when cleared (auto or manual); absent while open.

## Pure logic — `src/lib/followupEngine.mjs` (+ tests)
- `reminderPresetAt(preset, nowIso)` → ISO, local-time math:
  - `'eod'`: today 18:00 local; if now ≥ 18:00 → today 22:00; if now ≥ 22:00 → tomorrow 18:00.
  - `'tomorrow_am'`: tomorrow 09:00 local.
  - `'in_2h'`: now + 2 hours.
- `touchReminderState(touch, nowIso)` → `'none'` (no reminderAt) | `'done'` (reminderDoneAt set) | `'due'` (now ≥ reminderAt) | `'pending'` (now < reminderAt).
- `logTouch` extended: (a) BEFORE pushing the new touch, set `reminderDoneAt = now` on every prior touch that has `reminderAt` and no `reminderDoneAt` (auto-clear); (b) if `touch.reminderAt` is provided, store `reminderAt`/`reminderNote` on the new entry. Cadence behavior unchanged.
- `resolveTouchReminder(prospect, touchId, nowIso)` → returns updated prospect with that touch's `reminderDoneAt = now` (manual dismiss). No-op if not found / already done.

## UI — `src/components/LogTouchSheet.jsx`
- New local state: `reminderPreset` (null | 'eod' | 'tomorrow_am' | 'in_2h' | 'custom'), `customAt` (datetime-local string), `reminderNote`.
- Render a **"Set a reminder (optional)"** section only when `outcome === 'No answer'`, placed BETWEEN the Outcome group and the Note field.
  - Preset chips: End of day · Tomorrow morning · In 2 hours · Custom… (Custom reveals `<input type="datetime-local">`).
  - Note input, prefilled from channel (Call/Voicemail → "Call again", Text → "Text again", Email → "Email again", else "Follow up again"); editable. Selecting a preset is what arms the reminder; note alone does nothing.
- On Save: if a preset/custom is chosen, compute `reminderAt` (preset → `reminderPresetAt(nowIso)`; custom → local datetime → ISO) and include `reminderAt` + `reminderNote` in the `onSave` payload. If outcome ≠ 'No answer' or nothing chosen, payload is unchanged from today.
- Reset reminder state on close and whenever outcome changes away from 'No answer'.

## UI — follow-up timeline (`src/components/FollowupTimeline.jsx`)
For each touch, compute `touchReminderState(touch, now)` and render a line under the touch:
- **pending**: subtle grey — `⏰ Reminder set for {when} · {note}`.
- **due**: amber/highlighted — `⏰ Follow up now — was due {when} · {note}` + a **Done** button → `onResolveReminder(touch.id)`.
- **done**: faint — `✓ followed up`.
- `{when}` formatted friendly (e.g. "Today 6:00 PM", "Tomorrow 9:00 AM", or "Jun 12, 2:30 PM"). Add a small local formatter.

## Wiring — `LeadTracker.jsx` / `ProspectsView.jsx`
- `onLogTouch` handler passes `reminderAt`/`reminderNote` straight through to `logTouch` (already persists the prospect).
- Add `onResolveReminder(prospectId, touchId)` → `resolveTouchReminder` + persist; thread it down to `FollowupTimeline` (same path as the existing timeline props).

## Tests (`src/lib/followupEngine.test.mjs`)
- `reminderPresetAt` for all three presets at boundary `now` values (before 6pm, after 6pm, after 10pm).
- `touchReminderState` transitions (none/pending/due/done).
- `logTouch` stores reminder fields and auto-resolves prior open reminders.
- `resolveTouchReminder` sets `reminderDoneAt`; no-op when missing.

## Out of scope
Cron/push/email, Kanban dots, global "needs a touch" integration, outcomes other than "No answer", response auto-detection.
