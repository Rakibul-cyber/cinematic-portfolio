import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { VideoProviderError } from "@/server/video/errors";
import { InMemoryVideoRepository } from "@/server/video/in-memory-repository";
import type { CreateDirectUploadInput, MuxAsset, MuxClient, MuxDirectUpload } from "@/server/video/mux-client";
import type { VideoRecord } from "@/server/video/repository";
import { Secret } from "@/server/video/secret";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  createVideoService,
  validateVideoFilename,
  type VideoActor,
  type VideoLogFields,
  type VideoService,
  type VideoServiceLimits,
} from "@/server/video/service";
import { computeMuxSignature } from "@/server/video/webhook-signature";

/**
 * P3-11B orchestration against a stateful fake Mux client and the in-memory
 * repository. Nothing here reaches the network or a database; every
 * credential and key is fictional or generated per run.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WEBHOOK_SECRET = "fictional-webhook-secret-0001";
const SIGNING_KEY_ID = "FictionalSigningKey0001";
const TOKEN_SECRET = "fictional-token-secret-0001";
const URL_SIGNATURE = "fictional-upload-signature-0001";
const NOW_MS = 1_800_000_000_000;
const CORS_ORIGIN = "https://studio.example.test";

const EDITOR_A: VideoActor = { id: "user-editor-a", role: "EDITOR" };
const EDITOR_B: VideoActor = { id: "user-editor-b", role: "EDITOR" };
const ADMIN: VideoActor = { id: "user-admin", role: "ADMIN" };

// ------------------------------------------------------------------ fake provider

type MuxMethod = keyof MuxClient;

class FakeMux implements MuxClient {
  readonly uploads = new Map<string, MuxDirectUpload>();
  readonly assets = new Map<string, MuxAsset>();
  readonly calls: MuxMethod[] = [];
  readonly createInputs: CreateDirectUploadInput[] = [];
  readonly failures: Partial<Record<MuxMethod, Error>> = {};
  #counter = 0;

  #enter(method: MuxMethod) {
    this.calls.push(method);
    const failure = this.failures[method];
    if (failure) throw failure;
  }

  async createDirectUpload(input: CreateDirectUploadInput): Promise<MuxDirectUpload> {
    this.#enter("createDirectUpload");
    this.createInputs.push(input);
    this.#counter += 1;
    const id = `UploadId${String(this.#counter).padStart(8, "0")}`;
    const upload: MuxDirectUpload = {
      id,
      status: "waiting",
      url: `https://storage.example.invalid/upload/${id}?signature=${URL_SIGNATURE}`,
      assetId: null,
      timeoutSeconds: input.timeoutSeconds,
    };
    this.uploads.set(id, upload);
    // Yield so concurrent callers interleave as they would over a network.
    await new Promise((resolve) => setImmediate(resolve));
    return { ...upload };
  }

  async getDirectUpload(uploadId: string): Promise<MuxDirectUpload> {
    this.#enter("getDirectUpload");
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new VideoProviderError("not_found", 404);
    return { ...upload };
  }

  async cancelDirectUpload(uploadId: string): Promise<MuxDirectUpload> {
    this.#enter("cancelDirectUpload");
    const upload = this.uploads.get(uploadId);
    if (!upload) throw new VideoProviderError("not_found", 404);
    if (upload.status !== "waiting") throw new VideoProviderError("invalid_request", 400);
    upload.status = "cancelled";
    return { ...upload };
  }

  async getAsset(assetId: string): Promise<MuxAsset> {
    this.#enter("getAsset");
    const asset = this.assets.get(assetId);
    if (!asset) throw new VideoProviderError("not_found", 404);
    return { ...asset, signedPlaybackIds: [...asset.signedPlaybackIds] };
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.#enter("deleteAsset");
    if (!this.assets.delete(assetId)) throw new VideoProviderError("not_found", 404);
  }

  /** The file arrives: the upload gets an asset in the given state. */
  finishUpload(uploadId: string, videoId: string, status: MuxAsset["status"] = "preparing", overrides: Partial<MuxAsset> = {}): MuxAsset {
    const upload = this.uploads.get(uploadId);
    assert.ok(upload, "known upload");
    const n = uploadId.slice(-8);
    const asset: MuxAsset = {
      id: `AssetId${n}`,
      status,
      uploadId,
      passthrough: videoId,
      durationSeconds: 42.5,
      maxResolution: "2160p",
      width: 3840,
      height: 2160,
      signedPlaybackIds: [`SignedPlayback${n}`],
      errorType: null,
      ...overrides,
    };
    upload.status = "asset_created";
    upload.assetId = asset.id;
    this.assets.set(asset.id, asset);
    return asset;
  }

  setAssetStatus(assetId: string, status: MuxAsset["status"], errorType: string | null = null) {
    const asset = this.assets.get(assetId);
    assert.ok(asset, "known asset");
    asset.status = status;
    asset.errorType = errorType;
  }

  reset() {
    this.calls.length = 0;
  }
}

// ------------------------------------------------------------------ fixtures

let clock: number;
let repository: InMemoryVideoRepository;
let mux: FakeMux;
let logs: Array<{ event: string; fields?: VideoLogFields }>;
let service: VideoService;
let ids: number;

function build(limits: Partial<VideoServiceLimits> = {}) {
  service = createVideoService({
    repository,
    mux,
    config: { webhookSecret: new Secret(WEBHOOK_SECRET), signingKeyId: SIGNING_KEY_ID, signingPrivateKey: privateKey },
    corsOrigin: CORS_ORIGIN,
    limits,
    now: () => new Date(clock),
    newId: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
    logger: { warn: (event, fields) => logs.push({ event, fields }) },
  });
}

beforeEach(() => {
  clock = NOW_MS;
  repository = new InMemoryVideoRepository();
  mux = new FakeMux();
  logs = [];
  ids = 0;
  build();
});

const upload = (actor: VideoActor = EDITOR_A, overrides: Record<string, unknown> = {}) =>
  service.createUploadSession(actor, { title: "Showreel 2026", filename: "showreel.mp4", fileSizeBytes: 1_500_000_000, ...overrides });

async function uploadOk(actor: VideoActor = EDITOR_A) {
  const result = await upload(actor);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const record = await repository.findById(result.videoId);
  assert.ok(record);
  return { result, record };
}

function signedDelivery(event: unknown, options: { secret?: string; timestamp?: number; body?: string } = {}) {
  const body = options.body ?? JSON.stringify(event);
  const timestamp = options.timestamp ?? Math.floor(clock / 1000);
  return { rawBody: body, signatureHeader: `t=${timestamp},v1=${computeMuxSignature(options.secret ?? WEBHOOK_SECRET, timestamp, body)}` };
}

const deliver = (event: unknown) => service.handleMuxWebhook(signedDelivery(event));
const uploadEvent = (type: string, uploadId: string) => ({ id: `evt-${type}-${uploadId}`, type, data: { id: uploadId } });
const assetEvent = (type: string, asset: { id: string; uploadId: string | null }, extra: Record<string, unknown> = {}) => ({
  id: `evt-${type}-${asset.id}`,
  type,
  data: { id: asset.id, upload_id: asset.uploadId, ...extra },
});

const statusOf = async (id: string) => (await repository.findById(id))?.status;

function seedReady(overrides: Partial<VideoRecord> = {}): VideoRecord {
  const record: VideoRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Brand film",
    originalFilename: "brand.mov",
    declaredSizeBytes: 900_000_000,
    status: "READY",
    uploaderId: EDITOR_A.id,
    muxUploadId: "UploadIdSeeded0001",
    muxAssetId: "AssetIdSeeded0001",
    playbackId: "SignedPlaybackSeeded01",
    durationSeconds: 60,
    width: 3840,
    height: 2160,
    maxResolution: "2160p",
    failureCode: null,
    uploadExpiresAt: new Date(NOW_MS),
    createdAt: new Date(NOW_MS - 86_400_000),
    updatedAt: new Date(NOW_MS - 86_400_000),
    ...overrides,
  };
  repository.seed(record);
  return record;
}

/** Everything a caller or an operator could see: results, stored rows, and logs. */
const observable = (...results: unknown[]) => JSON.stringify({ results, logs, stored: repository.all() });

function assertNoSecrets(text: string) {
  for (const secret of [WEBHOOK_SECRET, TOKEN_SECRET, URL_SIGNATURE, "storage.example.invalid", "db-password"]) {
    assert.equal(text.includes(secret), false, `must not reveal ${secret}`);
  }
}

// ------------------------------------------------------------------ createUploadSession

describe("createUploadSession", () => {
  it("creates a signed-playback direct upload, persists it, then returns the URL", async () => {
    const { result, record } = await uploadOk();
    assert.match(result.uploadUrl, /^https:\/\//);
    assert.equal(result.expiresAt.getTime(), NOW_MS + 6 * 3600 * 1000);
    assert.equal(record.status, "UPLOAD_PENDING");
    assert.equal(record.uploaderId, EDITOR_A.id);
    assert.equal(record.title, "Showreel 2026");
    assert.equal(record.originalFilename, "showreel.mp4");
    assert.equal(record.muxUploadId, "UploadId00000001");
    assert.deepEqual(mux.createInputs[0], { corsOrigin: CORS_ORIGIN, passthrough: result.videoId, timeoutSeconds: 21_600 });
    assert.equal(JSON.stringify(repository.all()).includes(URL_SIGNATURE), false, "the upload URL is never stored");
    assert.equal(logs.length, 0);
  });

  it("validates the title, the file name, and the declared size before any provider call", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ title: "   " }, "title_required"],
      [{ title: "x".repeat(161) }, "title_too_long"],
      [{ title: "bad\u0007title" }, "title_invalid"],
      [{ filename: "../../etc/passwd.mp4" }, "unsupported_file"],
      [{ filename: "C:\\clips\\film.mp4" }, "unsupported_file"],
      [{ filename: "film.exe" }, "unsupported_file"],
      [{ filename: "film" }, "unsupported_file"],
      [{ filename: ".mp4" }, "unsupported_file"],
      [{ filename: 42 }, "unsupported_file"],
      [{ fileSizeBytes: 0 }, "unsupported_file"],
      [{ fileSizeBytes: -1 }, "unsupported_file"],
      [{ fileSizeBytes: 1.5 }, "unsupported_file"],
      [{ fileSizeBytes: "1000" }, "unsupported_file"],
      [{ fileSizeBytes: Number.NaN }, "unsupported_file"],
      [{ fileSizeBytes: DEFAULT_MAX_UPLOAD_BYTES + 1 }, "file_too_large"],
    ];
    for (const [overrides, error] of cases) {
      assert.deepEqual(await upload(EDITOR_A, overrides), { ok: false, error, retryable: false }, JSON.stringify(overrides));
    }
    assert.deepEqual(mux.calls, []);
    assert.equal(repository.all().length, 0);
  });

  it("accepts exactly the configured limit (10 GiB by default) and honours a smaller one", async () => {
    assert.equal(DEFAULT_MAX_UPLOAD_BYTES, 10 * 1024 ** 3);
    assert.equal((await upload(EDITOR_A, { fileSizeBytes: DEFAULT_MAX_UPLOAD_BYTES, filename: "Master.MOV" })).ok, true);
    build({ maxUploadBytes: 1000 });
    assert.equal((await upload(EDITOR_B, { fileSizeBytes: 1000 })).ok, true);
    assert.deepEqual(await upload(EDITOR_B, { fileSizeBytes: 1001 }), { ok: false, error: "file_too_large", retryable: false });
  });

  it("allows two active uploads per user; expired, cancelled, and other users' uploads do not count", async () => {
    await uploadOk();
    await uploadOk();
    mux.reset();
    assert.deepEqual(await upload(), { ok: false, error: "too_many_uploads", retryable: false });
    assert.deepEqual(mux.calls, [], "refused before contacting the provider");
    assert.equal((await upload(EDITOR_B)).ok, true, "limits are per user");

    const [first] = repository.all().filter((record) => record.uploaderId === EDITOR_A.id);
    assert.equal((await service.cancelUploadSession(EDITOR_A, first.id)).ok, true);
    assert.equal((await upload()).ok, true, "a cancelled upload frees its slot");

    clock += 6 * 3600 * 1000 + 1;
    assert.equal((await upload()).ok, true, "expired uploads free their slots");
  });

  it("enforces the limit atomically against concurrent requests and cleans up the loser", async () => {
    const results = await Promise.all([upload(), upload(), upload()]);
    assert.equal(results.filter((result) => result.ok).length, 2);
    assert.deepEqual(results.filter((result) => !result.ok), [{ ok: false, error: "too_many_uploads", retryable: false }]);
    assert.equal(repository.all().length, 2);
    const cancelled = [...mux.uploads.values()].filter((providerUpload) => providerUpload.status === "cancelled");
    assert.equal(cancelled.length, 1, "the unpersisted provider upload was cancelled");
    assert.equal(repository.all().some((record) => record.muxUploadId === cancelled[0].id), false);
  });

  it("reports provider failures without persisting anything, retryable only when retrying may help", async () => {
    mux.failures.createDirectUpload = new VideoProviderError("provider_unavailable", 503);
    assert.deepEqual(await upload(), { ok: false, error: "upload_failed", retryable: true });
    mux.failures.createDirectUpload = new VideoProviderError("unauthorized", 401);
    assert.deepEqual(await upload(), { ok: false, error: "upload_failed", retryable: false });
    mux.failures.createDirectUpload = new Error("socket hang up with db-password in it");
    assert.deepEqual(await upload(), { ok: false, error: "upload_failed", retryable: false });
    assert.equal(repository.all().length, 0);
    assert.deepEqual(logs.map((entry) => entry.fields?.providerCode), ["provider_unavailable", "unauthorized", "unexpected"]);
    assertNoSecrets(observable());
  });

  it("cancels the provider upload when persistence fails, and survives a failing cleanup", async () => {
    repository.insertWithinActiveLimit = async () => {
      throw new Error("connection refused: postgres://admin:db-password@db.example.invalid");
    };
    const result = await upload();
    assert.deepEqual(result, { ok: false, error: "upload_failed", retryable: true });
    assert.equal(mux.uploads.get("UploadId00000001")?.status, "cancelled");

    mux.failures.cancelDirectUpload = new VideoProviderError("timeout");
    const second = await upload();
    assert.deepEqual(second, { ok: false, error: "upload_failed", retryable: true });
    assert.ok(logs.some((entry) => entry.event === "video.upload.cleanup_failed"));
    assertNoSecrets(observable(result, second));
  });

  it("refuses a missing or invalid actor and an upload URL that is not HTTPS", async () => {
    assert.deepEqual(await upload({ id: "", role: "EDITOR" }), { ok: false, error: "forbidden", retryable: false });
    assert.deepEqual(await upload({ id: "x", role: "OWNER" as never }), { ok: false, error: "forbidden", retryable: false });

    const original = mux.createDirectUpload.bind(mux);
    mux.createDirectUpload = async (input) => ({ ...(await original(input)), url: "http://storage.example.invalid/insecure" });
    assert.deepEqual(await upload(), { ok: false, error: "upload_failed", retryable: false });
    assert.equal(repository.all().length, 0);
    assert.equal(mux.uploads.get("UploadId00000001")?.status, "cancelled");
  });
});

// ------------------------------------------------------------------ cancelUploadSession

describe("cancelUploadSession", () => {
  it("lets the uploader cancel: provider first, then the stored state", async () => {
    const { record } = await uploadOk();
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, record.id), { ok: true, status: "CANCELLED", changed: true });
    assert.equal(mux.uploads.get(record.muxUploadId)?.status, "cancelled");
    assert.equal(await statusOf(record.id), "CANCELLED");
  });

  it("refuses other editors and allows administrators", async () => {
    const { record } = await uploadOk();
    mux.reset();
    assert.deepEqual(await service.cancelUploadSession(EDITOR_B, record.id), { ok: false, error: "forbidden", retryable: false });
    assert.deepEqual(mux.calls, [], "no provider call for an unauthorized caller");
    assert.equal(await statusOf(record.id), "UPLOAD_PENDING");
    assert.equal((await service.cancelUploadSession(ADMIN, record.id)).ok, true);
    assert.equal((await service.cancelUploadSession({ id: EDITOR_A.id, role: "nobody" as never }, record.id)).ok, false);
  });

  it("is idempotent for an already cancelled upload", async () => {
    const { record } = await uploadOk();
    await service.cancelUploadSession(EDITOR_A, record.id);
    mux.reset();
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, record.id), { ok: true, status: "CANCELLED", changed: false });
    assert.deepEqual(mux.calls, []);
  });

  it("refuses unknown ids and uploads that are already processing", async () => {
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, "not-a-uuid"), { ok: false, error: "not_found", retryable: false });
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, "22222222-2222-4222-8222-222222222222"), { ok: false, error: "not_found", retryable: false });
    const ready = seedReady();
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, ready.id), { ok: false, error: "not_cancellable", retryable: false });
  });

  it("follows the provider's own state when it refuses to cancel", async () => {
    const finished = (await uploadOk()).record;
    mux.finishUpload(finished.muxUploadId, finished.id);
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, finished.id), { ok: false, error: "not_cancellable", retryable: false });
    assert.equal(await statusOf(finished.id), "UPLOAD_PENDING", "the webhook moves it to PROCESSING, not cancel");

    const gone = (await uploadOk()).record;
    mux.uploads.get(gone.muxUploadId)!.status = "timed_out";
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, gone.id), { ok: true, status: "CANCELLED", changed: true });
  });

  it("keeps the upload pending on a retryable provider failure", async () => {
    const { record } = await uploadOk();
    mux.failures.cancelDirectUpload = new VideoProviderError("rate_limited", 429);
    assert.deepEqual(await service.cancelUploadSession(EDITOR_A, record.id), { ok: false, error: "cancel_failed", retryable: true });
    assert.equal(await statusOf(record.id), "UPLOAD_PENDING");
  });

  it("reports a persistence failure as retryable, and the provider's webhook settles it", async () => {
    const { record } = await uploadOk();
    const update = repository.updateIfStatus.bind(repository);
    repository.updateIfStatus = async () => {
      throw new Error("db-password timeout");
    };
    const result = await service.cancelUploadSession(EDITOR_A, record.id);
    assert.deepEqual(result, { ok: false, error: "cancel_failed", retryable: true });
    assertNoSecrets(observable(result));

    repository.updateIfStatus = update;
    assert.deepEqual(await deliver(uploadEvent("video.upload.cancelled", record.muxUploadId)), { status: 200, outcome: "updated" });
    assert.equal(await statusOf(record.id), "CANCELLED");
  });
});

// ------------------------------------------------------------------ handleMuxWebhook

describe("handleMuxWebhook", () => {
  it("rejects forged, tampered, and replayed deliveries before reading anything", async () => {
    const { record } = await uploadOk();
    mux.finishUpload(record.muxUploadId, record.id, "ready");
    const event = uploadEvent("video.upload.asset_created", record.muxUploadId);
    const body = JSON.stringify(event);
    const signed = signedDelivery(event);
    mux.reset();
    const findById = repository.findById.bind(repository);
    let repositoryReads = 0;
    repository.findByMuxUploadId = async () => {
      repositoryReads += 1;
      return null;
    };

    const forged = [
      { rawBody: body, signatureHeader: null },
      { rawBody: body, signatureHeader: "garbage" },
      signedDelivery(event, { secret: "attacker-guessed-secret-000" }),
      { rawBody: body.replace("asset_created", "cancelled"), signatureHeader: signed.signatureHeader },
      signedDelivery(event, { timestamp: Math.floor(clock / 1000) - 301 }),
    ];
    for (const delivery of forged) {
      assert.deepEqual(await service.handleMuxWebhook(delivery), { status: 401, outcome: "invalid_signature" });
    }
    assert.deepEqual(mux.calls, []);
    assert.equal(repositoryReads, 0);
    assert.equal((await findById(record.id))?.status, "UPLOAD_PENDING");
    assertNoSecrets(observable());
  });

  it("refuses oversized bodies and acknowledges signed but malformed or unrelated events", async () => {
    assert.deepEqual(await service.handleMuxWebhook({ rawBody: "x".repeat(1024 * 1024 + 1), signatureHeader: null }), { status: 413, outcome: "too_large" });
    assert.deepEqual(await service.handleMuxWebhook(signedDelivery(null, { body: "{not json" })), { status: 200, outcome: "ignored" });
    assert.deepEqual(await deliver({ type: "video.asset.ready", data: { id: "bad id!" } }), { status: 200, outcome: "ignored" });
    assert.deepEqual(await deliver({ type: "video.live_stream.active", data: { id: "LiveStream0001" } }), { status: 200, outcome: "ignored" });
    assert.deepEqual(await deliver(uploadEvent("video.upload.asset_created", "UploadIdUnknown001")), { status: 200, outcome: "ignored" });
    assert.deepEqual(mux.calls, [], "unknown uploads are not looked up at the provider");
  });

  it("moves an upload to PROCESSING and READY from the provider's state, not the payload's", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "preparing");

    // The payload claims "ready"; the provider says "preparing".
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset, { status: "ready", playback_ids: [{ id: "AttackerPlayback01" }] })), {
      status: 200,
      outcome: "updated",
    });
    let stored = await repository.findById(record.id);
    assert.equal(stored?.status, "PROCESSING");
    assert.equal(stored?.muxAssetId, asset.id);
    assert.equal(stored?.playbackId, null);

    mux.setAssetStatus(asset.id, "ready");
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "updated" });
    stored = await repository.findById(record.id);
    assert.equal(stored?.status, "READY");
    assert.equal(stored?.playbackId, asset.signedPlaybackIds[0]);
    assert.equal(stored?.durationSeconds, 42.5);
    assert.equal(stored?.width, 3840);
    assert.equal(stored?.maxResolution, "2160p");
  });

  it("handles out-of-order and duplicate events, including concurrent duplicates", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "ready");

    // asset.ready arrives before upload.asset_created: found through upload_id.
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "updated" });
    assert.equal(await statusOf(record.id), "READY");
    assert.deepEqual(await deliver(uploadEvent("video.upload.asset_created", record.muxUploadId)), { status: 200, outcome: "unchanged" });
    assert.deepEqual(await deliver(assetEvent("video.asset.created", asset)), { status: 200, outcome: "unchanged" });
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "unchanged" });

    const second = (await uploadOk()).record;
    const secondAsset = mux.finishUpload(second.muxUploadId, second.id, "ready");
    const results = await Promise.all([1, 2, 3].map(() => deliver(assetEvent("video.asset.ready", secondAsset))));
    assert.ok(results.every((result) => result.status === 200));
    assert.ok(results.some((result) => result.outcome === "updated"));
    assert.equal(await statusOf(second.id), "READY");
  });

  it("records failed processing as a known code, never the provider's text, and keeps it failed", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "errored", { errorType: "invalid_input" });
    assert.deepEqual(await deliver(assetEvent("video.asset.errored", asset)), { status: 200, outcome: "updated" });
    let stored = await repository.findById(record.id);
    assert.equal(stored?.status, "FAILED");
    assert.equal(stored?.failureCode, "input_unsupported");

    mux.setAssetStatus(asset.id, "ready");
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "unchanged" }, "FAILED never becomes READY");

    const other = (await uploadOk()).record;
    const otherAsset = mux.finishUpload(other.muxUploadId, other.id, "errored", { errorType: "Something <script>odd</script>" });
    await deliver(assetEvent("video.asset.errored", otherAsset));
    stored = await repository.findById(other.id);
    assert.equal(stored?.failureCode, "processing_failed");
    assert.equal(JSON.stringify(repository.all()).includes("script"), false);
  });

  it("marks errored and timed-out uploads as failed", async () => {
    const errored = (await uploadOk()).record;
    mux.uploads.get(errored.muxUploadId)!.status = "errored";
    await deliver(uploadEvent("video.upload.errored", errored.muxUploadId));
    assert.equal((await repository.findById(errored.id))?.failureCode, "upload_failed");

    const expired = (await uploadOk()).record;
    mux.uploads.get(expired.muxUploadId)!.status = "timed_out";
    await deliver(uploadEvent("video.upload.timed_out", expired.muxUploadId));
    const stored = await repository.findById(expired.id);
    assert.equal(stored?.status, "FAILED");
    assert.equal(stored?.failureCode, "upload_expired");
  });

  it("fails a ready asset that has no signed playback ID", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "ready", { signedPlaybackIds: [] });
    await deliver(assetEvent("video.asset.ready", asset));
    assert.equal(await statusOf(record.id), "FAILED");
  });

  it("never lets a cancelled video become READY, and deletes its orphan asset", async () => {
    const { record } = await uploadOk();
    await service.cancelUploadSession(EDITOR_A, record.id);
    // A file that finished uploading at the same moment as the cancel.
    const asset = mux.finishUpload(record.muxUploadId, record.id, "ready");

    mux.failures.deleteAsset = new VideoProviderError("provider_unavailable", 502);
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 503, outcome: "retry" });
    delete mux.failures.deleteAsset;
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "unchanged" });
    assert.equal(await statusOf(record.id), "CANCELLED");
    assert.equal(mux.assets.has(asset.id), false);
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "unchanged" }, "late duplicate");
  });

  it("leaves videos being deleted alone", async () => {
    const deleting = seedReady({ status: "DELETING" });
    mux.reset();
    assert.deepEqual(await deliver(uploadEvent("video.upload.asset_created", deleting.muxUploadId)), { status: 200, outcome: "unchanged" });
    assert.deepEqual(mux.calls, []);
    assert.equal(await statusOf(deleting.id), "DELETING");
  });

  it("ignores assets the video does not own", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "ready", { passthrough: "99999999-9999-4999-8999-999999999999" });
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "ignored" });
    assert.equal(await statusOf(record.id), "UPLOAD_PENDING");

    mux.assets.get(asset.id)!.passthrough = record.id;
    mux.assets.get(asset.id)!.uploadId = "UploadIdSomebodyElse";
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 200, outcome: "ignored" });
    assert.equal(await statusOf(record.id), "UPLOAD_PENDING");
    assert.ok(logs.some((entry) => entry.event === "video.webhook.ownership_mismatch"));
  });

  it("asks for redelivery when the provider or the database fails, then succeeds", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "ready");
    const event = assetEvent("video.asset.ready", asset);

    mux.failures.getAsset = new VideoProviderError("timeout");
    assert.deepEqual(await deliver(event), { status: 503, outcome: "retry" });
    delete mux.failures.getAsset;

    mux.failures.getDirectUpload = new VideoProviderError("unauthorized", 401);
    assert.deepEqual(await deliver(event), { status: 503, outcome: "retry" }, "a credential problem may be fixed before redelivery");
    delete mux.failures.getDirectUpload;

    const update = repository.updateIfStatus.bind(repository);
    repository.updateIfStatus = async () => {
      throw new Error("db-password deadlock");
    };
    assert.deepEqual(await deliver(event), { status: 503, outcome: "retry" });
    repository.updateIfStatus = update;

    assert.equal(await statusOf(record.id), "UPLOAD_PENDING");
    assert.deepEqual(await deliver(event), { status: 200, outcome: "updated" });
    assert.equal(await statusOf(record.id), "READY");
    assertNoSecrets(observable());
  });

  it("asks for redelivery after repeated write conflicts", async () => {
    const { record } = await uploadOk();
    const asset = mux.finishUpload(record.muxUploadId, record.id, "ready");
    repository.updateIfStatus = async () => null;
    assert.deepEqual(await deliver(assetEvent("video.asset.ready", asset)), { status: 503, outcome: "retry" });
  });
});

// ------------------------------------------------------------------ issuePlaybackToken

describe("issuePlaybackToken", () => {
  const PUBLISHED = "project-published";
  const DRAFT = "project-draft";
  const HIDDEN_CATEGORY = "project-inactive-category";

  const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";

  it("gives an authenticated admin a short-lived signed HTTPS URL for a READY draft video", async () => {
    const video = seedReady();
    repository.setAssignments(video.id, [{ projectId: DRAFT, projectStatus: "DRAFT", categoryActive: true }]);
    for (const actor of [EDITOR_B, ADMIN]) {
      const result = await service.issuePlaybackToken(video.id, { kind: "admin", actor });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const url = new URL(result.url);
      assert.equal(url.protocol, "https:");
      assert.equal(url.origin, "https://stream.mux.com");
      assert.equal(url.pathname, `/${video.playbackId}.m3u8`);
      const [header, payload, signature] = tokenOf(result.url).split(".");
      assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")));
      assert.deepEqual(decode(payload), { sub: video.playbackId, aud: "v", exp: NOW_MS / 1000 + 900, kid: SIGNING_KEY_ID });
      assert.equal(result.expiresAt.getTime(), NOW_MS + 900_000);
    }
  });

  it("tells an admin a video is not ready, and refuses an invalid actor", async () => {
    const video = seedReady({ status: "PROCESSING", playbackId: null });
    assert.deepEqual(await service.issuePlaybackToken(video.id, { kind: "admin", actor: EDITOR_A }), { ok: false, error: "not_ready", retryable: false });
    assert.deepEqual(await service.issuePlaybackToken(video.id, { kind: "admin", actor: { id: "", role: "ADMIN" } }), { ok: false, error: "forbidden", retryable: false });
  });

  it("allows public playback only through a published project in an active category", async () => {
    const video = seedReady();
    repository.setAssignments(video.id, [
      { projectId: PUBLISHED, projectStatus: "PUBLISHED", categoryActive: true },
      { projectId: DRAFT, projectStatus: "DRAFT", categoryActive: true },
      { projectId: HIDDEN_CATEGORY, projectStatus: "PUBLISHED", categoryActive: false },
    ]);
    const publicFor = (projectId: string) => service.issuePlaybackToken(video.id, { kind: "public", projectId });
    assert.equal((await publicFor(PUBLISHED)).ok, true);
    const notFound = { ok: false, error: "not_found", retryable: false };
    assert.deepEqual(await publicFor(DRAFT), notFound);
    assert.deepEqual(await publicFor(HIDDEN_CATEGORY), notFound);
    assert.deepEqual(await publicFor("project-unrelated"), notFound);
    assert.deepEqual(await publicFor(""), notFound);
  });

  it("does not distinguish draft, unready, and unknown videos for the public", async () => {
    const draftOnly = seedReady();
    repository.setAssignments(draftOnly.id, [{ projectId: DRAFT, projectStatus: "DRAFT", categoryActive: true }]);
    const processing = seedReady({ id: "33333333-3333-4333-8333-333333333333", status: "PROCESSING", playbackId: null, muxUploadId: "UploadIdSeeded0003" });
    repository.setAssignments(processing.id, [{ projectId: PUBLISHED, projectStatus: "PUBLISHED", categoryActive: true }]);

    const answers = await Promise.all([
      service.issuePlaybackToken(draftOnly.id, { kind: "public", projectId: DRAFT }),
      service.issuePlaybackToken(processing.id, { kind: "public", projectId: PUBLISHED }),
      service.issuePlaybackToken("44444444-4444-4444-8444-444444444444", { kind: "public", projectId: PUBLISHED }),
      service.issuePlaybackToken("not-a-uuid", { kind: "public", projectId: PUBLISHED }),
    ]);
    for (const answer of answers) assert.deepEqual(answer, { ok: false, error: "not_found", retryable: false });
    const text = JSON.stringify(answers);
    for (const leak of [draftOnly.title, draftOnly.playbackId!, "PROCESSING", "DRAFT"]) assert.equal(text.includes(leak), false);
  });

  it("honours a configured lifetime and refuses lifetimes outside the signer's bounds", async () => {
    build({ playbackTokenTtlSeconds: 120 });
    const video = seedReady();
    const result = await service.issuePlaybackToken(video.id, { kind: "admin", actor: ADMIN });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(decode(tokenOf(result.url).split(".")[1]).exp, NOW_MS / 1000 + 120);
    assert.equal(result.expiresAt.getTime(), NOW_MS + 120_000);

    clock += 60_000;
    const later = await service.issuePlaybackToken(video.id, { kind: "admin", actor: ADMIN });
    assert.ok(later.ok && later.expiresAt.getTime() === NOW_MS + 180_000, "each token is fresh");

    assert.throws(() => build({ playbackTokenTtlSeconds: 59 }), RangeError);
    assert.throws(() => build({ playbackTokenTtlSeconds: 86_401 }), RangeError);
  });

  it("reports a persistence failure as retryable without detail", async () => {
    repository.findById = async () => {
      throw new Error("db-password exposed?");
    };
    const result = await service.issuePlaybackToken(seedReady().id, { kind: "public", projectId: PUBLISHED });
    assert.deepEqual(result, { ok: false, error: "playback_unavailable", retryable: true });
    assertNoSecrets(observable(result));
  });
});

// ------------------------------------------------------------------ configuration

describe("video service configuration", () => {
  it("rejects limits outside safe ranges", () => {
    assert.throws(() => build({ maxUploadBytes: 0 }), RangeError);
    assert.throws(() => build({ maxActiveUploadsPerUser: 0 }), RangeError);
    assert.throws(() => build({ uploadTimeoutSeconds: 30 }), RangeError);
    assert.throws(() => build({ uploadTimeoutSeconds: 604_801 }), RangeError);
  });

  it("validates display file names", () => {
    assert.deepEqual(validateVideoFilename("  Final Cut v2.MP4 "), { ok: true, value: "Final Cut v2.MP4" });
    for (const name of ["a/b.mp4", "a\\b.mp4", "a\nb.mp4", "x".repeat(252) + ".mp4", "clip.mp4.exe", "", null]) {
      assert.deepEqual(validateVideoFilename(name), { ok: false }, String(name));
    }
  });
});
