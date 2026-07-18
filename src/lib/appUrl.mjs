// Single source of truth for the app origin, used by "open the app" links in
// emails / push / Slack / tickets and the marketing CTAs.
//
// Fallback is www.primtracker.com ON PURPOSE: until the owner sets
// NEXT_PUBLIC_SITE_URL=https://app.primtracker.com at cutover, the app's origin
// IS www.primtracker.com (the subdomain doesn't exist yet). So when the var is
// unset, links must point at www — otherwise the cron/welcome/Slack/ticket links
// (which have no request-origin fallback) would break during the merge→cutover
// window. At cutover, setting the var flips every link to the app subdomain.
export function appUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://www.primtracker.com';
}
