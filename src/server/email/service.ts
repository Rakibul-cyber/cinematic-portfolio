import "server-only";

import { Prisma } from "@/generated/prisma/client";
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
import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import type { AdminUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import {
  createResendSender,
  type EmailSender,
  type OutboundEmail,
} from "@/server/email/client";
import { getEmailConfig, type EmailConfig } from "@/server/email/config";
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
 */

export const EMAIL_DELIVERY_TYPES = [
  EmailDeliveryType.INQUIRY_ADMIN_NOTIFICATION,
  EmailDeliveryType.INQUIRY_CUSTOMER_ACKNOWLEDGMENT,
] as const;

/**
 * How long a claim may sit in `PROCESSING` before a retry may take it over.
 *
 * A process killed between claiming and recording the outcome — a serverless
 * invocation hitting its platform timeout, for instance — would otherwise
 * strand that delivery forever. The window is comfortably longer than any
 * plausible provider call, so a merely slow send is never stolen.
 */
export const STALE_PROCESSING_MS = 5 * 60_000;

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

/**
 * Records the result of one attempt.
 *
 * A single short update. `lastErrorCode` is cleared on success so a recovered
 * delivery does not keep displaying a stale failure.
 */
async function finish(
  deliveryId: string,
  provider: string | null,
  result:
    | { ok: true; providerMessageId: string | null }
    | { ok: false; errorCode: string }
    | { skipped: true },
): Promise<EmailDeliveryStatus> {
  if ("skipped" in result) {
    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: { status: EmailDeliveryStatus.SKIPPED, provider: null },
    });
    return EmailDeliveryStatus.SKIPPED;
  }

  if (result.ok) {
    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: EmailDeliveryStatus.ACCEPTED,
        provider,
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        lastErrorCode: null,
      },
    });
    return EmailDeliveryStatus.ACCEPTED;
  }

  await prisma.emailDelivery.update({
    where: { id: deliveryId },
    data: {
      status: EmailDeliveryStatus.FAILED,
      provider,
      lastErrorCode: result.errorCode.slice(0, 64),
    },
  });
  return EmailDeliveryStatus.FAILED;
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
  delivery: {
    id: string;
    inquiryId: string;
    type: EmailDeliveryType;
    attemptCount: number;
  },
  inquiry: InquirySnapshot,
  dependencies: DeliveryDependencies,
  actor?: AdminUser,
): Promise<DeliveryOutcome> {
  const config = dependencies.config ?? getEmailConfig();

  if (!config.configured) {
    const status = await finish(delivery.id, null, { skipped: true });
    await auditDelivery(AuditAction.EmailDeliverySkipped, delivery, status, actor);
    return { type: delivery.type, status };
  }

  const sender =
    dependencies.sender === undefined
      ? createResendSender(config.apiKey)
      : dependencies.sender;

  if (!sender) {
    const status = await finish(delivery.id, null, { skipped: true });
    await auditDelivery(AuditAction.EmailDeliverySkipped, delivery, status, actor);
    return { type: delivery.type, status };
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
      const status = await finish(delivery.id, sender.provider, {
        ok: false,
        errorCode: "invalid_recipient",
      });
      await auditDelivery(AuditAction.EmailDeliveryFailed, delivery, status, actor);
      return { type: delivery.type, status };
    }

    const result = await sender.send(outbound);
    const status = await finish(delivery.id, sender.provider, result);
    await auditDelivery(
      result.ok ? AuditAction.EmailDeliveryAccepted : AuditAction.EmailDeliveryFailed,
      delivery,
      status,
      actor,
    );

    return { type: delivery.type, status };
  } catch {
    // Nothing from the thrown value is stored or logged: it may carry provider
    // detail or recipient data. Only a bounded category is kept.
    const status = await finish(delivery.id, sender.provider, {
      ok: false,
      errorCode: "unexpected_error",
    });
    await auditDelivery(AuditAction.EmailDeliveryFailed, delivery, status, actor);
    return { type: delivery.type, status };
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
  try {
    const inquiry = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: snapshotSelect,
    });

    if (!inquiry) return [];

    const outcomes: DeliveryOutcome[] = [];

    for (const type of EMAIL_DELIVERY_TYPES) {
      let delivery;

      try {
        // Creating the row is the claim. Losing this race means another
        // request owns the delivery, and this one must not send anything.
        delivery = await prisma.emailDelivery.create({
          data: {
            inquiryId,
            type,
            status: EmailDeliveryStatus.PROCESSING,
            attemptCount: 1,
          },
          select: { id: true, inquiryId: true, type: true, attemptCount: true },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const existing = await prisma.emailDelivery.findUnique({
            where: { inquiryId_type: { inquiryId, type } },
            select: { status: true },
          });
          outcomes.push({
            type,
            status: existing?.status ?? EmailDeliveryStatus.PROCESSING,
            alreadyClaimed: true,
          });
          continue;
        }
        throw error;
      }

      outcomes.push(await performDelivery(delivery, inquiry, dependencies));
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

/**
 * Re-attempts one delivery on an administrator's request.
 *
 * The claim is a conditional update rather than an insert: only a delivery that
 * is currently `FAILED`, `SKIPPED`, or stale-`PROCESSING` can be taken, and
 * `updateMany` reporting a single affected row is what proves this request won.
 * An already-`ACCEPTED` delivery can never be taken, so a retry cannot resend a
 * message the provider already accepted.
 */
export async function retryInquiryEmail(
  inquiryId: string,
  type: EmailDeliveryType,
  actor: AdminUser,
  dependencies: DeliveryDependencies = {},
): Promise<DeliveryOutcome> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  const claimed = await prisma.emailDelivery.updateMany({
    where: {
      inquiryId,
      type,
      OR: [
        { status: EmailDeliveryStatus.FAILED },
        { status: EmailDeliveryStatus.SKIPPED },
        {
          status: EmailDeliveryStatus.PROCESSING,
          updatedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      status: EmailDeliveryStatus.PROCESSING,
      attemptCount: { increment: 1 },
    },
  });

  if (claimed.count !== 1) {
    throw new DeliveryNotRetryableError(
      "This email cannot be retried right now.",
    );
  }

  const delivery = await prisma.emailDelivery.findUniqueOrThrow({
    where: { inquiryId_type: { inquiryId, type } },
    select: { id: true, inquiryId: true, type: true, attemptCount: true },
  });

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: snapshotSelect,
  });

  if (!inquiry) {
    throw new DeliveryNotRetryableError("This inquiry no longer exists.");
  }

  await recordAuditLog({
    action: AuditAction.EmailDeliveryRetried,
    entityType: AuditEntityType.EmailDelivery,
    entityId: delivery.id,
    actorUserId: actor.id,
    actorEmail: actor.email,
    metadata: { inquiryId, type },
  });

  return performDelivery(delivery, inquiry, dependencies, actor);
}

/** Delivery state for the admin inquiry page. */
export async function getInquiryDeliveries(inquiryId: string) {
  return prisma.emailDelivery.findMany({
    where: { inquiryId },
    orderBy: [{ type: "asc" }],
    select: {
      type: true,
      status: true,
      attemptCount: true,
      lastErrorCode: true,
      sentAt: true,
      updatedAt: true,
    },
  });
}
