import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { securityHeaders } from "@/lib/security-headers";
import { projectSchema, settingsSchema } from "@/lib/validation/cms";
import { toVideoRef, videoEmbedUrl, videoSourceUrl } from "@/lib/video";
import { parseEmbeddableVideoUrl, parseVideoUrl } from "@/lib/video-url";

/**
 * External video (YouTube, Vimeo, Google Drive) replacing the Mux upload MVP.
 * Pure checks; nothing here contacts a provider.
 */

const DRIVE_ID = "1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345";

describe("Google Drive links", () => {
  it("accepts the shapes Drive's Share and address bar produce, and keeps only the file ID", () => {
    for (const link of [
      `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
      `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=drive_link`,
      `https://drive.google.com/file/d/${DRIVE_ID}/preview`,
      `https://drive.google.com/file/d/${DRIVE_ID}`,
      `https://drive.google.com/open?id=${DRIVE_ID}`,
      `https://drive.google.com/uc?id=${DRIVE_ID}&export=download`,
      `drive.google.com/file/d/${DRIVE_ID}/view`,
      ` https://DRIVE.GOOGLE.COM/file/d/${DRIVE_ID}/view `,
    ]) {
      assert.deepEqual(parseVideoUrl(link), { ok: true, value: { provider: "GOOGLE_DRIVE", videoId: DRIVE_ID } }, link);
    }
  });

  it("refuses folders, Docs, look-alike hosts, other ports, and malformed IDs", () => {
    const refused: Array<[string, string]> = [
      [`https://drive.google.com/drive/folders/${DRIVE_ID}`, "missing_id"],
      [`https://docs.google.com/document/d/${DRIVE_ID}/edit`, "unsupported_host"],
      [`https://drive.google.com.evil.example/file/d/${DRIVE_ID}/view`, "unsupported_host"],
      [`https://evil-drive.google.com/file/d/${DRIVE_ID}/view`, "unsupported_host"],
      [`https://drive.google.com:8443/file/d/${DRIVE_ID}/view`, "unsupported_host"],
      ["https://drive.google.com/file/d/short/view", "invalid_id"],
      [`https://drive.google.com/file/d/${DRIVE_ID}%22onload%3D/view`, "invalid_id"],
      ["https://drive.google.com/open", "missing_id"],
      [`javascript:alert(1)//drive.google.com/file/d/${DRIVE_ID}`, "unsupported_scheme"],
    ];
    for (const [link, error] of refused) assert.deepEqual(parseVideoUrl(link), { ok: false, error }, link);
  });

  it("embeds only through the /preview player, built from the validated ID", () => {
    const ref = toVideoRef({ provider: "GOOGLE_DRIVE", videoId: DRIVE_ID, title: "Showreel" });
    assert.ok(ref);
    assert.equal(videoEmbedUrl(ref), `https://drive.google.com/file/d/${DRIVE_ID}/preview`);
    assert.equal(toVideoRef({ provider: "GOOGLE_DRIVE", videoId: "../../evil" }), null);
    assert.equal(toVideoRef({ provider: "GOOGLE_DRIVE", videoId: "x".repeat(65) }), null);
  });
});

describe("admin video links", () => {
  it("round-trips every provider through the link shown in the form", () => {
    for (const video of [
      { provider: "YOUTUBE", videoId: "dQw4w9WgXcQ" },
      { provider: "VIMEO", videoId: "76979871" },
      { provider: "GOOGLE_DRIVE", videoId: DRIVE_ID },
    ] as const) {
      const link = videoSourceUrl(video);
      assert.ok(link);
      assert.deepEqual(parseEmbeddableVideoUrl(link), { ok: true, value: video });
    }
    assert.equal(videoSourceUrl({ provider: "EXTERNAL", videoId: "abc" }), null);
  });

  it("refuses unlisted Vimeo links, whose privacy hash is not stored", () => {
    const result = parseEmbeddableVideoUrl("https://vimeo.com/76979871/abcdef1234");
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : "", /unlisted/i);
  });

  it("explains a refused link without echoing it", () => {
    const link = "https://example.com/secret-path/film.mp4";
    const result = parseEmbeddableVideoUrl(link);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && !result.message.includes("secret-path"));
  });
});

describe("project schema", () => {
  const base = {
    title: "Project",
    slug: "project",
    summary: "Summary.",
    description: "Description.",
    clientName: "",
    location: "",
    projectDate: "",
    categoryId: "8f14e45f-ceea-4e7a-9f3b-2f2a1b1c1d1e",
    status: "DRAFT",
    featured: "",
    sortOrder: "0",
    seoTitle: "",
    seoDescription: "",
    videoTitle: "Brand film",
  };

  it("stores only the provider and ID detected from the pasted link", () => {
    const parsed = projectSchema.parse({ ...base, videoUrl: `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing` });
    assert.equal(parsed.videoProvider, "GOOGLE_DRIVE");
    assert.equal(parsed.videoId, DRIVE_ID);
    assert.equal(parsed.videoTitle, "Brand film");
    assert.equal("videoUrl" in parsed, false, "the link itself is never stored");

    const youtube = projectSchema.parse({ ...base, videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
    assert.deepEqual([youtube.videoProvider, youtube.videoId], ["YOUTUBE", "dQw4w9WgXcQ"]);
  });

  it("clears the video and its title when the link is empty", () => {
    const parsed = projectSchema.parse({ ...base, videoUrl: "" });
    assert.deepEqual([parsed.videoProvider, parsed.videoId, parsed.videoTitle], [null, null, null]);
    const omitted = projectSchema.parse(base);
    assert.equal(omitted.videoProvider, null);
  });

  it("refuses an unsupported link on the videoUrl field and ignores old provider/ID inputs", () => {
    const result = projectSchema.safeParse({ ...base, videoUrl: "https://example.com/film.mp4" });
    assert.equal(result.success, false);
    assert.deepEqual(result.error?.issues.map((issue) => issue.path.join(".")), ["videoUrl"]);
    const smuggled = projectSchema.parse({ ...base, videoProvider: "YOUTUBE", videoId: "dQw4w9WgXcQ" });
    assert.equal(smuggled.videoProvider, null, "only a parsed link can set a video");
  });

  it("leaves the homepage showreel on provider and ID, now with Google Drive allowed", () => {
    const settings = { studioName: "Munir Visuals", tagline: "", contactEmail: "", contactPhone: "", whatsappNumber: "", locationText: "", footerCopyright: "", defaultSeoTitle: "", defaultSeoDescription: "" };
    assert.equal(settingsSchema.safeParse({ ...settings, showreelProvider: "YOUTUBE", showreelVideoId: "dQw4w9WgXcQ" }).success, true);
    assert.equal(settingsSchema.safeParse({ ...settings, showreelProvider: "GOOGLE_DRIVE", showreelVideoId: DRIVE_ID }).success, true);
  });
});

describe("content security policy", () => {
  it("adds exactly drive.google.com to frame-src and nothing else", () => {
    const policy = securityHeaders({ NODE_ENV: "production" }).find((header) => header.key === "Content-Security-Policy")!.value;
    const directive = (name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
    assert.equal(
      directive("frame-src"),
      "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com https://drive.google.com",
    );
    assert.equal(policy.match(/google\.com/g)?.length, 1, "Drive appears only in frame-src");
    assert.equal(policy.includes("*"), false, "no wildcard source");
    assert.equal(policy.includes("mux.com"), false, "no Mux origin remains");
  });
});
