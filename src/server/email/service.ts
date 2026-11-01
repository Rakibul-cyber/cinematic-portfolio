import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import {
  EmailDeliveryStatus,
  EmailDeliveryType,
} from "@/generated/prisma/enums";
import {
  buildAdminNotification,
  buildCustomerAcknowledgment,
  type InquirySnapshot,
} from "@/emails/inquiry-content";
import { isEmailAddress, type MailAddress } from "@/lib/email/address";
import {
  deliveryDuplicateRisk,
  DUPLICATE_EVIDENCE_ACTIONS,
  missingDeliveryTypes,
  STALE_PROCESSING_MS,
  type DuplicateRisk,
} from "@/lib/email/delivery-claims";
import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import type { AdminUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import {
  createResendSender,
  type EmailSender,
  type OutboundEmail,
} from "@/server/email/client";
import { getEmailConfig, type EmailConfig } from "@/server/email/config";
import {
  claimFinishedDelivery,
  claimNewDelivery,
  claimStaleDelivery,
  type ClaimedDelivery,
} from "@/server/email/delivery-claim-queries";
import type { RenderedEmail, RenderInput } from "@/server/email/render";

/**
 * Transactional email orchestration.
 *
 * The governing rule of this phase: **the inquiry is committed before anything
 * here runs.** Nothing in this module participates in the CRM transaction, and
 * no failure here can roll back, alter, or hide a stored inquiry. A Resend
 * outage costs the studio a notification, never a lead.
 *
 * Delivery is claimed by *creating* the `EmailDelivery` row. The unique
 * constraint on (inquiryId, type) means exactly one request can win that
 * insert, so a replayed submission or a double click cannot produce a second
 * provider call. Each database write is a single short statement; the provider
 * call and the React render both happen with no transaction open.
 *
 * Holding no transaction across the provider call has one consequence: no
 * database lock can cover the send itself. Claims coordinate with anonymization
 * (see `delivery-claim-queries.ts`) and each worker re-checks just before
 * sending, but an erasure that commits in the moment after that check cannot stop
 * a message already on its way, and nothing here can recall one the provider has.
 */

export const EMAIL_DELIVERY_TYPES = [
  EmailDeliveryType.INQUIRY_ADMIN_NOTIFICATION,
  EmailDeliveryType.INQUIRY_CUSTOMER_ACKNOWLEDGMENT,
] as const;

/** Fields the templates need. No mutable Customer data is ever read. */
const snapshotSelect = {
  id: true,
  createdAt: true,
  nameSnapshot: true,
  emailSnapshot: true,
  phoneSnapshot: true,
  whatsappSnapshot: true,
  companySnapshot: true,
  serviceNameSnapshot: true,
  projectType: true,
  projectDate: true,
  location: true,
  budgetLabel: true,
  referralSource: true,
  message: true,
} as const;

export type DeliveryOutcome = {
  type: EmailDeliveryType;
  status: EmailDeliveryStatus;
  /** True when another request already owned this delivery. */
  alreadyClaimed?: boolean;
  /** True when a newer attempt took this delivery over, so `status` is that attempt's. */
  superseded?: boolean;
  /** True when the inquiry was erased after the claim, so nothing was sent. */
  erased?: boolean;
};

export type EmailRenderer = {
  renderAdminNotification(input: RenderInput): Promise<RenderedEmail>;
  renderCustomerAcknowledgment(input: RenderInput): Promise<RenderedEmail>;
};

export type DeliveryDependencies = {
  /** Injected in tests. Omitted in production so Resend is used. */
  sender?: EmailSender | null;
  renderer?: EmailRenderer;
  config?: EmailConfig;
  studioName?: string;
  /**
   * The administrator accepted that this may send a second email. Required
   * wherever the records cannot rule that out: a stale `PROCESSING` delivery may
   * already have reached the provider, and a missing record is only proof of no
   * attempt if nobody removed it from the database by hand.
   */
  confirmedDuplicateRisk?: boolean;
};

/**
 * Loads React Email only when it is actually needed, so a fake renderer can
 * keep `react-dom/server` out of the module graph entirely.
 */
async function defaultRenderer(): Promise<EmailRenderer> {
  const templates = await import("@/server/email/render");
  return {
    renderAdminNotification: templates.renderAdminNotification,
    renderCustomerAcknowledgment: templates.renderCustomerAcknowledgment,
  };
}

async function resolveStudioName(provided?: string): Promise<string> {
  if (provided) return provided;

  const settings = await prisma.siteSetting.findUnique({
    where: { id: "primary" },
    select: { studioName: true },
  });

  return settings?.studioName ?? "The studio";
}

function adminInquiryUrl(config: EmailConfig, inquiryId: string): string | null {
  if (!config.configured || !config.appBaseUrl) return null;

  // Built from configured origin plus an opaque identifier only. No visitor
  // name, email, or message ever reaches a URL.
  return `${config.appBaseUrl.replace(/\/$/, "")}/admin/inquiries/${inquiryId}`;
}

/** Why a claimed delivery was skipped when its inquiry was erased before the send. */
const INQUIRY_ANONYMIZED = "inquiry_anonymized";

/** A claimed delivery and the worker's ownership token. */
type OwnedDelivery = ClaimedDelivery & { claimedAt: Date };

/**
 * Matches a delivery only while this worker still owns it.
 *
 * The attempt number and idempotency key cannot tell two workers apart, because a
 * stale takeover deliberately keeps both. The `updatedAt` each claim writes can:
 * only a claim or a recorded result changes it, and a takeover cannot happen
 * within five minutes of the claim it replaces.
 */
const ownedBy = (delivery: OwnedDelivery) => ({
  id: delivery.id,
  status: EmailDeliveryStatus.PROCESSING,
  attemptCount: delivery.attemptCount,
  updatedAt: delivery.claimedAt,
});

type DeliveryResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string }
  | { skipped: true; reason?: string };

/**
 * Records the result of one attempt, if this worker still owns the delivery.
 *
 * Returns the status written, or `null` when a newer attempt owns the record.
 *
 * A single short update. `lastErrorCode` is cleared on success so a recovered
 * delivery does not keep displaying a stale failure.
 */
async function finish(
  delivery: OwnedDelivery,
  provider: string | null,
  result: DeliveryResult,
): Promise<EmailDeliveryStatus | null> {
  const write = async (data: Prisma.EmailDeliveryUpdateManyMutationInput, status: EmailDeliveryStatus) => {
    const { count } = await prisma.emailDelivery.updateMany({ where: ownedBy(delivery), data: { ...data, status } });
    return count === 1 ? status : null;
  };

  if ("skipped" in result) {
    return write({ provider: null, ...(result.reason ? { lastErrorCode: result.reason } : {}) }, EmailDeliveryStatus.SKIPPED);
  }

  if (result.ok) {
    return write(
      { provider, providerMessageId: result.providerMessageId, sentAt: new Date(), lastErrorCode: null },
      EmailDeliveryStatus.ACCEPTED,
    );
  }

  return write({ provider, lastErrorCode: result.errorCode.slice(0, 64) }, EmailDeliveryStatus.FAILED);
}

/**
 * Audit metadata carries operational values only.
 *
 * No recipient address, no subject, no message body, no provider payload — an
 * inquiry id, a delivery type, and a status are enough to reconstruct what
 * happened without copying personal data into a second table.
 */
async function auditDelivery(
  action: string,
  delivery: { id: string; inquiryId: string; type: EmailDeliveryType },
  status: EmailDeliveryStatus,
  actor?: AdminUser,
): Promise<void> {
  await recordAuditLog({
    action,
    entityType: AuditEntityType.EmailDelivery,
    entityId: delivery.id,
    // Public submissions have no actor: the existing null/public semantics are
    // used rather than inventing an administrator who did not act.
    actorUserId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    metadata: {
      inquiryId: delivery.inquiryId,
      type: delivery.type,
      status,
    },
  });
}

/**
 * Records a result and its audit entry, and answers with the delivery's state.
 *
 * A worker that lost ownership cannot change the record, but what it did still
 * happened: an accepted message from an older worker is the evidence that a
 * second email may exist, so it goes in the audit trail instead.
 */
async function settle(
  delivery: OwnedDelivery,
  provider: string | null,
  result: DeliveryResult,
  action: string,
  actor?: AdminUser,
): Promise<DeliveryOutcome> {
  const status = await finish(delivery, provider, result);
  if (status) {
    await auditDelivery(action, delivery, status, actor);
    return { type: delivery.type, status };
  }

  await recordAuditLog({
    action: AuditAction.EmailDeliveryResultSuperseded,
    entityType: AuditEntityType.EmailDelivery,
    entityId: delivery.id,
    actorUserId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    metadata: {
      inquiryId: delivery.inquiryId,
      type: delivery.type,
      attempt: delivery.attemptCount,
      result: "skipped" in result ? EmailDeliveryStatus.SKIPPED : result.ok ? EmailDeliveryStatus.ACCEPTED : EmailDeliveryStatus.FAILED,
    },
  });
  const current = await prisma.emailDelivery.findUnique({ where: { id: delivery.id }, select: { status: true } });
  return { type: delivery.type, status: current?.status ?? EmailDeliveryStatus.PROCESSING, superseded: true };
}

/**
 * The last check before a provider call: whether this worker still owns the
 * delivery, and whether the inquiry has been erased since the claim.
 */
async function preSendCheck(delivery: OwnedDelivery): Promise<"send" | "superseded" | "erased"> {
  const current = await prisma.emailDelivery.findUnique({
    where: { id: delivery.id },
    select: { status: true, attemptCount: true, updatedAt: true, inquiry: { select: { anonymizedAt: true } } },
  });
  if (
    !current ||
    current.status !== EmailDeliveryStatus.PROCESSING ||
    current.attemptCount !== delivery.attemptCount ||
    current.updatedAt.getTime() !== delivery.claimedAt.getTime()
  ) {
    return "superseded";
  }
  return current.inquiry.anonymizedAt ? "erased" : "send";
}

/**
 * Provider idempotency key for one attempt.
 *
 * Scoped to the attempt rather than the delivery: two copies of the *same*
 * attempt reaching Resend collapse into one message, while a deliberate manual
 * retry gets a fresh key and genuinely sends. Keying on the delivery alone
 * would make retries silently no-ops.
 */
function idempotencyKey(
  inquiryId: string,
  type: EmailDeliveryType,
  attempt: number,
): string {
  return `${inquiryId}:${type}:${attempt}`;
}

function buildOutbound(
  type: EmailDeliveryType,
  inquiry: InquirySnapshot,
  config: Extract<EmailConfig, { configured: true }>,
  rendered: RenderedEmail,
  studioName: string,
  key: string,
): OutboundEmail | null {
  if (type === EmailDeliveryType.INQUIRY_ADMIN_NOTIFICATION) {
    // Reply-To is the visitor's own address so the studio can simply reply.
    // It is re-validated here even though Zod already accepted it: an address
    // that reaches an envelope is checked at the boundary that uses it.
    const replyTo: MailAddress | null = isEmailAddress(inquiry.emailSnapshot)
      ? { address: inquiry.emailSnapshot.trim(), name: inquiry.nameSnapshot }
      : null;

    return {
      from: config.from,
      to: config.adminRecipients,
      replyTo,
      subject: buildAdminNotification(inquiry).subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: key,
    };
  }

  // The acknowledgment goes to the address that was actually submitted, not to
  // the mutable Customer record, so it always matches this exact submission.
  if (!isEmailAddress(inquiry.emailSnapshot)) return null;

  return {
    from: config.from,
    to: [{ address: inquiry.emailSnapshot.trim(), name: inquiry.nameSnapshot }],
    replyTo: config.replyTo,
    subject: buildCustomerAcknowledgment(inquiry, { studioName }).subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: key,
  };
}

/**
 * Performs one claimed delivery: render, send, record.
 *
 * Runs with no transaction open, and never throws — an unexpected error is
 * recorded as a failure so the delivery stays visible and retryable.
 */
async function performDelivery(
  delivery: OwnedDelivery,
  inquiry: InquirySnapshot,
  dependencies: DeliveryDependencies,
  actor?: AdminUser,
): Promise<DeliveryOutcome> {
  const config = dependencies.config ?? getEmailConfig();

  if (!config.configured) {
    return settle(delivery, null, { skipped: true }, AuditAction.EmailDeliverySkipped, actor);
  }

  const sender =
    dependencies.sender === undefined
      ? createResendSender(config.apiKey)
      : dependencies.sender;

  if (!sender) {
    return settle(delivery, null, { skipped: true }, AuditAction.EmailDeliverySkipped, actor);
  }

  try {
    const studioName = await resolveStudioName(dependencies.studioName);
    const renderer = dependencies.renderer ?? (await defaultRenderer());
    const input: RenderInput = {
      inquiry,
      studioName,
      adminUrl: adminInquiryUrl(config, inquiry.id),
    };

    const rendered =
      delivery.type === EmailDeliveryType.INQUIRY_ADMIN_NOTIFICATION
        ? await renderer.renderAdminNotification(input)
        : await renderer.renderCustomerAcknowledgment(input);

    const outbound = buildOutbound(
      delivery.type,
      inquiry,
      config,
      rendered,
      studioName,
      idempotencyKey(delivery.inquiryId, delivery.type, delivery.attemptCount),
    );

    if (!outbound) {
      return await settle(delivery, sender.provider, { ok: false, errorCode: "invalid_recipient" }, AuditAction.EmailDeliveryFailed, actor);
    }

    const check = await preSendCheck(delivery);
    if (check === "superseded") {
      const current = await prisma.emailDelivery.findUnique({ where: { id: delivery.id }, select: { status: true } });
      return { type: delivery.type, status: current?.status ?? EmailDeliveryStatus.PROCESSING, superseded: true };
    }
    if (check === "erased") {
      const outcome = await settle(delivery, null, { skipped: true, reason: INQUIRY_ANONYMIZED }, AuditAction.EmailDeliverySkipped, actor);
      return { ...outcome, erased: true };
    }

    const result = await sender.send(outbound);
    return await settle(
      delivery,
      sender.provider,
      result,
      result.ok ? AuditAction.EmailDeliveryAccepted : AuditAction.EmailDeliveryFailed,
      actor,
    );
  } catch {
    // Nothing from the thrown value is stored or logged: it may carry provider
    // detail or recipient data. Only a bounded category is kept.
    return settle(delivery, sender.provider, { ok: false, errorCode: "unexpected_error" }, AuditAction.EmailDeliveryFailed, actor);
  }
}

/**
 * Attempts both transactional emails for an inquiry that is already stored.
 *
 * Safe to call more than once: the claim insert fails for any delivery that has
 * already been attempted, so a replayed submission sends nothing again.
 *
 * Never throws. The caller is a public Server Action whose success has already
 * been decided by the database commit.
 */
export async function deliverInquiryEmails(
  inquiryId: string,
  dependencies: DeliveryDependencies = {},
): Promise<DeliveryOutcome[]> {
  return attemptUnclaimedDeliveries(inquiryId, dependencies);
}

/** Claims and sends whichever deliveries have no record. `actor` is absent for a public submission. */
async function attemptUnclaimedDeliveries(
  inquiryId: string,
  dependencies: DeliveryDependencies,
  actor?: AdminUser,
): Promise<DeliveryOutcome[]> {
  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { ...snapshotSelect, anonymizedAt: true },
    });

    // An erased inquiry has no deliverable recipient and no content worth
    // sending. This path is reachable unauthenticated through the idempotent
    // replay branch of the public action, so the guard belongs here and not
    // only on the administrator retry path.
    if (!inquiry || inquiry.anonymizedAt) return [];

    const outcomes: DeliveryOutcome[] = [];

    for (const type of EMAIL_DELIVERY_TYPES) {
      // Creating the row is the claim. Losing this race means another request
      // owns the delivery, and this one must not send anything.
      const claimedAt = new Date();
      const [claimed] = await prisma.$queryRaw<ClaimedDelivery[]>(
        claimNewDelivery({ id: randomUUID(), inquiryId, type, claimedAt }),
      );

      if (!claimed) {
        const existing = await prisma.emailDelivery.findUnique({
          where: { inquiryId_type: { inquiryId, type } },
          select: { status: true },
        });
        // No record and no claim means the inquiry was erased after the read above.
        if (existing) outcomes.push({ type, status: existing.status, alreadyClaimed: true });
        continue;
      }

      outcomes.push(await performDelivery({ ...claimed, claimedAt }, inquiry, dependencies, actor));
    }

    return outcomes;
  } catch (error) {
    // A stored inquiry must never be reported as failed because email broke.
    console.error(
      "[email] Delivery orchestration failed for inquiry",
      inquiryId,
      error instanceof Error ? error.name : "unknown",
    );
    return [];
  }
}

export class DeliveryNotRetryableError extends Error {}

/** Each delivery's duplicate risk. Reads only the action and metadata, never an actor. */
async function duplicateRisks(deliveries: Array<{ id: string; lastErrorCode: string | null }>): Promise<Map<string, DuplicateRisk>> {
  const evidence = deliveries.length
    ? await prisma.auditLog.findMany({
        where: {
          entityType: AuditEntityType.EmailDelivery,
          entityId: { in: deliveries.map((delivery) => delivery.id) },
          action: { in: Object.values(DUPLICATE_EVIDENCE_ACTIONS) },
        },
        select: { entityId: true, action: true, metadata: true },
      })
    : [];
  return new Map(deliveries.map((delivery) => [
    delivery.id,
    deliveryDuplicateRisk(delivery.lastErrorCode, evidence.filter((entry) => entry.entityId === delivery.id)),
  ]));
}

/**
 * Re-attempts one delivery on an administrator's request.
 *
 * The claim is a conditional update rather than an insert: only a delivery that
 * is currently `FAILED`, `SKIPPED`, or stale-`PROCESSING` can be taken, and
 * the statement returning a row is what proves this request won.
 * An already-`ACCEPTED` delivery can never be taken, so a retry cannot resend a
 * message the provider already accepted. A stale `PROCESSING` delivery is only
 * taken with `confirmedDuplicateRisk`, as is any delivery with evidence that an
 * earlier attempt may have reached the provider. A new attempt has a new
 * idempotency key, so the provider could not collapse the two.
 */
export async function retryInquiryEmail(
  inquiryId: string,
  type: EmailDeliveryType,
  actor: AdminUser,
  dependencies: DeliveryDependencies = {},
): Promise<DeliveryOutcome> {
  if (!dependencies.confirmedDuplicateRisk) {
    const current = await prisma.emailDelivery.findUnique({
      where: { inquiryId_type: { inquiryId, type } },
      select: { id: true, lastErrorCode: true },
    });
    if (current && (await duplicateRisks([current])).get(current.id) !== "none") {
      throw new DeliveryNotRetryableError("This email may already have been sent. Confirm the duplicate risk before retrying.");
    }
  }

  const claimedAt = new Date();
  const staleBefore = new Date(claimedAt.getTime() - STALE_PROCESSING_MS);

  // A definite FAILED/SKIPPED result starts a new logical provider attempt and
  // therefore gets a new key. A stale PROCESSING row is different: the prior
  // request may already have reached Resend before this process died, so keep
  // its durable attempt number and replay the same key. Resend can then return
  // the original result instead of accepting a duplicate during its 24-hour
  // idempotency window.
  let [claimed] = await prisma.$queryRaw<ClaimedDelivery[]>(claimFinishedDelivery({ inquiryId, type, claimedAt }));

  const definiteOutcome = claimed !== undefined;

  if (!claimed && dependencies.confirmedDuplicateRisk) {
    [claimed] = await prisma.$queryRaw<ClaimedDelivery[]>(claimStaleDelivery({ inquiryId, type, claimedAt, staleBefore }));
  }

  if (!claimed) {    throw new DeliveryNotRetryableError(
      dependencies.confirmedDuplicateRisk
        ? "This email cannot be retried right now."
        : "This email cannot be retried right now. If its last attempt stopped, confirm the duplicate risk first.",
    );
  }

  const delivery: OwnedDelivery = { ...claimed, claimedAt };

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: { ...snapshotSelect, anonymizedAt: true },
  });

  if (!inquiry || inquiry.anonymizedAt) {
    await finish(delivery, null, { skipped: true, reason: INQUIRY_ANONYMIZED });
    throw new DeliveryNotRetryableError("This inquiry no longer exists.");
  }

  await recordAuditLog({
    action: AuditAction.EmailDeliveryRetried,
    entityType: AuditEntityType.EmailDelivery,
    entityId: delivery.id,
    actorUserId: actor.id,
    actorEmail: actor.email,
    metadata: { inquiryId, type, ...(definiteOutcome ? {} : { staleProcessing: true }) },
  });

  return performDelivery(delivery, inquiry, dependencies, actor);
}

/**
 * Sends the emails an inquiry has no delivery record for, on an administrator's
 * request.
 *
 * A record is created before any provider call, so a missing one means the
 * application never attempted that email. This goes through the same claim as a
 * submission: the unique constraint lets one request win each record, existing
 * records are left alone, and no inquiry is created.
 */
export async function recoverMissingInquiryEmails(
  inquiryId: string,
  actor: AdminUser,
  dependencies: DeliveryDependencies = {},
): Promise<DeliveryOutcome[]> {
  if (!dependencies.confirmedDuplicateRisk) {
    throw new DeliveryNotRetryableError("Confirm the duplicate risk before sending missing emails.");
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: { anonymizedAt: true, emailDeliveries: { select: { type: true } } },
  });

  if (!inquiry || inquiry.anonymizedAt) {
    throw new DeliveryNotRetryableError("This inquiry no longer exists.");
  }

  const missing = missingDeliveryTypes(inquiry.emailDeliveries);
  if (missing.length === 0) {
    throw new DeliveryNotRetryableError("No email records are missing for this inquiry.");
  }

  await recordAuditLog({
    action: AuditAction.EmailDeliveryRecoveryRequested,
    entityType: AuditEntityType.Inquiry,
    entityId: inquiryId,
    actorUserId: actor.id,
    actorEmail: actor.email,
    metadata: { inquiryId, types: missing },
  });

  return attemptUnclaimedDeliveries(inquiryId, dependencies, actor);
}

/** Delivery state for the admin inquiry page. */
export async function getInquiryDeliveries(inquiryId: string) {
  const deliveries = await prisma.emailDelivery.findMany({
    where: { inquiryId },
    orderBy: [{ type: "asc" }],
    select: {
      id: true,
      type: true,
      status: true,
      attemptCount: true,
      lastErrorCode: true,
      sentAt: true,
      updatedAt: true,
    },
  });
  const risks = await duplicateRisks(deliveries);
  return deliveries.map(({ id, ...delivery }) => ({ ...delivery, duplicateRisk: risks.get(id) ?? "none" }));
}
