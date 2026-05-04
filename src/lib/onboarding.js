/**
 * Onboarding walkthrough state.
 *
 * Tracks whether the agent has completed/skipped the in-app tour, and
 * which step they're on if they paused mid-tour. Cloud-synced via the
 * storage adapter so the tour state follows the user across devices.
 *
 * Auto-launch trigger: the tour fires on first sign-in when there's
 * no record at all (i.e. genuinely new agent). Returning agents who
 * already skipped/completed never get re-prompted automatically — but
 * the "Replay tour" button in Settings is always available.
 */

import { storage } from './storage';

export const ONBOARDING_KEY = 'onboarding_progress_v1';

const EMPTY = {
  completed: false,
  skipped: false,
  currentStep: 0,
  startedAt: null,
  completedAt: null,
};

export async function loadOnboardingProgress() {
  try {
    const raw = await storage.getItem(ONBOARDING_KEY);
    if (!raw) return null; // null = never started — auto-launch eligible
    const obj = JSON.parse(raw);
    return {
      completed: !!obj.completed,
      skipped: !!obj.skipped,
      currentStep: Number(obj.currentStep) || 0,
      startedAt: obj.startedAt || null,
      completedAt: obj.completedAt || null,
    };
  } catch {
    return null;
  }
}

export async function saveOnboardingProgress(progress) {
  try {
    await storage.setItem(ONBOARDING_KEY, JSON.stringify(progress || EMPTY));
    return true;
  } catch {
    return false;
  }
}

export async function startOnboarding() {
  const progress = {
    ...EMPTY,
    startedAt: new Date().toISOString(),
  };
  await saveOnboardingProgress(progress);
  return progress;
}

export async function markStep(stepIndex) {
  const current = (await loadOnboardingProgress()) || { ...EMPTY };
  const next = { ...current, currentStep: stepIndex };
  if (!next.startedAt) next.startedAt = new Date().toISOString();
  await saveOnboardingProgress(next);
  return next;
}

export async function markSkipped() {
  const current = (await loadOnboardingProgress()) || { ...EMPTY };
  const next = { ...current, skipped: true };
  await saveOnboardingProgress(next);
  return next;
}

export async function markCompleted() {
  const current = (await loadOnboardingProgress()) || { ...EMPTY };
  const next = {
    ...current,
    completed: true,
    completedAt: new Date().toISOString(),
  };
  await saveOnboardingProgress(next);
  return next;
}

/**
 * Resets onboarding state so the user can replay from the beginning.
 * Used by the Settings → Replay tour button.
 */
export async function resetOnboarding() {
  await saveOnboardingProgress({ ...EMPTY });
  return { ...EMPTY };
}

/**
 * Should the tour auto-launch? True only for genuinely new accounts
 * (no progress record). Skip + completed accounts never re-prompt.
 */
export function shouldAutoLaunch(progress) {
  return progress === null;
}
