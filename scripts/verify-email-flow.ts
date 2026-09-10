import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  buildAdminNotification,
  buildCustomerAcknowledgment,
  toPlainText,
} from "@/emails/inquiry-content";
import { normalizeEmail } from "@/lib/validation/crm";
import { createInquiry } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import type { EmailSender, OutboundEmail } from "@/server/email/client";
import type { EmailConfig } from "@/server/email/config";
import {
  deliverInquiryEmails,
  DeliveryNotRetryableError,
  retryInquiryEmail,
  type EmailRenderer,
} from "@/server/email/service";

/**
 * Live transactional email verification.
 *
 * Exercises the real orchestration against the real database with a fake
 * provider, so no message is ever sent and no Resend key is required. The
 * React Email templates are covered separately by the `*.render-test.ts` pass;
 * a fake renderer is injected here so `react-dom/server`, which cannot load
 * under the `react-server` condition this script runs in, stays out of the
 * module graph.
 *
 * Everything it creates is removed afterwards, keyed off a synthetic
 * `.invalid` address so cleanup works whatever stage a failure happens at.
 */

type SentEmail = OutboundEmail & { attempt: number };

function fakeSender(behaviour: "accept" | "fail"): EmailSender & {
  sent: SentEmail[];
} {
  const sent: SentEmail[] = [];

  return {
    provider: "fake",
    sent,
    async send(email) {
      sent.push({ ...email, attempt: sent.length + 1 });
      return behaviour === "accept"
        ? { ok: true, providerMessageId: `fake-${randomUUID()}` }
        : { ok: false, errorCode: "validation_error" };
    },
  };
}

/** Renders from the same pure model the React templates use. */
const renderer: EmailRenderer = {
  async renderAdminNotification({ inquiry, adminUrl }) {
    const text = toPlainText(buildAdminNotification(inquiry, { adminUrl }));
    return { html: `<pre>${text}</pre>`, text };
  },
  async renderCustomerAcknowledgment({ inquiry, studioName }) {
    const text = toPlainText(buildCustomerAcknowledgment(inquiry, { studioName }));
    return { html: `<pre>${text}</pre>`, text };
  },
};

const configured: EmailConfig = {
  configured: true,
  apiKey: "fake-key-not-a-real-credential",
  from: { address: "studio@example.invalid", name: "Verification Studio" },
  replyTo: { address: "replies@example.invalid" },
  adminRecipients: [{ address: "studio-inbox@example.invalid" }],
  appBaseUrl: "https://studio.example.invalid",
};

const notConfigured: EmailConfig = {
  configured: false,
  reason: "not_configured",
  problems: ["RESEND_API_KEY"],
};

async function main() {
  const token = randomUUID().slice(0, 8);
  const email = `EMAIL-${token}@Example.invalid`;
  const normalizedEmail = normalizeEmail(email);

  const existingActor = await prisma.user.findFirst({
    select: { id: true, name: true, email: true, role: true },
  });
  const temporaryActorId = existingActor ? null : randomUUID();
  const actor =
    existingActor ??
    (await prisma.user.create({
      data: {
        id: temporaryActorId!,
        name: "Email verifier",
        email: `email-verifier-${token}@invalid.example`,
        role: "EDITOR",
      },
      select: { id: true, name: true, email: true, role: true },
    }));

  try {
    const base = {
      website: "",
      name: `Email ${token}`,
      email,
      phone: "+49 30 000111",
      whatsapp: null,
      company: "Verification GmbH",
      projectType: "Portrait",
      projectDate: null,
      location: "Berlin",
      budgetLabel: null,
      serviceSlug: null,
      referralSource: null,
      message: "A live transactional email verification inquiry.",
    };

    // 1. A successful submission produces exactly two deliveries.
    const submissionToken = randomUUID();
    const inquiry = await createInquiry({ ...base, submissionToken });
    const sender = fakeSender("accept");
    const outcomes = await deliverInquiryEmails(inquiry.id, {
      sender,
      renderer,
      config: configured,
      studioName: "Verification Studio",
    });

    assert.equal(outcomes.length, 2, "one delivery per email type");
    assert.ok(
      outcomes.every((outcome) => outcome.status === "ACCEPTED"),
      "provider acceptance is recorded",
    );
    assert.equal(sender.sent.length, 2, "exactly two provider calls");

    const rows = await prisma.emailDelivery.findMany({
      where: { inquiryId: inquiry.id },
      orderBy: { type: "asc" },
    });
    assert.equal(rows.length, 2);
    assert.ok(
      rows.every((row) => row.providerMessageId && row.sentAt),
      "provider message id and acceptance time recorded",
    );
    assert.ok(
      rows.every((row) => row.attemptCount === 1 && row.lastErrorCode === null),
      "a first successful attempt records no error",
    );

    // 2. Addressing comes from the Inquiry snapshot, not the Customer record.
    const acknowledgment = sender.sent.find((sent) =>
      sent.to.some((to) => to.address === email),
    );
    assert.ok(acknowledgment, "acknowledgment goes to the submitted address");
    assert.equal(
      acknowledgment.replyTo?.address,
      "replies@example.invalid",
      "customer replies go to the configured studio address",
    );

    const notification = sender.sent.find((sent) =>
      sent.to.some((to) => to.address === "studio-inbox@example.invalid"),
    );
    assert.ok(notification, "notification goes to the configured studio inbox");
    assert.equal(
      notification.replyTo?.address,
      email,
      "studio replies go straight to the visitor",
    );
    assert.ok(notification.text.includes("Verification GmbH"));
    assert.ok(notification.text.includes("A live transactional email"));
    assert.ok(
      notification.text.includes(
        `https://studio.example.invalid/admin/inquiries/${inquiry.id}`,
      ),
      "the admin link uses the configured base URL",
    );
    assert.ok(
      notification.subject.includes("Portrait") &&
        !notification.subject.includes("A live transactional"),
      "the subject is bounded and excludes the message body",
    );

    // 3. Replaying the same submission sends nothing further.
    const replay = await createInquiry({ ...base, submissionToken });
    assert.equal(replay.id, inquiry.id, "replay resolves to the same inquiry");
    assert.equal(replay.duplicate, true);

    const replaySender = fakeSender("accept");
    const replayOutcomes = await deliverInquiryEmails(inquiry.id, {
      sender: replaySender,
      renderer,
      config: configured,
    });
    assert.equal(replaySender.sent.length, 0, "a replay sends no email");
    assert.ok(
      replayOutcomes.every((outcome) => outcome.alreadyClaimed),
      "a replay finds both deliveries already claimed",
    );
    assert.equal(
      await prisma.emailDelivery.count({ where: { inquiryId: inquiry.id } }),
      2,
      "a replay creates no extra delivery records",
    );

    // 4. Concurrent delivery attempts claim once between them.
    const concurrentToken = randomUUID();
    const concurrent = await createInquiry({
      ...base,
      submissionToken: concurrentToken,
      message: "A concurrent delivery verification inquiry.",
    });
    const senderA = fakeSender("accept");
    const senderB = fakeSender("accept");
    await Promise.all([
      deliverInquiryEmails(concurrent.id, {
        sender: senderA,
        renderer,
        config: configured,
      }),
      deliverInquiryEmails(concurrent.id, {
        sender: senderB,
        renderer,
        config: configured,
      }),
    ]);
    assert.equal(
      senderA.sent.length + senderB.sent.length,
      2,
      "two concurrent attempts still produce exactly two provider calls",
    );
    assert.equal(
      await prisma.emailDelivery.count({ where: { inquiryId: concurrent.id } }),
      2,
    );

    // 5. Provider failure keeps the inquiry and records a bounded error code.
    const failingToken = randomUUID();
    const failing = await createInquiry({
      ...base,
      submissionToken: failingToken,
      message: "A failing delivery verification inquiry.",
    });
    const failed = await deliverInquiryEmails(failing.id, {
      sender: fakeSender("fail"),
      renderer,
      config: configured,
    });
    assert.ok(failed.every((outcome) => outcome.status === "FAILED"));
    assert.ok(
      await prisma.inquiry.findUnique({ where: { id: failing.id } }),
      "a provider failure never removes the inquiry",
    );
    const failedRows = await prisma.emailDelivery.findMany({
      where: { inquiryId: failing.id },
    });
    assert.ok(
      failedRows.every((row) => row.lastErrorCode === "validation_error"),
      "a short sanitized error category is stored",
    );
    assert.ok(
      failedRows.every((row) => !row.providerMessageId && !row.sentAt),
      "a failure records no acceptance",
    );

    // 6. A failed delivery can be retried, and succeeds.
    const retrySender = fakeSender("accept");
    const retried = await retryInquiryEmail(
      failing.id,
      "INQUIRY_CUSTOMER_ACKNOWLEDGMENT",
      actor,
      { sender: retrySender, renderer, config: configured },
    );
    assert.equal(retried.status, "ACCEPTED");
    assert.equal(retrySender.sent.length, 1);
    const retriedRow = await prisma.emailDelivery.findUniqueOrThrow({
      where: {
        inquiryId_type: {
          inquiryId: failing.id,
          type: "INQUIRY_CUSTOMER_ACKNOWLEDGMENT",
        },
      },
    });
    assert.equal(retriedRow.attemptCount, 2, "the retry is counted");
    assert.equal(
      retriedRow.lastErrorCode,
      null,
      "a recovered delivery clears its stale error",
    );

    // 7. An accepted delivery cannot be retried into a duplicate send.
    const guardSender = fakeSender("accept");
    await assert.rejects(
      () =>
        retryInquiryEmail(
          failing.id,
          "INQUIRY_CUSTOMER_ACKNOWLEDGMENT",
          actor,
          { sender: guardSender, renderer, config: configured },
        ),
      DeliveryNotRetryableError,
      "an accepted delivery is not retryable",
    );
    assert.equal(guardSender.sent.length, 0, "no provider call for a guarded retry");

    // 8. Missing configuration is represented honestly, never as sent.
    const skippedToken = randomUUID();
    const skipped = await createInquiry({
      ...base,
      submissionToken: skippedToken,
      message: "An unconfigured delivery verification inquiry.",
    });
    const skippedSender = fakeSender("accept");
    const skippedOutcomes = await deliverInquiryEmails(skipped.id, {
      sender: skippedSender,
      renderer,
      config: notConfigured,
    });
    assert.ok(
      skippedOutcomes.every((outcome) => outcome.status === "SKIPPED"),
      "an unconfigured deployment records SKIPPED, never ACCEPTED",
    );
    assert.equal(skippedSender.sent.length, 0, "nothing is sent when unconfigured");
    const skippedRows = await prisma.emailDelivery.findMany({
      where: { inquiryId: skipped.id },
    });
    assert.ok(skippedRows.every((row) => row.provider === null));

    // A skipped delivery becomes sendable once configuration arrives.
    const configuredLater = fakeSender("accept");
    const recovered = await retryInquiryEmail(
      skipped.id,
      "INQUIRY_ADMIN_NOTIFICATION",
      actor,
      { sender: configuredLater, renderer, config: configured },
    );
    assert.equal(recovered.status, "ACCEPTED");

    // 9. No stored delivery row carries a rendered body or recipient address.
    const allRows = await prisma.emailDelivery.findMany({
      where: { inquiry: { customer: { normalizedEmail } } },
    });
    const serialized = JSON.stringify(allRows);
    assert.ok(!serialized.includes("@Example.invalid"));
    assert.ok(!serialized.includes("@example.invalid"));
    assert.ok(!serialized.includes("<pre>"));
    assert.ok(!serialized.includes("verification inquiry"));

    // 10. Audit metadata stays free of personal data.
    const audits = await prisma.auditLog.findMany({
      where: { entityType: "email_delivery" },
    });
    assert.ok(audits.length > 0, "delivery attempts are audited");
    const auditText = JSON.stringify(audits);
    assert.ok(!auditText.includes("@example.invalid"), "no recipient in audit");
    assert.ok(!auditText.includes("Verification GmbH"), "no company in audit");
    assert.ok(!auditText.includes("verification inquiry"), "no message in audit");
    assert.ok(
      audits.some((entry) => entry.actorUserId === null),
      "public submissions record no invented admin actor",
    );
    assert.ok(
      audits.some((entry) => entry.action === "email.delivery_retried" && entry.actorUserId === actor.id),
      "a manual retry records the real administrator",
    );

    console.log(
      "Live email verification passed: two deliveries per inquiry, snapshot addressing, " +
        "replay and concurrency idempotency, failure isolation, retry, honest skipped state, " +
        "and PII-free audit metadata.",
    );
  } finally {
    const customerIds = (
      await prisma.customer.findMany({
        where: { normalizedEmail },
        select: { id: true },
      })
    ).map((customer) => customer.id);

    const inquiryIds = (
      await prisma.inquiry.findMany({
        where: { customerId: { in: customerIds } },
        select: { id: true },
      })
    ).map((inquiry) => inquiry.id);

    const deliveryIds = (
      await prisma.emailDelivery.findMany({
        where: { inquiryId: { in: inquiryIds } },
        select: { id: true },
      })
    ).map((delivery) => delivery.id);

    // EmailDelivery and status history cascade with the inquiry.
    await prisma.inquiry.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...inquiryIds, ...customerIds, ...deliveryIds] } },
    });

    if (temporaryActorId) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: temporaryActorId } });
      await prisma.user.deleteMany({ where: { id: temporaryActorId } });
    }

    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Email verification failed",
  );
  process.exitCode = 1;
});
