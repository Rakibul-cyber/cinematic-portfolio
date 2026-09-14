/**
 * Canonical URL construction for the public site.
 *
 * Pure and free of environment access: callers pass the configured origin in,
 * which keeps the rules — one spelling per page, no query strings, no trailing
 * slash — assertable without a running application.
 *
 * A canonical URL is a promise to search engines that one address is the
 * authoritative one. `/work` and `/work?category=film` are the same document
 * with a filter applied, so the query never survives normalization.
 */

/** Paths the public site advertises. Kept here so sitemap and canonical agree. */
export const PUBLIC_ROUTES = ["/", "/work", "/services", "/about", "/contact"] as const;

/** Absolute path of the generated fallback share image. */
export const OG_FALLBACK_PATH = "/opengraph-image";

/**
 * Reduces a path to its canonical spelling: one leading slash, no query, no
 * fragment, and no trailing slash except at the root.
 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0].trim();
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");

  return collapsed === "/" ? "/" : collapsed.replace(/\/+$/, "");
}

/**
 * Strips a trailing slash from a configured origin so joining never produces a
 * doubled separator. Returns `null` for anything that is not an absolute
 * http(s) origin, so a misconfigured value yields no canonical rather than a
 * plausible-looking wrong one.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Absolute URL for a public path, or `null` when no origin is configured.
 *
 * Returning `null` rather than a relative string is deliberate: an absolute URL
 * is required by canonical links, Open Graph, JSON-LD, and sitemaps alike, and
 * a half-formed one is worse than none.
 */
export function absoluteUrl(
  origin: string | null | undefined,
  path: string,
): string | null {
  const base = normalizeOrigin(origin);

  return base ? `${base}${normalizePath(path)}` : null;
}
