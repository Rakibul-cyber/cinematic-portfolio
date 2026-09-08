import "server-only";

import { z } from "zod";

/**
 * Public read delivery for stored media.
 *
 * Separate from `src/server/media/r2.ts` on purpose: writing needs an account
 * id, key id, and secret, while public rendering needs only the public read
 * origin. Keeping them apart means the public site renders on a deployment
 * that holds no write credentials at all, and it is the single place a bucket
 * host appears — components receive finished URLs, never storage details, so a
 * move to another provider or a custom media domain changes only this file.
 */
const schema = z.object({
  R2_PUBLIC_BASE_URL: z.string().url(),
});

let cachedBase: string | undefined;

function publicBaseUrl(): string {
  if (cachedBase) return cachedBase;

  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      "Public media delivery is not configured. Set R2_PUBLIC_BASE_URL in .env.local.",
    );
  }

  cachedBase = parsed.data.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
  return cachedBase;
}

/** Absolute public URL for a stored object key. */
export function publicMediaUrl(objectKey: string): string {
  return `${publicBaseUrl()}/${objectKey.replace(/^\//, "")}`;
}

/**
 * Whether public delivery is configured at all. Used so a missing public
 * origin degrades to a text-only page instead of throwing during render.
 */
export function isPublicMediaConfigured(): boolean {
  return schema.safeParse(process.env).success;
}
