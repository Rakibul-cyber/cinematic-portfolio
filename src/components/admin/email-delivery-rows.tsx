import { buttonClass } from "@/components/admin/admin-shell";

/**
 * Transactional email state for one inquiry.
 *
 * Deliberately small: two rows, a plain-language status, and a retry button
 * where a retry is possible. Phase 7 extends the inquiry page only — there is
 * no email dashboard, template editor, or delivery analytics.
 *
 * Provider message ids, raw provider errors, and configuration state are not
 * shown. An administrator needs to know whether the studio was notified and
 * whether the visitor was acknowledged; the rest is operational noise that
 * would only invite copying identifiers around.
 */

type Delivery = {
  type: "INQUIRY_ADMIN_NOTIFICATION" | "INQUIRY_CUSTOMER_ACKNOWLEDGMENT";
  status: "PROCESSING" | "ACCEPTED" | "FAILED" | "SKIPPED";
  attemptCount: number;
  lastErrorCode: string | null;
  sentAt: Date | null;
  updatedAt: Date;
};

const LABEL: Record<Delivery["type"], string> = {
  INQUIRY_ADMIN_NOTIFICATION: "Studio notification",
  INQUIRY_CUSTOMER_ACKNOWLEDGMENT: "Customer acknowledgment",
};

/**
 * Wording chosen to be honest about what is actually known. The provider
 * accepting a message is not evidence it reached an inbox, and no webhook
 * tracking exists, so nothing here says "delivered".
 */
const STATUS_TEXT: Record<Delivery["status"], string> = {
  PROCESSING: "Sending",
  ACCEPTED: "Accepted by the email provider",
  FAILED: "Not sent",
  SKIPPED: "Not attempted — email is not configured",
};

export function EmailDeliveryRows({
  deliveries,
  inquiryId,
  retryAction,
  anonymized = false,
}: {
  deliveries: Delivery[];
  inquiryId: string;
  retryAction: (form: FormData) => Promise<void>;
  anonymized?: boolean;
}) {
  if (deliveries.length === 0) {
    return (
      <p className="mt-3 text-muted-foreground">
        No email has been attempted for this inquiry.
      </p>
    );
  }

  return (
    <ul className="mt-3 grid gap-3">
      {deliveries.map((delivery) => {
        const retryable =
          !anonymized &&
          (delivery.status === "FAILED" || delivery.status === "SKIPPED");

        return (
          <li className="border border-border p-3" key={delivery.type}>
            <p className="font-medium">{LABEL[delivery.type]}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {STATUS_TEXT[delivery.status]}
              {delivery.status === "ACCEPTED" && delivery.sentAt
                ? ` · ${delivery.sentAt.toLocaleString()}`
                : ` · last attempted ${delivery.updatedAt.toLocaleString()}`}
              {delivery.attemptCount > 1
                ? ` · ${delivery.attemptCount} attempts`
                : null}
            </p>
            {retryable ? (
              <form action={retryAction} className="mt-3">
                <input type="hidden" name="inquiryId" value={inquiryId} />
                <input type="hidden" name="type" value={delivery.type} />
                <button className={buttonClass}>Retry email</button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
