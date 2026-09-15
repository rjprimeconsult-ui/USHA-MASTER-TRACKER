import { Geist, Geist_Mono, Sora } from "next/font/google";
import { headers } from 'next/headers';
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthGate from "@/components/auth/AuthGate";
import ThemeProvider from "@/components/ThemeProvider";
import { classifyHost } from '@/lib/hostRouting.mjs';
import { buildAppMetadata } from '@/lib/appMetadata.mjs';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Slim numeric font for KPI values (Dashboard).
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Manifest + Apple web-app tags only on the app host (spec 2026-09-07 §8).
// Same role resolution as RootLayout below — middleware header first.
export async function generateMetadata() {
  const h = await headers();
  const role = h.get('x-prim-role')
    || classifyHost(h.get('x-forwarded-host') || h.get('host') || '', { marketingSplitEnabled: process.env.MARKETING_SPLIT_ENABLED === '1' });
  return buildAppMetadata(role);
}

export default async function RootLayout({ children }) {
  const h = await headers(); // Next 16: headers() is async
  const role = h.get('x-prim-role') // set by middleware (authoritative — honors flag + preview override)
    || classifyHost(h.get('x-forwarded-host') || h.get('host') || '',
         { marketingSplitEnabled: process.env.MARKETING_SPLIT_ENABLED === '1' }); // safety-net fallback
  const isMarketingHost = role === 'marketing';
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ThemeProvider>
            <AuthGate isMarketingHost={isMarketingHost}>{children}</AuthGate>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
