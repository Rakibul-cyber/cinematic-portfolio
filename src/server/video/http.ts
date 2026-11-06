import "server-only";

import { videoErrorMessage } from "@/lib/video-messages";
import { AuditAction, AuditEntityType, type AuditLogInput } from "@/server/audit/audit-log";
import { isAdministrative, type AdminRole } from "@/server/auth/roles";
import { rateLimitClientKey } from "@/server/security/client-ip";
import type { VideoRateLimitDecision, VideoRateLimitName } from "@/server/video/rate-limit";
import type { VideoRuntime } from "@/server/video/runtime";
import { MAX_WEBHOOK_BODY_BYTES } from "@/server/video/service";

/**
 * Request handling for the video API routes (P3-11C). The route files only
 * wire these to real dependencies, so every rule here is tested with fakes.
 *
 * Order of checks for state-changing admin requests: origin (CSRF), session,
 * role, provider configuration, rate limit, body, then the service. Nothing
 * reaches the provider or the database until every earlier check passed.
 *
 * Every response is `private, no-store`: upload URLs and playback tokens are
 * credentials and must never be cached by a browser, a CDN, or Netlify.
 * Error bodies carry a code and a plain message, never provider or database
 * text.
 */

export type VideoRouteUser = { id: string; email: string; role: AdminRole };

export type VideoRouteDependencies = {
  getUser: () => Promise<VideoRouteUser | null>;
  /** The configured video runtime, or null when video is not configured (fail closed). */
  runtime: () => VideoRuntime | null;
  rateLimit: (name: VideoRateLimitName, rawKey: string) => Promise<VideoRateLimitDecision>;
  audit: (input: AuditLogInput) => Promise<void>;
};

export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

/** Upper bound for the JSON body of an upload request: title, file name, and size. */
export const MAX_UPLOAD_REQUEST_BYTES = 4 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROUTE_MESSAGES = {
  unauthenticated: "Sign in to continue.",
  forbidden: "You do not have permission to do this.",
  origin_not_allowed: "This request was not sent from the studio admin.",
  invalid_request: "The request could not be read.",
  unsupported_media_type: "Send the request as JSON.",
  request_too_large: "The request is too large.",
  not_found: "Video not found.",
  not_cancellable: "This upload can no longer be cancelled.",
  not_ready: "This video is still processing.",
  unavailable: "Video is temporarily unavailable. Try again in a moment.",
} as const;

type ErrorCode = keyof typeof ROUTE_MESSAGES | Parameters<typeof videoErrorMessage>[0];

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...NO_STORE_HEADERS, "Content-Type": "application/json; charset=utf-8" } });
}

function error(code: ErrorCode, status: number): Response {
  const message = typeof code === "string" && code in ROUTE_MESSAGES ? ROUTE_MESSAGES[code as keyof typeof ROUTE_MESSAGES] : videoErrorMessage(code);
  return json({ error: code, message }, status);
}

/**
 * Same-origin check for state-changing browser requests. The `Origin` header
 * must be present and equal the application origin exactly; a browser always
 * sends it on cross-origin and same-origin POSTs, and a page cannot forge it.
 */
export function isAllowedOrigin(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin !== expectedOrigin) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

type AdminGate = { ok: true; user: VideoRouteUser; runtime: VideoRuntime } | { ok: false; response: Response };

/** Origin, session, ADMIN/SUPER_ADMIN role, configuration, and rate limit, in that order. */
async function adminWriteGate(request: Request, deps: VideoRouteDependencies, limit: VideoRateLimitName): Promise<AdminGate> {
  const runtime = deps.runtime();
  // Without configuration there is no trusted origin to compare against either.
  if (!runtime) {
    const user = await deps.getUser();
    if (!user) return { ok: false, response: error("unauthenticated", 401) };
    return { ok: false, response: error("not_configured", 503) };
  }
  if (!isAllowedOrigin(request, runtime.adminOrigin)) return { ok: false, response: error("origin_not_allowed", 403) };
  const user = await deps.getUser();
  if (!user) return { ok: false, response: error("unauthenticated", 401) };
  if (!isAdministrative(user.role)) return { ok: false, response: error("forbidden", 403) };
  const decision = await deps.rateLimit(limit, `user:${user.id}`);
  if (decision === "limited") return { ok: false, response: error("rate_limited", 429) };
  if (decision === "unavailable") return { ok: false, response: error("unavailable", 503) };
  return { ok: true, user, runtime };
}

async function readJsonBody(request: Request, maxBytes: number): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType)) return { ok: false, response: error("unsupported_media_type", 415) };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: error("request_too_large", 413) };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: error("invalid_request", 400) };
  }
  if (Buffer.byteLength(text) > maxBytes) return { ok: false, response: error("request_too_large", 413) };
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, response: error("invalid_request", 400) };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, response: error("invalid_request", 400) };
  }
}

const extensionOf = (filename: string) => filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();

// ------------------------------------------------------------------ POST /api/videos/uploads

export async function handleCreateUpload(request: Request, deps: VideoRouteDependencies): Promise<Response> {
  const gate = await adminWriteGate(request, deps, "upload");
  if (!gate.ok) return gate.response;
  const body = await readJsonBody(request, MAX_UPLOAD_REQUEST_BYTES);
  if (!body.ok) return body.response;

  const { user, runtime } = gate;
  const result = await runtime.service.createUploadSession(
    { id: user.id, role: user.role },
    // The size is the browser's declaration: it refuses obviously oversized
    // files early, but it is not proof of the bytes the provider receives.
    { title: body.value.title, filename: body.value.filename, fileSizeBytes: body.value.fileSizeBytes },
  );
  if (!result.ok) {
    switch (result.error) {
      case "forbidden":
        return error("forbidden", 403);
      case "file_too_large":
        return error("file_too_large", 413);
      case "too_many_uploads":
        return error("too_many_uploads", 409);
      case "upload_failed":
        return error("upload_failed", result.retryable ? 503 : 502);
      default:
        return error(result.error, 400);
    }
  }

  await deps.audit({
    action: AuditAction.VideoUploadStarted,
    entityType: AuditEntityType.Video,
    entityId: result.videoId,
    actorUserId: user.id,
    actorEmail: user.email,
    metadata: { declaredSizeBytes: Number(body.value.fileSizeBytes), extension: extensionOf(String(body.value.filename)) },
  });
  return json({ videoId: result.videoId, uploadUrl: result.uploadUrl, expiresAt: result.expiresAt.toISOString() }, 201);
}

// ------------------------------------------------------------------ POST /api/videos/uploads/[id]/cancel

export async function handleCancelUpload(request: Request, videoId: string, deps: VideoRouteDependencies): Promise<Response> {
  const gate = await adminWriteGate(request, deps, "cancel");
  if (!gate.ok) return gate.response;
  if (!UUID.test(videoId)) return error("not_found", 404);

  const { user, runtime } = gate;
  const result = await runtime.service.cancelUploadSession({ id: user.id, role: user.role }, videoId);
  if (!result.ok) {
    switch (result.error) {
      case "forbidden":
        return error("forbidden", 403);
      case "not_found":
        return error("not_found", 404);
      case "not_cancellable":
        return error("not_cancellable", 409);
      default:
        return error("unavailable", result.retryable ? 503 : 502);
    }
  }
  if (result.changed) {
    await deps.audit({
      action: AuditAction.VideoUploadCancelled,
      entityType: AuditEntityType.Video,
      entityId: videoId,
      actorUserId: user.id,
      actorEmail: user.email,
      metadata: { source: "admin" },
    });
  }
  return json({ status: result.status }, 200);
}

// ------------------------------------------------------------------ DELETE /api/videos/[id]

/**
 * Permanent deletion (P3-11D): same gate as uploads (origin, session,
 * ADMIN/SUPER_ADMIN, configuration, rate limit). Refusals carry the reason
 * code so the library can explain them; a provider or database failure leaves
 * the video DELETE_FAILED and answers 502/503 so the admin can retry.
 */
export async function handleDeleteVideo(request: Request, videoId: string, deps: VideoRouteDependencies): Promise<Response> {
  const gate = await adminWriteGate(request, deps, "delete");
  if (!gate.ok) return gate.response;
  if (!UUID.test(videoId)) return error("not_found", 404);

  const { user, runtime } = gate;
  const result = await runtime.service.deleteVideo({ id: user.id, role: user.role }, videoId);
  const auditBase = { entityType: AuditEntityType.Video, entityId: videoId, actorUserId: user.id, actorEmail: user.email };
  if (!result.ok) {
    switch (result.error) {
      case "forbidden":
        return error("forbidden", 403);
      case "not_found":
        return error("not_found", 404);
      case "delete_assigned":
      case "delete_upload_in_progress":
      case "delete_in_progress":
        return error(result.error, 409);
      default:
        await deps.audit({ ...auditBase, action: AuditAction.VideoDeleteFailed, metadata: { retryable: result.retryable } });
        return error("delete_failed", result.retryable ? 503 : 502);
    }
  }
  await deps.audit({ ...auditBase, action: AuditAction.VideoDeleted, metadata: { source: "admin" } });
  return json({ deleted: true }, 200);
}

// ------------------------------------------------------------------ POST /api/webhooks/mux

export async function handleMuxWebhookRequest(request: Request, deps: Pick<VideoRouteDependencies, "runtime">): Promise<Response> {
  const runtime = deps.runtime();
  // 503 makes the provider redeliver once video is configured again.
  if (!runtime) return json({ ok: false }, 503);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) return json({ ok: false }, 413);
  let rawBody: Buffer;
  try {
    // The exact bytes received: the signature covers them, not a re-serialization.
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return json({ ok: false }, 400);
  }
  const result = await runtime.service.handleMuxWebhook({ rawBody, signatureHeader: request.headers.get("mux-signature") });
  return json({ ok: result.status === 200 }, result.status);
}

// ------------------------------------------------------------------ GET /api/videos/[id]/playback

/**
 * With `?projectId=` the request is public: the video must be READY and
 * assigned to that project, which must be PUBLISHED in an active category.
 * A session does not widen public access. Every public refusal is the same 404.
 *
 * Without `projectId` it is an admin preview and needs an ADMIN or
 * SUPER_ADMIN session.
 */
export async function handlePlayback(request: Request, videoId: string, deps: VideoRouteDependencies): Promise<Response> {
  const runtime = deps.runtime();
  const projectId = new URL(request.url).searchParams.get("projectId");

  if (projectId !== null) {
    if (!runtime) return error("unavailable", 503);
    if (!UUID.test(videoId) || !UUID.test(projectId)) return error("not_found", 404);
    const decision = await deps.rateLimit("playbackPublic", rateLimitClientKey(request.headers));
    if (decision === "limited") return error("rate_limited", 429);
    if (decision === "unavailable") return error("unavailable", 503);
    const result = await runtime.service.issuePlaybackToken(videoId, { kind: "public", projectId });
    if (!result.ok) return result.error === "playback_unavailable" ? error("unavailable", 503) : error("not_found", 404);
    return json({ url: result.url, expiresAt: result.expiresAt.toISOString() }, 200);
  }

  const user = await deps.getUser();
  if (!user) return error("unauthenticated", 401);
  // Preview belongs to the video library, which is ADMIN/SUPER_ADMIN only (P3-11D).
  if (!isAdministrative(user.role)) return error("forbidden", 403);
  if (!runtime) return error("not_configured", 503);
  if (!UUID.test(videoId)) return error("not_found", 404);
  const decision = await deps.rateLimit("playbackAdmin", `user:${user.id}`);
  if (decision === "limited") return error("rate_limited", 429);
  if (decision === "unavailable") return error("unavailable", 503);
  const result = await runtime.service.issuePlaybackToken(videoId, { kind: "admin", actor: { id: user.id, role: user.role } });
  if (!result.ok) {
    switch (result.error) {
      case "forbidden":
        return error("forbidden", 403);
      case "not_ready":
        return error("not_ready", 409);
      case "not_found":
        return error("not_found", 404);
      default:
        return error("unavailable", 503);
    }
  }
  return json({ url: result.url, expiresAt: result.expiresAt.toISOString() }, 200);
}
