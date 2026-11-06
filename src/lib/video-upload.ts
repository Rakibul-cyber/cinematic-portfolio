import { videoErrorMessage } from "@/lib/video-messages";
import { validateVideoTitle } from "@/lib/video-status";

/**
 * Browser side of a direct video upload (P3-11D), independent of React and of
 * UpChunk itself (injected), so every path is testable without a network.
 *
 * 1. Preliminary checks: title, extension, and the declared size (10 GiB).
 *    The size is what the browser reports; it is a courtesy check, not proof
 *    of the bytes the provider receives.
 * 2. `POST /api/videos/uploads` creates the provider upload and our record.
 * 3. The returned upload URL must be on the configured upload origin; any
 *    other origin is refused and the session is cancelled.
 * 4. The file goes to the provider in resumable chunks.
 *
 * The upload URL is a bearer credential: it is used for the transfer only and
 * never placed in a message, state that renders, or a log.
 */

export const VIDEO_ACCEPT = ".mp4,.mov,.m4v,.mkv,.webm,video/mp4,video/quicktime,video/x-m4v,video/x-matroska,video/webm";
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm"] as const;
/** 10 GiB, the server's declared-size limit (`DEFAULT_MAX_UPLOAD_BYTES`). */
export const VIDEO_MAX_DECLARED_BYTES = 10 * 1024 ** 3;
/** UpChunk chunk size in KiB; must be a multiple of 256 (Mux resumable uploads). 30 MiB. */
export const VIDEO_CHUNK_SIZE_KB = 30_720;

export const UPLOADS_ENDPOINT = "/api/videos/uploads";
export const cancelEndpoint = (videoId: string) => `/api/videos/uploads/${encodeURIComponent(videoId)}/cancel`;

/** The subset of an UpChunk upload this module uses. */
export type ChunkUpload = {
  on(event: "progress" | "success" | "error", listener: (event: { detail?: unknown }) => void): void;
  abort(): void;
};

export type CreateChunkUpload = (options: { endpoint: string; file: File; chunkSize: number }) => ChunkUpload;

export type VideoUploadStage = "starting" | "uploading" | "cancelling";

export type VideoUploadOutcome =
  | { ok: true; videoId: string }
  | { ok: false; cancelled: boolean; message: string };

export type VideoUploadOptions = {
  file: File;
  title: string;
  /** The only origin an upload URL may point to (`VIDEO_UPLOAD_ORIGIN`). */
  uploadOrigin: string;
  createChunkUpload: CreateChunkUpload;
  fetchImpl?: typeof fetch;
  onProgress?: (percent: number) => void;
  onStage?: (stage: VideoUploadStage) => void;
};

export type VideoUploadHandle = {
  result: Promise<VideoUploadOutcome>;
  /** Stops the transfer and cancels the provider upload. Safe to call more than once. */
  cancel(): void;
};

/** A preliminary check of the chosen file, before anything is sent. */
export function checkVideoFile(file: { name: string; size: number }, title: string): string | null {
  const titleResult = validateVideoTitle(title);
  if (!titleResult.ok) return videoErrorMessage(titleResult.error);
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!(VIDEO_EXTENSIONS as readonly string[]).includes(extension)) return videoErrorMessage("unsupported_file");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return videoErrorMessage("unsupported_file");
  if (file.size > VIDEO_MAX_DECLARED_BYTES) return videoErrorMessage("file_too_large");
  return null;
}

/** True when `url` is an https URL on exactly `origin`. */
export function isUploadUrlOnOrigin(url: unknown, origin: string): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.origin === origin;
  } catch {
    return false;
  }
}

const MAX_MESSAGE_LENGTH = 300;

/** Our own route's plain message, or a fixed fallback; never raw text of unknown shape. */
async function routeMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0 && body.message.length <= MAX_MESSAGE_LENGTH) return body.message;
  } catch {
    // A platform error page is not JSON.
  }
  return fallback;
}

export function startVideoUpload(options: VideoUploadOptions): VideoUploadHandle {
  const fetchImpl = options.fetchImpl ?? fetch;
  let cancelled = false;
  let videoId: string | null = null;
  let chunkUpload: ChunkUpload | null = null;
  let settle!: (outcome: VideoUploadOutcome) => void;
  let settled = false;
  const result = new Promise<VideoUploadOutcome>((resolve) => {
    settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
  });

  const post = (url: string, body?: unknown) =>
    fetchImpl(url, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Best effort: the server also expires abandoned uploads after their timeout. */
  async function cancelSession(id: string): Promise<boolean> {
    try {
      return (await post(cancelEndpoint(id))).ok;
    } catch {
      return false;
    }
  }

  const cancelledOutcome = (confirmed: boolean): VideoUploadOutcome => ({
    ok: false,
    cancelled: true,
    message: confirmed ? videoErrorMessage("upload_cancelled") : "The upload was stopped, but cancelling it could not be confirmed. It expires on its own.",
  });

  async function run(): Promise<void> {
    const problem = checkVideoFile(options.file, options.title);
    if (problem) return settle({ ok: false, cancelled: false, message: problem });

    options.onStage?.("starting");
    let response: Response;
    try {
      response = await post(UPLOADS_ENDPOINT, { title: options.title, filename: options.file.name, fileSizeBytes: options.file.size });
    } catch {
      return settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_failed") });
    }
    if (!response.ok) return settle({ ok: false, cancelled: false, message: await routeMessage(response, videoErrorMessage("upload_failed")) });

    let session: { videoId?: unknown; uploadUrl?: unknown };
    try {
      session = (await response.json()) as typeof session;
    } catch {
      return settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_failed") });
    }
    if (typeof session.videoId !== "string") return settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_failed") });
    videoId = session.videoId;

    if (cancelled) return settle(cancelledOutcome(await cancelSession(videoId)));
    if (!isUploadUrlOnOrigin(session.uploadUrl, options.uploadOrigin)) {
      await cancelSession(videoId);
      return settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_failed") });
    }

    options.onStage?.("uploading");
    options.onProgress?.(0);
    try {
      chunkUpload = options.createChunkUpload({ endpoint: session.uploadUrl as string, file: options.file, chunkSize: VIDEO_CHUNK_SIZE_KB });
    } catch {
      await cancelSession(videoId);
      return settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_failed") });
    }
    chunkUpload.on("progress", (event) => {
      const percent = typeof event.detail === "number" ? Math.max(0, Math.min(100, event.detail)) : null;
      if (percent !== null && !cancelled) options.onProgress?.(percent);
    });
    chunkUpload.on("success", () => {
      if (cancelled) return;
      options.onProgress?.(100);
      settle({ ok: true, videoId: videoId as string });
    });
    chunkUpload.on("error", () => {
      // UpChunk has already retried; its detail may hold provider text, which is never shown.
      if (cancelled) return;
      settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_interrupted") });
    });
  }

  run().catch(() => settle({ ok: false, cancelled: false, message: videoErrorMessage("upload_failed") }));

  return {
    result,
    cancel() {
      if (cancelled || settled) return;
      cancelled = true;
      options.onStage?.("cancelling");
      try {
        chunkUpload?.abort();
      } catch {
        // Already stopped.
      }
      // Before the session exists, `run` cancels it as soon as it arrives.
      if (videoId) void cancelSession(videoId).then((confirmed) => settle(cancelledOutcome(confirmed)));
    },
  };
}
