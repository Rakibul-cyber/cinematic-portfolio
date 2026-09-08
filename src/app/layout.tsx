import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist } from "next/font/google";

import { fallbackMetadata, FALLBACK_STUDIO_NAME } from "@/content/site";
import { SITE_THEME_COLOR } from "@/lib/constants";
import { siteOrigin } from "@/server/public/metadata";
import { getPublicSiteSettings } from "@/server/public/queries";

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

/**
 * Site-wide metadata defaults.
 *
 * The studio name and global SEO defaults come from the CMS, so a rename in
 * `/admin/settings` retitles every page. Individual pages override the title
 * through the template below.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSiteSettings();
  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;
  const origin = siteOrigin();

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: {
      default: settings?.defaultSeoTitle ?? studioName,
      template: `%s — ${studioName}`,
    },
    description:
      settings?.defaultSeoDescription ?? fallbackMetadata.description,
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: SITE_THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
