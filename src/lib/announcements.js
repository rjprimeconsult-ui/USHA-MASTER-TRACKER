/**
 * App-wide announcements / changelog.
 *
 * To publish a new announcement: add a new entry at the TOP of this array,
 * then push the change. On next page load, every user gets a banner with
 * the new announcement until they dismiss it. Per-user dismissal state
 * is cloud-synced via storage.
 *
 * Entry shape:
 *   id           — stable unique string. Once published, NEVER change this
 *                  (used as the dismissal key). Format: YYYY-MM-DD-slug.
 *   date         — YYYY-MM-DD (used for sorting + the "What's New" timeline)
 *   emoji        — a single emoji to grab attention
 *   title        — one-line summary (under ~60 chars)
 *   body         — 1-3 sentences explaining what changed and why agents
 *                  should care
 *   cta          — optional { label, view, url }
 *                    • view: switches the in-app view ID (e.g. "books",
 *                      "prospects", "upload") and dismisses
 *                    • url: opens external in a new tab and dismisses
 *   silent       — optional bool. When true, the entry appears in the
 *                  "What's New" panel/changelog but never pops as a banner.
 *                  Use this when shipping many changes in a single release
 *                  so users get ONE meta-banner instead of a waterfall —
 *                  individual entries stay visible for reference but don't
 *                  hijack first-load attention.
 *
 * Banner shows the LATEST unack'd, non-silent item. After dismissing, the
 * next-most-recent unack'd, non-silent one slides in. The "What's New" panel
 * shows every entry (silent and not) with a "Read" badge for the ones
 * already dismissed.
 */

export const ANNOUNCEMENTS = [
  {
    id: '2026-06-04-statement-manager',
    date: '2026-06-04',
    emoji: '🗂️',
    title: 'Manage your uploaded statements',
    body: 'In Settings → Uploaded statements you can now view every statement\'s data and delete it cleanly — a whole week, a whole month, a single row, or everything in a custom date range (with a preview of what will be removed). Great for undoing a wrong or duplicate upload without clearing everything. It updates your Earned/CPA/Books totals and never touches manually-entered income.',
  },
  {
    id: '2026-06-04-crm-screenshot-import',
    date: '2026-06-04',
    emoji: '📸',
    title: 'Import leads from other CRMs by screenshot',
    body: 'Prospects → Smart Import (AI) now reads screenshots from VanillaSoft and Ringy. Drop a lead\'s screenshot (and even its SMS conversation) and PRIM pulls the name, contact info, lead vendor, and notes — and from a text thread it can grab family size, ages, health needs, and a set appointment. You pick the stage on the review screen. Drop multiple screenshots of the same lead together and they merge into one.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-06-03-salesreport-dedup',
    date: '2026-06-03',
    emoji: '🧹',
    title: 'No more duplicate leads from your SalesReport',
    body: 'When you Smart Import your USHA portal SalesReport, PRIM now recognizes it and groups all of an application\'s product lines into a single lead automatically — by AppID, the way USHA tracks it. One client with 6 product rows = one lead, not six. Re-importing is safe too. Other files (book of business, screenshots) still use AI as before.',
    cta: { label: 'Open Upload', view: 'upload' },
  },
  {
    id: '2026-06-03-followup-analytics',
    date: '2026-06-03',
    emoji: '📊',
    title: 'See your follow-up game',
    body: 'New Follow-up performance scorecard: your on-time follow-up %, connect rate, average touches-to-appointment, an outcomes breakdown, and which stages prospects are stalling in. Find it at the top of Prospects (tap to expand) and as a quick tile on your CPA Dashboard.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-06-03-followup-smart',
    date: '2026-06-03',
    emoji: '🎯',
    title: 'Follow-ups just got smarter',
    body: 'After you log a touch, PRIM now suggests the right next move ("Booked appt → Appointment Set?", "No answer 3× → Ghosted?") — one tap to apply. Need a breather on a prospect? Snooze their follow-up 3 days or a week. And your logged calls/texts now feed the Activity Funnel on your CPA Dashboard automatically.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-06-03-followup-coaching',
    date: '2026-06-03',
    emoji: '📞',
    title: 'New: Follow-up coaching in Prospects',
    body: 'Every prospect now shows your next move + a ready-to-send script, logs each call/text you make, and flags who\'s overdue. Look for the new "Needs a touch" list at the top of Prospects, and the next-step card when you open any prospect.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-05-04-monthly-residual-lag',
    date: '2026-05-04',
    emoji: '📅',
    title: 'Monthly residuals now file against production month',
    body: 'USHA Account Summary payouts run a month behind — the January PDF (released Feb 5) represents December\'s production. PRIM now files those payouts against the production month so your books reflect when the work happened. NEW uploads will use this convention; if you have past Account Summary entries already in Books, delete and re-upload them to apply the shift. PDFs now also work in classic Books / Platforms / Lead imports — they auto-route to Smart Import (AI).',
    cta: { label: 'Open Books', view: 'books' },
  },
  // ── PREVIOUS RELEASE BANNER (silent — kept for reference) ──────────────
  {
    id: '2026-04-29-prim-v2-meta',
    date: '2026-04-29',
    silent: true,
    emoji: '🚀',
    title: 'PRIM v2 — Smart Import everywhere, plus a built-in AI assistant',
    body: 'Big release: Smart Import (AI) now handles leads, prospects, expenses, platforms, and statements — drop any PDF, screenshot, Excel, or CSV and PRIM extracts it. The wizard learns from your corrections (vendor memory). New PRIM Assistant chat bubble in the bottom-right answers questions about your data. New Prospects tab + family-members on a policy + smarter dedup + KPI math fixes. Open "What\'s New" for the full changelog.',
    cta: { label: 'See changelog', view: 'whatsnew' },
  },

  // ── SILENT (visible in changelog, never banners) ───────────────────────
  {
    id: '2026-04-29-vendor-memory',
    date: '2026-04-29',
    silent: true,
    emoji: '🧠',
    title: 'Smart Import now learns from your corrections',
    body: 'Every time you confirm or fix a category in the Smart Import wizard, PRIM remembers it. Next time you upload a file with the same vendor (or a similar one — "AMZN MKTPL" vs "Amazon.com"), it gets your category automatically. Look for the violet "Remembered" badge on rows pulled from memory.',
    cta: { label: 'Open Books', view: 'books' },
  },
  {
    id: '2026-04-29-platforms-smart-import',
    date: '2026-04-29',
    silent: true,
    emoji: '⚡',
    title: 'Platforms tab: Smart Import (AI) — drop any PDF',
    body: 'Platforms tab now has its own "Smart Import (AI)" button. Drop a credit-card statement PDF, screenshot, or any messy export — AI pulls every Ringy/TextDrip/VanillaSoft charge straight into Platforms. Non-platform charges in the same file get routed to Books automatically.',
    cta: { label: 'Open Platforms', view: 'platforms' },
  },
  {
    id: '2026-04-29-family-members',
    date: '2026-04-29',
    silent: true,
    emoji: '👨‍👩‍👧',
    title: 'New: Family members on a policy',
    body: 'When a primary applicant is declined but the spouse gets partially issued, USHA pays out under the spouse\'s name on the weekly statement. Each lead now has a "Family Members on Policy" section — adding the spouse + dependents makes statement matching find them automatically. Smart Lead Import auto-extracts spouses + dependents from your files.',
    cta: { label: 'Open Leads', view: 'leads' },
  },
  {
    id: '2026-04-29-smart-prospects',
    date: '2026-04-29',
    silent: true,
    emoji: '✨',
    title: 'Smart Prospect Import — drop any pipeline file',
    body: 'Prospects tab now has a "Smart Import (AI)" button. Drop your existing pipeline spreadsheet, a CRM export, or even a screenshot — AI extracts every prospect with their stage, source, appointment time, and situation notes. Already-existing prospects are pre-skipped.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-04-29-chatbot',
    date: '2026-04-29',
    silent: true,
    emoji: '💬',
    title: 'New: PRIM Assistant — built-in AI help',
    body: 'Look for the gradient chat bubble in the bottom-right corner. Ask anything: "How do I import my book of business?", "Why is my Earned KPI different from my statement?", "Show me my YTD numbers." It knows the app inside-out and can read your data to give specific answers.',
  },
  {
    id: '2026-04-29-lead-dedup',
    date: '2026-04-29',
    silent: true,
    emoji: '🔁',
    title: 'No more duplicate leads on re-import',
    body: 'Re-uploading a SalesReport, Excel, or any lead file now skips leads that already exist in your tracker. Matches by policy number first (handling multi-policy customers correctly), then by name + phone. You\'ll see a "skipped N duplicates" toast.',
  },
  {
    id: '2026-04-28-smart-platforms',
    date: '2026-04-28',
    silent: true,
    emoji: '⚡',
    title: 'Smart Import now populates Platforms too',
    body: 'When you drop a file with Ringy, TextDrip, or VanillaSoft charges, those rows now route to the Platforms tab automatically (instead of getting buried under Books → Software). Feeds your True CPA calculation correctly.',
    cta: { label: 'Open Books', view: 'books' },
  },
  {
    id: '2026-04-28-smart-statement',
    date: '2026-04-28',
    silent: true,
    emoji: '✨',
    title: 'Smart Statement Parser — handles any USHA PDF layout',
    body: 'Upload tab → Weekly Advance Statement and Monthly Payout now have a "Smart (AI)" toggle. Flip it on for any statement that won\'t parse cleanly with the standard parser, or for scanned/image PDFs. Same matching pipeline runs after — no surprises.',
    cta: { label: 'Open Upload', view: 'upload' },
  },
  {
    id: '2026-04-28-smart-leads',
    date: '2026-04-28',
    silent: true,
    emoji: '✨',
    title: 'Smart Lead Import — drop any lead file, AI extracts everything',
    body: 'Drag in a "Book of business" Excel, USHA portal export, PDF, or even a screenshot. AI figures out the columns, normalizes dates and phone numbers, picks the right canonical product/stage/association, and creates leads in one shot. Look for the gradient "Smart Import (AI)" button on the Upload tab.',
    cta: { label: 'Open Upload', view: 'upload' },
  },
  {
    id: '2026-04-28-smart-expenses',
    date: '2026-04-28',
    silent: true,
    emoji: '✨',
    title: 'Smart Expense Import — works with any spreadsheet or PDF',
    body: 'Books tab → "Smart Import (AI)" button. Drop a bank CSV, credit-card statement PDF, your own custom Excel — AI parses every transaction and auto-classifies into Software / Lead Investment / Meals / Travel / etc. Edit anything before importing.',
    cta: { label: 'Open Books', view: 'books' },
  },
  {
    id: '2026-04-28-prospects',
    date: '2026-04-28',
    silent: true,
    emoji: '🚀',
    title: 'New tab: Prospects (mini-CRM)',
    body: 'Track your pipeline BEFORE deals close. Kanban + List views, drag-drop between stages, bulk select, customizable stages and fields. When a prospect goes Sold, one click converts them into a Lead with all info pre-filled.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-04-28-screenshot-leads',
    date: '2026-04-28',
    silent: true,
    emoji: '📸',
    title: 'Import Closed Deals from a USHA portal screenshot',
    body: 'Closed Deals tab → "Import from screenshot". Drop a screenshot of a USHA deal-detail page and PRIM extracts the customer, policy, premium, products, and dates automatically.',
    cta: { label: 'Open Closed Deals', view: 'closed' },
  },
  {
    id: '2026-04-28-math-fix',
    date: '2026-04-28',
    silent: true,
    emoji: '🧮',
    title: 'KPIs now match your statements exactly',
    body: 'Earned, Total Revenue, and True Net now read from your statement-derived advances (own + override) instead of summing lead values. YTD Income includes all commissions. Books NET (YTD) is now true net (all income − all expenses).',
  },
];

// Sort by date desc, then by id desc as a tiebreaker (so multiple same-day
// announcements have a stable order)
export const SORTED_ANNOUNCEMENTS = [...ANNOUNCEMENTS].sort((a, b) => {
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return b.id.localeCompare(a.id);
});

export const ANNOUNCEMENT_ACK_KEY = 'announcement_acks_v1';
