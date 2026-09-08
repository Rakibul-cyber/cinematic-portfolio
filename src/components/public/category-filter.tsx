import Link from "next/link";

import { cn } from "@/lib/utils";
import type { PublicCategory } from "@/server/public/view-models";

type CategoryFilterProps = {
  categories: readonly PublicCategory[];
  /** Slug of the active category, or null for "all work". */
  activeSlug: string | null;
};

/**
 * Category filtering for the work index.
 *
 * Plain links with a query string, rendered on the server: no client state, no
 * JavaScript, shareable URLs, and working browser history. Only active
 * categories that contain published work are offered, so a filter can never
 * lead to an empty result.
 *
 * The filter disappears below two categories, where it would only add noise.
 */
export function CategoryFilter({ activeSlug, categories }: CategoryFilterProps) {
  if (categories.length < 2) return null;

  const options = [
    { name: "All work", slug: null },
    ...categories.map((category) => ({ ...category, slug: category.slug })),
  ];

  return (
    <nav aria-label="Filter work by category">
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {options.map((option) => {
          const isActive = option.slug === activeSlug;

          return (
            <li key={option.slug ?? "all"}>
              <Link
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center text-[0.6875rem] font-semibold tracking-[0.14em] uppercase transition-colors hover:text-foreground",
                  isActive
                    ? "text-foreground underline underline-offset-8"
                    : "text-muted-foreground",
                )}
                href={option.slug ? `/work?category=${option.slug}` : "/work"}
              >
                {option.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
