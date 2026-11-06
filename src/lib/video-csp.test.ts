import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { securityHeaders, videoAdminSecurityHeaders } from "@/lib/security-headers";
import { VIDEO_PLAYLIST_ORIGIN, parseHttpsOrigin, videoPlaybackOrigins, videoUploadOrigin } from "@/lib/video-csp";

/** Content-Security-Policy for uploaded video (P3-11D). */

const csp = (headers: Array<{ key: string; value: string }>) => headers.find((header) => header.key === "Content-Security-Policy")!.value;
const directive = (policy: string, name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

/** The global policy exactly as it was before P3-11D, for a bare production environment. */
const BASELINE =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self' https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com; media-src 'self'; upgrade-insecure-requests";

describe("origin parsing", () => {
  it("accepts only explicit https origins", () => {
    assert.equal(parseHttpsOrigin("https://uploads.example.test"), "https://uploads.example.test");
    assert.equal(parseHttpsOrigin(" https://uploads.example.test/ "), "https://uploads.example.test");
    const bad = [
      "",
      "http://uploads.example.test",
      "https://*.example.test",
      "https://user:pw@host.test",
      "https://host.test/path",
      "https://host.test/?q=1",
      "javascript:alert(1)",
      "*",
      undefined,
    ];
    for (const value of bad) assert.equal(parseHttpsOrigin(value), null, String(value));
  });

  it("keeps uploads off until VIDEO_UPLOAD_ORIGIN is a valid origin", () => {
    assert.equal(videoUploadOrigin({}), null);
    assert.equal(videoUploadOrigin({ VIDEO_UPLOAD_ORIGIN: "https://*.googleapis.com" }), null);
    assert.equal(videoUploadOrigin({ VIDEO_UPLOAD_ORIGIN: "https://uploads.example.test" }), "https://uploads.example.test");
  });

  it("always includes the playlist origin and drops every extra on any invalid entry", () => {
    assert.deepEqual(videoPlaybackOrigins({}), [VIDEO_PLAYLIST_ORIGIN]);
    assert.deepEqual(videoPlaybackOrigins({ VIDEO_PLAYBACK_ORIGINS: "https://a.example.test, https://b.example.test" }), [
      VIDEO_PLAYLIST_ORIGIN,
      "https://a.example.test",
      "https://b.example.test",
    ]);
    assert.deepEqual(videoPlaybackOrigins({ VIDEO_PLAYBACK_ORIGINS: "https://a.example.test https://*.mux.com" }), [VIDEO_PLAYLIST_ORIGIN]);
  });
});

describe("policies", () => {
  it("leaves the global policy unchanged, even with video variables set", () => {
    assert.equal(csp(securityHeaders({ NODE_ENV: "production" })), BASELINE);
    const withVideo = {
      NODE_ENV: "production",
      VIDEO_UPLOAD_ORIGIN: "https://uploads.example.test",
      VIDEO_PLAYBACK_ORIGINS: "https://a.example.test",
      MUX_TOKEN_ID: "x",
    };
    assert.equal(csp(securityHeaders(withVideo)), BASELINE);
  });

  it("widens only connect-src and media-src on /admin/videos", () => {
    const headers = videoAdminSecurityHeaders({ NODE_ENV: "production", VIDEO_UPLOAD_ORIGIN: "https://uploads.example.test" });
    assert.deepEqual(headers.map((header) => header.key), ["Content-Security-Policy"], "only the policy is replaced on that route");
    const policy = csp(headers);
    assert.equal(
      directive(policy, "connect-src"),
      "connect-src 'self' https://challenges.cloudflare.com https://stream.mux.com https://uploads.example.test",
    );
    assert.equal(directive(policy, "media-src"), "media-src 'self' blob: https://stream.mux.com");
    for (const name of ["default-src", "script-src", "img-src", "frame-src", "object-src", "frame-ancestors", "form-action", "style-src", "font-src"]) {
      assert.equal(directive(policy, name), directive(BASELINE, name), name);
    }
    assert.equal(policy.includes("worker-src"), false, "hls.js runs without a worker");
    assert.equal(policy.includes("*"), false, "no wildcard source");
  });

  it("omits any upload origin until one is configured", () => {
    const policy = csp(videoAdminSecurityHeaders({ NODE_ENV: "production" }));
    assert.equal(directive(policy, "connect-src"), "connect-src 'self' https://challenges.cloudflare.com https://stream.mux.com");
  });

  it("keeps the monitoring origin on the video page too", () => {
    const policy = csp(videoAdminSecurityHeaders({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: "https://abc@o1.ingest.sentry.io/1" }));
    assert.match(directive(policy, "connect-src"), /ingest\.sentry\.io/);
  });

  it("applies the video policy after the global entry, for /admin/videos only", () => {
    const config = readFileSync("next.config.ts", "utf8");
    const global = config.indexOf('{ source: "/:path*", headers: securityHeaders(process.env) }');
    const video = config.indexOf('{ source: "/admin/videos", headers: videoAdminSecurityHeaders(process.env) }');
    assert.ok(global > -1 && video > global, "later entries win for the same header key");
  });
});
