import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  absoluteUrl,
  normalizeOrigin,
  normalizePath,
  OG_FALLBACK_PATH,
  PUBLIC_ROUTES,
} from "@/lib/seo/canonical";
import { buildMetadataDocument } from "@/lib/seo/metadata-document";
import { buildRobots } from "@/lib/seo/robots-rules";
import { buildSitemapEntries } from "@/lib/seo/sitemap-entries";
import {
  buildBreadcrumbLd,
  buildOrganizationLd,
  buildProjectLd,
  organizationId,
  serializeJsonLd,
} from "@/lib/seo/structured-data";

/**
 * Phase 9 SEO rules.
 *
 * These cover the pure boundary: canonical normalization, the crawl policy,
 * sitemap contents, metadata assembly, and the JSON-LD graph. The wider
 * surface — that every public page declares metadata, that the trackers are
 * mounted once, that the deployment configuration is ISR-safe — is asserted by
 * `npm run seo:verify`, `npm run analytics:verify`, and `npm run deploy:verify`.
 */

const ORIGIN = "https://studio.example";

const BASE = {
  studioName: "Studio",
  fallbackDescription: "Neutral fallback description.",
  origin: ORIGIN,
};

describe("canonical URLs", () => {
  it("reduces a path to one spelling", () => {
    assert.equal(normalizePath("/work/"), "/work");
    assert.equal(normalizePath("work"), "/work");
    assert.equal(normalizePath("/"), "/");
    assert.equal(normalizePath("/work//a/"), "/work/a");
  });

  it("drops the query, so a filtered view is not a page of its own", () => {
    assert.equal(normalizePath("/work?category=film"), "/work");
    assert.equal(normalizePath("/work#top"), "/work");
  });

  it("refuses an origin it cannot use rather than guessing one", () => {
    assert.equal(normalizeOrigin("https://studio.example/"), ORIGIN);
    assert.equal(normalizeOrigin("studio.example"), null);
    assert.equal(normalizeOrigin("javascript:alert(1)"), null);
    assert.equal(normalizeOrigin(undefined), null);
    assert.equal(absoluteUrl(null, "/about"), null);
  });
});

describe("robots", () => {
  it("keeps the private surfaces out of search", () => {
    const [rule] = buildRobots(ORIGIN).rules;

    assert.equal(rule.allow, "/");
    assert.ok(rule.disallow.includes("/admin"));
    assert.ok(rule.disallow.includes("/api/"));
  });

  it("advertises a sitemap only when the origin is known", () => {
    assert.equal(buildRobots(ORIGIN).sitemap, `${ORIGIN}/sitemap.xml`);
    assert.equal(buildRobots(null).sitemap, undefined);
  });
});

describe("sitemap", () => {
  const projects = [
    { slug: "a", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
    { slug: "b", updatedAt: new Date("2026-09-01T00:00:00.000Z") },
  ];

  it("advertises every public route and every published project", () => {
    const urls = buildSitemapEntries({ origin: ORIGIN, projects }).map(
      (entry) => entry.url,
    );

    assert.equal(urls.length, PUBLIC_ROUTES.length + projects.length);
    assert.ok(urls.includes(`${ORIGIN}/`));
    assert.ok(urls.includes(`${ORIGIN}/work/b`));
    assert.equal(new Set(urls).size, urls.length);
  });

  it("dates static routes from the newest published work", () => {
    const entries = buildSitemapEntries({ origin: ORIGIN, projects });

    assert.deepEqual(entries[0].lastModified, projects[1].updatedAt);
  });

  it("is empty without an origin rather than relative", () => {
    assert.deepEqual(buildSitemapEntries({ origin: null, projects }), []);
  });

  it("drops a URL that would break the XML, keeping the rest", () => {
    // Next.js interpolates `<loc>${url}</loc>` without escaping, so one unsafe
    // URL would invalidate the whole document. Slug validation makes this
    // unreachable today; the guard is for the day it is relaxed.
    const entries = buildSitemapEntries({
      origin: ORIGIN,
      projects: [
        { slug: "safe-one", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
        { slug: 'a&b<c>"d', updatedAt: new Date("2026-08-01T00:00:00.000Z") },
      ],
    });
    const urls = entries.map((entry) => entry.url);

    assert.ok(urls.includes(`${ORIGIN}/work/safe-one`), "safe work still listed");
    assert.ok(
      urls.every((url) => !/[<>&"]/.test(url)),
      "no URL can break the document for the others",
    );
    assert.equal(urls.length, PUBLIC_ROUTES.length + 1);
  });
});

describe("metadata", () => {
  it("prefers the page field, then the CMS default, then the constant", () => {
    assert.equal(
      buildMetadataDocument({ ...BASE, path: "/", title: "Page", defaultTitle: "D" })
        .title,
      "Page",
    );
    assert.equal(
      buildMetadataDocument({ ...BASE, path: "/", defaultTitle: "D" }).title,
      "D",
    );
    assert.deepEqual(buildMetadataDocument({ ...BASE, path: "/" }).title, {
      absolute: "Studio",
    });
    assert.equal(
      buildMetadataDocument({ ...BASE, path: "/" }).description,
      BASE.fallbackDescription,
    );
  });

  it("makes the canonical absolute and matches the Open Graph URL", () => {
    const document = buildMetadataDocument({ ...BASE, path: "/work/a/" });
    const openGraph = (document.openGraph ?? {}) as Record<string, unknown>;

    assert.equal(document.alternates?.canonical, `${ORIGIN}/work/a`);
    assert.equal(openGraph.url, `${ORIGIN}/work/a`);
  });

  it("falls back to the generated share image, and only when absolute", () => {
    const fallback = (buildMetadataDocument({ ...BASE, path: "/about" }).openGraph ??
      {}) as Record<string, unknown>;
    assert.deepEqual(fallback.images, [{ url: `${ORIGIN}${OG_FALLBACK_PATH}` }]);

    const own = (buildMetadataDocument({
      ...BASE,
      path: "/work/a",
      imageUrl: "https://media.example/cover.webp",
    }).openGraph ?? {}) as Record<string, unknown>;
    assert.deepEqual(own.images, [{ url: "https://media.example/cover.webp" }]);

    const relative = buildMetadataDocument({ ...BASE, origin: null, path: "/about" });
    assert.equal(
      ((relative.openGraph ?? {}) as Record<string, unknown>).images,
      undefined,
    );
    assert.equal(relative.alternates?.canonical, "/about");
  });

  it("promises a large Twitter card only when there is an image", () => {
    const withImage = buildMetadataDocument({ ...BASE, path: "/about" });
    const without = buildMetadataDocument({ ...BASE, origin: null, path: "/about" });

    assert.equal(
      ((withImage.twitter ?? {}) as Record<string, unknown>).card,
      "summary_large_image",
    );
    assert.equal(
      ((without.twitter ?? {}) as Record<string, unknown>).card,
      "summary",
    );
  });
});

describe("structured data", () => {
  it("invents nothing for an empty CMS", () => {
    const node = buildOrganizationLd({ origin: ORIGIN, studioName: "Portfolio" });

    assert.deepEqual(Object.keys(node).sort(), ["@id", "@type", "name", "url"]);
  });

  it("links a project to the organization by id", () => {
    const node = buildProjectLd({
      origin: ORIGIN,
      slug: "a",
      title: "A",
      summary: "Summary.",
      year: 2026,
    });

    assert.equal(node.url, `${ORIGIN}/work/a`);
    assert.equal(node.dateCreated, "2026");
    assert.deepEqual(node.creator, { "@id": organizationId(ORIGIN) });
    assert.equal(node.image, undefined, "no cover means no image claim");
  });

  it("numbers a breadcrumb trail in order, and omits an empty one", () => {
    const node = buildBreadcrumbLd(ORIGIN, [
      { name: "Home", path: "/" },
      { name: "Work", path: "/work" },
    ]);
    const items = node?.itemListElement as { position: number; item: string }[];

    assert.deepEqual(
      items.map((item) => [item.position, item.item]),
      [
        [1, `${ORIGIN}/`],
        [2, `${ORIGIN}/work`],
      ],
    );
    assert.equal(buildBreadcrumbLd(ORIGIN, []), null);
  });

  it("escapes so no CMS value can close the script element", () => {
    const hostile = '</script><img src=x onerror="alert(1)">';
    const serialized = serializeJsonLd([
      buildOrganizationLd({ origin: ORIGIN, studioName: hostile }),
    ]);

    assert.ok(!serialized.includes("<"));
    assert.ok(!serialized.includes(">"));
    assert.equal(
      (JSON.parse(serialized) as { "@graph": { name: string }[] })["@graph"][0].name,
      hostile,
      "escaping is lossless",
    );
  });
});
