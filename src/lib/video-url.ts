import { isValidVideoId } from "@/lib/video";

/**
 * Parses a pasted YouTube or Vimeo link into the provider and its identifiers.
 *
 * Only the provider, the video ID, and (for unlisted Vimeo videos) the privacy
 * hash leave this function; the URL itself is never stored or rendered, so a
 * pasted link can never become markup, a script, or an arbitrary iframe source.
 * Hosts are matched exactly, so look-alikes such as `youtube.com.example.com`
 * or `evil-youtube.com` are refused.
 */

export type ParsedVideoUrl =
  | { provider: "YOUTUBE"; videoId: string }
  | { provider: "VIMEO"; videoId: string; hash: string | null };

export type VideoUrlError =
  | "empty"
  | "too_long"
  | "not_a_url"
  | "unsupported_scheme"
  | "credentials_not_allowed"
  | "unsupported_host"
  | "missing_id"
  | "invalid_id"
  | "invalid_hash";

export type VideoUrlResult = { ok: true; value: ParsedVideoUrl } | { ok: false; error: VideoUrlError };

export const MAX_VIDEO_URL_LENGTH = 2048;

/** A YouTube video ID is exactly 11 URL-safe characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/**
 * The privacy hash of an unlisted Vimeo video. Observed hashes are short
 * lowercase hex strings; the bound is kept permissive (letters and digits only)
 * because Vimeo does not document the format. UNVERIFIED beyond that.
 */
const VIMEO_HASH = /^[A-Za-z0-9]{6,40}$/;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YOUTUBE_SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);
const VIMEO_PLAYER_HOSTS = new Set(["player.vimeo.com"]);
const KNOWN_HOSTS = [...YOUTUBE_HOSTS, ...YOUTUBE_SHORT_HOSTS, ...VIMEO_HOSTS, ...VIMEO_PLAYER_HOSTS];

const fail = (error: VideoUrlError): VideoUrlResult => ({ ok: false, error });
const ok = (value: ParsedVideoUrl): VideoUrlResult => ({ ok: true, value });

/** Adds `https://` to a pasted link that starts with a known host, e.g. `youtu.be/abc`. */
function withScheme(input: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  const host = input.split(/[/?#]/, 1)[0].toLowerCase();
  return KNOWN_HOSTS.includes(host) ? `https://${input}` : input;
}

function youtube(id: string | null | undefined): VideoUrlResult {
  if (!id) return fail("missing_id");
  return YOUTUBE_ID.test(id) && isValidVideoId("YOUTUBE", id) ? ok({ provider: "YOUTUBE", videoId: id }) : fail("invalid_id");
}

function vimeo(id: string | null | undefined, hash: string | null | undefined): VideoUrlResult {
  if (!id) return fail("missing_id");
  if (!isValidVideoId("VIMEO", id)) return fail("invalid_id");
  if (hash !== null && hash !== undefined && hash !== "" && !VIMEO_HASH.test(hash)) return fail("invalid_hash");
  return ok({ provider: "VIMEO", videoId: id, hash: hash || null });
}

export function parseVideoUrl(input: string): VideoUrlResult {
  const trimmed = input.trim();
  if (!trimmed) return fail("empty");
  if (trimmed.length > MAX_VIDEO_URL_LENGTH) return fail("too_long");
  if (/\s/.test(trimmed)) return fail("not_a_url");

  let url: URL;
  try {
    url = new URL(withScheme(trimmed));
  } catch {
    return fail("not_a_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("unsupported_scheme");
  if (url.username || url.password) return fail("credentials_not_allowed");
  if (url.port) return fail("unsupported_host");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (YOUTUBE_SHORT_HOSTS.has(host)) return youtube(segments[0]);

  if (YOUTUBE_HOSTS.has(host)) {
    if (segments[0] === "watch") return youtube(url.searchParams.get("v"));
    if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) return youtube(segments[1]);
    return fail("missing_id");
  }

  if (VIMEO_PLAYER_HOSTS.has(host)) {
    if (segments[0] !== "video") return fail("missing_id");
    return vimeo(segments[1], url.searchParams.get("h"));
  }

  if (VIMEO_HOSTS.has(host)) {
    // vimeo.com/<id>[/<hash>]
    if (/^\d+$/.test(segments[0] ?? "")) return vimeo(segments[0], segments[1] ?? url.searchParams.get("h"));
    // vimeo.com/channels/<name>/<id>
    if (segments[0] === "channels" && segments.length >= 3) return vimeo(segments[2], url.searchParams.get("h"));
    // vimeo.com/groups/<name>/videos/<id>
    if (segments[0] === "groups" && segments[2] === "videos") return vimeo(segments[3], url.searchParams.get("h"));
    // vimeo.com/showcase/<id>/video/<id>
    if (segments[0] === "showcase" && segments[2] === "video") return vimeo(segments[3], url.searchParams.get("h"));
    return fail("missing_id");
  }

  return fail("unsupported_host");
}
