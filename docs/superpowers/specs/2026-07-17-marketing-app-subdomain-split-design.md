# Design Spec — Marketing / App Subdomain Split

- **Date:** 2026-07-17
- **Status:** Approved (design), pending implementation plan
- **Owner:** Juan (R&J Prime) · authored with Claude
- **Rev:** 3 (spec-review complete — round 1: 2 blockers fixed; round 2: Approved-with-nits, deploy-announcer + async-headers folded in)

## 1. Problem

Visitors who type `primtracker.com` expect the marketing/sales page. Instead the
root URL renders the **app** (`src/app/page.js` → `<LeadTracker>`), and for a
logged-out visitor `AuthGate` ([`src/components/auth/AuthGate.jsx:55`](../../../src/components/auth/AuthGate.jsx)) short-circuits to the
**sign-in screen** — a login wall. The actual, fully-built marketing page lives
one path over at `/landing` (already public via `PUBLIC_ROUTE_PREFIXES`), so
people only see it if they know to type `/landing`. Result: a conversion leak.

## 2. Goals / Non-goals

**Goals**
1. `primtracker.com` (canonical `www.primtracker.com`) shows the **marketing page**.
2. The **app** lives at `app.primtracker.com` (login → tool).
3. Marketing "Sign in" / "Start free trial" buttons bridge to the app subdomain.
4. Existing integrations (Ringy / Benepath / webform webhooks) and out-in-the-world
   email asset/links keep working through the cutover.

**Non-goals (YAGNI)**
- No marketing **content** redesign — reuse the existing `/landing` page as-is.
- No cross-subdomain session sharing / "Go to Dashboard" login-detection.
- No auth-layer re-architecture. Sessions stay in the browser's per-origin storage
  (confirmed: `src/lib/supabase.js` uses default localStorage, no cookie storage).

## 3. Chosen approach

**Subdomain split, single Next.js project, host-based middleware routing + a
host-aware AuthGate.** (Alternatives: `/app` path — rejected by owner for a clean
subdomain; two Vercel projects — rejected, one codebase.)

### 3.1 Domain behavior

| Host | Path | Serves | Notes |
|---|---|---|---|
| `primtracker.com` | * | 308 → `www.primtracker.com` | Vercel apex→www rule (owner: confirm scoped to apex, NOT `app.`) |
| `www.primtracker.com` | `/` | Marketing landing | Host-aware: rewrite + public AuthGate (§3.2) |
| `www.primtracker.com` | `/privacy` `/terms` | Legal (static) | Public on both hosts |
| `www.primtracker.com` | `/pricing` | 308 → `app.primtracker.com/pricing` | **Pricing must run on the app origin** (§3.3) |
| `www.primtracker.com` | `/landing` | 308 → `/` | Canonical marketing = clean root |
| `app.primtracker.com` | `/` | App (AuthGate → sign-in → LeadTracker) | App route unchanged internally (`/`) |
| `app.primtracker.com` | `/pricing` | Pricing + Stripe checkout | Public view; session-aware checkout (§3.3) |
| `app.primtracker.com` | `/privacy` `/terms` | Legal | Fine on both hosts |
| `app.primtracker.com` | `/landing` | 308 → `www` root | Canonical marketing lives on www |
| both | `/api/*`, `/_next/*`, static, `/email-assets/*` | API + assets | **Reachable on BOTH hosts** (§3.4) |
| both | `/admin` | Admin | On www: 308 → `app` **preserving path+query** (§3.2) |

### 3.2 Two coordinated pieces: middleware + host-aware AuthGate

A middleware rewrite alone is **insufficient** — `AuthGate` lives in the root
`src/app/layout.js` and wraps every route, deciding public-vs-gated from
`usePathname()`. After `NextResponse.rewrite('/' → '/landing')` the client path is
still `/`, which is not in `PUBLIC_ROUTE_PREFIXES`, so a logged-out visitor would
**still** get `<SignInScreen/>`. Both pieces are required:

**(a) `src/middleware.js`** — reads the `Host` / `x-forwarded-host` header:
- **App host** (`app.primtracker.com`): pass through. App renders at `/`.
  `/landing` → 308 → `www` root.
- **Marketing host** (`www` / apex): rewrite `/` → `/landing`; `/pricing` → 308 →
  `app.primtracker.com/pricing`; `/landing` → 308 → `/`; `/privacy` `/terms` pass through.
- **`/api/*`, `/_next/*`, static, `/email-assets/*`**: excluded via `matcher` — resolve
  identically on both hosts. **`/admin` stays IN the matcher** and is redirected
  in-handler on the www host (www→app, preserving path + query) so `tickets.mjs`
  deep-links survive (§4).
- **Host classification:** `app.primtracker.com` → app; `www.`/apex → marketing;
  `localhost:*` → app (dev unchanged); `*.vercel.app` preview → app **by default,
  with an override** (`?__host=marketing` query flag or `PREVIEW_AS_MARKETING`
  env) so the marketing branch + host-aware AuthGate can be exercised on a preview
  deploy before production (addresses "marketing branch untestable" risk). The
  override is honored **only on preview hosts** (`*.vercel.app`) and is ignored on
  the production `app.` host, so `?__host=marketing` cannot flip the production app
  root into the public branch.

**(b) Host-aware `AuthGate`** — the root `layout.js` becomes an **`async` server
component** and reads the incoming host with `const h = await headers()` (Next
16's `next/headers` `headers()` is **async** — `headers().get(...)` throws), then
passes an `isMarketingHost` boolean to `AuthGate` (a client component rendered
under `AuthProvider`). `isPublicRoute` treats `/` as public when `isMarketingHost`
is true (keeping `/` gated on the app host). This is the change that actually
surfaces the landing page instead of the sign-in wall. (Reading headers opts routes
into dynamic rendering — fine here: the tree is already client-rendered via
`AuthProvider` + the `ssr:false` app root, so nothing was statically cached anyway.) A **rendered**
test (not just a middleware pure-function test) asserts: logged-out + marketing
host + `/` → landing markup, not the sign-in card.

### 3.3 Why `/pricing` stays on the app host

`startCheckout` (`src/lib/subscription.js`) reads the Supabase session
(`getSession()`), which lives in **per-origin localStorage** on the app host.
`create-checkout-session` builds Stripe success/cancel URLs from the request
`origin`. In-app upgrade links (`PaywallGate.jsx`, `Profile.jsx`, `LeadTracker.jsx`)
use `window.location.href = '/pricing'`. If pricing rendered on `www`:
- a logged-in agent gets 308'd to `www/pricing`, where the session is absent →
  checkout fails → dumped on marketing;
- Stripe returns the *paid* user to `www/` where `syncAfterCheckout` has no token.

So `/pricing` is served on the **app host** (already public via
`PUBLIC_ROUTE_PREFIXES`, so logged-out prospects can view it), and `www/pricing`
308-redirects **to** the app host. Marketing "Start free trial" CTAs point directly
at `https://app.primtracker.com/pricing`. Origin, session, and Stripe URLs then all
live on the app host.

### 3.4 Why `/api` + static assets stay on both hosts

- Users already pasted **webhook URLs** (`www.primtracker.com/api/ringy/webhook/…`,
  `/api/benepath/webhook/…`, `/api/webforms/webhook/…`) into external systems. They
  must not 404. One Vercel project ⇒ API resolves on both hosts iff middleware does
  not rewrite `/api`.
- Email **image assets** (`www.primtracker.com/email-assets/…`) sit in delivered
  inboxes; must keep loading.
- **Protected blast-capture routes** (`ringy/webhook/[token]`,
  `benepath/webhook/[token]`, `blast/log/[token]`, and the `increment_blast` **DB
  function** they call) are NOT touched — middleware excludes `/api` from any
  rewrite/redirect. (Blast-undercount guard rules honored.)

## 4. Code changes (implementation surface)

1. **`src/middleware.js`** — host routing per §3.2. No auth logic, no DB calls,
   `/api` + static excluded via matcher, host classification with preview override.
2. **Host-aware `AuthGate` + `layout.js`** — pass `isMarketingHost`; `/` public on
   marketing host, gated on app host (§3.2b). The one required app-internal change.
3. **`/landing` → `/` canonicalization** — 308 on both hosts toward the correct
   canonical (marketing root on www).
4. **App "open PRIM" links → app subdomain.** Single source of truth via
   `NEXT_PUBLIC_SITE_URL=https://app.primtracker.com`, with these updated:
   - `src/lib/welcomeEmails.js:24` `APP_URL`.
   - `src/app/api/reminders/route.js:209` link + `:375` push `url`.
   - `src/app/api/push/test/route.js:50` push `url`.
   - `src/lib/slack.js:65` `announcementBlocks` fallback `url` — **fix the fallback
     itself** (drives the admin broadcast link), not just the
     `admin/broadcast/route.js:59` caller.
   - `scripts/announce-deploy.mjs:47` — the auto **deploy-announcer** builds its
     Slack blocks INLINE (it does NOT call `announcementBlocks`, so the slack.js
     fix does not reach it; the `slack.js:57` "used by both" comment is stale). Its
     hardcoded `www` "Open PRIM" link → app host (read `NEXT_PUBLIC_SITE_URL`).
   - `src/lib/tickets.mjs:10,34` owner support-ticket emails linking `${SITE}/admin?ticket=` →
     app host (and rely on the `/admin` query-preserving redirect in §3.2).
   - Config routes (`ringy/benepath/blast/webforms config`) already read
     `NEXT_PUBLIC_SITE_URL` → new webhook URLs display as `app.`; **old `www` URLs
     keep working** (§3.4).
   - Origin-based routes (`stripe/*`, `email/send`, `admin/impersonate`) self-correct
     to the request origin (now the app host); only their hardcoded `www` fallbacks
     get updated.
5. **Marketing CTAs** (`src/app/landing/page.jsx`): "Sign in" (`:88`) →
   `https://app.primtracker.com`; "Start free trial" (`:89,135,921,1065,1169`) →
   `https://app.primtracker.com/pricing`. Build from a marketing-side
   `NEXT_PUBLIC_APP_URL` constant (not scattered literals).
   - **Pricing-page → sign-up CTA (owner-confirmed funnel):** `app.primtracker.com/pricing`
     must carry a clear "Get started / Sign up" button that opens the app in
     **sign-up mode**. Target: the app root with a sign-up hint (`/?signup=1`) —
     the existing paywall path already uses `/?signup=1` (`PaywallGate.jsx`), so
     `SignInScreen`/`AuthGate` should honor that param to default `mode='signup'`
     (add the param read if not already present). Full funnel: marketing "Start
     free trial" → `app./pricing` → "Get started" → `app./?signup=1` (sign-up).
6. **Logout** → app sign-in screen (`app.primtracker.com/`), owner-confirmed.
7. **`noindex` the app subdomain** — emit `X-Robots-Tag: noindex` from middleware
   when host = app; marketing stays indexable. **New (greenfield):** add
   `robots.(txt|ts)` + a canonical/OG on the marketing host (none exist today;
   `layout.js` has one generic metadata block). Scope this to "point crawlers at
   the marketing host" — not a full SEO pass.
8. **Env** — `NEXT_PUBLIC_SITE_URL` (app origin) + `NEXT_PUBLIC_APP_URL`
   (marketing→app links). In the deploy checklist.

## 5. Owner (external) steps — click-by-click, delivered with the plan

1. **DNS** (registrar): add the record Vercel shows — typically
   `CNAME  app  →  cname.vercel-dns.com`.
2. **Vercel:** add `app.primtracker.com` to the `primtracker` project; set env
   `NEXT_PUBLIC_SITE_URL` + `NEXT_PUBLIC_APP_URL` = `https://app.primtracker.com`
   (Production). Confirm the existing **apex→www** redirect targets the apex only
   and does not capture `app.primtracker.com`.
3. **Supabase → Authentication → URL Configuration:** Site URL =
   `https://app.primtracker.com`; add `https://app.primtracker.com/**` to Redirect
   URLs (covers signup-confirmation email — verified there is **no** `emailRedirectTo`
   override in the `signUp` call, so it follows Site URL). Keep `www.primtracker.com`
   in the list during transition. (No password-reset flow exists today, so nothing
   to migrate there.)

## 6. Rollout sequence (no lock-outs)

1. Merge code (middleware + host-aware AuthGate support both hosts; until `app.` DNS
   exists the app still answers on `www`, so the app-host branch is simply not hit).
2. Owner adds DNS `app` + Vercel domain + env → `app.primtracker.com` live.
3. Verify on `app.` BEFORE touching Supabase: sign-in, an `app.` webhook POST 200,
   an old `www.` webhook POST 200, in-app upgrade → Stripe checkout → return.
4. Owner flips Supabase Site URL / Redirect URLs to the app host; verify
   signup-confirmation email lands on `app.`.
5. Flip marketing host root to landing (rewrite + host-aware AuthGate) so `www/`
   shows marketing; verify logged-out `www/` = landing (not sign-in wall).
6. Announce (What's-New + email): "the app moved to app.primtracker.com — sign in
   again."

## 7. Consequences / risks

- **One-time re-login for every agent** (owner-accepted). Per-origin sessions do not
  carry `www`→`app`. Data untouched. Mitigation: What's-New + email at cutover.
- **Pre-cutover confirmation email opened post-cutover** (Site URL was `www`) lands
  on `www/` = marketing and sets a session on the now-dead `www` origin; self-heals
  on next sign-in at `app.`. Note it in the What's-New.
- **Ordering:** flip Supabase only AFTER `app.` is verified (avoids confirmation
  emails 404-ing). Checkout verified in §6 step 3 before any Supabase change.
- **Webhook continuity:** old `www` URLs stay valid (§3.4); only newly-displayed
  URLs use `app.`.
- **Vercel Hobby** builds can queue on busy days; confirm the cutover deploy reaches
  READY before the DNS/Supabase steps.

## 8. Verification plan

- **Automated:** `npm test` (baseline 422), `npm run build` clean, no new lint. Pure-
  function host-classification test (host → app|marketing, incl. preview override).
- **Rendered test (required by Blocker 1):** logged-out request, marketing host, `/`
  → asserts landing markup renders, NOT `<SignInScreen/>`. And app host `/` logged-out
  → sign-in card (still gated).
- **Manual (post-cutover):** marketing at `www/`; app at `app./`; sign-in +
  signup-confirm resolve on `app.`; a logged-in **upgrade → Stripe checkout →
  success return** completes on the app host; an `app.` and a legacy `www.` webhook
  both 200; marketing CTAs land on `app.` (sign-in / pricing); logout → app sign-in;
  `X-Robots-Tag: noindex` present on `app.`, absent on `www.`.
- **Blast safety:** `scripts/blast-burst-smoketest.mjs` against a webhook TEST token.

## 9. Decisions (assumption ledger)

- Reuse existing `/landing` as marketing homepage (no content redesign).
- Subdomain over `/app` path (owner).
- Keep-it-simple sessions: one-time re-login, no cookie/SSR auth change, static
  marketing (owner).
- Logout → app sign-in screen (owner-confirmed).
- `/api` + static email assets served on both hosts (owner-confirmed).
- **`/pricing` stays on the app host** (checkout needs the app-origin session).

## 10. Resolved / plan-phase notes

- **RESOLVED (owner):** "Start free trial" → `app.primtracker.com/pricing`, and the
  pricing page carries a "Get started / Sign up" button → app sign-up (`/?signup=1`).
  Full funnel locked in §4.5.
- `noindex` mechanism: `X-Robots-Tag` header via middleware (host-aware, simplest)
  — adopted; confirm no conflict with existing `layout.js` metadata.
- robots/sitemap/canonical are net-new files — keep minimal (crawler → marketing host).
