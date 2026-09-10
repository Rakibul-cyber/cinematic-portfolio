import React from "react";

import { EmailLayout } from "@/emails/email-layout";
import {
  buildAdminNotification,
  type InquirySnapshot,
} from "@/emails/inquiry-content";

/**
 * Studio inquiry notification.
 *
 * Content comes entirely from the Inquiry snapshot, never from the mutable
 * Customer record, so the studio reads exactly what the visitor submitted.
 */
export function InquiryAdminEmail({
  adminUrl,
  inquiry,
}: {
  inquiry: InquirySnapshot;
  adminUrl?: string | null;
}) {
  return <EmailLayout model={buildAdminNotification(inquiry, { adminUrl })} />;
}

export default InquiryAdminEmail;
