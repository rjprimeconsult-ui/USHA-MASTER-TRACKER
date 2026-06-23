# Session handoff — 2026-06-22 (Blasts native capture + Log-follow-up fix)

**Live production version:** `3611756` (https://primtracker.com/api/version). Working tree clean, all pushed to `main`.

## Goal
Auto-log Ringy/TextDrip blasts in PRIM whether or not the Cowork skill is used, plus the Blasts-tab polish that followed (send time, edit, lead range). Also fixed a follow-up-log date-picker bug.

## What shipped today (oldest → newest)
1. `fcf1926` — **Ringy native blast capture** (skill-independent) + manual "Log a blast" form. Ringy fires 1 webhook/lead; PRIM detects the repurpose tag and rolls hits into one daily Blasts entry instead of ~2,000 prospects.
2. `76d2d24` — **Fix undercount**: a 2,000 blast logged only 119 because per-lead hits did compare-and-swap on a JSON blob and lost the race. Switched to an **atomic Postgres counter** (`blast_counters` + `increment_blast` RPC). Validated live at **2,002**.
3. `db30d25` — **Hardening** from an adversarial review (6 findings): purge legacy Ringy rows from `blast_log_v1`; reject Ringy at `/api/blast/log`; fail-loud (503 → Ringy retries) instead of silent drop; local-day bucketing; safe delete rollback.
4. `6464d24` — **Send time** surfaced from the counter's `first_at` (also stores `last_at`).
5. `e8e32a7` — **Edit (pencil) button** on every blast row.
6. `753266f` — **Fix**: follow-up-log "Custom" date picker was rendering *behind* the `z-[70]` modal (`DateTimePicker` portal was `z-60`); raised to `z-90`.
7. `3611756` — **Lead range editable on Ringy rows** (added `range_start`/`range_end` columns).

## Architecture (the important part)
- **Ringy = `blast_counters` table only** (atomic, lossless under the per-lead burst). `blast_log_v1` (user_kv JSON) = TextDrip manual + Cowork skill-POST only. Ringy rows are purged from `blast_log_v1` on load and rejected at `/api/blast/log` so a blast can never double-count.
- **Detection:** `checkIsBlastDisposition()` in `src/lib/ringy.mjs` — default patterns match `REPUROSED - AGED - POST O/E DRIP` with zero config; toggle + custom patterns under Prospects → Settings → Ringy.
- **Two webhook URLs, don't confuse them:** Ringy automated actions must POST to `/api/ringy/webhook/<ringy_webhook_token>` (per-lead, native capture). `/api/blast/log/<blast_webhook_token>` is the Cowork skill path (TextDrip only). The agent's Ringy action must include the `disposition` field.
- **TextDrip** has no native push/poll → manual "Log a blast" form (or the skill-POST). Confirmed platform limitation.

## SQL migrations (run once each in Supabase SQL Editor)
Confirm all are applied before relying on the feature from home:
1. `supabase/blast-counters-migration.sql` — counter table + `increment_blast` RPC + RLS. **(Run — 2-lead & 2,002 tests passed.)**
2. `supabase/blast-counters-edit-migration.sql` — `notes` + `range_start` + `range_end` columns + UPDATE RLS policy (for editing Ringy rows). **Re-run this latest version if the range columns weren't added yet** (idempotent):
   ```sql
   ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS notes TEXT;
   ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS range_start TEXT;
   ALTER TABLE blast_counters ADD COLUMN IF NOT EXISTS range_end TEXT;
   DROP POLICY IF EXISTS "blast_counters_update_own" ON blast_counters;
   CREATE POLICY "blast_counters_update_own" ON blast_counters
     FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
   ```
3. *(Optional, only for Cowork skill TextDrip auto-logging — not needed for Ringy)* `profiles.blast_webhook_token`:
   ```sql
   alter table public.profiles add column if not exists blast_webhook_token text;
   create unique index if not exists profiles_blast_webhook_token_key
     on public.profiles (blast_webhook_token) where blast_webhook_token is not null;
   ```

## Per-agent Ringy setup (to roll out)
Each agent's Ringy account needs an Automated Action on the blast tag pointed at **their** `/api/ringy/webhook/...` URL (from Prospects → Settings → Ringy → Webhook URL), with the `disposition` field mapped (Custom → the tag name). Same mechanism that already feeds their leads. Test: tag 1–2 leads → the Blasts tab shows a Ringy row.

## Open / possible next steps (none blocking)
- Roll the Ringy Automated-Action setup out to all agents.
- Calendly→PRIM integration still un-started (needs paid-plan confirm + Personal Access Token + cancel/reschedule decision).
- Optional later: time-of-day / weekday analytics on the Blasts tab (raw `first_at`/`last_at` already stored).

## Key files
`src/lib/ringy.mjs`, `src/lib/blastLog.mjs`, `src/app/api/ringy/webhook/[token]/route.js`, `src/app/api/ringy/config/route.js`, `src/app/api/blast/log/[token]/route.js`, `src/components/views/BlastsView.jsx`, `src/components/LeadTracker.jsx` (`counterToBlast`, onAdd/onEdit/onDelete), `src/components/RingySettings.jsx`, `src/components/DateTimePicker.jsx` (z-index fix). Spec: `docs/superpowers/specs/2026-06-22-blast-log-design.md`; notes: `docs/blast-native-capture-2026-06-22.md`.
