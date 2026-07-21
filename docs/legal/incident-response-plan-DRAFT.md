# PRIM — Incident Response Plan (DRAFT)

> **Operator:** R&J Prime Consultancy LLC. **Purpose:** a practical runbook for
> outages and security incidents. Referenced by the DPA/Privacy Policy's security
> commitments. Draft — Juan to review/adjust roles + contacts.

## 1. Roles
- **Incident lead:** Juan Trejo (owner). Makes go/no-go calls, talks to vendors, notifies agents.
- **Technical response:** Juan + Claude Code (diagnosis, fixes, verification).
- **Escalation contacts:** Supabase support (Pro plan), Vercel support, Anthropic support, Stripe/Resend support — as relevant to the failing component.

## 2. Severity
- **SEV-1 — Full outage:** app unusable for most/all agents (e.g., DB down). Respond immediately.
- **SEV-2 — Partial/degraded:** a feature broken, slow, or affecting some users.
- **SEV-3 — Minor:** cosmetic/single-user, no data risk.
- **Security incident (any sev):** suspected unauthorized access, data exposure, or breach → also follow §6.

## 3. Detection
- Agent reports (support tickets, direct messages).
- Owner notices it firsthand.
- (Future) Uptime monitor / Supabase + Vercel alerts.

## 4. Triage runbook — "PRIM isn't loading"
Work top-down; each step isolates a layer.
1. **Is the app/server up?** `curl -sI https://app.primtracker.com/` → expect `200`. `curl https://app.primtracker.com/api/version` → expect a JSON version. If these fail → Vercel/app problem (check the Vercel dashboard for a failed deploy; roll back the last deploy).
2. **Is it a bad deploy?** Check Vercel → latest production deployment READY? If a recent deploy broke it → **redeploy the previous good commit** (Vercel → Deployments → prior deploy → Promote/Redeploy), or revert the commit.
3. **Is the database up?** In the browser Network tab (or curl with the anon key), check calls to `…supabase.co/rest/v1/...`. `503`, `522`, or timeouts = **database problem**. Cross-check the project's **Logs** (Postgres + API) and **Reports** (CPU/RAM/Disk/Connections).
4. **Is it Supabase-wide or just us?** Check **status.supabase.com**. If green there but our project is failing → it's **our project** (capacity/overload), not a platform outage.
5. **Classify the DB failure:**
   - **CPU/RAM pegged or connections maxed** → compute overload (see playbook A).
   - **Disk ~100% full** → resize disk / the WAL/backup is stuck (Supabase support).
   - **Locks / long-running query** → find + cancel it (SQL editor: `SELECT * FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;`).

## 5. Response playbooks
**A. Database overloaded / unreachable (today's outage type)**
1. **Restart the database** — Supabase → **Settings → Compute & Disk / Infrastructure → Restart / Fast Database Reboot** (control-plane; works even when the DB pages error). ~2 min.
2. **Cut the load so the restart holds** — tell agents to **CLOSE PRIM (not refresh) for ~5 minutes** (a retry storm re-saturates the DB and blocks recovery).
3. **Freeze deploys** — do not deploy during an incident (each deploy triggers a reload burst that re-loads everyone).
4. **Verify recovery** — Supabase REST returns `200` steadily (sub-second).
5. **Right-size** — if it recurs, **upsize compute** (Settings → Compute & Disk) and reduce per-load query volume.
6. **If restart won't work / DB stuck** → **Contact Supabase support** (Pro): "Project <ref> DB unreachable, REST/Auth 522, needs restart."

**B. Bad deploy** → redeploy the prior good commit (Vercel) or `git revert` + deploy. Verify `/api/version` + app load.

**C. Supabase/Vercel platform outage** (status page red) → nothing to fix on our side; post an agent notice, wait, monitor the status page.

**D. Third-party (Stripe/Resend/Anthropic) degraded** → affected feature only (billing/email/AI import); post a notice, wait; these fail soft in the app.

## 6. Security incident / data breach
If unauthorized access or data exposure is **suspected or confirmed**:
1. **Contain** — rotate the exposed credential (service-role key, API key, token), revoke sessions, disable the affected path.
2. **Assess** — what data, whose, how many, over what window. Preserve logs.
3. **Notify (informational — confirm with counsel; not legal advice):**
   - As a **vendor/processor**, notify affected **business customers (agents)** promptly — target **within 72 hours** so they can meet their own regulators' deadlines (NAIC insurance data-security laws in adopting states).
   - **Florida FIPA (§501.171):** if PRIM is the covered entity, notify affected individuals **≤30 days**; notify the **FL Dept. of Legal Affairs** if **≥500 FL residents** affected. As a third-party agent to a covered entity, notify that entity **within 10 days**.
   - **GLBA Safeguards Rule:** notify the **FTC within 30 days** of a "notification event" (unauthorized acquisition of unencrypted customer info of **≥500 consumers**).
4. **Engage counsel** for any real breach before external notifications.

## 7. Communication
- **Agents:** post to the PRIM Slack (the admin "Broadcast to Slack" tool, or directly) — what's happening, what to do (e.g., "reopen in a few minutes"), and an all-clear when resolved.
- **Keep it factual**, no PII, no speculation.

## 8. Post-incident
Within a day or two, write a short note: what happened, root cause, fix, and 1–3 prevention actions. Add them to the backlog. (Today's outage → upsize compute + batch startup queries.)

---
### Reviewer notes (remove before finalizing)
- Fill in real escalation contacts/links for each vendor.
- Consider adding an uptime monitor (e.g., a simple cron pinging `/api/version` + Supabase REST) so detection isn't only "an agent told me."
