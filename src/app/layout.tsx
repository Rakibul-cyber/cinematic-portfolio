import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist } from "next/font/google";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { siteContent } from "@/content/site";
import { SITE_THEME_COLOR } from "@/lib/constants";

import "./globals.css";

const displayFont = Cormorant_Garamond({
  variable: "--font-display-source",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

const sansFont = Geist({
  variable: "--font-sans-source",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${siteContent.brand.name} — Photography & Film`,
    template: `%s — ${siteContent.brand.name}`,
  },
  description:
    "A cinematic photography and filmmaking portfolio. Placeholder metadata for the Phase 1 foundation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: SITE_THEME_COLOR,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
