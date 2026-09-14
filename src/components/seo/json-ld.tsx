import { serializeJsonLd, type JsonLdObject } from "@/lib/seo/structured-data";

type JsonLdProps = {
  /** Nodes for one `@graph`. An empty list renders nothing. */
  nodes: readonly (JsonLdObject | null)[];
};

/**
 * Embeds structured data as one `application/ld+json` graph.
 *
 * A single graph per page rather than one script element per node: the nodes
 * reference each other by `@id`, and keeping them together is what lets a
 * consumer resolve those references.
 *
 * `dangerouslySetInnerHTML` is required — React would otherwise escape the JSON
 * into unusable text. The serializer escapes `<`, `>`, and `&` first, so no CMS
 * value can close the script element.
 */
export function JsonLd({ nodes }: JsonLdProps) {
  const present = nodes.filter((node): node is JsonLdObject => Boolean(node));

  if (present.length === 0) return null;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(present) }}
      type="application/ld+json"
    />
  );
}
