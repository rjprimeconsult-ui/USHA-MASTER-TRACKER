# Blast logging — skill-independent native capture (2026-06-22)

**Goal:** agents' blasts get logged in PRIM whether or not they use the Cowork skill.

## What shipped (commit `fcf1926`)

### Ringy — fully automatic ✅
- Applying the repurpose tag in Ringy fires Ringy's webhook once per lead. PRIM now **detects the blast tag** and **rolls those per-lead hits into ONE daily entry** on the Blasts tab — instead of creating ~2,000 prospects.
- Detection is **on by default** and recognizes the `REPUROSED - AGED - POST O/E DRIP` tag with no setup. Extra patterns + an on/off toggle live under **Prospects → Settings → Ringy**.
- Fires whether the tag is applied by hand, by the Cowork skill, or by any Ringy automation.

### TextDrip — manual (platform can't auto-push) ❌→🟡
- TextDrip exposes no webhook on campaign-add and no pollable "added today" endpoint, so PRIM can't auto-detect a TextDrip blast.
- Fallback: a **"Log a blast"** button on the Blasts tab (10-second form, any platform). The Cowork skill-POST also still auto-logs for skill users.

## One-time setup per agent (Ringy)
Their Ringy account needs the blast tag pointed at the PRIM Ringy webhook — the **same automated-action mechanism that already sends their leads to PRIM**. If their leads already flow in, adding the blast tag to that action is all it takes.

## SQL
- **None needed** for the Ringy native capture or the manual form (reuses `ringy_webhook_token` + JSON blobs).
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
