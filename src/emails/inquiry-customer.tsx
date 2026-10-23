import React from "react";

import { EmailLayout } from "@/emails/email-layout";
import {
  buildCustomerAcknowledgment,
  type InquirySnapshot,
} from "@/emails/inquiry-content";

/**
 * Customer acknowledgment.
 *
 * Confirms receipt without repeating visitor-supplied inquiry data. It makes
 * no commitment about response time or next steps.
 */
export function InquiryCustomerEmail({
  inquiry,
  studioName,
}: {
  inquiry: InquirySnapshot;
  studioName: string;
}) {
  return (
    <EmailLayout model={buildCustomerAcknowledgment(inquiry, { studioName })} />
  );
}

export default InquiryCustomerEmail;
