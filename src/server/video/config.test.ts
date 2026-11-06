import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { VIDEO_PROVIDER_ENV, loadVideoProviderConfig, parseSigningPrivateKey, parseVideoProviderConfig } from "@/server/video/config";
import { Secret } from "@/server/video/secret";

/** Fictional credentials; generated per run, never real. */
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PEM_BASE64 = Buffer.from(PEM).toString("base64");
const VALID = {
  MUX_TOKEN_ID: "fictional-token-id-0001",
  MUX_TOKEN_SECRET: "fictional-token-secret-value-0001",
  MUX_WEBHOOK_SECRET: "fictional-webhook-secret-0001",
  MUX_SIGNING_KEY_ID: "FictionalSigningKey0001",
  MUX_SIGNING_PRIVATE_KEY: PEM_BASE64,
};
const SECRET_VALUES = [VALID.MUX_TOKEN_ID, VALID.MUX_TOKEN_SECRET, VALID.MUX_WEBHOOK_SECRET, PEM_BASE64, PEM.split("\n")[1]];

describe("video provider configuration", () => {
  it("is disabled when nothing is configured", () => {
    assert.deepEqual(parseVideoProviderConfig({}), { status: "disabled" });
    assert.deepEqual(parseVideoProviderConfig({ MUX_TOKEN_ID: "   ", MUX_TOKEN_SECRET: "" }), { status: "disabled" });
    assert.deepEqual(loadVideoProviderConfig({ PATH: "/bin" }), { status: "disabled" });
  });

  it("is enabled with all five valid values, as PEM or base64 PEM", () => {
    for (const key of [PEM_BASE64, PEM]) {
      const result = parseVideoProviderConfig({ ...VALID, MUX_SIGNING_PRIVATE_KEY: key });
      assert.equal(result.status, "enabled");
      if (result.status !== "enabled") return;
      assert.equal(result.config.provider, "mux");
      assert.equal(result.config.tokenId.reveal(), VALID.MUX_TOKEN_ID);
      assert.equal(result.config.signingKeyId, VALID.MUX_SIGNING_KEY_ID);
      assert.equal(result.config.signingPrivateKey.asymmetricKeyType, "rsa");
      assert.equal(result.config.signingPrivateKey.type, "private");
    }
  });

  it("treats a partial setup as invalid and names what is missing", () => {
    const result = parseVideoProviderConfig({ MUX_TOKEN_ID: VALID.MUX_TOKEN_ID, MUX_TOKEN_SECRET: VALID.MUX_TOKEN_SECRET });
    assert.deepEqual(result, {
      status: "invalid",
      problems: ["MUX_WEBHOOK_SECRET is missing", "MUX_SIGNING_KEY_ID is missing", "MUX_SIGNING_PRIVATE_KEY is missing"],
    });
  });

  it("rejects malformed values by name", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
    const cases: Array<[Partial<typeof VALID>, string]> = [
      [{ MUX_TOKEN_ID: "has a space" }, "MUX_TOKEN_ID is malformed"],
      [{ MUX_TOKEN_SECRET: "x".repeat(513) }, "MUX_TOKEN_SECRET is malformed"],
      [{ MUX_WEBHOOK_SECRET: "too-short" }, "MUX_WEBHOOK_SECRET is malformed"],
      [{ MUX_SIGNING_KEY_ID: "bad-key-id!" }, "MUX_SIGNING_KEY_ID is malformed"],
      [{ MUX_SIGNING_PRIVATE_KEY: "not a key" }, "MUX_SIGNING_PRIVATE_KEY is not an RSA private key of at least 2048 bits"],
      [{ MUX_SIGNING_PRIVATE_KEY: Buffer.from("plain text").toString("base64") }, "MUX_SIGNING_PRIVATE_KEY is not an RSA private key of at least 2048 bits"],
      [{ MUX_SIGNING_PRIVATE_KEY: ec }, "MUX_SIGNING_PRIVATE_KEY is not an RSA private key of at least 2048 bits"],
      [{ MUX_SIGNING_PRIVATE_KEY: weak }, "MUX_SIGNING_PRIVATE_KEY is not an RSA private key of at least 2048 bits"],
      [{ MUX_SIGNING_PRIVATE_KEY: publicKey }, "MUX_SIGNING_PRIVATE_KEY is not an RSA private key of at least 2048 bits"],
    ];
    for (const [override, problem] of cases) {
      const result = parseVideoProviderConfig({ ...VALID, ...override });
      assert.deepEqual(result, { status: "invalid", problems: [problem] }, problem);
      if (result.status === "invalid") {
        for (const value of Object.values(override)) assert.ok(!result.problems.join(" ").includes(String(value)), "values are never echoed");
      }
    }
  });

  it("refuses an oversized key before parsing it", () => {
    assert.equal(parseSigningPrivateKey("A".repeat(20_000)), null);
  });

  it("lists exactly the five expected variables", () => {
    assert.deepEqual([...VIDEO_PROVIDER_ENV], Object.keys(VALID));
  });
});

describe("secret handling", () => {
  it("never prints configured secrets", () => {
    const result = parseVideoProviderConfig(VALID);
    assert.equal(result.status, "enabled");
    const renderings = [JSON.stringify(result), inspect(result, { depth: 10 }), String(result.status === "enabled" ? result.config.tokenSecret : ""), `${new Secret("abc")}`];
    for (const rendering of renderings) {
      for (const secret of SECRET_VALUES) assert.ok(!rendering.includes(secret), `leaked into: ${rendering.slice(0, 80)}`);
    }
    assert.match(JSON.stringify(result), /\[redacted\]/);
    assert.equal(new Secret("abc").reveal(), "abc");
  });
});
