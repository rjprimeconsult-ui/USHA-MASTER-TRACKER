// Pure metadata builder for src/app/layout.js (spec §8). The manifest and the
// Apple web-app tags are emitted ONLY for the app host; the marketing host
// keeps the plain title/description.
export const BASE_METADATA = Object.freeze({
  title: 'PRIM — Performance, Revenue & Investment Manager',
  description: 'Multi-channel agent tracker for leads, commissions, and CPA.',
});

export function buildAppMetadata(role) {
  if (role === 'marketing') return { ...BASE_METADATA };
  return {
    ...BASE_METADATA,
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'PRIM' },
    icons: { apple: '/apple-touch-icon.png' },
  };
}
