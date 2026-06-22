# Blast logging — skill-independent native capture (2026-06-22)

**Goal:** agents' blasts get logged in PRIM whether or not they use the Cowork skill.

## What shipped (final: `6464d24`)

### Ringy — fully automatic ✅ (validated live at 2,002 leads)
- Applying the repurpose tag in Ringy fires Ringy's webhook **once per lead**. PRIM **detects the blast tag** and **rolls those per-lead hits into ONE daily entry** on the Blasts tab — instead of creating ~2,000 prospects.
- **Counting uses an atomic Postgres counter** (`blast_counters` table + `increment_blast` RPC), NOT a JSON-array read-modify-write. The first attempt aggregated into the `blast_log_v1` JSON blob via compare-and-swap; under a 2,000-at-once burst ~94% of hits lost the CAS race and were dropped (a 2,000 blast logged only 119). The atomic counter is lossless under the burst — confirmed at **2,002**.
- Detection is **on by default** and recognizes the `REPUROSED - AGED - POST O/E DRIP` tag with no setup. Extra patterns + an on/off toggle live under **Prospects → Settings → Ringy**.
- Each entry shows **contacts** and **send time** (derived from the counter's `first_at` start instant, viewer-local). `first_at`/`last_at` are stored for later time-of-day analytics.
- Fires whether the tag is applied by hand, by the Cowork skill, or by any Ringy automation.
- Ringy lives **only** in `blast_counters`; `blast_log_v1` is TextDrip + manual + skill-POST only (Ringy rows are purged from it on load and rejected at `/api/blast/log`) so a blast can never double-count.

### TextDrip — manual (platform can't auto-push) ❌→🟡
- TextDrip exposes no webhook on campaign-add and no pollable "added today" endpoint, so PRIM can't auto-detect a TextDrip blast.
- Fallback: a **"Log a blast"** button on the Blasts tab (10-second form, any platform). The Cowork skill-POST also still auto-logs for skill users.

## One-time setup per agent (Ringy)
Their Ringy account needs the blast tag pointed at the PRIM Ringy webhook — the **same automated-action mechanism that already sends their leads to PRIM**. If their leads already flow in, adding the blast tag to that action is all it takes.

## SQL
- **Required** for the Ringy atomic counter: run `supabase/blast-counters-migration.sql` once (creates `blast_counters` + `increment_blast` RPC + RLS). Until it's run, blast hits return 503 → Ringy retries (no silent loss, no prospect spam).
- The manual form reuses `blast_log_v1` (no SQL).
- The earlier **skill-POST** path still needs this one-time migration (only if you want skill auto-logging):
  ```sql
  alter table public.profiles add column if not exists blast_webhook_token text;
  create unique index if not exists profiles_blast_webhook_token_key
    on public.profiles (blast_webhook_token) where blast_webhook_token is not null;
  ```

## Tests
60 passing across `blastLog.test.mjs` + `ringy.test.mjs` (incl. 2,000-hit aggregation → count 2000, and detection with no false positives on real dispositions).

## Files
`blastLog.mjs` (+`aggregateBlast`), `ringy.mjs` (+`checkIsBlastDisposition`/`DEFAULT_BLAST_PATTERNS`), `ringy/webhook` + `ringy/config` routes, `RingySettings.jsx`, `BlastsView.jsx` (manual form), `LeadTracker.jsx` (onAdd). Spec addendum in `docs/superpowers/specs/2026-06-22-blast-log-design.md`.
