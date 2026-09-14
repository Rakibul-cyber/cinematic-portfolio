import "server-only";

import type { Metadata } from "next";

import { fallbackMetadata, FALLBACK_STUDIO_NAME } from "@/content/site";
import { normalizeOrigin } from "@/lib/seo/canonical";
import { buildMetadataDocument } from "@/lib/seo/metadata-document";
import { getPublicSiteSettings } from "@/server/public/queries";

/**
 * Metadata for public pages.
 *
 * This module does one thing the pure builder cannot: read the CMS. The
 * document itself — title precedence, canonical URL, Open Graph, Twitter card,
 * robots directives, and the share-image fallback — is assembled by
 * `buildMetadataDocument`, which is exercised directly by `npm test` and
 * `npm run seo:verify`.
 */

/**
 * Absolute origin used for canonical URLs, Open Graph, JSON-LD, the sitemap,
 * and `robots.txt`.
 *
 * `BETTER_AUTH_URL` is the deliberate second choice: it is already required to
 * be this application's absolute origin, so a deployment that configured
 * authentication has a correct value even before the SEO variable is set.
 * Returns `null` rather than a guess when neither is usable.
 */
export function siteOrigin(): string | null {
  return (
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeOrigin(process.env.BETTER_AUTH_URL)
  );
}

export type PublicMetadataInput = {
  /** Preferred title, e.g. a project's SEO title or its plain title. */
  title?: string | null;
  description?: string | null;
  /** Absolute path of this page, used as the canonical URL. */
  path: string;
  imageUrl?: string | null;
};

export async function buildPublicMetadata(
  input: PublicMetadataInput,
): Promise<Metadata> {
  const settings = await getPublicSiteSettings();

  return buildMetadataDocument({
    title: input.title,
    description: input.description,
    path: input.path,
    imageUrl: input.imageUrl,
    studioName: settings?.studioName ?? FALLBACK_STUDIO_NAME,
    defaultTitle: settings?.defaultSeoTitle,
    defaultDescription: settings?.defaultSeoDescription,
    fallbackDescription: fallbackMetadata.description,
    origin: siteOrigin(),
  });
}
