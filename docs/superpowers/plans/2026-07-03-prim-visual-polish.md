# PRIM Visual Polish — Implementation Plan

> **For agentic workers (Fable 5):** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read the spec first:** [docs/superpowers/specs/2026-07-03-prim-visual-polish-design.md](../specs/2026-07-03-prim-visual-polish-design.md).

**Goal:** Ship one combined visual-polish pass across PRIM — consistent premium modals, softened scroll edges, styled tooltips, nav hover, an animated constellation background, and a friendlier Blast Log — as a single feature branch, with zero new dependencies and both light/dark themes verified.

**Architecture:** Two tiny shared primitives (a CSS mask utility + a `<Tooltip>` component) are built first; the five visual rollouts (A–E) then consume them or stand alone; the one functional rollout (F) is confined to `BlastsView.jsx` and routes every edit through the existing `onEdit` prop so the blast-counting path is never touched. Pure logic (lead-range parsing, tag options) is TDD'd as `.mjs` modules with `node --test`; visual work is verified live in the preview.

**Tech Stack:** Next.js 16 (App Router, Turbopack) · React 19 · Tailwind 4 · `framer-motion` ^12 · `lucide-react` · Canvas 2D. No new packages.

---

## Ground rules (apply to EVERY task)

1. **Zero new dependencies.** If something seems to need a package, stop — it has a dependency-free equivalent here. Confirm `package.json` is unchanged at the end.
2. **Both themes.** PRIM toggles dark via a `.dark` class on `<html>` (see `globals.css` remaps, `ThemeProvider.jsx`, and the `useIsDark` hook at `src/lib/useIsDark.js`). Verify every visible change in light AND dark.
3. **Never touch the blast capture/counting path.** Do not edit `src/app/api/{ringy,benepath,blast}/**` webhook routes or `increment_blast`. Rollout F edits only already-stored fields via the existing `onEdit` prop. (Background: the 2026-07-01 undercount incident — guard markers live in those routes.)
4. **Frequent commits** — one per task (or per sub-step where noted). Work on the branch from Task 0; do **not** push to `main` until the whole pass is verified (PRIM auto-deploys `main` to production).
5. **Tests:** `npm test` runs `node --test src/lib/*.test.mjs`. Pure logic is TDD'd. `npm run build` must end with `✓ Compiled successfully`; ESLint must add no *new* errors beyond the repo's known pre-existing noise.

---

## File Structure (what gets created / modified)

**Created:**
- `src/components/Tooltip.jsx` — styled, accessible tooltip wrapper (primitive 2).
- `src/components/motion/ConstellationBackground.jsx` — the animated background (Rollout E).
- `src/lib/blastRange.mjs` + `src/lib/blastRange.test.mjs` — lead-range split/join (Rollout F1).
- `src/lib/blastTags.mjs` + `src/lib/blastTags.test.mjs` — tag-option derivation (Rollout F3).

**Modified (primary):**
- `src/app/globals.css` — add `.scroll-fade-*` (B) and `.prim-tip*` (C) utilities.
- `src/components/motion/MotionPrimitives.jsx` — extend `GlassModal` (`zIndexClass`, `sheet` props) for Rollout A.
- `src/components/auth/AuthGate.jsx` (line ~99) + `src/components/LeadTracker.jsx` (line ~2045) — swap `OrbBackdrop` → `ConstellationBackground` (E). **Leave `OrbBackdrop` in `src/app/admin/page.jsx:312,711` untouched — do NOT delete `OrbBackdrop`.**
- ~17 modal files (A), ~priority scroll containers (B), ~5 dense views + icon buttons (C), the nav in `LeadTracker.jsx` (D), and `src/components/views/BlastsView.jsx` (F).
- `src/lib/announcements.js` — "What's New" entry (final task).

---

## Task 0: Branch setup

- [ ] **Step 1: Create the working branch**

```bash
cd "C:/Users/juant/OneDrive/Desktop/AI TREJO/CPA TRACKER FODLER/USHA-MASTER-TRACKER"
git checkout main && git pull
git checkout -b prim-visual-polish
```

- [ ] **Step 2: Baseline build to confirm a clean start**

Run: `npm run build`
Expected: `✓ Compiled successfully`. If it fails before any change, fix the environment first (`npm install`).

---

## Task 1: Primitive — `.scroll-fade-x` / `.scroll-fade-y`

**Files:** Modify `src/app/globals.css`

- [ ] **Step 1: Add the utilities** (place near the other layout utilities, e.g. after the `.premium-card` block)

```css
/* ---------- Scroll-fade edges (Rollout B) --------------------------------
   Soft mask at the scrollable edges of an overflow container so clipped
   content reads as "there's more". Alpha mask → theme-agnostic. */
.scroll-fade-x {
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
          mask-image: linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
}
.scroll-fade-y {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
          mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%);
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "Add .scroll-fade-x/.scroll-fade-y mask utilities (Rollout B primitive)"
```

---

## Task 2: Primitive — `<Tooltip>` component

**Files:** Create `src/components/Tooltip.jsx`; Modify `src/app/globals.css`

- [ ] **Step 1: Add the tooltip CSS to `globals.css`**

```css
/* ---------- Styled tooltip (Rollout C) -----------------------------------
   Dependency-free. Shows on hover AND keyboard focus (native title only
   shows on hover). Bubble is the ::after of a wrapper span. */
.prim-tip { position: relative; display: inline-flex; }
.prim-tip::after {
  content: attr(data-tip);
  position: absolute; z-index: 60;
  padding: 4px 8px; border-radius: 6px;
  background: #0f172a; color: #fff;
  font-size: 11px; font-weight: 600; line-height: 1.3;
  white-space: nowrap;
  opacity: 0; pointer-events: none;
  transition: opacity .12s ease, transform .12s ease;
}
.prim-tip:hover::after,
.prim-tip:focus-within::after { opacity: 1; }
.prim-tip-top::after    { bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 6px; }
.prim-tip-bottom::after { top: 100%;    left: 50%; transform: translateX(-50%); margin-top: 6px; }
.prim-tip-left::after   { right: 100%;  top: 50%;  transform: translateY(-50%); margin-right: 6px; }
.prim-tip-right::after  { left: 100%;   top: 50%;  transform: translateY(-50%); margin-left: 6px; }
.dark .prim-tip::after  { background: #e2e8f0; color: #0f172a; }
```

- [ ] **Step 2: Create the component**

```jsx
// src/components/Tooltip.jsx
'use client';
// Dependency-free styled tooltip. Shows on hover AND keyboard focus.
// Usage: <Tooltip label="Edit"><button aria-label="Edit">…</button></Tooltip>
export default function Tooltip({ label, side = 'top', className = '', children }) {
  if (!label) return children;
  return (
    <span className={`prim-tip prim-tip-${side} ${className}`} data-tip={label}>
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`  → Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add src/components/Tooltip.jsx src/app/globals.css
git commit -m "Add <Tooltip> component + .prim-tip styles (Rollout C primitive)"
```

---

## Task 3: Rollout E — `ConstellationBackground`

Port the operator-owned `ember-constellation` effect (source: `C:\Users\juant\OneDrive\Desktop\SUPER AGENT DATABASE\libraries\website-ui\motion-system\effects\ember-constellation.js`) into React, recolored to violet/indigo, theme-aware, perf-hardened, transparent canvas. Land early to validate performance.

**Files:** Create `src/components/motion/ConstellationBackground.jsx`; Modify `src/components/auth/AuthGate.jsx`, `src/components/LeadTracker.jsx`

- [ ] **Step 1: Create the component**

```jsx
// src/components/motion/ConstellationBackground.jsx
'use client';
import { useEffect, useRef } from 'react';
import { useIsDark } from '@/lib/useIsDark';

// Ported from the R&J motion-system ember-constellation effect: drifting
// particles linked by filament lines that gather toward the cursor. Recolored
// to PRIM violet/indigo, theme-aware (glow in dark, flat lines in light),
// transparent canvas (draws only particles over PRIM's real bg), behind all
// content (-z-10). Perf-hardened: particle cap + pause when tab hidden +
// reduced-motion / small-screen / coarse-pointer gate.
//
// intensity: 'prominent' (login) | 'medium' (app-wide).
const PRESETS = {
  prominent: { density: 9000,  maxPts: 140, link: 130, dotAlpha: 0.90, lineAlpha: 0.55, opacity: 1.0 },
  medium:    { density: 12000, maxPts: 90,  link: 115, dotAlpha: 0.70, lineAlpha: 0.40, opacity: 0.6 },
};

export default function ConstellationBackground({ intensity = 'medium' }) {
  const canvasRef = useRef(null);
  const isDark = useIsDark();

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia;
    const reduce = mq && mq('(prefers-reduced-motion: reduce)').matches;
    const fine   = mq && mq('(pointer: fine)').matches;
    if (reduce || !fine || window.innerWidth < 900) return; // static bg shows

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cfg = PRESETS[intensity] || PRESETS.medium;
    const pal = isDark
      ? { line: '99,102,241',  dot: '139,92,246', hot: '167,139,250', glow: true }
      : { line: '99,102,241',  dot: '99,102,241', hot: '79,70,229',   glow: false };

    let W = 0, H = 0, pts = [], raf = 0, alive = true;
    const mouse = { x: -1e4, y: -1e4 };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width || window.innerWidth; H = r.height || window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(cfg.maxPts, Math.max(14, Math.round((W * H) / cfg.density)));
      pts = [];
      for (let i = 0; i < n; i++) pts.push({ x: Math.random()*W, y: Math.random()*H, vx: (Math.random()-.5)*.35, vy: (Math.random()-.5)*.35 });
    };
    const frame = () => {
      ctx.clearRect(0, 0, W, H); // transparent — NO background fill
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        const md = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (md < 130) { p.vx += (mouse.x - p.x) / md * 0.02; p.vy += (mouse.y - p.y) / md * 0.02; }
        p.vx = Math.max(-.8, Math.min(.8, p.vx)); p.vy = Math.max(-.8, Math.min(.8, p.vy));
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < cfg.link) {
          const al = (1 - d / cfg.link) * cfg.lineAlpha;
          ctx.strokeStyle = `rgba(${pal.line},${al.toFixed(3)})`;
          ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i], near = Math.hypot(q.x - mouse.x, q.y - mouse.y) < 120;
        ctx.beginPath(); ctx.arc(q.x, q.y, near ? 2.8 : 1.7, 0, 7);
        if (pal.glow) { ctx.shadowColor = `rgb(${near ? pal.hot : pal.dot})`; ctx.shadowBlur = near ? 12 : 6; }
        ctx.fillStyle = `rgba(${near ? pal.hot : pal.dot},${near ? 0.95 : cfg.dotAlpha})`; ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    };
    const onMove = (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onLeave = () => { mouse.x = -1e4; mouse.y = -1e4; };
    const onVis = () => {
      if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
      else if (!raf && alive) { raf = requestAnimationFrame(frame); }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('resize', resize);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    resize(); frame();

    return () => {
      alive = false; cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', resize);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intensity, isDark]);

  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
         style={{ opacity: (PRESETS[intensity] || PRESETS.medium).opacity }}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
```

- [ ] **Step 2: Wire the login screen (prominent)** — `src/components/auth/AuthGate.jsx`

Replace the `import { OrbBackdrop } …` with `import ConstellationBackground from '../motion/ConstellationBackground';` **only if `OrbBackdrop` is not used elsewhere in this file** — it isn't (grep to confirm), so swap the import. Then replace `<OrbBackdrop />` (~line 99) with `<ConstellationBackground intensity="prominent" />`.

- [ ] **Step 3: Wire the app shell (medium)** — `src/components/LeadTracker.jsx`

`LeadTracker.jsx` imports `OrbBackdrop` alongside `fireConfetti, FadeIn` (line ~72). Add `import ConstellationBackground from './motion/ConstellationBackground';` and replace `<OrbBackdrop />` (~line 2045) with `<ConstellationBackground intensity="medium" />`. Leave the other imports as-is.

- [ ] **Step 4: Confirm `OrbBackdrop` is still used by admin (do not delete it)**

Run: `grep -rn "OrbBackdrop" src/` → Expected: still imported+used in `src/app/admin/page.jsx` (lines ~312, ~711). `MotionPrimitives.jsx` still exports it. Good.

- [ ] **Step 5: Build + live-verify (both themes)**

Run: `npm run build` → `✓ Compiled successfully`. Then in the preview: sign-in screen shows the prominent violet constellation; app shell shows the medium one; cursor pulls nearby particles + brightens them; toggle dark/light (both look right: glow in dark, flat lines in light); DevTools → emulate `prefers-reduced-motion: reduce` → background is absent (static). Switch tabs away and back → animation pauses/resumes (spot-check CPU in Task Manager falls when hidden).

- [ ] **Step 6: Commit**

```bash
git add src/components/motion/ConstellationBackground.jsx src/components/auth/AuthGate.jsx src/components/LeadTracker.jsx
git commit -m "Rollout E: ConstellationBackground (violet, theme-aware, perf-hardened) replaces OrbBackdrop on login + app shell"
```

---

## Task 4: Rollout A — Modal consolidation (17 modals)

Convert the simple/medium modals to `GlassModal`. Do this **one file per commit** so any regression is isolated. Complex wizards + the onboarding tour are OUT of scope (see spec §4).

**Files:** Modify `src/components/motion/MotionPrimitives.jsx` (extend `GlassModal`), then the 17 modal files.

- [ ] **Step 1: Extend `GlassModal`** — add `zIndexClass` + `sheet` props.

In `MotionPrimitives.jsx`, the overlay `className` currently hardcodes `z-50` (line ~363). Change the signature to `({ open, onClose, children, maxWidth = 'max-w-2xl', className = '', zIndexClass = 'z-50', sheet = false })` and:
- Replace the literal `z-50` in the overlay class with `${zIndexClass}` (**replace, not append** — appending would leave two z-index utilities).
- When `sheet` is true, the overlay uses `items-end sm:items-center` and the panel adds `rounded-t-2xl sm:rounded-2xl w-full` (bottom sheet on mobile, centered card on `sm+`). When false, keep current centered behavior.

- [ ] **Step 2: Build; commit the extension**

Run `npm run build` → pass. Then:
```bash
git add src/components/motion/MotionPrimitives.jsx
git commit -m "Rollout A: extend GlassModal with zIndexClass + sheet props"
```

- [ ] **Step 3: Convert each modal (worked example → ConfirmDialog)**

Pattern for every conversion: delete the hand-rolled `fixed inset-0 … backdrop-blur` backdrop `div` and any `overlay-fade`/`modal-pop` classes; wrap the existing panel *contents* in `<GlassModal open={…} onClose={…} maxWidth="…" zIndexClass="…" sheet={…}>`; keep all inner JSX, props, state, and handlers unchanged.

Example — `src/components/ConfirmDialog.jsx` (simple, already matches GlassModal's look):
```jsx
// before: <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-50 flex …">
//           <div className="bg-white/90 … max-w-md">{…}</div>
//         </div>
// after:
<GlassModal open onClose={onCancel} maxWidth="max-w-md">
  {/* …existing inner content unchanged… */}
</GlassModal>
```

- [ ] **Step 4: Work through the list**, committing per file. For each, match the noted prop:

**Simple (default `z-50` unless noted):** `ConfirmDialog.jsx` · `InvestmentForm.jsx` (`zIndexClass="z-40"`) · `ActivityForm.jsx` (`z-40`) · `SourceColorManager.jsx` · `CustomCategoryManager.jsx` · `AnnouncementBanner.jsx` (**only** the internal `HistoryModal()`) · `SendWelcomeEmail.jsx` (`z-[60]`) · `SendOutreachEmail.jsx` (`z-[60]`) · `LeadTracker.jsx` inline Settings modal (~line 2564).

**Medium:** `LeadForm.jsx` · `ProspectForm.jsx` · `ReportIssue.jsx` (**keep its `createPortal`** — wrap `GlassModal` inside the portal; it owns its open state, preserve that) · `AssociationCommissionDetailImport.jsx` · `AgentSettingsPanel.jsx` · `LogTouchSheet.jsx` (`sheet` + `zIndexClass="z-[70]"`) · `TextDripReviewModal.jsx` (**keep `createPortal`**, preserve per-item state) · `ScreenshotImport.jsx`.

**Per-file safety checks:** for the two `createPortal` files, verify the modal still positions correctly (they portal to escape a transformed ancestor — do NOT drop the portal). After each conversion confirm: no double-bounce animation, correct stacking, open/close works. Bottom-sheet: `LogTouchSheet` full-width from the bottom on a mobile viewport, centered card on desktop.

- [ ] **Step 5: Build + live-verify a sample** (a simple one, a portal one, the bottom-sheet) in both themes.

Run `npm run build` → pass. Commit any stragglers. (Each file was already committed individually.)

---

## Task 5: Rollout B — Apply scroll-fade

Add `.scroll-fade-x` (or `-y`) to the existing overflow containers, in priority order. **Verify each live; skip (and note in the commit) any that conflict.**

**Files:** the container elements in each listed view.

- [ ] **Step 1: Priority-1 surfaces** — add `scroll-fade-x` to the overflow container's className:
  - `src/components/views/Pipeline.jsx` (~line 33, the `overflow-x-auto` Kanban wrapper).
  - `src/components/LeadTracker.jsx` (~line 2082, the `<nav className="… overflow-x-auto">`).
  - `src/components/views/ProspectsView.jsx` (~lines 1277–1327, the `KanbanScroller` — **verify against the synced dual-scrollbar; skip if it fights the mask**).

- [ ] **Step 2: Build + live-verify** Priority-1 (both themes): faded left/right edges on the Pipeline board and nav; Prospects Kanban either faded cleanly or intentionally skipped.

- [ ] **Step 3: Commit**
```bash
git commit -am "Rollout B: scroll-fade on Pipeline board + nav (+ Prospects Kanban if clean)"
```

- [ ] **Step 4: Priority-2 tables** — add `scroll-fade-x` to the `overflow-x-auto` wrappers in: `ClosedDeals.jsx` (~603 — **sticky Name column: verify it isn't clipped; skip if so**), `CommissionCalculator.jsx` (~328), `ReportSheet.jsx` (~111, keep print-safe), `TeamView.jsx` (~617, ~679), `BusinessBooksView.jsx` (~1336). Live-verify; commit.

- [ ] **Step 5: Priority-3 (optional)** — `CpaDashboard.jsx`, `AssociationsView.jsx`, `BlastsView.jsx` (~256), `UploadView.jsx` (~1451/1492 → `scroll-fade-y`), import-wizard preview tables, admin users table. Apply what looks clean; **`log`/note any skipped container in the commit message** so omissions are deliberate. Commit.

---

## Task 6: Rollout C — Styled tooltips (subset)

Convert the ~95 icon-only buttons + the 5 densest views from native `title=` to `<Tooltip>`. **Mandatory a11y rule:** when removing `title` from an icon-only button, add `aria-label` with the same text.

**Files:** `BusinessBooksView.jsx`, `CpaDashboard.jsx`, `ClosedDeals.jsx`, `AssociationsView.jsx`, `ProspectsView.jsx`, plus icon-only buttons elsewhere (e.g. `AgentChatbot.jsx`).

- [ ] **Step 1: Convert one file end-to-end (worked pattern)**

```jsx
// before: <button title="Edit" onClick={…}><Pencil size={14} /></button>
// after:
import Tooltip from '@/components/Tooltip';
<Tooltip label="Edit"><button aria-label="Edit" onClick={…}><Pencil size={14} /></button></Tooltip>
```
Remove the native `title`. Choose `side` per location (default `top`; use `left`/`bottom` where a `top` bubble would clip at a table edge).

- [ ] **Step 2: Work through the densest views**, committing per file. Start with `BusinessBooksView.jsx` (~26 sites), then `CpaDashboard.jsx`, `ClosedDeals.jsx`, `AssociationsView.jsx`, `ProspectsView.jsx`. Convert icon-only action buttons + truncated-cell tooltips in those files. Leave the remaining ~130 `title=` sites elsewhere for a later pass.

- [ ] **Step 3: Build + live-verify** (both themes): hover a converted icon button → styled bubble; **Tab to it with the keyboard → bubble also shows** (focus-within); no yellow native tooltip double-appears; dark-mode bubble is light-on-dark.

- [ ] **Step 4: Commit** any remaining per-file changes.

---

## Task 7: Rollout F — Blast Log (functional)

Confined to `src/components/views/BlastsView.jsx` + two new pure-logic modules. **Route every edit through the existing `onEdit(id, fullForm)` — and always send a COMPLETE form (existing row values merged with the one edited field), never a partial patch, or the parent's `parseInt(form.contacts)||0` will zero the count.** (See spec §9 "Count-safety rule".)

### 7a — Lead-range parsing (TDD)

**Files:** Create `src/lib/blastRange.mjs`, `src/lib/blastRange.test.mjs`

- [ ] **Step 1: Write the failing tests** — `src/lib/blastRange.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLeadRange, joinLeadRange } from './blastRange.mjs';

test('splits on a space-surrounded arrow', () => {
  assert.deepEqual(splitLeadRange('01/01/2025 → 05/31/2026'), { start: '01/01/2025', end: '05/31/2026' });
});
test('splits on a space-surrounded hyphen', () => {
  assert.deepEqual(splitLeadRange('01/01/2025 - 05/31/2026'), { start: '01/01/2025', end: '05/31/2026' });
});
test('splits on the word "to"', () => {
  assert.deepEqual(splitLeadRange('Jan 1 2025 to May 31 2026'), { start: 'Jan 1 2025', end: 'May 31 2026' });
});
test('does NOT split a hyphenated single date', () => {
  assert.deepEqual(splitLeadRange('03-26-2026'), { start: '03-26-2026', end: '' });
});
test('single date → start only', () => {
  assert.deepEqual(splitLeadRange('01/01/2025'), { start: '01/01/2025', end: '' });
});
test('blank → both empty', () => {
  assert.deepEqual(splitLeadRange('   '), { start: '', end: '' });
});
test('join renders canonical arrow, or a lone start, or empty', () => {
  assert.equal(joinLeadRange('01/01/2025', '05/31/2026'), '01/01/2025 → 05/31/2026');
  assert.equal(joinLeadRange('01/01/2025', ''), '01/01/2025');
  assert.equal(joinLeadRange('', ''), '');
});
```

- [ ] **Step 2: Run — verify FAIL**  → Run: `npm test` → Expected: failures ("Cannot find module './blastRange.mjs'").

- [ ] **Step 3: Implement** — `src/lib/blastRange.mjs`

```js
// Split a typed lead-range string into { start, end } WITHOUT reformatting the
// dates. Only a SPACE-SURROUNDED separator splits, so a hyphenated single date
// like "03-26-2026" stays whole.
const SEP = /\s+(?:→|–|-|to)\s+/i;
export function splitLeadRange(input) {
  const s = String(input || '').trim();
  if (!s) return { start: '', end: '' };
  const parts = s.split(SEP);
  if (parts.length >= 2) return { start: parts[0].trim(), end: parts.slice(1).join(' ').trim() };
  return { start: s, end: '' };
}
export function joinLeadRange(start, end) {
  const a = String(start || '').trim(), b = String(end || '').trim();
  return a && b ? `${a} → ${b}` : (a || b || '');
}
```

- [ ] **Step 4: Run — verify PASS** → `npm test` → Expected: all pass.

- [ ] **Step 5: Commit**
```bash
git add src/lib/blastRange.mjs src/lib/blastRange.test.mjs
git commit -m "Rollout F: lead-range split/join (space-surrounded separators; TDD)"
```

### 7b — Tag options (TDD)

**Files:** Create `src/lib/blastTags.mjs`, `src/lib/blastTags.test.mjs`

- [ ] **Step 1: Failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blastTagOptions } from './blastTags.mjs';

test('distinct non-empty tags, first-seen order', () => {
  assert.deepEqual(
    blastTagOptions([{campaignOrTag:'A'},{campaignOrTag:''},{campaignOrTag:'B'},{campaignOrTag:'A'}]),
    ['A','B']
  );
});
test('case-insensitive dedupe, keeps first casing', () => {
  assert.deepEqual(blastTagOptions([{campaignOrTag:'Drip'},{campaignOrTag:'drip'}]), ['Drip']);
});
test('handles empty / non-array', () => {
  assert.deepEqual(blastTagOptions([]), []);
  assert.deepEqual(blastTagOptions(undefined), []);
});
```

- [ ] **Step 2: Run — verify FAIL** → `npm test`.

- [ ] **Step 3: Implement** — `src/lib/blastTags.mjs`

```js
// Distinct campaign/tag options learned from the agent's blast history.
// First-seen order preserved (caller passes rows already sorted newest-first
// if that ordering is desired). Case-insensitive dedupe, non-empty only.
export function blastTagOptions(blasts) {
  const seen = new Set(), out = [];
  for (const b of Array.isArray(blasts) ? blasts : []) {
    const t = String(b?.campaignOrTag || '').trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}
```

- [ ] **Step 4: Run — verify PASS** → `npm test`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/blastTags.mjs src/lib/blastTags.test.mjs
git commit -m "Rollout F: blastTagOptions (learned-from-history tag list; TDD)"
```

### 7c — BlastsView UI (single-field range, inline edit, tag combobox)

**Files:** Modify `src/components/views/BlastsView.jsx`

- [ ] **Step 1: Single-field range in the add/edit form** — replace the two `rangeStart`/`rangeEnd` inputs with one text input bound to `joinLeadRange(form.rangeStart, form.rangeEnd)`; on change, `splitLeadRange` the value back into `rangeStart`/`rangeEnd` in form state. Import both from `@/lib/blastRange.mjs`.

- [ ] **Step 2: Campaign/Tag combobox** — replace the free-text `campaignOrTag` input (in the form) with a combobox: an `<input list="blast-tags">` + `<datalist id="blast-tags">` populated from `blastTagOptions(blasts)` (import from `@/lib/blastTags.mjs`). Free typing still allowed (adds a new tag on save).

- [ ] **Step 3: Inline editing for Lead Range / Campaign/Tag / Notes** — in each row (`sorted.map(b => …)`), make those three `<td>`s click-to-edit: clicking swaps the display for the matching editor (range field from Step 1, tag combobox from Step 2, plain text input for notes). **On commit (Enter or blur)**, build a COMPLETE form object from the row and call `onEdit(b.id, fullForm)`:

```jsx
// count-safety: send the row's full field set, overriding just the edited one
const commit = (b, changed) => onEdit?.(b.id, {
  platform: b.platform, runDate: b.runDate, campaignOrTag: b.campaignOrTag,
  contacts: String(b.contacts ?? ''), sendTime: b.sendTime || '',
  rangeStart: b.rangeStart || '', rangeEnd: b.rangeEnd || '', notes: b.notes || '',
  ...changed, // e.g. { campaignOrTag: newTag } or { rangeStart, rangeEnd } or { notes }
});
```
Esc cancels (revert local editing state). Keep the pencil (opens the form for the other fields) and the trash button. On `source: 'auto'` (`bc:` id) rows the three inline fields are editable but Date & Send Time stay locked (they already are in the form).

- [ ] **Step 4: Build + live-verify** (spec §10 F checks): type `01/01/2025 → 05/31/2026` in one box → splits + renders; type `03-26-2026` alone → stays whole, no split; inline-edit range/tag/notes on a manual row → saves, **Contacts count unchanged**; on a Ringy (`bc:`) row edit the tag → row **rekeys cleanly (no duplicate/orphan), totals unchanged**; tag dropdown lists prior tags + accepts a new one. Confirm blast rollup totals at the top are unchanged after edits.

- [ ] **Step 5: Commit**
```bash
git add src/components/views/BlastsView.jsx
git commit -m "Rollout F: Blast Log single-field range + inline edit (range/tag/notes) + tag combobox"
```

---

## Task 8: Rollout D — Nav hover polish

**Files:** Modify `src/components/LeadTracker.jsx` (nav tab render, ~lines 2082–2106).

- [ ] **Step 1: Add a restrained hover to inactive tabs**, under the existing `layoutId="navPill"` active pill. Primary approach — label roll-up on hover (duplicate the label, translate `y: 0 → -100%` on hover via a small CSS class or framer `whileHover`). Must not disturb the active-pill animation or the horizontal scroll. If it reads busy on the 13-item bar, fall back to a subtle icon lift (+color shift).

- [ ] **Step 2: Build + live-verify** (both themes): hovering an inactive tab is subtly alive; the active pill still slides between tabs; nav still scrolls horizontally with its scroll-fade (Task 5).

- [ ] **Step 3: Commit**
```bash
git commit -am "Rollout D: restrained nav-tab hover under the active pill"
```

---

## Task 9: Final verification + announcement + PR

- [ ] **Step 1: Full test + build**  → Run: `npm test` (all pass) and `npm run build` (`✓ Compiled successfully`). Confirm `git diff main -- package.json` is empty (no new deps).

- [ ] **Step 2: Full both-theme sweep** — walk the spec §10 checklist for A–F in light AND dark once more in the preview.

- [ ] **Step 3: "What's New" entry** — add an `ANNOUNCEMENTS` entry to `src/lib/announcements.js` (follow the existing shape, e.g. id `2026-07-03-visual-refresh`) describing: refreshed modals/tooltips, softened scroll edges, the new animated background, and the friendlier Blast Log. Commit.

- [ ] **Step 4: Open the PR** (do NOT merge to `main` unattended — PRIM auto-deploys `main`):
```bash
git push -u origin prim-visual-polish
gh pr create --title "PRIM visual polish pass (modals, tooltips, scroll-fade, nav, constellation bg, blast log)" \
  --body "Implements docs/superpowers/specs/2026-07-03-prim-visual-polish-design.md. Six rollouts, zero new deps, both themes verified. Blast counting path untouched (Rollout F edits via onEdit only)."
```
When ready to ship, merge — and per the AGENTS.md ritual, consider an `[announce]`-tagged deploy for the What's New entry.

---

## Notes for the executor
- **Order matters little between A–F except:** primitives (Tasks 1–2) before the rollouts that use them (B, C); everything else is independent and individually revertible.
- **If a scroll-fade or a modal conversion looks wrong**, skip that single item and note it — do not force it or block the pass.
- **Rollout F is the only place a bug could corrupt data.** The one rule that prevents it: inline edits send the *full* form, never a partial patch. Everything else in F is cosmetic over the same stored shape.
