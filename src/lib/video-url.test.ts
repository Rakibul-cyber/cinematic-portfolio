import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidVideoId } from "@/lib/video";
import { MAX_VIDEO_URL_LENGTH, parseVideoUrl, type VideoUrlError } from "@/lib/video-url";

const YT = "dQw4w9WgXcQ";

function parsed(input: string) {
  const result = parseVideoUrl(input);
  assert.equal(result.ok, true, `${input} should parse`);
  return (result as Extract<typeof result, { ok: true }>).value;
}

function rejected(input: string, error: VideoUrlError) {
  assert.deepEqual(parseVideoUrl(input), { ok: false, error }, input);
}

describe("parseVideoUrl: YouTube", () => {
  it("accepts every common link form and returns only the ID", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${YT}`,
      `https://youtube.com/watch?v=${YT}&t=42s&list=PL123`,
      `https://m.youtube.com/watch?feature=share&v=${YT}`,
      `https://youtu.be/${YT}`,
      `https://youtu.be/${YT}?si=abcdef`,
      `https://www.youtube.com/embed/${YT}`,
      `https://www.youtube-nocookie.com/embed/${YT}?rel=0`,
      `https://www.youtube.com/shorts/${YT}`,
      `https://www.youtube.com/live/${YT}`,
      `http://www.youtube.com/watch?v=${YT}`,
      `  https://WWW.YOUTUBE.COM/watch?v=${YT}  `,
      `youtu.be/${YT}`,
      `www.youtube.com/watch?v=${YT}`,
    ]) {
      assert.deepEqual(parsed(url), { provider: "YOUTUBE", videoId: YT }, url);
    }
  });

  it("produces IDs the existing stored-ID validation accepts", () => {
    assert.equal(isValidVideoId("YOUTUBE", parsed(`https://youtu.be/${YT}`).videoId), true);
  });

  it("refuses links that do not name one video", () => {
    rejected("https://www.youtube.com/", "missing_id");
    rejected("https://www.youtube.com/watch", "missing_id");
    rejected("https://www.youtube.com/@studio", "missing_id");
    rejected("https://www.youtube.com/playlist?list=PL123", "missing_id");
    rejected("https://youtu.be/", "missing_id");
  });

  it("refuses malformed IDs", () => {
    rejected("https://youtu.be/short", "invalid_id");
    rejected(`https://youtu.be/${YT}X`, "invalid_id");
    rejected("https://www.youtube.com/watch?v=dQw4w9WgX%3Cs", "invalid_id");
    rejected("https://www.youtube.com/embed/..%2F..%2Fetc", "invalid_id");
  });
});

describe("parseVideoUrl: Vimeo", () => {
  it("accepts public, unlisted, player, channel, group, and showcase links", () => {
    assert.deepEqual(parsed("https://vimeo.com/123456789"), { provider: "VIMEO", videoId: "123456789", hash: null });
    assert.deepEqual(parsed("https://vimeo.com/123456789/abcdef1234"), { provider: "VIMEO", videoId: "123456789", hash: "abcdef1234" });
    assert.deepEqual(parsed("https://vimeo.com/123456789?h=abcdef1234"), { provider: "VIMEO", videoId: "123456789", hash: "abcdef1234" });
    assert.deepEqual(parsed("https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0"), {
      provider: "VIMEO",
      videoId: "123456789",
      hash: "abcdef1234",
    });
    assert.deepEqual(parsed("https://player.vimeo.com/video/123456789"), { provider: "VIMEO", videoId: "123456789", hash: null });
    assert.deepEqual(parsed("https://vimeo.com/channels/staffpicks/123456789"), { provider: "VIMEO", videoId: "123456789", hash: null });
    assert.deepEqual(parsed("https://vimeo.com/groups/films/videos/123456789"), { provider: "VIMEO", videoId: "123456789", hash: null });
    assert.deepEqual(parsed("https://vimeo.com/showcase/987654/video/123456789"), { provider: "VIMEO", videoId: "123456789", hash: null });
    assert.deepEqual(parsed("vimeo.com/123456789/abcdef1234"), { provider: "VIMEO", videoId: "123456789", hash: "abcdef1234" });
  });

  it("refuses non-video pages and malformed IDs or hashes", () => {
    rejected("https://vimeo.com/", "missing_id");
    rejected("https://vimeo.com/studio", "missing_id");
    rejected("https://player.vimeo.com/123456789", "missing_id");
    rejected("https://vimeo.com/12345", "invalid_id");
    rejected("https://player.vimeo.com/video/abc", "invalid_id");
    rejected("https://vimeo.com/123456789/<script>", "invalid_hash");
    rejected("https://player.vimeo.com/video/123456789?h=abc-def!", "invalid_hash");
  });
});

describe("parseVideoUrl: hostile and unexpected input", () => {
  it("refuses empty, oversized, and non-URL input", () => {
    rejected("", "empty");
    rejected("   ", "empty");
    rejected(`https://youtu.be/${YT}?x=${"a".repeat(MAX_VIDEO_URL_LENGTH)}`, "too_long");
    rejected("not a url", "not_a_url");
    rejected(`https://youtu.be/${YT} https://evil.example`, "not_a_url");
    rejected(YT, "not_a_url");
  });

  it("refuses script, data, file, and other schemes", () => {
    rejected("javascript:alert(1)//https://youtu.be/dQw4w9WgXcQ", "unsupported_scheme");
    rejected("JaVaScRiPt:alert(1)", "unsupported_scheme");
    rejected("data:text/html,<script>alert(1)</script>", "unsupported_scheme");
    rejected(`ftp://youtu.be/${YT}`, "unsupported_scheme");
    rejected(`file:///youtu.be/${YT}`, "unsupported_scheme");
  });

  it("refuses look-alike hosts, credentials, and ports", () => {
    rejected(`https://youtube.com.evil.example/watch?v=${YT}`, "unsupported_host");
    rejected(`https://evilyoutube.com/watch?v=${YT}`, "unsupported_host");
    rejected(`https://notvimeo.com/123456789`, "unsupported_host");
    rejected(`https://vimeo.com.evil.example/123456789`, "unsupported_host");
    rejected(`https://www.youtube.com@evil.example/watch?v=${YT}`, "credentials_not_allowed");
    rejected(`https://user:pass@www.youtube.com/watch?v=${YT}`, "credentials_not_allowed");
    rejected(`https://www.youtube.com:8443/watch?v=${YT}`, "unsupported_host");
    rejected(`https://example.com/?u=https://youtu.be/${YT}`, "unsupported_host");
  });

  it("never returns anything but provider, ID, and hash", () => {
    const value = parsed(`https://player.vimeo.com/video/123456789?h=abcdef1234&autoplay=1#t=10`);
    assert.deepEqual(Object.keys(value).sort(), ["hash", "provider", "videoId"]);
  });
});
