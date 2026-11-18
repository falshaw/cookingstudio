import type { Metadata } from "next";
import { Onest, Hanken_Grotesk, Tilt_Neon, Monoton } from "next/font/google";
import "./globals.css";
import "./neon-theme.css";

// Type: Onest display behind a Segoe UI stack, Hanken Grotesk body.
const display = Onest({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Neon night market: Tilt Neon = neon-tube headings, Monoton = the one big sign (wordmark, dashboard, login).
const neon = Tilt_Neon({ subsets: ["latin"], variable: "--font-neon", display: "swap" });
const sign = Monoton({ subsets: ["latin"], weight: "400", variable: "--font-sign", display: "swap" });

const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// Every page renders per request so the per-request CSP nonce from the proxy reaches Next's
// scripts — including the 404 page, which is otherwise prerendered and blocked by the nonce CSP.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CookingStudio — learn to cook together",
  description:
    "Cooking practice for your household. Private, self-hosted.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${neon.variable} ${sign.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
