/**
 * Homepage work arrangement.
 *
 * Pure, so the hero/grid split is testable without a database. The hero takes
 * the first selected project, but only renders it when that project has a
 * cover; the grid then starts after it, so the same project is never shown
 * twice in a row. A hero without a cover renders no project at all, so the
 * grid keeps it.
 */

/** How many projects the homepage grid shows at most. */
export const HOMEPAGE_GRID_LIMIT = 6;

/** Fallback grid size when nothing is flagged featured. */
export const HOMEPAGE_FALLBACK_LIMIT = 3;

export type HomepageWorkSource = "featured" | "published";

type ArrangeableProject = { slug: string; cover: unknown };

export type HomepageWork<T> = {
  hero: T | null;
  featured: T[];
  /** Whether the grid continues from a project already shown in the hero. */
  heroShown: boolean;
  source: HomepageWorkSource;
};

/**
 * Splits selected projects between the hero and the grid, preserving order.
 * Callers fetch one more than `limit` so a hero pick does not shrink the grid.
 */
export function arrangeHomepageWork<T extends ArrangeableProject>(
  projects: readonly T[],
  source: HomepageWorkSource,
  limit: number,
): HomepageWork<T> {
  const hero = projects.at(0) ?? null;
  const heroShown = Boolean(hero?.cover);
  const featured = (heroShown ? projects.slice(1) : projects.slice()).slice(
    0,
    limit,
  );

  return { hero, featured, heroShown, source };
}

/** A heading that describes what the grid actually contains. */
export function featuredWorkTitle(
  source: HomepageWorkSource,
  heroShown: boolean,
): string {
  if (source === "featured") {
    return heroShown ? "More featured projects" : "Featured projects";
  }
  return heroShown ? "More projects" : "Projects";
}
