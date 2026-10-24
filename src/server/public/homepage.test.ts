import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arrangeHomepageWork,
  featuredWorkTitle,
  HOMEPAGE_GRID_LIMIT,
} from "@/server/public/homepage";

/**
 * Phase 10D-2A: the hero project must not open the grid directly beneath it.
 */

const project = (slug: string, cover: boolean = true) => ({
  slug,
  cover: cover ? { src: `/${slug}.webp` } : null,
});

const slugs = (projects: readonly { slug: string }[]) =>
  projects.map((item) => item.slug);

describe("homepage work arrangement", () => {
  it("renders nothing for zero projects", () => {
    const work = arrangeHomepageWork([], "featured", HOMEPAGE_GRID_LIMIT);
    assert.equal(work.hero, null);
    assert.deepEqual(work.featured, []);
    assert.equal(work.heroShown, false);
  });

  it("shows a single project once, in the hero, rather than twice", () => {
    const work = arrangeHomepageWork([project("only")], "featured", 6);
    assert.equal(work.hero?.slug, "only");
    assert.equal(work.heroShown, true);
    assert.deepEqual(work.featured, []);
  });

  it("keeps a single cover-less project in the grid, since the hero cannot show it", () => {
    const work = arrangeHomepageWork([project("only", false)], "featured", 6);
    assert.equal(work.heroShown, false);
    assert.deepEqual(slugs(work.featured), ["only"]);
  });

  it("excludes the hero from the grid and preserves the remaining order", () => {
    const work = arrangeHomepageWork(
      [project("a"), project("b"), project("c"), project("d")],
      "featured",
      6,
    );
    assert.equal(work.hero?.slug, "a");
    assert.deepEqual(slugs(work.featured), ["b", "c", "d"]);
  });

  it("keeps the grid at its full size when one extra project was fetched", () => {
    const fetched = Array.from({ length: HOMEPAGE_GRID_LIMIT + 1 }, (_, i) =>
      project(`p${i}`),
    );
    const work = arrangeHomepageWork(fetched, "featured", HOMEPAGE_GRID_LIMIT);
    assert.equal(work.featured.length, HOMEPAGE_GRID_LIMIT);
    assert.ok(!slugs(work.featured).includes("p0"));
  });

  it("caps the grid when the hero shows nothing", () => {
    const fetched = Array.from({ length: 4 }, (_, i) => project(`p${i}`, false));
    const work = arrangeHomepageWork(fetched, "published", 3);
    assert.deepEqual(slugs(work.featured), ["p0", "p1", "p2"]);
  });

  it("does not mutate its input", () => {
    const input = [project("a"), project("b")];
    arrangeHomepageWork(input, "featured", 6);
    assert.deepEqual(slugs(input), ["a", "b"]);
  });
});

describe("featured work heading", () => {
  it("describes flagged work as featured", () => {
    assert.equal(featuredWorkTitle("featured", false), "Featured projects");
    assert.equal(featuredWorkTitle("featured", true), "More featured projects");
  });

  it("does not call fallback work featured or recent", () => {
    for (const heroShown of [true, false]) {
      const title = featuredWorkTitle("published", heroShown);
      assert.doesNotMatch(title, /featured|recent/i);
    }
  });
});
