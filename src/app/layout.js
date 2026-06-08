import { Geist, Geist_Mono, Sora } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AuthGate from "@/components/auth/AuthGate";
import ThemeProvider from "@/components/ThemeProvider";

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

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ThemeProvider>
            <AuthGate>{children}</AuthGate>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
