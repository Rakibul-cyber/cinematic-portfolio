import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5_000;
let warnedMissingConfiguration = false;

export type TurnstileResult =
  | { ok: true; bypassed: boolean }
  | { ok: false; reason: "invalid" | "misconfigured" | "unavailable" };

export type TurnstileVerifier = (input: {
  token: string;
  remoteIp?: string;
}) => Promise<TurnstileResult>;

export async function verifyTurnstile(input: {
  token: string;
  remoteIp?: string;
}, dependencies: { env?: Record<string, string | undefined>; fetcher?: typeof fetch } = {}): Promise<TurnstileResult> {
  const env = dependencies.env ?? process.env;
  const fetcher = dependencies.fetcher ?? fetch;
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();

  if (!siteKey && !secret && env.NODE_ENV !== "production") {
    return { ok: true, bypassed: true };
  }
  if (!siteKey || !secret || !input.token || input.token.length > 2048) {
    if ((!siteKey || !secret) && env.NODE_ENV === "production" && !warnedMissingConfiguration) {
      warnedMissingConfiguration = true;
      console.error("[security] Turnstile is not configured. Check TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.");
    }
    return { ok: false, reason: siteKey && secret ? "invalid" : "misconfigured" };
  }

  try {
    const body = new URLSearchParams({ secret, response: input.token });
    if (input.remoteIp) body.set("remoteip", input.remoteIp);
    const response = await fetcher(VERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      // Without a deadline an unresponsive provider connection holds the public
      // Server Action open for as long as the platform allows.
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };

    const data = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
      challenge_ts?: string;
    };
    const expectedHostname = env.TURNSTILE_EXPECTED_HOSTNAME?.trim();
    const challengedAt = data.challenge_ts ? Date.parse(data.challenge_ts) : Number.NaN;
    if (
      !data.success ||
      (expectedHostname && data.hostname !== expectedHostname) ||
      (data.action && data.action !== "inquiry") ||
      (data.challenge_ts && (!Number.isFinite(challengedAt) || challengedAt > Date.now() + 60_000 || challengedAt < Date.now() - 5 * 60_000))
    ) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, bypassed: false };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
