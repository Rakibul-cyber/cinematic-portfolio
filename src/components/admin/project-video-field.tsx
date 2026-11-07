"use client";

import { useState } from "react";

import { inputClass } from "@/components/admin/admin-styles";
import { VideoPlayer } from "@/components/public/video-player";
import { VIDEO_PROVIDER_LABELS } from "@/lib/video";
import { parseEmbeddableVideoUrl } from "@/lib/video-url";

/** What the field shows for a pasted link: nothing, the detected provider, or why it is refused. */
export function describeVideoUrl(input: string): { kind: "empty" } | { kind: "ok"; label: string } | { kind: "error"; message: string } {
  if (!input.trim()) return { kind: "empty" };
  const result = parseEmbeddableVideoUrl(input);
  return result.ok ? { kind: "ok", label: VIDEO_PROVIDER_LABELS[result.value.provider] } : { kind: "error", message: result.message };
}

/**
 * The project film: one pasted YouTube, Vimeo, or Google Drive link. The
 * provider is detected in the browser for feedback only; the server parses the
 * link again and stores just the provider and video ID.
 *
 * There is no title input. A title saved earlier is submitted unchanged while
 * the link stays the same; for a new or replaced link it is left empty, and
 * the public player names the film after the project title. The preview is
 * the public click-to-load player, so nothing is requested from the provider
 * until the editor presses play.
 */
export function ProjectVideoField({ initialUrl, savedTitle }: { initialUrl: string; savedTitle: string }) {
  const [url, setUrl] = useState(initialUrl);
  const status = describeVideoUrl(url);
  const preview = url.trim() ? parseEmbeddableVideoUrl(url) : null;
  const title = url.trim() === initialUrl.trim() ? savedTitle : "";

  return (
    <fieldset className="grid gap-3 border border-border p-4">
      <legend>Film</legend>
      <label>
        Video link
        <input
          aria-describedby="project-video-help project-video-status"
          aria-invalid={status.kind === "error" ? true : undefined}
          autoComplete="off"
          className={inputClass}
          inputMode="url"
          name="videoUrl"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a YouTube, Vimeo or Google Drive link"
          type="text"
          value={url}
        />
      </label>
      <p className="text-sm text-muted-foreground" id="project-video-help">
        Copy the link from YouTube (unlisted is fine), Vimeo, or Google Drive
        (shared as &ldquo;Anyone with the link&rdquo;) and paste it here. Leave
        it empty for no film. Visitors see the cover image until they press play.
      </p>
      <p
        aria-live="polite"
        className={status.kind === "error" ? "border border-accent p-3 text-sm" : "text-sm"}
        id="project-video-status"
      >
        {status.kind === "ok" ? `Detected: ${status.label}` : status.kind === "error" ? status.message : ""}
      </p>
      <input name="videoTitle" type="hidden" value={title} />
      {preview?.ok ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Preview</p>
          <VideoPlayer
            fallbackLabel="project film"
            key={`${preview.value.provider}:${preview.value.videoId}`}
            video={{ ...preview.value, title: title || null }}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
