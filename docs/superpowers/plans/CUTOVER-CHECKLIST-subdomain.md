# Cutover Checklist — Marketing / App Subdomain Split

**What this does:** flips `primtracker.com` (→ `www.primtracker.com`) to the marketing
page and moves the app to `app.primtracker.com`. The code is already merged and is
**inert** until you complete these steps — nothing changes for agents until the final
flag flip. Spec: `docs/superpowers/specs/2026-07-17-marketing-app-subdomain-split-design.md`.

> **The master switch:** env var **`MARKETING_SPLIT_ENABLED`** (Vercel Production).
> UNSET/anything-but-`1` = today's behavior (www = app). Set to `1` = go live.
> **Rollback at any time = delete the var (or set `0`) → instant revert, no redeploy.**

---

## Step 0 — Before you start
- [ ] Confirm the PR is merged and the production deploy is **READY** (Vercel dashboard).
- [ ] With `MARKETING_SPLIT_ENABLED` still unset, sanity-check `www.primtracker.com`
      works exactly as today (agents sign in, app loads). It must — the flag is off.

## Step 1 — DNS (at your domain registrar)
- [ ] Add the record Vercel shows when you add the domain in Step 2 — it is typically:
      **`CNAME`  name `app`  →  value `cname.vercel-dns.com`**
      (Vercel displays the exact record; use whatever it shows.)
- [ ] Wait for it to resolve (usually minutes; can be longer). Check with any DNS
      lookup that `app.primtracker.com` points at Vercel.

## Step 2 — Vercel (Project → Settings)
- [ ] **Domains:** add `app.primtracker.com` to the `primtracker` project. Vercel will
      show the DNS record for Step 1 and verify once DNS resolves.
- [ ] **Environment Variables (Production):**
  - [ ] `NEXT_PUBLIC_SITE_URL` = `https://app.primtracker.com`
  - [ ] `NEXT_PUBLIC_MARKETING_URL` = `https://www.primtracker.com`
  - [ ] **Do NOT set `MARKETING_SPLIT_ENABLED` yet.**
  - [ ] After setting these two, **redeploy** (or trigger a deploy) so they take effect.
- [ ] **Redirects:** confirm the existing apex→www redirect targets only the apex
      (`primtracker.com` → `www.primtracker.com`) and does NOT capture `app.`.

## Step 3 — Verify the app on the new subdomain (flag still OFF)
With the flag off, `app.primtracker.com` should already serve the app (its host always
classifies as the app). Verify BEFORE touching Supabase:
- [ ] `https://app.primtracker.com` → the app sign-in screen loads.
- [ ] `https://app.primtracker.com/?signup=1` → opens in **sign-up** mode ("Create your account").
- [ ] Sign in with a test account → the app loads normally.
- [ ] **Webhooks both work:** POST a test to a **new** `https://app.primtracker.com/api/webforms/webhook/<your-token>`
      AND to an existing `https://www.primtracker.com/api/...` URL → both return 200.
      (Existing pasted webhook URLs must keep working — this confirms it.)
- [ ] **Checkout round-trip:** as a logged-in agent, start an upgrade → Stripe checkout
      opens → complete a test → you return to the app on `app.primtracker.com`.
- [ ] `https://www.primtracker.com` STILL serves the app (flag off) — unchanged for agents.

## Step 4 — Supabase (Authentication → URL Configuration)
- [ ] **Site URL** → `https://app.primtracker.com`
- [ ] **Redirect URLs** → add `https://app.primtracker.com/**` (keep `https://www.primtracker.com/**`
      in the list during transition).
- [ ] Verify: create a brand-new test signup → the confirmation email link lands on
      `app.primtracker.com` (not the marketing page).

## Step 5 — THE FLIP (go live)
- [ ] In Vercel Production, set **`MARKETING_SPLIT_ENABLED` = `1`** → redeploy.
- [ ] Verify, logged OUT:
  - [ ] `https://www.primtracker.com/` → the **marketing landing page** (not a login form).
  - [ ] Marketing "Sign in" → `app.primtracker.com` (sign-in).
  - [ ] Marketing "Start free trial" → `app.primtracker.com/pricing`; the "Create your
        account" link → sign-up.
  - [ ] `https://www.primtracker.com/pricing` → redirects to `app.primtracker.com/pricing`.
  - [ ] `https://app.primtracker.com/` → the app (sign-in), reachable.
- [ ] Verify a webhook POST to an old `www.` URL still 200s (it should).

## Step 6 — Announce
- [ ] Post the What's-New / email to agents: **"PRIM moved to app.primtracker.com —
      please sign in again."** (Every agent must re-login once: sessions are stored
      per-domain, so the move to the new subdomain signs everyone out one time. Their
      data is untouched.)
- [ ] Tell agents to update any bookmark from `primtracker.com` to `app.primtracker.com`
      (though `primtracker.com` now shows the marketing page with a Sign-in button).

## Rollback (if anything looks wrong after Step 5)
- [ ] Delete `MARKETING_SPLIT_ENABLED` (or set `0`) in Vercel → redeploy. `www` instantly
      reverts to serving the app. DNS + the `app.` domain can stay; they do no harm with
      the flag off. No code change needed.

---

### Notes
- **Order matters:** do NOT set `MARKETING_SPLIT_ENABLED=1` until `app.` is verified
  (Step 3) and Supabase is flipped (Step 4). Flipping early would send www visitors to
  marketing while the app subdomain / auth aren't ready.
- **One-time re-login is expected and unavoidable** with a domain move (per-origin
  sessions). It is not a bug.
- The Next 16 `middleware.js` filename shows a deprecation notice (rename to `proxy.js`)
  — non-blocking; the middleware works. Optional future cleanup.
