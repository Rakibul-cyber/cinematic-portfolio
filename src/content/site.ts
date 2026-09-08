/**
 * Static public-site constants.
 *
 * From Phase 5 the CMS is the source of truth for public content. What remains
 * here is interface chrome only — navigation targets, section labels, and the
 * neutral wording used when the CMS has nothing to show. Nothing in this file
 * describes the studio, its clients, its work, or its prices; that content
 * comes from the database or is not rendered at all.
 */

export type NavigationItem = {
  label: string;
  href: string;
};

export const navigation: readonly NavigationItem[] = [
  { label: "Work", href: "/work" },
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

/**
 * Used only until an administrator saves the studio name in site settings. It
 * is intentionally generic rather than a plausible-looking studio identity.
 */
export const FALLBACK_STUDIO_NAME = "Portfolio";

/** Section labels. Editorial chrome, not studio content. */
export const sectionLabels = {
  selectedWork: "Selected work",
  showreel: "In motion",
  services: "Practice",
  studio: "The studio",
  testimonials: "In their words",
  contact: "Start a conversation",
} as const;

/**
 * Neutral copy for a genuinely empty CMS.
 *
 * Written for a visitor, never for an administrator: it never mentions drafts,
 * publishing, or the admin area.
 */
export const emptyStates = {
  work: "New work is being prepared for this portfolio. Please check back soon.",
  showreel: "The showreel is being prepared.",
} as const;

/** Fallback metadata used before global SEO defaults are configured. */
export const fallbackMetadata = {
  description:
    "A photography and film portfolio: selected projects, services, and studio information.",
} as const;
