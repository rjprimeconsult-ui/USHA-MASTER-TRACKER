# Agent Support Tickets — Design Spec

**Date:** 2026-07-01 · **Status:** approved design, pre-implementation

## Goal
Give PRIM agents an in-app way to report a bug/glitch/error ("submit a ticket"),
route it into a queue Juan owns, notify him by email, and let him hand any ticket
to Claude to diagnose + fix under his approval — so agent problems get handled
even when he's not at his computer or office.

## Decisions locked in (from brainstorming)
- **Autonomy:** Claude diagnoses + proposes; Juan approves every account-touching
  fix. The ticket system organizes intake; it grants Claude NO new standing
  access to customer data.
- **Oversight:** a ticket **queue in the admin dashboard** is the source of truth.
- **Trigger:** Juan triggers Claude ("handle ticket #X") — NO scheduled/auto-triage
  automation in v1 (keeps it simpler + safer).
- **Notifications:** **email only, via Resend. No Slack.**
- **Ticket content:** rich auto-context.
- **Categories:** Upload · Import · Login · Data looks wrong · Billing · Other ·
  **Custom** (free-text when "Custom" is picked).
- **Agent view:** v1 is admin-only; the resolution email closes the loop with the
  agent. No in-app "My reports" list in v1.

## Non-goals (v1)
- No Slack integration. No auto-triage / scheduled agent. No agent-facing ticket
  list. No two-way threaded chat on a ticket. No file attachments beyond a single
  optional screenshot.

## User flows
1. **Agent submits:** clicks "Report an issue" → picks a category (or Custom) →
   writes what happened → optional screenshot → submit. Sees a confirmation with a
   ticket number.
2. **Juan is notified:** email to rjprimeconsult@gmail.com with ticket metadata +
   a deep link to the admin queue (NOT the full free-text — see PHI handling).
3. **Juan oversees:** opens Admin → Tickets, sees the queue, reads full context.
4. **Claude works it (on Juan's trigger):** Juan says "handle ticket #N" → Claude
   reads the ticket, investigates the agent's data via existing admin/service-role
   access, posts problem + exact fix → Juan approves → Claude applies → ticket
   status → Resolved (with a resolution note).
5. **Agent hears back:** on Resolved, a Resend email goes to the agent: "Your
   report #N is resolved" + a short, non-PHI note.

## Data model — new `tickets` table (Supabase)
```
tickets (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- human-friendly ticket #
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- submitter
  email        TEXT NOT NULL,          -- submitter email (denormalized for the resolution email)
  name         TEXT,                   -- submitter display name
  category     TEXT NOT NULL,          -- one of the fixed set, or 'Custom'
  custom_category TEXT,                -- free text when category='Custom'
  description  TEXT NOT NULL,          -- agent's words (MAY contain PHI — stays in DB, never emailed)
  context      JSONB NOT NULL DEFAULT '{}', -- { page, lastError, appVersion, userAgent, ts }
  screenshot_url TEXT,                 -- optional; stored in a private storage bucket
  status       TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'in_progress' | 'resolved'
  admin_notes  TEXT,                   -- Juan/Claude notes (internal)
  resolution   TEXT,                   -- what was done (goes in the agent's resolution email, PHI-safe)
  resolved_at  TIMESTAMPTZ
)
```
**RLS (mirrors the hardening we just did — column-safe, admin via `is_admin()`):**
- Enable RLS. Agent can `INSERT` a row for themselves (`WITH CHECK (auth.uid() = user_id)`)
  and `SELECT` only their own (`USING (auth.uid() = user_id)`).
- Admin can `SELECT`/`UPDATE` all via the existing `is_admin(auth.uid())` predicate.
- No client `UPDATE`/`DELETE` for non-admins (status/notes/resolution are admin-only,
  writable via service-role in the admin route or by the admin's own session).
- Screenshot bucket: private, RLS so only owner + admin can read.

## API routes
- `POST /api/tickets` — auth'd via `requireUserId` (session bearer). Validates:
  category in allowed set (or Custom + non-empty custom_category), description
  length (e.g. 1–4000 chars), context shape, optional screenshot. Inserts the row
  (service-role, user_id from the VERIFIED session — never from the body). Fires
  the submit email. Returns `{ id }`.
- `GET /api/admin/tickets` — admin-only (`getUser` + `is_admin`), returns the queue.
- `POST /api/admin/tickets/[id]` — admin-only, updates status/admin_notes/
  resolution; when status→resolved, stamps resolved_at and fires the resolution
  email to the submitter.

## Components
- **`ReportIssueButton` + `ReportIssueModal`** (agent side): a small floating
  "Report an issue" control (or in the header/Settings). Category select (reveals
  a text field for Custom), description textarea, optional screenshot upload,
  submit. Auto-captures context (current view id, `window.__lastError` if the app
  tracks one, app version from `/api/version`, `navigator.userAgent`, timestamp)
  WITHOUT the agent typing it.
- **Admin "Tickets" tab** in `src/app/admin/page.jsx`: table of tickets, newest
  first, filter by status, row detail with full context + screenshot, controls to
  set status / add notes / write a resolution + mark resolved.

## Notifications (Resend — reuse the existing email plumbing)
- **Submit email → Juan:** subject `New PRIM ticket #N — <category> from <agent>`,
  body = ticket #, category, agent name/email, page/appVersion, timestamp, and a
  link to the admin queue. **Deliberately excludes the free-text `description`**
  (see PHI handling) — Juan reads the full text in the admin queue.
- **Resolution email → agent:** subject `Your PRIM report #N is resolved`, body =
  the `resolution` note (which Juan/Claude write to be PHI-safe).
- Both use `RESEND_API_KEY` + `RESEND_FROM_ADDRESS` (already configured). No Slack.

## Compliance / PHI handling (important)
An agent's free-text `description` MAY contain client PHI (they might describe a
client-specific issue). To stay HIPAA-safe per AGENTS.md:
- **PHI lives only in Supabase** (a required-BAA vendor), viewed in the admin
  queue — it is NEVER put in an outbound email.
- The **submit email to Juan carries only metadata + a link**, not the description.
- The **resolution email** carries only the human-written `resolution` note, which
  must be PHI-free (no client names).
- The form shows a one-line hint: "Don't include client names or personal health
  info — just describe the problem."

## Security
- Submit route derives `user_id` from the verified session (never the body).
- RLS confines agents to their own tickets; admin-all via `is_admin()`.
- Category/description validated + length-capped; screenshot type/size capped
  (reuse the import size-cap discipline).
- No secrets in responses; standard rate-limit hygiene lives OFF the hot path if
  ever added (per the 2026-07-01 capture-path lesson — not relevant here anyway).

## The "Claude works the queue" operating loop (process, not app code)
- Juan says "handle ticket #N."
- Claude reads the ticket (via `GET /api/admin/tickets` or SQL), uses the context
  to investigate, and proposes the exact fix.
- Juan approves; Claude applies the fix using the SAME admin/service-role access
  already in use (SQL editor / admin routes) — no new autonomous capability.
- Claude/Juan set the ticket to Resolved with a PHI-safe `resolution` note, which
  triggers the agent's resolution email.

## Testing
- Unit-test the pure bits: category/description validation, context normalization,
  the email-body builders (assert the submit email contains NO description text).
- RLS smoke: an agent cannot read another agent's ticket; admin can read all.
- Manual: submit a ticket end-to-end on a test account; confirm the queue row,
  the submit email (metadata-only), the status flow, and the resolution email.

## Rollout / phasing
- **MVP (this spec):** form + `tickets` table + RLS + admin queue + submit email +
  resolution email.
- **Later (not now):** agent-facing "My reports" list; Slack option; auto-triage
  scheduled agent; ticket comments/threads.
