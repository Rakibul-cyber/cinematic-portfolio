import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "node:test";

import { MUX_STREAM_ORIGIN, signPlaybackToken, signedPlaybackUrl } from "@/server/video/playback-token";

/** A throwaway key pair; never a real signing key. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PLAYBACK_ID = "SignedPlayback0000000001";
const KEY_ID = "FictionalSigningKey0001";
const NOW_MS = 1_800_000_000_000;

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
const token = (overrides: Partial<Parameters<typeof signPlaybackToken>[0]> = {}) =>
  signPlaybackToken({ playbackId: PLAYBACK_ID, keyId: KEY_ID, privateKey, audience: "v", ttlSeconds: 600, nowMs: NOW_MS, ...overrides });

describe("signed playback tokens", () => {
  it("carry the documented RS256 header and claims", () => {
    const [header, payload, signature] = token().split(".");
    assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT", kid: KEY_ID });
    assert.deepEqual(decode(payload), { sub: PLAYBACK_ID, aud: "v", exp: 1_800_000_600, kid: KEY_ID });
    assert.match(signature, /^[A-Za-z0-9_-]+$/, "base64url, no padding");
  });

  it("are signed with the private key and verify with its public key", () => {
    const [header, payload, signature] = token({ audience: "t", ttlSeconds: 3600 }).split(".");
    assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
    const forged = Buffer.from(JSON.stringify({ ...decode(payload), exp: 9_999_999_999 })).toString("base64url");
    assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${forged}`), publicKey, Buffer.from(signature, "base64url")), false);
  });

  it("enforce lifetime bounds and identifier shapes", () => {
    for (const ttlSeconds of [59, 86_401, 0, -1, 1.5]) assert.throws(() => token({ ttlSeconds }), RangeError, String(ttlSeconds));
    assert.doesNotThrow(() => token({ ttlSeconds: 60 }));
    assert.doesNotThrow(() => token({ ttlSeconds: 86_400 }));
    assert.throws(() => token({ playbackId: "../x" }), RangeError);
    assert.throws(() => token({ keyId: "bad key" }), RangeError);
  });

  it("refuse a public key or a non-RSA key", () => {
    assert.throws(() => token({ privateKey: publicKey }), TypeError);
    assert.throws(() => token({ privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey }), TypeError);
  });

  it("contain no key material", () => {
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const body = pem.split("\n")[1];
    assert.ok(!token().includes(body));
    assert.ok(!Buffer.from(token().split(".")[1], "base64url").toString().includes("PRIVATE"));
  });
});

describe("signed playback URLs", () => {
  it("always use HTTPS and encode the token", () => {
    const url = signedPlaybackUrl(PLAYBACK_ID, "a.b+c/d=");
    assert.equal(url, `${MUX_STREAM_ORIGIN}/${PLAYBACK_ID}.m3u8?token=a.b%2Bc%2Fd%3D`);
    assert.equal(new URL(url).protocol, "https:");
  });

  it("refuse an unsafe playback ID", () => {
    assert.throws(() => signedPlaybackUrl("../../evil", "t"), RangeError);
  });
});
