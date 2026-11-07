import { isValidVideoId } from "@/lib/video";

/**
 * Parses a pasted YouTube, Vimeo, or Google Drive link into the provider and
 * its identifiers.
 *
 * Only the provider, the video ID, and (for unlisted Vimeo videos) the privacy
 * hash leave this function; the URL itself is never stored or rendered, so a
 * pasted link can never become markup, a script, or an arbitrary iframe source.
 * Hosts are matched exactly, so look-alikes such as `youtube.com.example.com`
 * or `evil-youtube.com` are refused.
 */

export type ParsedVideoUrl =
  | { provider: "YOUTUBE"; videoId: string }
  | { provider: "VIMEO"; videoId: string; hash: string | null }
  | { provider: "GOOGLE_DRIVE"; videoId: string };

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
/** Drive files only; Docs, Sheets, and folders are never videos and are refused. */
const DRIVE_HOSTS = new Set(["drive.google.com"]);
const KNOWN_HOSTS = [...YOUTUBE_HOSTS, ...YOUTUBE_SHORT_HOSTS, ...VIMEO_HOSTS, ...VIMEO_PLAYER_HOSTS, ...DRIVE_HOSTS];

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

function drive(id: string | null | undefined): VideoUrlResult {
  if (!id) return fail("missing_id");
  return isValidVideoId("GOOGLE_DRIVE", id) ? ok({ provider: "GOOGLE_DRIVE", videoId: id }) : fail("invalid_id");
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

  if (DRIVE_HOSTS.has(host)) {
    // drive.google.com/file/d/<id>[/view|/preview|/edit]
    if (segments[0] === "file" && segments[1] === "d") return drive(segments[2]);
    // drive.google.com/open?id=<id> and drive.google.com/uc?id=<id>
    if (segments.length === 1 && (segments[0] === "open" || segments[0] === "uc")) return drive(url.searchParams.get("id"));
    return fail("missing_id");
  }

  return fail("unsupported_host");
}

/** A video the site can embed: exactly what the database stores. */
export type EmbeddableVideo = { provider: "YOUTUBE" | "VIMEO" | "GOOGLE_DRIVE"; videoId: string };

export type EmbeddableVideoResult = { ok: true; value: EmbeddableVideo } | { ok: false; message: string };

const URL_ERROR_MESSAGES: Record<VideoUrlError, string> = {
  empty: "Paste a YouTube, Vimeo, or Google Drive video link.",
  too_long: "That link is too long to be a video link.",
  not_a_url: "That is not a link. Paste the video's address from the browser.",
  unsupported_scheme: "Only https links to YouTube, Vimeo, or Google Drive are supported.",
  credentials_not_allowed: "That link contains a user name or password; paste the plain video link.",
  unsupported_host: "Only YouTube, Vimeo, and Google Drive links are supported.",
  missing_id: "That link does not point to a single video. Open the video itself and copy its link.",
  invalid_id: "That link's video ID is not valid. Copy the link again from the video page.",
  invalid_hash: "That Vimeo link is not valid. Copy the link again from the video page.",
};

/**
 * Parses an admin-pasted link into what the database stores, with a message
 * that is safe to show. Unlisted Vimeo links carry a privacy hash that is not
 * stored, so they would not play and are refused with an alternative.
 */
export function parseEmbeddableVideoUrl(input: string): EmbeddableVideoResult {
  const parsed = parseVideoUrl(input);
  if (!parsed.ok) return { ok: false, message: URL_ERROR_MESSAGES[parsed.error] };
  if (parsed.value.provider === "VIMEO" && parsed.value.hash) {
    return { ok: false, message: "Private (unlisted) Vimeo links are not supported. Use a public Vimeo video, an unlisted YouTube video, or Google Drive." };
  }
  return { ok: true, value: { provider: parsed.value.provider, videoId: parsed.value.videoId } };
}
