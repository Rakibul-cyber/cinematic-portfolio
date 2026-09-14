import type { Metadata } from "next";

import { absoluteUrl, normalizePath, OG_FALLBACK_PATH } from "@/lib/seo/canonical";
import { resolveMetadataFields } from "@/lib/public/metadata-fallback";

/**
 * The complete metadata document for one public page.
 *
 * Pure: every CMS value and the deployment origin are passed in, so the whole
 * SEO surface — canonical URL, Open Graph, Twitter card, robots directives —
 * is assertable without a database or a running application. The server-side
 * wrapper in `src/server/public/metadata.ts` is only the part that reads
 * settings.
 *
 * Precedence for title and description stays exactly where Phase 5 put it
 * (`resolveMetadataFields`): the page's own SEO field, then its natural
 * content, then the CMS global default, then a neutral constant.
 */

export type MetadataDocumentInput = {
  /** The page's own SEO title, or its natural title. */
  title?: string | null;
  description?: string | null;
  /** Absolute path of this page; normalized into the canonical URL. */
  path: string;
  /** Absolute share image URL, normally a project cover from R2. */
  imageUrl?: string | null;
  studioName: string;
  defaultTitle?: string | null;
  defaultDescription?: string | null;
  fallbackDescription: string;
  /** Configured deployment origin, or null before one is set. */
  origin?: string | null;
  /**
   * Set false for pages that exist but must stay out of search results. No
   * public page uses it today; it keeps the decision explicit rather than
   * implied by omission.
   */
  indexable?: boolean;
};

export function buildMetadataDocument(input: MetadataDocumentInput): Metadata {
  const canonicalPath = normalizePath(input.path);
  const canonicalUrl = absoluteUrl(input.origin, canonicalPath);
  const indexable = input.indexable ?? true;

  const { description, title } = resolveMetadataFields({
    title: input.title,
    description: input.description,
    defaultTitle: input.defaultTitle,
    defaultDescription: input.defaultDescription,
    studioName: input.studioName,
    fallbackDescription: input.fallbackDescription,
  });

  // A page with no title of its own falls back to the studio name, and the
  // root template would render it twice ("Studio — Studio"). An absolute title
  // suppresses the template in exactly that case.
  const resolvedTitle =
    title === input.studioName ? { absolute: input.studioName } : title;

  // The generated fallback share image is used only when the page has no image
  // of its own, and only once an origin exists to make it absolute. A relative
  // Open Graph image is not usable by any consumer.
  const shareImage =
    input.imageUrl?.trim() || absoluteUrl(input.origin, OG_FALLBACK_PATH);
  const images = shareImage ? [shareImage] : [];

  return {
    title: resolvedTitle,
    description,
    // Relative when no origin is configured: Next.js still emits a usable
    // same-site canonical, and nothing invents a hostname.
    alternates: { canonical: canonicalUrl ?? canonicalPath },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: input.studioName,
      title,
      description,
      url: canonicalUrl ?? canonicalPath,
      ...(images.length ? { images: images.map((url) => ({ url })) } : {}),
    },
    twitter: {
      // The studio has no Twitter handle in the CMS, so none is claimed. The
      // large-image card works without one.
      card: images.length ? "summary_large_image" : "summary",
      title,
      description,
      ...(images.length ? { images } : {}),
    },
  };
}
