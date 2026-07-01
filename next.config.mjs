import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Security response headers (added per the 2026-06-30 audit). These are the
// safe, no-risk hardening headers applied to every route:
//   - X-Frame-Options: DENY   → blocks clickjacking (the app can't be iframed)
//   - X-Content-Type-Options  → no MIME-sniffing of served content
//   - Referrer-Policy         → don't leak full URLs cross-origin
//   - Permissions-Policy      → deny camera/mic/geolocation the app never uses
// NOTE: a Content-Security-Policy is intentionally NOT added here yet — a
// blocking CSP needs report-only tuning against Supabase/Stripe/inline scripts
// before enforcement, or it breaks the live app. Track that as a follow-up.
// HSTS is already served by Vercel and is left as-is.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
