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
 * The project film: one pasted YouTube, Vimeo, or Google Drive link and an
 * optional title. The provider is detected in the browser for feedback only;
 * the server parses the link again and stores just the provider and video ID.
 * The preview is the public click-to-load player, so nothing is requested from
 * the provider until the administrator presses play.
 */
export function ProjectVideoField({ initialUrl, initialTitle }: { initialUrl: string; initialTitle: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState(initialTitle);
  const status = describeVideoUrl(url);
  const preview = url.trim() ? parseEmbeddableVideoUrl(url) : null;

  return (
    <fieldset className="grid gap-3 border border-border p-4">
      <legend>Project film</legend>
      <p className="text-sm text-muted-foreground">
        Upload the film to YouTube (unlisted is fine), Vimeo, or Google Drive
        (shared as &ldquo;Anyone with the link&rdquo;), then paste its link here.
        Leave it empty for no film. The project&rsquo;s cover image is the
        thumbnail visitors see before they press play.
      </p>
      <label>
        Video link
        <input
          aria-describedby="project-video-status"
          autoComplete="off"
          className={inputClass}
          inputMode="url"
          name="videoUrl"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=… or https://drive.google.com/file/d/…/view"
          value={url}
        />
      </label>
      <p aria-live="polite" className="text-sm" id="project-video-status">
        {status.kind === "ok" ? `Detected: ${status.label}` : status.kind === "error" ? status.message : ""}
      </p>
      <label>
        Video title (optional)
        <input className={inputClass} maxLength={160} name="videoTitle" onChange={(event) => setTitle(event.target.value)} value={title} />
      </label>
      {preview?.ok ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Preview</p>
          <VideoPlayer
            fallbackLabel="project film"
            key={`${preview.value.provider}:${preview.value.videoId}`}
            video={{ ...preview.value, title: title.trim() || null }}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
