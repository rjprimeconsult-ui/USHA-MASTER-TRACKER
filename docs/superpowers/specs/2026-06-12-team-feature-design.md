# PRIM Team Subscription — "View My Team" — Design Spec

**Date:** 2026-06-12
**Status:** Approved (brainstorm complete) — feeds the Fable 5 build prompt
**Owner:** Juan (R&J Prime Consultancy)

---

## 1. Purpose (the reason — who it's for, what it enables)

PRIM is single-user today: every agent sees only their own book. The **Team
plan** ($200/mo, already live in Stripe and advertised on the pricing page —
"multi-agent admin panel, team-wide insights") promises a **leader** layer that
has never been built. This is that build.

A **leader** (USHA Field Sales Leader / FSL) manages a **downline** of agents.
Their job is to keep the team producing and to make sure each agent is making
sound **financial decisions** (lead spend, CPA, ROI) — this business is run on
financial discipline. They need one place to see how everyone is performing and
to look over each agent's numbers and book.

This feature gives a leader a single new **"View My Team"** tab: aggregated team
performance + financials, plus the ability to drill into any one agent and see
that agent's *entire* PRIM read-only.

## 2. Settled model decisions (these are locked — do not redesign)

1. **Read-only roll-up.** Every agent keeps their own PRIM account, subscription,
   and data exactly as today. The leader gets a *separate, read-only* Team layer
   that reads across their linked agents. No agent data is moved, merged, or
   mutated by this feature.
2. **Full visibility.** A leader can see an agent's **real client records**
   (names, phones, DOBs, health notes — PHI) **and the agent's full books**
   (personal business expenses, P&L, net income), not just aggregates. The
   leader's experience is effectively a read-only mirror of each agent's PRIM,
   with a team scoreboard on top.
3. **Invite → accept (consent).** A leader invites an agent by email; the agent
   must **Accept** inside PRIM before *any* data is shared. The acceptance is the
   agent's documented consent. Nothing is visible to the leader until accepted.
4. **Billing.** The leader pays for the Team tier; **every agent keeps their own
   subscription**. Team is purely the leadership *access* layer — no seat
   management, no comped agent accounts in this build. An agent with no PRIM
   subscription / no data simply has nothing to roll up.
5. **Placement.** "View My Team" is a top-level nav tab inserted **immediately
   after "CPA Dashboard"** in `NAV_TABS`. A **leader is simply any user on the
   Team tier** (`subscription_tier === 'team'`, active) — there is no separate
   "leader" flag. The tab and the leader-side `/api/team/*` endpoints are visible
   only to Team-tier users. Being *invited as a downline member* requires no
   particular tier (an Agent on Starter can be invited).

6. **Multi-level hierarchy with transitive visibility.** Leadership has layers.
   USHA org, bottom → top: **Agent** (Starter) < **FTA** (Team) < **FSL** (Team)
   < **SAT** (Team, top). Each leader links their **direct reports**; visibility
   then **cascades down the whole subtree**: a SAT sees their FSLs → and
   therefore each FSL's FTAs → and therefore each FTA's Agents. The authorization
   rule is *"a leader may view user X if X is anywhere in the leader's downline
   subtree"* (transitive descendant). All three leader levels use the **same**
   "View My Team" tab and Team subscription — the only difference is how deep
   their tree goes. The org is a **strict tree**: each person has **at most one
   active direct upline** (you report to exactly one leader). Linking is
   distributed: **each leader invites their own direct reports**, and each accept
   is a consent step.

## 3. Architecture — Authorized API + UI reuse (chosen approach)

**Chosen over** (a) RLS membership policies — too risky for full-PHI access, a
policy bug leaks data, and audit is hard; and (b) nightly snapshots — stale, and
can't do live full-client drill-down.

### 3.1 Team membership — an org-tree edge list
New table `team_members`. **Each row is one direct upline → downline edge.** A
"downline" may itself be a leader (an FSL is the SAT's downline AND the FTAs'
upline), so the field names are generic:
- `upline_id` (uuid, FK → auth.users — the direct leader)
- `downline_id` (uuid, FK → auth.users, **nullable until accepted**)
- `downline_email` (text — the invited email, so an invite exists before the
  invitee resolves to a user_id)
- `status` (text: `pending` | `active` | `removed` | `declined`)
- `invited_at`, `accepted_at`, `removed_at` (timestamptz)
- unique on (`upline_id`, `downline_email`) — no duplicate invites.
- **Tree constraint:** a partial unique index on `downline_id WHERE status =
  'active'` — a person has **at most one active direct upline**.

RLS: a user can read rows where they are the upline OR the downline. All writes
go through service-role endpoints only.

New table `team_access_log` (audit):
- `id`, `leader_id`, `agent_id`, `action` (e.g. `view_dashboard`, `view_prospects`, `view_books`, `view_agent`), `at` (timestamptz), optional `detail` (text, no PHI in the log itself — reference only, e.g. the view key).

### 3.2 How a leader reads a downline member's data (transitive)
The leader's browser **never** queries another user's `user_kv` directly. All
cross-user reads go through authorized server endpoints under `/api/team/*`:
- Auth: bearer → `getUser` (the caller).
- **Authorization (transitive):** the requested user must be in the **caller's
  downline subtree** — i.e. reachable by walking active `team_members` edges
  downward from the caller. Implement with a recursive CTE
  (`WITH RECURSIVE downline AS (...)`) over active edges, **with a depth cap and
  visited-set so a malformed cycle can never loop**. If the target is not a
  descendant → 403.
- Data: service-role reads the requested user's `user_kv` keys, returns them.
- Audit: write a `team_access_log` row for every successful read.
- **Never log PHI**; the audit stores only which view/key was accessed.

A small server helper — `getDownlineIds(callerId)` returning the full set of
active descendant user_ids (capped, cycle-safe) — backs both the authorization
check and the aggregate scoreboard. Build it once, unit-test it hard (it is the
single most correctness-critical piece of this feature).

Endpoints (shape; Fable scopes exact set):
- `GET /api/team/roster` — leader's agents (active + pending), with light summary stats.
- `GET /api/team/overview` — aggregated team scoreboard data (see §4.1).
- `GET /api/team/agent/[agentId]` — one agent's full data bundle (the per-agent
  blobs needed to render their views read-only), gated + logged.
- `POST /api/team/invite` — leader invites an email.
- `POST /api/team/invite/respond` — agent accepts/declines.
- `POST /api/team/remove` — leader removes an agent (or agent leaves).
- `GET /api/team/my-leaders` — agent-side: who can see me + status.

### 3.3 Per-agent data the leader reads (the `user_kv` keys)
`prospects_v1`, `prospect_settings_v1`, `leads_v5`, `business_expenses_v1`,
`business_income_v1`, `platform_expenses_v1`, `overrides_v1`, `chargebacks_v1`,
`own_advances_v1`, `association_bonus_detail_v1`, `agent_tier_v1`,
`agent_residual_rates_v1`, `activities_v1`, plus the agent's `profiles` display
name. (Same keys LeadTracker loads for a user — so an agent's bundle can feed the
existing views.)

### 3.4 UI reuse (the big lever)
PRIM's view components are **prop-driven** — `Dashboard({leads, prospects})`,
`ProspectsView({prospects, ...})`, `BusinessBooksView`, `CpaDashboard`,
`PlatformExpensesView`, etc. take their data as props and render it. So the
leader's per-agent drill-down feeds a fetched agent bundle into the **same
components in read-only mode** (edit/save/add handlers replaced with no-ops or
hidden). Reuse the components; do not rebuild them. Where a component needs a
small `readOnly` prop to hide its mutate affordances, add it minimally.

## 4. The "View My Team" tab — three layers

### 4.1 ① Team Scoreboard (the landing view)
The flagship screen. Aggregates across the leader's **entire downline subtree**
(every active descendant — for a SAT that's all FSLs + their FTAs + their
Agents) for a selected period (reuse the period concept from Reports). A simple
scope toggle — **Direct reports** vs **Whole downline** — lets a deep leader
focus one layer or see everything. Sections:
- **KPI strip** — team totals: deals issued, premium, AV, advance, avg CPA,
  blended ROI, close rate, active agents. (Reuse the premium KPI card + CountUp.)
- **Leaderboard** — agents ranked (toggle: production $ / deals / close rate /
  activity). Row per agent with their headline numbers; click → drill-down.
- **Team pipeline funnel** — aggregate prospect/lead stage distribution across
  the whole team (how many Pending / Appt Set / Issued, etc.).
- **Accountability** — per-agent follow-up health: on-time %, overdue touches,
  appts set/kept (reuse FollowupScorecard math).
- **Financial health row** — team lead spend, CPA trend, profit, plus per-agent
  flags ("CPA trending up 18%", "ROI below 2x") so a leader spots bad financial
  choices fast. This section is a first-class citizen, not an afterthought.

This screen is where **Fable 5's visual intelligence** should shine: a genuinely
beautiful, modern, at-a-glance command center, consistent with PRIM's design
system (§6).

### 4.2 ② Drill-down — hierarchy-aware
Picking a downline member depends on what they are:
- **A leaf Agent** → a read-only mirror of their PRIM: Overview dashboard,
  Prospects (full client records), Book of Business, Books/P&L, Platforms, CPA
  Dashboard. Reuses existing views (§3.4).
- **A sub-leader** (FTA/FSL) → shows **both** their *own* read-only PRIM (they
  produce too) **and** a "their team" panel listing *their* direct reports, which
  you can keep drilling into — navigating straight down the tree (SAT → FSL →
  FTA → Agent). A breadcrumb shows where you are in the org
  (e.g. *My Team › Maria (FSL) › Luis (FTA) › John (Agent)*).

Clear "Viewing [Name] — read only" banner throughout. Every open is
audit-logged.

### 4.3 ③ Roster + management
Invite an agent by email; see pending invites; remove an agent. Plain status
for each (pending / active). Shows the agent's accept state.

## 5. Compliance guardrails (non-negotiable — full PHI + financials cross accounts)

- **Consent gate (transitive — worded for the whole chain):** because visibility
  cascades up, accepting a direct upline consents to the **entire upline chain**
  seeing you. The invite must say so plainly: *"[Leader] and their upline
  leadership will be able to see your production, clients, and books."* Requires
  explicit **Accept**. No data flows pre-acceptance.
- **Audit log:** every agent-data view is recorded (`team_access_log`).
- **Agent transparency panel** (agent's Settings): "You're on [Leader]'s team.
  They can see your production, clients, and books." + **Leave team** button.
- **Tier gating:** the whole tab + all `/api/team/*` leader endpoints require the
  caller to be on the Team tier (check `profiles.subscription_tier === 'team'`
  and active status). Agents responding to invites do **not** need Team tier.
- **No PHI in logs.** Server logs and the audit table store aggregate/reference
  data only — never names, phones, notes.

## 5.5 Correctness & edge cases (Juan's #1 priority — no bugs, no broken teams)

The hierarchy is where this kind of feature breaks. Every one of these MUST be
handled explicitly and covered by tests:

- **No cycles.** A user cannot invite anyone who is already in their *upline*
  chain (would create a loop). Check on invite AND defend in the recursive walk
  (depth cap + visited-set), so even bad data can never infinite-loop.
- **One active direct upline.** Enforced by the partial unique index (§3.1). If
  an already-teamed agent accepts a new invite, the flow must make the
  consequence explicit ("This will move you from [old leader]'s team to
  [new leader]'s") — accept replaces the old active edge; never silently create
  two.
- **Duplicate / re-invite.** Inviting an email that's already pending or active
  → friendly no-op/"already invited", not an error or a second row.
- **Decline, then re-invite.** A declined invite can be re-sent.
- **Removal semantics.** If a leader removes a direct report, only **that edge**
  is cut. The removed sub-leader keeps their own downline intact (their subtree
  just detaches from the higher leader's view). Removal takes effect immediately
  and is logged.
- **Leave team (agent-initiated).** Cuts the agent's active upline edge
  immediately; upline (and everyone above) loses access at once.
- **Invite before signup.** Inviting an email with no PRIM account yet → store
  the pending invite by `downline_email`; resolve `downline_id` when that person
  signs up / accepts. They see the pending invite on first login.
- **Tier downgrade / lapse.** If a leader's Team subscription lapses, the tab and
  `/api/team/*` leader access turn **off** (gated on live tier), but their
  `team_members` edges are **preserved** so re-subscribing restores the team with
  no re-invites. Downline members are unaffected.
- **Self-invite / invalid email.** Reject inviting yourself or a malformed email
  with a clear message.
- **Empty states.** A brand-new leader with no accepted reports sees a clean
  "Invite your first agent" empty state, not a broken dashboard.

## 5.6 Simplicity bar (must be effortless for both sides)

- **Leader invites in one step:** type an email → "Invite". That's it.
- **Agent accepts in one step:** a clear in-app banner/notification —
  *"[Leader] invited you to their team. They'll be able to see your production,
  clients, and books. [Accept] [Decline]"* — one tap. No settings spelunking.
- **Status is always obvious:** pending invites surface prominently for the
  agent; the leader's roster clearly shows pending vs active.
- **No jargon, no IDs, no setup wizard.** If a non-technical agent can't accept
  in under ten seconds without help, the design has failed.

## 6. PRIM context Fable 5 must honor (existing patterns to follow)

- **Stack:** Next.js 16 App Router (dynamic route `params` are **async** — must
  `await ctx.params`), React 19, Tailwind 4, Supabase, Stripe. Auto-deploys to
  Vercel on push to `main`.
- **Data:** per-user `user_kv` (JSON blobs keyed by user_id + key) + `profiles`.
  Service-role for cross-user server reads; never expose the service key client-side.
- **Auth pattern to copy:** authed route = bearer → `getUser`; cross-user data =
  service-role after an explicit authorization check (mirror
  `/api/admin/impersonate` and the TextDrip/Ringy routes).
- **Subscription:** `profiles.subscription_tier` ∈ `starter|pro|team`;
  `src/lib/subscription.js` hook loads it; `PaywallGate` gates premium features.
- **Nav:** `NAV_TABS` in `src/lib/constants.js`; `ViewMount` pattern in
  `LeadTracker.jsx`; lazy-load the new view (the app bundle is already
  code-split off the root — keep it that way).
- **Design system ("Refined Cool-Tech"):** dark Cool-Tech, Geist font, single
  **indigo** accent (`#6366F1`), emerald only for money/positive. Reuse the
  premium primitives already in the repo: `premium-card`, `premium-table`,
  `section-accent`, `CountUp`, `Chart3DCard`/`Pie3D`, `FadeIn`/`Stagger`, the
  glass-modal entrance. Mobile must not horizontally overflow (wrap toolbars,
  scroll wide tables inside their own box). See `AGENTS.md` for the full guide
  and the banked integration/callback lessons.
- **Announcements:** new user-facing feature → add a What's New bell entry +
  `[announce]` Slack deploy (AGENTS.md standing rule).

## 7. Boundaries (what the build must NOT do)

- Do **not** modify, migrate, or delete any agent's data. This feature is
  strictly additive + read-only over agent data.
- Do **not** weaken existing single-user RLS or expose `user_kv` cross-user to
  the client. All cross-user reads go through authorized `/api/team/*` endpoints.
- Do **not** build any Phase-2 item (see §8).
- Do **not** send any email, post anything public, or run any destructive action
  as part of the build without explicit approval. (Invite emails, if any, are a
  product feature — implement the in-app invite first; an email notification is
  optional and must reuse the existing Resend pattern.)
- Do **not** over-build: no speculative abstractions, no features beyond §4.
  Validate only at real boundaries (the authz check, user input).

## 8. Out of scope (Phase 2 — explicitly NOT in this build)

Override-commission flow, statement-matching across downline, reassigning leads
between agents, leave-notes/coaching on an agent's prospect, "view-as-agent" live
screen mirror, month-over-month team trends, seat management / comped agent
billing.

## 9. Success criteria

- A Team-tier leader sees "View My Team" next to CPA Dashboard; non-Team users
  never see it and can't hit the leader endpoints.
- Leader invites by email → invitee sees + accepts a one-tap in-app consent
  prompt → appears on the roster. Works even if they had no account at invite time.
- **Transitive visibility proven:** a 3-level chain (SAT → FSL → FTA → Agent) —
  the SAT's scoreboard aggregates the whole downline, and the SAT can drill
  SAT→FSL→FTA→Agent down to the agent's full read-only PRIM. An FTA sees only
  *their* agents, never sideways or upward.
- The `getDownlineIds` helper is unit-tested against a multi-level tree including
  a deliberately planted cycle (must terminate) and the one-direct-upline rule.
- Team Scoreboard shows correct aggregated production, pipeline, accountability,
  and financial-health numbers across the downline for the selected period and
  scope toggle (direct vs whole).
- Every downline-data view writes an audit row; no PHI is logged.
- Member can see who's above them and **Leave team**; leaving cuts off the whole
  upline chain's access immediately.
- All §5.5 edge cases behave as specified (cycles blocked, one upline enforced,
  re-invite friendly, removal cuts one edge, tier-lapse preserves edges).
- `npm run build` clean, existing test suite green, no mobile horizontal overflow,
  design consistent with PRIM. **Smoke-tested end-to-end on real multi-account
  setup** (at least one leader + one agent, ideally a 3-level chain).

## 10. Build & verification expectations (for the Fable 5 run)

- Hand Fable 5 the **whole** feature; let it scope and execute end-to-end at
  **xhigh** effort. Do not pre-chop into rigid phases.
- Use subagents for independent parts (DB/RLS, the `/api/team/*` endpoints, the
  Scoreboard UI, the drill-down reuse, the agent consent/roster UI) and verify
  with a **fresh-context** subagent against this spec.
- `next build` passing ≠ working: smoke-test the whole chain (invite → accept →
  scoreboard → drill-down → audit → leave) on a **real second test account**
  before declaring done. Surface real errors, not silent no-ops.
- Provide the SQL migrations as copy-paste blocks in chat (Juan runs them in the
  Supabase SQL editor).
