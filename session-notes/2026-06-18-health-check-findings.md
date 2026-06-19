# App-wide health check — 2026-06-18

> Read-only audit (6 parallel agents) across security, secrets, webhooks, data
> integrity/money math, dependencies/build, and general bugs. **Nothing was
> changed.** This is the punch list to work through later. Severity = my call;
> file:line refs are starting points.

## Bottom line
Security fundamentals are strong (route auth, secret handling, Stripe/Resend
webhook signature verification all solid). Real risks are a few correctness /
data-integrity bugs (one can brick the app, a couple can silently lose data
across devices) and one dependency vuln (`xlsx`) with no clean upstream fix.
No active breach found.

## ✅ Confirmed healthy
- All 40 API routes reviewed: admin routes gate on `profiles.is_admin`; no IDOR
  (caller ownership checked before acting); `email/send` has an open-relay guard;
  cron route fails closed without `CRON_SECRET`.
- Secrets: no leakage, nothing hardcoded, nothing logged, `.env*` gitignored +
  untracked, Anthropic key + user data stay server-side.
- Stripe & Resend webhooks: signature-verified, raw body, timing-safe compare,
  replay guard.

## 🔴 Urgent / Critical
1. **App-brick on one corrupt stored value** — `LeadTracker.jsx:322-628`. Mount
   load has ~14 unguarded `JSON.parse` calls, no outer try/catch; `setLoaded(true)`
   only at the end. One truncated/malformed key (exactly what the storage-quota
   saga could produce) → stuck on loading skeleton forever. Fix: wrap parses or
   `finally { setLoaded(true) }`.
2. **Local build broken** — `web-push` declared in package.json but not installed
   (verified). `npm install` fixes locally. Vercel installs fresh each deploy, so
   production is almost certainly fine — confirm latest deploy went green.

## 🟠 High
3. **Cloud-save failures silently masked** — `storage.js:268/283`. The root-cause-#1
   fix `return cloudOk || localOk` removed the false alarm but now: if cloud write
   fails while local succeeds, app reports success → stale cloud → cross-device data
   loss. No blob-size guard, so a large `leads` blob over the Supabase request limit
   hits this. Need: surface genuine cloud failures + oversize guard.
4. **Deleted leads resurrect across devices** — `LeadTracker.jsx:680/690`. Realtime
   merge calls `mergeArrayStores(prev, cloud)` WITHOUT the baseline arg, so the
   "intentionally deleted" branch never fires. Pass the session baseline Set.
5. **`xlsx` (SheetJS) HIGH vuln, no npm fix** — prototype pollution + ReDoS; parses
   user-uploaded spreadsheets server-side (reachable). Migrate to `@e965/xlsx` fork
   or `exceljs`. Not fixable via `npm audit fix`.
6. **`$NaN` can enter Books** — `BusinessBooksView.jsx`. Non-numeric amount passes
   submit guard (`NaN <= 0` is false) and persists, poisoning CPA/True-Net/ROI sums;
   also renders "NaN" from missing AI-import fields. Guard with `Number.isFinite`.
7. **`dealValue` overwritten (not accumulated) on statement re-import** —
   `statement.js:955`. KPIs were moved to `own_advances_v1` but the field is still
   clobbered and shown per-lead; anything reading `lead.dealValue` mis-counts.

## 🟡 Medium
8. **Phone-only dedup merges distinct people** — `leadDedup.js:96-104` &
   `textdrip.mjs:240` (household sharing a cell, no policy #). Plus **Textdrip sync
   has no in-batch dedup** (`textdrip.mjs:283`) — same duplicate-creation class as
   the earlier explosion, on a new path.
9. **Benepath/Ringy lead webhooks: URL-token auth only, no rate limit** — inherent
   to header-less vendors; tokens are strong + rotatable, but a leaked token lets
   anyone flood one agent's prospects unbounded. Add per-token rate limit + prospect/
   blob cap. Files: `api/benepath/webhook/[token]`, `api/ringy/webhook/[token]`.
10. **`/api/chat` has no auth** — anonymous callers can drive Anthropic spend (every
    other AI route is gated). Cost/abuse, not data exposure.
11. **`next` 16.2.4 → 16.2.9 patch** — App-Router advisories (RSC cache poisoning,
    CSP-nonce XSS, middleware bypass). Same-minor, low-risk bump.
12. **Lint bug-smells** — `attachments.js:66-139` calls hooks inside plain async
    functions (rules-of-hooks, 6×); `ProspectsView.jsx:770` setState inside `useMemo`;
    12 `exhaustive-deps` misses (stale computed values). ~60 other lint errors are
    React-19 compiler noise.

## ⚪ Low / hygiene
- No optimistic-concurrency/version column on `user_kv` writes (lost-update window).
- `mergeStore.mjs:59` compares `updatedAt` as strings (fragile if formats drift).
- `commission.js` accumulates raw floats (sub-cent drift over ~1,500 leads).
- `isEmpty` treats numeric `0` as empty → real `leadCost: 0` overwritten on merge import.
- PDF `withTimeout` only on expenses route, not leads/prospects/statement.
- `ws` transitive HIGH vuln — clean `npm audit fix`.
- `banners/[userId]` unauth read — low by design (semi-public image).

## Suggested order when we pick this up
Quick wins: #1 app-brick guard, #2 `npm install`, #11 Next patch, #6 NaN guard,
#3 surface cloud-save failures. Then #4 delete-resurrection, #7 dealValue, #8 dedup.
Then the bigger one: #5 `xlsx` migration (test across all import paths).
Highest-stakes to not leave sitting in a financial app: #1, #3, #4.
