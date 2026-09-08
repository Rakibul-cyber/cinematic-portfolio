/**
 * Responsive image source selection for the public site.
 *
 * Phase 3 already produces optimized, metadata-free WebP variants at fixed
 * widths, so the public site serves those directly and lets the browser pick a
 * width from `srcset`/`sizes`. Passing them through a second optimizer would
 * re-encode an already-optimal file and add per-request work for no quality
 * gain (see ADR 0005).
 *
 * Pure and free of database and environment access: callers pass in candidates
 * whose URLs were already resolved by the server-side delivery helper.
 */

export type ImageCandidate = {
  width: number;
  height: number;
  url: string;
};

export type PublicImage = {
  /** Fallback for browsers that ignore `srcset`; the largest selected width. */
  src: string;
  srcSet: string;
  /** Intrinsic size of the selected source, used to reserve layout space. */
  width: number;
  height: number;
  /** Empty string means "decorative"; never a fabricated description. */
  alt: string;
  blurDataUrl: string | null;
};

/**
 * Chooses the candidates worth offering for a display width of at most
 * `maxWidth` CSS pixels.
 *
 * Every candidate at or below `maxWidth` is offered, plus the smallest
 * candidate above it — but only when nothing reaches `maxWidth`, so a full
 * 2560px master is never downloaded when a smaller responsive variant already
 * covers the layout.
 */
export function selectImageCandidates(
  candidates: readonly ImageCandidate[],
  maxWidth: number,
): ImageCandidate[] {
  const sorted = [...candidates]
    .filter((candidate) => candidate.width > 0 && candidate.url)
    .sort((a, b) => a.width - b.width);

  if (sorted.length === 0) return [];

  const withinBudget = sorted.filter((candidate) => candidate.width <= maxWidth);
  const reachesBudget = withinBudget.some(
    (candidate) => candidate.width >= maxWidth,
  );

  if (reachesBudget) return withinBudget;

  const smallestAbove = sorted.find((candidate) => candidate.width > maxWidth);

  return smallestAbove ? [...withinBudget, smallestAbove] : withinBudget;
}

/**
 * Builds the `srcset`/`src` pair for a set of candidates, or `null` when no
 * usable source exists so the caller can omit the image entirely.
 */
export function buildPublicImage(
  candidates: readonly ImageCandidate[],
  options: { maxWidth: number; alt: string; blurDataUrl?: string | null },
): PublicImage | null {
  const selected = selectImageCandidates(candidates, options.maxWidth);

  if (selected.length === 0) return null;

  const largest = selected[selected.length - 1];

  return {
    src: largest.url,
    srcSet: selected
      .map((candidate) => `${candidate.url} ${candidate.width}w`)
      .join(", "),
    width: largest.width,
    height: largest.height,
    alt: options.alt,
    blurDataUrl: options.blurDataUrl ?? null,
  };
}
