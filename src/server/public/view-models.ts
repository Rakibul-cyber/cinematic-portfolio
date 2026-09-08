import type { PublicImage } from "@/lib/public/image-source";
import type { VideoRef } from "@/lib/video";

/**
 * Public view models.
 *
 * Public components consume only these shapes, never Prisma rows. Database
 * identifiers, audit columns (`createdAt`, `updatedAt`), uploader references,
 * publication flags, and storage keys are deliberately absent, so a new
 * internal column cannot reach the public HTML by accident and the schema can
 * change without rewriting components.
 */

export type PublicCategory = {
  name: string;
  slug: string;
};

export type PublicProjectSummary = {
  slug: string;
  title: string;
  summary: string;
  category: PublicCategory;
  /** Year of the shoot, when the CMS records a date. */
  year: number | null;
  cover: PublicImage | null;
};

export type PublicProjectDetail = PublicProjectSummary & {
  description: string[];
  clientName: string | null;
  location: string | null;
  dateLabel: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  video: VideoRef | null;
  gallery: PublicImage[];
  /** Absolute URL of the cover image, for Open Graph metadata. */
  shareImageUrl: string | null;
};

export type PublicService = {
  slug: string;
  name: string;
  shortDescription: string;
  description: string[];
  priceLabel: string | null;
};

export type PublicTestimonial = {
  quote: string;
  authorName: string;
  /** Role, company, and project joined into one attribution line, or null. */
  attribution: string | null;
};

export type PublicSocialLink = {
  platform: string;
  label: string;
  href: string;
};

export type PublicSiteSettings = {
  studioName: string;
  tagline: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  phoneHref: string | null;
  whatsappNumber: string | null;
  whatsappHref: string | null;
  locationText: string | null;
  footerCopyright: string | null;
  defaultSeoTitle: string | null;
  defaultSeoDescription: string | null;
  showreel: VideoRef | null;
};

export type PublicPageContent = {
  title: string;
  eyebrow: string | null;
  body: string[];
  seoTitle: string | null;
  seoDescription: string | null;
};

export type HomepageContent = {
  settings: PublicSiteSettings | null;
  hero: PublicProjectSummary | null;
  featured: PublicProjectSummary[];
  services: PublicService[];
  testimonials: PublicTestimonial[];
  about: PublicPageContent | null;
};
