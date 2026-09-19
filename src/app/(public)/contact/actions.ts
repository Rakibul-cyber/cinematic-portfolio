"use server";
import { headers } from "next/headers";
import { inquirySchema } from "@/lib/validation/crm";
import { normalizeEmail } from "@/lib/validation/crm";
import { createInquiry, InvalidServiceError } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import { hasAllDeliveryClaims } from "@/lib/email/delivery-claims";
import { deliverInquiryEmails } from "@/server/email/service";
import { consumeInquiryLimit } from "@/server/security/rate-limit";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/security/turnstile-widget";
import { verifyTurnstile } from "@/server/security/turnstile";

export type InquiryFormState = { success: boolean; message?: string; errors?: Record<string, string[]> };

// One constant for every success answer, so a replay is byte-for-byte
// indistinguishable from a first-time submission.
const SUCCESS_MESSAGE = "Thank you. Your inquiry has been received.";
export async function submitInquiry(_: InquiryFormState, form: FormData): Promise<InquiryFormState> {
  const parsed = inquirySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { success: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten().fieldErrors };
  try {
    // A network replay that already committed must retain Phase 6 idempotency
    // and does not consume another abuse-control attempt. One narrow lookup
    // answers both questions: whether the token was already used, and whether
    // every delivery was already claimed. No inquiry PII is selected.
    const replay = await prisma.inquiry.findUnique({
      where: { submissionToken: parsed.data.submissionToken },
      select: { id: true, emailDeliveries: { select: { type: true } } },
    });
    if (replay) {
      // The ordinary replay — a completed submission — is answered from the
      // claim rows alone, so a held token cannot repeatedly re-enter delivery
      // orchestration. Only a genuinely unclaimed delivery is worth recovering,
      // and `deliverInquiryEmails` remains authoritative on erasure.
      if (!hasAllDeliveryClaims(replay.emailDeliveries)) {
        await deliverInquiryEmails(replay.id);
      }
      return { success: true, message: SUCCESS_MESSAGE };
    }

    const requestHeaders = await headers();
    const trustedClientIp = requestHeaders.get("x-nf-client-connection-ip")?.trim();
    const limited = await consumeInquiryLimit({
      submissionToken: parsed.data.submissionToken,
      normalizedEmail: normalizeEmail(parsed.data.email),
      ...(trustedClientIp ? { trustedClientIp } : {}),
    });
    if (!limited.allowed) {
      return { success: false, message: "We could not receive your inquiry. Please try again later." };
    }

    const challenge = await verifyTurnstile({
      token: String(form.get(TURNSTILE_RESPONSE_FIELD) ?? ""),
      ...(trustedClientIp ? { remoteIp: trustedClientIp } : {}),
    });
    if (!challenge.ok) {
      return { success: false, message: "Verification failed. Please try again." };
    }

    const inquiry = await createInquiry(parsed.data);
    // The inquiry is committed at this point, and the visitor has succeeded.
    // Email is attempted afterwards, outside any transaction, and awaited so
    // the attempt is durably recorded before this serverless invocation may be
    // frozen. `deliverInquiryEmails` never throws and never resends for a
    // replayed submission, so neither outcome can change the answer below.
    await deliverInquiryEmails(inquiry.id);
    return { success: true, message: SUCCESS_MESSAGE };
  } catch (error) {
    if (error instanceof InvalidServiceError) return { success: false, message: error.message, errors: { serviceSlug: [error.message] } };
    return { success: false, message: "We could not receive your inquiry. Please try again." };
  }
}
