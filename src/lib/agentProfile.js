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

// Storage key the chatbot owns. Profile preferences mirror writes here
// so changing language from either surface stays in sync.
export const CHAT_LANGUAGE_KEY = 'chat_language_v1';

export const DEFAULT_AGENT_PROFILE = {
  displayName: '',
  phone: '',
  // Appearance preset id (see PALETTES below).
  accent: 'indigo',
  // Banner image (data URL or Supabase Storage URL) — reserved for Phase 3.
  bannerUrl: '',
  // Preferences.
  language: 'en',           // 'en' | 'es' — feeds PRIM Assistant
  defaultLeadSource: '',    // empty = no default
  emailDigest: 'weekly',    // 'weekly' | 'never'
  productUpdates: true,     // true = receive product update emails
};

/**
 * Accent palette presets. Each one drives:
 *   --prim-accent-from / --prim-accent-to  (gradient endpoints)
 *   --prim-accent-solid                    (solid hex, e.g. for badges)
 *   --prim-accent-ring                     (focus ring color, rgba)
 *
 * Tailwind `indigo` is the historic default; new agents land on it
 * so production looks unchanged unless they explicitly pick a theme.
 */
export const PALETTES = [
  {
    id: 'indigo',
    name: 'Indigo',
    description: 'Classic PRIM — calm + focused.',
    from: '#6366F1',
    to:   '#8B5CF6',
    solid: '#6366F1',
    ring: '99 102 241',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Money green. Bold and growth-oriented.',
    from: '#10B981',
    to:   '#14B8A6',
    solid: '#10B981',
    ring: '16 185 129',
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Warm energy. Stands out without being loud.',
    from: '#F43F5E',
    to:   '#EC4899',
    solid: '#F43F5E',
    ring: '244 63 94',
  },
  {
    id: 'amber',
    name: 'Amber',
    description: 'Sunset gold. Premium and confident.',
    from: '#F59E0B',
    to:   '#EF4444',
    solid: '#F59E0B',
    ring: '245 158 11',
  },
  {
    id: 'teal',
    name: 'Teal',
    description: 'Cool ocean. Clean and modern.',
    from: '#06B6D4',
    to:   '#3B82F6',
    solid: '#06B6D4',
    ring: '6 182 212',
  },
];

export function getPalette(accentId) {
  return PALETTES.find((p) => p.id === accentId) || PALETTES[0];
}

/**
 * Apply an accent palette to `<html>` by setting CSS variables. Safe
 * to call on the server (no-op when `document` is undefined).
 * Components reference these via inline `style` or via the
 * `.bg-accent-gradient` utility class defined in globals.css.
 */
export function applyAccentToDOM(accentId) {
  if (typeof document === 'undefined') return;
  const p = getPalette(accentId);
  const root = document.documentElement;
  root.style.setProperty('--prim-accent-from', p.from);
  root.style.setProperty('--prim-accent-to', p.to);
  root.style.setProperty('--prim-accent-solid', p.solid);
  root.style.setProperty('--prim-accent-ring', p.ring);
}

export async function loadAgentProfile() {
  try {
    const raw = await storage.getItem(AGENT_PROFILE_KEY);
    // Pull language from the legacy chatbot key as a fallback so agents
    // who set Spanish before this hub existed don't lose it.
    let legacyLang = null;
    try {
      const langRaw = await storage.getItem(CHAT_LANGUAGE_KEY);
      if (langRaw) {
        const parsed = typeof langRaw === 'string' ? JSON.parse(langRaw) : langRaw;
        if (parsed === 'en' || parsed === 'es') legacyLang = parsed;
      }
    } catch { /* ignore */ }

    if (!raw) {
      return { ...DEFAULT_AGENT_PROFILE, language: legacyLang || DEFAULT_AGENT_PROFILE.language };
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const lang = parsed?.language === 'en' || parsed?.language === 'es'
      ? parsed.language
      : (legacyLang || DEFAULT_AGENT_PROFILE.language);
    const digest = parsed?.emailDigest === 'weekly' || parsed?.emailDigest === 'never'
      ? parsed.emailDigest
      : DEFAULT_AGENT_PROFILE.emailDigest;
    return {
      ...DEFAULT_AGENT_PROFILE,
      displayName: typeof parsed?.displayName === 'string' ? parsed.displayName : '',
      phone: typeof parsed?.phone === 'string' ? parsed.phone : '',
      accent: typeof parsed?.accent === 'string' && PALETTES.some(p => p.id === parsed.accent)
        ? parsed.accent : 'indigo',
      bannerUrl: typeof parsed?.bannerUrl === 'string' ? parsed.bannerUrl : '',
      language: lang,
      defaultLeadSource: typeof parsed?.defaultLeadSource === 'string' ? parsed.defaultLeadSource : '',
      emailDigest: digest,
      productUpdates: parsed?.productUpdates !== false,
    };
  } catch {
    return { ...DEFAULT_AGENT_PROFILE };
  }
}

export async function saveAgentProfile(profile) {
  const safeAccent = PALETTES.some(p => p.id === profile?.accent) ? profile.accent : 'indigo';
  const safeLang = profile?.language === 'es' ? 'es' : 'en';
  const safeDigest = profile?.emailDigest === 'never' ? 'never' : 'weekly';
  const safe = {
    displayName: String(profile?.displayName || '').slice(0, 100).trim(),
    phone: String(profile?.phone || '').slice(0, 32).trim(),
    accent: safeAccent,
    bannerUrl: String(profile?.bannerUrl || '').slice(0, 1024),
    language: safeLang,
    defaultLeadSource: String(profile?.defaultLeadSource || '').slice(0, 64).trim(),
    emailDigest: safeDigest,
    productUpdates: profile?.productUpdates !== false,
  };
  await storage.setItem(AGENT_PROFILE_KEY, JSON.stringify(safe));
  // Mirror language to the legacy chatbot key so AgentChatbot.jsx (which
  // owns its own LANG_KEY load) picks the new value up without a refactor.
  try { await storage.setItem(CHAT_LANGUAGE_KEY, JSON.stringify(safeLang)); } catch { /* ignore */ }
  // Apply accent immediately so the UI reflects the change before remount.
  applyAccentToDOM(safe.accent);
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
