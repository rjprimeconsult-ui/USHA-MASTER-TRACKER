// Single source of truth for the app origin. In production NEXT_PUBLIC_SITE_URL
// = https://app.primtracker.com; falls back to that literal when unset (local/dev).
export function appUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com';
}
