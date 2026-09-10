import "server-only";

import { Resend } from "resend";

import { formatMailAddress, type MailAddress } from "@/lib/email/address";

/**
 * Provider boundary.
 *
 * A deliberately small seam around Resend: one `EmailSender` interface with one
 * method. It exists so the orchestration in `service.ts` can be tested with a
 * fake, and so a provider change would touch this file alone — not to build a
 * generic multi-provider framework, which this application does not need.
 *
 * Nothing above this file imports the Resend SDK, and nothing below it knows
 * about inquiries or delivery records.
 *
 * ## Timeouts
 *
 * The installed SDK's request options are `{ query, headers, idempotencyKey }`
 * — it accepts no `AbortSignal` and no timeout. Racing a timer against the call
 * was considered and rejected: it would abandon the caller without cancelling
 * the HTTP request, so a message the provider actually accepted would look like
 * a failure and a manual retry could then genuinely duplicate it. Instead the
 * call is left to the platform's own function timeout, and a delivery stranded
 * in `PROCESSING` by that timeout is recoverable through the stale-claim retry
 * path in `service.ts`.
 */

export type OutboundEmail = {
  from: MailAddress;
  to: MailAddress[];
  replyTo?: MailAddress | null;
  subject: string;
  html: string;
  text: string;
  /**
   * Sent as the provider's `Idempotency-Key`. Two identical attempts that both
   * reach Resend are collapsed provider-side into one message.
   */
  idempotencyKey?: string;
};

/** What the provider reports back. Never the raw SDK response. */
export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string };

export type EmailSender = {
  readonly provider: string;
  send(email: OutboundEmail): Promise<SendResult>;
};

/**
 * Reduces an unknown provider error to a short, safe category.
 *
 * Raw provider payloads can carry recipient addresses and operational detail,
 * and are never stored or logged. Only these bounded codes are persisted.
 */
export function toErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = String((error as { name: unknown }).name);
    // Resend error names are short, stable identifiers such as
    // `validation_error` or `rate_limit_exceeded`.
    if (/^[a-z0-9_]{1,64}$/.test(name)) return name;
  }

  return "provider_error";
}

/** Creates the real Resend-backed sender. */
export function createResendSender(apiKey: string): EmailSender {
  const resend = new Resend(apiKey);

  return {
    provider: "resend",
    async send(email) {
      try {
        const result = await resend.emails.send(
          {
            from: formatMailAddress(email.from),
            to: email.to.map(formatMailAddress),
            ...(email.replyTo
              ? { replyTo: formatMailAddress(email.replyTo) }
              : {}),
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
          email.idempotencyKey
            ? { idempotencyKey: email.idempotencyKey }
            : undefined,
        );

        if (result.error) {
          return { ok: false, errorCode: toErrorCode(result.error) };
        }

        return { ok: true, providerMessageId: result.data?.id ?? null };
      } catch (error) {
        return { ok: false, errorCode: toErrorCode(error) };
      }
    },
  };
}
