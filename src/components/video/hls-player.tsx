"use client";

import { useEffect, useRef, useState } from "react";

import { VIDEO_PLAYLIST_ORIGIN } from "@/lib/video-csp";

/**
 * Click-to-load player for uploaded video (P3-11D).
 *
 * Nothing is requested until the viewer presses Play: no playback token, no
 * playlist, no player library. Then the short-lived signed URL is fetched from
 * our own route, which decides eligibility:
 *
 * - Admin preview: no `projectId`; the route requires an ADMIN or SUPER_ADMIN
 *   session.
 * - Public: `projectId` of the page's project; the route answers only for a
 *   READY video assigned to that project while it is PUBLISHED in an active
 *   category, so a draft video is never playable publicly.
 *
 * Safari plays HLS natively; other browsers load hls.js on demand, without a
 * Web Worker so the policy needs no `worker-src blob:`.
 */

export const HLS_MIME = "application/vnd.apple.mpegurl";

/** The parts of hls.js this component uses. */
export type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (event: string, data: { fatal?: boolean }) => void): void;
  destroy(): void;
};
export type HlsConstructor = {
  new (config: { enableWorker: boolean; lowLatencyMode: boolean }): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
};

const loadHlsJs = async (): Promise<HlsConstructor> => (await import("hls.js")).default as unknown as HlsConstructor;

export function playbackEndpoint(videoId: string, projectId?: string): string {
  const base = `/api/videos/${encodeURIComponent(videoId)}/playback`;
  return projectId ? `${base}?projectId=${encodeURIComponent(projectId)}` : base;
}

/** Only a signed HTTPS playlist on the expected playback origin is ever loaded. */
export function isPlaylistUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === VIDEO_PLAYLIST_ORIGIN && url.pathname.endsWith(".m3u8");
  } catch {
    return false;
  }
}

export function playbackFailureMessage(status: number): string {
  if (status === 401) return "Your session has ended. Sign in again to preview this video.";
  if (status === 403) return "You do not have permission to preview this video.";
  if (status === 404) return "This video is not available.";
  if (status === 409) return "This video is still processing.";
  if (status === 429) return "Too many playback requests. Wait a moment and try again.";
  return "The video could not be loaded. Try again in a moment.";
}

/** Starts playback after the user's click; autoplay refusals are left to the controls. */
function tryPlay(video: HTMLVideoElement): void {
  try {
    const started = video.play() as Promise<void> | undefined;
    if (started && typeof started.catch === "function") started.catch(() => undefined);
  } catch {
    // The controls remain available.
  }
}

type State = { phase: "idle" | "loading" } | { phase: "playing"; url: string } | { phase: "error"; message: string };

export type HlsPlayerProps = {
  videoId: string;
  title: string;
  projectId?: string;
  /** Replaceable in tests. */
  fetchImpl?: typeof fetch;
  loadHls?: () => Promise<HlsConstructor>;
};

export function HlsPlayer({ videoId, title, projectId, fetchImpl, loadHls = loadHlsJs }: HlsPlayerProps) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const videoRef = useRef<HTMLVideoElement>(null);

  async function play() {
    setState({ phase: "loading" });
    try {
      const response = await (fetchImpl ?? fetch)(playbackEndpoint(videoId, projectId), { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return setState({ phase: "error", message: playbackFailureMessage(response.status) });
      const body = (await response.json()) as { url?: unknown };
      if (!isPlaylistUrl(body.url)) return setState({ phase: "error", message: playbackFailureMessage(500) });
      setState({ phase: "playing", url: body.url });
    } catch {
      setState({ phase: "error", message: playbackFailureMessage(500) });
    }
  }

  const url = state.phase === "playing" ? state.url : null;
  useEffect(() => {
    const video = videoRef.current;
    if (!url || !video) return;
    let hls: HlsInstance | null = null;
    let stopped = false;
    const fail = (message: string) => {
      if (!stopped) setState({ phase: "error", message });
    };

    if (video.canPlayType(HLS_MIME)) {
      video.src = url;
      tryPlay(video);
    } else {
      loadHls()
        .then((Hls) => {
          if (stopped) return;
          if (!Hls.isSupported()) return fail("This browser cannot play this video.");
          hls = new Hls({ enableWorker: false, lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data?.fatal) {
              hls?.destroy();
              hls = null;
              fail(playbackFailureMessage(500));
            }
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          tryPlay(video);
        })
        .catch(() => fail(playbackFailureMessage(500)));
    }
    return () => {
      stopped = true;
      hls?.destroy();
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Nothing left to release.
      }
    };
  }, [url, loadHls]);

  return (
    <div className="grid gap-2" data-hls-player>
      {state.phase === "playing" ? (
        <video ref={videoRef} controls playsInline preload="none" className="aspect-video w-full bg-black" aria-label={`Video: ${title}`} />
      ) : (
        <button
          type="button"
          onClick={play}
          disabled={state.phase === "loading"}
          className="flex aspect-video w-full items-center justify-center border border-border bg-muted text-sm font-semibold tracking-wider uppercase hover:border-foreground disabled:opacity-60"
        >
          {state.phase === "loading" ? "Loading…" : "Play"}
          <span className="sr-only">: {title}</span>
        </button>
      )}
      <p role={state.phase === "error" ? "alert" : undefined} className="min-h-5 text-sm">
        {state.phase === "error" ? state.message : ""}
      </p>
    </div>
  );
}
