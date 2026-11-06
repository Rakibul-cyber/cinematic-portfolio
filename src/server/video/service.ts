import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { isPublicProject } from "@/lib/video-eligibility";
import type { VideoMessageCode } from "@/lib/video-messages";
import { isValidProviderId, transitionDecision, validateVideoTitle, type VideoStatus } from "@/lib/video-status";
import { isAdminRole, isAdministrative, type AdminRole } from "@/server/auth/roles";
import type { VideoProviderConfig } from "@/server/video/config";
import { VideoProviderError, isRetryableProviderError } from "@/server/video/errors";
import { UPLOAD_TIMEOUT_SECONDS, type MuxAsset, type MuxClient, type MuxDirectUpload } from "@/server/video/mux-client";
import { PLAYBACK_TOKEN_TTL_SECONDS, signPlaybackToken, signedPlaybackUrl } from "@/server/video/playback-token";
import type { VideoPatch, VideoRecord, VideoRepository } from "@/server/video/repository";
import { verifyMuxWebhookSignature } from "@/server/video/webhook-signature";

/**
 * Video upload and playback orchestration (P3-11B), independent of routes,
 * Prisma, and the network: the repository, the Mux client, the clock, the id
 * generator, and the logger are all injected.
 *
 * Callers authenticate first (`requireUser` / `requireAdmin` in the future
 * routes) and pass the resulting actor in; this module re-checks roles and
 * ownership itself, so a route that forgets a check still cannot cross them.
 *
 * Secrets: the signed upload URL is returned to the uploader and nowhere else.
 * It is not stored, logged, or put in an error. Provider and persistence
 * failures are reduced to codes; their messages are never echoed or logged.
 */

// ------------------------------------------------------------------ limits

/** 10 GiB: the initial upload limit (MH-03). */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 ** 3;
export const DEFAULT_MAX_ACTIVE_UPLOADS_PER_USER = 2;
/** How long a direct-upload URL accepts the file. Whether this bounds the whole transfer is UNVERIFIED (MH-02D). */
export const DEFAULT_UPLOAD_TIMEOUT_SECONDS = 6 * 3600;
/** Playback token lifetime. Behaviour when it expires mid-playback is UNVERIFIED (MH-02D T-11). */
export const DEFAULT_PLAYBACK_TOKEN_TTL_SECONDS = 15 * 60;
/** Larger webhook bodies are refused before any work is done. */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
export const ALLOWED_VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm"] as const;
const FILENAME_MAX_LENGTH = 255;
const MAX_CAS_ATTEMPTS = 3;

export type VideoServiceLimits = {
  maxUploadBytes: number;
  maxActiveUploadsPerUser: number;
  uploadTimeoutSeconds: number;
  playbackTokenTtlSeconds: number;
};

// ------------------------------------------------------------------ dependencies

export type VideoActor = { id: string; role: AdminRole };

/** Fields that may appear in a log entry. None of them can carry a secret or a URL. */
export type VideoLogFields = {
  videoId?: string;
  reason?: string;
  providerCode?: string;
  httpStatus?: number | null;
};

export type VideoLogger = { warn(event: string, fields?: VideoLogFields): void };

const silentLogger: VideoLogger = { warn() {} };

export type VideoServiceDeps = {
  repository: VideoRepository;
  mux: MuxClient;
  config: Pick<VideoProviderConfig, "webhookSecret" | "signingKeyId" | "signingPrivateKey">;
  /** The admin origin allowed to upload from the browser. */
  corsOrigin: string;
  limits?: Partial<VideoServiceLimits>;
  now?: () => Date;
  newId?: () => string;
  logger?: VideoLogger;
  /**
   * Told after a webhook moves a video to READY, FAILED, or CANCELLED (for the
   * audit log). Its failures are swallowed: an audit problem never changes the
   * webhook's answer.
   */
  onTransition?: (event: VideoTransitionEvent) => Promise<void> | void;
};

export type VideoTransitionEvent = {
  videoId: string;
  uploaderId: string;
  from: VideoStatus;
  to: "READY" | "FAILED" | "CANCELLED";
  failureCode: VideoMessageCode | null;
};

// ------------------------------------------------------------------ results

type Failure<Code extends string> = { ok: false; error: Code; retryable: boolean };

export type CreateUploadInput = { title: unknown; filename: unknown; fileSizeBytes: unknown };

export type CreateUploadResult =
  | { ok: true; videoId: string; uploadUrl: string; expiresAt: Date }
  | Failure<"forbidden" | "title_required" | "title_too_long" | "title_invalid" | "unsupported_file" | "file_too_large" | "too_many_uploads" | "upload_failed">;

export type CancelUploadResult =
  | { ok: true; status: "CANCELLED"; changed: boolean }
  | Failure<"forbidden" | "not_found" | "not_cancellable" | "cancel_failed">;

export type WebhookInput = { rawBody: string | Buffer; signatureHeader: string | null | undefined };

/**
 * An HTTP-shaped answer for the future route. Any non-2xx makes the provider
 * redeliver the event, so 503 is used exactly when trying again may help.
 */
export type WebhookResult =
  | { status: 200; outcome: "updated" | "unchanged" | "ignored" }
  | { status: 401; outcome: "invalid_signature" }
  | { status: 413; outcome: "too_large" }
  | { status: 503; outcome: "retry" };

export type PlaybackViewer = { kind: "admin"; actor: VideoActor } | { kind: "public"; projectId: string };

export type PlaybackResult =
  | { ok: true; url: string; expiresAt: Date }
  | Failure<"forbidden" | "not_found" | "not_ready" | "playback_unavailable">;

export type VideoService = {
  createUploadSession(actor: VideoActor, input: CreateUploadInput): Promise<CreateUploadResult>;
  cancelUploadSession(actor: VideoActor, videoId: string): Promise<CancelUploadResult>;
  handleMuxWebhook(input: WebhookInput): Promise<WebhookResult>;
  issuePlaybackToken(videoId: string, viewer: PlaybackViewer): Promise<PlaybackResult>;
};

// ------------------------------------------------------------------ input validation

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A display file name: a base name with an allowed video extension, no paths or control characters. */
export function validateVideoFilename(input: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof input !== "string") return { ok: false };
  if (/[\u0000-\u001F\u007F/\\]/.test(input)) return { ok: false };
  const value = input.trim();
  if (!value || value.length > FILENAME_MAX_LENGTH || value.startsWith(".")) return { ok: false };
  const dot = value.lastIndexOf(".");
  const extension = dot > 0 ? value.slice(dot + 1).toLowerCase() : "";
  if (!(ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) return { ok: false };
  return { ok: true, value };
}

function resolveLimits(overrides: Partial<VideoServiceLimits> = {}): VideoServiceLimits {
  const limits: VideoServiceLimits = {
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
    maxActiveUploadsPerUser: DEFAULT_MAX_ACTIVE_UPLOADS_PER_USER,
    uploadTimeoutSeconds: DEFAULT_UPLOAD_TIMEOUT_SECONDS,
    playbackTokenTtlSeconds: DEFAULT_PLAYBACK_TOKEN_TTL_SECONDS,
    ...overrides,
  };
  const integerIn = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!integerIn(limits.maxUploadBytes, 1, Number.MAX_SAFE_INTEGER)) throw new RangeError("maxUploadBytes must be a positive integer.");
  if (!integerIn(limits.maxActiveUploadsPerUser, 1, 100)) throw new RangeError("maxActiveUploadsPerUser must be between 1 and 100.");
  if (!integerIn(limits.uploadTimeoutSeconds, UPLOAD_TIMEOUT_SECONDS.min, UPLOAD_TIMEOUT_SECONDS.max)) {
    throw new RangeError("uploadTimeoutSeconds is out of range.");
  }
  if (!integerIn(limits.playbackTokenTtlSeconds, PLAYBACK_TOKEN_TTL_SECONDS.min, PLAYBACK_TOKEN_TTL_SECONDS.max)) {
    throw new RangeError("playbackTokenTtlSeconds is out of range.");
  }
  return limits;
}

const isActor = (actor: unknown): actor is VideoActor =>
  typeof actor === "object" && actor !== null && typeof (actor as VideoActor).id === "string" && (actor as VideoActor).id !== "" && isAdminRole((actor as VideoActor).role);

/** The provider's error category, reduced to a known code (category names UNVERIFIED until the trial). */
function assetFailureCode(errorType: string | null): VideoMessageCode {
  if (errorType === "invalid_input") return "input_unsupported";
  if (errorType === "duration_exceeded") return "duration_exceeded";
  return "processing_failed";
}

const webhookEventSchema = z.object({
  type: z.string().max(128),
  data: z.object({ id: z.string().refine(isValidProviderId), upload_id: z.string().refine(isValidProviderId).nullish() }),
});

// ------------------------------------------------------------------ service

/** A target state derived from the provider's authoritative view. */
type Target = { status: VideoStatus; patch: VideoPatch } | null;

class RetryableError extends Error {
  constructor(readonly reason: string) {
    super(`Retryable video failure (${reason}).`);
    this.name = "RetryableError";
  }
}

export function createVideoService(deps: VideoServiceDeps): VideoService {
  const { repository, mux, config, corsOrigin } = deps;
  const limits = resolveLimits(deps.limits);
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const logger = deps.logger ?? silentLogger;

  async function notifyTransition(from: VideoStatus, record: VideoRecord): Promise<void> {
    if (!deps.onTransition) return;
    if (record.status !== "READY" && record.status !== "FAILED" && record.status !== "CANCELLED") return;
    try {
      await deps.onTransition({ videoId: record.id, uploaderId: record.uploaderId, from, to: record.status, failureCode: record.failureCode });
    } catch {
      logger.warn("video.webhook.transition_hook_failed", { videoId: record.id });
    }
  }

  const providerFields = (error: unknown): VideoLogFields =>
    error instanceof VideoProviderError ? { providerCode: error.code, httpStatus: error.status } : { providerCode: "unexpected" };

  // ---------------------------------------------------------------- upload

  async function createUploadSession(actor: VideoActor, input: CreateUploadInput): Promise<CreateUploadResult> {
    const fail = (error: Extract<CreateUploadResult, { ok: false }>["error"], retryable = false) => ({ ok: false, error, retryable }) as const;
    if (!isActor(actor)) return fail("forbidden");

    const title = validateVideoTitle(input.title);
    if (!title.ok) return fail(title.error);
    const filename = validateVideoFilename(input.filename);
    if (!filename.ok) return fail("unsupported_file");
    const size = input.fileSizeBytes;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return fail("unsupported_file");
    if (size > limits.maxUploadBytes) return fail("file_too_large");

    // A cheap early refusal, so a full user costs no provider call. The
    // authoritative, race-safe check is the atomic insert below.
    const startedAt = now();
    try {
      if ((await repository.countActiveUploads(actor.id, startedAt)) >= limits.maxActiveUploadsPerUser) return fail("too_many_uploads");
    } catch {
      logger.warn("video.upload.persistence_failed", { reason: "count" });
      return fail("upload_failed", true);
    }

    const videoId = newId();
    let upload: MuxDirectUpload;
    try {
      upload = await mux.createDirectUpload({ corsOrigin, passthrough: videoId, timeoutSeconds: limits.uploadTimeoutSeconds });
    } catch (error) {
      logger.warn("video.upload.provider_failed", { videoId, ...providerFields(error) });
      return fail("upload_failed", isRetryableProviderError(error));
    }
    const uploadUrl = upload.url;
    if (!uploadUrl || !uploadUrl.startsWith("https://")) {
      logger.warn("video.upload.provider_failed", { videoId, reason: "upload_url_not_https" });
      await cancelProviderUpload(videoId, upload.id);
      return fail("upload_failed");
    }

    const expiresAt = new Date(startedAt.getTime() + limits.uploadTimeoutSeconds * 1000);
    const record: VideoRecord = {
      id: videoId,
      title: title.value,
      originalFilename: filename.value,
      declaredSizeBytes: size,
      status: "UPLOAD_PENDING",
      uploaderId: actor.id,
      muxUploadId: upload.id,
      muxAssetId: null,
      playbackId: null,
      durationSeconds: null,
      width: null,
      height: null,
      maxResolution: null,
      failureCode: null,
      uploadExpiresAt: expiresAt,
      createdAt: startedAt,
      updatedAt: startedAt,
    };

    let inserted: "inserted" | "limit_reached";
    try {
      inserted = await repository.insertWithinActiveLimit(record, limits.maxActiveUploadsPerUser, startedAt);
    } catch {
      logger.warn("video.upload.persistence_failed", { videoId, reason: "insert" });
      await cancelProviderUpload(videoId, upload.id);
      return fail("upload_failed", true);
    }
    if (inserted === "limit_reached") {
      await cancelProviderUpload(videoId, upload.id);
      return fail("too_many_uploads");
    }
    return { ok: true, videoId, uploadUrl, expiresAt };
  }

  /** Best-effort cleanup of a provider upload nobody can use; its URL was never handed out. */
  async function cancelProviderUpload(videoId: string, uploadId: string): Promise<void> {
    try {
      await mux.cancelDirectUpload(uploadId);
    } catch (error) {
      // The upload expires on its own after the timeout.
      logger.warn("video.upload.cleanup_failed", { videoId, ...providerFields(error) });
    }
  }

  // ---------------------------------------------------------------- cancel

  async function cancelUploadSession(actor: VideoActor, videoId: string): Promise<CancelUploadResult> {
    const fail = (error: Extract<CancelUploadResult, { ok: false }>["error"], retryable = false) => ({ ok: false, error, retryable }) as const;
    if (!isActor(actor)) return fail("forbidden");
    if (typeof videoId !== "string" || !UUID.test(videoId)) return fail("not_found");

    let record: VideoRecord | null;
    try {
      record = await repository.findById(videoId);
    } catch {
      logger.warn("video.cancel.persistence_failed", { videoId, reason: "read" });
      return fail("cancel_failed", true);
    }
    if (!record) return fail("not_found");
    if (record.uploaderId !== actor.id && !isAdministrative(actor.role)) return fail("forbidden");
    if (record.status === "CANCELLED") return { ok: true, status: "CANCELLED", changed: false };
    if (record.status !== "UPLOAD_PENDING") return fail("not_cancellable");

    try {
      await mux.cancelDirectUpload(record.muxUploadId);
    } catch (error) {
      if (isRetryableProviderError(error)) {
        logger.warn("video.cancel.provider_failed", { videoId, ...providerFields(error) });
        return fail("cancel_failed", true);
      }
      // The provider refused: find out why from its own record of the upload.
      let upload: MuxDirectUpload;
      try {
        upload = await mux.getDirectUpload(record.muxUploadId);
      } catch (readError) {
        logger.warn("video.cancel.provider_failed", { videoId, ...providerFields(readError) });
        return fail("cancel_failed", isRetryableProviderError(readError));
      }
      if (upload.status === "asset_created") return fail("not_cancellable");
      if (upload.status === "waiting" || upload.status === "unknown") {
        logger.warn("video.cancel.provider_failed", { videoId, ...providerFields(error) });
        return fail("cancel_failed");
      }
      // cancelled, errored, or timed out: nothing can be uploaded any more.
    }

    try {
      const updated = await repository.updateIfStatus(videoId, "UPLOAD_PENDING", { status: "CANCELLED" }, now());
      if (updated) return { ok: true, status: "CANCELLED", changed: true };
      const current = await repository.findById(videoId);
      if (current?.status === "CANCELLED") return { ok: true, status: "CANCELLED", changed: false };
      return current ? fail("not_cancellable") : fail("not_found");
    } catch {
      // The provider upload is cancelled; its webhook will record the state.
      logger.warn("video.cancel.persistence_failed", { videoId, reason: "update" });
      return fail("cancel_failed", true);
    }
  }

  // ---------------------------------------------------------------- webhook

  async function handleMuxWebhook(input: WebhookInput): Promise<WebhookResult> {
    const size = typeof input.rawBody === "string" ? Buffer.byteLength(input.rawBody) : input.rawBody.length;
    if (size > MAX_WEBHOOK_BODY_BYTES) return { status: 413, outcome: "too_large" };

    const verification = verifyMuxWebhookSignature({
      header: input.signatureHeader,
      rawBody: input.rawBody,
      secret: config.webhookSecret,
      nowMs: now().getTime(),
    });
    if (!verification.ok) {
      logger.warn("video.webhook.rejected", { reason: verification.reason });
      return { status: 401, outcome: "invalid_signature" };
    }

    // Signed, so from the provider. Only the type and identifiers are used;
    // every state is re-read from the provider below.
    let event: z.infer<typeof webhookEventSchema>;
    try {
      const raw = typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8");
      const parsed = webhookEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return ignored("malformed_event");
      event = parsed.data;
    } catch {
      // A redelivery of the same bytes cannot parse either.
      return ignored("malformed_event");
    }

    try {
      let record: VideoRecord | null = null;
      if (event.type.startsWith("video.upload.")) {
        record = await repository.findByMuxUploadId(event.data.id);
      } else if (event.type.startsWith("video.asset.")) {
        record = await repository.findByMuxAssetId(event.data.id);
        // The asset event may arrive before the upload's own event.
        if (!record && event.data.upload_id) record = await repository.findByMuxUploadId(event.data.upload_id);
      } else {
        return { status: 200, outcome: "ignored" };
      }
      if (!record) return ignored("unknown_video");
      return await reconcile(record);
    } catch (error) {
      if (error instanceof RetryableError) {
        logger.warn("video.webhook.retry", { reason: error.reason });
      } else {
        logger.warn("video.webhook.retry", { reason: "persistence", ...providerFields(error) });
      }
      return { status: 503, outcome: "retry" };
    }
  }

  function ignored(reason: string): WebhookResult {
    logger.warn("video.webhook.ignored", { reason });
    return { status: 200, outcome: "ignored" };
  }

  /** A provider read: retryable failures propagate, a missing resource becomes `null`. */
  async function providerRead<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof VideoProviderError && (error.code === "not_found" || error.code === "invalid_request")) return null;
      throw new RetryableError(error instanceof VideoProviderError ? `provider_${error.code}` : "provider_unexpected");
    }
  }

  /**
   * Brings the record in line with the provider's current state. Event order
   * and repetition do not matter: every delivery reads the same authoritative
   * state and applies only forward transitions.
   */
  async function reconcile(initial: VideoRecord): Promise<WebhookResult> {
    let record = initial;
    if (record.status === "DELETING" || record.status === "DELETE_FAILED") return { status: 200, outcome: "unchanged" };

    const upload = await providerRead(() => mux.getDirectUpload(record.muxUploadId));
    if (!upload) return ignored("upload_not_found");
    if (upload.id !== record.muxUploadId) return ignored("upload_mismatch");
    if (record.muxAssetId && upload.assetId && record.muxAssetId !== upload.assetId) {
      logger.warn("video.webhook.ownership_mismatch", { videoId: record.id, reason: "asset_changed" });
      return { status: 200, outcome: "ignored" };
    }

    const assetId = upload.assetId ?? record.muxAssetId;
    let asset: MuxAsset | null = null;
    if (assetId) {
      asset = await providerRead(() => mux.getAsset(assetId));
      if (asset && (asset.id !== assetId || asset.passthrough !== record.id || asset.uploadId !== record.muxUploadId)) {
        logger.warn("video.webhook.ownership_mismatch", { videoId: record.id, reason: "asset_not_owned" });
        return { status: 200, outcome: "ignored" };
      }
    }

    if (record.status === "CANCELLED") {
      if (asset) await removeOrphanAsset(record, asset.id);
      return { status: 200, outcome: "unchanged" };
    }

    let changed = false;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const target = asset ? targetFromAsset(asset) : targetFromUpload(upload);
      if (!target) return { status: 200, outcome: changed ? "updated" : "unchanged" };
      // UPLOAD_PENDING reaches READY only through PROCESSING.
      const next: { status: VideoStatus; patch: VideoPatch } =
        record.status === "UPLOAD_PENDING" && target.status === "READY"
          ? { status: "PROCESSING", patch: { status: "PROCESSING", muxAssetId: target.patch.muxAssetId } }
          : target;
      const decision = transitionDecision(record.status, next.status);
      if (decision !== "apply") {
        if (decision === "reject" && next.status === "READY") logger.warn("video.webhook.transition_refused", { videoId: record.id, reason: record.status });
        return { status: 200, outcome: changed ? "updated" : "unchanged" };
      }
      const from = record.status;
      const updated = await repository.updateIfStatus(record.id, from, next.patch, now());
      if (updated) {
        changed = true;
        record = updated;
        await notifyTransition(from, record);
        if (record.status === target.status) return { status: 200, outcome: "updated" };
        attempt -= 1; // an intermediate step is not a conflict
        continue;
      }
      // Lost a race: re-read and decide again.
      const current = await repository.findById(record.id);
      if (!current) return ignored("video_removed");
      record = current;
      if (record.status === "CANCELLED" || record.status === "DELETING" || record.status === "DELETE_FAILED") {
        return { status: 200, outcome: changed ? "updated" : "unchanged" };
      }
    }
    throw new RetryableError("conflict");
  }

  function targetFromAsset(asset: MuxAsset): Target {
    if (asset.status === "preparing") return { status: "PROCESSING", patch: { status: "PROCESSING", muxAssetId: asset.id } };
    if (asset.status === "errored") {
      return { status: "FAILED", patch: { status: "FAILED", muxAssetId: asset.id, failureCode: assetFailureCode(asset.errorType) } };
    }
    if (asset.status === "ready") {
      const playbackId = asset.signedPlaybackIds[0];
      if (!playbackId) {
        // Never publish an asset without signed playback.
        return { status: "FAILED", patch: { status: "FAILED", muxAssetId: asset.id, failureCode: "processing_failed" } };
      }
      return {
        status: "READY",
        patch: {
          status: "READY",
          muxAssetId: asset.id,
          playbackId,
          durationSeconds: asset.durationSeconds,
          width: asset.width,
          height: asset.height,
          maxResolution: asset.maxResolution,
        },
      };
    }
    return null;
  }

  function targetFromUpload(upload: MuxDirectUpload): Target {
    if (upload.status === "cancelled") return { status: "CANCELLED", patch: { status: "CANCELLED" } };
    if (upload.status === "errored") return { status: "FAILED", patch: { status: "FAILED", failureCode: "upload_failed" } };
    if (upload.status === "timed_out") return { status: "FAILED", patch: { status: "FAILED", failureCode: "upload_expired" } };
    return null;
  }

  /** An asset created for an upload the user cancelled is deleted at the provider; it can never be shown. */
  async function removeOrphanAsset(record: VideoRecord, assetId: string): Promise<void> {
    try {
      await mux.deleteAsset(assetId);
    } catch (error) {
      if (error instanceof VideoProviderError && error.code === "not_found") return;
      throw new RetryableError(error instanceof VideoProviderError ? `provider_${error.code}` : "provider_unexpected");
    }
    logger.warn("video.webhook.orphan_asset_deleted", { videoId: record.id });
  }

  // ---------------------------------------------------------------- playback

  async function issuePlaybackToken(videoId: string, viewer: PlaybackViewer): Promise<PlaybackResult> {
    const fail = (error: Extract<PlaybackResult, { ok: false }>["error"], retryable = false) => ({ ok: false, error, retryable }) as const;
    const isAdmin = viewer?.kind === "admin";
    if (isAdmin && !isActor(viewer.actor)) return fail("forbidden");
    if (!isAdmin && (viewer?.kind !== "public" || typeof viewer.projectId !== "string" || viewer.projectId === "")) return fail("not_found");
    if (typeof videoId !== "string" || !UUID.test(videoId)) return fail("not_found");

    let record: VideoRecord | null;
    try {
      record = await repository.findById(videoId);
      if (record && !isAdmin) {
        // Public viewers learn nothing beyond "not found" for any ineligible video.
        const projectId = viewer.projectId;
        const assignments = await repository.listProjectAssignments(videoId);
        if (!assignments.some((assignment) => assignment.projectId === projectId && isPublicProject(assignment))) return fail("not_found");
      }
    } catch {
      logger.warn("video.playback.persistence_failed", { reason: "read" });
      return fail("playback_unavailable", true);
    }
    if (!record) return fail("not_found");
    if (record.status !== "READY" || !record.playbackId) return isAdmin ? fail("not_ready") : fail("not_found");

    const issuedAt = now().getTime();
    const ttl = limits.playbackTokenTtlSeconds;
    try {
      const token = signPlaybackToken({
        playbackId: record.playbackId,
        keyId: config.signingKeyId,
        privateKey: config.signingPrivateKey,
        audience: "v",
        ttlSeconds: ttl,
        nowMs: issuedAt,
      });
      return { ok: true, url: signedPlaybackUrl(record.playbackId, token), expiresAt: new Date((Math.floor(issuedAt / 1000) + ttl) * 1000) };
    } catch {
      logger.warn("video.playback.signing_failed", { videoId });
      return fail("playback_unavailable");
    }
  }

  return { createUploadSession, cancelUploadSession, handleMuxWebhook, issuePlaybackToken };
}
