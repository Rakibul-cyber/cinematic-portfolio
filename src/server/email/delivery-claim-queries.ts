import { Prisma } from "@/generated/prisma/client";
import type { EmailDeliveryType } from "@/generated/prisma/enums";

/**
 * The statements that claim a delivery.
 *
 * Each is one statement, because its erasure check and its write must not be
 * separable. `FOR SHARE` on the inquiry is what coordinates with anonymization,
 * whose update takes a conflicting row lock: a claim that meets an uncommitted
 * anonymization waits for it, then sees the committed row and claims nothing.
 * Without the lock, the check would read the old row and claim anyway. A claim
 * that goes first holds the lock only for its own statement, and anonymization
 * proceeds once it commits.
 *
 * `claimedAt` becomes `updatedAt`, and is the worker's ownership token: see
 * `ownedBy` in `service.ts`. Parameters are cast because an `INSERT ... SELECT`
 * gives them no column type to infer.
 */

export type ClaimedDelivery = {
  id: string;
  inquiryId: string;
  type: EmailDeliveryType;
  attemptCount: number;
};

const RETURNED = Prisma.sql`RETURNING "id", "inquiryId", "type", "attemptCount"`;

const notErased = (inquiryId: string) => Prisma.sql`EXISTS (
    SELECT 1 FROM "inquiry"
    WHERE "inquiry"."id" = ${inquiryId}::text AND "inquiry"."anonymizedAt" IS NULL
    FOR SHARE
  )`;

/** Creates the record. Returns no row if one already exists or the inquiry is erased. */
export const claimNewDelivery = (input: { id: string; inquiryId: string; type: EmailDeliveryType; claimedAt: Date }) => Prisma.sql`
  INSERT INTO "email_delivery" ("id", "inquiryId", "type", "status", "attemptCount", "updatedAt")
  SELECT ${input.id}::text, "inquiry"."id", ${input.type}::"EmailDeliveryType", 'PROCESSING'::"EmailDeliveryStatus", 1, ${input.claimedAt}::timestamp(3)
  FROM "inquiry"
  WHERE "inquiry"."id" = ${input.inquiryId}::text AND "inquiry"."anonymizedAt" IS NULL
  FOR SHARE
  ON CONFLICT ("inquiryId", "type") DO NOTHING
  ${RETURNED}`;

/** Takes a delivery with a definite result, as a new attempt with a new idempotency key. */
export const claimFinishedDelivery = (input: { inquiryId: string; type: EmailDeliveryType; claimedAt: Date }) => Prisma.sql`
  UPDATE "email_delivery"
  SET "status" = 'PROCESSING'::"EmailDeliveryStatus", "attemptCount" = "attemptCount" + 1, "updatedAt" = ${input.claimedAt}::timestamp(3)
  WHERE "inquiryId" = ${input.inquiryId}::text
    AND "type" = ${input.type}::"EmailDeliveryType"
    AND "status" IN ('FAILED'::"EmailDeliveryStatus", 'SKIPPED'::"EmailDeliveryStatus")
    AND ${notErased(input.inquiryId)}
  ${RETURNED}`;

/** Takes over a stopped attempt, keeping its attempt number and idempotency key. */
export const claimStaleDelivery = (input: { inquiryId: string; type: EmailDeliveryType; claimedAt: Date; staleBefore: Date }) => Prisma.sql`
  UPDATE "email_delivery"
  SET "updatedAt" = ${input.claimedAt}::timestamp(3)
  WHERE "inquiryId" = ${input.inquiryId}::text
    AND "type" = ${input.type}::"EmailDeliveryType"
    AND "status" = 'PROCESSING'::"EmailDeliveryStatus"
    AND "updatedAt" < ${input.staleBefore}::timestamp(3)
    AND ${notErased(input.inquiryId)}
  ${RETURNED}`;
