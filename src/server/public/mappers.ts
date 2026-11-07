import {
  buildPublicImage,
  type ImageCandidate,
  type PublicImage,
} from "@/lib/public/image-source";
import { toVideoRef } from "@/lib/video";
import type {
  PublicPageContent,
  PublicProjectDetail,
  PublicProjectSummary,
  PublicService,
  PublicSiteSettings,
  PublicSocialLink,
  PublicTestimonial,
} from "@/server/public/view-models";

/**
 * Pure Prisma-row to public view-model mapping.
 *
 * Deliberately free of Prisma, environment, and `server-only` imports: the URL
 * resolver is injected, so every rule here (which fields are exposed, how alt
 * text degrades, which links are safe) is unit-testable without a database.
 */

/** Widest CSS pixel width a card is ever displayed at. */
export const CARD_MAX_WIDTH = 720;
/** Widest CSS pixel width a full-bleed editorial image is displayed at. */
export const FEATURE_MAX_WIDTH = 1920;

export type UrlResolver = (objectKey: string) => string;

export type MediaRow = {
  width: number;
  height: number;
  objectKey: string;
  altText: string | null;
  caption: string | null;
  blurDataUrl: string | null;
  variants: { width: number; height: number; objectKey: string }[];
};

function candidates(media: MediaRow, resolveUrl: UrlResolver): ImageCandidate[] {
  return [
    ...media.variants.map((variant) => ({
      width: variant.width,
      height: variant.height,
      url: resolveUrl(variant.objectKey),
    })),
    {
      width: media.width,
      height: media.height,
      url: resolveUrl(media.objectKey),
    },
  ];
}

/**
 * Maps one media row to a responsive public image.
 *
 * Missing alt text is never invented. A content image without alt text falls
 * back to an empty string, which marks it decorative rather than announcing a
 * filename or a guess about the photograph to a screen reader; the surrounding
 * project title and copy carry the meaning instead.
 */
export function toPublicImage(
  media: MediaRow,
  options: { maxWidth: number; resolveUrl: UrlResolver },
): PublicImage | null {
  return buildPublicImage(candidates(media, options.resolveUrl), {
    maxWidth: options.maxWidth,
    alt: media.altText?.trim() ?? "",
    blurDataUrl: media.blurDataUrl,
  });
}

/** Splits stored plain-text copy into paragraphs. Content is never HTML. */
export function toParagraphs(body: string | null | undefined): string[] {
  if (!body) return [];

  return body
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Fields the work index needs. Kept narrower than the detail row so listing
 * queries never pull full project descriptions across the wire.
 */
export type ProjectSummaryRow = {
  slug: string;
  title: string;
  summary: string;
  projectDate: Date | null;
  category: { name: string; slug: string };
  media: { sortOrder: number; media: MediaRow }[];
};

export type ProjectRow = ProjectSummaryRow & {
  description: string;
  clientName: string | null;
  location: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  videoProvider: string | null;
  videoId: string | null;
  videoTitle: string | null;
};

/** Deterministic gallery order: sortOrder first, then object key as a tiebreak. */
function orderedMedia(project: ProjectSummaryRow) {
  return [...project.media].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.media.objectKey.localeCompare(b.media.objectKey),
  );
}

export function toProjectSummary(
  project: ProjectSummaryRow,
  resolveUrl: UrlResolver,
): PublicProjectSummary {
  const first = orderedMedia(project).at(0);

  return {
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    category: { name: project.category.name, slug: project.category.slug },
    year: project.projectDate ? project.projectDate.getUTCFullYear() : null,
    cover: first
      ? toPublicImage(first.media, { maxWidth: CARD_MAX_WIDTH, resolveUrl })
      : null,
  };
}

export function toProjectDetail(
  project: ProjectRow,
  resolveUrl: UrlResolver,
): PublicProjectDetail {
  const ordered = orderedMedia(project);
  const gallery = ordered
    .map((entry) =>
      toPublicImage(entry.media, { maxWidth: FEATURE_MAX_WIDTH, resolveUrl }),
    )
    .filter((image): image is PublicImage => image !== null);

  return {
    ...toProjectSummary(project, resolveUrl),
    description: toParagraphs(project.description),
    clientName: project.clientName,
    location: project.location,
    dateLabel: project.projectDate
      ? project.projectDate.toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : null,
    seoTitle: project.seoTitle,
    seoDescription: project.seoDescription,
    video: toVideoRef({
      provider: project.videoProvider,
      videoId: project.videoId,
      title: project.videoTitle,
    }),
    gallery,
    shareImageUrl: gallery.at(0)?.src ?? null,
  };
}

export type ServiceRow = {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  priceLabel: string | null;
};

export function toPublicService(service: ServiceRow): PublicService {
  return {
    slug: service.slug,
    name: service.name,
    shortDescription: service.shortDescription,
    description: toParagraphs(service.description),
    priceLabel: service.priceLabel,
  };
}

export type TestimonialRow = {
  quote: string;
  authorName: string;
  authorRole: string | null;
  company: string | null;
  projectName: string | null;
};

export function toPublicTestimonial(
  testimonial: TestimonialRow,
): PublicTestimonial {
  const attribution = [
    testimonial.authorRole,
    testimonial.company,
    testimonial.projectName,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");

  return {
    quote: testimonial.quote,
    authorName: testimonial.authorName,
    attribution: attribution || null,
  };
}

/**
 * Only http(s) links are rendered. A stored `javascript:` or `data:` URL is
 * dropped rather than escaped into an anchor.
 */
export function isSafeExternalHref(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export type SocialLinkRow = { platform: string; label: string; url: string };

export function toPublicSocialLinks(
  links: readonly SocialLinkRow[],
): PublicSocialLink[] {
  return links
    .filter((link) => isSafeExternalHref(link.url))
    .map((link) => ({
      platform: link.platform,
      label: link.label,
      href: link.url,
    }));
}

/** Reduces a stored phone number to a dialable href, or null when unusable. */
export function toPhoneHref(
  value: string | null,
  scheme: "tel" | "whatsapp",
): string | null {
  if (!value) return null;

  const compact = value.replace(/[^\d+]/g, "");
  if (compact.replace(/\D/g, "").length < 6) return null;

  return scheme === "tel"
    ? `tel:${compact}`
    : `https://wa.me/${compact.replace(/\D/g, "")}`;
}

export type SiteSettingRow = {
  studioName: string;
  tagline: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  locationText: string | null;
  footerCopyright: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  showreelProvider: string | null;
  showreelVideoId: string | null;
  showreelTitle: string | null;
};

export function toPublicSiteSettings(
  settings: SiteSettingRow,
): PublicSiteSettings {
  return {
    studioName: settings.studioName,
    tagline: settings.tagline,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
    phoneHref: toPhoneHref(settings.contactPhone, "tel"),
    whatsappNumber: settings.whatsappNumber,
    whatsappHref: toPhoneHref(settings.whatsappNumber, "whatsapp"),
    locationText: settings.locationText,
    footerCopyright: settings.footerCopyright,
    defaultSeoTitle: settings.defaultSeoTitle,
    defaultSeoDescription: settings.defaultSeoDescription,
    showreel: toVideoRef({
      provider: settings.showreelProvider,
      videoId: settings.showreelVideoId,
      title: settings.showreelTitle,
    }),
  };
}

export type PageRow = {
  title: string;
  eyebrow: string | null;
  body: string;
  seoTitle: string | null;
  seoDescription: string | null;
};

export function toPublicPage(page: PageRow): PublicPageContent {
  return {
    title: page.title,
    eyebrow: page.eyebrow,
    body: toParagraphs(page.body),
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
  };
}
