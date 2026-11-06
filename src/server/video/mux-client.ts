import "server-only";

import { z } from "zod";

import { isValidProviderId } from "@/lib/video-status";
import type { VideoProviderConfig } from "@/server/video/config";
import { VideoProviderError, providerErrorCodeForStatus } from "@/server/video/errors";

/**
 * The Mux Video REST boundary: the only module that talks to the provider.
 *
 * Built on `fetch` (no SDK) and injected wherever it is used, so every caller
 * can be tested against a fake. Only the fields the application uses are
 * parsed; unknown fields are dropped and unknown status values are reported as
 * "unknown" rather than failing, because providers add states over time.
 *
 * Request settings follow the provider's public documentation: direct uploads
 * with `cors_origin`, `timeout` (60 s to 7 days), and `new_asset_settings` with
 * a signed `playback_policy`, `passthrough`, and `max_resolution_tier` ("2160p"
 * enables 4K renditions). Whether a given source file actually yields 2160p is
 * UNVERIFIED until the provider trial (MH-02D Task 5); `video_quality` is sent
 * only when a caller sets it.
 *
 * Safety: identifiers are validated before they enter a URL path; redirects are
 * refused so credentials are never forwarded; each call has a time budget; and
 * failures become a `VideoProviderError` carrying a code and status only.
 */

export const MUX_API_BASE_URL = "https://api.mux.com";
export const DEFAULT_REQUEST_TIMEOUT_MS = 4_000;
export const UPLOAD_TIMEOUT_SECONDS = { min: 60, max: 604_800 } as const;

export type MaxResolutionTier = "1080p" | "1440p" | "2160p";

export type MuxUploadStatus = "waiting" | "asset_created" | "errored" | "cancelled" | "timed_out" | "unknown";
export type MuxAssetStatus = "preparing" | "ready" | "errored" | "unknown";

export type MuxDirectUpload = {
  id: string;
  status: MuxUploadStatus;
  /** The signed upload URL. A bearer credential: never log or persist it. */
  url: string | null;
  assetId: string | null;
  timeoutSeconds: number | null;
};

export type MuxAsset = {
  id: string;
  status: MuxAssetStatus;
  uploadId: string | null;
  passthrough: string | null;
  durationSeconds: number | null;
  /** As reported by the provider (e.g. a resolution tier); stored for display only. */
  maxResolution: string | null;
  width: number | null;
  height: number | null;
  signedPlaybackIds: string[];
  /** The provider's error category, for mapping to a failure code; never shown verbatim. */
  errorType: string | null;
};

export type CreateDirectUploadInput = {
  /** The admin origin allowed to upload from the browser, e.g. "https://studio.example". */
  corsOrigin: string;
  /** Our own video id, echoed back on the asset to prove ownership. */
  passthrough: string;
  timeoutSeconds: number;
  maxResolutionTier?: MaxResolutionTier;
  videoQuality?: "basic" | "plus" | "premium";
};

export interface MuxClient {
  createDirectUpload(input: CreateDirectUploadInput): Promise<MuxDirectUpload>;
  getDirectUpload(uploadId: string): Promise<MuxDirectUpload>;
  cancelDirectUpload(uploadId: string): Promise<MuxDirectUpload>;
  getAsset(assetId: string): Promise<MuxAsset>;
  deleteAsset(assetId: string): Promise<void>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const UPLOAD_STATUSES = new Set<MuxUploadStatus>(["waiting", "asset_created", "errored", "cancelled", "timed_out"]);
const ASSET_STATUSES = new Set<MuxAssetStatus>(["preparing", "ready", "errored"]);

const providerId = z.string().refine(isValidProviderId);
const optionalString = z.string().max(256).nullish();

const uploadSchema = z.object({
  data: z.object({
    id: providerId,
    status: z.string().max(64),
    url: z.string().url().max(4096).nullish(),
    asset_id: providerId.nullish(),
    timeout: z.number().int().nonnegative().nullish(),
  }),
});

const assetSchema = z.object({
  data: z.object({
    id: providerId,
    status: z.string().max(64),
    upload_id: providerId.nullish(),
    passthrough: optionalString,
    duration: z.number().nonnegative().nullish(),
    max_resolution_tier: optionalString,
    resolution_tier: optionalString,
    max_stored_resolution: optionalString,
    playback_ids: z.array(z.object({ id: providerId, policy: z.string().max(32) })).nullish(),
    tracks: z.array(z.object({ type: z.string().max(32), max_width: z.number().int().positive().nullish(), max_height: z.number().int().positive().nullish() })).nullish(),
    errors: z.object({ type: optionalString }).nullish(),
  }),
});

function toUpload(parsed: z.infer<typeof uploadSchema>): MuxDirectUpload {
  const data = parsed.data;
  return {
    id: data.id,
    status: UPLOAD_STATUSES.has(data.status as MuxUploadStatus) ? (data.status as MuxUploadStatus) : "unknown",
    url: data.url ?? null,
    assetId: data.asset_id ?? null,
    timeoutSeconds: data.timeout ?? null,
  };
}

function toAsset(parsed: z.infer<typeof assetSchema>): MuxAsset {
  const data = parsed.data;
  const video = data.tracks?.find((track) => track.type === "video");
  return {
    id: data.id,
    status: ASSET_STATUSES.has(data.status as MuxAssetStatus) ? (data.status as MuxAssetStatus) : "unknown",
    uploadId: data.upload_id ?? null,
    passthrough: data.passthrough ?? null,
    durationSeconds: data.duration ?? null,
    maxResolution: data.resolution_tier ?? data.max_resolution_tier ?? data.max_stored_resolution ?? null,
    width: video?.max_width ?? null,
    height: video?.max_height ?? null,
    signedPlaybackIds: (data.playback_ids ?? []).filter((playback) => playback.policy === "signed").map((playback) => playback.id),
    errorType: data.errors?.type ?? null,
  };
}

/** The exact origin of a URL that is safe to hand to the provider as `cors_origin`. */
function corsOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new VideoProviderError("invalid_request");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new VideoProviderError("invalid_request");
  if (url.username || url.password || url.origin !== input.replace(/\/$/, "")) throw new VideoProviderError("invalid_request");
  return url.origin;
}

function requireId(id: string): string {
  if (!isValidProviderId(id)) throw new VideoProviderError("invalid_request");
  return id;
}

export type MuxClientOptions = {
  config: Pick<VideoProviderConfig, "tokenId" | "tokenSecret">;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
};

export function createMuxClient({ config, fetch: fetchImpl = globalThis.fetch, baseUrl = MUX_API_BASE_URL, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: MuxClientOptions): MuxClient {
  const authorization = `Basic ${Buffer.from(`${config.tokenId.reveal()}:${config.tokenSecret.reveal()}`).toString("base64")}`;

  async function request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, schema: z.ZodType<T> | null, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new VideoProviderError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network_error");
    }
    if (!response.ok) {
      // The body may echo request data; it is discarded unread.
      await response.body?.cancel().catch(() => undefined);
      throw new VideoProviderError(providerErrorCodeForStatus(response.status), response.status);
    }
    if (schema === null) {
      await response.body?.cancel().catch(() => undefined);
      return undefined as T;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new VideoProviderError("invalid_response", response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new VideoProviderError("invalid_response", response.status);
    return parsed.data;
  }

  return {
    async createDirectUpload(input) {
      if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < UPLOAD_TIMEOUT_SECONDS.min || input.timeoutSeconds > UPLOAD_TIMEOUT_SECONDS.max) {
        throw new VideoProviderError("invalid_request");
      }
      if (!/^[0-9a-f-]{36}$/i.test(input.passthrough)) throw new VideoProviderError("invalid_request");
      const upload = toUpload(
        await request("POST", "/video/v1/uploads", uploadSchema, {
          cors_origin: corsOrigin(input.corsOrigin),
          timeout: input.timeoutSeconds,
          new_asset_settings: {
            playback_policy: ["signed"],
            passthrough: input.passthrough,
            max_resolution_tier: input.maxResolutionTier ?? "2160p",
            ...(input.videoQuality ? { video_quality: input.videoQuality } : {}),
          },
        }),
      );
      if (!upload.url) throw new VideoProviderError("invalid_response");
      return upload;
    },
    async getDirectUpload(uploadId) {
      return toUpload(await request("GET", `/video/v1/uploads/${requireId(uploadId)}`, uploadSchema));
    },
    async cancelDirectUpload(uploadId) {
      return toUpload(await request("PUT", `/video/v1/uploads/${requireId(uploadId)}/cancel`, uploadSchema));
    },
    async getAsset(assetId) {
      return toAsset(await request("GET", `/video/v1/assets/${requireId(assetId)}`, assetSchema));
    },
    async deleteAsset(assetId) {
      await request("DELETE", `/video/v1/assets/${requireId(assetId)}`, null);
    },
  };
}
