import { EMAIL_DELIVERY_TYPES } from "@/lib/validation/crm";

/**
 * Pure replay-cost logic, deliberately free of server-only, Prisma, and
 * environment imports so the public action, the live verifier, and unit tests
 * can all share one definition.
 */
export type DeliveryTypeName = (typeof EMAIL_DELIVERY_TYPES)[number];

/**
 * How long a claim may sit in `PROCESSING` before a retry may take it over.
 *
 * A process killed between claiming and recording the outcome — a serverless
 * invocation hitting its platform timeout, for instance — would otherwise
 * strand that delivery forever. The window is comfortably longer than any
 * plausible provider call, so a merely slow send is never stolen.
 */
export const STALE_PROCESSING_MS = 5 * 60_000;

/**
 * What an administrator may do about one recorded delivery.
 *
 * `confirm` is a `PROCESSING` row past the window: its attempt stopped before
 * recording a result, so the message may already have reached the provider.
 */
export type DeliveryRecovery = "none" | "retry" | "confirm";

export function deliveryRecovery(
  delivery: { status: "PROCESSING" | "ACCEPTED" | "FAILED" | "SKIPPED"; updatedAt: Date },
  now: Date,
): DeliveryRecovery {
  if (delivery.status === "FAILED" || delivery.status === "SKIPPED") return "retry";
  if (delivery.status !== "PROCESSING") return "none";
  return delivery.updatedAt.getTime() < now.getTime() - STALE_PROCESSING_MS ? "confirm" : "none";
}

/** The expected deliveries that have no record, in the order they are attempted. */
export function missingDeliveryTypes(
  claimed: ReadonlyArray<{ type: DeliveryTypeName }>,
): DeliveryTypeName[] {
  const seen = new Set<string>(claimed.map((row) => row.type));
  return EMAIL_DELIVERY_TYPES.filter((type) => !seen.has(type));
}

/**
 * Whether every expected delivery for an inquiry has already been claimed.
 *
 * Existence of the row is the whole question. A `FAILED` or `SKIPPED` row is a
 * *claimed* delivery that reached a definite outcome, and re-entering
 * orchestration for it would send nothing anyway; recovering one is the
 * administrator's explicit retry, never a public replay. Callers therefore
 * select `type` alone, which also keeps the replay lookup free of inquiry PII.
 */
export function hasAllDeliveryClaims(
  claimed: ReadonlyArray<{ type: DeliveryTypeName }>,
): boolean {
  return missingDeliveryTypes(claimed).length === 0;
}
