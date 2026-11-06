import "server-only";

import { createPrivateKey, type KeyObject } from "node:crypto";

import { isValidProviderId } from "@/lib/video-status";
import { Secret } from "@/server/video/secret";

/**
 * Server-only configuration of the video provider (Mux).
 *
 * The feature is enabled only when all five variables are present and valid.
 * With none set, video is simply disabled (the normal state for local work and
 * for any deployment without a provider). With some set, or any malformed,
 * the configuration is reported as invalid and video stays disabled: a partial
 * setup is a mistake to surface, never something to run with.
 *
 * Problems name variables only. Values are never echoed, and the parsed
 * secrets are wrapped so that printing the configuration cannot reveal them.
 */

export const VIDEO_PROVIDER_ENV = [
  "MUX_TOKEN_ID",
  "MUX_TOKEN_SECRET",
  "MUX_WEBHOOK_SECRET",
  "MUX_SIGNING_KEY_ID",
  "MUX_SIGNING_PRIVATE_KEY",
] as const;

export type VideoProviderConfig = {
  provider: "mux";
  tokenId: Secret;
  tokenSecret: Secret;
  webhookSecret: Secret;
  signingKeyId: string;
  /** An RSA private key object; Node renders it without key material. */
  signingPrivateKey: KeyObject;
};

export type VideoProviderConfigResult =
  | { status: "enabled"; config: VideoProviderConfig }
  | { status: "disabled" }
  | { status: "invalid"; problems: string[] };

/** The smallest RSA modulus accepted for playback signing. */
const MIN_RSA_BITS = 2048;
const MAX_VALUE_LENGTH = 16_384;

function value(env: Record<string, string | undefined>, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

const isPlainCredential = (input: string) => input.length <= 512 && /^[\x21-\x7e]+$/.test(input);

/**
 * Accepts the PEM text itself or, as the provider's dashboard issues it, the
 * PEM base64-encoded on one line. Returns null for anything that is not an
 * RSA private key of at least 2048 bits.
 */
export function parseSigningPrivateKey(input: string): KeyObject | null {
  if (input.length > MAX_VALUE_LENGTH) return null;
  let pem = input;
  if (!input.includes("-----BEGIN")) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(input)) return null;
    pem = Buffer.from(input, "base64").toString("utf8");
    if (!pem.includes("-----BEGIN")) return null;
  }
  try {
    const key = createPrivateKey({ key: pem, format: "pem" });
    if (key.asymmetricKeyType !== "rsa") return null;
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_BITS) return null;
    return key;
  } catch {
    return null;
  }
}

export function parseVideoProviderConfig(env: Record<string, string | undefined>): VideoProviderConfigResult {
  const present = VIDEO_PROVIDER_ENV.filter((name) => value(env, name) !== undefined);
  if (present.length === 0) return { status: "disabled" };

  const problems: string[] = VIDEO_PROVIDER_ENV.filter((name) => !present.includes(name)).map((name) => `${name} is missing`);

  const tokenId = value(env, "MUX_TOKEN_ID");
  const tokenSecret = value(env, "MUX_TOKEN_SECRET");
  const webhookSecret = value(env, "MUX_WEBHOOK_SECRET");
  const signingKeyId = value(env, "MUX_SIGNING_KEY_ID");
  const privateKeyRaw = value(env, "MUX_SIGNING_PRIVATE_KEY");

  if (tokenId !== undefined && !isPlainCredential(tokenId)) problems.push("MUX_TOKEN_ID is malformed");
  if (tokenSecret !== undefined && !isPlainCredential(tokenSecret)) problems.push("MUX_TOKEN_SECRET is malformed");
  if (webhookSecret !== undefined && (!isPlainCredential(webhookSecret) || webhookSecret.length < 16)) {
    problems.push("MUX_WEBHOOK_SECRET is malformed");
  }
  if (signingKeyId !== undefined && !isValidProviderId(signingKeyId)) problems.push("MUX_SIGNING_KEY_ID is malformed");
  const signingPrivateKey = privateKeyRaw === undefined ? null : parseSigningPrivateKey(privateKeyRaw);
  if (privateKeyRaw !== undefined && !signingPrivateKey) {
    problems.push(`MUX_SIGNING_PRIVATE_KEY is not an RSA private key of at least ${MIN_RSA_BITS} bits`);
  }

  if (problems.length > 0 || !tokenId || !tokenSecret || !webhookSecret || !signingKeyId || !signingPrivateKey) {
    return { status: "invalid", problems };
  }
  return {
    status: "enabled",
    config: {
      provider: "mux",
      tokenId: new Secret(tokenId),
      tokenSecret: new Secret(tokenSecret),
      webhookSecret: new Secret(webhookSecret),
      signingKeyId,
      signingPrivateKey,
    },
  };
}

/** The current configuration, read from the process environment at call time. */
export function loadVideoProviderConfig(env: Record<string, string | undefined> = process.env): VideoProviderConfigResult {
  return parseVideoProviderConfig(env);
}
