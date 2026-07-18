# Marketing / App Subdomain Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the marketing page at `www.primtracker.com` and the app at `app.primtracker.com` from one Next.js project, so visitors land on the sales page instead of the login wall.

**Architecture:** Host-based routing via `src/middleware.js` (backed by a pure, unit-tested `hostRouting.mjs`) plus a host-aware `AuthGate` (root `layout.js` reads the host and tells AuthGate whether `/` is public). `/api/*` and static assets stay on both hosts so existing webhooks + email images survive. `/pricing` stays on the app host (checkout needs the app-origin session). Sessions are per-origin → a one-time re-login at cutover (accepted).

**Tech Stack:** Next.js 16 (App Router, middleware, async `next/headers`), React 19, Supabase (client localStorage sessions), Vercel. Pure logic in `.mjs` tested via `node --test` (repo pattern).

**Spec:** `docs/superpowers/specs/2026-07-17-marketing-app-subdomain-split-design.md`

**Guard rail (all tasks):** Do NOT modify `src/app/api/ringy`, `src/app/api/benepath`, `src/app/api/blast`, or `increment_blast`. The middleware `matcher` MUST exclude `/api` so these capture routes are never rewritten/redirected.

---

## Environment variables (used throughout)

- `NEXT_PUBLIC_SITE_URL` = `https://app.primtracker.com` — the **app** origin. Already read by the config routes; now the single source of truth for app-link emails, marketing→app CTAs, and cross-host redirects.
- `NEXT_PUBLIC_MARKETING_URL` = `https://www.primtracker.com` — the **marketing** origin (app→marketing redirects).
- **`MARKETING_SPLIT_ENABLED`** = `1` — **the master flip.** Default OFF. While OFF, `www`/apex classify as the **app** host (today's behavior) so the code is genuinely inert on merge and `www` keeps serving the app. The owner sets it to `1` in Vercel Production as the **FINAL** cutover step, only after `app.` DNS is live + verified + Supabase flipped. This is what prevents a merge from prematurely flipping production and taking the app offline.

Local dev: none required (localhost → app host, behaves exactly as today). Set all three in Vercel Production at cutover (owner step, Task 9); `MARKETING_SPLIT_ENABLED` goes last.

---

## File Structure

**Create:**
- `src/lib/hostRouting.mjs` — pure: `classifyHost(host, opts)` → `'app'|'marketing'`; `routeDecision(role, pathname)` → rewrite/redirect/next. No `next` imports (node-testable).
- `src/lib/hostRouting.test.mjs` — unit tests for the above.
- `src/lib/routeAccess.mjs` — pure: `PUBLIC_ROUTE_PREFIXES`, `isPublicRoute(pathname, opts)`. Shared by AuthGate + tests.
- `src/lib/routeAccess.test.mjs` — unit tests.
- `src/middleware.js` — thin wrapper: classify host (with preview override), apply `routeDecision`, set `x-prim-role` request header for the layout, set `X-Robots-Tag: noindex` on the app host.
- `src/app/robots.js` — crawler directives pointing at the marketing host.
- `docs/superpowers/plans/CUTOVER-CHECKLIST-subdomain.md` — the owner's DNS/Vercel/Supabase steps + verification.

**Modify:**
- `src/app/layout.js` — become `async`, read `x-prim-role` (fallback `classifyHost`), pass `isMarketingHost` to AuthGate.
- `src/components/auth/AuthGate.jsx` — accept `isMarketingHost`; use `routeAccess.isPublicRoute`; `SignInScreen` reads `?signup=1` → default sign-up mode.
- `src/lib/welcomeEmails.js` — `APP_URL` from `NEXT_PUBLIC_SITE_URL`.
- `src/app/api/reminders/route.js` — "Open PRIM" link (`:209`) + push `url` (`:375`) → app origin.
- `src/app/api/push/test/route.js` — push `url` (`:50`) → app origin.
- `src/lib/slack.js` — `announcementBlocks` fallback `url` (`:65`) → app origin.
- `scripts/announce-deploy.mjs` — inline "Open PRIM" link (`:47`) → app origin.
- `src/lib/tickets.mjs` — admin deep-link base (`:10,34`) → app origin.
- `src/app/api/admin/broadcast/route.js`, `stripe/*`, `email/send/route.js`, `admin/impersonate/route.js` — hardcoded `www` fallbacks → app origin (origin-based logic unchanged).
- `src/app/landing/page.jsx` — "Sign in" → app root; "Start free trial" → `app./pricing`.
- `src/app/pricing/page.jsx` — ensure a logged-out visitor gets a clear "Get started / Sign up" path → `app./?signup=1`.

---

## Task 0: Branch + baseline

**Files:** none (setup)

- [ ] **Step 1:** From up-to-date `main`, create the feature branch.

```bash
cd "C:/Users/juant/OneDrive/Desktop/AI TREJO/CPA TRACKER FODLER/USHA-MASTER-TRACKER"
git checkout main && git pull origin main -q
git checkout -b feat/marketing-app-subdomain-split
```

- [ ] **Step 2:** Confirm the baseline is green (so any later failure is ours).

Run: `npm test` → Expected: `pass 422 … fail 0`.
Run: `npm run build` → Expected: compiles, "skip: VERCEL_ENV=local".

---

## Task 1: `hostRouting.mjs` (pure host classification + route decisions)

**Files:**
- Create: `src/lib/hostRouting.mjs`
- Test: `src/lib/hostRouting.test.mjs`

- [ ] **Step 1: Write the failing tests.**

```js
// src/lib/hostRouting.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyHost, routeDecision } from './hostRouting.mjs';

test('classifyHost: app subdomain → app', () => {
  assert.equal(classifyHost('app.primtracker.com'), 'app');
});
test('classifyHost: www + apex → marketing ONLY when the split is enabled', () => {
  assert.equal(classifyHost('www.primtracker.com', { marketingSplitEnabled: true }), 'marketing');
  assert.equal(classifyHost('primtracker.com', { marketingSplitEnabled: true }), 'marketing');
});
test('classifyHost: www + apex → app when the split is OFF (default — inert on merge)', () => {
  assert.equal(classifyHost('www.primtracker.com'), 'app');
  assert.equal(classifyHost('primtracker.com'), 'app');
});
test('classifyHost: host header with port is normalized', () => {
  assert.equal(classifyHost('www.primtracker.com:443', { marketingSplitEnabled: true }), 'marketing');
});
test('classifyHost: localhost → app (dev unchanged)', () => {
  assert.equal(classifyHost('localhost:3000'), 'app');
  assert.equal(classifyHost('127.0.0.1:55525'), 'app');
});
test('classifyHost: preview → app by default, marketing only with override', () => {
  assert.equal(classifyHost('prim-git-x.vercel.app'), 'app');
  assert.equal(classifyHost('prim-git-x.vercel.app', { previewAsMarketing: true }), 'marketing');
});
test('classifyHost: empty/unknown → app (safe default)', () => {
  assert.equal(classifyHost(''), 'app');
});

test('routeDecision marketing: / rewrites to /landing', () => {
  assert.deepEqual(routeDecision('marketing', '/'), { type: 'rewrite', to: '/landing' });
});
test('routeDecision marketing: /landing 308 → /', () => {
  assert.deepEqual(routeDecision('marketing', '/landing'), { type: 'redirect', to: '/', status: 308 });
});
test('routeDecision marketing: /pricing 308 → app host', () => {
  assert.deepEqual(routeDecision('marketing', '/pricing'), { type: 'redirect', to: 'APP:/pricing', status: 308 });
});
test('routeDecision marketing: /admin 308 → app host, path preserved', () => {
  assert.deepEqual(routeDecision('marketing', '/admin'), { type: 'redirect', to: 'APP:/admin', status: 308 });
});
test('routeDecision marketing: legal pages pass through', () => {
  assert.deepEqual(routeDecision('marketing', '/privacy'), { type: 'next' });
  assert.deepEqual(routeDecision('marketing', '/terms'), { type: 'next' });
});
test('routeDecision app: /landing 308 → marketing root', () => {
  assert.deepEqual(routeDecision('app', '/landing'), { type: 'redirect', to: 'MKT:/', status: 308 });
});
test('routeDecision app: app root passes through', () => {
  assert.deepEqual(routeDecision('app', '/'), { type: 'next' });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test src/lib/hostRouting.test.mjs` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `hostRouting.mjs`.**

```js
// src/lib/hostRouting.mjs
// Pure host classification + middleware route decisions for the marketing/app
// subdomain split. NO `next` imports so it runs under `node --test`.
// Cross-host redirect targets are returned as `APP:<path>` / `MKT:<path>`
// sentinels; middleware resolves them to absolute URLs via env (keeps this pure).

export function classifyHost(rawHost, { previewAsMarketing = false, marketingSplitEnabled = false } = {}) {
  const host = String(rawHost || '').toLowerCase().split(':')[0].trim();
  if (!host) return 'app';
  if (host === 'app.primtracker.com') return 'app';
  if (host === 'www.primtracker.com' || host === 'primtracker.com') {
    // Master flip (MARKETING_SPLIT_ENABLED): OFF → www keeps serving the app, so
    // merging is inert; ON (final cutover step) → www becomes marketing.
    return marketingSplitEnabled ? 'marketing' : 'app';
  }
  if (host.endsWith('.vercel.app')) return previewAsMarketing ? 'marketing' : 'app';
  return 'app'; // localhost / 127.0.0.1 / unknown → app (dev unchanged, safe default)
}

export function routeDecision(role, pathname) {
  // /api, /_next, static, /email-assets are excluded by the middleware matcher
  // and never reach here.
  if (role === 'marketing') {
    if (pathname === '/') return { type: 'rewrite', to: '/landing' };
    if (pathname === '/landing') return { type: 'redirect', to: '/', status: 308 };
    if (pathname === '/pricing' || pathname.startsWith('/pricing/')) return { type: 'redirect', to: 'APP:/pricing', status: 308 };
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return { type: 'redirect', to: 'APP:' + pathname, status: 308 };
    return { type: 'next' }; // /privacy, /terms, everything else served as-is
  }
  // role === 'app'
  if (pathname === '/landing' || pathname.startsWith('/landing/')) return { type: 'redirect', to: 'MKT:/', status: 308 };
  return { type: 'next' };
}
```

- [ ] **Step 4: Run to verify pass.** Run: `node --test src/lib/hostRouting.test.mjs` → Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/hostRouting.mjs src/lib/hostRouting.test.mjs
git commit -m "Subdomain split: pure host classification + route decisions (TDD)"
```

---

## Task 2: `routeAccess.mjs` (host-aware public-route decision) + AuthGate refactor

**Files:**
- Create: `src/lib/routeAccess.mjs`, `src/lib/routeAccess.test.mjs`
- Modify: `src/components/auth/AuthGate.jsx:14-19` (replace inline `PUBLIC_ROUTE_PREFIXES` + `isPublicRoute`)

- [ ] **Step 1: Write the failing tests.**

```js
// src/lib/routeAccess.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { isPublicRoute } from './routeAccess.mjs';

test('legal + marketing prefixes are always public', () => {
  for (const p of ['/landing', '/pricing', '/privacy', '/terms']) assert.equal(isPublicRoute(p), true);
});
test('root is gated on the app host', () => {
  assert.equal(isPublicRoute('/', { isMarketingHost: false }), false);
});
test('root is public on the marketing host', () => {
  assert.equal(isPublicRoute('/', { isMarketingHost: true }), true);
});
test('a gated app path stays gated on both hosts', () => {
  assert.equal(isPublicRoute('/admin', { isMarketingHost: true }), false);
  assert.equal(isPublicRoute('/admin', { isMarketingHost: false }), false);
});
test('nested public route inherits', () => {
  assert.equal(isPublicRoute('/landing/x'), true);
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `node --test src/lib/routeAccess.test.mjs` → Expected: FAIL.

- [ ] **Step 3: Implement `routeAccess.mjs`.**

```js
// src/lib/routeAccess.mjs
// Which routes render WITHOUT auth. Shared by AuthGate (client) + tests.
// Pure, no imports, node-testable.
export const PUBLIC_ROUTE_PREFIXES = ['/landing', '/pricing', '/privacy', '/terms'];

export function isPublicRoute(pathname, { isMarketingHost = false } = {}) {
  if (!pathname) return false;
  if (isMarketingHost && pathname === '/') return true; // marketing host: root = landing
  return PUBLIC_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
```

- [ ] **Step 4: Run to verify pass.** Run: `node --test src/lib/routeAccess.test.mjs` → Expected: all pass.

- [ ] **Step 5: Refactor AuthGate to use the shared module (behavior-preserving for now).**

In `src/components/auth/AuthGate.jsx`, delete the inline `PUBLIC_ROUTE_PREFIXES` const and `isPublicRoute` function (lines ~14-19) and import instead:

```jsx
import { isPublicRoute } from '@/lib/routeAccess';
```

Leave the call site `if (isPublicRoute(pathname)) return children;` unchanged for now (Task 4 adds the host arg). `isMarketingHost` defaults false → identical behavior.

- [ ] **Step 6: Verify nothing broke.** Run: `npm test` → Expected: 422 + new tests pass. Run: `npm run build` → Expected: clean.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/routeAccess.mjs src/lib/routeAccess.test.mjs src/components/auth/AuthGate.jsx
git commit -m "Subdomain split: shared host-aware isPublicRoute; AuthGate uses it (TDD)"
```

---

## Task 3: `src/middleware.js` (host routing + role header + noindex)

**Files:**
- Create: `src/middleware.js`

- [ ] **Step 1: Implement the middleware.**

```js
// src/middleware.js
import { NextResponse } from 'next/server';
import { classifyHost, routeDecision } from '@/lib/hostRouting';

const APP_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com';
const MKT_ORIGIN = process.env.NEXT_PUBLIC_MARKETING_URL || 'https://www.primtracker.com';

export function middleware(request) {
  const url = request.nextUrl;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const bareHost = host.toLowerCase().split(':')[0];

  // Preview-only override so the marketing branch is testable before production.
  const isPreview = bareHost.endsWith('.vercel.app');
  const previewAsMarketing = isPreview &&
    (url.searchParams.get('__host') === 'marketing' || process.env.PREVIEW_AS_MARKETING === '1');

  // Master flip: www/apex serve the app until the owner sets this at cutover.
  const marketingSplitEnabled = process.env.MARKETING_SPLIT_ENABLED === '1';

  const role = classifyHost(host, { previewAsMarketing, marketingSplitEnabled });
  const decision = routeDecision(role, url.pathname);

  // The layout reads this to stay in lock-step with the middleware's role
  // decision (incl. the preview override) — no duplicated classification.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-prim-role', role);

  let res;
  if (decision.type === 'rewrite') {
    const to = url.clone();
    to.pathname = decision.to;
    res = NextResponse.rewrite(to, { request: { headers: requestHeaders } });
  } else if (decision.type === 'redirect') {
    let target = decision.to;
    if (target.startsWith('APP:')) target = APP_ORIGIN + target.slice(4);
    else if (target.startsWith('MKT:')) target = MKT_ORIGIN + target.slice(4);
    else target = new URL(target, url).toString();
    const redirectUrl = new URL(target);
    if (redirectUrl.search === '') redirectUrl.search = url.search; // preserve query (e.g. /admin?ticket=)
    res = NextResponse.redirect(redirectUrl, decision.status || 308);
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (role === 'app') res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}

export const config = {
  // Run on everything EXCEPT api, next internals, static assets, email-assets,
  // and crawler files — so webhooks + email images resolve identically on both hosts.
  matcher: ['/((?!api|_next/static|_next/image|email-assets|favicon.ico|robots.txt|sitemap.xml).*)'],
};
```

- [ ] **Step 2: Build (middleware compiles + matcher valid).** Run: `npm run build` → Expected: clean; build output lists a `ƒ Middleware`.

- [ ] **Step 3: Local smoke (dev host = app; behavior unchanged).** Start dev, confirm `/` still serves the app locally (localhost → app), `/landing` still serves marketing, `/api/version` still 200. (Use the preview override URL param locally if you want to see the marketing rewrite: append `?__host=marketing` — note: only honored on `*.vercel.app`, so on localhost use a temporary `PREVIEW_AS_MARKETING=1` in `.env.local` to eyeball it, then remove.)

- [ ] **Step 4: Commit.**

```bash
git add src/middleware.js
git commit -m "Subdomain split: host-based middleware (rewrite/redirect + role header + noindex)"
```

---

## Task 4: Host-aware `layout.js` + AuthGate consumes `isMarketingHost`

**Files:**
- Modify: `src/app/layout.js` (make async, read role), `src/components/auth/AuthGate.jsx` (accept prop)

- [ ] **Step 1: Make `layout.js` async and pass the role.**

```jsx
// src/app/layout.js — add imports
import { headers } from 'next/headers';
import { classifyHost } from '@/lib/hostRouting';

// ...replace the component:
export default async function RootLayout({ children }) {
  const h = await headers(); // Next 16: headers() is async
  const role = h.get('x-prim-role') // set by middleware (authoritative — honors the flag + preview override)
    || classifyHost(h.get('x-forwarded-host') || h.get('host') || '',
         { marketingSplitEnabled: process.env.MARKETING_SPLIT_ENABLED === '1' }); // safety-net fallback
  const isMarketingHost = role === 'marketing';
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ThemeProvider>
            <AuthGate isMarketingHost={isMarketingHost}>{children}</AuthGate>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: AuthGate accepts + uses the prop.**

```jsx
// src/components/auth/AuthGate.jsx
export default function AuthGate({ children, isMarketingHost = false }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  if (isPublicRoute(pathname, { isMarketingHost })) return children;
  // ...rest unchanged
```

- [ ] **Step 3: Build.** Run: `npm run build` → Expected: clean (async layout supported).

- [ ] **Step 4: Verify on a preview deploy (the real test for Blocker 1).** After pushing (or via `vercel` preview), open `https://<preview>.vercel.app/?__host=marketing` **logged out** → assert the **landing page** renders, NOT the sign-in card. Open the same preview `/` without the flag → app sign-in card (still gated). Capture both. (This exercises the middleware rewrite + host-aware AuthGate together — the combination the spec calls out as untestable by unit tests alone.)

- [ ] **Step 5: Commit.**

```bash
git add src/app/layout.js src/components/auth/AuthGate.jsx
git commit -m "Subdomain split: host-aware AuthGate (marketing root is public, app root gated)"
```

---

## Task 5: Sign-up deep-link (`?signup=1` opens the app in sign-up mode)

**Files:**
- Modify: `src/components/auth/AuthGate.jsx` (`SignInScreen`, `:66`)

- [ ] **Step 1:** In `SignInScreen`, seed `mode` from the URL so `app./?signup=1` opens sign-up.

```jsx
import { usePathname, useSearchParams } from 'next/navigation';
// inside SignInScreen():
const searchParams = useSearchParams();
const [mode, setMode] = useState(searchParams.get('signup') === '1' ? 'signup' : 'signin');
```

(If `useSearchParams` requires a Suspense boundary in this app's build, fall back to reading `new URLSearchParams(window.location.search)` inside a `useEffect` that calls `setMode('signup')` — verify which the build accepts.)

- [ ] **Step 2: Build.** Run: `npm run build` → Expected: clean (watch for a "useSearchParams should be wrapped in Suspense" error; if so use the `useEffect` fallback).

- [ ] **Step 3: Verify.** On preview/local, open `/?signup=1` logged-out → the card shows "Create your account" (sign-up mode). Open `/` → "Welcome back" (sign-in).

- [ ] **Step 4: Commit.**

```bash
git add src/components/auth/AuthGate.jsx
git commit -m "Subdomain split: ?signup=1 opens the app in sign-up mode (marketing funnel)"
```

---

## Task 6: Point app-link touchpoints at the app origin

**Files (modify):** `src/lib/welcomeEmails.js:24`, `src/app/api/reminders/route.js:209,375`, `src/app/api/push/test/route.js:50`, `src/lib/slack.js:65`, `scripts/announce-deploy.mjs:47`, `src/lib/tickets.mjs:10,34`, `src/app/api/admin/broadcast/route.js:59`, and the `www` fallbacks in `stripe/create-checkout-session`, `stripe/portal`, `email/send`, `admin/impersonate`.

- [ ] **Step 1:** Introduce one helper and use it everywhere an "open the app" link is built.

```js
// src/lib/appUrl.mjs
export function appUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com';
}
```

- [ ] **Step 2:** Replace each hardcoded `https://www.primtracker.com` / `https://primtracker.com` **app** link with `appUrl()` (or `${process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com'}` where importing is awkward, e.g. the standalone `scripts/announce-deploy.mjs`). Specifically:
  - `welcomeEmails.js:24` `const APP_URL = appUrl();`
  - `reminders/route.js:209` link href + `:375` push `url`.
  - `push/test/route.js:50` push `url`.
  - `slack.js:65` `announcementBlocks` fallback `url`.
  - `announce-deploy.mjs:47` inline "Open PRIM" url.
  - `tickets.mjs:10,34` admin link base (keep `/admin?ticket=${id}` path).
  - `admin/broadcast/route.js:59` `url`.
  - `stripe/*`, `email/send`, `admin/impersonate`: change only the **fallback literal** in `req.headers.get('origin') || '<here>'` from `www` to `appUrl()` — the origin-based primary path is unchanged.
  - **Leave static-asset URLs alone** (`outreachEmails.js:25` `email-assets/…`, `slack.js:18` icon, `postSaleHtml.js` asset URLs) — they resolve on both hosts (matcher-excluded) and living on the stable marketing brand domain is fine.

- [ ] **Step 3: Verify no app-link `www` references remain.** Run:
`grep -rniE "https://(www\.)?primtracker\.com" src/ scripts/ | grep -viE "email-assets|dear-doctor|/email-assets|icon|test@|mailto|Notifications are blocked|Generated by PRIM|contact\.primtracker"`
→ Expected: only intentional/static leftovers; no app-entry links.

- [ ] **Step 4: Test + build.** Run: `npm test` (422+ pass) and `npm run build` (clean).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "Subdomain split: app-open links (emails/push/slack/tickets/deploy) use app origin"
```

---

## Task 7: Marketing CTAs → app host; pricing → sign-up

**Files:** `src/app/landing/page.jsx` (`:88,89,135,921,1065,1169`), `src/app/pricing/page.jsx`

- [ ] **Step 1:** In `landing/page.jsx`, add a top-of-module constant and repoint CTAs.

```jsx
const APP = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com';
// "Sign in" (currently href="/") → `${APP}`
// each "Start free trial" (href="/pricing") → `${APP}/pricing`
```

- [ ] **Step 2:** In `pricing/page.jsx`, guarantee a logged-out visitor has an explicit path into sign-up. If `handleSubscribe` already routes logged-out users to `/?signup=1`, add a visible secondary link "Already convinced? Create your account →" → `/?signup=1` (relative → stays on app host). Confirm the trial buttons for a logged-out visitor reach `/?signup=1` (add that redirect in `handleSubscribe`'s no-session branch if missing).

- [ ] **Step 3: Verify (preview).** From the marketing preview: "Sign in" → app root; "Start free trial" → app `/pricing`; on `/pricing` logged-out, the get-started path → `/?signup=1` (sign-up card). Screenshot the funnel.

- [ ] **Step 4: Build + commit.**

```bash
npm run build
git add src/app/landing/page.jsx src/app/pricing/page.jsx
git commit -m "Subdomain split: marketing CTAs → app host; pricing → sign-up funnel"
```

---

## Task 8: `noindex` app host + `robots.js`

**Files:** Create `src/app/robots.js` (the app-host `X-Robots-Tag` is already set in Task 3 middleware).

- [ ] **Step 1:** Add robots pointing crawlers at the marketing host.

```js
// src/app/robots.js
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin'] }],
    // Sitemap/host reference the marketing origin (canonical brand domain).
    host: 'https://www.primtracker.com',
  };
}
```

- [ ] **Step 2: Build.** Run: `npm run build` → Expected: clean; `/robots.txt` route present.

- [ ] **Step 3: Commit.**

```bash
git add src/app/robots.js
git commit -m "Subdomain split: robots points crawlers at the marketing host"
```

---

## Task 9: Env docs + owner cutover checklist

**Files:** Create `docs/superpowers/plans/CUTOVER-CHECKLIST-subdomain.md`; update `.env.example` if present.

- [ ] **Step 1:** Write the owner checklist (click-by-click), covering:
  - **DNS:** add the record Vercel shows — typically `CNAME app → cname.vercel-dns.com`.
  - **Vercel:** add `app.primtracker.com` to the project; set Production env `NEXT_PUBLIC_SITE_URL=https://app.primtracker.com` and `NEXT_PUBLIC_MARKETING_URL=https://www.primtracker.com`; confirm the apex→www redirect targets the apex only (not `app.`).
  - **Supabase → Auth → URL Configuration:** Site URL `https://app.primtracker.com`; add `https://app.primtracker.com/**` to Redirect URLs; keep `www` during transition.
  - **Verification order** (mirror §6 of the spec): merge/deploy (inert — `MARKETING_SPLIT_ENABLED` OFF, `www` still serves the app) → add `app.` DNS + Vercel domain + `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_MARKETING_URL` → verify `app.` host live (sign-in, new `app.` + legacy `www.` webhooks 200, in-app upgrade → Stripe checkout round-trip) → flip Supabase → signup-confirmation lands on app → **FINAL STEP: set `MARKETING_SPLIT_ENABLED=1` in Vercel Production** → `www/` flips to the landing page. Verify logged-out `www/` shows landing and the app is reachable at `app./`.
  - **Rollback:** if anything is wrong after the flip, unset `MARKETING_SPLIT_ENABLED` (or set `0`) → `www` instantly reverts to serving the app. One-variable, no redeploy of code.
  - **Announce:** What's-New + email — "the app moved to app.primtracker.com, sign in again."

- [ ] **Step 2:** Add the two env vars (with the app/marketing values as comments) to `.env.example` if it exists; otherwise note them in the checklist only.

- [ ] **Step 3: Commit.**

```bash
git add docs/superpowers/plans/CUTOVER-CHECKLIST-subdomain.md .env.example
git commit -m "Subdomain split: owner cutover checklist (DNS/Vercel/Supabase) + env docs"
```

---

## Task 10: Full verification + PR

**Files:** none (verification)

- [ ] **Step 1: Deterministic gates.** Run: `npm test` (expect 422 baseline + the new host/route tests, 0 fail), `npm run build` (clean), `npm run lint` (no NEW errors vs baseline).

- [ ] **Step 2: Blast safety.** Run `node scripts/blast-burst-smoketest.mjs` against a webhook TEST token → expect 0 non-200s (confirms the capture path is untouched; the matcher excludes `/api`).

- [ ] **Step 3: Preview manual verification** (the cross-cutting behaviors unit tests can't cover):
  - `https://<preview>.vercel.app/?__host=marketing` logged-out → landing (not sign-in).
  - `https://<preview>.vercel.app/` → app sign-in; `/?signup=1` → sign-up mode.
  - `/api/version` 200 on the preview; a POST to a `…/api/webforms/webhook/<test>` 200.
  - `X-Robots-Tag: noindex` present on the app-role response, absent on the marketing-role response (`curl -I`).

- [ ] **Step 4: Push + open PR** (do NOT merge — owner merges; and the external DNS/Supabase steps happen after merge per the checklist).

```bash
git push -u origin feat/marketing-app-subdomain-split
```

Open the PR (title: "Marketing / app subdomain split"), body linking the spec + the cutover checklist, and an explicit note: **merging deploys the code but it is genuinely inert — `MARKETING_SPLIT_ENABLED` defaults OFF, so `www.primtracker.com` keeps serving the app exactly as today. Nothing flips until the owner completes the cutover checklist and sets `MARKETING_SPLIT_ENABLED=1` as the final step.**

- [ ] **Step 5:** Report to owner: code ready, PR open, and the ordered DNS/Vercel/Supabase checklist to execute for go-live.

---

## Notes for the executor

- **TDD applies to the pure `.mjs` modules** (Tasks 1, 2) — real failing-test-first. UI/middleware/env tasks are verified by build + preview browser checks (the repo has no React test harness; do not invent one).
- **Never** touch the blast capture routes or remove `/api` from the matcher.
- The code is **safe to merge before cutover** — but ONLY because of the `MARKETING_SPLIT_ENABLED` flag (default OFF). With it off, `classifyHost` returns `'app'` for `www`/apex, so `www.primtracker.com` keeps serving the app exactly as today; the marketing branch is never hit in production until the owner sets the flag as the final cutover step. **Without this flag the merge would immediately flip `www` (the current app host) to marketing and take the app offline — do NOT weaken the flag gate.**
- Reference: spec `docs/superpowers/specs/2026-07-17-marketing-app-subdomain-split-design.md`.
