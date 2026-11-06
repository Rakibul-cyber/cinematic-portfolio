import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { VideoProviderError } from "@/server/video/errors";
import { InMemoryVideoRepository } from "@/server/video/in-memory-repository";
import type { MuxAsset, MuxClient, MuxDirectUpload } from "@/server/video/mux-client";
import type { VideoRecord } from "@/server/video/repository";
import { Secret } from "@/server/video/secret";
import { DELETION_STALE_AFTER_MS, createVideoService, type VideoActor, type VideoLogFields, type VideoService } from "@/server/video/service";

/**
 * Permanent video deletion in the service (P3-11D), against the in-memory
 * repository and a scripted fake Mux client. No database, no network.
 */

const NOW_MS = Date.parse("2027-02-01T12:00:00.000Z");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WEBHOOK_SECRET = "fictional-webhook-secret-delete-01";

const ADMIN: VideoActor = { id: "user-admin", role: "ADMIN" };
const SUPER: VideoActor = { id: "user-super", role: "SUPER_ADMIN" };
const EDITOR: VideoActor = { id: "user-editor", role: "EDITOR" };
const VIDEO_ID = "11111111-1111-4111-8111-111111111111";

class ScriptedMux implements MuxClient {
  calls: string[] = [];
  assets = new Set<string>();
  uploadAssetId: string | null = null;
  uploadError: VideoProviderError | Error | null = null;
  deleteErrors: Array<VideoProviderError | Error> = [];

  async createDirectUpload(): Promise<MuxDirectUpload> {
    throw new Error("not used");
  }
  async cancelDirectUpload(): Promise<MuxDirectUpload> {
    throw new Error("not used");
  }
  async getDirectUpload(id: string): Promise<MuxDirectUpload> {
    this.calls.push(`getDirectUpload:${id}`);
    if (this.uploadError) throw this.uploadError;
    return { id, status: this.uploadAssetId ? "asset_created" : "cancelled", url: null, assetId: this.uploadAssetId, timeoutSeconds: 3600 };
  }
  async getAsset(): Promise<MuxAsset> {
    throw new Error("not used");
  }
  async deleteAsset(id: string): Promise<void> {
    this.calls.push(`deleteAsset:${id}`);
    const next = this.deleteErrors.shift();
    if (next) throw next;
    if (!this.assets.delete(id)) throw new VideoProviderError("not_found", 404);
  }
}

let clock: number;
let repository: InMemoryVideoRepository;
let mux: ScriptedMux;
let logs: Array<{ event: string; fields?: VideoLogFields }>;
let service: VideoService;

beforeEach(() => {
  clock = NOW_MS;
  repository = new InMemoryVideoRepository();
  mux = new ScriptedMux();
  logs = [];
  service = createVideoService({
    repository,
    mux,
    config: { webhookSecret: new Secret(WEBHOOK_SECRET), signingKeyId: "FictionalSigningKey0001", signingPrivateKey: privateKey },
    corsOrigin: "https://studio.example.test",
    now: () => new Date(clock),
    logger: { warn: (event, fields) => logs.push({ event, fields }) },
  });
});

function seed(overrides: Partial<VideoRecord> = {}): VideoRecord {
  const record: VideoRecord = {
    id: VIDEO_ID,
    title: "Brand film",
    originalFilename: "brand.mov",
    declaredSizeBytes: 900_000_000,
    status: "READY",
    uploaderId: "user-uploader",
    muxUploadId: "UploadIdDelete0001",
    muxAssetId: "AssetIdDelete00001",
    playbackId: "SignedPlaybackDel01",
    durationSeconds: 61,
    width: 1920,
    height: 1080,
    maxResolution: "1080p",
    failureCode: null,
    uploadExpiresAt: new Date(NOW_MS - 3600_000),
    createdAt: new Date(NOW_MS - 7200_000),
    updatedAt: new Date(NOW_MS - 7200_000),
    ...overrides,
  };
  repository.seed(record);
  if (record.muxAssetId) mux.assets.add(record.muxAssetId);
  return record;
}

const failure = (error: string, retryable = false) => ({ ok: false, error, retryable });

describe("deleteVideo: authorization", () => {
  it("refuses an EDITOR, an invalid actor, and leaves the video and the provider untouched", async () => {
    seed();
    assert.deepEqual(await service.deleteVideo(EDITOR, VIDEO_ID), failure("forbidden"));
    assert.deepEqual(await service.deleteVideo({ id: "", role: "ADMIN" }, VIDEO_ID), failure("forbidden"));
    assert.deepEqual(await service.deleteVideo({ id: "x", role: "OWNER" as never }, VIDEO_ID), failure("forbidden"));
    assert.equal((await repository.findById(VIDEO_ID))?.status, "READY");
    assert.deepEqual(mux.calls, []);
  });

  it("lets ADMIN and SUPER_ADMIN delete", async () => {
    seed();
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    seed({ id: "22222222-2222-4222-8222-222222222222", muxUploadId: "UploadIdDelete0002", muxAssetId: "AssetIdDelete00002" });
    assert.deepEqual(await service.deleteVideo(SUPER, "22222222-2222-4222-8222-222222222222"), { ok: true });
    assert.equal(repository.all().length, 0);
  });

  it("answers not_found for malformed or unknown ids", async () => {
    assert.deepEqual(await service.deleteVideo(ADMIN, "not-a-uuid"), failure("not_found"));
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("not_found"));
  });
});

describe("deleteVideo: eligibility", () => {
  it("refuses a video assigned to any project, draft or published, without touching the provider", async () => {
    seed();
    repository.setAssignments(VIDEO_ID, [{ projectId: "p-draft", projectStatus: "DRAFT", categoryActive: true }]);
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_assigned"));
    assert.equal((await repository.findById(VIDEO_ID))?.status, "READY", "still playable for its project");
    assert.deepEqual(mux.calls, []);
    assert.ok(mux.assets.has("AssetIdDelete00001"));
  });

  it("refuses an upload in progress (cancel it instead) and a fresh deletion already running", async () => {
    seed({ status: "UPLOAD_PENDING", muxAssetId: null, playbackId: null });
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_upload_in_progress"));
    repository.seed({ ...(await repository.findById(VIDEO_ID))!, status: "DELETING", updatedAt: new Date(NOW_MS - 1000) });
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_in_progress"));
    assert.deepEqual(mux.calls, []);
  });

  it("deletes PROCESSING, FAILED, and CANCELLED videos (owner decision MH-07)", async () => {
    for (const status of ["PROCESSING", "FAILED", "CANCELLED"] as const) {
      seed({ status, playbackId: null });
      assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true }, status);
      assert.equal(await repository.findById(VIDEO_ID), null);
    }
  });
});

describe("deleteVideo: provider and persistence", () => {
  it("deletes the provider asset before the row", async () => {
    seed();
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    assert.deepEqual(mux.calls, ["deleteAsset:AssetIdDelete00001"]);
    assert.equal(mux.assets.size, 0);
    assert.equal(await repository.findById(VIDEO_ID), null);
  });

  it("treats an asset already gone at the provider as deleted", async () => {
    seed();
    mux.assets.clear();
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    assert.equal(await repository.findById(VIDEO_ID), null);
  });

  it("finds an asset created after a cancellation through the upload, so it is not orphaned", async () => {
    seed({ status: "CANCELLED", muxAssetId: null, playbackId: null });
    mux.uploadAssetId = "AssetIdLateOrphan1";
    mux.assets.add("AssetIdLateOrphan1");
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    assert.deepEqual(mux.calls, ["getDirectUpload:UploadIdDelete0001", "deleteAsset:AssetIdLateOrphan1"]);
  });

  it("deletes a record whose upload is unknown to the provider without any asset call", async () => {
    seed({ status: "FAILED", muxAssetId: null, playbackId: null });
    mux.uploadError = new VideoProviderError("not_found", 404);
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    assert.deepEqual(mux.calls, ["getDirectUpload:UploadIdDelete0001"]);
  });

  it("marks DELETE_FAILED on a provider failure, keeps the row, and succeeds on retry", async () => {
    seed();
    mux.deleteErrors.push(new VideoProviderError("provider_unavailable", 503));
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_failed", true));
    const failed = await repository.findById(VIDEO_ID);
    assert.equal(failed?.status, "DELETE_FAILED");
    assert.equal(failed?.muxAssetId, "AssetIdDelete00001", "the asset can always be found again");
    assert.ok(mux.assets.has("AssetIdDelete00001"));
    assert.ok(logs.some((entry) => entry.event === "video.delete.failed" && entry.fields?.reason === "provider_delete"));

    // Retry Delete.
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    assert.equal(await repository.findById(VIDEO_ID), null);
    assert.equal(mux.assets.size, 0);
  });

  it("reports a non-retryable provider refusal as not retryable, still as DELETE_FAILED", async () => {
    seed();
    mux.deleteErrors.push(new VideoProviderError("unauthorized", 401));
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_failed", false));
    assert.equal((await repository.findById(VIDEO_ID))?.status, "DELETE_FAILED");
  });

  it("marks DELETE_FAILED when the row cannot be removed after the provider deletion, and retry completes", async () => {
    seed();
    const original = repository.deleteIfDeleting.bind(repository);
    repository.deleteIfDeleting = async () => {
      throw new Error("connection reset");
    };
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_failed", true));
    assert.equal((await repository.findById(VIDEO_ID))?.status, "DELETE_FAILED");
    repository.deleteIfDeleting = original;
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true }, "the asset is already gone, which counts as deleted");
    assert.equal(await repository.findById(VIDEO_ID), null);
    // The retry reached the provider again and received its 404; nothing else was called.
    assert.deepEqual(mux.calls, ["deleteAsset:AssetIdDelete00001", "deleteAsset:AssetIdDelete00001"]);
    assert.equal(mux.assets.size, 0);
  });

  it("answers delete_failed (retryable) when the claim itself cannot be stored", async () => {
    seed();
    repository.beginDeletion = async () => {
      throw new Error("database down");
    };
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), failure("delete_failed", true));
    assert.deepEqual(mux.calls, []);
  });

  it("lets an interrupted deletion be retried once its claim is stale", async () => {
    seed({ status: "DELETING", updatedAt: new Date(NOW_MS - DELETION_STALE_AFTER_MS - 1) });
    assert.deepEqual(await service.deleteVideo(ADMIN, VIDEO_ID), { ok: true });
    assert.equal(await repository.findById(VIDEO_ID), null);
  });

  it("keeps a DELETING video unplayable and out of webhook reach", async () => {
    seed();
    mux.deleteErrors.push(new VideoProviderError("provider_unavailable", 503));
    await service.deleteVideo(ADMIN, VIDEO_ID);
    const preview = await service.issuePlaybackToken(VIDEO_ID, { kind: "admin", actor: ADMIN });
    assert.deepEqual(preview, failure("not_ready"));
  });

  it("never logs provider or credential text", async () => {
    seed();
    mux.deleteErrors.push(new Error(`upstream said ${WEBHOOK_SECRET}`));
    await service.deleteVideo(ADMIN, VIDEO_ID);
    const text = JSON.stringify(logs);
    assert.equal(text.includes(WEBHOOK_SECRET), false);
    assert.equal(text.includes("upstream said"), false);
  });
});
