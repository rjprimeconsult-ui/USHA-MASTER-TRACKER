# PRIM Monthly Health Audit — Runbook

**Cadence:** 1st of each month (calendar reminder set).
**How to trigger:** Tell Claude **"run the monthly audit"** — it executes the steps below.
**Baseline:** First full audit = `Desktop/.../PRIM-Pre-Growth-Audit-2026-06-08.md`. Each month, compare against the previous month's report and flag anything **new or regressed**.

---

## What the audit does
Runs four parallel READ-ONLY auditors over the codebase + infra, then synthesizes one prioritized report (🔴 fix now / 🟡 soon / 🟢 solid). All auditors are read-only — no edits without explicit approval.

### 1. Security
AuthZ on every `src/app/api/**` route (token + role checks; admin routes gate on `is_admin`); RLS on `user_kv` + `profiles`; secrets not in client/`NEXT_PUBLIC_*`; injection/XSS sinks; AI/upload routes (size caps, rate limits, paywall enforcement); Stripe/Resend webhook signature verification; PHI never logged or leaked.

### 2. Database / data-integrity
`user_kv` blob model growth + write amplification; merge-on-save concurrency (`storage.js`, `mergeStore.mjs`) — lost updates, delete-vs-stale; admin page + reminders cron fan-out across all users; `touchLog`/activities unbounded growth; backups/PITR status; schema in version control.

### 3. Functionality / correctness
Run `npm test` + `npx --no-install next build` (must be green). Money math (commission/AV/CPA/P&L), statement + SalesReport parsers, dedup, follow-up engine. Timezone/date handling. Flag anything that shows **wrong numbers** or **loses data**.

### 4. Health / performance / ops
Bundle/first-load size + lazy-loading of heavy libs (xlsx, recharts, pdfjs); large components + re-render risk; serverless cold-start/timeout/cost (AI routes, cron); error monitoring (Sentry) + alerting gaps; dependency risks.

---

## Output
- Save the dated report to the Desktop project folder: `PRIM-Monthly-Audit-YYYY-MM-DD.md`.
- Lead with **what's NEW or changed since last month** (don't re-litigate accepted items).
- End with a short recommended action order.

## Standing open items to re-check each month (🟡 from the baseline audit)
- AI routes: size cap + per-user rate limit + server-side subscription check.
- Cron + `/admin` page: paginate / batch instead of all-users fan-out.
- Add error monitoring (Sentry) + Slack alert on cron errors.
- Lazy-load `xlsx` + import wizards; remove unused `mammoth`; review `xlsx` 0.18.5 CVE.
- Concurrency: optimistic-concurrency (`updated_at`) guard; cap `touchLog`.
- Lower-priority correctness: statement multi-policy split; SalesReport Issued `closedDate`; dead `leads` table in `chatTools.js`; PEARL residual rate.

## Done (don't re-flag unless regressed)
- ✅ `user_kv` RLS migration committed + run in prod.
- ✅ Supabase Pro daily backups (7-day). PITR intentionally off.
- ✅ Local-date fix (timezone). ✅ CPA premium uses `leadPremium`. ✅ error.jsx/global-error.jsx crash guard.
