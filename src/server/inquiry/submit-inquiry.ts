import "server-only";

import { emptyStates } from "@/content/site";
import { EmailDeliveryStatus } from "@/generated/prisma/enums";
import { hasAllDeliveryClaims } from "@/lib/email/delivery-claims";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/security/turnstile-widget";
import { inquirySchema, normalizeEmail } from "@/lib/validation/crm";
import { InvalidServiceError } from "@/server/crm/errors";
import type { createInquiry } from "@/server/crm/service";
import type { DeliveryOutcome } from "@/server/email/service";
import type { InquiryFailureCategory } from "@/server/inquiry/failure-log";
import type { consumeInquiryLimit } from "@/server/security/rate-limit";
import type { TurnstileVerifier } from "@/server/security/turnstile";

export type InquiryFormState = { success: boolean; message?: string; errors?: Record<string, string[]> };

/**
 * Everything the workflow reaches outside itself. `contact/actions.ts` binds the
 * real services; tests bind fakes, so every path runs with no database, provider
 * or request. Only types are imported from those modules, which keeps their
 * clients out of this module's graph.
 */
export type SubmitInquiryDependencies = {
  isIntakeOpen: () => boolean;
  findReplay: (submissionToken: string) => Promise<{ id: string; emailDeliveries: Parameters<typeof hasAllDeliveryClaims>[0] } | null>;
  getTrustedClientIp: () => Promise<string | undefined>;
  consumeLimit: typeof consumeInquiryLimit;
  verifyTurnstile: TurnstileVerifier;
  createInquiry: typeof createInquiry;
  deliverEmails: (inquiryId: string) => Promise<DeliveryOutcome[]>;
  logFailure: (category: InquiryFailureCategory, error?: unknown) => void;
};

// One constant for every success answer, so a replay is byte-for-byte
// indistinguishable from a first-time submission.
const SUCCESS_MESSAGE = "Thank you. Your inquiry has been received.";

const TURNSTILE_FAILURES = {
  invalid: "turnstile_invalid",
  misconfigured: "turnstile_misconfigured",
  unavailable: "turnstile_unavailable",
} as const;

/** Records deliveries that did not reach the provider, so a lost notification is visible. */
function logDeliveryOutcomes(outcomes: DeliveryOutcome[], logFailure: SubmitInquiryDependencies["logFailure"]): void {
  const attempted = outcomes.filter((outcome) => !outcome.alreadyClaimed);
  if (attempted.some((outcome) => outcome.status === EmailDeliveryStatus.FAILED)) logFailure("email_failed");
  if (attempted.some((outcome) => outcome.status === EmailDeliveryStatus.SKIPPED)) logFailure("email_skipped");
}

export async function submitInquiryWorkflow(form: FormData, dependencies: SubmitInquiryDependencies): Promise<InquiryFormState> {
  const { logFailure } = dependencies;
  // Hiding the form does not remove this action, which stays directly callable,
  // so the gate belongs here: nothing below may run while intake is closed.
  if (!dependencies.isIntakeOpen()) {
    logFailure("intake_closed");
    return { success: false, message: emptyStates.inquiry };
  }
  const parsed = inquirySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    logFailure(errors.website ? "honeypot_rejected" : "validation_rejected");
    return { success: false, message: "Please check the highlighted fields.", errors };
  }
  // Which step a thrown error came from, for the log only; the visitor's answer
  // is the same whichever step failed.
  let step: InquiryFailureCategory = "replay_lookup_failed";
  try {
    // A network replay that already committed must retain Phase 6 idempotency
    // and does not consume another abuse-control attempt. One narrow lookup
    // answers both questions: whether the token was already used, and whether
    // every delivery was already claimed. No inquiry PII is selected.
    const replay = await dependencies.findReplay(parsed.data.submissionToken);
    if (replay) {
      // The ordinary replay — a completed submission — is answered from the
      // claim rows alone, so a held token cannot repeatedly re-enter delivery
      // orchestration. Only a genuinely unclaimed delivery is worth recovering,
      // and `deliverInquiryEmails` remains authoritative on erasure.
      if (!hasAllDeliveryClaims(replay.emailDeliveries)) {
        step = "replay_recovery_failed";
        // No outcomes is not a failure here: an erased inquiry correctly attempts nothing.
        logDeliveryOutcomes(await dependencies.deliverEmails(replay.id), logFailure);
      }
      return { success: true, message: SUCCESS_MESSAGE };
    }

    step = "rate_limit_failed";
    const trustedClientIp = await dependencies.getTrustedClientIp();
    const limited = await dependencies.consumeLimit({
      submissionToken: parsed.data.submissionToken,
      normalizedEmail: normalizeEmail(parsed.data.email),
      ...(trustedClientIp ? { trustedClientIp } : {}),
    });
    if (!limited.allowed) {
      logFailure(limited.configured ? "rate_limited" : "rate_limit_unconfigured");
      return { success: false, message: "We could not receive your inquiry. Please try again later." };
    }

    step = "turnstile_failed";
    const challenge = await dependencies.verifyTurnstile({
      token: String(form.get(TURNSTILE_RESPONSE_FIELD) ?? ""),
      ...(trustedClientIp ? { remoteIp: trustedClientIp } : {}),
    });
    if (!challenge.ok) {
      logFailure(TURNSTILE_FAILURES[challenge.reason]);
      return { success: false, message: "Verification failed. Please try again." };
    }

    step = "persistence_failed";
    const inquiry = await dependencies.createInquiry(parsed.data);
    // The inquiry is committed at this point, and the visitor has succeeded.
    // Email is attempted afterwards, outside any transaction, and awaited so
    // the attempt is durably recorded before this serverless invocation may be
    // frozen. Delivery is not expected to throw, and never resends for a
    // replayed submission; even if it did throw, the answer below must stand.
    try {
      const outcomes = await dependencies.deliverEmails(inquiry.id);
      // A new inquiry always has two deliveries to attempt; none means orchestration failed.
      if (outcomes.length === 0) logFailure("email_orchestration_failed");
      logDeliveryOutcomes(outcomes, logFailure);
    } catch (error) {
      logFailure("email_orchestration_failed", error);
    }
    return { success: true, message: SUCCESS_MESSAGE };
  } catch (error) {
    if (error instanceof InvalidServiceError) {
      logFailure("invalid_service");
      return { success: false, message: error.message, errors: { serviceSlug: [error.message] } };
    }
    logFailure(step, error);
    return { success: false, message: "We could not receive your inquiry. Please try again." };
  }
}
