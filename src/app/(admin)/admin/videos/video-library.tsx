"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { buttonClass, inputClass } from "@/components/admin/admin-styles";
import { HlsPlayer, type HlsConstructor } from "@/components/video/hls-player";
import { formatBytes } from "@/lib/media";
import {
  formatVideoDuration,
  formatVideoResolution,
  isVideoInFlight,
  videoDeleteConfirmation,
  videoRowActions,
  videoStatusDetail,
  videoStatusLabel,
  type AdminVideoView,
} from "@/lib/video-library";
import { videoErrorMessage } from "@/lib/video-messages";
import {
  VIDEO_ACCEPT,
  VIDEO_MAX_DECLARED_BYTES,
  cancelEndpoint,
  startVideoUpload,
  type CreateChunkUpload,
  type VideoUploadHandle,
  type VideoUploadStage,
} from "@/lib/video-upload";

/**
 * The admin video library (P3-11D). Every action goes through the video API
 * routes, which repeat the role, origin, and eligibility checks; the controls
 * here only avoid offering what the server would refuse.
 */

const loadUpChunk = async (): Promise<CreateChunkUpload> => {
  const { createUpload } = await import("@mux/upchunk");
  return (options) => createUpload(options);
};

export type VideoLibraryDeps = {
  fetchImpl?: typeof fetch;
  confirm?: (message: string) => boolean;
  loadChunkUploader?: () => Promise<CreateChunkUpload>;
  loadHls?: () => Promise<HlsConstructor>;
  /** How often to refresh while a video is uploading, processing, or deleting. */
  pollMs?: number;
};

type Notice = { tone: "status" | "alert"; message: string };

export type VideoLibraryProps = {
  videos: AdminVideoView[];
  uploadOrigin: string | null;
  uploadsUnavailableMessage: string | null;
  deps?: VideoLibraryDeps;
};

export const DEFAULT_POLL_MS = 5_000;

export function VideoLibrary({ videos, uploadOrigin, uploadsUnavailableMessage, deps = {} }: VideoLibraryProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const shouldPoll = uploading || videos.some((video) => isVideoInFlight(video.status));

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") router.refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [shouldPoll, pollMs, router]);

  return (
    <div className="grid gap-10">
      {uploadOrigin ? (
        <VideoUploadForm uploadOrigin={uploadOrigin} deps={deps} onActiveChange={setUploading} onFinished={() => router.refresh()} />
      ) : (
        <section className="border border-border bg-surface p-6" aria-labelledby="video-upload-heading">
          <h2 id="video-upload-heading" className="font-display text-2xl">
            Upload video
          </h2>
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            {uploadsUnavailableMessage ?? videoErrorMessage("not_configured")}
          </p>
        </section>
      )}
      <section aria-labelledby="video-library-heading" data-video-library>
        <h2 id="video-library-heading" className="mb-4 font-display text-2xl">
          Videos ({videos.length})
        </h2>
        {videos.length === 0 ? (
          <p className="border border-dashed border-border p-8 text-center text-muted-foreground">No videos uploaded yet.</p>
        ) : (
          <ul className="grid gap-5 lg:grid-cols-2">
            {videos.map((video) => (
              <VideoRow key={video.id} video={video} deps={deps} onChanged={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ upload

function VideoUploadForm({
  uploadOrigin,
  deps,
  onActiveChange,
  onFinished,
}: {
  uploadOrigin: string;
  deps: VideoLibraryDeps;
  onActiveChange: (active: boolean) => void;
  onFinished: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const handleRef = useRef<VideoUploadHandle | null>(null);
  const [stage, setStage] = useState<VideoUploadStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const active = stage !== null;

  useEffect(() => () => handleRef.current?.cancel(), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    const title = String(data.get("title") ?? "");
    if (!(file instanceof File) || file.size === 0) {
      setNotice({ tone: "alert", message: "Choose a video file to upload." });
      return;
    }
    setNotice(null);
    setProgress(0);
    setStage("starting");
    onActiveChange(true);
    let createChunkUpload: CreateChunkUpload;
    try {
      createChunkUpload = await (deps.loadChunkUploader ?? loadUpChunk)();
    } catch {
      setNotice({ tone: "alert", message: videoErrorMessage("upload_failed") });
      setStage(null);
      onActiveChange(false);
      return;
    }
    const handle = startVideoUpload({
      file,
      title,
      uploadOrigin,
      createChunkUpload,
      fetchImpl: deps.fetchImpl,
      onProgress: setProgress,
      onStage: setStage,
    });
    handleRef.current = handle;
    const outcome = await handle.result;
    handleRef.current = null;
    setStage(null);
    onActiveChange(false);
    if (outcome.ok) {
      formRef.current?.reset();
      setNotice({ tone: "status", message: "Upload complete. Mux is processing the video; its status updates below." });
    } else {
      setNotice({ tone: outcome.cancelled ? "status" : "alert", message: outcome.message });
    }
    onFinished();
  }

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-5 border border-border bg-surface p-6" aria-labelledby="video-upload-heading">
      <div>
        <h2 id="video-upload-heading" className="font-display text-2xl">
          Upload video
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          MP4, MOV, M4V, MKV, or WebM, up to {formatBytes(VIDEO_MAX_DECLARED_BYTES)}. The file goes straight to Mux in
          resumable parts; keep this page open until the upload finishes.
        </p>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Title
        <input required name="title" maxLength={160} disabled={active} className={inputClass} />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Video file
        <input required name="file" type="file" accept={VIDEO_ACCEPT} disabled={active} className="min-h-12 border border-border bg-background p-3" />
      </label>
      {active ? (
        <div className="grid gap-2">
          <progress className="h-2 w-full" max={100} value={progress} aria-label="Upload progress">
            {progress}%
          </progress>
          <p className="text-sm" aria-live="polite">
            {stage === "starting" ? "Preparing upload…" : stage === "cancelling" ? "Cancelling…" : `Uploading… ${Math.floor(progress)}%`}
          </p>
          <button type="button" className={buttonClass} disabled={stage === "cancelling"} onClick={() => handleRef.current?.cancel()}>
            Cancel upload
          </button>
        </div>
      ) : (
        <button className="min-h-12 bg-accent px-5 text-sm font-semibold text-accent-foreground">Upload video</button>
      )}
      <p role={notice?.tone ?? "status"} aria-live={notice?.tone === "alert" ? undefined : "polite"} className="min-h-5 text-sm">
        {notice?.message ?? ""}
      </p>
    </form>
  );
}

// ------------------------------------------------------------------ row

async function messageFrom(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0 && body.message.length <= 300) return body.message;
  } catch {
    // Not JSON.
  }
  return fallback;
}

function VideoRow({ video, deps, onChanged }: { video: AdminVideoView; deps: VideoLibraryDeps; onChanged: () => void }) {
  const [busy, setBusy] = useState<"delete" | "cancel" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const actions = videoRowActions(video);
  const detail = videoStatusDetail(video);
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function remove() {
    const confirmed = (deps.confirm ?? ((message: string) => window.confirm(message)))(videoDeleteConfirmation(video.title));
    if (!confirmed) return;
    setBusy("delete");
    setNotice(null);
    try {
      const response = await fetchImpl(`/api/videos/${encodeURIComponent(video.id)}`, { method: "DELETE", credentials: "same-origin" });
      if (response.ok) {
        setNotice({ tone: "status", message: "Video deleted." });
      } else {
        setNotice({ tone: "alert", message: await messageFrom(response, videoErrorMessage("delete_failed")) });
      }
    } catch {
      setNotice({ tone: "alert", message: videoErrorMessage("delete_failed") });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function cancel() {
    setBusy("cancel");
    setNotice(null);
    try {
      const response = await fetchImpl(cancelEndpoint(video.id), { method: "POST", credentials: "same-origin" });
      setNotice(
        response.ok
          ? { tone: "status", message: videoErrorMessage("upload_cancelled") }
          : { tone: "alert", message: await messageFrom(response, "The upload could not be cancelled. Try again in a moment.") },
      );
    } catch {
      setNotice({ tone: "alert", message: "The upload could not be cancelled. Try again in a moment." });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  return (
    <li className="grid gap-3 border border-border bg-surface p-4 text-sm" data-video-row={video.id} data-status={video.status}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium" title={video.originalFilename}>
          {video.title}
        </p>
        <span className="border border-border px-2 py-0.5 text-xs tracking-wider uppercase" data-video-status>
          {videoStatusLabel(video.status)}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Duration</dt>
        <dd>{formatVideoDuration(video.durationSeconds)}</dd>
        <dt>Resolution</dt>
        <dd>{formatVideoResolution(video)}</dd>
        <dt>File</dt>
        <dd className="truncate">{video.originalFilename}</dd>
        <dt>Projects</dt>
        <dd>{video.assignmentCount}</dd>
      </dl>
      {detail ? (
        <p className={video.status === "FAILED" || video.status === "DELETE_FAILED" ? "text-foreground" : "text-muted-foreground"}>{detail}</p>
      ) : null}
      {actions.preview ? (
        previewing ? (
          <HlsPlayer videoId={video.id} title={video.title} fetchImpl={deps.fetchImpl} loadHls={deps.loadHls} />
        ) : (
          <button type="button" className={buttonClass} onClick={() => setPreviewing(true)}>
            Preview
            <span className="sr-only">: {video.title}</span>
          </button>
        )
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actions.cancel ? (
          <button type="button" className={buttonClass} disabled={busy !== null} onClick={cancel}>
            {busy === "cancel" ? "Cancelling…" : "Cancel upload"}
            <span className="sr-only">: {video.title}</span>
          </button>
        ) : null}
        {actions.delete ? (
          <button type="button" className={buttonClass} disabled={busy !== null} onClick={remove}>
            {busy === "delete" ? "Deleting…" : actions.delete === "retry" ? "Retry delete" : "Delete"}
            <span className="sr-only">: {video.title}</span>
          </button>
        ) : null}
      </div>
      {actions.deleteBlockedMessage ? <p className="text-muted-foreground">{actions.deleteBlockedMessage}</p> : null}
      <p role={notice?.tone ?? "status"} aria-live={notice?.tone === "alert" ? undefined : "polite"} className="min-h-5">
        {notice?.message ?? ""}
      </p>
    </li>
  );
}
