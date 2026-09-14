import "server-only";

import { FALLBACK_STUDIO_NAME, fallbackMetadata } from "@/content/site";
import {
  absoluteUrl,
  normalizeOrigin,
  OG_FALLBACK_PATH,
} from "@/lib/seo/canonical";
import {
  buildBreadcrumbLd,
  buildOrganizationLd,
  buildProjectLd,
  buildWebSiteLd,
  type BreadcrumbStep,
  type JsonLdObject,
  type SiteIdentity,
} from "@/lib/seo/structured-data";
import { siteOrigin } from "@/server/public/metadata";
import { getActiveSocialLinks, getPublicSiteSettings } from "@/server/public/queries";
import type { PublicProjectDetail } from "@/server/public/view-models";

/**
 * CMS-backed structured data.
 *
 * The pure builders in `src/lib/seo/structured-data.ts` decide the shape; this
 * module supplies the content, and only from site settings and active social
 * links. Both reads are already cached and tagged by the public read layer, so
 * adding structured data costs no extra database round trip.
 *
 * Every function returns an empty graph when no deployment origin is
 * configured. Structured data is addressed entirely by absolute URL, and a
 * graph of relative references describes nothing.
 */

async function siteIdentity(): Promise<SiteIdentity | null> {
  const origin = normalizeOrigin(siteOrigin());

  if (!origin) return null;

  const [settings, socialLinks] = await Promise.all([
    getPublicSiteSettings(),
    getActiveSocialLinks(),
  ]);

  return {
    origin,
    studioName: settings?.studioName ?? FALLBACK_STUDIO_NAME,
    description: settings?.defaultSeoDescription ?? fallbackMetadata.description,
    email: settings?.contactEmail ?? null,
    telephone: settings?.contactPhone ?? null,
    location: settings?.locationText ?? null,
    sameAs: socialLinks.map((link) => link.href),
    imageUrl: absoluteUrl(origin, OG_FALLBACK_PATH),
  };
}

/** Organization and WebSite. Emitted once, from the public layout. */
export async function siteStructuredData(): Promise<JsonLdObject[]> {
  const identity = await siteIdentity();

  if (!identity) return [];

  return [buildOrganizationLd(identity), buildWebSiteLd(identity)];
}

/**
 * The About page trail.
 *
 * No `Person` node is published here. The CMS cannot distinguish a sole trader
 * from a company, so naming one from `studioName` would be an unverifiable
 * claim rather than a description. See `src/lib/seo/structured-data.ts`.
 */
export async function aboutStructuredData(): Promise<JsonLdObject[]> {
  return breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: "About", path: "/about" },
  ]);
}

/** A breadcrumb trail for any public page. */
export async function breadcrumbStructuredData(
  trail: readonly BreadcrumbStep[],
): Promise<JsonLdObject[]> {
  const identity = await siteIdentity();

  if (!identity) return [];

  const breadcrumb = buildBreadcrumbLd(identity.origin, trail);

  return breadcrumb ? [breadcrumb] : [];
}

/** One portfolio project, with the trail that leads to it. */
export async function projectStructuredData(
  project: PublicProjectDetail,
): Promise<JsonLdObject[]> {
  const identity = await siteIdentity();

  if (!identity) return [];

  return [
    buildProjectLd({
      origin: identity.origin,
      slug: project.slug,
      title: project.title,
      summary: project.summary,
      genre: project.category.name,
      year: project.year,
      imageUrl: project.shareImageUrl,
    }),
    buildBreadcrumbLd(identity.origin, [
      { name: "Home", path: "/" },
      { name: "Work", path: "/work" },
      { name: project.title, path: `/work/${project.slug}` },
    ]),
  ].filter((node): node is JsonLdObject => Boolean(node));
}
