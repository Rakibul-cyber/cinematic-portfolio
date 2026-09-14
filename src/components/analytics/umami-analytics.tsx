import Script from "next/script";

import { resolveUmamiConfig, UMAMI_SCRIPT_ID } from "@/lib/analytics/umami";

/**
 * Optional, cookieless analytics.
 *
 * Renders nothing at all when analytics is not configured — no script tag, no
 * request, no placeholder, and no warning. That is the default state, and it is
 * a valid one.
 *
 * Mounted once, in the public layout only. The admin area is never measured:
 * it is a private workspace whose page views are not useful data and whose URLs
 * carry record identifiers.
 *
 * The stable `id` is what prevents a duplicate tracker. Next.js deduplicates
 * `next/script` by id, so even a second mount — a future layout nesting
 * mistake, say — loads the tracker once and counts each view once.
 *
 * Route changes need no code here: the Umami tracker patches the History API
 * itself, so client-side navigation between public pages is counted without a
 * router subscription of our own.
 */
export function UmamiAnalytics() {
  const config = resolveUmamiConfig({
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    UMAMI_WEBSITE_ID: process.env.UMAMI_WEBSITE_ID,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
  });

  if (!config) return null;

  return (
    <Script
      data-website-id={config.websiteId}
      id={UMAMI_SCRIPT_ID}
      src={config.scriptUrl}
      strategy="afterInteractive"
    />
  );
}
