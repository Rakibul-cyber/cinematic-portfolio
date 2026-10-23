import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendProjectMedia,
  mergeProjectMediaOptions,
  moveProjectMedia,
  projectMediaRows,
  removeProjectMedia,
  type ProjectMediaOption,
} from "@/lib/cms/project-media";

const media = (id: string): ProjectMediaOption => ({
  id,
  originalName: `${id}.webp`,
  altText: null,
});

describe("project media editing", () => {
  it("keeps attached media outside the recent picker in stored order", () => {
    const options = mergeProjectMediaOptions(
      [media("old-cover"), media("old-gallery")],
      [media("newest"), media("old-gallery")],
    );

    assert.deepEqual(options.map((item) => item.id), [
      "old-cover",
      "old-gallery",
      "newest",
    ]);
  });

  it("preserves every id, order, and cover for an unchanged project", () => {
    assert.deepEqual(projectMediaRows(["cover", "second", "third"]), [
      { mediaId: "cover", sortOrder: 0, role: "COVER" },
      { mediaId: "second", sortOrder: 1, role: "GALLERY" },
      { mediaId: "third", sortOrder: 2, role: "GALLERY" },
    ]);
  });

  it("writes no rows for an empty gallery", () => {
    assert.deepEqual(projectMediaRows([]), []);
    assert.deepEqual(mergeProjectMediaOptions([], []), []);
  });

  it("applies a deliberate reorder and promotes the first item to cover", () => {
    const reordered = moveProjectMedia(["cover", "second", "third"], "second", -1);

    assert.deepEqual(projectMediaRows(reordered), [
      { mediaId: "second", sortOrder: 0, role: "COVER" },
      { mediaId: "cover", sortOrder: 1, role: "GALLERY" },
      { mediaId: "third", sortOrder: 2, role: "GALLERY" },
    ]);
  });

  it("removes only the requested item", () => {
    assert.deepEqual(removeProjectMedia(["cover", "second", "third"], "second"), [
      "cover",
      "third",
    ]);
  });

  it("appends new media predictably and never duplicates an id", () => {
    assert.deepEqual(appendProjectMedia(["cover", "second"], "new"), [
      "cover",
      "second",
      "new",
    ]);
    assert.deepEqual(appendProjectMedia(["cover", "second"], "cover"), [
      "cover",
      "second",
    ]);
  });
});
