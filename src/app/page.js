'use client';
import dynamic from 'next/dynamic';
import AppSkeleton from '@/components/AppSkeleton';

// Lazy-load the whole app (LeadTracker pulls in all 12 views + charts +
// motion). This keeps the entire app bundle OUT of the public root URL's
// critical path: a logged-out visitor only downloads the auth gate + sign-in
// screen, so the sign-in card paints fast on mobile. AuthGate short-circuits
// to the sign-in screen when there's no user, so this chunk is never even
// requested until someone is authenticated. Authed users see the same
// AppSkeleton during the brief chunk load that they already saw during data
// load — no UX change. ssr:false matches the existing behavior (the app was
// already client-only; the served HTML carried no app content).
const LeadTracker = dynamic(() => import('@/components/LeadTracker'), {
  ssr: false,
  loading: () => <AppSkeleton />,
});

export default function Home() {
  return <LeadTracker />;
}
