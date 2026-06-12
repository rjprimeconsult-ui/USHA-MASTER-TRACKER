# The Fable 5 build prompt — PRIM Team feature

**How to run it:** switch the model to **Claude Fable 5**, set effort to **xhigh**,
give it a generous timeout (this runs long), and paste everything in the box
below as your first message. The spec it references is committed in the repo.

---

I'm building the **Team subscription feature** for PRIM — my USHA insurance-agent
SaaS (Next.js 16 / React 19 / Tailwind 4 / Supabase / Stripe; repo at
`C:\dev\usha-master-tracker`; auto-deploys to Vercel on push to `main`). It's for
**team leaders** (USHA FTAs / FSLs / SATs) who pay for the Team tier and need to
oversee their whole downline's performance and financials so they can keep agents
making sound decisions. This is the biggest feature PRIM has shipped — give it
your full strength.

**Read these first, in full, before doing anything:**
- `docs/superpowers/specs/2026-06-12-team-feature-design.md` — the complete,
  approved design. It is the source of truth: the locked model decisions, the
  org-tree architecture, the "View My Team" tab, the compliance guardrails, the
  correctness/edge-case requirements (§5.5), the simplicity bar (§5.6), and what
  is explicitly **out of scope** (§8).
- `AGENTS.md` — PRIM's conventions and the lessons already banked there (Next 16
  async params, the integration/callback-plumbing lessons, the design system).

**The task.** Build the whole feature end-to-end: the database (team tables +
RLS + migrations), the authorized `/api/team/*` endpoints, the cycle-safe
transitive-downline authorization helper, the "View My Team" tab (team scoreboard
+ hierarchy-aware drill-down that **reuses PRIM's existing prop-driven views in
read-only mode** + roster/invites), the agent-side one-tap consent/accept +
transparency/leave-team, audit logging, and Team-tier gating. **Scope and
sequence it yourself** — don't pre-chop into phases for my approval; build it as
one coherent feature, deploying in safe increments (build clean + existing tests
green before each push; give me SQL migrations as copy-paste blocks to run in
Supabase).

**Make this the priority.** The make-or-break is the **hierarchy authorization**
(spec §3.2 + §5.5): transitive descendant visibility, cycle-safe (depth cap +
visited-set), exactly one active direct upline. Build and **unit-test
`getDownlineIds` hard** — against a multi-level tree with a deliberately planted
cycle (must terminate) — before anything is built on top of it. A leader must
NEVER see sideways or upward, only their own subtree.

**Boundaries — what you must not do.**
- Strictly **additive and read-only** over agent data. Never modify, migrate, or
  delete any agent's data; never weaken existing single-user RLS; never expose
  `user_kv` cross-user to the client — all cross-user reads go through the
  authorized endpoints with the descendant check + audit.
- Build only the spec's **phase-1 scope (§4)**. Do **not** build any phase-2 item
  (§8). Don't add features, abstractions, or future-proofing beyond the spec.
  Validate only at real boundaries (the authz check, user input).
- Don't send email, post anything public, or run destructive actions as part of
  the build without asking. (In-app invite first; an optional email notification
  only via PRIM's existing Resend pattern.)

**How to work.**
- When you have enough information to act, act. Don't re-derive what the spec
  settles or narrate options you won't pursue; if you're weighing a choice, give
  a recommendation and proceed.
- Delegate independent parts to **subagents** and keep working while they run
  (DB/RLS + migrations; the endpoints + the auth helper; the team scoreboard UI;
  the read-only drill-down reuse; the consent/roster/leave-team UI). **Verify
  with a fresh-context subagent against the spec** — not self-critique.
- `next build` passing ≠ working. **Smoke-test the whole chain on a real
  multi-account setup** before declaring done: invite → one-tap accept →
  scoreboard aggregation → drill SAT→FSL→FTA→Agent into an agent's read-only
  PRIM → audit row written → leave-team cuts access. Surface real errors; never
  leave a silent no-op.
- It must be **dead simple for both sides** (§5.6): one-step invite, one-tap
  accept, obvious status. If a non-technical agent couldn't accept in ten seconds
  without help, redo that flow.
- Follow PRIM's shipping rules (AGENTS.md): the premium design system with no
  mobile horizontal overflow, the What's New bell entry + `[announce]` Slack
  deploy when it ships. Bank any new lesson you learn in AGENTS.md.
- Make the Team Scoreboard genuinely **beautiful** — a modern, at-a-glance
  command center consistent with PRIM's "Refined Cool-Tech" (indigo accent,
  emerald only for money), reusing the premium card/table/chart primitives.

Pause for me only when the work genuinely requires it — a destructive or
irreversible action, a real change of scope, or input only I can provide (running
the SQL, or a product decision the spec doesn't cover). Otherwise proceed to
completion. You have ample context remaining; don't stop, summarize, or suggest a
new session on account of context limits — continue the work.
