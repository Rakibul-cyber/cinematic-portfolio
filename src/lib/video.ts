/**
 * Provider-neutral video helpers.
 *
 * The database stores only a provider and that provider's own video identifier
 * (see the `VideoProvider` enum). Embed URLs are built here, never stored, so
 * changing the privacy domain or adding a provider is a single-file change and
 * no iframe markup or embed script ever comes from content.
 *
 * Pure and free of server-only imports so both Server Components and the
 * click-to-load Client Component can use it.
 */

export const VIDEO_PROVIDERS = ["YOUTUBE", "VIMEO", "EXTERNAL"] as const;

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export type VideoRef = {
  provider: VideoProvider;
  videoId: string;
  title: string | null;
};

/**
 * Identifier shapes accepted from the CMS.
 *
 * YouTube uses 11 URL-safe characters today, but the length is not contractual,
 * so a conservative range is allowed. Vimeo identifiers are numeric. Anything
 * outside these shapes is rejected rather than interpolated into a URL, which
 * is what keeps a stored value from escaping the embed path.
 */
const ID_PATTERNS: Record<VideoProvider, RegExp> = {
  YOUTUBE: /^[A-Za-z0-9_-]{6,32}$/,
  VIMEO: /^[0-9]{6,20}$/,
  EXTERNAL: /^[A-Za-z0-9_-]{1,64}$/,
};

/** True when `id` is a syntactically valid identifier for `provider`. */
export function isValidVideoId(
  provider: VideoProvider,
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  return ID_PATTERNS[provider].test(id);
}

/**
 * Builds a `VideoRef` from raw CMS columns, or `null` when the pair is absent
 * or malformed. Public rendering treats "no valid video" as "no video section"
 * rather than rendering a broken player.
 */
export function toVideoRef(input: {
  provider: string | null | undefined;
  videoId: string | null | undefined;
  title?: string | null;
}): VideoRef | null {
  const provider = input.provider as VideoProvider | null | undefined;

  if (!provider || !VIDEO_PROVIDERS.includes(provider)) return null;
  if (!isValidVideoId(provider, input.videoId)) return null;

  return {
    provider,
    videoId: input.videoId as string,
    title: input.title?.trim() || null,
  };
}

/**
 * Privacy-enhanced embed URL.
 *
 * YouTube uses `youtube-nocookie.com`; Vimeo is asked not to track (`dnt=1`).
 * `autoplay=1` is safe here because the URL is only ever built *after* an
 * explicit user activation, and no `mute`/sound-on autoplay happens on load.
 *
 * `EXTERNAL` deliberately has no embed URL: an unknown provider must not be
 * turned into an arbitrary third-party frame.
 */
export function videoEmbedUrl(ref: VideoRef): string | null {
  switch (ref.provider) {
    case "YOUTUBE":
      return `https://www.youtube-nocookie.com/embed/${ref.videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    case "VIMEO":
      return `https://player.vimeo.com/video/${ref.videoId}?autoplay=1&dnt=1`;
    case "EXTERNAL":
      return null;
  }
}

/** Accessible name for the player, without inventing a title. */
export function videoLabel(ref: VideoRef, fallback: string): string {
  return ref.title ?? fallback;
}
