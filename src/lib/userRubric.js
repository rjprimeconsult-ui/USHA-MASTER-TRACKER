/**
 * Per-agent rubric overlay — short user-written notes that get appended to
 * the AI's system prompt for every Smart Import call this user makes.
 *
 * Use case: agent A calls TextDrip "Texting Tool" in their statements, or
 * has a niche product code, or always wants Costco runs filed under
 * Office Supplies (not Meals). Instead of editing the global rubric, they
 * write 1-3 sentences in Settings and the AI adapts.
 *
 * Stored under `user_rubric_v1` via the cloud-aware storage adapter.
 *
 * Shape on disk (per direction):
 *   { expense: "string", lead: "string", prospect: "string" }
 * Each field is a multi-line user-supplied string, capped at 1500 chars
 * so it can't blow out the prompt budget.
 */

import { storage } from './storage';

export const USER_RUBRIC_KEY = 'user_rubric_v1';
export const MAX_RUBRIC_LENGTH = 1500;

const EMPTY = { expense: '', lead: '', prospect: '' };

export async function loadUserRubric() {
  try {
    const raw = await storage.getItem(USER_RUBRIC_KEY);
    if (!raw) return { ...EMPTY };
    const obj = JSON.parse(raw);
    return {
      expense: typeof obj?.expense === 'string' ? obj.expense.slice(0, MAX_RUBRIC_LENGTH) : '',
      lead: typeof obj?.lead === 'string' ? obj.lead.slice(0, MAX_RUBRIC_LENGTH) : '',
      prospect: typeof obj?.prospect === 'string' ? obj.prospect.slice(0, MAX_RUBRIC_LENGTH) : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveUserRubric(rubric) {
  const safe = {
    expense: String(rubric?.expense || '').slice(0, MAX_RUBRIC_LENGTH),
    lead: String(rubric?.lead || '').slice(0, MAX_RUBRIC_LENGTH),
    prospect: String(rubric?.prospect || '').slice(0, MAX_RUBRIC_LENGTH),
  };
  await storage.setItem(USER_RUBRIC_KEY, JSON.stringify(safe));
  return safe;
}

/**
 * Render a rubric overlay into a prompt-friendly block. Returned string is
 * empty when the user has nothing — server-side check before injecting.
 */
export function renderUserRubric(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return `\n\n--- AGENT'S OWN RUBRIC NOTES (apply these on top of the standard rubric) ---\n${t}\n--- END AGENT NOTES ---`;
}
