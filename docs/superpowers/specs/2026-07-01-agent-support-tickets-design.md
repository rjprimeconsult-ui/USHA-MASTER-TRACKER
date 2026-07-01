# Agent Support Tickets — Design Spec

**Date:** 2026-07-01 · **Status:** approved design, pre-implementation
**Rev 2** — incorporates the 2026-07-01 adversarial spec review (RLS written verbatim,
screenshot admin access, PHI posture aligned to the app's no-PHI stance, email
pattern corrected, failure handling, feature-announce ritual).

## Goal
Give PRIM agents an in-app way to report a bug/glitch/error ("submit a ticket"),
route it into a queue Juan owns, notify him by email, and let him hand any ticket
to Claude to diagnose + fix under his approval — so agent problems get handled
even when he's not at his computer or office.

## Decisions locked in (from brainstorming)
- **Autonomy:** Claude diagnoses + proposes; Juan approves every account-touching
  fix. The ticket system organizes intake; it grants Claude NO new standing access.
- **Oversight:** a ticket **queue in the admin dashboard** is the source of truth.
- **Trigger:** Juan triggers Claude ("handle ticket #X") — NO scheduled/auto-triage
  automation in v1.
- **Notifications:** **email only, via Resend. No Slack** (for ticket notifications).
- **Ticket content:** rich auto-context.
- **Categories:** Upload · Import · Login · Data looks wrong · Billing · Other ·
  **Custom** (free-text when "Custom" is picked).
- **Agent view:** v1 admin-only; the resolution email closes the loop. No in-app
  "My reports" list in v1.

## Non-goals (v1)
No Slack ticket notifications. No auto-triage / scheduled agent. No agent-facing
ticket list. No threaded comments. No attachments beyond one optional screenshot.
No rate-limiting on submit in v1 (see Security).

## User flows
1. **Agent submits:** "Report an issue" → category (or Custom) → describes the
   problem → optional screenshot → submit. Sees "Ticket #123 received."
2. **Juan notified:** email to rjprimeconsult@gmail.com with ticket **metadata +
   a link** to the admin queue (NOT the description — see PHI).
3. **Juan oversees:** Admin → Tickets, reads full context.
4. **Claude works it (Juan's trigger):** "handle ticket #N" → Claude reads the
   ticket, investigates via existing admin/service-role access, proposes the fix →
   Juan approves → Claude applies → status → resolved + a PHI-safe resolution note.
5. **Agent hears back:** on resolve, a Resend email to the agent: "Your report #N
   is resolved" + the resolution note.

## Data model — new `tickets` table (Supabase)
Mirror the `chat_feedback` precedent (self-insert + admin-read) and the
`blast_counters` precedent (**writes are service-role only — no client UPDATE/DELETE
policy**).
```
tickets (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- ticket #
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- submitter
  email        TEXT NOT NULL,          -- submitter email (for the resolution email)
  name         TEXT,
  category     TEXT NOT NULL CHECK (category IN
                 ('Upload','Import','Login','Data looks wrong','Billing','Other','Custom')),
  custom_category TEXT,                -- required when category='Custom', ≤120 chars (validated in route)
  description  TEXT NOT NULL,          -- agent's words. POTENTIALLY-PHI → contained (never emailed/logged)
  context      JSONB NOT NULL DEFAULT '{}', -- { page, lastError, appVersion, userAgent, ts } (size-capped in route)
  screenshot_path TEXT,               -- storage object path in bucket 'ticket-screenshots' (optional)
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved')),
  admin_notes  TEXT,                   -- internal (Juan/Claude)
  resolution   TEXT,                   -- PHI-safe; goes in the agent's resolution email
  resolved_at  TIMESTAMPTZ
)
```
**RLS — written verbatim (enable RLS on the table):**
```
-- Agent may create only their own ticket:
CREATE POLICY "tickets_self_insert" ON tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Agent may read only their own:
CREATE POLICY "tickets_self_read" ON tickets FOR SELECT
  USING (auth.uid() = user_id);
-- Admin may read all (client-side admin dashboard reads via this, like user_kv/chat_feedback):
CREATE POLICY "tickets_admin_read" ON tickets FOR SELECT
  USING (public.is_admin(auth.uid()));
-- NO agent or admin UPDATE/DELETE policy. All status/notes/resolution writes go
-- through the service-role admin write route (which bypasses RLS) — matches how
-- every write in this app already works (blast_counters, etc.). This removes the
-- entire class of the 2026-06-30 escalation bug (no column-unrestricted client UPDATE).
```
**Screenshot storage — bucket `ticket-screenshots` (private), objects pathed by
`<user_id>/<ticket-id>.<ext>` like the `receipts` bucket, but WITH an explicit
admin-read policy so the admin queue can display them:**
```
CREATE POLICY "ticket_shots_self_rw" ON storage.objects FOR ALL
  USING (bucket_id='ticket-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id='ticket-screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "ticket_shots_admin_read" ON storage.objects FOR SELECT
  USING (bucket_id='ticket-screenshots' AND public.is_admin(auth.uid()));
```
(Without the admin-read policy, Juan's browser session 403s on another agent's
screenshot — the receipts bucket is owner-only, which is why this is called out.)

## API routes
- **Submit — `POST /api/tickets`** (agent). Auth via `requireUserId` (bearer →
  `getUser`). Derives `user_id` + email from the VERIFIED session (never the body).
  Validates: `category` in the allowed set (Custom ⇒ non-empty `custom_category`
  ≤120), `description` 1–4000 chars, `context` JSON ≤8KB, screenshot (if present)
  MIME in {jpeg,png,webp} + ≤5MB (reuse the import size-cap discipline). Inserts
  the row via service-role, uploads the screenshot to `ticket-screenshots/
  <user_id>/<id>`, then fires the submit email **best-effort** (see failure
  handling). Returns `{ id, emailQueued }`.
- **Admin reads: no route.** The admin dashboard reads tickets **client-side** via
  the `tickets_admin_read` RLS policy (same model as `user_kv`/`profiles` in
  `admin/page.jsx`). Screenshots shown via a service-role signed URL OR the
  admin-read storage policy above.
- **Admin write — `POST /api/admin/tickets/[id]`** (service-role). Gate identically
  to `broadcast/route.js` (service-role `getUser` → `profiles.is_admin`). **MUST
  `await ctx.params`** (AGENTS.md async-params gotcha — builds clean but breaks at
  runtime otherwise). Updates status/admin_notes/resolution; when status→resolved,
  stamps `resolved_at` and fires the resolution email to `email`.

## Components
- **`ReportIssueButton` + `ReportIssueModal`** (agent): a small floating "Report an
  issue" control. Category select (reveals a text field for Custom), description
  textarea with the PHI hint, optional screenshot. Auto-captures `context` WITHOUT
  the agent typing: current view id, `window.__lastError` (see below), `appVersion`
  from `/api/version` (note: an opaque build hash, fine as an id), `navigator.
  userAgent`, timestamp.
  - **Global error capture (in-scope, small):** add a top-level handler
    (`window.addEventListener('error'/'unhandledrejection')` in the app shell) that
    stores a short, **PHI-free** last-error string on `window.__lastError`. This is
    the only "new plumbing" the context needs; without it, `lastError` is always
    empty. Keep it to error message + source, never full state.
- **Admin "Tickets" tab** in `src/app/admin/page.jsx`: table (newest first, filter
  by status), row detail with full context + screenshot, controls to set status /
  add notes / write a resolution + resolve — all via the admin write route.

## Notifications (Resend — copy the pattern, there is no shared helper)
Each route inlines the Resend `fetch('https://api.resend.com/emails')` pattern from
`src/lib/welcomeEmails.js` using `RESEND_API_KEY` + `RESEND_FROM_ADDRESS` (do NOT
call `/api/email/send` — it hard-requires a lead/prospect + feature flags and won't
fit). Use `safeTagValue()` for any Resend tags. (Optional: extract a tiny
`sendResendEmail()` helper — nice, not required for v1.)
- **Submit → Juan:** `New PRIM ticket #N — <category> from <agent>`; body =
  ticket #, category, agent name/email, page/appVersion, time, + queue link.
  **Excludes `description`.**
- **Resolve → agent:** `Your PRIM report #N is resolved`; body = the `resolution`
  note only.

## Compliance / PHI (aligned to the app's actual posture)
PRIM's stated posture (`NoPhiBanner.jsx`, `/terms`, `/privacy`, AGENTS.md) is that
it is **not a HIPAA platform and agents must not enter PHI anywhere** (no client
names, medications, diagnoses, doctor names). So:
- The `description` is treated as **potentially-PHI and therefore CONTAINED**: it is
  never put in any email, **never logged** (the submit route must not `console.log`
  the description), and not sent to any third party (incl. Anthropic) without the
  pending BAA. It lives only in Supabase, viewed in the admin queue.
- The form hint uses the **existing NoPhiBanner language**: "Don't include client
  names, medications, diagnoses, or doctor names — just describe the problem."
- The resolution email carries only the human-written, PHI-safe `resolution` note.

## Security
- Submit route derives `user_id` from the verified session (never the body) — the
  app's IDOR discipline.
- RLS: agents confined to their own tickets; admin-read via `is_admin()`; **no
  client write path** (removes the escalation class entirely).
- Validation caps as above; screenshot MIME allowlist + size cap; `context` size
  cap; `description` must not be logged.
- No secrets in responses. Rate-limiting is out of v1 (submit is auth'd + low-rate);
  if ever added, keep it OFF any hot path (2026-07-01 capture-path lesson).

## Failure handling
- **Insert the row FIRST**, then send the submit email best-effort. Email failure
  is non-fatal (mirror `welcomeEmails.js`: returns `{sent:false}`, no throw): the
  route returns `{ id, emailQueued:false }` and logs a PHI-free warning — it must
  never 500 the submit or lose the ticket.
- Screenshot upload failure is also non-fatal — save the ticket without it.

## The "Claude works the queue" operating loop (process, not app code)
Juan says "handle ticket #N" → Claude reads it (client-side admin read or SQL) →
investigates via the SAME admin/service-role access already in use → proposes the
exact fix → Juan approves → Claude applies → sets resolved + a PHI-safe resolution
note (fires the agent email). No new autonomous capability is granted.

## Testing
- Unit: category/description/context validation; the email-body builders (assert the
  submit email body contains NO `description`); custom-category requirement.
- RLS smoke: agent A cannot read agent B's ticket; admin reads all; no client can
  UPDATE a ticket.
- Manual E2E on a test account: submit → queue row → submit email (metadata only) →
  status flow → resolve → resolution email.

## Rollout
- **MVP (this spec):** form + global error capture + `tickets` table + RLS +
  screenshot bucket + admin queue + admin write route + submit email + resolution
  email.
- **Ship ritual (AGENTS.md, non-negotiable):** on ship, add a top
  `2026-XX-XX-report-an-issue` entry to `ANNOUNCEMENTS` (`src/lib/announcements.js`)
  and an `[announce]`-tagged deploy — both HIPAA-safe (this is the *feature*
  announcement; separate from the decision to not use Slack for ticket
  notifications).
- **Later (not now):** agent "My reports" list; Slack option; auto-triage; threads.

## Notes
- `id` as a sequential public ticket # is acceptable for v1 (RLS is owner-scoped, so
  a guessed number leaks nothing; it only reveals ticket volume to a submitter —
  minor). Revisit only if volume-hiding matters.
- Implementation heads-up: the submitter's display name lives in `profiles.display_name`
  (not `name`), and the tier column is `profiles.tier`. We denormalize name/email
  onto the ticket row from the verified session anyway, so this is just a note.
- Orphaned screenshots: `user_id ON DELETE CASCADE` removes ticket rows when an auth
  user is deleted, but storage objects aren't cascade-linked — orphaned screenshots
  in `ticket-screenshots` are acceptable for v1 (same property as the `receipts`
  bucket today).

---
*Reviewed adversarially against the codebase 2026-07-01 (two passes) — VERDICT: Approved.*
