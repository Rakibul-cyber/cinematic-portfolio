import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPublicImage,
  selectImageCandidates,
} from "@/lib/public/image-source";
import { resolveMetadataFields } from "@/lib/public/metadata-fallback";
import { isValidVideoId, toVideoRef, videoEmbedUrl } from "@/lib/video";
import { ALL_PUBLIC_TAGS, PublicTag } from "@/server/public/cache-tags";
import {
  isSafeExternalHref,
  toParagraphs,
  toPhoneHref,
  toProjectDetail,
  toProjectSummary,
  toPublicImage,
  toPublicSocialLinks,
  toPublicTestimonial,
  type MediaRow,
  type ProjectRow,
} from "@/server/public/mappers";
import {
  ACTIVE_WHERE,
  projectMediaOrderBy,
  projectOrderBy,
  PUBLISHED_PROJECT_WHERE,
} from "@/server/public/publication";

/**
 * Phase 5 public-portfolio rules.
 *
 * These exercise the pure boundary: publication filters, the Prisma-row to
 * view-model mapping, responsive source selection, video privacy, and the
 * metadata fallback chain. Behaviour that only exists over HTTP — draft URLs
 * returning 404, public routes needing no session, and the YouTube iframe
 * staying absent until activation — is checked against a running application
 * by `npm run public:verify`.
 */

/** Stands in for the server-side R2 delivery helper. */
const resolveUrl = (objectKey: string) => `https://media.example/${objectKey}`;

function media(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    width: 2560,
    height: 1707,
    objectKey: "media/2026/09/id/master.webp",
    altText: "A lit doorway at dusk",
    caption: null,
    blurDataUrl: "data:image/webp;base64,AAAA",
    variants: [
      { width: 320, height: 213, objectKey: "media/2026/09/id/thumbnail.webp" },
      { width: 640, height: 427, objectKey: "media/2026/09/id/w640.webp" },
      { width: 1280, height: 853, objectKey: "media/2026/09/id/w1280.webp" },
      { width: 1920, height: 1280, objectKey: "media/2026/09/id/w1920.webp" },
    ],
    ...overrides,
  };
}

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    slug: "harbour-light",
    title: "Harbour Light",
    summary: "A summary.",
    description: "First paragraph.\n\nSecond paragraph.",
    clientName: null,
    location: null,
    projectDate: new Date("2026-04-02T00:00:00.000Z"),
    seoTitle: null,
    seoDescription: null,
    videoProvider: null,
    videoId: null,
    videoTitle: null,
    category: { name: "Editorial", slug: "editorial" },
    media: [{ sortOrder: 0, media: media() }],
    ...overrides,
  };
}

describe("publication rules", () => {
  it("restricts public project reads to published work in active categories", () => {
    assert.equal(PUBLISHED_PROJECT_WHERE.status, "PUBLISHED");
    assert.deepEqual(PUBLISHED_PROJECT_WHERE.category, { isActive: true });
  });

  it("restricts services, testimonials, and social links to active rows", () => {
    // One shared filter backs all three lists, so an inactive service,
    // testimonial, or social link is never fetched publicly.
    assert.deepEqual(ACTIVE_WHERE, { isActive: true });
  });

  it("orders projects and galleries deterministically", () => {
    assert.deepEqual(projectOrderBy(), [
      { sortOrder: "asc" },
      { publishedAt: "desc" },
      { slug: "asc" },
    ]);
    assert.deepEqual(projectMediaOrderBy(), [
      { sortOrder: "asc" },
      { mediaId: "asc" },
    ]);
  });

  it("declares a cache tag for every public entity", () => {
    for (const tag of Object.values(PublicTag)) {
      assert.ok(ALL_PUBLIC_TAGS.includes(tag), `${tag} is missing`);
    }
  });
});

describe("responsive image delivery", () => {
  it("never offers the master when a smaller variant covers the layout", () => {
    const selected = selectImageCandidates(
      [
        { width: 320, height: 213, url: "a" },
        { width: 640, height: 427, url: "b" },
        { width: 1920, height: 1280, url: "c" },
        { width: 2560, height: 1707, url: "master" },
      ],
      640,
    );

    assert.deepEqual(
      selected.map((candidate) => candidate.width),
      [320, 640],
    );
  });

  it("falls back to the next size up when nothing reaches the layout width", () => {
    const selected = selectImageCandidates(
      [
        { width: 320, height: 213, url: "a" },
        { width: 500, height: 333, url: "master" },
      ],
      640,
    );

    assert.deepEqual(
      selected.map((candidate) => candidate.url),
      ["a", "master"],
    );
  });

  it("builds a srcset and returns null when there is no usable source", () => {
    const image = buildPublicImage(
      [
        { width: 320, height: 213, url: "a" },
        { width: 640, height: 427, url: "b" },
      ],
      { maxWidth: 720, alt: "Alt" },
    );

    assert.equal(image?.srcSet, "a 320w, b 640w");
    assert.equal(image?.src, "b");
    assert.equal(image?.width, 640);
    assert.equal(buildPublicImage([], { maxWidth: 640, alt: "" }), null);
  });

  it("builds every URL through the configured delivery helper", () => {
    const image = toPublicImage(media(), { maxWidth: 1920, resolveUrl });

    assert.ok(image);
    for (const entry of image.srcSet.split(", ")) {
      assert.match(entry, /^https:\/\/media\.example\/media\/2026\/09\/id\//);
    }
    // 1920 covers the layout, so the 2560 master is not offered.
    assert.ok(!image.srcSet.includes("master.webp"));
  });

  it("never invents alt text for an image that has none", () => {
    const image = toPublicImage(media({ altText: null }), {
      maxWidth: 640,
      resolveUrl,
    });

    assert.equal(image?.alt, "");
  });
});

describe("public view models", () => {
  it("orders gallery media by sortOrder", () => {
    const detail = toProjectDetail(
      project({
        media: [
          {
            sortOrder: 2,
            media: media({ objectKey: "media/2026/09/c/master.webp", variants: [] }),
          },
          {
            sortOrder: 0,
            media: media({ objectKey: "media/2026/09/a/master.webp", variants: [] }),
          },
          {
            sortOrder: 1,
            media: media({ objectKey: "media/2026/09/b/master.webp", variants: [] }),
          },
        ],
      }),
      resolveUrl,
    );

    assert.deepEqual(
      detail.gallery.map((image) => image.src),
      [
        "https://media.example/media/2026/09/a/master.webp",
        "https://media.example/media/2026/09/b/master.webp",
        "https://media.example/media/2026/09/c/master.webp",
      ],
    );
    assert.equal(detail.shareImageUrl, detail.gallery[0].src);
  });

  it("exposes no administrative fields", () => {
    const detail = toProjectDetail(project(), resolveUrl);
    const summary = toProjectSummary(project(), resolveUrl);
    const forbidden = [
      "id",
      "categoryId",
      "status",
      "featured",
      "sortOrder",
      "publishedAt",
      "createdAt",
      "updatedAt",
      "createdByUserId",
      "objectKey",
      "bucket",
    ];

    for (const key of forbidden) {
      assert.ok(!(key in detail), `detail exposes ${key}`);
      assert.ok(!(key in summary), `summary exposes ${key}`);
      assert.ok(!(key in summary.category), `category exposes ${key}`);
    }
  });

  it("keeps project copy as plain paragraphs", () => {
    assert.deepEqual(toParagraphs("One.\n\nTwo."), ["One.", "Two."]);
    assert.deepEqual(toParagraphs(null), []);
    assert.deepEqual(toProjectDetail(project(), resolveUrl).description, [
      "First paragraph.",
      "Second paragraph.",
    ]);
  });

  it("joins testimonial attribution and omits it when empty", () => {
    assert.equal(
      toPublicTestimonial({
        quote: "Q",
        authorName: "A",
        authorRole: "Director",
        company: "Studio",
        projectName: null,
      }).attribution,
      "Director · Studio",
    );
    assert.equal(
      toPublicTestimonial({
        quote: "Q",
        authorName: "A",
        authorRole: null,
        company: null,
        projectName: null,
      }).attribution,
      null,
    );
  });

  it("drops social links that are not http(s)", () => {
    assert.equal(isSafeExternalHref("javascript:alert(1)"), false);
    assert.equal(isSafeExternalHref("https://example.com"), true);
    assert.deepEqual(
      toPublicSocialLinks([
        { platform: "x", label: "Bad", url: "javascript:alert(1)" },
        { platform: "ig", label: "Good", url: "https://example.com/studio" },
      ]).map((link) => link.label),
      ["Good"],
    );
  });

  it("builds dialable contact hrefs and rejects unusable numbers", () => {
    assert.equal(toPhoneHref("+49 30 1234567", "tel"), "tel:+49301234567");
    assert.equal(
      toPhoneHref("+49 30 1234567", "whatsapp"),
      "https://wa.me/49301234567",
    );
    assert.equal(toPhoneHref("12", "tel"), null);
    assert.equal(toPhoneHref(null, "tel"), null);
  });
});

describe("video privacy", () => {
  it("embeds YouTube through the privacy-enhanced domain", () => {
    const ref = toVideoRef({ provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" });

    assert.ok(ref);
    const url = videoEmbedUrl(ref);
    assert.ok(url?.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"));
    assert.ok(!url?.includes("//www.youtube.com"));
  });

  it("asks Vimeo not to track and refuses to frame unknown providers", () => {
    const vimeo = toVideoRef({ provider: "VIMEO", videoId: "123456789" });
    assert.match(videoEmbedUrl(vimeo!) ?? "", /player\.vimeo\.com.*dnt=1/);

    const external = toVideoRef({ provider: "EXTERNAL", videoId: "abc" });
    assert.equal(videoEmbedUrl(external!), null);
  });

  it("rejects URLs, embed markup, and incomplete video references", () => {
    assert.equal(
      isValidVideoId("YOUTUBE", "https://youtu.be/dQw4w9WgXcQ"),
      false,
    );
    assert.equal(isValidVideoId("YOUTUBE", '<iframe src="x"></iframe>'), false);
    assert.equal(isValidVideoId("VIMEO", "not-numeric"), false);
    assert.equal(toVideoRef({ provider: "YOUTUBE", videoId: null }), null);
    assert.equal(toVideoRef({ provider: null, videoId: "dQw4w9WgXcQ" }), null);
    assert.equal(toVideoRef({ provider: "TIKTOK", videoId: "abcdef" }), null);
  });
});

describe("metadata fallbacks", () => {
  const base = {
    studioName: "Studio",
    fallbackDescription: "Fallback description.",
  };

  it("prefers the page value, then the CMS default, then the constant", () => {
    assert.deepEqual(
      resolveMetadataFields({
        ...base,
        title: "Harbour Light",
        description: "SEO description.",
        defaultTitle: "Default title",
        defaultDescription: "Default description",
      }),
      { title: "Harbour Light", description: "SEO description." },
    );

    assert.deepEqual(
      resolveMetadataFields({
        ...base,
        title: "  ",
        description: null,
        defaultTitle: "Default title",
        defaultDescription: "Default description",
      }),
      { title: "Default title", description: "Default description" },
    );

    assert.deepEqual(resolveMetadataFields(base), {
      title: "Studio",
      description: "Fallback description.",
    });
  });
});
