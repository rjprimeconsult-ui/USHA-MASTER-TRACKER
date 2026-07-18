import { Geist, Geist_Mono, Sora } from "next/font/google";
import { headers } from 'next/headers';
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthGate from "@/components/auth/AuthGate";
import ThemeProvider from "@/components/ThemeProvider";
import { classifyHost } from '@/lib/hostRouting.mjs';

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

export const metadata = {
  title: "PRIM — Performance, Revenue & Investment Manager",
  description: "Multi-channel agent tracker for leads, commissions, and CPA.",
};

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
