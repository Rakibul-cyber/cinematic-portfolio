import { EMAIL_DELIVERY_TYPES } from "@/lib/validation/crm";

/**
 * Pure replay-cost logic, deliberately free of server-only, Prisma, and
 * environment imports so the public action, the live verifier, and unit tests
 * can all share one definition.
 */
export type DeliveryTypeName = (typeof EMAIL_DELIVERY_TYPES)[number];

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
  const seen = new Set<string>(claimed.map((row) => row.type));
  return EMAIL_DELIVERY_TYPES.every((type) => seen.has(type));
}
