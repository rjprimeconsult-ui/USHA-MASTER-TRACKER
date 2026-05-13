/**
 * Setup checklist state — drives the "Getting started" widget on the
 * Dashboard.
 *
 * Tasks are derived from existing app state where possible (no extra
 * tracking required). Only the dismiss flag needs persistence — once an
 * agent explicitly hides the widget OR completes all tasks, we stop
 * showing it.
 *
 * Storage key: `setup_checklist_v1`
 *   { dismissed: boolean, dismissedAt: ISO string | null }
 */

import { storage } from './storage';

export const SETUP_CHECKLIST_KEY = 'setup_checklist_v1';

export async function loadSetupChecklistState() {
  try {
    const raw = await storage.getItem(SETUP_CHECKLIST_KEY);
    if (!raw) return { dismissed: false, dismissedAt: null };
    const parsed = JSON.parse(raw);
    return {
      dismissed: !!parsed?.dismissed,
      dismissedAt: parsed?.dismissedAt || null,
    };
  } catch {
    return { dismissed: false, dismissedAt: null };
  }
}

export async function saveSetupChecklistState(state) {
  const safe = {
    dismissed: !!state?.dismissed,
    dismissedAt: state?.dismissedAt || (state?.dismissed ? new Date().toISOString() : null),
  };
  await storage.setItem(SETUP_CHECKLIST_KEY, JSON.stringify(safe));
  return safe;
}

/**
 * Derive checklist task completion from current app state.
 *
 * Each task has:
 *   id          — stable identifier
 *   label       — short headline shown in the widget
 *   detail      — one-line "what / why" shown beneath when incomplete
 *   actionLabel — button text for the action when incomplete
 *   actionView  — view id to navigate to ('leads', 'books', 'upload', etc.)
 *   done        — derived boolean from state passed in
 *   secondaryAction — optional alt action (label + viewId)
 */
export function deriveTasks({
  onboardingCompleted,
  leadsCount,
  ownAdvancesCount,
  businessExpensesCount,
  businessIncomeCount,
  issuedLeadsCount,
}) {
  return [
    {
      id: 'tier',
      label: 'Confirm your contract tier',
      detail: 'Drives every commission and CPA projection. Set in Settings or the welcome wizard.',
      actionLabel: 'Replay setup',
      action: 'openWizard',
      done: !!onboardingCompleted,
    },
    {
      id: 'lead',
      label: 'Add your first lead',
      detail: 'Track a deal in PRIM — manual entry, Smart Import, or screenshot OCR.',
      actionLabel: 'Add a lead',
      action: 'newLead',
      secondary: { label: 'Smart Import', action: 'goUpload' },
      done: leadsCount > 0,
    },
    {
      id: 'statement',
      label: 'Upload a USHA statement',
      detail: 'Parses every advance, override, and chargeback automatically. Powers the Earned KPI.',
      actionLabel: 'Open Upload',
      action: 'goUpload',
      done: ownAdvancesCount > 0,
    },
    {
      id: 'books',
      label: 'Track your first expense',
      detail: 'Books gives you a real monthly P&L. Drop a bank statement into Smart Import and watch it parse.',
      actionLabel: 'Open Books',
      action: 'goBooks',
      done: businessExpensesCount > 0 || businessIncomeCount > 0,
    },
    {
      id: 'issued',
      label: 'Close your first deal',
      detail: 'Mark a lead Issued — it shows up in Closed Deals + CPA Dashboard with full breakdowns.',
      actionLabel: 'Open Leads',
      action: 'goLeads',
      done: issuedLeadsCount > 0,
    },
  ];
}

export function computeProgress(tasks) {
  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, percent, allComplete: done === total && total > 0 };
}
