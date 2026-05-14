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
  // Theme — 'light' | 'dark' | 'system'. System follows OS preference.
  theme: 'light',
  // Avatar photo — compressed JPEG data URL (target ~50KB).
  avatarUrl: '',
  // Banner image — compressed JPEG data URL (target ~180KB).
  bannerUrl: '',
  // Preferences.
  language: 'en',           // 'en' | 'es' — feeds PRIM Assistant
  defaultLeadSource: '',    // empty = no default
  emailDigest: 'weekly',    // 'weekly' | 'never'
  productUpdates: true,     // true = receive product update emails
};

export const THEME_OPTIONS = ['light', 'system', 'dark'];

/**
 * Apply a theme preference to <html>. Adds/removes the `.dark` class
 * which Tailwind reads via the @custom-variant declaration in
 * globals.css. 'system' follows the OS-level prefers-color-scheme.
 * Safe to call on the server (no-op).
 */
export function applyThemeToDOM(theme) {
  if (typeof document === 'undefined') return;
  const t = THEME_OPTIONS.includes(theme) ? theme : 'light';
  const html = document.documentElement;
  let isDark;
  if (t === 'dark') isDark = true;
  else if (t === 'light') isDark = false;
  else {
    // system
    isDark = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  html.classList.toggle('dark', isDark);
  // Stash the resolved preference so a re-render can re-apply system
  // changes via the matchMedia listener installed by ThemeProvider.
  html.dataset.themePref = t;
}

/**
 * Per-kind size + quality presets for profile image compression.
 *   - avatar: 384x384 max @ 0.85 quality → ~30-60KB JPEG, looks crisp at 192px display.
 *   - banner: 1600x400 max @ 0.75 quality → ~120-200KB JPEG, hero strip width.
 * Output is a data URL so we can store it inline in user_kv without
 * needing a separate Supabase Storage bucket. If a row ever feels too
 * big, we can swap this for Storage in a later refactor — the callers
 * only see "save this image", they don't care where it lives.
 */
const PROFILE_IMAGE_PRESETS = {
  avatar: { maxDim: 384, quality: 0.85, mime: 'image/jpeg' },
  banner: { maxDim: 1600, quality: 0.75, mime: 'image/jpeg' },
};

export async function compressForProfile(file, kind = 'avatar') {
  if (!file) return null;
  const preset = PROFILE_IMAGE_PRESETS[kind] || PROFILE_IMAGE_PRESETS.avatar;
  if (typeof window === 'undefined') return null;
  if (!file.type?.startsWith('image/')) {
    throw new Error('Please pick an image file (PNG, JPG, or WebP).');
  }
  // Read the file into an <img> element via an object URL so we can
  // measure it and render to a canvas.
  const objectUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = (e) => reject(e);
      i.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  const { width, height } = img;
  let targetW = width;
  let targetH = height;
  if (kind === 'avatar') {
    // Square crop from the center, then downscale to the preset.
    const side = Math.min(width, height);
    const sx = Math.round((width - side) / 2);
    const sy = Math.round((height - side) / 2);
    targetW = Math.min(side, preset.maxDim);
    targetH = targetW;
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, targetW, targetH);
    return canvasToDataUrl(canvas, preset);
  }
  // Banner: scale-to-fit, preserving aspect, capped to maxDim wide.
  if (width > preset.maxDim) {
    targetW = preset.maxDim;
    targetH = Math.round((height / width) * preset.maxDim);
  }
  // Optionally cap height too so absurdly tall images stay reasonable.
  const MAX_BANNER_H = 600;
  if (targetH > MAX_BANNER_H) {
    targetH = MAX_BANNER_H;
    targetW = Math.round((width / height) * MAX_BANNER_H);
  }
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvasToDataUrl(canvas, preset);
}

function canvasToDataUrl(canvas, preset) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Image compression failed.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({
        dataUrl: reader.result,
        sizeBytes: blob.size,
      });
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, preset.mime, preset.quality);
  });
}

/**
 * Accent palette presets. Each one drives:
 *   --prim-accent-from / --prim-accent-to  (gradient endpoints)
 *   --prim-accent-solid                    (solid hex, e.g. for badges)
 *   --prim-accent-ring                     (focus ring color, rgba)
 *
 * Tailwind `indigo` is the historic default; new agents land on it
 * so production looks unchanged unless they explicitly pick a theme.
 */
/**
 * Each palette has two background tints:
 *   - bgTint     → used in LIGHT mode (barely-there wash)
 *   - bgTintDark → used in DARK mode (very dark, faintly tinted toward
 *                  the accent so the canvas feels intentional, not
 *                  identical to the cards on top of it)
 * Cards (the `bg-white` surfaces) are a separate, lighter slate via
 * the dark utility overrides in globals.css. The two together give
 * clear surface hierarchy in dark mode.
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
    bgTint:     '#F8FAFC',
    bgTintDark: '#0B1220', // deep navy-slate
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Money green. Bold and growth-oriented.',
    from: '#10B981',
    to:   '#14B8A6',
    solid: '#10B981',
    ring: '16 185 129',
    bgTint:     '#F0FDF4',
    bgTintDark: '#0A1A18', // deep forest
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'Warm energy. Stands out without being loud.',
    from: '#F43F5E',
    to:   '#EC4899',
    solid: '#F43F5E',
    ring: '244 63 94',
    bgTint:     '#FFF5F7',
    bgTintDark: '#1A0E15', // deep wine
  },
  {
    id: 'amber',
    name: 'Amber',
    description: 'Sunset gold. Premium and confident.',
    from: '#F59E0B',
    to:   '#EF4444',
    solid: '#F59E0B',
    ring: '245 158 11',
    bgTint:     '#FFFBEB',
    bgTintDark: '#171208', // deep coffee
  },
  {
    id: 'teal',
    name: 'Teal',
    description: 'Cool ocean. Clean and modern.',
    from: '#06B6D4',
    to:   '#3B82F6',
    solid: '#06B6D4',
    ring: '6 182 212',
    bgTint:     '#F0FDFA',
    bgTintDark: '#0A1A1E', // deep ocean
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
  // Write BOTH the light and dark page tints. The .bg-prim-canvas
  // utility in globals.css picks whichever is appropriate based on
  // whether the .dark class is on <html>. This keeps theme + accent
  // independent so toggling dark mode doesn't lose the accent flavor.
  root.style.setProperty('--prim-bg-tint-light', p.bgTint || '#F8FAFC');
  root.style.setProperty('--prim-bg-tint-dark',  p.bgTintDark || '#0B1220');
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
      theme: THEME_OPTIONS.includes(parsed?.theme) ? parsed.theme : 'light',
      avatarUrl: typeof parsed?.avatarUrl === 'string' ? parsed.avatarUrl : '',
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
  // Images are data URLs (~50KB avatar / ~180KB banner) — large but still
  // well within user_kv JSONB limits. Hard ceilings prevent a runaway
  // upload from blowing the row.
  const MAX_AVATAR_LEN = 200 * 1024;   // ~150KB image headroom
  const MAX_BANNER_LEN = 400 * 1024;   // ~300KB image headroom
  const rawAvatar = typeof profile?.avatarUrl === 'string' ? profile.avatarUrl : '';
  const rawBanner = typeof profile?.bannerUrl === 'string' ? profile.bannerUrl : '';
  const safeAvatar = rawAvatar.length <= MAX_AVATAR_LEN ? rawAvatar : '';
  const safeBanner = rawBanner.length <= MAX_BANNER_LEN ? rawBanner : '';
  const safeTheme = THEME_OPTIONS.includes(profile?.theme) ? profile.theme : 'light';
  const safe = {
    displayName: String(profile?.displayName || '').slice(0, 100).trim(),
    phone: String(profile?.phone || '').slice(0, 32).trim(),
    accent: safeAccent,
    theme: safeTheme,
    avatarUrl: safeAvatar,
    bannerUrl: safeBanner,
    language: safeLang,
    defaultLeadSource: String(profile?.defaultLeadSource || '').slice(0, 64).trim(),
    emailDigest: safeDigest,
    productUpdates: profile?.productUpdates !== false,
  };
  await storage.setItem(AGENT_PROFILE_KEY, JSON.stringify(safe));
  // Mirror language to the legacy chatbot key so AgentChatbot.jsx (which
  // owns its own LANG_KEY load) picks the new value up without a refactor.
  try { await storage.setItem(CHAT_LANGUAGE_KEY, JSON.stringify(safeLang)); } catch { /* ignore */ }
  // Apply accent + theme immediately so the UI reflects changes before remount.
  applyAccentToDOM(safe.accent);
  applyThemeToDOM(safe.theme);
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
