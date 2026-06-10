# Subtle-Premium Visual Polish Pass (2026-06-10)

Juan's directive: enhance ALL sections, **subtle-premium** taste (Linear/Stripe,
not flashy-futuristic), one section per deploy so he can verify each visually.
Hard rules: **visual-only changes** (classNames, CSS, motion wrappers — zero
logic/data changes), full `next build` + diff review before every commit.

## Existing foundation (do NOT rebuild)
- `MotionPrimitives.jsx`: FadeIn, Stagger, TiltCard, CountUp, Chart3DCard,
  Pie3D, GlassModal, OrbBackdrop, confetti.
- `globals.css`: premium-card / premium-lift / premium-table / section-accent /
  shine-on-hover / glow-ring / mesh / orbs / tier shimmer / reduced-motion.
- ViewMount tab fade is deliberately 120ms opacity-only (slower = "tab lag");
  do not slow it down.

## Research-derived pillars (Juan's premium-SaaS research, 2026-06-10)
Adopted: **skeleton loaders** (boot skeleton shipped in P1.2; per-widget
skeletons where async loads exist), **glassmorphism consistency** (all modals
→ GlassModal treatment, not just some), **bento rhythm** (consistent gaps,
deliberate tile spans on dashboards). Rejected: shadcn/ui retrofit + ShipFast
boilerplates (for starting apps; retrofitting = high risk, no visual payoff).

## Phases (one commit + deploy each, Juan eyeballs between)
- [x] **P1 — Foundation + Overview**: global button micro-interactions
  (smooth transitions + press scale), Chart3DCard → premium-card surface
  (upgrades Dashboard/CPA/Associations chart cards at once), Dashboard KPIs →
  premium-card + CountUp, section-accent ticks on chart titles.
- [x] **P1.1** — CountUp animates 0→value on first mount; deeper dark-mode
  premium-card. **P1.2** — `.skeleton` shimmer utility + AppSkeleton boot
  screen (replaces the plain "Loading…" text).
- [x] **P2 — Prospects**: glass modal treatment + pop-in entrance (ProspectForm,
  ProspectDetail, SettingsModal), kanban card hover lift + tinted shadow,
  drag-over ring on columns, premium-card toolbar/list/calendar/widgets,
  focus rings on filter selects, section-accent on the page title.
- [x] **P3 — Leads/Clients**: LeadForm modal entrance, LeadsView select focus
  rings + unified indigo row hover, Pipeline drag-over ring + card hover lift,
  ClosedDeals donut cards → premium-card.
- [ ] **P4 — Books (BusinessBooksView)**.
- [ ] **P5 — Platforms (PlatformExpensesView) + Associations**.
- [ ] **P6 — Reports + CPA Dashboard**.
- [ ] **P7 — Shared chrome**: header/nav, settings modals, forms, Upload view.
- [ ] Final: ONE announcement (bell + [announce] Slack) covering the whole pass.

## Notes
- Other views already use CountUp on KPIs; Overview was the odd one out.
- Don't pair premium-lift with TiltCard (transform conflict).
- Keep emerald strictly semantic (money/positive); indigo is THE accent.
