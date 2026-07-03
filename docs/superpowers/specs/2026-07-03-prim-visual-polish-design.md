# PRIM Visual Polish — Design Spec

**Date:** 2026-07-03
**Status:** Approved design → ready for implementation plan
**Owner:** Juan (product) · built by Fable 5 (implementation)
**Scope:** One combined visual-enhancement pass across PRIM (primtracker.com), delivered as a single branch/PR.

---

## 1. Goal & guiding constraints

Raise PRIM's visual polish to a consistently premium feel without changing any behavior, data, or workflow. This is a *look-and-feel* pass only.

**Hard constraints (apply to every rollout):**

1. **Zero new dependencies.** Everything uses what PRIM already ships: `framer-motion` (^12), `lucide-react`, `recharts`, `canvas-confetti`, and plain CSS/Canvas 2D. If a change appears to need a new package, stop and flag it — it almost certainly has a dependency-free equivalent here.
2. **Both themes at full parity.** PRIM has light and dark themes (dark applied via a `.dark` class on `<html>`; see `globals.css` remaps and `ThemeProvider.jsx`). Every change must look correct in both. Verify both.
3. **Reduced-motion respected.** PRIM already honors `prefers-reduced-motion` in `globals.css`. New motion must gate on it (the constellation and any new animation must degrade to static/off).
4. **No behavior/logic changes.** Modals keep their existing props, state, and side effects. Tooltips carry the same text the `title=` did. Nav still switches views. Only presentation changes.
5. **Live-verifiable.** Each rollout is checked in the running app (preview) in both themes before it's considered done. The pure-logic surface is thin; verification is mostly visual.

**Non-goals (explicitly out of scope for this pass):**

- Converting the *complex* modals (multi-step wizards, the portal-escaping prospect-detail modal, the 768-line onboarding tour) to `GlassModal`. They already animate via global CSS; converting is high-risk, zero visual gain.
- Converting all 225 native `title=` tooltips. Only the high-visibility subset (below) is in scope.
- Any redesign of information architecture, nav structure, color tokens, or component APIs.
- Adding a command palette, slide-over drawers, or other net-new UX (noted as ideas elsewhere; not this pass).

---

## 2. Key finding that shaped this design

An exhaustive code inventory (4-agent sweep, 2026-07-03) found that **`globals.css` already auto-animates every modal in the app.** The rule at `globals.css:600–605` applies a fade+pop entrance to any `.fixed.inset-0[class*="backdrop-blur"]` overlay and its first child, app-wide, explicitly as a "CSS-only equivalent of GlassModal's framer entrance." 

**Consequence:** converting hand-rolled modals to `GlassModal` is *code consolidation* (single source of truth, cleaner markup), **not** a visible upgrade — the entrance animation is already there. This is why modal work (Rollout A) is deliberately limited to the low-risk simple/medium modals and the complex ones are excluded: there is no visual payoff to justify their regression risk.

---

## 3. Shared primitives (build first)

Both are small, dependency-free, and consumed by the rollouts below. Building them first makes the rollouts mechanical.

### 3.1 `.scroll-fade-x` / `.scroll-fade-y` — CSS mask utility

Add to `globals.css`. Uses `mask-image` (with `-webkit-mask-image` for Safari) so the clipped edge of a scroll container softens to transparent, signaling "there's more."

```css
/* Soft fade at the scrollable edges of an overflow container. Alpha-based
   mask, so it is theme-agnostic (works identically in light and dark). */
.scroll-fade-x {
  -webkit-mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
          mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%);
}
.scroll-fade-y {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 16px), transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, black 16px, black calc(100% - 16px), transparent 100%);
}
```

- **Chosen over** a React `<ScrollFade>` wrapper: a wrapper adds a DOM node + JS for zero benefit; a class drops onto existing containers.
- **Design decision — static fade, not scroll-position-aware.** The fade shows at *both* edges always, even when scrolled to the start/end. This is acceptable and standard; making it position-aware would require JS scroll listeners on every container (rejected — not worth the cost for this pass).
- **Known conflicts to verify live (do NOT force):**
  - `mask-image` clips `position: sticky` descendants. `ClosedDeals.jsx` has a `sticky left-0` Name column; masking its container may fade/clip that column oddly. Verify; if it looks wrong, skip that container or use `scroll-fade-x` tuned so the sticky column sits inside the opaque band.
  - `ProspectsView.jsx` Kanban uses a custom synced dual-scrollbar (`KanbanScroller`, ~lines 1277–1327). Verify the mask doesn't fight it; apply carefully or skip.

### 3.2 `<Tooltip>` — styled, accessible, dependency-free

New component `src/components/Tooltip.jsx`. A lightweight wrapper that shows a styled bubble on **hover and keyboard focus** (native `title` only shows on hover — this is an a11y improvement).

- **API:** `<Tooltip label="Edit" side="top"> <button>…</button> </Tooltip>` where `side` ∈ `top|bottom|left|right` (default `top`).
- **Implementation:** wrapper `span` with `position: relative`; the trigger is `children`; the bubble is an absolutely-positioned element shown via CSS on `:hover`/`:focus-within`. Pure CSS visibility (no JS state needed) keeps it cheap. `side` picks the position class. No portal (bubbles are small; if a specific dense location clips at a viewport edge, that call-site can pass a different `side`).
- **Styling:** dark slate bubble in light theme; the `globals.css` `.dark` remaps handle dark theme, but verify contrast — the bubble should be a near-opaque dark chip with white text in light mode and a light chip with dark text in dark mode (add explicit `.dark` styles if the automatic remap is insufficient).
- **NOT Radix** — no dependency.

---

## 4. Rollout A — Modal consolidation (simple + medium)

Point the following **17 modals** at the existing `GlassModal` (`src/components/motion/MotionPrimitives.jsx:355`), deleting each one's hand-rolled backdrop `div` and the now-redundant `overlay-fade` / `modal-pop` classes. Keep every modal's inner content, props, state, and side effects unchanged.

**Simple (9):**
- `src/components/ConfirmDialog.jsx`
- `src/components/InvestmentForm.jsx` (note: uses `z-40`)
- `src/components/ActivityForm.jsx` (uses `z-40`)
- `src/components/SourceColorManager.jsx`
- `src/components/CustomCategoryManager.jsx`
- `src/components/AnnouncementBanner.jsx` — only the internal `HistoryModal()`; leave the toast/banner logic alone
- `src/components/SendWelcomeEmail.jsx` (uses `z-[60]`)
- `src/components/SendOutreachEmail.jsx` (uses `z-[60]`)
- `src/components/LeadTracker.jsx` — the inline Settings modal (~line 2564); near-literal copy of GlassModal already, easiest conversion

**Medium (8):**
- `src/components/LeadForm.jsx`
- `src/components/ProspectForm.jsx`
- `src/components/ReportIssue.jsx` — owns its own open/close state via `createPortal`; adapt (see gotcha)
- `src/components/AssociationCommissionDetailImport.jsx`
- `src/components/AgentSettingsPanel.jsx`
- `src/components/LogTouchSheet.jsx` — responsive bottom-sheet (needs the `sheet` variant, see below)
- `src/components/TextDripReviewModal.jsx` — `createPortal` + per-item state; adapt
- `src/components/ScreenshotImport.jsx`

**`GlassModal` gets a small, bounded extension** to absorb the medium cases without breaking the simple ones:
- `zIndexClass` prop (default `z-50`) — for the modals currently on `z-40` / `z-[60]` / `z-[70]`, so stacking order is preserved.
- `sheet` boolean prop — when true, the panel is a full-width bottom sheet on mobile (`items-end`, `rounded-t-2xl`) and a centered card on `sm:` and up. Only `LogTouchSheet` uses this.
- Keep existing `open`, `onClose`, `children`, `maxWidth`, `className`.

**Per-file safety checks (must be in the plan):**
- **Portal cases** (`ReportIssue`, `TextDripReviewModal`, and any other `createPortal` modal in the list): these may portal to escape a CSS-transformed ancestor that would otherwise break `position: fixed`. Do **not** silently drop the portal. Either wrap `GlassModal` in the existing `createPortal`, or verify no transformed ancestor before removing it. Regression to watch: modal renders but is mis-positioned / clipped.
- **Self-controlled open state** (`ReportIssue`): it renders its own trigger button and manages open/close internally rather than via `open`/`onClose` props. Preserve that — either keep its state and pass it into `GlassModal`, or leave its trigger and only swap the overlay markup.
- **Double-animation:** `GlassModal` uses framer entrance; the global CSS rule *also* targets `backdrop-blur` overlays. The existing code comment says the overlap is invisible (same direction). Confirm no visible double-bounce after conversion; if any, remove the redundant `backdrop-blur` class match or the explicit `modal-pop`/`overlay-fade` class.

**Excluded (complex / out of scope), for the plan author's awareness:**
`DuplicateResolver.jsx`, `FirstRunWizard.jsx`, `SmartLeadImportWizard.jsx`, `SmartProspectImportWizard.jsx`, `SmartImportWizard.jsx`, the three modals inside `ProspectsView.jsx` (Settings, ProspectDetail [portal-escaping], ImportWizard), the four inside `BusinessBooksView.jsx` (attachment viewer, re-scan preview, ImportPreviewModal, AiRescanPreview), and `OnboardingFlow.jsx` (768-line inline-CSS tour — bespoke, not a GlassModal shape). `CpaDashboard.jsx`'s gear dropdown is an anchored popover menu, **not** a modal — leave it.

---

## 5. Rollout B — Scroll-fade edges (full)

Apply `.scroll-fade-x` (or `.scroll-fade-y` where vertical) to existing overflow containers, in priority order. Verify each live in both themes; skip any that conflict with sticky columns / custom scrollers rather than forcing.

**Priority 1 — horizontal boards / nav (highest value):**
1. `src/components/views/Pipeline.jsx` (~line 33) — Kanban stage row, `overflow-x-auto`.
2. `src/components/LeadTracker.jsx` (~line 2082) — the nav tab row (`<nav className="overflow-x-auto">`); scrolls on narrow viewports with no cue.
3. `src/components/views/ProspectsView.jsx` (~lines 1277–1327) — Kanban board (custom `KanbanScroller`; verify against the synced scrollbar).

**Priority 2 — wide data tables (`overflow-x-auto` with explicit min-widths):**
4. `src/components/views/ClosedDeals.jsx` (~line 603, `minWidth:1180`, **sticky Name column — verify**)
5. `src/components/views/CommissionCalculator.jsx` (~line 328)
6. `src/components/views/ReportSheet.jsx` (~line 111, `.report-scroll`, keep print-safe)
7. `src/components/views/TeamView.jsx` (~lines 617, 679 — two tables)
8. `src/components/views/BusinessBooksView.jsx` (~line 1336, ledger table)

**Priority 3 — remaining tables (apply as time allows; `overflow-auto`, both axes):**
9. `src/components/views/CpaDashboard.jsx` (~lines 980, 1070)
10. `src/components/views/AssociationsView.jsx` (~lines 382, 526)
11. `src/components/views/BlastsView.jsx` (~line 256)
12. `src/components/views/UploadView.jsx` (~lines 1451, 1492 — `scroll-fade-y` candidate given `max-h-96` + sticky header)
13. Import-wizard preview tables (`SmartImportWizard`, `SmartProspectImportWizard`, `SmartLeadImportWizard`), `RingySettings`, admin users table (`src/app/admin/page.jsx:421`) — low-risk extras.

If a container is skipped due to conflict, `log`/note it in the PR so it's a deliberate, visible omission — not a silent gap.

---

## 6. Rollout C — Styled tooltips (component + icon-button subset)

Build `<Tooltip>` (§3.2), then convert the **high-visibility subset**: the **~95 icon-only action buttons** plus the densest views. Leave the remaining ~130 native `title=` sites for a later pass.

**Convert (icon-only buttons + densest views first):**
- `src/components/views/BusinessBooksView.jsx` (~26 sites — heaviest)
- `src/components/views/CpaDashboard.jsx` (~23)
- `src/components/views/ClosedDeals.jsx` (~19)
- `src/components/views/AssociationsView.jsx` (~16)
- `src/components/views/ProspectsView.jsx` (~18)
- Plus icon-only action buttons wherever they cluster (`AgentChatbot.jsx`, etc.).

**Migration shape per site:** `<button title="Edit">…</button>` → `<Tooltip label="Edit"><button aria-label="Edit">…</button></Tooltip>`, and **remove the native `title`** (no double tooltips).

**Accessibility rule (mandatory):** when removing `title` from an *icon-only* button, add `aria-label` with the same text so screen readers keep the name. Removing `title` without this is an a11y regression and must not happen.

**Out of scope this pass:** truncated-text-cell tooltips, form-field helper tooltips, KPI/column-header explanation tooltips, and misc one-offs (the other ~130 sites). They stay on native `title=`.

---

## 7. Rollout D — Nav hover polish (restrained)

The nav (`LeadTracker.jsx` ~2082–2106, data from `NAV_TABS` in `src/lib/constants.js`) already has a Framer Motion shared-layout active "pill" (`layoutId="navPill"`, sliding indigo pill behind the active tab). D adds a **subtle hover on inactive tabs only**, layered *under* the pill:

- **Primary approach:** a label roll-up on hover (duplicate label, `y: 0 ↔ -100%`) — the Skiper `skiper58` technique, already proven calm enough for the sibling Meruem CRM's nav.
- **Fallback if it reads busy on a 13-item bar:** a lighter touch — icon nudges up 1–2px + label color shift only.
- **Tune live.** This is the lowest-risk, lowest-stakes rollout; pick the version that looks calm in the running app. Must not interfere with the active-pill animation or the horizontal scroll.

---

## 8. Rollout E — Constellation animated background

Port the operator-owned `ember-constellation` effect into PRIM as a React background component, replacing `OrbBackdrop`.

**Source (authoritative):** `C:\Users\juant\OneDrive\Desktop\SUPER AGENT DATABASE\libraries\website-ui\motion-system\effects\ember-constellation.js` — Canvas 2D, zero-dep, ~40 lines. `mountConstellation(hostEl, options) → cleanup()`. Drifting particles, filament lines between particles within `LINK` px, particles gather toward the cursor within ~130px, dots brighten (amber) within ~120px of the cursor. This is the exact effect on the R&J site's testimonial section (rj-prime-consultancy.vercel.app). It already returns a no-op under `prefers-reduced-motion`.

**New component:** `src/components/motion/ConstellationBackground.jsx`
- Renders a full-screen fixed host (`fixed inset-0 -z-10 pointer-events-none`, matching `OrbBackdrop`) with a `<canvas>`.
- On mount, runs the ported `mountConstellation` in a `useEffect`; returns its `cleanup()` on unmount.
- **Transparent canvas:** do NOT keep the effect's opaque `ctx.fillRect(BG)` background fill. Composite over PRIM's real page background so it works on both themes (only particles/lines draw). (Remove/skip the `BG` fill; keep `clearRect`.)

**Adaptation decisions (approved):**

1. **Recolor to PRIM violet/indigo.** Parameterize the currently-hardcoded colors (line color `rgba(255,130,20,α)`, dot `#FF6B00`/`rgba(255,107,0,.75)`, near-cursor `#FFB800`/`rgba(255,184,0,.95)`) into options. Use PRIM's accent family — indigo `#6366f1` / violet `#8b5cf6` for lines+dots, a brighter violet for the near-cursor highlight. (PRIM's accent is theme-driven via `applyAccentToDOM`; a fixed indigo/violet pair is acceptable, but read the CSS accent var if straightforward.)

2. **Both themes, adapted for light.**
   - **Dark theme:** full glow — the `shadowBlur` glow reads well on PRIM's navy canvas.
   - **Light theme:** a **faint, no-glow** variant — set `shadowBlur: 0`, thin low-alpha indigo lines, small solid dots. A glowing network looks wrong on white; the light variant is a quiet connected-dots texture.
   - Detect theme via the `.dark` class on `<html>` (or PRIM's `useIsDark` hook) and pick the palette. Re-initialize on the `prim:theme-changed` event so a live theme switch updates it.

3. **Two intensity presets:**
   - **`prominent`** — login screen. Mounted in `AuthGate.jsx` `SignInScreen()` (replaces `OrbBackdrop` at ~line 99). Full particle density, full opacity, full glow (dark). This is the "wow" surface.
   - **`medium`** — app-wide. Mounted in the app shell `LeadTracker.jsx` (replaces `OrbBackdrop` at ~line 2045). Reduced particle density, lower opacity, sits behind PRIM's opaque `premium-card` surfaces so it peeks through the gutters without fighting legibility.
   - Expose as a prop, e.g. `<ConstellationBackground intensity="prominent" />` / `="medium"`.

**Performance hardening (mandatory — it runs always-on behind live data):**
- **Cap particle count.** The effect is O(n²) (every particle pair checked for linking) and scales with viewport area (`n = W*H/8500` → ~200 on a large desktop). Cap at a fixed max (e.g. `medium` ≤ ~90, `prominent` ≤ ~140) regardless of viewport, so a big monitor can't blow up the pair-check cost.
- **Pause when the tab is hidden.** Add a `visibilitychange` listener that cancels the RAF loop when `document.hidden` and resumes on return. (The kit's effect does not do this today; add it in the port.)
- **Keep the existing gates:** `prefers-reduced-motion` → no-op (static PRIM background shows). Skip on coarse-pointer / small viewports (`< ~900px`) like the kit's `effect-loader.js` `heavyOK()` — mobile keeps the current static look.
- **Cleanup on unmount** (remove listeners, cancel RAF) — already in the effect's `cleanup()`; preserve it.

**Replaces `OrbBackdrop`:** at both mount sites. `OrbBackdrop` can stay in the codebase (unreferenced) or be removed; the plan should note which. Do not run both at once (double background).

---

## 9. Cross-cutting requirements

- **Dark + light parity** verified for: the `<Tooltip>` bubble, every converted modal, and both constellation presets. The scroll-fade mask is alpha-based (theme-agnostic).
- **Accessibility:** `aria-label` preserved/added wherever `title` is removed from an icon-only control; `<Tooltip>` responds to keyboard focus.
- **No dependency additions** — confirm `package.json` is unchanged.
- **Verification per rollout** (in the running preview, both themes):
  - A — open/close a converted modal (incl. a portal one and the bottom-sheet); no mis-position, no double-animation.
  - B — Pipeline board + a wide table show faded edges; sticky-column table verified not broken.
  - C — a tooltip appears on hover *and* on keyboard focus; no native `title` double-shows.
  - D — nav hover reads calm; active pill still animates; horizontal scroll intact.
  - E — login (prominent) + in-app (medium) in both themes; cursor interaction works; reduced-motion shows static; tab-hidden pauses (spot-check CPU).
- **Build + lint clean** (`npm run build`, ESLint) with no *new* errors beyond the repo's known pre-existing noise.

## 10. Ship ritual (per AGENTS.md)

This is a user-facing refresh, so at ship time it gets an `ANNOUNCEMENTS` "What's New" entry (`src/lib/announcements.js`) describing the polish + new animated background. Decide on a Slack `[announce]`-tagged deploy at that point (defer the announce decision to ship).

---

## 11. Suggested build order (for the implementation plan)

1. Shared primitives: `.scroll-fade-*` CSS + `<Tooltip>` component.
2. Rollout E scaffolding: `ConstellationBackground` (port + recolor + presets + perf) — biggest single new piece; land it early to verify perf.
3. Rollout A: modals (mechanical, one file at a time; portal/bottom-sheet cases last).
4. Rollout B: scroll-fade application (priority order).
5. Rollout C: tooltip conversions (densest views first).
6. Rollout D: nav hover (tune live, last — it's cosmetic).
7. Full both-theme verification pass + announcement entry.

Each rollout is independently revertible if one looks wrong in the combined pass.
