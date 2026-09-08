/**
 * Title and description fallback chain for public pages.
 *
 * Kept pure and separate from the Next.js metadata builder so the precedence
 * rule — page SEO field, then page content, then the CMS global default, then a
 * neutral constant — is asserted directly in tests.
 */
export type MetadataFallbackInput = {
  /** The page's own SEO title, or its natural title. */
  title?: string | null;
  description?: string | null;
  defaultTitle?: string | null;
  defaultDescription?: string | null;
  studioName: string;
  fallbackDescription: string;
};

export function resolveMetadataFields(input: MetadataFallbackInput): {
  title: string;
  description: string;
} {
  return {
    title: input.title?.trim() || input.defaultTitle?.trim() || input.studioName,
    description:
      input.description?.trim() ||
      input.defaultDescription?.trim() ||
      input.fallbackDescription,
  };
}
