import "server-only";

import { recoverEmailsSchema, retryEmailSchema } from "@/lib/validation/crm";
import type { AdminUser } from "@/server/auth/session";
import {
  DeliveryNotRetryableError,
  type DeliveryDependencies,
  type DeliveryOutcome,
  type recoverMissingInquiryEmails,
  type retryInquiryEmail,
} from "@/server/email/service";

/**
 * The administrator's email recovery requests, apart from Next.js redirects so
 * they can run under test. Authorization always comes first. The answer is what
 * the action shows: fixed text only, never provider detail.
 */

export type RecoveryAnswer = { inquiryId: string; outcome: "saved" | "info" | "error"; notice: string };

type RequireActor = () => Promise<AdminUser>;

const SUPERSEDED = "A newer attempt now owns this email";
const ERASED = "The inquiry was anonymized, so nothing more was sent";

const options = (confirmDuplicateRisk: "yes" | undefined): Pick<DeliveryDependencies, "confirmedDuplicateRisk"> =>
  confirmDuplicateRisk ? { confirmedDuplicateRisk: true } : {};

const notRecovered = (error: unknown, fallback: string) =>
  error instanceof DeliveryNotRetryableError ? error.message : fallback;

export async function runRetryEmail(
  form: FormData,
  dependencies: { requireActor: RequireActor; retry: typeof retryInquiryEmail },
): Promise<RecoveryAnswer> {
  const actor = await dependencies.requireActor();
  const data = retryEmailSchema.parse(Object.fromEntries(form));

  let outcome: RecoveryAnswer["outcome"] = "saved";
  let notice = "Email retried";
  try {
    const delivery = await dependencies.retry(data.inquiryId, data.type, actor, options(data.confirmDuplicateRisk));
    if (delivery.superseded) return { inquiryId: data.inquiryId, outcome: "info", notice: SUPERSEDED };
    if (delivery.erased) return { inquiryId: data.inquiryId, outcome: "info", notice: ERASED };
    notice =
      delivery.status === "ACCEPTED"
        ? "Email accepted by the provider"
        : delivery.status === "SKIPPED"
          ? "Email is not configured, so nothing was sent"
          : "Email could not be sent";
    outcome = delivery.status === "ACCEPTED" ? "saved" : delivery.status === "SKIPPED" ? "info" : "error";
  } catch (error) {
    // Provider detail is never surfaced to the admin UI.
    outcome = "error";
    notice = notRecovered(error, "The email could not be retried.");
  }
  return { inquiryId: data.inquiryId, outcome, notice };
}

function describeRecovery(outcomes: DeliveryOutcome[]): Pick<RecoveryAnswer, "outcome" | "notice"> {
  const attempted = outcomes.filter((delivery) => !delivery.alreadyClaimed && !delivery.superseded);
  if (outcomes.length === 0) return { outcome: "error", notice: "The missing emails could not be sent." };
  if (attempted.length === 0) return { outcome: "info", notice: "Another request is already handling these emails" };
  if (attempted.some((delivery) => delivery.erased)) return { outcome: "info", notice: ERASED };
  if (attempted.some((delivery) => delivery.status === "FAILED")) return { outcome: "error", notice: "A missing email could not be sent" };
  if (attempted.some((delivery) => delivery.status === "SKIPPED")) return { outcome: "info", notice: "Email is not configured, so nothing was sent" };
  return { outcome: "saved", notice: "Missing emails accepted by the provider" };
}

export async function runRecoverMissingEmails(
  form: FormData,
  dependencies: { requireActor: RequireActor; recover: typeof recoverMissingInquiryEmails },
): Promise<RecoveryAnswer> {
  const actor = await dependencies.requireActor();
  const data = recoverEmailsSchema.parse(Object.fromEntries(form));

  try {
    const outcomes = await dependencies.recover(data.inquiryId, actor, options(data.confirmDuplicateRisk));
    return { inquiryId: data.inquiryId, ...describeRecovery(outcomes) };
  } catch (error) {
    return { inquiryId: data.inquiryId, outcome: "error", notice: notRecovered(error, "The missing emails could not be sent.") };
  }
}
