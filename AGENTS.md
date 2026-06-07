<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shipping a user-facing feature

When a NEW user-facing feature ships, ALWAYS do BOTH of these (Juan's standing rule):

1. **In-app "What's New" bell** — add an entry at the TOP of the `ANNOUNCEMENTS` array in `src/lib/announcements.js` (id `YYYY-MM-DD-slug`, emoji, title, body, and a `cta` to the relevant view). This is non-negotiable for every new feature.
2. **Slack** — announce to the PRIM channel via an `[announce]`-tagged deploy: an empty commit whose subject is `[announce] <Headline> | <body>` (the `postbuild` script `scripts/announce-deploy.mjs` posts it). Routine/internal commits stay untagged so the channel isn't spammed.

Keep both messages HIPAA-safe (no client names/PHI; ACA WRAP excluded).

# Frontend / design guide (PRIM "Refined Cool-Tech")

PRIM's committed visual direction. Full reference: `Prompt-Library/frontend-architect.md` (the "no AI slop" guide). Apply these to all UI work, especially public/marketing pages:

- **Archetype:** SaaS/Tech (Cool-Tech), dark. Near-black base (`#070B17` landing / app dark mode), Geist font (keep — do NOT use Inter/Roboto/Open Sans/Arial).
- **Commit to ONE accent.** PRIM's accent is **indigo `#6366F1`**. Do NOT mix violet + pink + indigo as a "rainbow" — that's the generic-AI tell. Emerald `#10B981` is allowed ONLY as a semantic positive/money color (KPIs, checkmarks), never decoration.
- **No "AI slop" tells:** no floating blurred orbs/blobs as decoration (use one restrained accent glow + a subtle grid instead); no rainbow gradient headlines (solid high-contrast text, optionally one accent-highlighted keyword); no Stripe-2020 indigo→violet gradients on buttons (solid single-accent with real hover/active); avoid the default "hero with app mockup + gradient glow" cliché — if a product preview is used, keep it clean (subtle border + accent edge-light).
- **System:** 8px spacing grid (multiples: 8/16/24/32/48/64/96/128), generous section spacing (96px+), Lucide icons (not emoji in UI), real hover/focus/active states, 4.5:1 contrast, semantic HTML.
