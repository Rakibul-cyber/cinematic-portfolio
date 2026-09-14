import type { MetadataRoute } from "next";

import { buildSitemapEntries } from "@/lib/seo/sitemap-entries";
import { siteOrigin } from "@/server/public/metadata";
import { getPublishedProjectSitemapRows } from "@/server/public/queries";

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts, which is the documented safety net;
// admin saves invalidate by tag long before this elapses.
export const revalidate = 3600;

/**
 * `/sitemap.xml`.
 *
 * Thin by design: which URLs are advertised, in what order, and with what
 * freshness hints is decided by `buildSitemapEntries`, which is pure and
 * verified offline. This file only supplies the published slugs.
 *
 * The underlying query is cached and tagged like every other public read, so
 * publishing a project refreshes the sitemap on the next request rather than
 * after the one-hour safety net elapses.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();

  // Without a configured origin there are no absolute URLs to advertise, and
  // guessing a host would publish addresses that do not exist.
  if (!origin) return [];

  const rows = await getPublishedProjectSitemapRows();

  return buildSitemapEntries({
    origin,
    projects: rows.map((row) => ({
      slug: row.slug,
      updatedAt: new Date(row.updatedAt),
    })),
  });
}
