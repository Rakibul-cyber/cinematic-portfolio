/**
 * Cache tags shared by the public read layer and the admin mutations that
 * invalidate it.
 *
 * Public pages render from the Next.js cache; an admin save calls
 * `revalidateTag` with the tags below so the change is visible on the next
 * public request instead of waiting for a time-based revalidation. Keeping the
 * names in one plain module means a mutation and the query it affects cannot
 * drift apart silently.
 */
export const PublicTag = {
  Projects: "public:projects",
  Categories: "public:categories",
  Services: "public:services",
  Testimonials: "public:testimonials",
  Settings: "public:settings",
  Pages: "public:pages",
  /** Media metadata (alt text, caption) reused by every project rendering. */
  Media: "public:media",
} as const;

export type PublicTag = (typeof PublicTag)[keyof typeof PublicTag];

/** Every public tag, for changes whose blast radius is the whole site. */
export const ALL_PUBLIC_TAGS: readonly PublicTag[] = Object.values(PublicTag);

/**
 * Time-based safety net, in seconds.
 *
 * Tag invalidation is the primary freshness mechanism; this bounds staleness
 * if a mutation ever fails to invalidate, without making pages dynamic.
 *
 * Route segments cannot import this value — Next.js requires a literal in
 * `export const revalidate` — so each public page repeats 3600 with a comment
 * pointing back here. Change both together.
 */
export const PUBLIC_REVALIDATE_SECONDS = 3600;
