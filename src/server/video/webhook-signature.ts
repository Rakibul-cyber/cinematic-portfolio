import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Secret } from "@/server/video/secret";

/**
 * Verifies a Mux webhook (`mux-signature: t=<unix seconds>,v1=<hex>`): an
 * HMAC-SHA256, keyed with the endpoint's signing secret, over
 * `<timestamp>.<raw request body>`. The raw body must be verified before it is
 * parsed; re-serialized JSON would not match.
 *
 * The timestamp must be within the tolerance in either direction (default
 * 300 s, the provider's documented default), which bounds replay of a captured
 * request. Several `v1` signatures may be present during secret rotation; any
 * one matching is enough. Comparison is constant-time. The result names only a
 * reason category, never the expected signature.
 */

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_HEADER_LENGTH = 4_096;

export type WebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_header" | "malformed_header" | "outside_tolerance" | "mismatch" };

export function computeMuxSignature(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

export function verifyMuxWebhookSignature(input: {
  header: string | null | undefined;
  rawBody: string | Buffer;
  secret: Secret;
  nowMs?: number;
  toleranceSeconds?: number;
}): WebhookVerification {
  const { header, rawBody, secret, nowMs = Date.now(), toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS } = input;
  if (!header) return { ok: false, reason: "missing_header" };
  if (header.length > MAX_HEADER_LENGTH) return { ok: false, reason: "malformed_header" };

  let timestamp: number | null = null;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) return { ok: false, reason: "malformed_header" };
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value) || timestamp !== null) return { ok: false, reason: "malformed_header" };
      timestamp = Number(value);
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return { ok: false, reason: "malformed_header" };
      signatures.push(Buffer.from(value, "hex"));
    }
    // Other schemes are ignored, as the provider may add them.
  }
  if (timestamp === null || signatures.length === 0) return { ok: false, reason: "malformed_header" };
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return { ok: false, reason: "outside_tolerance" };

  const expected = Buffer.from(computeMuxSignature(secret.reveal(), timestamp, rawBody), "hex");
  const matched = signatures.some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));
  return matched ? { ok: true, timestamp } : { ok: false, reason: "mismatch" };
}
