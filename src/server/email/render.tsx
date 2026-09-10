import "server-only";

import React from "react";
import { render } from "@react-email/components";

import { InquiryAdminEmail } from "@/emails/inquiry-admin";
import { InquiryCustomerEmail } from "@/emails/inquiry-customer";
import type { InquirySnapshot } from "@/emails/inquiry-content";

/**
 * React Email rendering.
 *
 * Kept in its own module and reached through a dynamic import so the
 * orchestration in `service.ts` can be exercised with a fake renderer that
 * never loads React DOM. That matters in practice: `react-dom/server` refuses
 * to load under the `react-server` export condition, which is what the
 * repository's verifier scripts run under. Inside Next.js the render works
 * normally, which is where it actually runs.
 *
 * Both messages are produced as HTML and as plain text from the same component
 * tree, so a text-only client sees the same content rather than a fallback.
 */

export type RenderedEmail = { html: string; text: string };

export type RenderInput = {
  inquiry: InquirySnapshot;
  studioName: string;
  adminUrl: string | null;
};

async function renderBoth(element: React.ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { html, text };
}

export function renderAdminNotification(
  input: RenderInput,
): Promise<RenderedEmail> {
  return renderBoth(
    <InquiryAdminEmail inquiry={input.inquiry} adminUrl={input.adminUrl} />,
  );
}

export function renderCustomerAcknowledgment(
  input: RenderInput,
): Promise<RenderedEmail> {
  return renderBoth(
    <InquiryCustomerEmail
      inquiry={input.inquiry}
      studioName={input.studioName}
    />,
  );
}
