"use client";

import { useState } from "react";
import { Play } from "lucide-react";

import { cn } from "@/lib/utils";
import { videoEmbedUrl, videoLabel, type VideoRef } from "@/lib/video";

type VideoPlayerProps = {
  video: VideoRef;
  /** Used as the accessible name when the CMS records no video title. */
  fallbackLabel: string;
  className?: string;
};

/**
 * Privacy-conscious click-to-load video.
 *
 * Nothing is requested from the video provider until the visitor activates the
 * player: no iframe, no thumbnail, no script, no cookie. Until then this is a
 * plain button over a local dark panel — deliberately not the provider's own
 * poster image, since fetching that would already contact the provider and
 * leak the visitor's IP address and referrer.
 *
 * After activation the embed URL comes from `videoEmbedUrl`, which builds a
 * `youtube-nocookie.com` (or do-not-track Vimeo) URL from a stored provider
 * and identifier. No markup or URL ever comes from content.
 *
 * The trigger is a real `<button>`, so keyboard activation, focus order, and
 * the visible focus ring all work without extra handling.
 */
export function VideoPlayer({
  className,
  fallbackLabel,
  video,
}: VideoPlayerProps) {
  const [isActivated, setIsActivated] = useState(false);
  const embedUrl = videoEmbedUrl(video);
  const label = videoLabel(video, fallbackLabel);

  if (!embedUrl) return null;

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-surface-strong",
        className,
      )}
    >
      {isActivated ? (
        <iframe
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 size-full border-0"
          referrerPolicy="strict-origin-when-cross-origin"
          src={embedUrl}
          title={label}
        />
      ) : (
        <button
          className="group absolute inset-0 flex size-full flex-col items-center justify-center gap-5 text-center transition-colors hover:bg-surface"
          onClick={() => setIsActivated(true)}
          type="button"
        >
          <span className="flex size-16 items-center justify-center border border-foreground/55 transition-colors group-hover:border-accent group-hover:text-accent sm:size-20">
            <Play
              aria-hidden="true"
              className="ml-1 size-5 sm:size-6"
              fill="currentColor"
              strokeWidth={1}
            />
          </span>
          <span className="max-w-md px-6 text-[0.625rem] tracking-[0.17em] text-foreground/70 uppercase">
            Play {label}
          </span>
          <span className="max-w-sm px-6 text-[0.625rem] leading-5 text-muted-foreground normal-case">
            Loads from the video provider only after you press play.
          </span>
        </button>
      )}
    </div>
  );
}
