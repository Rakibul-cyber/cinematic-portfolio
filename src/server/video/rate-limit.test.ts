import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BucketIncrement } from "@/server/security/rate-limit-buckets";
import { VIDEO_RATE_LIMITS, consumeVideoRateLimit } from "@/server/video/rate-limit";

const KEY = "fictional-rate-limit-hmac-key-000000000";

function counter(start = 0) {
  const seen: BucketIncrement[] = [];
  let count = start;
  return {
    seen,
    deps: {
      hmacKey: () => KEY,
      increment: async (increments: BucketIncrement[]) => {
        seen.push(...increments);
        count += 1;
        return [count];
      },
    },
  };
}

const fail = (message: string) => () => {
  throw new Error(message);
};

describe("video rate limits", () => {
  it("allows up to the limit and refuses the next request", async () => {
    const { deps } = counter(VIDEO_RATE_LIMITS.upload.limit - 1);
    assert.equal(await consumeVideoRateLimit("upload", "user:u", deps), "allowed");
    assert.equal(await consumeVideoRateLimit("upload", "user:u", deps), "limited");
  });

  it("counts a pseudonymous key in the policy's scope and window", async () => {
    const { deps, seen } = counter();
    const now = new Date("2027-01-01T00:00:00Z");
    await consumeVideoRateLimit("playbackPublic", "client:203.0.113.9", { ...deps, now: () => now });
    assert.equal(seen[0]!.scope, "video:playback-public");
    assert.equal(seen[0]!.windowMs, VIDEO_RATE_LIMITS.playbackPublic.windowMs);
    assert.equal(seen[0]!.now, now);
    assert.match(seen[0]!.keyHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(seen).includes("203.0.113.9"), false);
  });

  it("is unavailable, never permissive, without a key or working storage", async () => {
    assert.equal(await consumeVideoRateLimit("upload", "user:u", { ...counter().deps, hmacKey: () => null }), "unavailable");
    assert.equal(await consumeVideoRateLimit("upload", "user:u", { ...counter().deps, hmacKey: fail("key") }), "unavailable");
    assert.equal(await consumeVideoRateLimit("upload", "user:u", { ...counter().deps, increment: async () => fail("db down")() }), "unavailable");
    assert.equal(await consumeVideoRateLimit("upload", "user:u", { ...counter().deps, increment: async () => [] }), "limited");
  });

  it("ignores cleanup failures", async () => {
    const { deps } = counter();
    assert.equal(await consumeVideoRateLimit("cancel", "user:u", { ...deps, prune: async () => fail("cleanup")() }), "allowed");
  });
});
