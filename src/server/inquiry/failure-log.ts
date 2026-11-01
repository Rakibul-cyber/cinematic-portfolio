import "server-only";

/**
 * Privacy-safe logging for the public inquiry workflow.
 *
 * One JSON line per failure, carrying a fixed category and, for a thrown error,
 * only its class name and Prisma error code. Error messages are never logged:
 * database and provider messages can quote submitted values. Nothing here accepts
 * form data, so a caller cannot pass an address, an IP, or a token by accident.
 */

/** Refusals the workflow expects. Logged as warnings: they need no response on their own. */
const EXPECTED_REJECTIONS = [
  "intake_closed",
  "validation_rejected",
  "honeypot_rejected",
  "rate_limited",
  "turnstile_invalid",
  "invalid_service",
] as const;

/** Faults an operator may have to act on. A visitor was refused or an email was lost. */
type InquiryFault =
  | "rate_limit_unconfigured"
  | "turnstile_misconfigured"
  | "turnstile_unavailable"
  | "replay_lookup_failed"
  | "replay_recovery_failed"
  | "rate_limit_failed"
  | "turnstile_failed"
  | "persistence_failed"
  | "email_failed"
  | "email_skipped"
  | "email_orchestration_failed";

export type InquiryFailureCategory = (typeof EXPECTED_REJECTIONS)[number] | InquiryFault;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PRISMA_CODE = /^P\d{4}$/;

function errorFields(error: unknown): { errorName?: string; errorCode?: string } {
  if (typeof error !== "object" || error === null) return {};
  const { name, code } = error as { name?: unknown; code?: unknown };
  return {
    ...(typeof name === "string" && IDENTIFIER.test(name) ? { errorName: name } : {}),
    ...(typeof code === "string" && PRISMA_CODE.test(code) ? { errorCode: code } : {}),
  };
}

export function logInquiryFailure(category: InquiryFailureCategory, error?: unknown): void {
  const line = JSON.stringify({ scope: "inquiry", category, ...errorFields(error) });
  if ((EXPECTED_REJECTIONS as readonly string[]).includes(category)) console.warn(line);
  else console.error(line);
}
