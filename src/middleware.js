// src/middleware.js
import { NextResponse } from 'next/server';
import { classifyHost, routeDecision } from '@/lib/hostRouting.mjs';

const APP_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.primtracker.com';
const MKT_ORIGIN = process.env.NEXT_PUBLIC_MARKETING_URL || 'https://www.primtracker.com';

export function middleware(request) {
  const url = request.nextUrl;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const bareHost = host.toLowerCase().split(':')[0];

  // Preview-only override so the marketing branch is testable before production.
  const isPreview = bareHost.endsWith('.vercel.app');
  const previewAsMarketing = isPreview &&
    (url.searchParams.get('__host') === 'marketing' || process.env.PREVIEW_AS_MARKETING === '1');

  // Master flip: www/apex serve the app until the owner sets this at cutover.
  const marketingSplitEnabled = process.env.MARKETING_SPLIT_ENABLED === '1';

  const role = classifyHost(host, { previewAsMarketing, marketingSplitEnabled });
  const decision = routeDecision(role, url.pathname);

  // The layout reads this to stay in lock-step with the middleware's role
  // decision (incl. the flag + preview override) — no duplicated classification.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-prim-role', role);

  // Inert until cutover: while the split flag is OFF, www/apex IS the current
  // COMBINED production host (not the app subdomain), so it must behave exactly
  // as today — a pure pass-through. Skip the app-role `/landing`→marketing 308
  // and the `noindex` header, both of which are only correct for the real
  // app.primtracker.com subdomain. (app.primtracker.com is never www/apex, so it
  // always keeps full app-role behavior regardless of the flag.)
  const isApexOrWww = bareHost === 'www.primtracker.com' || bareHost === 'primtracker.com';
  if (isApexOrWww && !marketingSplitEnabled) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let res;
  if (decision.type === 'rewrite') {
    const to = url.clone();
    to.pathname = decision.to;
    res = NextResponse.rewrite(to, { request: { headers: requestHeaders } });
  } else if (decision.type === 'redirect') {
    let target = decision.to;
    if (target.startsWith('APP:')) target = APP_ORIGIN + target.slice(4);
    else if (target.startsWith('MKT:')) target = MKT_ORIGIN + target.slice(4);
    else target = new URL(target, url).toString();
    const redirectUrl = new URL(target);
    if (redirectUrl.search === '') redirectUrl.search = url.search; // preserve query (e.g. /admin?ticket=)
    res = NextResponse.redirect(redirectUrl, decision.status || 308);
  } else {
    res = NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (role === 'app') res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|email-assets|favicon.ico|robots.txt|sitemap.xml).*)'],
};
