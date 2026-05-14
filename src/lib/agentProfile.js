/**
 * Per-agent profile fields that aren't auth/subscription related —
 * display name, phone, and (later) appearance/preferences.
 *
 * Stored in user_kv via the cloud-aware storage adapter so it
 * survives device switches and mirrors to localStorage as a
 * fallback. This is intentionally separate from the Supabase
 * `profiles` table (which holds auth + Stripe state managed by
 * server code) — keeping the user-editable identity layer in
 * user_kv means no DB migration is needed to ship this feature.
 *
 * Display name + phone are surfaced as template variables for
 * post-sale emails ({agent_name}, {agent_phone}) and shown in the
 * Profile hub.
 */
import { storage } from './storage';

export const AGENT_PROFILE_KEY = 'agent_profile_v1';

export const DEFAULT_AGENT_PROFILE = {
  displayName: '',
  phone: '',
  // Appearance preset id — reserved for Phase 2.
  accent: 'indigo',
  // Banner image (data URL or Supabase Storage URL) — reserved for Phase 3.
  bannerUrl: '',
};

export async function loadAgentProfile() {
  try {
    const raw = await storage.getItem(AGENT_PROFILE_KEY);
    if (!raw) return { ...DEFAULT_AGENT_PROFILE };
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      ...DEFAULT_AGENT_PROFILE,
      displayName: typeof parsed?.displayName === 'string' ? parsed.displayName : '',
      phone: typeof parsed?.phone === 'string' ? parsed.phone : '',
      accent: typeof parsed?.accent === 'string' ? parsed.accent : 'indigo',
      bannerUrl: typeof parsed?.bannerUrl === 'string' ? parsed.bannerUrl : '',
    };
  } catch {
    return { ...DEFAULT_AGENT_PROFILE };
  }
}

export async function saveAgentProfile(profile) {
  const safe = {
    displayName: String(profile?.displayName || '').slice(0, 100).trim(),
    phone: String(profile?.phone || '').slice(0, 32).trim(),
    accent: String(profile?.accent || 'indigo').slice(0, 24),
    bannerUrl: String(profile?.bannerUrl || '').slice(0, 1024),
  };
  await storage.setItem(AGENT_PROFILE_KEY, JSON.stringify(safe));
  return safe;
}

// Format a phone-ish string as (XXX) XXX-XXXX as the user types.
// Tolerates partial input; doesn't reject non-digits.
export function formatPhone(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Pick two initials (first letter of first two non-empty tokens) for
// the avatar fallback. Falls back to first letter of email.
export function initialsFor(displayName, email) {
  const name = String(displayName || '').trim();
  if (name) {
    const tokens = name.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
    if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  }
  return String(email || '?').slice(0, 1).toUpperCase();
}
