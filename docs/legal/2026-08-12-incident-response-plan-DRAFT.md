# PRIM — Incident Response Plan

> **Operator:** R&J Prime Consultancy LLC. **Purpose:** a practical runbook for
> outages and security incidents. Referenced by the Privacy Policy §9, the
> DPA's breach-notice clause, and the [WISP](./2026-08-12-written-information-security-program-DRAFT.md)
> §8. **Draft — Juan to review, sign, and date.** Supersedes the earlier
> undated draft of this plan (content carried forward unchanged in §§1-5;
> §6-8 filled in below).

## 1. Roles

- **Incident lead:** Juan Trejo (owner). Makes go/no-go calls, talks to
  vendors, notifies agents, and is the point of contact for any external
  notification (regulator, affected individual, business customer).
- **Technical response:** Juan + Claude Code (diagnosis, fixes, verification).
- **Escalation contacts:**

  | Vendor | What they cover | Escalation |
  |---|---|---|
  | Supabase | Database, auth, storage | Dashboard support ticket (Pro plan) at supabase.com/dashboard/support; status at status.supabase.com |
  | Vercel | Hosting/compute, deploys | Dashboard support at vercel.com/help; status at vercel-status.com |
  | Stripe | Billing, card processing | Dashboard support at dashboard.stripe.com/support; status at status.stripe.com |
  | Resend | Email delivery | Dashboard support at resend.com/support; status at resend-status.com |
  | Anthropic | AI extraction/chat | support.anthropic.com; status at status.anthropic.com |

## 2. Severity

- **SEV-1 — Full outage:** app unusable for most/all agents (e.g., DB down). Respond immediately.
- **SEV-2 — Partial/degraded:** a feature broken, slow, or affecting some users.
- **SEV-3 — Minor:** cosmetic/single-user, no data risk.
- **Security incident (any sev):** suspected unauthorized access, data exposure, or breach → also follow §6.

## 3. Detection

- Agent reports (support tickets, direct messages).
- Owner notices it firsthand.
- **No automated uptime monitor is in place as of this draft** — detection
  currently relies on the two channels above. Tracked as a priority gap
  (WISP §9 covers security-control gaps; this one is operational — a simple
  cron or free-tier monitor hitting `/api/version` and a Supabase REST
  endpoint on a 1-5 minute interval would close it).

## 4. Triage runbook — "PRIM isn't loading"

Work top-down; each step isolates a layer.

1. **Is the app/server up?** `curl -sI https://www.primtracker.com/` → expect
   `200`. `curl https://www.primtracker.com/api/version` → expect a JSON
   version. If these fail → Vercel/app problem (check the Vercel dashboard
   for a failed deploy; roll back the last deploy).
2. **Is it a bad deploy?** Check Vercel → latest production deployment
   READY? If a recent deploy broke it → **redeploy the previous good
   commit** (Vercel → Deployments → prior deploy → Promote/Redeploy), or
   revert the commit.
3. **Is the database up?** In the browser Network tab (or curl with the
   anon key), check calls to `…supabase.co/rest/v1/...`. `503`, `522`, or
   timeouts = **database problem**. Cross-check the project's **Logs**
   (Postgres + API) and **Reports** (CPU/RAM/Disk/Connections).
4. **Is it Supabase-wide or just us?** Check **status.supabase.com**. If
   green there but our project is failing → it's **our project**
   (capacity/overload), not a platform outage.
5. **Classify the DB failure:**
   - **CPU/RAM pegged or connections maxed** → compute overload (see playbook A).
   - **Disk ~100% full** → resize disk / the WAL/backup is stuck (Supabase support).
   - **Locks / long-running query** → find + cancel it (SQL editor:
     `SELECT * FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;`).

## 5. Response playbooks

**A. Database overloaded / unreachable**
1. **Restart the database** — Supabase → **Settings → Compute & Disk /
   Infrastructure → Restart / Fast Database Reboot** (control-plane; works
   even when the DB pages error). ~2 min.
2. **Cut the load so the restart holds** — tell agents to **CLOSE PRIM (not
   refresh) for ~5 minutes** (a retry storm re-saturates the DB and blocks
   recovery).
3. **Freeze deploys** — do not deploy during an incident (each deploy
   triggers a reload burst that re-loads everyone).
4. **Verify recovery** — Supabase REST returns `200` steadily (sub-second).
5. **Right-size** — if it recurs, **upsize compute** (Settings → Compute &
   Disk) and reduce per-load query volume.
6. **If restart won't work / DB stuck** → **Contact Supabase support**
   (Pro): "Project [ref] DB unreachable, REST/Auth 522, needs restart."

**B. Bad deploy** → redeploy the prior good commit (Vercel) or `git revert`
+ deploy. Verify `/api/version` + app load.

**C. Supabase/Vercel platform outage** (status page red) → nothing to fix
on our side; post an agent notice, wait, monitor the status page.

**D. Third-party (Stripe/Resend/Anthropic) degraded** → affected feature
only (billing/email/AI import); post a notice, wait; these fail soft in the
app.

## 6. Security incident / data breach

If unauthorized access or data exposure is **suspected or confirmed**:

1. **Contain** — rotate the exposed credential (service-role key, API key,
   token), revoke sessions, disable the affected path. Rotation points for
   the credentials currently in use: Supabase service-role key (Project
   Settings → API), Stripe secret + webhook signing keys (Dashboard →
   Developers → API keys / Webhooks), Resend API key (resend.com/api-keys —
   see the two-key discipline noted below), Anthropic API key
   (console.anthropic.com).
   - **Resend specifically:** PRIM has previously operated with two
     Resend keys (a full-access key and a legacy send-only key). Confirm
     which key is currently live in Vercel env vars before rotating, and
     revoke the unused one at the same time — a dormant key is itself an
     exposure.
2. **Assess** — what data, whose, how many, over what window. Preserve
   logs (Vercel function logs, Supabase Postgres/API logs, Stripe/Resend
   dashboards) before they roll off retention — pull and save them as soon
   as an incident is suspected, not after triage is complete.
3. **Notify** (informational — confirm with counsel; not legal advice):
   - As a **vendor/processor**, notify affected **business customers
     (agents)** promptly — target **within 72 hours** so they can meet
     their own regulators' deadlines (NAIC insurance data-security laws in
     adopting states; this matches the 72-hour figure in the DPA's breach
     clause — keep the two documents aligned if either changes).
   - **Florida FIPA (§501.171):** if PRIM is the covered entity, notify
     affected individuals **≤30 days**; notify the **FL Dept. of Legal
     Affairs** if **≥500 FL residents** affected. As a third-party agent to
     a covered entity, notify that entity **within 10 days**.
   - **GLBA Safeguards Rule:** notify the **FTC within 30 days** of a
     "notification event" (unauthorized acquisition of unencrypted
     customer info of **≥500 consumers**).
   - **Other states:** most U.S. states have their own breach-notification
     statute with its own deadline and threshold (commonly 30-90 days, or
     "without unreasonable delay"). The Florida and GLBA rules above are
     the ones known to apply today; **do not assume they are the only
     ones** — the moment a real incident is confirmed, the notification
     list should be checked against every state where an affected
     agent or their end client resides. This is exactly the kind of
     count-and-confirm step counsel should do in the moment, not a box
     checked once in advance.
4. **Engage counsel** for any real breach before external notifications go out.

## 7. Communication

- **Agents:** post to the PRIM Slack (the admin "Broadcast to Slack" tool,
  or directly) — what's happening, what to do (e.g., "reopen in a few
  minutes"), and an all-clear when resolved.
- **Keep it factual**, no PII, no speculation.
- **For a security incident** specifically, the notification itself
  (§6.3) is the primary external communication — a Slack post is
  operational status, not a substitute for the required notice.

## 8. Post-incident

Within a day or two, write a short note: what happened, root cause, fix,
and 1-3 prevention actions. Add them to the backlog, and — if the incident
exposed a gap this plan or the WISP didn't already track — add that gap to
[WISP §9](./2026-08-12-written-information-security-program-DRAFT.md#9-known-gaps-and-priority-actions)
in the same pass. An incident that doesn't produce a WISP update was a
missed opportunity to close the gap that caused it.

**On record from the July 2026 outage** (root cause: unbatched mount-time
queries overloading the database under concurrent load) → resolved by
batching reads through `storage.prefetch()` and upsizing Supabase compute
to the Small tier; both changes are live in production.

---
### Reviewer notes (remove before finalizing)
- Escalation contacts above are the vendors' general support channels —
  if/when any of these vendors is upgraded to a plan with a named account
  rep or a priority support SLA, replace the generic link with the direct
  contact.
- The "no automated uptime monitor" gap (§3) and the WISP's tracked gaps
  are the two lists to check before telling a broker or regulator "yes, we
  have an incident response plan" — a plan with known, unaddressed
  detection gaps is honest to disclose, not a reason to withhold the
  document.
