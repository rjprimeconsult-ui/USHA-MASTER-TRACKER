// Which routes render WITHOUT auth. Shared by AuthGate (client) + tests.
// Pure, no imports, node-testable.
export const PUBLIC_ROUTE_PREFIXES = ['/landing', '/pricing', '/privacy', '/terms', '/dpa'];

export function isPublicRoute(pathname, { isMarketingHost = false } = {}) {
  if (!pathname) return false;
  if (isMarketingHost && pathname === '/') return true; // marketing host: root = landing
  return PUBLIC_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
