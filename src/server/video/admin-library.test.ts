import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { adminLinksFor } from "@/components/admin/admin-links";
import { buildAdminVideoLibrary } from "@/server/video/admin-library";
import { InMemoryVideoRepository } from "@/server/video/in-memory-repository";
import type { VideoRecord } from "@/server/video/repository";

/**
 * The admin video library page's data and guards (P3-11D), with the in-memory
 * repository: no database client is created.
 */

const NOW = new Date("2027-02-01T12:00:00.000Z");
const record = (overrides: Partial<VideoRecord> = {}): VideoRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Brand film",
  originalFilename: "brand.mov",
  declaredSizeBytes: 1000,
  status: "READY",
  uploaderId: "user-a",
  muxUploadId: "UploadIdSecret0001",
  muxAssetId: "AssetIdSecret00001",
  playbackId: "PlaybackIdSecret01",
  durationSeconds: 30,
  width: 1920,
  height: 1080,
  maxResolution: "1080p",
  failureCode: null,
  uploadExpiresAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe("admin video library data", () => {
  it("sends display facts only: no provider ids or uploader reach the browser", async () => {
    const repository = new InMemoryVideoRepository();
    repository.seed(record());
    repository.setAssignments(record().id, [{ projectId: "p", projectStatus: "DRAFT", categoryActive: true }]);
    const library = await buildAdminVideoLibrary({ repository, videoConfigured: true, env: { VIDEO_UPLOAD_ORIGIN: "https://uploads.example.test" } });
    assert.equal(library.videos.length, 1);
    assert.equal(library.videos[0]!.assignmentCount, 1);
    const text = JSON.stringify(library);
    for (const hidden of ["UploadIdSecret0001", "AssetIdSecret00001", "PlaybackIdSecret01", "user-a"]) assert.equal(text.includes(hidden), false, hidden);
    assert.deepEqual(Object.keys(library.videos[0]!).sort(), [
      "assignmentCount",
      "createdAt",
      "durationSeconds",
      "failureCode",
      "height",
      "id",
      "maxResolution",
      "originalFilename",
      "status",
      "title",
      "width",
    ]);
    assert.equal(library.uploadOrigin, "https://uploads.example.test");
    assert.equal(library.uploadsUnavailableMessage, null);
  });

  it("keeps uploads off when video is not configured or the upload host is not confirmed", async () => {
    const repository = new InMemoryVideoRepository();
    const off = await buildAdminVideoLibrary({ repository, videoConfigured: false, env: { VIDEO_UPLOAD_ORIGIN: "https://uploads.example.test" } });
    assert.equal(off.uploadOrigin, null);
    assert.match(off.uploadsUnavailableMessage ?? "", /not available yet/);
    const unconfirmed = await buildAdminVideoLibrary({ repository, videoConfigured: true, env: {} });
    assert.equal(unconfirmed.uploadOrigin, null);
    assert.match(unconfirmed.uploadsUnavailableMessage ?? "", /upload host is confirmed/);
  });
});

describe("admin role enforcement for the video library", () => {
  it("offers the Videos link to ADMIN and SUPER_ADMIN only", () => {
    const hrefs = (role: "EDITOR" | "ADMIN" | "SUPER_ADMIN") => adminLinksFor(role).map((link) => link.href);
    assert.equal(hrefs("EDITOR").includes("/admin/videos"), false);
    assert.equal(hrefs("ADMIN").includes("/admin/videos"), true);
    assert.equal(hrefs("SUPER_ADMIN").includes("/admin/videos"), true);
    assert.ok(hrefs("EDITOR").includes("/admin/media"), "the image library link is unchanged");
  });

  it("guards the page with requireAdmin and answers an EDITOR with the 403 screen before loading data", () => {
    const page = readFileSync("src/app/(admin)/admin/videos/page.tsx", "utf8");
    assert.match(page, /export const dynamic = "force-dynamic"/);
    const guard = page.indexOf("await requireAdmin(ADMIN_VIDEOS_PATH)");
    const load = page.indexOf("await loadAdminVideoLibrary()");
    assert.ok(guard > -1 && load > guard, "guard first");
    assert.match(page, /if \(error instanceof AuthorizationError\) forbidden\(\);/);
  });

  it("lives under the admin middleware matcher", () => {
    const middleware = readFileSync("src/middleware.ts", "utf8");
    assert.match(middleware, /matcher: \["\/admin", "\/admin\/:path\*"\]/);
  });
});

describe("client code cannot reach server secrets", () => {
  it("keeps the client modules free of server imports, MUX_ variables, environment reads, and logging", () => {
    for (const path of [
      "src/app/(admin)/admin/videos/video-library.tsx",
      "src/components/video/hls-player.tsx",
      "src/lib/video-upload.ts",
      "src/lib/video-library.ts",
      "src/lib/video-csp.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.equal(/from "@\/server\//.test(source), false, `${path} imports a server module`);
      assert.equal(/MUX_[A-Z]/.test(source), false, `${path} names a MUX_ variable`);
      assert.equal(/process\.env/.test(source), false, `${path} reads the environment`);
      assert.equal(/console\.(log|info|warn|error)/.test(source), false, `${path} logs`);
    }
  });

  it("leaves the image library and its deletion workflow unchanged", () => {
    const actions = readFileSync("src/app/(admin)/admin/media/actions.ts", "utf8");
    assert.match(actions, /deleteMediaAction[\s\S]*requireAdmin\(ADMIN_MEDIA_PATH\)/);
    const page = readFileSync("src/app/(admin)/admin/media/page.tsx", "utf8");
    assert.match(page, /<AdminForm action=\{deleteMediaAction\}/);
    assert.equal(/video/i.test(page), false);
  });
});
