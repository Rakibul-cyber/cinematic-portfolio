import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, describe, it } from "node:test";

import { InMemoryVideoRepository } from "@/server/video/in-memory-repository";
import type { MuxClient } from "@/server/video/mux-client";
import type { VideoLogFields } from "@/server/video/service";

/**
 * Fail-closed configuration of the video runtime (P3-11C). The audit module
 * builds the Prisma client on import, so an inert fake fills its slot first.
 */

type Runtime = typeof import("@/server/video/runtime");
let buildVideoRuntime: Runtime["buildVideoRuntime"];
let normalizeAppOrigin: Runtime["normalizeAppOrigin"];
let transitionAuditEntry: Runtime["transitionAuditEntry"];

before(async () => {
  (globalThis as unknown as { cinematicPortfolioPrisma: unknown }).cinematicPortfolioPrisma = {};
  ({ buildVideoRuntime, normalizeAppOrigin, transitionAuditEntry } = await import("@/server/video/runtime"));
});

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM_BASE64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
const VALID = {
  MUX_TOKEN_ID: "fictional-token-id-0001",
  MUX_TOKEN_SECRET: "fictional-token-secret-0001",
  MUX_WEBHOOK_SECRET: "fictional-webhook-secret-0001",
  MUX_SIGNING_KEY_ID: "FictionalSigningKey0001",
  MUX_SIGNING_PRIVATE_KEY: PEM_BASE64,
  BETTER_AUTH_URL: "https://studio.example.test/",
};

function build(env: Record<string, string | undefined>) {
  const logs: Array<{ event: string; fields?: VideoLogFields }> = [];
  let muxCreated = 0;
  const runtime = buildVideoRuntime(env, {
    repository: new InMemoryVideoRepository(),
    audit: async () => undefined,
    logger: { warn: (event, fields) => logs.push({ event, fields }) },
    createMux: () => {
      muxCreated += 1;
      return {} as MuxClient;
    },
  });
  return { runtime, logs, muxCreated };
}

describe("video runtime configuration", () => {
  it("is enabled only with every provider variable and a valid application origin", () => {
    const { runtime, logs, muxCreated } = build(VALID);
    assert.ok(runtime);
    assert.equal(runtime.adminOrigin, "https://studio.example.test");
    assert.equal(muxCreated, 1);
    assert.deepEqual(logs, []);
  });

  it("stays disabled silently when nothing is configured", () => {
    const { runtime, logs, muxCreated } = build({ BETTER_AUTH_URL: VALID.BETTER_AUTH_URL });
    assert.equal(runtime, null);
    assert.deepEqual(logs, []);
    assert.equal(muxCreated, 0);
  });

  it("fails closed on a partial or malformed setup and logs variable names only", () => {
    for (const env of [
      { ...VALID, MUX_SIGNING_PRIVATE_KEY: undefined },
      { ...VALID, MUX_WEBHOOK_SECRET: "short" },
      { ...VALID, MUX_SIGNING_PRIVATE_KEY: "not-a-key" },
    ]) {
      const { runtime, logs, muxCreated } = build(env);
      assert.equal(runtime, null);
      assert.equal(muxCreated, 0);
      assert.equal(logs.length, 1);
      const text = JSON.stringify(logs);
      assert.match(text, /MUX_/);
      for (const value of [VALID.MUX_TOKEN_SECRET, VALID.MUX_WEBHOOK_SECRET, "short", "not-a-key", PEM_BASE64.slice(0, 30)]) {
        assert.equal(text.includes(value), false);
      }
    }
  });

  it("fails closed without a usable application origin", () => {
    for (const origin of [undefined, "", "not a url", "ftp://studio.example.test", "https://user:pass@studio.example.test"]) {
      const { runtime, logs } = build({ ...VALID, BETTER_AUTH_URL: origin });
      assert.equal(runtime, null, String(origin));
      assert.equal(JSON.stringify(logs).includes("pass@"), false);
    }
    assert.equal(normalizeAppOrigin("http://localhost:3000/path?q=1"), "http://localhost:3000");
  });

  it("maps provider outcomes to audit entries without provider text", () => {
    const base = { videoId: "v", uploaderId: "u", failureCode: null };
    assert.deepEqual(transitionAuditEntry({ ...base, from: "PROCESSING", to: "READY" }), {
      action: "video.ready",
      entityType: "video",
      entityId: "v",
      actorUserId: null,
      actorEmail: null,
      metadata: { from: "PROCESSING", source: "provider" },
    });
    assert.equal(transitionAuditEntry({ ...base, from: "PROCESSING", to: "FAILED", failureCode: "processing_failed" }).action, "video.processing_failed");
    assert.equal(transitionAuditEntry({ ...base, from: "UPLOAD_PENDING", to: "CANCELLED" }).action, "video.upload_cancelled");
  });
});
