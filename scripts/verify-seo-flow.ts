import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { fallbackMetadata } from "@/content/site";
import {
  absoluteUrl,
  normalizeOrigin,
  normalizePath,
  OG_FALLBACK_PATH,
  PUBLIC_ROUTES,
} from "@/lib/seo/canonical";
import { buildMetadataDocument } from "@/lib/seo/metadata-document";
import { buildRobots, DISALLOWED_PREFIXES } from "@/lib/seo/robots-rules";
import { buildSitemapEntries } from "@/lib/seo/sitemap-entries";
import {
  buildBreadcrumbLd,
  buildOrganizationLd,
  buildProjectLd,
  buildWebSiteLd,
  organizationId,
  serializeJsonLd,
  websiteId,
  type JsonLdObject,
} from "@/lib/seo/structured-data";

/**
 * Verification of the production SEO surface.
 *
 * Offline by design — no database, no network, and no running application —
 * because every SEO decision was deliberately factored into pure builders. That
 * makes this runnable in CI and on a machine with no credentials, which is the
 * only way a check like this actually gets run.
 *
 * What it cannot see: whether Next.js emits the tags it is handed. That is the
 * framework's contract, and it is covered by `npm run public:verify`, which
 * asserts rendered HTML against a running application.
 *
 *   npm run seo:verify
 */

const ORIGIN = "https://studio.example";

/** Public page files that must each declare metadata and a canonical path. */
const PAGE_FILES: { file: string; path: string }[] = [
  { file: "src/app/(public)/page.tsx", path: "/" },
  { file: "src/app/(public)/work/page.tsx", path: "/work" },
  { file: "src/app/(public)/work/[slug]/page.tsx", path: "/work/${project.slug}" },
  { file: "src/app/(public)/services/page.tsx", path: "/services" },
  { file: "src/app/(public)/about/page.tsx", path: "/about" },
  { file: "src/app/(public)/contact/page.tsx", path: "/contact" },
];

function section(name: string): void {
  console.log(`  ${name}`);
}

/** Every string value anywhere in a JSON-LD graph, for absolute-URL checks. */
function values(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(values);
  if (node && typeof node === "object") {
    return Object.values(node as Record<string, unknown>).flatMap(values);
  }

  return [];
}

async function verifyCanonical(): Promise<void> {
  section("canonical");

  assert.equal(normalizePath("/work/"), "/work", "trailing slash removed");
  assert.equal(normalizePath("/"), "/", "the root keeps its slash");
  assert.equal(normalizePath("work"), "/work", "a leading slash is added");
  assert.equal(
    normalizePath("/work?category=film"),
    "/work",
    "a filter is a view of a page, never a canonical of its own",
  );
  assert.equal(normalizePath("/work#gallery"), "/work", "fragments dropped");
  assert.equal(normalizePath("/work//a"), "/work/a", "duplicate slashes collapse");

  assert.equal(normalizeOrigin("https://studio.example/"), ORIGIN, "origin trimmed");
  assert.equal(normalizeOrigin("javascript:alert(1)"), null, "non-http rejected");
  assert.equal(normalizeOrigin(""), null, "empty origin rejected");
  assert.equal(normalizeOrigin(undefined), null, "missing origin rejected");

  assert.equal(absoluteUrl(ORIGIN, "/about/"), `${ORIGIN}/about`);
  assert.equal(
    absoluteUrl(null, "/about"),
    null,
    "no origin yields no absolute URL rather than a guessed host",
  );
}

async function verifyRobots(): Promise<void> {
  section("robots");

  const robots = buildRobots(ORIGIN);
  const [rule] = robots.rules;

  assert.equal(rule.userAgent, "*");
  assert.equal(rule.allow, "/", "the public site is crawlable");

  for (const prefix of DISALLOWED_PREFIXES) {
    assert.ok(rule.disallow.includes(prefix), `${prefix} is disallowed`);
  }

  assert.ok(
    rule.disallow.some((value) => value.startsWith("/admin")),
    "the private workspace is never crawled",
  );
  assert.equal(robots.sitemap, `${ORIGIN}/sitemap.xml`);

  const unconfigured = buildRobots(undefined);
  assert.equal(
    unconfigured.sitemap,
    undefined,
    "an unknown origin advertises no sitemap rather than the wrong one",
  );
  assert.ok(
    unconfigured.rules[0].disallow.includes("/admin"),
    "the crawl policy holds even without an origin",
  );

  const source = await readFile("src/app/robots.ts", "utf8");
  assert.ok(source.includes("buildRobots"), "the route uses the verified policy");
}

async function verifySitemap(): Promise<void> {
  section("sitemap");

  const projects = [
    { slug: "harbour-light", updatedAt: new Date("2026-08-01T10:00:00.000Z") },
    { slug: "atelier", updatedAt: new Date("2026-09-01T10:00:00.000Z") },
  ];

  const entries = buildSitemapEntries({ origin: ORIGIN, projects });
  const urls = entries.map((entry) => entry.url);

  for (const route of PUBLIC_ROUTES) {
    assert.ok(urls.includes(absoluteUrl(ORIGIN, route)!), `${route} listed`);
  }

  assert.ok(urls.includes(`${ORIGIN}/work/harbour-light`), "published work listed");
  assert.equal(new Set(urls).size, urls.length, "no URL is advertised twice");
  assert.ok(
    urls.every((url) => url.startsWith(`${ORIGIN}/`)),
    "every sitemap URL is absolute",
  );
  assert.ok(
    !urls.some((url) => url.includes("?") || url.includes("#")),
    "no filtered or fragment URL is advertised",
  );
  assert.ok(
    !urls.some((url) => url.includes("/admin") || url.includes("/api/")),
    "private surfaces never appear in the sitemap",
  );
  assert.ok(
    urls.every(
      (url) => url === `${ORIGIN}/` || !url.endsWith("/"),
    ),
    "sitemap URLs use the canonical spelling",
  );

  const project = entries.find((entry) => entry.url.endsWith("/work/atelier"));
  assert.deepEqual(
    project?.lastModified,
    projects[1].updatedAt,
    "a project advertises its own last change",
  );

  const home = entries.find((entry) => entry.url === `${ORIGIN}/`);
  assert.deepEqual(
    home?.lastModified,
    projects[1].updatedAt,
    "static routes follow the newest published work",
  );

  assert.deepEqual(
    buildSitemapEntries({ origin: null, projects }),
    [],
    "no origin yields an empty sitemap rather than relative URLs",
  );
  assert.equal(
    buildSitemapEntries({ origin: ORIGIN, projects: [] }).length,
    PUBLIC_ROUTES.length,
    "an empty portfolio still advertises its static pages",
  );

  const source = await readFile("src/app/sitemap.ts", "utf8");
  assert.ok(source.includes("buildSitemapEntries"), "the route uses the builder");
}

async function verifyMetadata(): Promise<void> {
  section("metadata");

  const base = {
    studioName: "Verification Studio",
    fallbackDescription: fallbackMetadata.description,
    origin: ORIGIN,
  };

  const project = buildMetadataDocument({
    ...base,
    title: "Harbour Light",
    description: "A winter film shot on the North Sea coast.",
    path: "/work/harbour-light",
    imageUrl: "https://media.example/cover.webp",
  });

  assert.equal(project.title, "Harbour Light");
  assert.equal(project.description, "A winter film shot on the North Sea coast.");
  assert.equal(
    project.alternates?.canonical,
    `${ORIGIN}/work/harbour-light`,
    "canonical is absolute",
  );
  assert.deepEqual(project.robots, { index: true, follow: true });

  // Precedence: page field, then CMS default, then the neutral constant.
  const fromDefaults = buildMetadataDocument({
    ...base,
    path: "/",
    defaultTitle: "Verification Studio — Photography",
    defaultDescription: "CMS default description.",
  });
  assert.equal(fromDefaults.title, "Verification Studio — Photography");
  assert.equal(fromDefaults.description, "CMS default description.");

  const bare = buildMetadataDocument({ ...base, path: "/" });
  assert.deepEqual(
    bare.title,
    { absolute: "Verification Studio" },
    "a title equal to the studio name suppresses the duplicate template",
  );
  assert.equal(
    bare.description,
    fallbackMetadata.description,
    "an unconfigured CMS still yields a neutral description",
  );

  const relative = buildMetadataDocument({ ...base, origin: null, path: "/about" });
  assert.equal(
    relative.alternates?.canonical,
    "/about",
    "an unconfigured origin yields a relative canonical, never a guessed host",
  );

  const noindex = buildMetadataDocument({ ...base, path: "/about", indexable: false });
  assert.deepEqual(noindex.robots, { index: false, follow: false });

  for (const { file, path } of PAGE_FILES) {
    const source = await readFile(file, "utf8");

    assert.ok(
      source.includes("buildPublicMetadata"),
      `${file} declares metadata through the shared builder`,
    );
    assert.ok(
      source.includes(`path: \`${path}\``) || source.includes(`path: "${path}"`),
      `${file} declares its canonical path`,
    );
  }
}

async function verifyOpenGraphAndTwitter(): Promise<void> {
  section("open graph + twitter");

  const base = {
    studioName: "Verification Studio",
    fallbackDescription: fallbackMetadata.description,
    origin: ORIGIN,
  };

  /** The Metadata types are wide unions; the emitted object is plain data. */
  const fields = (value: unknown) => (value ?? {}) as Record<string, unknown>;

  const withCover = buildMetadataDocument({
    ...base,
    title: "Harbour Light",
    description: "A winter film.",
    path: "/work/harbour-light",
    imageUrl: "https://media.example/cover.webp",
  });

  const og = fields(withCover.openGraph);
  assert.equal(og.type, "website");
  assert.equal(og.siteName, "Verification Studio");
  assert.equal(og.title, "Harbour Light");
  assert.equal(og.description, "A winter film.");
  assert.equal(
    og.url,
    `${ORIGIN}/work/harbour-light`,
    "the Open Graph URL matches the canonical",
  );
  assert.deepEqual(
    og.images,
    [{ url: "https://media.example/cover.webp" }],
    "a project shares its own cover",
  );

  const fallback = fields(buildMetadataDocument({ ...base, path: "/about" }).openGraph);
  assert.deepEqual(
    fallback.images,
    [{ url: `${ORIGIN}${OG_FALLBACK_PATH}` }],
    "a page with no image of its own falls back to the generated card",
  );

  const withoutOrigin = buildMetadataDocument({
    ...base,
    origin: null,
    path: "/about",
  });
  assert.equal(
    fields(withoutOrigin.openGraph).images,
    undefined,
    "no origin means no share image rather than a relative one no consumer can fetch",
  );

  const twitter = fields(withCover.twitter);
  assert.equal(twitter.card, "summary_large_image");
  assert.equal(twitter.title, "Harbour Light");
  assert.equal(twitter.description, "A winter film.");
  assert.deepEqual(twitter.images, ["https://media.example/cover.webp"]);
  assert.equal(
    fields(withoutOrigin.twitter).card,
    "summary",
    "a card with no image degrades rather than promising a large image",
  );

  await readFile("src/app/opengraph-image.tsx", "utf8");
}

async function verifyStructuredData(): Promise<void> {
  section("structured data");

  const identity = {
    origin: ORIGIN,
    studioName: "Verification Studio",
    description: "A photography and film studio.",
    email: "hello@studio.example",
    telephone: null,
    location: "Berlin",
    sameAs: ["https://example.com/profile"],
    imageUrl: `${ORIGIN}${OG_FALLBACK_PATH}`,
  };

  const organization = buildOrganizationLd(identity);
  const website = buildWebSiteLd(identity);
  const project = buildProjectLd({
    origin: ORIGIN,
    slug: "harbour-light",
    title: "Harbour Light",
    summary: "A winter film.",
    genre: "Film",
    year: 2026,
    imageUrl: "https://media.example/cover.webp",
  });
  const breadcrumb = buildBreadcrumbLd(ORIGIN, [
    { name: "Home", path: "/" },
    { name: "Work", path: "/work" },
    { name: "Harbour Light", path: "/work/harbour-light" },
  ]);

  const graph = [organization, website, project, breadcrumb!];

  assert.deepEqual(organization["@type"], ["Organization", "ProfessionalService"]);
  assert.equal(website["@type"], "WebSite");
  assert.equal(project["@type"], "CreativeWork");
  assert.equal(breadcrumb!["@type"], "BreadcrumbList");

  assert.equal(organization["@id"], organizationId(ORIGIN));
  assert.deepEqual(website.publisher, { "@id": organizationId(ORIGIN) });
  assert.deepEqual(project.creator, { "@id": organizationId(ORIGIN) });
  assert.deepEqual(project.isPartOf, { "@id": websiteId(ORIGIN) });

  assert.equal(
    (breadcrumb!.itemListElement as { position: number; item: string }[]).length,
    3,
  );
  assert.equal(
    (breadcrumb!.itemListElement as { item: string }[])[2].item,
    `${ORIGIN}/work/harbour-light`,
    "the trail ends at the canonical URL of the page",
  );

  for (const node of graph) {
    for (const [key, value] of Object.entries(node)) {
      assert.ok(
        value !== null && value !== undefined && value !== "",
        `${String(node["@type"])}.${key} is never an empty claim`,
      );
    }
  }

  // Nothing is invented for a CMS that holds nothing.
  const sparse = buildOrganizationLd({
    origin: ORIGIN,
    studioName: "Portfolio",
  });
  assert.deepEqual(
    Object.keys(sparse).sort(),
    ["@id", "@type", "name", "url"].sort(),
    "an empty CMS yields identity and nothing else -- no address, rating, or price",
  );
  assert.equal(
    buildBreadcrumbLd(ORIGIN, []),
    null,
    "an empty trail yields no breadcrumb node",
  );

  const serialized = serializeJsonLd(graph);
  const parsed = JSON.parse(serialized) as {
    "@context": string;
    "@graph": JsonLdObject[];
  };

  assert.equal(parsed["@context"], "https://schema.org");
  assert.equal(parsed["@graph"].length, graph.length);
  assert.ok(
    values(parsed["@graph"])
      .filter((value) => value.startsWith("http"))
      .every((value) => value.startsWith("https://")),
    "every URL in the graph is absolute and https",
  );

  const hostile = serializeJsonLd([
    buildOrganizationLd({
      origin: ORIGIN,
      studioName: '</script><img src=x onerror="alert(1)">',
    }),
  ]);
  assert.ok(!hostile.includes("</script>"), "a CMS value cannot close the script");
  assert.ok(!hostile.includes("<"), "angle brackets are escaped");
  assert.equal(
    (JSON.parse(hostile) as { "@graph": JsonLdObject[] })["@graph"][0].name,
    '</script><img src=x onerror="alert(1)">',
    "escaping is lossless -- a consumer still reads the original value",
  );

  const layout = await readFile("src/app/(public)/layout.tsx", "utf8");
  assert.ok(
    layout.includes("siteStructuredData"),
    "Organization and WebSite are emitted site-wide",
  );

  const detail = await readFile("src/app/(public)/work/[slug]/page.tsx", "utf8");
  assert.ok(
    detail.includes("projectStructuredData"),
    "project pages emit their own work and trail",
  );

  const about = await readFile("src/app/(public)/about/page.tsx", "utf8");
  assert.ok(about.includes("aboutStructuredData"), "About emits its trail");

  // No Person node is published anywhere. The CMS holds one identity field and
  // cannot distinguish a sole trader from a company, so naming a natural person
  // from it would be an unverifiable claim (ADR 0009).
  const builders = await readFile("src/lib/seo/structured-data.ts", "utf8");
  assert.ok(
    !/"@type":\s*"Person"/.test(builders),
    "no builder emits a Person node",
  );
  const serverGraph = await readFile("src/server/seo/structured-data.ts", "utf8");
  assert.ok(
    !serverGraph.includes("buildPersonLd"),
    "no page assembles a Person node",
  );

  for (const admin of ["src/app/(admin)/admin/layout.tsx"]) {
    const source = await readFile(admin, "utf8");
    assert.ok(
      !source.includes("JsonLd"),
      "the private workspace publishes no structured data",
    );
  }
}

async function main(): Promise<void> {
  console.log("Verifying SEO:");

  await verifyCanonical();
  await verifyRobots();
  await verifySitemap();
  await verifyMetadata();
  await verifyOpenGraphAndTwitter();
  await verifyStructuredData();

  console.log(
    "SEO verification passed: canonical normalization, crawl policy, sitemap " +
      "contents, metadata precedence, Open Graph and Twitter cards with the " +
      "generated fallback, and an injection-safe JSON-LD graph that invents nothing.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "SEO verification failed");
  process.exitCode = 1;
});
