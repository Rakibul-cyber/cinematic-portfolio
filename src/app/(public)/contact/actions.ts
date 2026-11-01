"use server";
import { headers } from "next/headers";
import { isInquiryIntakeOpen } from "@/content/legal";
import { createInquiry } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import { deliverInquiryEmails } from "@/server/email/service";
import { logInquiryFailure } from "@/server/inquiry/failure-log";
import { submitInquiryWorkflow, type InquiryFormState, type SubmitInquiryDependencies } from "@/server/inquiry/submit-inquiry";
import { consumeInquiryLimit } from "@/server/security/rate-limit";
import { verifyTurnstile } from "@/server/security/turnstile";

export type { InquiryFormState };

const dependencies: SubmitInquiryDependencies = {
  isIntakeOpen: () => isInquiryIntakeOpen(),
  findReplay: (submissionToken) =>
    prisma.inquiry.findUnique({
      where: { submissionToken },
      select: { id: true, emailDeliveries: { select: { type: true } } },
    }),
  getTrustedClientIp: async () => (await headers()).get("x-nf-client-connection-ip")?.trim(),
  consumeLimit: consumeInquiryLimit,
  verifyTurnstile: (input) => verifyTurnstile(input),
  createInquiry,
  deliverEmails: (inquiryId) => deliverInquiryEmails(inquiryId),
  logFailure: logInquiryFailure,
};

/** The public inquiry action: the workflow in `submit-inquiry.ts`, bound to the real services. */
export async function submitInquiry(_: InquiryFormState, form: FormData): Promise<InquiryFormState> {
  return submitInquiryWorkflow(form, dependencies);
}
