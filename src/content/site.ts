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

/** Legal routes stay in the footer and never enter the primary navigation. */
export const legalNavigation: readonly NavigationItem[] = [
  { label: "Impressum", href: "/impressum" },
  { label: "Legal notice", href: "/legal-notice" },
  { label: "Datenschutz", href: "/datenschutz" },
  { label: "Privacy", href: "/privacy" },
];

/**
 * Used only until an administrator saves the studio name in site settings. It
 * is intentionally generic rather than a plausible-looking studio identity.
 */
export const FALLBACK_STUDIO_NAME = "Portfolio";

/** Public business details, as confirmed by the owner. The contact page's fallback. */
export const contactDetails = {
  business: "Munir Visuals",
  email: "official.munirx@gmail.com",
  phoneDisplay: "+49 157 57801897",
  phoneHref: "tel:+4915757801897",
  addressLines: ["Ernst-Lemmer-Straße 17", "35041 Marburg-Wehrda", "Germany"],
};

export type ContactDetails = typeof contactDetails;

/**
 * The contact page's details: saved site settings where present, so it agrees
 * with the rest of the site, and the confirmed details otherwise. A phone is
 * used only with its dialable link, so the number and the Call action always
 * belong together.
 */
export function resolveContactDetails(
  settings: {
    studioName: string;
    contactEmail: string | null;
    contactPhone: string | null;
    phoneHref: string | null;
    locationText: string | null;
  } | null,
): ContactDetails {
  const phone = settings?.contactPhone?.trim();
  const location = settings?.locationText?.trim();

  return {
    business: settings?.studioName.trim() || contactDetails.business,
    email: settings?.contactEmail?.trim() || contactDetails.email,
    phoneDisplay: phone && settings?.phoneHref ? phone : contactDetails.phoneDisplay,
    phoneHref: phone && settings?.phoneHref ? settings.phoneHref : contactDetails.phoneHref,
    addressLines: location ? [location] : contactDetails.addressLines,
  };
}

/** Disciplines listed in the contact hero, from the approved design. */
export const contactDisciplines = [
  "Photography",
  "Filmmaking",
  "Events",
  "Commercial shoots",
  "Creative collaborations",
] as const;

/** Section labels. Editorial chrome, not studio content. */
export const sectionLabels = {
  selectedWork: "Selected work",
  showreel: "In motion",
  services: "Practice",
  studio: "The studio",
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
  inquiry: "Online inquiries will open soon.",
} as const;

/** Fallback metadata used before global SEO defaults are configured. */
export const fallbackMetadata = {
  description:
    "A photography and film portfolio: selected projects, services, and studio information.",
} as const;
