import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Secret } from "@/server/video/secret";
import { computeMuxSignature, verifyMuxWebhookSignature } from "@/server/video/webhook-signature";

/** A fictional signing secret. */
const SECRET = "fictional-webhook-secret-0001";
const secret = new Secret(SECRET);
const NOW_SECONDS = 1_800_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const BODY = JSON.stringify({ id: "event-1", type: "video.asset.ready", data: { id: "AssetId0123456789" } });

const header = (timestamp = NOW_SECONDS, body = BODY, key = SECRET) => `t=${timestamp},v1=${computeMuxSignature(key, timestamp, body)}`;
const verify = (h: string | null | undefined, body: string | Buffer = BODY, nowMs = NOW_MS, toleranceSeconds?: number) =>
  verifyMuxWebhookSignature({ header: h, rawBody: body, secret, nowMs, toleranceSeconds });

describe("Mux webhook signatures", () => {
  it("accept a correctly signed raw body", () => {
    assert.deepEqual(verify(header()), { ok: true, timestamp: NOW_SECONDS });
    assert.deepEqual(verify(header(), Buffer.from(BODY)), { ok: true, timestamp: NOW_SECONDS }, "raw bytes work too");
  });

  it("accept when any one of several v1 signatures matches (secret rotation)", () => {
    const valid = computeMuxSignature(SECRET, NOW_SECONDS, BODY);
    const other = computeMuxSignature("another-fictional-secret", NOW_SECONDS, BODY);
    assert.equal(verify(`t=${NOW_SECONDS},v1=${other},v1=${valid}`).ok, true);
    assert.equal(verify(`t=${NOW_SECONDS}, v0=ignored-scheme, v1=${valid}`).ok, true, "unknown schemes are ignored");
  });

  it("reject a tampered body, a re-serialized body, or the wrong secret", () => {
    assert.deepEqual(verify(header(), BODY.replace("ready", "errored")), { ok: false, reason: "mismatch" });
    assert.deepEqual(verify(header(), JSON.stringify(JSON.parse(BODY), null, 2)), { ok: false, reason: "mismatch" });
    assert.deepEqual(verify(header(NOW_SECONDS, BODY, "wrong-fictional-secret")), { ok: false, reason: "mismatch" });
  });

  it("reject a signature moved to a different timestamp", () => {
    const signature = computeMuxSignature(SECRET, NOW_SECONDS, BODY);
    assert.deepEqual(verify(`t=${NOW_SECONDS - 10},v1=${signature}`), { ok: false, reason: "mismatch" });
  });

  it("enforce the timestamp tolerance in both directions", () => {
    assert.equal(verify(header(NOW_SECONDS - 300)).ok, true, "exactly at the 300 s boundary");
    assert.deepEqual(verify(header(NOW_SECONDS - 301)), { ok: false, reason: "outside_tolerance" });
    assert.deepEqual(verify(header(NOW_SECONDS + 301)), { ok: false, reason: "outside_tolerance" });
    assert.deepEqual(verify(header(NOW_SECONDS - 61), BODY, NOW_MS, 60), { ok: false, reason: "outside_tolerance" });
  });

  it("reject missing and malformed headers", () => {
    assert.deepEqual(verify(null), { ok: false, reason: "missing_header" });
    assert.deepEqual(verify(""), { ok: false, reason: "missing_header" });
    const signature = computeMuxSignature(SECRET, NOW_SECONDS, BODY);
    for (const h of [
      "garbage",
      `v1=${signature}`,
      `t=${NOW_SECONDS}`,
      `t=${NOW_SECONDS},v1=not-hex`,
      `t=${NOW_SECONDS},v1=${signature.slice(0, 10)}`,
      `t=abc,v1=${signature}`,
      `t=${NOW_SECONDS},t=${NOW_SECONDS},v1=${signature}`,
      `t=${NOW_SECONDS},=v1`,
      `t=${NOW_SECONDS},v1=${signature},${"x".repeat(5000)}`,
    ]) {
      assert.deepEqual(verify(h), { ok: false, reason: "malformed_header" }, h.slice(0, 60));
    }
  });

  it("never reveal the expected signature", () => {
    const expected = computeMuxSignature(SECRET, NOW_SECONDS, BODY);
    const result = verify(`t=${NOW_SECONDS},v1=${"0".repeat(64)}`);
    assert.deepEqual(result, { ok: false, reason: "mismatch" });
    assert.ok(!JSON.stringify(result).includes(expected));
  });
});
