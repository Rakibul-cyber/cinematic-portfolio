import { absoluteUrl } from "@/lib/seo/canonical";

/**
 * Crawl policy for the whole application.
 *
 * `robots.txt` is a public file, so it names only path prefixes that are
 * already discoverable. Nothing secret is disclosed by listing them, and
 * excluding them keeps private surfaces out of search results and out of
 * crawl budget.
 *
 * This is a crawling directive, not an access control: `/admin` is protected by
 * server-side authorization, and a crawler ignoring this file still gets a
 * redirect to the login page.
 */

/** Path prefixes that must never be crawled or indexed. */
export const DISALLOWED_PREFIXES = ["/admin", "/api/"] as const;

export type RobotsDocument = {
  rules: { userAgent: string; allow: string; disallow: string[] }[];
  sitemap?: string;
};

export function buildRobots(origin: string | null | undefined): RobotsDocument {
  const sitemap = absoluteUrl(origin, "/sitemap.xml");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOWED_PREFIXES],
      },
    ],
    // Omitted rather than guessed when the deployment origin is unknown: a
    // sitemap reference pointing at the wrong host is worse than none. No
    // `host` directive is emitted either -- it is a single-engine extension
    // most crawlers ignore, and the canonical link on every page already names
    // the authoritative origin.
    ...(sitemap ? { sitemap } : {}),
  };
}
