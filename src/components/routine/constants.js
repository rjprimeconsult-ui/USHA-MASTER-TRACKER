// Shared class strings + helpers for the Routine components (spec §7).
// Type scale is PRIM's 10 / 11 / 12 / 14 px. LOSS is the ONLY amber text on the
// page — amber means "routine time lost" and nothing else (spec §7c, §7d).
import { PhoneCall, RotateCcw, MessageSquare, Video, MapPin, Sunrise, FileCheck, GraduationCap, Coffee, Plus } from 'lucide-react';
import { paletteById, paletteForCategory } from '@/lib/routinePalette.mjs';

export const TYPE = { xs: 'text-[10px]', sm: 'text-[11px]', md: 'text-[12px]', lg: 'text-[14px]' };
export const SLATE = { meta: 'text-slate-500', quiet: 'text-slate-400', body: 'text-slate-700', strong: 'text-slate-900' };
export const LOSS = 'text-amber-600 dark:text-amber-400';
export const APPT_STRIPE = '#8b5cf6';
// Inline hex tint on purpose (spec §7c): globals.css remaps only the indigo/amber/
// emerald/rose utility backgrounds in .dark, so a category tint must be computed.
export const tint = (hex, isDark) => hex + (isDark ? '33' : '1F');
// Components read `ICONS[pal.icon] || ICONS.Plus` as a member lookup — the React
// compiler lint rejects a component returned from a function call during render.
export const ICONS = { PhoneCall, RotateCcw, MessageSquare, Video, MapPin, Sunrise, FileCheck, GraduationCap, Coffee, Plus };

// Palette entry for a composed item / block: the block's paletteId first, then
// the category's first entry (never null — an unknown category falls back to custom).
export function paletteFor(itemOrBlock) {
  if (!itemOrBlock) return paletteForCategory('custom');
  const owner = itemOrBlock.block || itemOrBlock.makeup || itemOrBlock;
  return paletteById(owner.paletteId) || paletteForCategory(owner.category || itemOrBlock.category);
}

// Reminder lead for a composed item: appointments always 5 (spec §6b); a block or
// make-up follows its own remind record; null when reminders are off for it.
export function leadMinutes(item) {
  if (!item) return null;
  if (item.kind === 'appt') return 5;
  const r = (item.block || item.makeup || item).remind;
  if (!r || r.enabled === false) return null;
  return Number.isFinite(r.minutesBefore) ? r.minutesBefore : null;
}

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // index = Date#getDay (0 = Sunday)
