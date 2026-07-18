// Pure host classification + middleware route decisions for the marketing/app
// subdomain split. NO `next` imports so it runs under `node --test`.
// Cross-host redirect targets are returned as `APP:<path>` / `MKT:<path>`
// sentinels; middleware resolves them to absolute URLs via env (keeps this pure).

export function classifyHost(rawHost, { previewAsMarketing = false, marketingSplitEnabled = false } = {}) {
  const host = String(rawHost || '').toLowerCase().split(':')[0].trim();
  if (!host) return 'app';
  if (host === 'app.primtracker.com') return 'app';
  if (host === 'www.primtracker.com' || host === 'primtracker.com') {
    // Master flip (MARKETING_SPLIT_ENABLED): OFF → www keeps serving the app, so
    // merging is inert; ON (final cutover step) → www becomes marketing.
    return marketingSplitEnabled ? 'marketing' : 'app';
  }
  if (host.endsWith('.vercel.app')) return previewAsMarketing ? 'marketing' : 'app';
  return 'app'; // localhost / 127.0.0.1 / unknown → app (dev unchanged, safe default)
}

export function routeDecision(role, pathname) {
  // /api, /_next, static, /email-assets are excluded by the middleware matcher
  // and never reach here.
  if (role === 'marketing') {
    if (pathname === '/') return { type: 'rewrite', to: '/landing' };
    if (pathname === '/landing') return { type: 'redirect', to: '/', status: 308 };
    if (pathname === '/pricing' || pathname.startsWith('/pricing/')) return { type: 'redirect', to: 'APP:/pricing', status: 308 };
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return { type: 'redirect', to: 'APP:' + pathname, status: 308 };
    return { type: 'next' };
  }
  if (pathname === '/landing' || pathname.startsWith('/landing/')) return { type: 'redirect', to: 'MKT:/', status: 308 };
  return { type: 'next' };
}
