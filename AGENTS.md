<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shipping a user-facing feature

When a NEW user-facing feature ships, ALWAYS do BOTH of these (Juan's standing rule):

1. **In-app "What's New" bell** — add an entry at the TOP of the `ANNOUNCEMENTS` array in `src/lib/announcements.js` (id `YYYY-MM-DD-slug`, emoji, title, body, and a `cta` to the relevant view). This is non-negotiable for every new feature.
2. **Slack** — announce to the PRIM channel via an `[announce]`-tagged deploy: an empty commit whose subject is `[announce] <Headline> | <body>` (the `postbuild` script `scripts/announce-deploy.mjs` posts it). Routine/internal commits stay untagged so the channel isn't spammed.

Keep both messages HIPAA-safe (no client names/PHI; ACA WRAP excluded).
