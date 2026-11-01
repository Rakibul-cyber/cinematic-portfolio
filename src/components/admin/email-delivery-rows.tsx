import { buttonClass } from "@/components/admin/admin-styles";
import { deliveryRecovery, missingDeliveryTypes } from "@/lib/email/delivery-claims";

/**
 * Transactional email state for one inquiry.
 *
 * Deliberately small: two rows, a plain-language status, and a recovery action
 * where one is possible. Phase 7 extends the inquiry page only — there is no
 * email dashboard, template editor, or delivery analytics.
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

const STALE_TEXT = "Attempt stopped before its result was recorded — the email may or may not have been sent";

function DuplicateRiskConfirmation({ label }: { label: string }) {
  return (
    <label className="mt-3 flex items-start gap-2 text-sm">
      <input className="mt-1" name="confirmDuplicateRisk" required type="checkbox" value="yes" />
      <span>{label}</span>
    </label>
  );
}

export function EmailDeliveryRows({
  deliveries,
  inquiryId,
  retryAction,
  recoverAction,
  anonymized = false,
  now = new Date(),
}: {
  deliveries: Delivery[];
  inquiryId: string;
  retryAction: (form: FormData) => Promise<void>;
  recoverAction: (form: FormData) => Promise<void>;
  anonymized?: boolean;
  now?: Date;
}) {
  const missing = missingDeliveryTypes(deliveries);

  return (
    <ul className="mt-3 grid gap-3">
      {deliveries.map((delivery) => {
        const recovery = anonymized ? "none" : deliveryRecovery(delivery, now);

        return (
          <li className="border border-border p-3" key={delivery.type}>
            <p className="font-medium">{LABEL[delivery.type]}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {recovery === "confirm" ? STALE_TEXT : STATUS_TEXT[delivery.status]}
              {delivery.status === "ACCEPTED" && delivery.sentAt
                ? ` · ${delivery.sentAt.toLocaleString()}`
                : ` · last attempted ${delivery.updatedAt.toLocaleString()}`}
              {delivery.attemptCount > 1
                ? ` · ${delivery.attemptCount} attempts`
                : null}
            </p>
            {recovery !== "none" ? (
              <form action={retryAction} className="mt-3">
                <input type="hidden" name="inquiryId" value={inquiryId} />
                <input type="hidden" name="type" value={delivery.type} />
                {delivery.status === "FAILED" ? (
                  <p className="text-sm text-muted-foreground">If the provider did accept the earlier attempt, a retry sends a second email.</p>
                ) : null}
                {recovery === "confirm" ? (
                  <DuplicateRiskConfirmation label="I understand this may send a duplicate email. The provider can usually catch a duplicate for about 24 hours after the original attempt, but not after that." />
                ) : null}
                <button className={`${buttonClass} mt-3`}>Retry email</button>
              </form>
            ) : null}
          </li>
        );
      })}
      {missing.map((type) => (
        <li className="border border-border p-3" key={type}>
          <p className="font-medium">{LABEL[type]}</p>
          <p className="mt-1 text-sm text-muted-foreground">No email has been attempted</p>
        </li>
      ))}
      {missing.length > 0 && !anonymized ? (
        <li className="border border-border p-3">
          <form action={recoverAction}>
            <input type="hidden" name="inquiryId" value={inquiryId} />
            <p className="text-sm text-muted-foreground">
              Sends only the emails listed as not attempted. A customer acknowledgment would reach the visitor late, and says only that the inquiry was received.
            </p>
            <DuplicateRiskConfirmation label="I understand this may send a duplicate email if a delivery record was removed from the database by hand. Otherwise, the records show these emails were never attempted." />
            <button className={`${buttonClass} mt-3`}>Send missing emails</button>
          </form>
        </li>
      ) : null}
    </ul>
  );
}
