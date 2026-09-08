import "server-only";

import type { Metadata } from "next";

import { fallbackMetadata, FALLBACK_STUDIO_NAME } from "@/content/site";
import { resolveMetadataFields } from "@/lib/public/metadata-fallback";
import { getPublicSiteSettings } from "@/server/public/queries";

/**
 * Metadata foundation for public pages.
 *
 * A deliberately small layer: page title, description, canonical path, and an
 * optional share image, each resolved through the same fallback chain — the
 * page's own SEO field, then its natural content, then the CMS global default,
 * then a neutral constant. The full SEO system (sitemap, JSON-LD, robots,
 * Twitter cards) belongs to Phase 9.
 */

/** Absolute origin used for canonical and Open Graph URLs. */
export function siteOrigin(): string | undefined {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BETTER_AUTH_URL;
}

export type PublicMetadataInput = {
  /** Preferred title, e.g. a project's SEO title or its plain title. */
  title?: string | null;
  description?: string | null;
  /** Absolute path of this page, used as the canonical URL. */
  path: string;
  imageUrl?: string | null;
};

export async function buildPublicMetadata({
  description,
  imageUrl,
  path,
  title,
}: PublicMetadataInput): Promise<Metadata> {
  const settings = await getPublicSiteSettings();
  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;

  const { description: resolvedDescription, title: resolvedTitle } =
    resolveMetadataFields({
      title,
      description,
      defaultTitle: settings?.defaultSeoTitle,
      defaultDescription: settings?.defaultSeoDescription,
      studioName,
      fallbackDescription: fallbackMetadata.description,
    });

  return {
    // When a page has no title of its own the fallback is the studio name, and
    // the root template would render it twice ("Studio — Studio"). An absolute
    // title suppresses the template in exactly that case.
    title:
      resolvedTitle === studioName ? { absolute: studioName } : resolvedTitle,
    description: resolvedDescription,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: studioName,
      title: resolvedTitle,
      description: resolvedDescription,
      url: path,
      // Share images come from the media delivery helper, so no storage path
      // is constructed here.
      ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
    },
  };
}
