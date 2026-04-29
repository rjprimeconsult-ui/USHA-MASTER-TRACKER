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
 *
 * Banner shows the LATEST unack'd item. After dismissing, the next-most-
 * recent unack'd one slides in. The "What's New" panel shows every entry
 * with a "Read" badge for the ones already dismissed.
 */

export const ANNOUNCEMENTS = [
  {
    id: '2026-04-29-chatbot',
    date: '2026-04-29',
    emoji: '💬',
    title: 'New: PRIM Assistant — built-in AI help',
    body: 'Look for the gradient chat bubble in the bottom-right corner. Ask anything: "How do I import my book of business?", "Why is my Earned KPI different from my statement?", "Show me my YTD numbers." It knows the app inside-out and can read your data to give specific answers.',
  },
  {
    id: '2026-04-29-lead-dedup',
    date: '2026-04-29',
    emoji: '🔁',
    title: 'No more duplicate leads on re-import',
    body: 'Re-uploading a SalesReport, Excel, or any lead file now skips leads that already exist in your tracker. Matches by policy number first (handling multi-policy customers correctly), then by name + phone. You\'ll see a "skipped N duplicates" toast.',
  },
  {
    id: '2026-04-28-smart-platforms',
    date: '2026-04-28',
    emoji: '⚡',
    title: 'Smart Import now populates Platforms too',
    body: 'When you drop a file with Ringy, TextDrip, or VanillaSoft charges, those rows now route to the Platforms tab automatically (instead of getting buried under Books → Software). Feeds your True CPA calculation correctly.',
    cta: { label: 'Open Books', view: 'books' },
  },
  {
    id: '2026-04-28-smart-statement',
    date: '2026-04-28',
    emoji: '✨',
    title: 'Smart Statement Parser — handles any USHA PDF layout',
    body: 'Upload tab → Weekly Advance Statement and Monthly Payout now have a "Smart (AI)" toggle. Flip it on for any statement that won\'t parse cleanly with the standard parser, or for scanned/image PDFs. Same matching pipeline runs after — no surprises.',
    cta: { label: 'Open Upload', view: 'upload' },
  },
  {
    id: '2026-04-28-smart-leads',
    date: '2026-04-28',
    emoji: '✨',
    title: 'Smart Lead Import — drop any lead file, AI extracts everything',
    body: 'Drag in a "Book of business" Excel, USHA portal export, PDF, or even a screenshot. AI figures out the columns, normalizes dates and phone numbers, picks the right canonical product/stage/association, and creates leads in one shot. Look for the gradient "Smart Import (AI)" button on the Upload tab.',
    cta: { label: 'Open Upload', view: 'upload' },
  },
  {
    id: '2026-04-28-smart-expenses',
    date: '2026-04-28',
    emoji: '✨',
    title: 'Smart Expense Import — works with any spreadsheet or PDF',
    body: 'Books tab → "Smart Import (AI)" button. Drop a bank CSV, credit-card statement PDF, your own custom Excel — AI parses every transaction and auto-classifies into Software / Lead Investment / Meals / Travel / etc. Edit anything before importing.',
    cta: { label: 'Open Books', view: 'books' },
  },
  {
    id: '2026-04-28-prospects',
    date: '2026-04-28',
    emoji: '🚀',
    title: 'New tab: Prospects (mini-CRM)',
    body: 'Track your pipeline BEFORE deals close. Kanban + List views, drag-drop between stages, bulk select, customizable stages and fields. When a prospect goes Sold, one click converts them into a Lead with all info pre-filled.',
    cta: { label: 'Open Prospects', view: 'prospects' },
  },
  {
    id: '2026-04-28-screenshot-leads',
    date: '2026-04-28',
    emoji: '📸',
    title: 'Import Closed Deals from a USHA portal screenshot',
    body: 'Closed Deals tab → "Import from screenshot". Drop a screenshot of a USHA deal-detail page and PRIM extracts the customer, policy, premium, products, and dates automatically.',
    cta: { label: 'Open Closed Deals', view: 'closed' },
  },
  {
    id: '2026-04-28-math-fix',
    date: '2026-04-28',
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
