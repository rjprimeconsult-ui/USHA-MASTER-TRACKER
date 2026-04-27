# USHA Master Tracker — Phase 1 Summary

**Status:** ✅ Local MVP running at http://localhost:3000

## Goal
Turn the spec file (`CPA Tracker for USHA Agents — Porta.txt`) into a web app that Juan can sell as a SaaS to USHA agents. Phase 1 is the **local single-user version** running in the browser with browser storage.

---

## What's built (Phase 1)

### Stack
- Next.js 16.2.4 (App Router) + React 19 + Tailwind 4
- recharts (charts), lucide-react (icons), papaparse/xlsx/mammoth (installed, not yet wired)
- Data persistence: `localStorage` (will swap for cloud database in Phase 2)

### Project structure
```
usha-master-tracker/
├── src/
│   ├── app/
│   │   ├── layout.js           # Metadata + root shell
│   │   └── page.js             # Renders <LeadTracker />
│   ├── lib/
│   │   ├── constants.js        # STAGES, CRMS, CAMPAIGNS, products, pricing, quarters
│   │   ├── utils.js            # date math, money formatters, quarter helpers
│   │   ├── seed.js             # 11 seed leads, 4 investments, 6 activities
│   │   └── storage.js          # async localStorage adapter
│   └── components/
│       ├── LeadTracker.jsx     # Main App: header, nav, state, persistence
│       ├── LeadForm.jsx        # Lead create/edit modal w/ compatibility filter
│       ├── InvestmentForm.jsx  # Weekly investment entry modal
│       ├── ConfirmDialog.jsx
│       ├── Toast.jsx
│       └── views/
│           ├── CpaDashboard.jsx       # 6 KPIs, 8-week bar chart, funnel, investment log w/ auto-sync
│           ├── AssociationsView.jsx   # 5 KPIs, quarterly chart, by-plan, client table
│           ├── ClosedDeals.jsx        # Monthly yellow-header sections, CRM + category pies
│           ├── Dashboard.jsx          # Overview: 6 KPIs, revenue-by-month, stage pie, source bar
│           ├── LeadsView.jsx          # Searchable/sortable table, CSV export
│           ├── Pipeline.jsx           # 6-col kanban with drag-drop
│           └── UploadView.jsx         # Placeholder (Phase 2)
```

### Features working
- All 7 nav tabs
- Lead CRUD with compatibility enforcement (Main Product filters Association dropdown)
- Pipeline drag-drop between stages; Closed Won auto-seeds `associationStartDate`
- Association lifecycle: Pause / Resume / Cancel with correct date stamps
- Auto-sync of Closed Won deals into the weekly Investment Log ("+ Auto Deals" column)
- Quarterly payout projection (Q1=Dec+Jan→Feb, etc.)
- CSV export of filtered leads
- localStorage v4→v5 migration (rename map applied on load)
- Settings modal: clear activities / investments / leads / everything
- Toast notifications

### Features deferred
- File upload with AI classification (CSV/XLSX/PDF/images → Claude API)
- Rich activity form (currently uses inline prompts; needs proper modal)
- Bulk lead actions in LeadsView
- Full detailed spec CSV export (current export has 18 columns; spec matches)

---

## How to run
```bash
cd "C:\Users\juant\OneDrive\Desktop\AI TREJO\CPA TRACKER FODLER\usha-master-tracker"
npm run dev
```
Open http://localhost:3000. Data lives in the browser (clearing browser data wipes it).

---

## Phase 2 — Multi-tenant SaaS (next)
1. **Supabase setup** — create project, enable Email auth, design schema (`users`, `leads`, `investments`, `activities` all with `user_id` for isolation).
2. **Add signup/login pages** — `/login`, `/signup`, `/forgot-password`.
3. **Migrate storage adapter** — swap `localStorage` for Supabase queries filtered by the logged-in user.
4. **Seed data on signup** — run the seed on first login so new agents see example data.
5. **Deploy to Vercel** with a custom domain.

## Phase 3 — Billing + white-label
1. Stripe subscriptions (checkout + customer portal).
2. Settings page: upload logo, set brand color, set company name.
3. Landing page + pricing page at the domain root.
4. Admin dashboard for Juan to see all customers.

---

## Known issues / decisions
- `AGENTS.md` in repo root came from `create-next-app` and points to a `node_modules/next/dist/docs/` folder that doesn't exist — harmless, treat as noise.
- The "New Activity" button uses `prompt()` dialogs as a temporary stub. Replace with a proper ActivityForm modal next iteration.
- Product name locked as "USHA Master Tracker" (header + browser tab title).

---

*Built 2026-04-21.*
