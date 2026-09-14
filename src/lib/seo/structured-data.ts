import { absoluteUrl } from "@/lib/seo/canonical";

/**
 * JSON-LD builders for the public site.
 *
 * Pure, and deliberately conservative: every field is filled from CMS content
 * or from the configured origin, and a field with no source is omitted rather
 * than guessed. Structured data is a machine-readable claim about a real
 * business, so an invented address, rating, price, or founding date would be a
 * factual assertion the studio never made.
 *
 * Nodes are linked by stable `@id` anchors so a project can reference its
 * creator without repeating the organization block on every page.
 */

export type JsonLdObject = Record<string, unknown>;

/** Removes null/undefined/empty values so no node carries a hollow field. */
function compact(node: JsonLdObject): JsonLdObject {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;

      return true;
    }),
  );
}

export const organizationId = (origin: string) => `${origin}/#organization`;
export const websiteId = (origin: string) => `${origin}/#website`;

export type SiteIdentity = {
  origin: string;
  studioName: string;
  description?: string | null;
  email?: string | null;
  telephone?: string | null;
  location?: string | null;
  /** Absolute profile URLs, already validated by the public mapper. */
  sameAs?: readonly string[];
  /** Absolute URL of the generated share image, used as the logo stand-in. */
  imageUrl?: string | null;
};

/**
 * The studio as an organization.
 *
 * `ProfessionalService` is used rather than a bare `Organization`: it is the
 * accurate type for a studio that sells photography and film services, and it
 * inherits everything `Organization` offers.
 */
export function buildOrganizationLd(identity: SiteIdentity): JsonLdObject {
  const { origin } = identity;

  return compact({
    "@type": ["Organization", "ProfessionalService"],
    "@id": organizationId(origin),
    name: identity.studioName,
    url: `${origin}/`,
    description: identity.description,
    email: identity.email,
    telephone: identity.telephone,
    // A free-text locality only. No street address or postal code is modelled
    // by the CMS, so no PostalAddress node is fabricated.
    areaServed: identity.location,
    image: identity.imageUrl,
    logo: identity.imageUrl,
    sameAs: identity.sameAs ? [...identity.sameAs] : undefined,
  });
}

export function buildWebSiteLd(identity: SiteIdentity): JsonLdObject {
  const { origin } = identity;

  return compact({
    "@type": "WebSite",
    "@id": websiteId(origin),
    name: identity.studioName,
    url: `${origin}/`,
    description: identity.description,
    inLanguage: "en",
    publisher: { "@id": organizationId(origin) },
  });
}

/*
 * There is deliberately no `Person` builder.
 *
 * A `Person` node asserts that a named natural person exists. The CMS holds one
 * identity field, `studioName`, and nothing that distinguishes a sole trader
 * from a company — so naming a Person from it would publish a machine-readable
 * claim that is simply false for "Muller Fotografie GmbH", and inventing an
 * owner's real name is not an option. Structured data is read by machines that
 * cannot tell a hedge from a fact, so the honest move is to say nothing.
 *
 * Omitting it costs little: `Organization`/`ProfessionalService` already
 * carries the studio identity, contact details, and social profiles. When the
 * CMS gains an explicit person field, add the node then (see ADR 0009).
 */

export type ProjectLdInput = {
  origin: string;
  slug: string;
  title: string;
  summary: string;
  /** Category name, used as the work's genre. */
  genre?: string | null;
  /** Year of the shoot, when the CMS records a date. */
  year?: number | null;
  imageUrl?: string | null;
};

/**
 * One portfolio project as a `CreativeWork`.
 *
 * Portfolio pieces are photographic and film work rather than articles, and
 * `CreativeWork` is the honest supertype: it needs no author byline, headline,
 * or publication date the CMS does not hold.
 */
export function buildProjectLd(input: ProjectLdInput): JsonLdObject {
  const { origin } = input;

  return compact({
    "@type": "CreativeWork",
    "@id": `${origin}/work/${input.slug}#work`,
    name: input.title,
    url: `${origin}/work/${input.slug}`,
    description: input.summary,
    genre: input.genre,
    // Year only. The CMS stores a project date, not a publication instant, so
    // a full timestamp would claim more precision than exists.
    dateCreated: input.year ? String(input.year) : undefined,
    image: input.imageUrl,
    creator: { "@id": organizationId(origin) },
    isPartOf: { "@id": websiteId(origin) },
  });
}

export type BreadcrumbStep = { name: string; path: string };

/** Breadcrumb trail. Paths are turned into absolute URLs, in order. */
export function buildBreadcrumbLd(
  origin: string,
  trail: readonly BreadcrumbStep[],
): JsonLdObject | null {
  const items = trail.flatMap((step, index) => {
    const url = absoluteUrl(origin, step.path);

    return url
      ? [{ "@type": "ListItem", position: index + 1, name: step.name, item: url }]
      : [];
  });

  return items.length
    ? { "@type": "BreadcrumbList", itemListElement: items }
    : null;
}

/**
 * Serializes a graph for embedding in a `<script type="application/ld+json">`.
 *
 * `<`, `>`, and `&` are escaped so no CMS value can close the script element
 * and inject markup. JSON parsers accept the escape sequences unchanged, so
 * escaping costs nothing and removes the injection path entirely.
 */
export function serializeJsonLd(nodes: readonly JsonLdObject[]): string {
  const graph = { "@context": "https://schema.org", "@graph": [...nodes] };

  return JSON.stringify(graph).replace(
    /[<>&]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
