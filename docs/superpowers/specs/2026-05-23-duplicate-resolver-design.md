# Duplicate Lead Resolver — Design Spec

**Date:** 2026-05-23
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Juan Trejo + Claude

---

## 1. Goal

Give PRIM agents a tool to clean up duplicate leads (mostly from quirks in
USHA SalesReport imports — addressed at the source by commit `6b2581a`,
but legacy duplicates still need cleanup) **while correctly handling the
case where the same person actually came back as a new policy after a
lapse/cancellation/drop**. That second case is not a duplicate — it's a
repeated client, and PRIM should know about it.

The fix at the importer (`6b2581a`) prevents *new* duplicates. This tool
fixes the legacy ones and, critically, doesn't accidentally collapse two
legitimate deals from the same client into one record.

---

## 2. Scope

### In scope (v1)

- Detect groups of leads with the same normalized customer name.
- Classify each group as likely import-duplicate, likely repeated client,
  or ambiguous, using date proximity and policy-number overlap.
- A **Find Duplicates** modal where the agent reviews each group and
  picks **Merge** / **Repeated client** / **Keep both**.
- A small **Repeated Client** badge wherever a tagged lead displays
  (Leads, Closed Deals, Prospects).
- A LeadsView filter: "Repeated clients only".
- Surface the tool via:
  - A button in **Settings → Data tools**.
  - An auto-banner right after a SalesReport import if same-name groups
    were detected in the import (skippable / "remind me later").
- Remember per-pair decisions so reviewed pairs don't reappear.

### Out of scope (future)

- Fuzzy name matching (typo tolerance beyond the existing `nameKey`
  normalization). Out of scope; the existing tokenizer handles middle-
  initial differences, suffixes, and case.
- Auto-merge without confirmation. Even "obvious" duplicates surface for
  agent confirmation in v1 — the cost of an over-merge is high (data
  loss); confirmation is cheap.
- A timeline / history view of a repeated client's prior policies (the
  link is captured via `previousLeadId`; a richer view is later work).
- Multi-policy chains (3+ leads for the same person). v1 handles pairs;
  triples surface as multiple pairs.

---

## 3. Data model

Two new optional fields on a lead record:

| Field | Type | Meaning |
|---|---|---|
| `previousLeadId` | `string` (lead id) | When set, this lead is a **repeated client** — they previously had the policy with this agent. Points to the prior lead. Original `leadCategory` (AGED / SHARED / REFERRAL / BENEPATH …) is preserved alongside; repeat status is orthogonal. |
| `dedupReviewedAt` | ISO date string | "I've already reviewed this lead in the duplicate resolver, don't re-prompt me." Set on both leads of a pair when the agent makes any decision (Merge / Repeated / Dismiss). |

`isRepeatedClient` is **derived** as `Boolean(lead.previousLeadId)` — no
separate boolean. Keeps the data clean and avoids drift.

---

## 4. Detection + classification

### Detection
- Group all leads by `nameKey(lead.name)` (the existing helper from
  `lib/statement.js`; strips middle initials, suffixes, case).
- For each group with 2+ leads, generate the **set of pairs** (every
  combination of two leads). v1 surfaces each pair separately.
- Skip pairs where **both** leads have `dedupReviewedAt` set — already
  reviewed.

### Classification (the rule the agent asked for)

| Signal | Classification | Default action recommended |
|---|---|---|
| `closedDate`s within 7 days **OR** policy-number bases overlap | **Likely import duplicate** | Merge |
| `closedDate`s 60+ days apart | **Likely repeated client** | Tag as repeat |
| Otherwise (8–59 days apart, no policy overlap) | **Ambiguous** | Ask, no default |

A "policy-number base overlap" = comparing the first ~9 chars of any
policy number in lead A vs lead B and finding a match. This catches the
USHA convention where related rows share an AppID base.

The classification is a **recommendation**. The agent always picks the
final action — PRIM never auto-merges.

---

## 5. UI flow

### Entry points
- **Settings → Data tools → "Find duplicate leads"** (always available).
- **Post-import banner**: after a SalesReport import, if PRIM detected
  same-name groups in the import, a top-of-Leads banner appears: *"3
  potential duplicates detected from this import — review now."* Agent
  can open the resolver or dismiss until next import.

### Resolver modal

A full-screen / wide modal that walks the agent through pairs one at
a time (or all-at-once view, see "Layout" below).

**Per pair**, side-by-side cards show, for each lead:

- Name, lead ID
- Stage (Issued / Pending / Withdrawn / etc.)
- Closed date (or submit date if not closed)
- Main product + add-ons
- All policy numbers
- Lead source / category / campaign
- Advance + lead cost

Above the pair: the **recommended classification** chip — color-matched
("Likely duplicate" emerald, "Likely repeated client" indigo,
"Ambiguous" amber).

Three action buttons:

1. **Merge into one** — opens a quick choose-the-winner step: the agent
   picks which lead becomes the canonical record. The other's policy
   numbers, products, addons, and any non-empty fields the winner is
   missing are folded in. The loser is deleted.
2. **Repeated client** — keeps both. Tags the newer lead with
   `previousLeadId = <older lead's id>`. Sets `dedupReviewedAt` on both.
3. **Keep both / dismiss** — both stay independent. Sets
   `dedupReviewedAt` on both so the pair doesn't reappear.

### Repeated Client badge

A small inline chip next to a lead's name wherever the lead is
displayed: `↻ Repeated Client`. Hover/click shows "Previous policy:
[date]" — links to the older lead. Surfaces in:

- LeadsView table rows.
- ClosedDeals month sections.
- ProspectsView cards (if/when the lead is also a prospect — rare).

### LeadsView filter

New filter chip: **"Repeated clients only"**. Hides everything except
leads with a `previousLeadId`. Useful for the agent who wants to see
their repeat-business breakdown.

---

## 6. Architecture

| File | Purpose |
|---|---|
| `src/lib/duplicateResolver.mjs` | Pure logic — `findDuplicateGroups(leads)`, `classifyPair(a, b)`, `mergeLeads(winner, loser)`. Unit-testable. |
| `src/lib/duplicateResolver.test.mjs` | `node:test` coverage of detection + classification + merge. |
| `src/components/DuplicateResolver.jsx` | The modal — pair walkthrough, action buttons, repeated-client tagging. Uses the lib. |
| `src/components/RepeatedClientBadge.jsx` | Tiny shared chip; takes a lead, renders the badge if `previousLeadId` is set. |
| `src/components/views/LeadsView.jsx` | Insert badge + new "Repeated clients only" filter. |
| `src/components/views/ClosedDeals.jsx` | Insert badge next to the name in each row. |
| `src/components/views/ProspectsView.jsx` | Insert badge on prospect cards / detail (optional, surfaces only on prospects converted from leads). |
| `src/components/LeadTracker.jsx` | Wires the entry button (Settings) + post-import banner state + duplicate-detection trigger after SalesReport import. |

All persistence flows through the existing `prospects_v1`/`leads_v5`
stores — the merge-on-save fix from `91a3757` keeps the dedup actions
safe under multi-tab/device use.

---

## 7. Edge cases

- **Three-way matches**: surface as multiple pairs (A↔B, A↔C, B↔C).
  After the agent resolves one pair, the next pair re-evaluates against
  the post-action state. v1 doesn't try to render 3-up.
- **Merging Issued + Withdrawn**: the winner keeps its own stage; the
  loser's stage is discarded. The agent picks the winner explicitly so
  this is intentional.
- **Repeated client where the older lead has been Issued**: that's the
  classic case — old policy lapsed / cancelled / dropped, new policy
  written. Tag-as-repeat is the right action.
- **Repeated client where the older lead has been Withdrawn**: still a
  legit repeat-attempt scenario. Tag-as-repeat is fine.
- **Same-day same-customer two different products** (e.g., a separate
  ACA Wrap policy issued same day): rare and ambiguous. PRIM
  classifies as "Likely duplicate" by date proximity but the agent can
  pick "Keep both" — they know the situation. Acceptable.
- **The previous lead is later deleted** (after a merge or by hand): the
  newer lead's `previousLeadId` becomes a dangling reference. UI
  gracefully falls back ("Previous policy unavailable"). Not a bug.

---

## 8. Future enhancements (out of scope for v1)

- Three-way+ resolution UI (group view, not pair view).
- Fuzzy name match with confidence score.
- Auto-merge of "very obvious" duplicates (same name, same close date,
  overlapping policy bases) with a single-click undo, instead of
  per-pair confirmation. Only after v1 in-the-wild experience confirms
  the classification rule is reliable.
- Repeated-client analytics — "X% of your sales last quarter were
  repeat business" reporting line on the CPA Dashboard.

---

## 9. Build sequence (high-level, to be detailed in the plan)

1. `duplicateResolver.mjs` — pure logic + tests.
2. Data-field plumbing: ensure `previousLeadId` / `dedupReviewedAt`
   survive save/load and don't break other code paths.
3. `RepeatedClientBadge.jsx` — shared component.
4. `DuplicateResolver.jsx` — the modal.
5. Wire the entry button in Settings + the post-import banner.
6. Insert the badge in LeadsView / ClosedDeals / ProspectsView.
7. LeadsView "Repeated clients only" filter.
8. Final manual check + commit + push.
