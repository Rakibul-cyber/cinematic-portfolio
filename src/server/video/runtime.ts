import "server-only";

import { AuditAction, AuditEntityType, type AuditLogInput } from "@/server/audit/audit-log";
import { parseVideoProviderConfig, type VideoProviderConfig } from "@/server/video/config";
import { createMuxClient, type MuxClient } from "@/server/video/mux-client";
import type { VideoRepository } from "@/server/video/repository";
import { createVideoService, type VideoLogger, type VideoService, type VideoTransitionEvent } from "@/server/video/service";

/**
 * Builds the video service from configuration, failing closed (P3-11C).
 *
 * Video is available only when all five `MUX_*` variables are valid and the
 * application origin (`BETTER_AUTH_URL`) is a usable origin. Anything less
 * yields `null`, and every video route then answers 503 without touching the
 * provider. Problems are logged by variable name only, once per process.
 */

export type VideoRuntime = { service: VideoService; adminOrigin: string };

export type VideoRuntimeDependencies = {
  repository: VideoRepository;
  audit: (input: AuditLogInput) => Promise<void>;
  logger: VideoLogger;
  /** Replaced in tests; defaults to the real fetch-based client. */
  createMux?: (config: VideoProviderConfig) => MuxClient;
};

/** The exact origin of an absolute http(s) URL with no credentials, or null. */
export function normalizeAppOrigin(input: string | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The audit entry for a provider-driven outcome. No provider text, no identifiers beyond our own. */
export function transitionAuditEntry(event: VideoTransitionEvent): AuditLogInput {
  const base = { entityType: AuditEntityType.Video, entityId: event.videoId, actorUserId: null, actorEmail: null };
  if (event.to === "READY") return { ...base, action: AuditAction.VideoReady, metadata: { from: event.from, source: "provider" } };
  if (event.to === "FAILED") {
    return { ...base, action: AuditAction.VideoProcessingFailed, metadata: { from: event.from, failureCode: event.failureCode, source: "provider" } };
  }
  return { ...base, action: AuditAction.VideoUploadCancelled, metadata: { from: event.from, source: "provider" } };
}

export function buildVideoRuntime(env: Record<string, string | undefined>, dependencies: VideoRuntimeDependencies): VideoRuntime | null {
  const result = parseVideoProviderConfig(env);
  if (result.status === "disabled") return null;
  if (result.status === "invalid") {
    dependencies.logger.warn("video.config.invalid", { reason: result.problems.join("; ") });
    return null;
  }
  const adminOrigin = normalizeAppOrigin(env.BETTER_AUTH_URL);
  if (!adminOrigin) {
    dependencies.logger.warn("video.config.invalid", { reason: "BETTER_AUTH_URL is not a valid origin" });
    return null;
  }
  const config = result.config;
  const mux = (dependencies.createMux ?? ((providerConfig) => createMuxClient({ config: providerConfig })))(config);
  const service = createVideoService({
    repository: dependencies.repository,
    mux,
    config,
    corsOrigin: adminOrigin,
    logger: dependencies.logger,
    onTransition: (event) => dependencies.audit(transitionAuditEntry(event)),
  });
  return { service, adminOrigin };
}
