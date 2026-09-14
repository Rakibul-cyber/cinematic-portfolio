import { absoluteUrl, PUBLIC_ROUTES } from "@/lib/seo/canonical";

/**
 * Sitemap assembly, kept pure so the rules are assertable offline.
 *
 * The route segment in `src/app/sitemap.ts` only supplies the published slugs;
 * every decision about which URLs are advertised, in what order, and with what
 * freshness hints lives here.
 *
 * Only publicly indexable documents appear. `/admin`, `/api`, filtered variants
 * of `/work`, and anything unpublished are absent by construction rather than
 * by a filter applied afterwards.
 */

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  changeFrequency?: ChangeFrequency;
  priority?: number;
};

export type SitemapProject = {
  slug: string;
  /** Last content change, used verbatim as `lastmod`. */
  updatedAt: Date;
};

/** Freshness hints per static route. Hints, not promises. */
const STATIC_ROUTE_HINTS: Record<
  (typeof PUBLIC_ROUTES)[number],
  { changeFrequency: ChangeFrequency; priority: number }
> = {
  "/": { changeFrequency: "weekly", priority: 1 },
  "/work": { changeFrequency: "weekly", priority: 0.9 },
  "/services": { changeFrequency: "monthly", priority: 0.7 },
  "/about": { changeFrequency: "monthly", priority: 0.6 },
  "/contact": { changeFrequency: "yearly", priority: 0.5 },
};

/**
 * Whether a URL is safe to interpolate into the sitemap's XML.
 *
 * Next.js builds `<loc>${url}</loc>` by string concatenation and escapes
 * nothing, so one URL carrying `&`, `<`, `>`, or a quote would produce a
 * malformed document and invalidate the sitemap for every other URL in it.
 *
 * Today nothing can: slugs are validated as `^[a-z0-9]+(?:-[a-z0-9]+)*$` at
 * every CMS write boundary, and an origin comes from `URL.origin`. This guard
 * exists because that safety is an invariant held somewhere else — relax the
 * slug rule, or write a row straight to the database, and the sitemap silently
 * breaks. Unsafe URLs are dropped rather than escaped: escaping would
 * double-encode if Next.js ever starts escaping too, while dropping one URL
 * costs only that URL.
 */
function isXmlSafe(url: string): boolean {
  return !/[<>&"']/.test(url) && ![...url].some((c) => c.charCodeAt(0) < 0x20);
}

/**
 * Every indexable public URL.
 *
 * Returns an empty sitemap when no origin is configured. A sitemap must contain
 * absolute URLs, and guessing a host would publish addresses that do not exist.
 */
export function buildSitemapEntries(input: {
  origin: string | null | undefined;
  projects: readonly SitemapProject[];
  /** Injected so the static-route timestamp is deterministic in tests. */
  now?: Date;
}): SitemapEntry[] {
  const { origin, projects } = input;

  if (!absoluteUrl(origin, "/")) return [];

  const newestProject = projects
    .map((project) => project.updatedAt)
    .sort((a, b) => b.getTime() - a.getTime())
    .at(0);

  const lastModified = newestProject ?? input.now ?? new Date();

  const staticEntries = PUBLIC_ROUTES.filter((route) =>
    isXmlSafe(absoluteUrl(origin, route) as string),
  ).map((route) => ({
    url: absoluteUrl(origin, route) as string,
    lastModified,
    ...STATIC_ROUTE_HINTS[route],
  }));

  const seen = new Set<string>();

  const projectEntries = projects.flatMap((project) => {
    const url = absoluteUrl(origin, `/work/${project.slug}`);

    if (!url || seen.has(url) || !isXmlSafe(url)) return [];
    seen.add(url);

    return [
      {
        url,
        lastModified: project.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.8,
      },
    ];
  });

  return [...staticEntries, ...projectEntries];
}
