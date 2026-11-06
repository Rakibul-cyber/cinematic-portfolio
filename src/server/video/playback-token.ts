import "server-only";

import { sign, type KeyObject } from "node:crypto";

import { isValidProviderId } from "@/lib/video-status";

/**
 * Signed playback for Mux: an RS256 JWT, created on the server with the
 * playback signing key, appended to the HLS URL as `?token=`.
 *
 * Claims follow the provider's documentation: `sub` is the playback ID, `aud`
 * the resource ("v" video, "t" thumbnail, "s" storyboard), `exp` the expiry in
 * Unix seconds, and `kid` the signing key ID (also set in the JWT header, which
 * is standard for RS256). Whether the provider requires `kid` in the payload,
 * the header, or both, and how expiry behaves mid-playback, are confirmed in
 * the provider trial (MH-02D T-11).
 *
 * Generated playback URLs always use HTTPS.
 */

export type PlaybackAudience = "v" | "t" | "s";

/** Bounds for any token this module issues; callers choose shorter lifetimes. */
export const PLAYBACK_TOKEN_TTL_SECONDS = { min: 60, max: 86_400 } as const;

export const MUX_STREAM_ORIGIN = "https://stream.mux.com";

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function signPlaybackToken(input: {
  playbackId: string;
  keyId: string;
  privateKey: KeyObject;
  audience: PlaybackAudience;
  ttlSeconds: number;
  nowMs?: number;
}): string {
  const { playbackId, keyId, privateKey, audience, ttlSeconds, nowMs = Date.now() } = input;
  if (!isValidProviderId(playbackId)) throw new RangeError("Invalid playback ID.");
  if (!isValidProviderId(keyId)) throw new RangeError("Invalid signing key ID.");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < PLAYBACK_TOKEN_TTL_SECONDS.min || ttlSeconds > PLAYBACK_TOKEN_TTL_SECONDS.max) {
    throw new RangeError("Playback token lifetime is out of range.");
  }
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "rsa") throw new TypeError("An RSA private key is required.");

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }));
  const payload = base64url(
    JSON.stringify({ sub: playbackId, aud: audience, exp: Math.floor(nowMs / 1000) + ttlSeconds, kid: keyId }),
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

/** The HTTPS HLS URL for a signed playback ID and its token. */
export function signedPlaybackUrl(playbackId: string, token: string): string {
  if (!isValidProviderId(playbackId)) throw new RangeError("Invalid playback ID.");
  return `${MUX_STREAM_ORIGIN}/${playbackId}.m3u8?token=${encodeURIComponent(token)}`;
}
