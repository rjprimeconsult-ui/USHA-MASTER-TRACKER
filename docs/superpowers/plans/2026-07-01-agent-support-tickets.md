# Agent Support Tickets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let PRIM agents submit an in-app issue ticket that lands in a locked-down `tickets` table + an admin queue, emails Juan on submit and the agent on resolve, so Juan can hand any ticket to Claude to fix under his approval.

**Architecture:** New `tickets` table with strict RLS (agent self-insert/read; admin read; **no client write path** — all writes via a service-role admin route). Pure validation + email-body logic in a tested lib. Two API routes (agent submit, admin write). Agent report modal + admin Tickets tab. Resend for both emails (copy the `welcomeEmails.js` fetch pattern — no shared helper exists). Email-only, no Slack.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres + RLS + Storage), Resend, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-01-agent-support-tickets-design.md` (rev 2, reviewed → Approved).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/tickets-migration.sql` (create) | `tickets` table + RLS + `ticket-screenshots` bucket + policies. Juan runs it. |
| `src/lib/tickets.mjs` (create) | Pure logic: category set, validation, email-body builders (submit body MUST exclude description). |
| `src/lib/tickets.test.mjs` (create) | Unit tests for the above. |
| `src/app/api/tickets/route.js` (create) | `POST` agent submit: requireUserId, validate, insert, upload screenshot, best-effort submit email. |
| `src/app/api/admin/tickets/[id]/route.js` (create) | `POST` admin write: is_admin gate, `await ctx.params`, update status/notes/resolution, resolution email on resolve. |
| `src/components/LastErrorCapture.jsx` (create) | Client shell: stores a PHI-free last error on `window.__lastError`. |
| `src/components/ReportIssue.jsx` (create) | Floating "Report an issue" button + modal (category/Custom, description, screenshot, auto-context, submit). |
| `src/app/admin/page.jsx` (modify) | Add a "Tickets" tab: client-side read via RLS + status/notes/resolution controls. |
| `src/components/LeadTracker.jsx` (modify) | Mount `<ReportIssue />` + `<LastErrorCapture />` in the app shell. |
| `src/lib/announcements.js` (modify) | Ship-ritual "What's New" entry. |

Build order below is dependency-ordered. Commit after every task.

---

### Task 1: Pure logic + tests (`src/lib/tickets.mjs`)

**Files:**
- Create: `src/lib/tickets.mjs`
- Test: `src/lib/tickets.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/tickets.test.mjs
// Run: node --test src/lib/tickets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_CATEGORIES, validateTicketInput, buildSubmitEmail, buildResolutionEmail,
} from './tickets.mjs';

test('categories are the fixed set incl. Custom', () => {
  assert.deepEqual(TICKET_CATEGORIES,
    ['Upload', 'Import', 'Login', 'Data looks wrong', 'Billing', 'Other', 'Custom']);
});

test('validateTicketInput — accepts a good ticket', () => {
  const r = validateTicketInput({ category: 'Upload', description: 'It failed', context: {} });
  assert.equal(r.ok, true);
});

test('validateTicketInput — rejects bad category / empty description / too long', () => {
  assert.equal(validateTicketInput({ category: 'Nope', description: 'x' }).ok, false);
  assert.equal(validateTicketInput({ category: 'Upload', description: '' }).ok, false);
  assert.equal(validateTicketInput({ category: 'Upload', description: 'x'.repeat(4001) }).ok, false);
});

test('validateTicketInput — Custom requires custom_category (<=120)', () => {
  assert.equal(validateTicketInput({ category: 'Custom', description: 'x' }).ok, false);
  assert.equal(validateTicketInput({ category: 'Custom', custom_category: 'y', description: 'x' }).ok, true);
  assert.equal(validateTicketInput({ category: 'Custom', custom_category: 'y'.repeat(121), description: 'x' }).ok, false);
});

test('validateTicketInput — rejects oversize context (>8KB)', () => {
  const big = { blob: 'x'.repeat(9000) };
  assert.equal(validateTicketInput({ category: 'Upload', description: 'x', context: big }).ok, false);
});

test('buildSubmitEmail — NEVER contains the description (PHI containment)', () => {
  const secret = 'PATIENT SECRET NOTE';
  const { subject, html, text } = buildSubmitEmail({
    id: 42, category: 'Upload', name: 'Alexis', email: 'a@x.com',
    description: secret, context: { page: 'books', appVersion: 'abc123' },
  });
  assert.match(subject, /#42/);
  assert.ok(!html.includes(secret) && !text.includes(secret), 'description must not appear');
  assert.match(html, /admin/i); // includes a link to the queue
});

test('buildResolutionEmail — contains ticket # + resolution note', () => {
  const { subject, html } = buildResolutionEmail({ id: 42, resolution: 'Re-ran your import.' });
  assert.match(subject, /#42/);
  assert.match(html, /Re-ran your import\./);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/lib/tickets.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/tickets.mjs`**

```js
// src/lib/tickets.mjs
// Pure, server-safe logic for the support-ticket feature. No secrets, no I/O.
// The submit-email builder DELIBERATELY excludes the agent's free-text
// description (it may contain PHI — it stays in Supabase, never in email).

export const TICKET_CATEGORIES = ['Upload', 'Import', 'Login', 'Data looks wrong', 'Billing', 'Other', 'Custom'];

const SITE = 'https://www.primtracker.com';

export function validateTicketInput({ category, custom_category, description, context } = {}) {
  if (!TICKET_CATEGORIES.includes(category)) return { ok: false, error: 'Invalid category' };
  if (category === 'Custom') {
    const c = String(custom_category || '').trim();
    if (!c || c.length > 120) return { ok: false, error: 'Custom category required (max 120 chars)' };
  }
  const d = String(description || '').trim();
  if (d.length < 1 || d.length > 4000) return { ok: false, error: 'Description must be 1–4000 characters' };
  if (context != null) {
    try { if (JSON.stringify(context).length > 8192) return { ok: false, error: 'Context too large' }; }
    catch { return { ok: false, error: 'Invalid context' }; }
  }
  return { ok: true };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Submit notification → Juan. METADATA ONLY. Never the description.
export function buildSubmitEmail({ id, category, custom_category, name, email, context = {} }) {
  const cat = category === 'Custom' ? `Custom: ${custom_category}` : category;
  const subject = `New PRIM ticket #${id} — ${cat} from ${name || email}`;
  const link = `${SITE}/admin?ticket=${id}`;
  const rows = [
    ['Ticket', `#${id}`], ['Category', cat], ['From', `${name || ''} <${email}>`],
    ['Screen', context.page || '—'], ['App', context.appVersion || '—'], ['When', context.ts || ''],
  ].map(([k, v]) => `<tr><td style="padding:2px 10px;color:#64748b">${esc(k)}</td><td style="padding:2px 10px">${esc(v)}</td></tr>`).join('');
  const html = `<div style="font-family:sans-serif"><p>A new support ticket was submitted.</p>`
    + `<table>${rows}</table>`
    + `<p><a href="${link}">Open ticket #${id} in the admin queue →</a></p>`
    + `<p style="color:#94a3b8;font-size:12px">The description is in the admin queue only (kept out of email).</p></div>`;
  const text = `New PRIM ticket #${id} — ${cat} from ${name || email}\nScreen: ${context.page || '—'} · App: ${context.appVersion || '—'}\nOpen the admin queue: ${link}\n(Description is in the admin queue, not this email.)`;
  return { subject, html, text };
}

// Resolution notification → agent. Only the human-written PHI-safe resolution note.
export function buildResolutionEmail({ id, resolution }) {
  const subject = `Your PRIM report #${id} is resolved`;
  const note = esc(resolution || 'This has been resolved.');
  const html = `<div style="font-family:sans-serif"><p>Good news — your report <b>#${id}</b> has been resolved.</p><p>${note}</p><p style="color:#94a3b8;font-size:12px">— The PRIM team</p></div>`;
  const text = `Your PRIM report #${id} is resolved.\n\n${resolution || 'This has been resolved.'}\n\n— The PRIM team`;
  return { subject, html, text };
}
```

- [ ] **Step 4: Run tests → PASS.** Run: `node --test src/lib/tickets.test.mjs`  Expected: all pass.
- [ ] **Step 5: Full suite still green.** Run: `npm test`  Expected: prior count + 7 new, 0 fail.
- [ ] **Step 6: Commit**

```bash
git add src/lib/tickets.mjs src/lib/tickets.test.mjs
git commit -m "Tickets: pure validation + PHI-safe email builders (tested)"
```

---

### Task 2: Database migration (`supabase/tickets-migration.sql`)

**Files:** Create: `supabase/tickets-migration.sql`

- [ ] **Step 1: Write the migration** (verbatim from spec §Data model). Include: `tickets` table with CHECK constraints; enable RLS; the three SELECT/INSERT policies; NO client UPDATE/DELETE; create the private `ticket-screenshots` bucket + the self-RW and admin-read storage policies. Copy exactly from the spec (RLS + storage blocks). Add a header comment and confirmation queries.
- [ ] **Step 2: Lint SQL by eye** against `supabase/blast-counters-migration.sql` + `chat-feedback-migration.sql` patterns (self-insert `WITH CHECK`, admin via `public.is_admin(auth.uid())`, `GRANT`/policy shape).
- [ ] **Step 3: Commit** (Juan runs it in Supabase during rollout — Task 9).

```bash
git add supabase/tickets-migration.sql
git commit -m "Tickets: DB migration — table, strict RLS, screenshot bucket"
```

> ⚠️ The migration must be RUN in Supabase before the routes do anything real; until then the submit route's insert fails and (per Task 3) returns a clean error. Confirm with `SELECT * FROM pg_policies WHERE tablename='tickets';`.

---

### Task 3: Submit route (`src/app/api/tickets/route.js`)

**Files:** Create: `src/app/api/tickets/route.js`

- [ ] **Step 1: Implement** — `export const runtime='nodejs'`. `POST`: parse multipart/JSON, `requireUserId(req)` (from `src/lib/apiAuth.js`); look up submitter `email`/`display_name` from `profiles` via service-role; `validateTicketInput`; **insert row first** via service-role (`user_id` from session, never body); if a screenshot is present, upload to `ticket-screenshots/<user_id>/<id>.<ext>` (MIME allowlist {jpeg,png,webp}, ≤5MB) and patch `screenshot_path` (non-fatal on failure); then send the submit email **best-effort** by copying the Resend `fetch('https://api.resend.com/emails')` pattern from `src/lib/welcomeEmails.js` with `RESEND_API_KEY`/`RESEND_FROM_ADDRESS`, `to: 'rjprimeconsult@gmail.com'`, body from `buildSubmitEmail`. **Never `console.log` the description.** Return `{ id, emailQueued }` (200). Email/upload failure ⇒ still 200 with `emailQueued:false`.
- [ ] **Step 2: Auth gate check** — mirror `requireUserId` usage in `src/app/api/import-leads-ai/route.js` (401 without a valid bearer).
- [ ] **Step 3: Lint** — `npx eslint src/app/api/tickets/route.js` → 0.
- [ ] **Step 4: Compile-check** via the temp-page trick (dev server 200 on a page importing nothing new — routes compile on demand; verify no build error by `npm run build` OR a temp route probe).
- [ ] **Step 5: Commit** — `git commit -m "Tickets: agent submit route (insert-first, best-effort email)"`

---

### Task 4: Admin write route (`src/app/api/admin/tickets/[id]/route.js`)

**Files:** Create: `src/app/api/admin/tickets/[id]/route.js`

- [ ] **Step 1: Implement** — service-role client; gate EXACTLY like `src/app/api/admin/broadcast/route.js` (bearer → `getUser` → `profiles.is_admin`). **`const { id } = await ctx.params;`** (async-params gotcha — AGENTS.md). Body: `{ status?, admin_notes?, resolution? }`. Validate `status IN ('new','in_progress','resolved')`. Update the row by `id`. When `status==='resolved'`, set `resolved_at=now()` and send the resolution email (`buildResolutionEmail`) to the ticket's `email`, best-effort. Return `{ ok:true }`.
- [ ] **Step 2: Lint → 0. Step 3: Commit** — `git commit -m "Tickets: admin write route (status/notes/resolution + resolution email)"`

---

### Task 5: Global error capture (`src/components/LastErrorCapture.jsx`)

**Files:** Create: `src/components/LastErrorCapture.jsx`

- [ ] **Step 1: Implement** — a `'use client'` component that on mount adds `window.addEventListener('error', …)` and `'unhandledrejection'` handlers storing a SHORT, PHI-free string on `window.__lastError` (e.g. `${e.message} @ ${e.filename}:${e.lineno}` — message + source only, capped ~300 chars; never serialize app state). Returns `null`. Clean up on unmount.
- [ ] **Step 2: Lint → 0. Step 3: Commit** — `git commit -m "Tickets: capture PHI-free last error on window.__lastError"`

---

### Task 6: Report form (`src/components/ReportIssue.jsx`) + mount

**Files:** Create: `src/components/ReportIssue.jsx` · Modify: `src/components/LeadTracker.jsx`

- [ ] **Step 1: Implement `ReportIssue`** — match `ProspectForm.jsx` modal style. A floating "Report an issue" button (bottom-left, distinct from the chat bubble). Modal fields: category `<select>` (from `TICKET_CATEGORIES`; when `Custom`, reveal a text input, ≤120), description `<textarea>` (with the PHI hint using NoPhiBanner wording: "Don't include client names, medications, diagnoses, or doctor names — just describe the problem."), optional screenshot file input. On submit: build `context = { page: <current view id/route>, lastError: window.__lastError || '', appVersion: <from GET /api/version>, userAgent: navigator.userAgent, ts: new Date().toISOString() }`, POST to `/api/tickets` (multipart if screenshot) with the session bearer via `authedFetch`. Show "Ticket #N received — we're on it." Handle the error path visibly.
- [ ] **Step 2: Mount** `<LastErrorCapture />` and `<ReportIssue />` in `LeadTracker.jsx` (near the existing `<AgentChatbot />` mount) so every signed-in agent sees the button.
- [ ] **Step 3: Lint → 0. Step 4: Compile-check** via dev server (temp page importing `ReportIssue` returns 200, no compile error), then remove the temp page.
- [ ] **Step 5: Commit** — `git commit -m "Tickets: agent Report-an-issue button + modal, wired into app shell"`

---

### Task 7: Admin Tickets tab (`src/app/admin/page.jsx`)

**Files:** Modify: `src/app/admin/page.jsx`

- [ ] **Step 1: Implement** — add a "Tickets" section/tab. Read client-side: `supabase.from('tickets').select('*').order('created_at',{ascending:false})` (works via `tickets_admin_read` RLS for the admin's own session). Render a table (newest first) with a status filter; row detail shows full context + screenshot (signed URL or admin-read bucket). Controls: set status, edit `admin_notes`, write `resolution` + Resolve → call `POST /api/admin/tickets/[id]` via `authedFetch`, then refresh. Deep-link support: if `?ticket=N`, open that ticket. Match the existing admin table styling.
- [ ] **Step 2: Lint → 0. Step 3: Compile-check** (admin route compiles). **Step 4: Commit** — `git commit -m "Tickets: admin queue tab (read via RLS, status/resolution controls)"`

---

### Task 8: Ship ritual (`src/lib/announcements.js`)

**Files:** Modify: `src/lib/announcements.js`

- [ ] **Step 1:** Add a top `ANNOUNCEMENTS` entry (id `2026-XX-XX-report-an-issue`, emoji, HIPAA-safe title/body: "Hit a snag? Use the new Report an issue button — we'll get it fixed."), cta `{ label:'…', view:'prospects' }` or similar. **Step 2: Commit.**
- [ ] **Step 3 (deploy-time):** ship via an `[announce]`-tagged deploy per AGENTS.md.

---

### Task 9: Rollout + end-to-end verification

- [ ] **Step 1:** Juan runs `supabase/tickets-migration.sql` in Supabase; confirm `SELECT * FROM pg_policies WHERE tablename='tickets';` shows the 3 policies + storage policies; bucket `ticket-screenshots` exists.
- [ ] **Step 2:** `npm test` green; `npm run build` succeeds.
- [ ] **Step 3: Manual E2E on a TEST agent account:** submit a ticket (with + without screenshot) → row appears in admin queue → submit email arrives at rjprimeconsult@gmail.com **with NO description text** → change status → write resolution + Resolve → resolution email arrives at the test agent.
- [ ] **Step 4: RLS smoke:** as test agent A, `SELECT * FROM tickets` returns only A's rows; as admin, all rows; confirm no client UPDATE is possible.
- [ ] **Step 5:** Commit any fixes; deploy; run the `[announce]` deploy (Task 8 step 3).

---

## Notes for the implementer
- **DRY/YAGNI/TDD:** only Task 1 has pure unit-testable logic — TDD it fully. Routes/UI are verified by lint + compile + the manual E2E (auth wall prevents automated browser tests).
- **Never log or email the `description`.** The Task 1 test enforces the email half; keep the route side clean too.
- **Follow existing patterns:** `requireUserId` (apiAuth.js), `is_admin` gate (broadcast route), Resend fetch (welcomeEmails.js), modal (ProspectForm.jsx), admin table (admin/page.jsx), `await ctx.params` (AGENTS.md).
