import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProjectFormVideos,
  isAssignableVideo,
  mergeProjectVideoOptions,
  PROJECT_VIDEO_OPTION_SELECT,
  projectVideoFacts,
  projectVideoRows,
  toProjectVideoOption,
} from "@/lib/cms/project-videos";
import { VIDEO_STATUSES } from "@/lib/video-status";

/** Pure project-video rules for the editor (P3-11E). */

const row = (id: string, status: string, title = `Video ${id}`) => ({
  id,
  title,
  status,
  durationSeconds: 65,
  width: 1920,
  height: 1080,
  maxResolution: "1080p",
  // Columns a careless query might add; the view must not carry them.
  muxUploadId: "UploadSecret01",
  muxAssetId: "AssetSecret01",
  playbackId: "PlaybackSecret01",
  uploaderId: "user-1",
});

describe("project video options", () => {
  it("keep display facts only, never provider identifiers", () => {
    const option = toProjectVideoOption(row("v1", "READY"));
    assert.deepEqual(Object.keys(option ?? {}).sort(), ["durationSeconds", "height", "id", "maxResolution", "status", "title", "width"]);
    assert.equal(JSON.stringify(option).includes("Secret"), false);
    assert.deepEqual(Object.keys(PROJECT_VIDEO_OPTION_SELECT).sort(), ["durationSeconds", "height", "id", "maxResolution", "status", "title", "width"]);
  });

  it("drop a row with an unknown status rather than guess", () => {
    assert.equal(toProjectVideoOption(row("v1", "ARCHIVED")), null);
  });

  it("offer READY only for assignment", () => {
    for (const status of VIDEO_STATUSES) assert.equal(isAssignableVideo({ status }), status === "READY", status);
  });

  it("list attached videos first in saved order, then other READY videos once", () => {
    const attached = [toProjectVideoOption(row("b", "READY"))!, toProjectVideoOption(row("a", "READY"))!];
    const ready = [row("a", "READY"), row("c", "READY"), row("d", "PROCESSING")].map((item) => toProjectVideoOption(item)!);
    assert.deepEqual(mergeProjectVideoOptions(attached, ready).map((video) => video.id), ["b", "a", "c"]);
  });

  it("describe a video in one line", () => {
    assert.equal(projectVideoFacts(toProjectVideoOption(row("a", "READY"))!), "Ready · 1:05 · 1920 × 1080 (1080p)");
  });

  it("store sortOrder from the display order", () => {
    assert.deepEqual(projectVideoRows(["b", "a"]), [
      { videoId: "b", sortOrder: 0 },
      { videoId: "a", sortOrder: 1 },
    ]);
  });
});

describe("project form video section", () => {
  it("lets an ADMIN or SUPER_ADMIN manage videos, preselecting the saved order", () => {
    const view = buildProjectFormVideos(true, [row("b", "READY"), row("a", "READY")], [row("c", "READY"), row("a", "READY")]);
    assert.equal(view.mode, "manage");
    if (view.mode !== "manage") return;
    assert.deepEqual(view.selectedIds, ["b", "a"]);
    assert.deepEqual(view.options.map((video) => video.id), ["b", "a", "c"]);
    assert.equal(JSON.stringify(view).includes("Secret"), false);
  });

  it("shows an EDITOR the attached titles only, and no library", () => {
    const view = buildProjectFormVideos(false, [row("b", "READY", "Brand film")], [row("c", "READY")]);
    assert.deepEqual(view, { mode: "readonly", titles: ["Brand film"] });
  });
});
