import "server-only";

import { unstable_cache } from "next/cache";

import { prisma } from "@/server/db/prisma";
import { isPublicMediaConfigured, publicMediaUrl } from "@/server/media/delivery";
import { ALL_PUBLIC_TAGS, PUBLIC_REVALIDATE_SECONDS, PublicTag } from "@/server/public/cache-tags";
import {
  toProjectDetail,
  toProjectSummary,
  toPublicPage,
  toPublicService,
  toPublicSiteSettings,
  toPublicSocialLinks,
  toPublicTestimonial,
  type UrlResolver,
} from "@/server/public/mappers";
import {
  ACTIVE_WHERE,
  activeOrderBy,
  projectMediaOrderBy,
  projectOrderBy,
  PUBLISHED_PROJECT_WHERE,
  type PublicPageKey,
} from "@/server/public/publication";
import type {
  HomepageContent,
  PublicCategory,
  PublicPageContent,
  PublicProjectDetail,
  PublicProjectSummary,
  PublicService,
  PublicSiteSettings,
  PublicSocialLink,
  PublicTestimonial,
} from "@/server/public/view-models";

/**
 * The public read layer.
 *
 * This is the only module that runs Prisma queries for public pages. Pages and
 * components receive finished view models, so no component can widen a `select`
 * or forget a publication filter.
 *
 * Every function is wrapped in `unstable_cache`, keyed by its arguments and
 * tagged so an admin save invalidates exactly the affected reads. The mapping
 * happens *inside* the cache so what is stored is plain serializable data
 * rather than Prisma rows with `Date` instances.
 */

/**
 * Media URLs are resolved eagerly here, while the server-only delivery helper
 * is in scope. When the public read origin is not configured, images are
 * omitted rather than rendered as broken URLs, and the pages degrade to text.
 */
const resolveUrl: UrlResolver = isPublicMediaConfigured()
  ? publicMediaUrl
  : () => "";

const mediaSelect = {
  width: true,
  height: true,
  objectKey: true,
  altText: true,
  caption: true,
  blurDataUrl: true,
  variants: {
    select: { width: true, height: true, objectKey: true },
  },
} as const;

function projectMediaSelect() {
  return {
    orderBy: projectMediaOrderBy(),
    select: { sortOrder: true, media: { select: mediaSelect } },
  };
}

function projectSummarySelect() {
  return {
    slug: true,
    title: true,
    summary: true,
    projectDate: true,
    category: { select: { name: true, slug: true } },
    media: projectMediaSelect(),
  };
}

function projectDetailSelect() {
  return {
    ...projectSummarySelect(),
    description: true,
    clientName: true,
    location: true,
    seoTitle: true,
    seoDescription: true,
    videoProvider: true,
    videoId: true,
    videoTitle: true,
  };
}

const settingsSelect = {
  studioName: true,
  tagline: true,
  contactEmail: true,
  contactPhone: true,
  whatsappNumber: true,
  locationText: true,
  footerCopyright: true,
  defaultSeoTitle: true,
  defaultSeoDescription: true,
  showreelProvider: true,
  showreelVideoId: true,
  showreelTitle: true,
} as const;

function cached<Args extends unknown[], Result>(
  key: string,
  tags: readonly string[],
  load: (...args: Args) => Promise<Result>,
) {
  return unstable_cache(load, [key], {
    tags: [...tags],
    revalidate: PUBLIC_REVALIDATE_SECONDS,
  });
}

/** Active portfolio categories that actually contain published work. */
export const getPublicCategories = cached(
  "public-categories",
  [PublicTag.Categories, PublicTag.Projects],
  async (): Promise<PublicCategory[]> => {
    const rows = await prisma.portfolioCategory.findMany({
      where: {
        ...ACTIVE_WHERE,
        projects: { some: { status: "PUBLISHED" } },
      },
      orderBy: activeOrderBy("name"),
      select: { name: true, slug: true },
    });

    return rows;
  },
);

/**
 * Published projects, optionally narrowed to one active category.
 *
 * An unknown or inactive category slug simply matches nothing, which the work
 * index renders as an empty result rather than an error page.
 */
export const getPublishedProjects = cached(
  "public-projects",
  [PublicTag.Projects, PublicTag.Categories, PublicTag.Media],
  async (options?: {
    categorySlug?: string;
    featuredOnly?: boolean;
    take?: number;
  }): Promise<PublicProjectSummary[]> => {
    const rows = await prisma.project.findMany({
      where: {
        ...PUBLISHED_PROJECT_WHERE,
        ...(options?.categorySlug
          ? { category: { isActive: true, slug: options.categorySlug } }
          : {}),
        ...(options?.featuredOnly ? { featured: true } : {}),
      },
      orderBy: projectOrderBy(),
      take: options?.take,
      select: projectSummarySelect(),
    });

    return rows.map((row) => toProjectSummary(row, resolveUrl));
  },
);

/** Slugs of published projects, for static generation. */
export const getPublishedProjectSlugs = cached(
  "public-project-slugs",
  [PublicTag.Projects, PublicTag.Categories],
  async (): Promise<string[]> => {
    const rows = await prisma.project.findMany({
      where: PUBLISHED_PROJECT_WHERE,
      orderBy: projectOrderBy(),
      select: { slug: true },
    });

    return rows.map((row) => row.slug);
  },
);

/**
 * One published project, or `null`.
 *
 * A draft project and a nonexistent slug are indistinguishable here by
 * design, so the detail route renders the same 404 for both.
 */
export const getPublishedProjectBySlug = cached(
  "public-project",
  [PublicTag.Projects, PublicTag.Categories, PublicTag.Media],
  async (slug: string): Promise<PublicProjectDetail | null> => {
    const row = await prisma.project.findFirst({
      where: { slug, ...PUBLISHED_PROJECT_WHERE },
      select: projectDetailSelect(),
    });

    return row ? toProjectDetail(row, resolveUrl) : null;
  },
);

export const getActiveServices = cached(
  "public-services",
  [PublicTag.Services],
  async (options?: { take?: number }): Promise<PublicService[]> => {
    const rows = await prisma.service.findMany({
      where: ACTIVE_WHERE,
      orderBy: activeOrderBy("name"),
      take: options?.take,
      select: {
        slug: true,
        name: true,
        shortDescription: true,
        description: true,
        priceLabel: true,
      },
    });

    return rows.map(toPublicService);
  },
);

export const getActiveTestimonials = cached(
  "public-testimonials",
  [PublicTag.Testimonials],
  async (options?: { take?: number }): Promise<PublicTestimonial[]> => {
    const rows = await prisma.testimonial.findMany({
      where: ACTIVE_WHERE,
      orderBy: activeOrderBy("authorName"),
      take: options?.take,
      select: {
        quote: true,
        authorName: true,
        authorRole: true,
        company: true,
        projectName: true,
      },
    });

    return rows.map(toPublicTestimonial);
  },
);

export const getActiveSocialLinks = cached(
  "public-social-links",
  [PublicTag.Settings],
  async (): Promise<PublicSocialLink[]> => {
    const rows = await prisma.socialLink.findMany({
      where: ACTIVE_WHERE,
      orderBy: activeOrderBy("label"),
      select: { platform: true, label: true, url: true },
    });

    return toPublicSocialLinks(rows);
  },
);

/** Global settings, or `null` before an administrator has saved them. */
export const getPublicSiteSettings = cached(
  "public-settings",
  [PublicTag.Settings],
  async (): Promise<PublicSiteSettings | null> => {
    const row = await prisma.siteSetting.findUnique({
      where: { id: "primary" },
      select: settingsSelect,
    });

    return row ? toPublicSiteSettings(row) : null;
  },
);

export const getPublicPage = cached(
  "public-page",
  [PublicTag.Pages],
  async (key: PublicPageKey): Promise<PublicPageContent | null> => {
    const row = await prisma.page.findUnique({
      where: { key },
      select: {
        title: true,
        eyebrow: true,
        body: true,
        seoTitle: true,
        seoDescription: true,
      },
    });

    return row ? toPublicPage(row) : null;
  },
);

/**
 * Everything the homepage renders, in one cached unit.
 *
 * The homepage reads six entities; loading them together keeps the round trips
 * concurrent and lets the whole composition share one cache entry.
 *
 * The hero reuses the existing featured/cover concept rather than introducing
 * a separate global hero-media model: the first featured published project
 * supplies the hero image.
 */
export const getHomepageContent = unstable_cache(
  async (): Promise<HomepageContent> => {
    const [settings, featured, services, testimonials, about] =
      await Promise.all([
        getPublicSiteSettings(),
        getPublishedProjects({ featuredOnly: true, take: 6 }),
        getActiveServices({ take: 4 }),
        getActiveTestimonials({ take: 2 }),
        getPublicPage("about"),
      ]);

    // Fall back to the newest published work when nothing is flagged featured,
    // so a populated CMS never renders an empty homepage.
    const selected = featured.length
      ? featured
      : await getPublishedProjects({ take: 3 });

    return {
      settings,
      hero: selected.at(0) ?? null,
      featured: selected,
      services,
      testimonials,
      about,
    };
  },
  ["public-homepage"],
  { tags: [...ALL_PUBLIC_TAGS], revalidate: PUBLIC_REVALIDATE_SECONDS },
);
