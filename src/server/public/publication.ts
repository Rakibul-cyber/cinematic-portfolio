/**
 * Publication rules for public reads.
 *
 * Every public query composes its filter from this module rather than writing
 * its own `where` clause, so "published only" and "active only" are defined
 * once and enforced in the database. Nothing public filters in the UI: an
 * unpublished project is never fetched, so knowing its URL reveals nothing.
 *
 * Pure Prisma argument objects, so the rules can be asserted in tests without
 * a database connection.
 */

/** Only `PUBLISHED` projects are ever readable publicly. */
export const PUBLISHED_PROJECT_WHERE = {
  status: "PUBLISHED",
  category: { isActive: true },
} as const;

/**
 * Deterministic project order: curated `sortOrder`, then most recently
 * published, then slug so equal rows never reorder between requests.
 *
 * The orderings are factories rather than shared constants so each query gets
 * its own mutable array, which is what Prisma's argument types expect.
 */
export function projectOrderBy() {
  return [
    { sortOrder: "asc" as const },
    { publishedAt: "desc" as const },
    { slug: "asc" as const },
  ];
}

/** Deterministic gallery order inside a project. */
export function projectMediaOrderBy() {
  return [{ sortOrder: "asc" as const }, { mediaId: "asc" as const }];
}

/** Shared shape for the CMS entities that carry an active flag. */
export const ACTIVE_WHERE = { isActive: true } as const;

/** Deterministic order for active CMS lists, with a stable name tiebreak. */
export function activeOrderBy<Field extends string>(tiebreak: Field) {
  return [
    { sortOrder: "asc" as const },
    { [tiebreak]: "asc" as const } as Record<Field, "asc">,
  ];
}

/** Page keys the public site is allowed to read. */
export const PUBLIC_PAGE_KEYS = ["about", "contact", "services"] as const;

export type PublicPageKey = (typeof PUBLIC_PAGE_KEYS)[number];
