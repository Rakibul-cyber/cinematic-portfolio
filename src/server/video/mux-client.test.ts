import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";

import { VideoProviderError, isRetryableProviderError } from "@/server/video/errors";
import { MUX_API_BASE_URL, createMuxClient, type FetchLike } from "@/server/video/mux-client";
import { Secret } from "@/server/video/secret";

/** Fictional credentials; nothing here reaches the network. */
const TOKEN_ID = "fictional-token-id-0001";
const TOKEN_SECRET = "fictional-token-secret-0001";
const config = { tokenId: new Secret(TOKEN_ID), tokenSecret: new Secret(TOKEN_SECRET) };
const VIDEO_ID = "123e4567-e89b-12d3-a456-426614174000";
const UPLOAD_ID = "UploadId0123456789abcdef";
const ASSET_ID = "AssetId0123456789abcdefgh";
const SIGNED_URL = "https://storage.example.invalid/upload?signature=fictional";

type Recorded = { url: string; init: RequestInit };

function fakeFetch(respond: (request: Recorded) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    const request = { url, init };
    calls.push(request);
    return respond(request);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const upload = (overrides: Record<string, unknown> = {}) => ({ data: { id: UPLOAD_ID, status: "waiting", url: SIGNED_URL, timeout: 3600, ...overrides } });
const uploadInput = { corsOrigin: "https://studio.example", passthrough: VIDEO_ID, timeoutSeconds: 3600 };

async function rejectsWith(promise: Promise<unknown>, code: string, status: number | null = null) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof VideoProviderError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

describe("Mux direct upload creation", () => {
  it("requests a signed, 2160p-capable upload restricted to the admin origin", async () => {
    const { fetch, calls } = fakeFetch(() => json(upload(), 201));
    const result = await createMuxClient({ config, fetch }).createDirectUpload(uploadInput);
    assert.deepEqual(result, { id: UPLOAD_ID, status: "waiting", url: SIGNED_URL, assetId: null, timeoutSeconds: 3600 });

    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, `${MUX_API_BASE_URL}/video/v1/uploads`);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error", "credentials are never forwarded on a redirect");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Basic ${Buffer.from(`${TOKEN_ID}:${TOKEN_SECRET}`).toString("base64")}`);
    assert.equal(headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(init.body)), {
      cors_origin: "https://studio.example",
      timeout: 3600,
      new_asset_settings: { playback_policy: ["signed"], passthrough: VIDEO_ID, max_resolution_tier: "2160p" },
    });
  });

  it("sends a video quality tier only when one is chosen", async () => {
    const { fetch, calls } = fakeFetch(() => json(upload()));
    await createMuxClient({ config, fetch }).createDirectUpload({ ...uploadInput, videoQuality: "plus", maxResolutionTier: "1440p" });
    const settings = JSON.parse(String(calls[0].init.body)).new_asset_settings;
    assert.equal(settings.video_quality, "plus");
    assert.equal(settings.max_resolution_tier, "1440p");
  });

  it("refuses unsafe input before any request is made", async () => {
    const { fetch, calls } = fakeFetch(() => json(upload()));
    const client = createMuxClient({ config, fetch });
    for (const input of [
      { ...uploadInput, timeoutSeconds: 59 },
      { ...uploadInput, timeoutSeconds: 604_801 },
      { ...uploadInput, timeoutSeconds: 1.5 },
      { ...uploadInput, passthrough: "not-a-uuid" },
      { ...uploadInput, corsOrigin: "http://studio.example" },
      { ...uploadInput, corsOrigin: "https://studio.example/admin" },
      { ...uploadInput, corsOrigin: "https://user:pass@studio.example" },
      { ...uploadInput, corsOrigin: "javascript:alert(1)" },
      { ...uploadInput, corsOrigin: "*" },
    ]) {
      await rejectsWith(client.createDirectUpload(input), "invalid_request");
    }
    assert.equal(calls.length, 0);
  });

  it("allows a local development origin over http", async () => {
    const { fetch, calls } = fakeFetch(() => json(upload()));
    await createMuxClient({ config, fetch }).createDirectUpload({ ...uploadInput, corsOrigin: "http://localhost:3000" });
    assert.equal(JSON.parse(String(calls[0].init.body)).cors_origin, "http://localhost:3000");
  });

  it("treats an upload without a URL as an invalid response", async () => {
    const { fetch } = fakeFetch(() => json(upload({ url: null })));
    await rejectsWith(createMuxClient({ config, fetch }).createDirectUpload(uploadInput), "invalid_response");
  });
});

describe("Mux upload and asset requests", () => {
  it("uses the documented paths and methods", async () => {
    const { fetch, calls } = fakeFetch(({ url }) =>
      url.includes("/assets/")
        ? calls.at(-1)?.init.method === "DELETE"
          ? new Response(null, { status: 204 })
          : json({ data: { id: ASSET_ID, status: "ready" } })
        : json(upload({ status: "cancelled", url: null })),
    );
    const client = createMuxClient({ config, fetch });
    await client.getDirectUpload(UPLOAD_ID);
    await client.cancelDirectUpload(UPLOAD_ID);
    await client.getAsset(ASSET_ID);
    await client.deleteAsset(ASSET_ID);
    assert.deepEqual(
      calls.map(({ url, init }) => `${init.method} ${url.replace(MUX_API_BASE_URL, "")}`),
      [
        `GET /video/v1/uploads/${UPLOAD_ID}`,
        `PUT /video/v1/uploads/${UPLOAD_ID}/cancel`,
        `GET /video/v1/assets/${ASSET_ID}`,
        `DELETE /video/v1/assets/${ASSET_ID}`,
      ],
    );
  });

  it("refuses identifiers that could alter the request path", async () => {
    const { fetch, calls } = fakeFetch(() => json(upload()));
    const client = createMuxClient({ config, fetch });
    for (const id of ["../uploads", "abc/def/ghi/jkl", "short", "id with spaces in it", `${UPLOAD_ID}?x=1`, ""]) {
      await rejectsWith(client.getDirectUpload(id), "invalid_request");
      await rejectsWith(client.getAsset(id), "invalid_request");
      await rejectsWith(client.deleteAsset(id), "invalid_request");
    }
    assert.equal(calls.length, 0);
  });

  it("parses only the asset fields the application uses", async () => {
    const { fetch } = fakeFetch(() =>
      json({
        data: {
          id: ASSET_ID,
          status: "ready",
          upload_id: UPLOAD_ID,
          passthrough: VIDEO_ID,
          duration: 312.48,
          resolution_tier: "2160p",
          playback_ids: [
            { id: "PublicPlayback0000000001", policy: "public" },
            { id: "SignedPlayback0000000001", policy: "signed" },
          ],
          tracks: [{ type: "audio" }, { type: "video", max_width: 3840, max_height: 2160 }],
          unexpected_field: { nested: true },
        },
      }),
    );
    assert.deepEqual(await createMuxClient({ config, fetch }).getAsset(ASSET_ID), {
      id: ASSET_ID,
      status: "ready",
      uploadId: UPLOAD_ID,
      passthrough: VIDEO_ID,
      durationSeconds: 312.48,
      maxResolution: "2160p",
      width: 3840,
      height: 2160,
      signedPlaybackIds: ["SignedPlayback0000000001"],
      errorType: null,
    });
  });

  it("reports unknown provider statuses as unknown instead of failing", async () => {
    const { fetch } = fakeFetch(({ url }) => (url.includes("/assets/") ? json({ data: { id: ASSET_ID, status: "migrating" } }) : json(upload({ status: "paused" }))));
    const client = createMuxClient({ config, fetch });
    assert.equal((await client.getAsset(ASSET_ID)).status, "unknown");
    assert.equal((await client.getDirectUpload(UPLOAD_ID)).status, "unknown");
  });

  it("keeps the provider's error category for later mapping", async () => {
    const { fetch } = fakeFetch(() => json({ data: { id: ASSET_ID, status: "errored", errors: { type: "invalid_input", messages: ["raw detail"] } } }));
    const asset = await createMuxClient({ config, fetch }).getAsset(ASSET_ID);
    assert.equal(asset.errorType, "invalid_input");
    assert.ok(!JSON.stringify(asset).includes("raw detail"), "provider messages are dropped");
  });
});

describe("Mux failure handling", () => {
  it("maps HTTP failures to codes", async () => {
    for (const [status, code] of [
      [400, "invalid_request"],
      [401, "unauthorized"],
      [403, "unauthorized"],
      [404, "not_found"],
      [422, "invalid_request"],
      [429, "rate_limited"],
      [500, "provider_unavailable"],
      [503, "provider_unavailable"],
    ] as const) {
      const { fetch } = fakeFetch(() => json({ error: { messages: ["detail"] } }, status));
      await rejectsWith(createMuxClient({ config, fetch }).getAsset(ASSET_ID), code, status);
    }
  });

  it("maps network failures, timeouts, and malformed responses", async () => {
    const network = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    await rejectsWith(createMuxClient({ config, fetch: network.fetch }).getAsset(ASSET_ID), "network_error");
    const timeout = fakeFetch(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    await rejectsWith(createMuxClient({ config, fetch: timeout.fetch }).getAsset(ASSET_ID), "timeout");
    const notJson = fakeFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await rejectsWith(createMuxClient({ config, fetch: notJson.fetch }).getAsset(ASSET_ID), "invalid_response", 200);
    const wrongShape = fakeFetch(() => json({ data: { id: "../evil", status: "ready" } }));
    await rejectsWith(createMuxClient({ config, fetch: wrongShape.fetch }).getAsset(ASSET_ID), "invalid_response", 200);
  });

  it("aborts a request that exceeds its time budget", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    await rejectsWith(createMuxClient({ config, fetch: hanging, timeoutMs: 20 }).getAsset(ASSET_ID), "timeout");
  });

  it("classifies which failures are worth retrying", () => {
    for (const code of ["provider_unavailable", "rate_limited", "network_error", "timeout"] as const) {
      assert.equal(isRetryableProviderError(new VideoProviderError(code)), true, code);
    }
    for (const code of ["invalid_request", "unauthorized", "not_found", "invalid_response", "not_configured"] as const) {
      assert.equal(isRetryableProviderError(new VideoProviderError(code)), false, code);
    }
    assert.equal(isRetryableProviderError(new Error("x")), false);
  });
});

describe("Mux secret exposure", () => {
  it("never puts credentials, signed URLs, or response bodies into errors", async () => {
    const leaky = `token=${TOKEN_SECRET} url=${SIGNED_URL}`;
    const { fetch } = fakeFetch(() => json({ error: { messages: [leaky] } }, 500));
    const error = await createMuxClient({ config, fetch })
      .getAsset(ASSET_ID)
      .catch((caught: unknown) => caught);
    const renderings = [String(error), (error as Error).stack ?? "", JSON.stringify(error), inspect(error)];
    for (const rendering of renderings) {
      for (const secret of [TOKEN_ID, TOKEN_SECRET, SIGNED_URL, "messages"]) assert.ok(!rendering.includes(secret), `${secret} leaked`);
    }
  });

  it("never puts credentials in request URLs", async () => {
    const { fetch, calls } = fakeFetch(() => json(upload()));
    await createMuxClient({ config, fetch }).createDirectUpload(uploadInput);
    for (const { url, init } of calls) {
      assert.ok(!url.includes(TOKEN_SECRET) && !url.includes(TOKEN_ID));
      assert.ok(!String(init.body).includes(TOKEN_SECRET));
    }
  });
});
