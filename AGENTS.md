<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

**Gotcha that builds clean but fails at runtime:** dynamic route `params` are **async** — you MUST `await` them. `export async function POST(req, ctx) { const { token } = await ctx.params; }`. Reading `ctx.params.token` synchronously yields `undefined`, which passes `next build` but silently breaks the route in production (this dropped every Ringy webhook until found). Same for `searchParams` in pages.
<!-- END:nextjs-agent-rules -->

# Shipping a user-facing feature

When a NEW user-facing feature ships, ALWAYS do BOTH of these (Juan's standing rule):

1. **In-app "What's New" bell** — add an entry at the TOP of the `ANNOUNCEMENTS` array in `src/lib/announcements.js` (id `YYYY-MM-DD-slug`, emoji, title, body, and a `cta` to the relevant view). This is non-negotiable for every new feature.
2. **Slack** — announce to the PRIM channel via an `[announce]`-tagged deploy: an empty commit whose subject is `[announce] <Headline> | <body>` (the `postbuild` script `scripts/announce-deploy.mjs` posts it). Routine/internal commits stay untagged so the channel isn't spammed.

Keep both messages HIPAA-safe (no client names/PHI; ACA WRAP excluded).

# Integrating a third-party API (lessons from TextDrip)

Full playbook: `docs/playbooks/third-party-integration-playbook.md`. Read it before any external-API integration. The short version:

1. **Pin the real contract FIRST — don't assume.** Confirm method (don't assume GET), exact endpoint paths, auth header, body param shapes, and response field names before writing the client. Get them from the Postman collection JSON (`curl "https://documenter.gw.postman.com/api/collections/<id>"`), a connected MCP (introspect live), or curl probes. Write them into the spec. (TextDrip pain: wrong method/path/field names that all came back silently blank.)
2. **`next build` passing ≠ working.** Runtime-only failures that pass the build: dynamic-`import()` of a missing module, an undefined var in an untaken path (`getBearer is not defined` cost us ~5 rounds), external method/path/field/format mismatches, non-streaming-vs-streaming Anthropic calls. **Smoke-test the whole chain on a REAL record before handing off**, and make the failure path **show the actual error string** in the toast from the start (the diagnostic toast was what finally pinpointed it).
3. **Reuse PRIM's proven patterns, don't reinvent:** Anthropic structured output = copy `import-prospects-ai`'s `client.messages.stream(...).finalMessage()` + `output_config` json_schema (non-streaming `create` errors; vision + `output_config` HANGS → fenced JSON). Authed client→API = `supabase.auth.getSession()` token. Route auth = bearer→getUser + service-role for `user_kv`; never return/log secrets. Bounded-concurrency batches + `maxDuration=300` for any external paging. UI: toasts portal above modals; detail views read the LIVE record by id (not a stale snapshot); `datetime-local` needs exact `YYYY-MM-DDTHH:mm`.

# Frontend / design guide (PRIM "Refined Cool-Tech")

PRIM's committed visual direction. Full reference: `Prompt-Library/frontend-architect.md` (the "no AI slop" guide). Apply these to all UI work, especially public/marketing pages:

- **Archetype:** SaaS/Tech (Cool-Tech), dark. Near-black base (`#070B17` landing / app dark mode), Geist font (keep — do NOT use Inter/Roboto/Open Sans/Arial).
- **Commit to ONE accent.** PRIM's accent is **indigo `#6366F1`**. Do NOT mix violet + pink + indigo as a "rainbow" — that's the generic-AI tell. Emerald `#10B981` is allowed ONLY as a semantic positive/money color (KPIs, checkmarks), never decoration.
- **No "AI slop" tells:** no floating blurred orbs/blobs as decoration (use one restrained accent glow + a subtle grid instead); no rainbow gradient headlines (solid high-contrast text, optionally one accent-highlighted keyword); no Stripe-2020 indigo→violet gradients on buttons (solid single-accent with real hover/active); avoid the default "hero with app mockup + gradient glow" cliché — if a product preview is used, keep it clean (subtle border + accent edge-light).
- **System:** 8px spacing grid (multiples: 8/16/24/32/48/64/96/128), generous section spacing (96px+), Lucide icons (not emoji in UI), real hover/focus/active states, 4.5:1 contrast, semantic HTML.
