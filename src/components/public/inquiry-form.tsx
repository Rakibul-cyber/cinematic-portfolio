"use client";
import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";
import { submitInquiry } from "@/app/(public)/contact/actions";
import { InquiryFormView } from "@/components/public/inquiry-form-view";
import { withUnconfirmedRecovery } from "@/lib/public/inquiry-form";
import { reportUnconfirmedSubmission } from "@/lib/monitoring/report";
import type { PublicService } from "@/server/public/view-models";

// Module scope keeps the action referentially stable for `useActionState`.
// Both helpers are Next.js's public ones: `unstable_rethrow` lets redirect and
// not-found errors through a catch, and `unstable_isUnrecognizedActionError`
// recognizes an action the server no longer knows.
const submitWithRecovery = withUnconfirmedRecovery(submitInquiry, {
  isUnrecognizedAction: unstable_isUnrecognizedActionError,
  report: reportUnconfirmedSubmission,
  rethrowFrameworkError: unstable_rethrow,
});
export function InquiryForm({ services, turnstileSiteKey }: { services: PublicService[]; turnstileSiteKey: string | null }) {
  return <InquiryFormView services={services} submitAction={submitWithRecovery} turnstileSiteKey={turnstileSiteKey}/>;
}
