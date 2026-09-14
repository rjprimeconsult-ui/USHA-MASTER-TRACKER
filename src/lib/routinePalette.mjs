// Routine Builder palette (spec §7d). One hex per category — used for tint,
// stripe, and dot. NEVER Tailwind amber-500: amber text means "routine time
// lost" and nothing else (tripwire in sourceInvariants.test.mjs).
export const CATEGORIES = ['dial', 'followup', 'text', 'appt', 'review', 'admin', 'learn', 'break', 'custom'];

export const PALETTE = [
  { id: 'dial',     name: 'Dial block',              category: 'dial',     hex: '#f43f5e', defaultMin: 120, defaultRemind: true,  icon: 'PhoneCall',     why: 'Protected outbound time. Phone only — no email, no CRM cleanup.' },
  { id: 'followup', name: 'Follow-up queue',         category: 'followup', hex: '#f97316', defaultMin: 75,  defaultRemind: true,  icon: 'RotateCcw',     why: 'Work the people who said "call me back". Oldest first.' },
  { id: 'text',     name: 'Text blast + replies',    category: 'text',     hex: '#0ea5e9', defaultMin: 30,  defaultRemind: true,  icon: 'MessageSquare', why: 'Send the blast, then answer every reply before you move on.' },
  { id: 'webby',    name: 'Webby appointments',      category: 'appt',     hex: '#8b5cf6', defaultMin: 120, defaultRemind: true,  icon: 'Video',         why: 'Back-to-back webinar/Zoom presentations. Camera on, quotes ready.' },
  { id: 'inperson', name: 'In-person appointment',   category: 'appt',     hex: '#8b5cf6', defaultMin: 60,  defaultRemind: true,  icon: 'MapPin',        why: 'Drive time not included — add a block for it.' },
  { id: 'review',   name: 'Morning review',          category: 'review',   hex: '#6366f1', defaultMin: 30,  defaultRemind: true,  icon: 'Sunrise',       why: "Yesterday's misses, today's goals, who's warm." },
  { id: 'admin',    name: 'Apps & underwriting',     category: 'admin',    hex: '#64748b', defaultMin: 60,  defaultRemind: true,  icon: 'FileCheck',     why: 'Submit apps, chase underwriting, clear the paperwork pile.' },
  { id: 'learn',    name: 'Learning',                category: 'learn',    hex: '#10b981', defaultMin: 45,  defaultRemind: true,  icon: 'GraduationCap', why: 'Product training, a recorded call, a script drill. Compounds.' },
  { id: 'break',    name: 'Break',                   category: 'break',    hex: '#94a3b8', defaultMin: 15,  defaultRemind: false, icon: 'Coffee',        why: 'Step away. The next block goes better.' },
  { id: 'custom',   name: 'Make your own block',     category: 'custom',   hex: '#d946ef', defaultMin: 30,  defaultRemind: true,  icon: 'Plus',          why: 'Anything else your day needs. Name it, size it.' },
];

const BY_ID = new Map(PALETTE.map(p => [p.id, p]));
export function paletteById(id) { return BY_ID.get(id) || null; }

const BY_CATEGORY = new Map();
for (const p of PALETTE) if (!BY_CATEGORY.has(p.category)) BY_CATEGORY.set(p.category, p);
// First palette entry of a category — the hex/icon source for a block whose
// paletteId is unknown (an old id after a palette change).
export function paletteForCategory(category) { return BY_CATEGORY.get(category) || BY_ID.get('custom'); }
