/**
 * Which category a project save writes, when the editor may leave it unchosen.
 *
 * Every project needs a category (`project.categoryId` is required and public
 * pages show only projects whose category is active), but the project editor
 * no longer asks for one up front:
 *
 * - A category the editor chose is used as-is.
 * - An existing project with no choice keeps its category (nothing is written).
 * - A new project with no choice gets the first active category in the site's
 *   display order (`sortOrder`, then name: the order of the public Work
 *   filters). No category is ever created here; with no active category the
 *   save is refused with instructions.
 */
export type ProjectCategoryDecision =
  | { kind: "set"; categoryId: string }
  | { kind: "keep" }
  | { kind: "missing" };

export function decideProjectCategory(input: {
  chosen: string | null;
  isNew: boolean;
  firstActiveCategoryId: string | null;
}): ProjectCategoryDecision {
  if (input.chosen) return { kind: "set", categoryId: input.chosen };
  if (!input.isNew) return { kind: "keep" };
  return input.firstActiveCategoryId ? { kind: "set", categoryId: input.firstActiveCategoryId } : { kind: "missing" };
}

export const MISSING_CATEGORY_MESSAGE =
  "Add a category under Categories first (for example “Films”), then save the project again.";
