/**
 * Shared admin control styles. Kept free of imports so Client Components and
 * tests can use them without pulling in the admin shell's server action.
 * `admin-shell.tsx` re-exports these for existing callers.
 */
export const inputClass =
  "min-h-10 w-full border border-border bg-background px-3";
export const areaClass =
  "min-h-28 w-full border border-border bg-background p-3";
export const buttonClass =
  "min-h-10 border border-border px-4 text-xs font-semibold tracking-wider uppercase hover:border-foreground";
