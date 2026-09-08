import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";

import { PublicTag } from "@/server/public/cache-tags";

/**
 * Public-cache invalidation for admin mutations.
 *
 * Editors expect a save to be visible on the public site immediately, so every
 * CMS mutation declares what it changed and this module purges both layers:
 * the tagged data cache behind the public query layer, and the full route
 * cache for the pages that render it.
 *
 * Keeping the mapping here — rather than at each call site — is what stops a
 * new page from quietly serving stale content after someone adds a mutation.
 */
export type PublicContentKind =
  | "project"
  | "category"
  | "service"
  | "testimonial"
  | "page"
  | "settings"
  | "media";

const TAGS: Record<PublicContentKind, readonly string[]> = {
  project: [PublicTag.Projects, PublicTag.Categories],
  category: [PublicTag.Categories, PublicTag.Projects],
  service: [PublicTag.Services],
  testimonial: [PublicTag.Testimonials],
  page: [PublicTag.Pages],
  settings: [PublicTag.Settings],
  media: [PublicTag.Media, PublicTag.Projects],
};

/**
 * Routes each kind of change can appear on.
 *
 * The homepage is in every list because it composes work, services, the studio
 * statement, testimonials, and settings into one page.
 */
const PATHS: Record<PublicContentKind, readonly string[]> = {
  project: ["/", "/work"],
  category: ["/", "/work"],
  service: ["/", "/services"],
  testimonial: ["/", "/about", "/services"],
  page: ["/", "/about", "/contact", "/services"],
  settings: ["/", "/about", "/contact", "/services", "/work"],
  media: ["/", "/work"],
};

/**
 * Invalidates the public site after a content change.
 *
 * `slug` refreshes one project detail page; project list and homepage
 * invalidation happen regardless, since a renamed or unpublished project also
 * changes where it appears.
 */
export function revalidatePublicContent(
  kind: PublicContentKind,
  options?: { slug?: string | null },
): void {
  for (const tag of TAGS[kind]) {
    revalidateTag(tag);
  }

  for (const path of PATHS[kind]) {
    revalidatePath(path);
  }

  if (kind === "project") {
    // Cover both the specific page and any other detail page whose cached
    // render referenced this project (for example after a slug change).
    if (options?.slug) revalidatePath(`/work/${options.slug}`);
    revalidatePath("/work/[slug]", "page");
  }
}
