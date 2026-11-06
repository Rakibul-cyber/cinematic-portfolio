import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";

import type { AuditLogInput } from "@/server/audit/audit-log";
import { VideoProviderError } from "@/server/video/errors";
import type { VideoRouteDependencies, VideoRouteUser } from "@/server/video/http";
import { InMemoryVideoRepository } from "@/server/video/in-memory-repository";
import type { CreateDirectUploadInput, MuxAsset, MuxClient, MuxDirectUpload } from "@/server/video/mux-client";
import type { VideoRateLimitDecision, VideoRateLimitName } from "@/server/video/rate-limit";
import type { VideoRuntime } from "@/server/video/runtime";
import { DEFAULT_MAX_UPLOAD_BYTES, type VideoLogFields } from "@/server/video/service";
import { computeMuxSignature } from "@/server/video/webhook-signature";

/**
 * The video route handlers (P3-11C) with the real service, the in-memory
 * repository, and a stateful fake Mux client. No database, no network; all
 * credentials are fictional or generated per run.
 *
 * `http.ts` and `runtime.ts` reach the audit module, which builds the Prisma
 * client on import; an inert fake goes in the slot `src/server/db/prisma.ts`
 * reuses first, so no client or connection is ever created.
 */

type Http = typeof import("@/server/video/http");
let handleCancelUpload: Http["handleCancelUpload"];
let handleCreateUpload: Http["handleCreateUpload"];
let handleMuxWebhookRequest: Http["handleMuxWebhookRequest"];
let handlePlayback: Http["handlePlayback"];
let MAX_UPLOAD_REQUEST_BYTES: number;
let buildVideoRuntime: typeof import("@/server/video/runtime").buildVideoRuntime;

before(async () => {
  (globalThis as unknown as { cinematicPortfolioPrisma: unknown }).cinematicPortfolioPrisma = {};
  ({ handleCancelUpload, handleCreateUpload, handleMuxWebhookRequest, handlePlayback, MAX_UPLOAD_REQUEST_BYTES } = await import("@/server/video/http"));
  ({ buildVideoRuntime } = await import("@/server/video/runtime"));
});

const ORIGIN = "https://studio.example.test";
const TOKEN_ID = "fictional-token-id-0001";
const TOKEN_SECRET = "fictional-token-secret-0001";
const WEBHOOK_SECRET = "fictional-webhook-secret-0001";
const URL_SIGNATURE = "fictional-upload-signature-0001";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM_BASE64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
const ENV = {
  MUX_TOKEN_ID: TOKEN_ID,
  MUX_TOKEN_SECRET: TOKEN_SECRET,
  MUX_WEBHOOK_SECRET: WEBHOOK_SECRET,
  MUX_SIGNING_KEY_ID: "FictionalSigningKey0001",
  MUX_SIGNING_PRIVATE_KEY: PEM_BASE64,
  BETTER_AUTH_URL: ORIGIN,
};
const SECRETS = [TOKEN_ID, TOKEN_SECRET, WEBHOOK_SECRET, PEM_BASE64.slice(0, 40), URL_SIGNATURE];

const SUPER: VideoRouteUser = { id: "user-super", email: "super@example.test", role: "SUPER_ADMIN" };
const ADMIN: VideoRouteUser = { id: "user-admin", email: "admin@example.test", role: "ADMIN" };
const EDITOR: VideoRouteUser = { id: "user-editor", email: "editor@example.test", role: "EDITOR" };

const PUBLISHED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DRAFT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HIDDEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ------------------------------------------------------------------ fake provider

class FakeMux implements MuxClient {
  readonly uploads = new Map<string, MuxDirectUpload>();
  readonly assets = new Map<string, MuxAsset>();
  calls = 0;
  #n = 0;

  async createDirectUpload(input: CreateDirectUploadInput): Promise<MuxDirectUpload> {
    this.calls += 1;
    this.#n += 1;
    const id = `UploadId${String(this.#n).padStart(8, "0")}`;
    const upload: MuxDirectUpload = { id, status: "waiting", url: `https://storage.example.invalid/${id}?sig=${URL_SIGNATURE}`, assetId: null, timeoutSeconds: input.timeoutSeconds };
    this.uploads.set(id, upload);
    return { ...upload };
  }
  async getDirectUpload(id: string): Promise<MuxDirectUpload> {
    this.calls += 1;
    const upload = this.uploads.get(id);
    if (!upload) throw new VideoProviderError("not_found", 404);
    return { ...upload };
  }
  async cancelDirectUpload(id: string): Promise<MuxDirectUpload> {
    this.calls += 1;
    const upload = this.uploads.get(id);
    if (!upload) throw new VideoProviderError("not_found", 404);
    if (upload.status !== "waiting") throw new VideoProviderError("invalid_request", 400);
    upload.status = "cancelled";
    return { ...upload };
  }
  async getAsset(id: string): Promise<MuxAsset> {
    this.calls += 1;
    const asset = this.assets.get(id);
    if (!asset) throw new VideoProviderError("not_found", 404);
    return { ...asset, signedPlaybackIds: [...asset.signedPlaybackIds] };
  }
  async deleteAsset(id: string): Promise<void> {
    this.calls += 1;
    if (!this.assets.delete(id)) throw new VideoProviderError("not_found", 404);
  }
  finish(uploadId: string, videoId: string, status: MuxAsset["status"]): MuxAsset {
    const upload = this.uploads.get(uploadId)!;
    const asset: MuxAsset = {
      id: `AssetId${uploadId.slice(-8)}`,
      status,
      uploadId,
      passthrough: videoId,
      durationSeconds: 30,
      maxResolution: "2160p",
      width: 3840,
      height: 2160,
      signedPlaybackIds: [`SignedPlayback${uploadId.slice(-8)}`],
      errorType: null,
    };
    upload.status = "asset_created";
    upload.assetId = asset.id;
    this.assets.set(asset.id, asset);
    return asset;
  }
}

// ------------------------------------------------------------------ fixtures

let repository: InMemoryVideoRepository;
let mux: FakeMux;
let runtime: VideoRuntime | null;
let user: VideoRouteUser | null;
let limit: VideoRateLimitDecision;
let audits: AuditLogInput[];
let logs: Array<{ event: string; fields?: VideoLogFields }>;
let rateCalls: Array<{ name: VideoRateLimitName; key: string }>;
let responses: Response[];
let deps: VideoRouteDependencies;

beforeEach(() => {
  repository = new InMemoryVideoRepository();
  mux = new FakeMux();
  audits = [];
  logs = [];
  rateCalls = [];
  responses = [];
  user = SUPER;
  limit = "allowed";
  runtime = buildVideoRuntime(ENV, {
    repository,
    audit: async (entry) => {
      audits.push(entry);
    },
    logger: { warn: (event, fields) => logs.push({ event, fields }) },
    createMux: () => mux,
  });
  assert.ok(runtime, "fixture runtime is enabled");
  deps = {
    getUser: async () => user,
    runtime: () => runtime,
    rateLimit: async (name, key) => {
      rateCalls.push({ name, key });
      return limit;
    },
    audit: async (entry) => {
      audits.push(entry);
    },
  };
});

/** Every response passes through here so the no-store rule is checked on all of them. */
async function send(response: Promise<Response>): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  const resolved = await response;
  responses.push(resolved.clone());
  assert.equal(resolved.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(resolved.headers.get("pragma"), "no-cache");
  return { status: resolved.status, body: (await resolved.json()) as Record<string, unknown>, response: resolved };
}

const uploadRequest = (body: unknown = { title: "Showreel", filename: "reel.mp4", fileSizeBytes: 2_000_000_000 }, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/videos/uploads`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const cancelRequest = (id: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/videos/uploads/${id}/cancel`, { method: "POST", headers: { origin: ORIGIN, ...headers } });

const playbackRequest = (id: string, projectId?: string) =>
  new Request(`${ORIGIN}/api/videos/${id}/playback${projectId === undefined ? "" : `?projectId=${encodeURIComponent(projectId)}`}`);

function webhookRequest(event: unknown, options: { rawBody?: string; secret?: string; timestamp?: number } = {}) {
  const body = options.rawBody ?? JSON.stringify(event);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return new Request(`${ORIGIN}/api/webhooks/mux`, {
    method: "POST",
    headers: { "content-type": "application/json", "mux-signature": `t=${timestamp},v1=${computeMuxSignature(options.secret ?? WEBHOOK_SECRET, timestamp, body)}` },
    body,
  });
}

async function startUpload(as: VideoRouteUser = SUPER) {
  user = as;
  const result = await send(handleCreateUpload(uploadRequest(), deps));
  assert.equal(result.status, 201);
  const videoId = result.body.videoId as string;
  const record = await repository.findById(videoId);
  assert.ok(record);
  return { videoId, record, body: result.body };
}

const assetEvent = (type: string, asset: MuxAsset) => ({ type, data: { id: asset.id, upload_id: asset.uploadId } });
const statusOf = async (id: string) => (await repository.findById(id))?.status;

async function readyVideo(assignments: Array<{ projectId: string; projectStatus: "DRAFT" | "PUBLISHED"; categoryActive: boolean }>) {
  const { videoId, record } = await startUpload();
  const asset = mux.finish(record.muxUploadId, videoId, "ready");
  assert.equal((await send(handleMuxWebhookRequest(webhookRequest(assetEvent("video.asset.ready", asset)), deps))).status, 200);
  assert.equal(await statusOf(videoId), "READY");
  repository.setAssignments(videoId, assignments);
  return videoId;
}

async function everythingObservable() {
  const bodies = await Promise.all(responses.map((response) => response.text()));
  return JSON.stringify({ bodies, audits, logs, stored: repository.all() });
}

// ------------------------------------------------------------------ uploads

describe("POST /api/videos/uploads", () => {
  it("lets ADMIN and SUPER_ADMIN start an upload and audits it without the URL", async () => {
    for (const as of [SUPER, ADMIN]) {
      const { videoId, body } = await startUpload(as);
      assert.match(String(body.uploadUrl), /^https:\/\//);
      assert.ok(!Number.isNaN(Date.parse(String(body.expiresAt))));
      const entry = audits.find((audit) => audit.entityId === videoId);
      assert.deepEqual(entry, {
        action: "video.upload_started",
        entityType: "video",
        entityId: videoId,
        actorUserId: as.id,
        actorEmail: as.email,
        metadata: { declaredSizeBytes: 2_000_000_000, extension: "mp4" },
      });
    }
    assert.deepEqual(rateCalls.map((call) => call.name), ["upload", "upload"]);
    assert.deepEqual(rateCalls.map((call) => call.key), [`user:${SUPER.id}`, `user:${ADMIN.id}`]);
    assert.equal(JSON.stringify(audits).includes(URL_SIGNATURE), false);
  });

  it("requires a session and an administrative role", async () => {
    user = null;
    assert.equal((await send(handleCreateUpload(uploadRequest(), deps))).status, 401);
    user = EDITOR;
    const forbidden = await send(handleCreateUpload(uploadRequest(), deps));
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "forbidden");
    assert.equal(mux.calls, 0);
    assert.equal(repository.all().length, 0);
    assert.deepEqual(rateCalls, [], "refused before counting against the limit");
  });

  it("refuses cross-origin and origin-less requests before reading the session", async () => {
    let sessionReads = 0;
    deps.getUser = async () => {
      sessionReads += 1;
      return SUPER;
    };
    const hostile: Array<Record<string, string>> = [{ origin: "https://attacker.example" }, { origin: "" }, { origin: `${ORIGIN}.attacker.example` }, { "sec-fetch-site": "cross-site" }];
    for (const headers of hostile) {
      const result = await send(handleCreateUpload(uploadRequest(undefined, headers), deps));
      assert.equal(result.status, 403, JSON.stringify(headers));
      assert.equal(result.body.error, "origin_not_allowed");
    }
    assert.equal(sessionReads, 0);
    assert.equal(mux.calls, 0);
  });

  it("validates the body: type, size, JSON shape, title, file name, and the 10 GiB declared size", async () => {
    const cases: Array<[Request, number, string]> = [
      [uploadRequest(undefined, { "content-type": "text/plain" }), 415, "unsupported_media_type"],
      [uploadRequest("{not json"), 400, "invalid_request"],
      [uploadRequest("[1,2]"), 400, "invalid_request"],
      [uploadRequest({ title: "x".repeat(MAX_UPLOAD_REQUEST_BYTES), filename: "a.mp4", fileSizeBytes: 1 }), 413, "request_too_large"],
      [uploadRequest({ title: "", filename: "a.mp4", fileSizeBytes: 1 }), 400, "title_required"],
      [uploadRequest({ title: "Reel", filename: "../a.mp4", fileSizeBytes: 1 }), 400, "unsupported_file"],
      [uploadRequest({ title: "Reel", filename: "a.exe", fileSizeBytes: 1 }), 400, "unsupported_file"],
      [uploadRequest({ title: "Reel", filename: "a.mp4", fileSizeBytes: "12" }), 400, "unsupported_file"],
      [uploadRequest({ title: "Reel", filename: "a.mp4", fileSizeBytes: -5 }), 400, "unsupported_file"],
      [uploadRequest({ title: "Reel", filename: "a.mp4", fileSizeBytes: DEFAULT_MAX_UPLOAD_BYTES + 1 }), 413, "file_too_large"],
    ];
    for (const [request, status, code] of cases) {
      const result = await send(handleCreateUpload(request, deps));
      assert.equal(result.status, status, code);
      assert.equal(result.body.error, code);
      assert.equal(typeof result.body.message, "string");
    }
    assert.equal(mux.calls, 0);
    const exact = await send(handleCreateUpload(uploadRequest({ title: "Master", filename: "master.mov", fileSizeBytes: DEFAULT_MAX_UPLOAD_BYTES }), deps));
    assert.equal(exact.status, 201);
  });

  it("answers 429 when limited and 503 when the limiter is unavailable, without calling the provider", async () => {
    limit = "limited";
    const limited = await send(handleCreateUpload(uploadRequest(), deps));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "rate_limited");
    limit = "unavailable";
    assert.equal((await send(handleCreateUpload(uploadRequest(), deps))).status, 503);
    assert.equal(mux.calls, 0);
  });

  it("enforces two active uploads per administrator", async () => {
    await startUpload();
    await startUpload();
    const third = await send(handleCreateUpload(uploadRequest(), deps));
    assert.equal(third.status, 409);
    assert.equal(third.body.error, "too_many_uploads");
  });

  it("fails closed with 503 when the provider is not configured", async () => {
    runtime = null;
    const result = await send(handleCreateUpload(uploadRequest(), deps));
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "not_configured");
    user = null;
    assert.equal((await send(handleCreateUpload(uploadRequest(), deps))).status, 401, "anonymous callers learn nothing about configuration");
  });
});

// ------------------------------------------------------------------ cancellation

describe("POST /api/videos/uploads/[id]/cancel", () => {
  it("cancels once, audits once, and is idempotent", async () => {
    const { videoId } = await startUpload();
    const first = await send(handleCancelUpload(cancelRequest(videoId), videoId, deps));
    assert.deepEqual([first.status, first.body], [200, { status: "CANCELLED" }]);
    const second = await send(handleCancelUpload(cancelRequest(videoId), videoId, deps));
    assert.deepEqual([second.status, second.body], [200, { status: "CANCELLED" }]);
    assert.equal(audits.filter((entry) => entry.action === "video.upload_cancelled").length, 1);
    assert.equal(await statusOf(videoId), "CANCELLED");
  });

  it("enforces origin, session, role, and the cancel limit", async () => {
    const { videoId } = await startUpload();
    assert.equal((await send(handleCancelUpload(cancelRequest(videoId, { origin: "https://attacker.example" }), videoId, deps))).status, 403);
    user = null;
    assert.equal((await send(handleCancelUpload(cancelRequest(videoId), videoId, deps))).status, 401);
    user = EDITOR;
    assert.equal((await send(handleCancelUpload(cancelRequest(videoId), videoId, deps))).status, 403);
    user = ADMIN;
    limit = "limited";
    assert.equal((await send(handleCancelUpload(cancelRequest(videoId), videoId, deps))).status, 429);
    assert.equal(await statusOf(videoId), "UPLOAD_PENDING");
    limit = "allowed";
    assert.equal((await send(handleCancelUpload(cancelRequest(videoId), videoId, deps))).status, 200, "another administrator may cancel");
  });

  it("answers 404 for unknown or malformed ids and 409 once processing started", async () => {
    assert.equal((await send(handleCancelUpload(cancelRequest("nope"), "nope", deps))).status, 404);
    const unknown = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    assert.equal((await send(handleCancelUpload(cancelRequest(unknown), unknown, deps))).status, 404);
    const { videoId, record } = await startUpload();
    const asset = mux.finish(record.muxUploadId, videoId, "preparing");
    await send(handleMuxWebhookRequest(webhookRequest(assetEvent("video.asset.created", asset)), deps));
    assert.equal(await statusOf(videoId), "PROCESSING");
    const late = await send(handleCancelUpload(cancelRequest(videoId), videoId, deps));
    assert.deepEqual([late.status, late.body.error], [409, "not_cancellable"]);
  });

  it("fails closed with 503 when the provider is not configured", async () => {
    runtime = null;
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    assert.equal((await send(handleCancelUpload(cancelRequest(id), id, deps))).status, 503);
  });
});

// ------------------------------------------------------------------ webhook

describe("POST /api/webhooks/mux", () => {
  it("rejects forged, tampered, and replayed deliveries with 401 and no state change", async () => {
    const { videoId, record } = await startUpload();
    const asset = mux.finish(record.muxUploadId, videoId, "ready");
    const event = assetEvent("video.asset.ready", asset);
    const body = JSON.stringify(event);
    const unsigned = new Request(`${ORIGIN}/api/webhooks/mux`, { method: "POST", body });
    const tampered = webhookRequest(event);
    const tamperedBody = new Request(tampered.url, { method: "POST", headers: tampered.headers, body: body.replace("ready", "readY") });
    for (const request of [
      unsigned,
      webhookRequest(event, { secret: "attacker-secret-0000000" }),
      tamperedBody,
      webhookRequest(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
    ]) {
      const result = await send(handleMuxWebhookRequest(request, deps));
      assert.deepEqual([result.status, result.body], [401, { ok: false }]);
    }
    assert.equal(await statusOf(videoId), "UPLOAD_PENDING");
    assert.equal(audits.filter((entry) => entry.action !== "video.upload_started").length, 0);
  });

  it("verifies the exact raw bytes, not a re-serialization", async () => {
    const { videoId, record } = await startUpload();
    const asset = mux.finish(record.muxUploadId, videoId, "ready");
    // Unusual spacing and an escaped character: JSON.stringify(JSON.parse(x)) !== x.
    const rawBody = `{ "type" : "video.asset.ready",\n  "data": {"id":"${asset.id}", "upload_id":"${asset.uploadId}", "note":"caf\\u00e9"} }`;
    assert.notEqual(JSON.stringify(JSON.parse(rawBody)), rawBody);
    const result = await send(handleMuxWebhookRequest(webhookRequest(null, { rawBody }), deps));
    assert.equal(result.status, 200);
    assert.equal(await statusOf(videoId), "READY");
  });

  it("handles duplicate, late, and out-of-order events, auditing each outcome once", async () => {
    const { videoId, record } = await startUpload();
    const asset = mux.finish(record.muxUploadId, videoId, "ready");
    // asset.ready before upload.asset_created, then duplicates and a late event.
    for (const event of [
      assetEvent("video.asset.ready", asset),
      assetEvent("video.asset.ready", asset),
      { type: "video.upload.asset_created", data: { id: record.muxUploadId } },
      assetEvent("video.asset.created", asset),
    ]) {
      assert.equal((await send(handleMuxWebhookRequest(webhookRequest(event), deps))).status, 200);
    }
    assert.equal(await statusOf(videoId), "READY");
    const ready = audits.filter((entry) => entry.action === "video.ready");
    assert.equal(ready.length, 1);
    assert.deepEqual(ready[0], { action: "video.ready", entityType: "video", entityId: videoId, actorUserId: null, actorEmail: null, metadata: { from: "PROCESSING", source: "provider" } });
  });

  it("never makes a cancelled upload READY, even when its file finished", async () => {
    const { videoId, record } = await startUpload();
    await send(handleCancelUpload(cancelRequest(videoId), videoId, deps));
    const asset = mux.finish(record.muxUploadId, videoId, "ready");
    assert.equal((await send(handleMuxWebhookRequest(webhookRequest(assetEvent("video.asset.ready", asset)), deps))).status, 200);
    assert.equal(await statusOf(videoId), "CANCELLED");
    assert.equal(audits.some((entry) => entry.action === "video.ready"), false);
  });

  it("audits failed processing with a known code", async () => {
    const { videoId, record } = await startUpload();
    const asset = mux.finish(record.muxUploadId, videoId, "errored");
    mux.assets.get(asset.id)!.errorType = "invalid_input";
    await send(handleMuxWebhookRequest(webhookRequest(assetEvent("video.asset.errored", asset)), deps));
    const failed = audits.find((entry) => entry.action === "video.processing_failed");
    assert.deepEqual(failed?.metadata, { from: "UPLOAD_PENDING", failureCode: "input_unsupported", source: "provider" });
  });

  it("refuses oversized bodies and fails closed with 503 when not configured", async () => {
    const big = new Request(`${ORIGIN}/api/webhooks/mux`, { method: "POST", headers: { "content-length": String(2 * 1024 * 1024) }, body: "x" });
    assert.equal((await send(handleMuxWebhookRequest(big, deps))).status, 413);
    runtime = null;
    assert.equal((await send(handleMuxWebhookRequest(webhookRequest({ type: "video.asset.ready", data: { id: "AssetId00000001" } }), deps))).status, 503);
  });
});

// ------------------------------------------------------------------ playback

describe("GET /api/videos/[id]/playback", () => {
  it("serves public playback only through a published project in an active category", async () => {
    const videoId = await readyVideo([
      { projectId: PUBLISHED, projectStatus: "PUBLISHED", categoryActive: true },
      { projectId: DRAFT, projectStatus: "DRAFT", categoryActive: true },
      { projectId: HIDDEN, projectStatus: "PUBLISHED", categoryActive: false },
    ]);
    user = null;
    const ok = await send(handlePlayback(playbackRequest(videoId, PUBLISHED), videoId, deps));
    assert.equal(ok.status, 200);
    const url = new URL(String(ok.body.url));
    assert.equal(url.origin, "https://stream.mux.com");
    assert.ok(url.searchParams.get("token"));
    assert.deepEqual(Object.keys(ok.body).sort(), ["expiresAt", "url"]);
    for (const projectId of [DRAFT, HIDDEN, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "not-a-uuid"]) {
      const refused = await send(handlePlayback(playbackRequest(videoId, projectId), videoId, deps));
      assert.deepEqual([refused.status, refused.body.error], [404, "not_found"], projectId);
    }
    assert.ok(rateCalls.some((call) => call.name === "playbackPublic" && call.key === "client:unknown"));
  });

  it("keeps draft videos hidden from the public, even for a signed-in administrator", async () => {
    const videoId = await readyVideo([{ projectId: DRAFT, projectStatus: "DRAFT", categoryActive: true }]);
    for (const viewer of [null, SUPER]) {
      user = viewer;
      const refused = await send(handlePlayback(playbackRequest(videoId, DRAFT), videoId, deps));
      assert.equal(refused.status, 404);
      assert.equal(JSON.stringify(refused.body).includes("Showreel"), false);
    }
    const processing = (await startUpload()).videoId;
    repository.setAssignments(processing, [{ projectId: PUBLISHED, projectStatus: "PUBLISHED", categoryActive: true }]);
    user = null;
    const notReady = await send(handlePlayback(playbackRequest(processing, PUBLISHED), processing, deps));
    assert.deepEqual(notReady.body, { error: "not_found", message: "Video not found." }, "same answer as an unknown video");
  });

  it("gives any authenticated administrator a preview, including of draft videos", async () => {
    const videoId = await readyVideo([{ projectId: DRAFT, projectStatus: "DRAFT", categoryActive: true }]);
    user = EDITOR;
    const preview = await send(handlePlayback(playbackRequest(videoId), videoId, deps));
    assert.equal(preview.status, 200);
    assert.ok(Date.parse(String(preview.body.expiresAt)) - Date.now() <= 15 * 60_000 + 1000, "short-lived");
    user = null;
    assert.equal((await send(handlePlayback(playbackRequest(videoId), videoId, deps))).status, 401);
    user = SUPER;
    const pending = (await startUpload()).videoId;
    assert.equal((await send(handlePlayback(playbackRequest(pending), pending, deps))).status, 409);
  });

  it("rate-limits and fails closed when the provider is not configured", async () => {
    const videoId = await readyVideo([{ projectId: PUBLISHED, projectStatus: "PUBLISHED", categoryActive: true }]);
    limit = "limited";
    assert.equal((await send(handlePlayback(playbackRequest(videoId, PUBLISHED), videoId, deps))).status, 429);
    assert.equal((await send(handlePlayback(playbackRequest(videoId), videoId, deps))).status, 429);
    limit = "allowed";
    runtime = null;
    assert.equal((await send(handlePlayback(playbackRequest(videoId, PUBLISHED), videoId, deps))).status, 503);
    assert.equal((await send(handlePlayback(playbackRequest(videoId), videoId, deps))).status, 503);
  });
});

// ------------------------------------------------------------------ secrets

describe("secret protection across the video routes", () => {
  it("never reveals credentials in responses, audit entries, logs, or stored rows", async () => {
    const { videoId, record } = await startUpload();
    const asset = mux.finish(record.muxUploadId, videoId, "ready");
    await send(handleMuxWebhookRequest(webhookRequest(assetEvent("video.asset.ready", asset)), deps));
    await send(handleMuxWebhookRequest(webhookRequest(assetEvent("video.asset.ready", asset), { secret: "wrong-secret-000000000" }), deps));
    repository.setAssignments(videoId, [{ projectId: PUBLISHED, projectStatus: "PUBLISHED", categoryActive: true }]);
    await send(handlePlayback(playbackRequest(videoId, PUBLISHED), videoId, deps));
    user = EDITOR;
    await send(handleCreateUpload(uploadRequest(), deps));

    // The one intended exception: the uploader receives the upload URL once.
    const [uploadResponse, ...rest] = responses;
    assert.ok((await uploadResponse.clone().text()).includes(URL_SIGNATURE));
    responses = rest;
    const text = await everythingObservable();
    for (const secret of SECRETS) assert.equal(text.includes(secret), false, `must not reveal ${secret.slice(0, 12)}…`);
  });
});
