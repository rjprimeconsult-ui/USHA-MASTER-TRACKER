# Checkpoint — 2026-06-26 (continue from home)

**Branch:** `main` · **HEAD = live = `8f7ef57`** · working tree clean, pushed to origin.
Pull `main` at home and you're current. Prior detail: [docs/session-handoff-2026-06-22.md](session-handoff-2026-06-22.md).

## State: everything shipped + deployed
- **Blasts feature — complete.** Native Ringy auto-capture via the atomic `blast_counters` counter (validated at 2,002), manual "Log a blast" for TextDrip, send time, per-row edit + delete, and **per-agent "Your blast tags"** (exact-match, so any agent uses their own Ringy tag — added 06-23). Setup panel rewritten to clean step-by-step (06-23); old skill Posting-URL removed (it was the wrong-URL trap).
- **Follow-up date picker fixed** — the LogTouchSheet "Custom" reminder picker was rendering behind the `z-[70]` modal; `DateTimePicker` portal z-index raised 60 → 90.

## SQL run in Supabase (production) — all applied
- `supabase/blast-counters-migration.sql` — counter table + `increment_blast` RPC + RLS.
- `supabase/blast-counters-edit-migration.sql` — `notes` + `range_start` + `range_end` columns + UPDATE RLS policy (for editing Ringy rows). Re-run if range columns are ever missing (idempotent).

## Legal / compliance (lives in OneDrive, NOT this repo)
Folder: `OneDrive/Desktop/PRIM HIPAA BAAs Requests/` — 7 `.md` + 7 `.pdf`, all reviewed 2026-06-23.
- **Compliance checklist** (`00b-compliance-checklist`) — full roadmap.
- **BAA drafts re-tiered:** Required = **Supabase, Anthropic, Vercel** · Conditional = Resend (skip if no PHI in email) · Likely-skip = TextDrip (agent's platform). Stripe/Ringy/Benepath/Slack/push excluded by design.
- **Entity exists:** R&J Prime Consultancy LLC.
- **Top next move:** hire a SaaS/privacy attorney (TCPA + HIPAA) and walk in with that folder.

## Open / next (none blocking)
- Roll out the per-agent Ringy setup to all agents (each: add their tag under "Your blast tags" + point the Ringy Automated Action at their webhook URL with the `disposition` field).
- One stuck agent's fix: they use a custom tag `CMPGN-REPURPOSE` — add it under their Ringy "Your blast tags."
- Legal: attorney → BA ruling → ToS/Privacy → sign the 3 core BAAs → trademark + insurance.
- Further out: Calendly → PRIM integration (un-started).
