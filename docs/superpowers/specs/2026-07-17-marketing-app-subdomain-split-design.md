# Design Spec — Marketing / App Subdomain Split

- **Date:** 2026-07-17
- **Status:** Approved (design), pending implementation plan
- **Owner:** Juan (R&J Prime) · authored with Claude

## 1. Problem

Visitors who type `primtracker.com` expect the marketing/sales page. Instead the
root URL renders the **app** (`src/app/page.js` → `<LeadTracker>`), and for a
logged-out visitor `AuthGate` ([`src/components/auth/AuthGate.jsx:55`](../../../src/components/auth/AuthGate.jsx)) short-circuits to the
**sign-in screen** — a login wall. The actual, fully-built marketing page lives
one path over at `/landing` (already public via `PUBLIC_ROUTE_PREFIXES`), so
people only see it if they know to type `/landing`.

Result: a conversion leak. Prospects hit a login form instead of the sales page.
The `/landing` file header already anticipated this ("Phase 3 replaces the home
page route so primtracker.com IS this landing page").

## 2. Goals / Non-goals

**Goals**
1. `primtracker.com` (canonical `www.primtracker.com`) shows the **marketing page**.
2. The **app** lives at `app.primtracker.com` (login → tool).
3. Marketing "Sign in" / "Start free trial" buttons bridge to the app subdomain.
4. Existing integrations (Ringy / Benepath / webform webhooks) and out-in-the-world
   email asset/links keep working through the cutover.

**Non-goals (YAGNI)**
- No marketing **content** redesign — reuse the existing `/landing` page as-is.
- No cross-subdomain session sharing / "Go to Dashboard" login-detection on the
  marketing page. Marketing stays static; buttons always link to the app sign-in.
- No auth-layer re-architecture. Sessions stay in the browser's per-origin storage.

## 3. Chosen approach

**Subdomain split, single Next.js project, host-based middleware routing.**
(Alternatives considered: `/app` path split — simpler but rejected by owner in
favor of a clean subdomain; two separate Vercel projects — rejected, it is one
codebase.)

### 3.1 Domain behavior

| Host | Serves | Notes |
|---|---|---|
| `primtracker.com` | 308 → `www.primtracker.com` | Existing apex→www redirect stays |
| `www.primtracker.com/` | Marketing landing (today's `/landing`) | Rewritten at the edge; clean root URL |
| `www.primtracker.com/pricing` `/privacy` `/terms` | Marketing/legal | Unchanged |
| `app.primtracker.com/` | The app (AuthGate → sign-in → LeadTracker) | App route is unchanged internally (`/`) |
| `*/api/*` | API routes | **Reachable on BOTH hosts** (see 3.3) |
| `*/_next/*`, static assets, `/email-assets/*` | Static | Served on both hosts |

### 3.2 Middleware (the core piece)

New `src/middleware.js`. Reads the request `Host` header and branches:

- **App host** (`app.primtracker.com`): pass through unchanged. The app already
  renders at `/`, so no rewrite is needed. Marketing paths on this host
  (`/landing`, `/pricing`) 308-redirect to the marketing host for cleanliness.
- **Marketing host** (`www.primtracker.com` / apex): rewrite `/` → `/landing`
  (serves the landing page at the clean root URL). `/pricing`, `/privacy`,
  `/terms` pass through. The app is **not** reachable on this host.
- **`/api/*`, `/_next/*`, static assets, `/admin`**: excluded from rewrites via
  the middleware `matcher` so they resolve identically on both hosts.
  `/admin` on the marketing host 308-redirects to the app host.

The same URL path `/` renders different content per host via `NextResponse.rewrite`.
This is the standard Next.js multi-domain pattern and requires **no change to the
app's internal routing** (the app stays mounted at `/`).

Host detection must tolerate: the `x-forwarded-host` header (Vercel), the local
dev host (`localhost:PORT` → treat as app host so local dev is unchanged), and a
preview-deployment host (`*.vercel.app` → app host, so previews still reach the app).

### 3.3 Why `/api` must stay on both hosts

- Existing users have already pasted **webhook URLs** (`www.primtracker.com/api/ringy/...`,
  `/api/benepath/...`, `/api/webforms/webhook/...`) into Ringy / Benepath / their
  sites. Those must not 404 after cutover. Since it is one Vercel project, the API
  resolves on both hosts as long as middleware does not rewrite `/api`.
- Transactional **email image assets** (`www.primtracker.com/email-assets/...`,
  `outreachEmails.js:25`) live in already-delivered inboxes; they must keep loading.
- **Protected blast-capture routes** (`/api/ringy`, `/api/benepath`, `/api/blast`,
  `increment_blast`) are NOT touched by this work — middleware explicitly excludes
  `/api` from any rewrite/redirect. (See the blast-undercount guard rules.)

## 4. Code changes (implementation surface)

1. **`src/middleware.js`** — host-based routing per 3.2. Minimal, no auth logic,
   no DB calls, `/api` and static excluded via matcher.
2. **Promote landing to the marketing homepage** — middleware rewrite of `/` →
   `/landing` on the marketing host (keeps `/landing` as the single source file).
   Add a 308 redirect `/landing` → `/` on the marketing host so the canonical
   marketing URL is the clean root (avoids duplicate-content / two live URLs).
3. **App "open PRIM" links → app subdomain.** One primary lever plus a few
   hardcoded spots:
   - Set env `NEXT_PUBLIC_SITE_URL=https://app.primtracker.com` (drives the
     webhook-URL displays in `ringy/benepath/blast/webforms config` routes and
     any `NEXT_PUBLIC_SITE_URL` reader). New webhook URLs shown to users become
     `app.primtracker.com/...`; **old `www` webhook URLs keep working** (3.3).
   - `src/lib/welcomeEmails.js:24` `APP_URL` → `https://app.primtracker.com`.
   - `src/app/api/reminders/route.js` "Open PRIM" link (`:209`) + push `url` (`:375`).
   - `src/app/api/push/test/route.js:50` push `url`.
   - `src/app/api/admin/broadcast/route.js:59` announcement `url`.
   - Prefer reading `NEXT_PUBLIC_SITE_URL` with an `app.primtracker.com` fallback
     over hardcoding, so there is one source of truth.
   - Origin-based routes (`stripe/*`, `email/send`, `admin/impersonate`) already
     use the request `origin` and self-correct — only their hardcoded fallbacks
     get updated to the app domain.
4. **Marketing CTAs** — `src/app/landing/page.jsx` "Sign in" (`:88`, currently
   `href="/"`) and any trial CTAs that must reach the app → `https://app.primtracker.com`
   (built from a marketing-side `NEXT_PUBLIC_APP_URL` constant so it is not
   scattered). "Start free trial" continues to `/pricing` unless owner wants it
   to deep-link to the app sign-up.
5. **Logout destination** → the app's own sign-in screen (`app.primtracker.com/`),
   keeping agents in-context (owner-confirmed).
6. **`noindex` the app subdomain** — the app/login should not be indexed;
   marketing stays indexed. Emit `X-Robots-Tag: noindex` (or a robots meta) when
   the host is the app subdomain; keep marketing indexable. `robots.txt` /
   canonical tags point crawlers at the marketing host.
7. **Env vars** — `NEXT_PUBLIC_SITE_URL` (app origin) and `NEXT_PUBLIC_APP_URL`
   for marketing→app links. Documented in the deploy checklist.

## 5. Owner (external) steps — click-by-click, delivered with the plan

1. **DNS** (registrar): add the record Vercel shows when the domain is added —
   typically `CNAME  app  →  cname.vercel-dns.com`.
2. **Vercel:** add `app.primtracker.com` as a domain on the `primtracker` project;
   set env `NEXT_PUBLIC_SITE_URL=https://app.primtracker.com` (Production) and
   `NEXT_PUBLIC_APP_URL=https://app.primtracker.com`.
3. **Supabase → Authentication → URL Configuration:** set **Site URL** =
   `https://app.primtracker.com`; add `https://app.primtracker.com/**` to
   **Redirect URLs** (so signup-confirmation and password-reset emails land on the
   app, not marketing). Keep `www.primtracker.com` in the list during transition.

## 6. Rollout sequence (no lock-outs)

1. Merge the code (middleware supports both hosts; while only `www`/apex resolve,
   nothing changes for current users — the app still answers on `www` until DNS
   for `app` exists, so the middleware's app-host branch is simply not hit yet).
2. Owner adds DNS `app` record + Vercel domain + env vars → `app.primtracker.com`
   goes live.
3. Owner flips Supabase Site URL / Redirect URLs to the app host.
4. Verify `app.primtracker.com` end-to-end: sign-in, signup-confirmation email
   link lands on app, password reset, a webhook POST to an `app.` URL, and an
   old `www.` webhook URL both 200.
5. Flip the marketing host root to the landing page (middleware rewrite) so
   `www.primtracker.com/` shows marketing.
6. Announce (What's-New / email): "the app moved to app.primtracker.com — sign in
   again." Update any agent bookmarks messaging.

## 7. Consequences / risks

- **One-time re-login for every agent** (owner-accepted). Sessions are stored per
  browser-origin; `www` → `app` is a new origin, so stored sessions do not carry.
  Data is untouched. Mitigation: a clear What's-New + email notice at cutover.
- **Ordering risk:** if Supabase Site URL is flipped before `app.` DNS resolves,
  confirmation emails could 404. Sequence in §6 flips Supabase only after the app
  host is verified live.
- **Webhook continuity:** covered by keeping `/api` on both hosts (§3.3). Old `www`
  webhook URLs remain valid; only newly-displayed URLs use `app.`.
- **Vercel Hobby plan** builds can queue on high-volume days (known); the cutover
  is a single deploy — verify it reaches READY before the DNS/Supabase steps.

## 8. Verification plan

- **Automated:** `npm test` (baseline 422 pass), `npm run build` clean, no new lint.
  A middleware unit-level check for host→route mapping (pure function extracted so
  it is testable without a live server), following the repo's `.mjs` test pattern.
- **Manual (post-cutover, owner + Claude):** marketing renders at `www/`; app at
  `app./`; sign-in, signup-confirm, password-reset all resolve on the app host;
  an `app.` and a legacy `www.` webhook both 200; marketing CTAs land on the app;
  logout returns to app sign-in; `noindex` present on app, absent on marketing.
- **Blast safety:** run `scripts/blast-burst-smoketest.mjs` against a webhook TEST
  token to confirm the capture path is untouched.

## 9. Decisions made (assumption ledger)

- Reuse existing `/landing` as the marketing homepage (no content redesign).
- Subdomain over `/app` path (owner choice).
- Keep-it-simple sessions: accept one-time re-login, no cookie/SSR auth change,
  static marketing (owner choice).
- Logout → app sign-in screen (owner-confirmed).
- Keep `/api` + static email assets served on `www` too (owner-confirmed).

## 10. Open questions for the plan phase

- Does "Start free trial" stay pointing at `/pricing`, or deep-link to app sign-up?
  (Default: unchanged → `/pricing`.)
- Exact `noindex` mechanism (header via middleware vs per-host metadata) — decide
  in the plan; header via middleware is simplest and host-aware.
- Confirm the local-dev + `*.vercel.app` preview hosts resolve to the app branch
  so dev/preview workflows are unchanged.
