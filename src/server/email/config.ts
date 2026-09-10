import "server-only";

import {
  parseMailAddress,
  parseMailAddressList,
  type MailAddress,
} from "@/lib/email/address";

/**
 * Transactional email configuration.
 *
 * Everything here is environment-only. The Resend API key is a secret and must
 * never reach a `NEXT_PUBLIC_` variable, a CMS setting, a database row, or an
 * admin form; sender and recipient addresses stay alongside it so one
 * deployment target owns the whole email identity.
 *
 * Three states are distinguished deliberately, because they need different
 * responses:
 *
 * - **configured** — attempt provider delivery.
 * - **not configured** — nothing is set. Normal for local development and
 *   tests, where no key exists and none should be required. Deliveries are
 *   recorded as `SKIPPED`, never as if they had been sent.
 * - **invalid** — something is set but wrong (a malformed sender, a typo in a
 *   recipient). This is a misconfiguration worth surfacing rather than silently
 *   degrading, so it is reported separately and warned about in production.
 *
 * Nothing here throws at import time. A missing key must not stop the
 * application from booting, because inquiries must keep being accepted whether
 * or not email works.
 */

export type EmailConfig =
  | {
      configured: true;
      apiKey: string;
      from: MailAddress;
      /** Where customer replies should go, when configured. */
      replyTo: MailAddress | null;
      adminRecipients: MailAddress[];
      /** Trusted origin for admin links. Never derived from a request header. */
      appBaseUrl: string | null;
    }
  | {
      configured: false;
      reason: "not_configured" | "invalid";
      /** Variable names only. Never values, so a log can never leak a secret. */
      problems: string[];
    };

export type EmailEnvironment = Record<string, string | undefined>;

function value(env: EmailEnvironment, key: string): string | undefined {
  const raw = env[key];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Validates the email environment.
 *
 * Pure, so configuration rules can be unit-tested without touching
 * `process.env` or a provider.
 */
export function parseEmailConfig(env: EmailEnvironment): EmailConfig {
  const apiKey = value(env, "RESEND_API_KEY");
  const from = value(env, "EMAIL_FROM");
  const replyTo = value(env, "EMAIL_REPLY_TO");
  const recipients = value(env, "EMAIL_ADMIN_RECIPIENTS");

  // A trusted, configured origin. `BETTER_AUTH_URL` is already the absolute
  // origin this deployment answers on, so admin links never need a Host header.
  const appBaseUrl =
    value(env, "NEXT_PUBLIC_SITE_URL") ?? value(env, "BETTER_AUTH_URL") ?? null;

  if (!apiKey && !from && !recipients) {
    return {
      configured: false,
      reason: "not_configured",
      problems: ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_ADMIN_RECIPIENTS"],
    };
  }

  const problems: string[] = [];

  if (!apiKey) problems.push("RESEND_API_KEY is missing");

  const parsedFrom = from ? parseMailAddress(from) : null;
  if (!from) problems.push("EMAIL_FROM is missing");
  else if (!parsedFrom) problems.push("EMAIL_FROM is not a valid sender address");

  const parsedRecipients = recipients ? parseMailAddressList(recipients) : null;
  if (!recipients) problems.push("EMAIL_ADMIN_RECIPIENTS is missing");
  else if (!parsedRecipients) {
    problems.push("EMAIL_ADMIN_RECIPIENTS contains an invalid address");
  }

  // Reply-To is genuinely optional, but a malformed one is still a mistake
  // rather than something to quietly ignore.
  const parsedReplyTo = replyTo ? parseMailAddress(replyTo) : null;
  if (replyTo && !parsedReplyTo) {
    problems.push("EMAIL_REPLY_TO is not a valid address");
  }

  if (problems.length > 0 || !apiKey || !parsedFrom || !parsedRecipients) {
    return { configured: false, reason: "invalid", problems };
  }

  return {
    configured: true,
    apiKey,
    from: parsedFrom,
    replyTo: parsedReplyTo,
    adminRecipients: parsedRecipients,
    appBaseUrl,
  };
}

let cached: EmailConfig | undefined;
let warned = false;

/**
 * Returns the validated email configuration, evaluated once per process.
 *
 * A production deployment that is misconfigured, or has no email configured at
 * all, is warned about exactly once. The warning names variables only, so it is
 * safe to ship to any log destination.
 */
export function getEmailConfig(): EmailConfig {
  if (cached) return cached;

  cached = parseEmailConfig(process.env);

  if (!cached.configured && !warned && process.env.NODE_ENV === "production") {
    warned = true;
    console.warn(
      `[email] Transactional email is not active (${cached.reason}). Inquiries are still stored. Check: ${cached.problems.join("; ")}`,
    );
  }

  return cached;
}

/** Test seam. Clears the memoized configuration. */
export function resetEmailConfigCache(): void {
  cached = undefined;
  warned = false;
}
