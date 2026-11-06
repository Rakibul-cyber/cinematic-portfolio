import "server-only";

/**
 * Typed failures of the video provider integration.
 *
 * An error carries a code and, for HTTP failures, the status only. Response
 * bodies, request URLs with credentials, headers, and provider messages are
 * never attached, so logging or reporting a `VideoProviderError` (including
 * through Sentry) cannot leak a token, a signed upload URL, or provider detail.
 */
export const VIDEO_PROVIDER_ERROR_CODES = [
  "not_configured",
  "invalid_request",
  "unauthorized",
  "not_found",
  "rate_limited",
  "provider_unavailable",
  "invalid_response",
  "network_error",
  "timeout",
] as const;

export type VideoProviderErrorCode = (typeof VIDEO_PROVIDER_ERROR_CODES)[number];

export class VideoProviderError extends Error {
  readonly code: VideoProviderErrorCode;
  readonly status: number | null;

  constructor(code: VideoProviderErrorCode, status: number | null = null) {
    super(status === null ? `Video provider request failed (${code}).` : `Video provider request failed (${code}, HTTP ${status}).`);
    this.name = "VideoProviderError";
    this.code = code;
    this.status = status;
  }

  toJSON(): { name: string; code: VideoProviderErrorCode; status: number | null } {
    return { name: this.name, code: this.code, status: this.status };
  }
}

/** Classifies an HTTP status from the provider. */
export function providerErrorCodeForStatus(status: number): VideoProviderErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "invalid_request";
}

/**
 * Whether trying again later may succeed. A webhook handler answers non-2xx
 * for these, so the provider redelivers the event.
 */
export function isRetryableProviderError(error: unknown): boolean {
  return (
    error instanceof VideoProviderError &&
    (error.code === "provider_unavailable" || error.code === "rate_limited" || error.code === "network_error" || error.code === "timeout")
  );
}
