"use client";

import { useEffect, useRef, useState, type MouseEvent, type Ref } from "react";
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
 * Whether activating Play should move focus to the player container.
 *
 * Activation unmounts the button, so whoever's focus is on it would lose it
 * to the document body. That is decided by where focus is, not by the input
 * method: keyboard, a click that focuses buttons (Chrome, Edge, Windows
 * Firefox, Android touch), and assistive-technology activations that first
 * move focus all leave it on the button. Where a press never focused the
 * button (Safari, macOS Firefox, iOS touch, a screen reader's reading cursor),
 * focus is elsewhere and is left alone.
 */
export function shouldMoveFocusOnActivate(
  activeElement: unknown,
  button: unknown,
): boolean {
  return activeElement !== null && activeElement === button;
}

/** Name of the activated player, distinct from the iframe's own title. */
export const videoPlayerName = (label: string) => `Video player: ${label}`;

type VideoPlayerViewProps = {
  className?: string;
  embedUrl: string;
  isActivated: boolean;
  label: string;
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  regionRef?: Ref<HTMLDivElement>;
};

/**
 * The player's markup for either state, without the state itself, so both
 * states can be rendered and checked outside a browser.
 *
 * Once activated, the container is the single programmatic focus target. It
 * takes `tabIndex={-1}`, so it is never a Tab stop of its own. A focused
 * nameless `div` may be announced as nothing at all, so it becomes a named
 * group; the name says what it is ("Video player: …") rather than repeating
 * the iframe's title verbatim, and focusing it and then tabbing into the
 * iframe are two separate steps, each announced once. Before activation it
 * has no role or name, so the Play button's own label is not doubled. The
 * iframe keeps its default tab order, so the next Tab reaches it.
 */
export function VideoPlayerView({
  className,
  embedUrl,
  isActivated,
  label,
  onActivate,
  regionRef,
}: VideoPlayerViewProps) {
  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden bg-surface-strong",
        className,
      )}
      aria-label={isActivated ? videoPlayerName(label) : undefined}
      ref={regionRef}
      role={isActivated ? "group" : undefined}
      tabIndex={isActivated ? -1 : undefined}
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
          onClick={onActivate}
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
 * the visible focus ring all work without extra handling. Activation removes
 * that button, so when it held focus, focus would otherwise fall back to the
 * document body: it moves to the player container instead, once, with
 * `preventScroll`, so the smooth-scrolling root never animates on its account.
 * Script focus after a pointer press does not match `:focus-visible`, so a
 * mouse visitor sees no ring and no scroll. Focus is never moved into the
 * iframe; the visitor tabs into it.
 */
export function VideoPlayer({
  className,
  fallbackLabel,
  video,
}: VideoPlayerProps) {
  const [isActivated, setIsActivated] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const moveFocusRef = useRef(false);
  const embedUrl = videoEmbedUrl(video);
  const label = videoLabel(video, fallbackLabel);

  useEffect(() => {
    if (isActivated && moveFocusRef.current) {
      regionRef.current?.focus({ preventScroll: true });
    }
  }, [isActivated]);

  if (!embedUrl) return null;

  return (
    <VideoPlayerView
      className={className}
      embedUrl={embedUrl}
      isActivated={isActivated}
      label={label}
      onActivate={(event) => {
        moveFocusRef.current = shouldMoveFocusOnActivate(document.activeElement, event.currentTarget);
        setIsActivated(true);
      }}
      regionRef={regionRef}
    />
  );
}
