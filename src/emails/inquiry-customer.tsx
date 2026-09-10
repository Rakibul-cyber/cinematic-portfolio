import React from "react";

import { EmailLayout } from "@/emails/email-layout";
import {
  buildCustomerAcknowledgment,
  type InquirySnapshot,
} from "@/emails/inquiry-content";

/**
 * Customer acknowledgment.
 *
 * Confirms receipt and echoes the submission back. It makes no commitment about
 * response time or next steps, because none is configured anywhere in the
 * system and the studio has not made one.
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
