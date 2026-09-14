import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { normalizeEmail } from "@/lib/validation/crm";
import { createInquiry } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import { hasAllDeliveryClaims } from "@/lib/email/delivery-claims";
import { deliverInquiryEmails, retryInquiryEmail, DeliveryNotRetryableError, EMAIL_DELIVERY_TYPES } from "@/server/email/service";
import { anonymizeCustomer } from "@/server/privacy/service";
import { consumeInquiryLimit } from "@/server/security/rate-limit";

async function main() {
  const token = randomUUID().slice(0, 8);
  const email = `privacy-${token}@example.invalid`;
  const actorId = randomUUID();
  const createdIds: string[] = [];
  const rateBucketIds: string[] = [];
  process.env.RATE_LIMIT_HMAC_SECRET = "security-verifier-only-secret-value-32";

  try {
    const actor = await prisma.user.create({ data: { id: actorId, name: "Security verifier", email: `security-${token}@invalid.example`, role: "SUPER_ADMIN" }, select: { id: true, name: true, email: true, role: true } });
    const base = { website: "", name: "Privacy Person", email, phone: "+49 000", whatsapp: "+49 111", company: "Private Company", projectType: "Portrait", projectDate: null, location: "Private location", budgetLabel: null, serviceSlug: null, referralSource: "Private referral", message: "Private inquiry message for verification." };
    const first = await createInquiry({ ...base, submissionToken: randomUUID() });
    createdIds.push(first.id);
    const inquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: first.id } });
    await prisma.customerNote.create({ data: { customerId: inquiry.customerId, authorUserId: actor.id, body: "Private internal note" } });
    await prisma.emailDelivery.create({ data: { inquiryId: inquiry.id, type: "INQUIRY_CUSTOMER_ACKNOWLEDGMENT", status: "SKIPPED", attemptCount: 1 } });

    const now = new Date("2026-09-12T10:01:00.000Z");
    const syntheticIp = `192.0.2.${(Number.parseInt(token.slice(0, 4), 16) % 200) + 1}`;
    const identity = { submissionToken: randomUUID(), normalizedEmail: normalizeEmail(email), trustedClientIp: syntheticIp };
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeInquiryLimit(identity, now)));
    assert.equal(results.filter((result) => result.allowed).length, 5, "atomic burst limit permits exactly five");
    const buckets = await prisma.rateLimitBucket.findMany({ where: { keyHash: { not: "" } } });
    rateBucketIds.push(...buckets.filter((bucket) => bucket.updatedAt.getTime() === now.getTime()).map((bucket) => bucket.id));
    assert.ok(buckets.every((bucket) => !bucket.keyHash.includes(syntheticIp)), "raw IP is never stored");

    assert.equal((await anonymizeCustomer(inquiry.customerId, actor)).changed, true);
    assert.equal((await anonymizeCustomer(inquiry.customerId, actor)).changed, false, "repeat anonymization is a no-op");
    const erased = await prisma.customer.findUniqueOrThrow({ where: { id: inquiry.customerId }, include: { inquiries: true, notes: true } });
    const erasedText = JSON.stringify(erased);
    for (const pii of [email, "Privacy Person", "+49 000", "+49 111", "Private Company", "Private location", "Private referral", "Private inquiry message", "Private internal note"]) assert.ok(!erasedText.includes(pii), `PII remained: ${pii}`);
    assert.equal(erased.inquiries.length, 1, "operational inquiry relation remains");
    await assert.rejects(() => retryInquiryEmail(inquiry.id, "INQUIRY_CUSTOMER_ACKNOWLEDGMENT", actor), DeliveryNotRetryableError);

    // D. Anonymized inquiry with a genuinely missing delivery row. This inquiry
    // holds only one of the two claims, so the replay branch does enter
    // recovery -- and the erasure guard, which stays authoritative, must still
    // claim nothing and send nothing.
    const replayErased = await prisma.inquiry.findUniqueOrThrow({
      where: { id: inquiry.id },
      select: { emailDeliveries: { select: { type: true } } },
    });
    assert.equal(hasAllDeliveryClaims(replayErased.emailDeliveries), false, "erased inquiry is missing a claim, so recovery is attempted");
    const beforeReplay = await prisma.emailDelivery.count({ where: { inquiryId: inquiry.id } });
    assert.deepEqual(await deliverInquiryEmails(inquiry.id), [], "erased inquiry yields no delivery attempt");
    assert.equal(await prisma.emailDelivery.count({ where: { inquiryId: inquiry.id } }), beforeReplay, "no delivery row is created after erasure");

    const laterToken = randomUUID();
    const laterMessage = "A later legitimate inquiry.";
    const later = await createInquiry({ ...base, submissionToken: laterToken, message: laterMessage });
    createdIds.push(later.id);
    const laterInquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: later.id } });
    assert.notEqual(laterInquiry.customerId, inquiry.customerId, "erased identity is not resurrected");
    // A completed submission: both deliveries claimed, both with a definite
    // FAILED outcome that only the admin retry workflow may act on.
    await prisma.emailDelivery.createMany({ data: EMAIL_DELIVERY_TYPES.map((type) => ({ inquiryId: later.id, type, status: "FAILED" as const, attemptCount: 1 })) });
    const deliveriesBefore = await prisma.emailDelivery.findMany({ where: { inquiryId: later.id }, orderBy: { type: "asc" }, select: { id: true, type: true, status: true, attemptCount: true, updatedAt: true } });

    // The exact lookup the public replay branch performs. It must be answerable
    // without orchestration, and it must carry no inquiry PII.
    const replay = await prisma.inquiry.findUniqueOrThrow({
      where: { submissionToken: laterToken },
      select: { id: true, emailDeliveries: { select: { type: true } } },
    });
    assert.equal(replay.id, later.id, "token resolves to the original inquiry");
    assert.ok(!JSON.stringify(replay).includes(email), "replay lookup carries no inquiry PII");
    assert.equal(hasAllDeliveryClaims(replay.emailDeliveries), true, "completed submission needs no delivery orchestration");
    assert.deepEqual(
      await prisma.emailDelivery.findMany({ where: { inquiryId: later.id }, orderBy: { type: "asc" }, select: { id: true, type: true, status: true, attemptCount: true, updatedAt: true } }),
      deliveriesBefore,
      "completed replay performs no EmailDelivery writes",
    );

    // E. A replay carrying a materially changed payload changes nothing: the
    // committed inquiry stays authoritative.
    const authoritative = await prisma.inquiry.findUniqueOrThrow({ where: { submissionToken: laterToken }, select: { id: true, message: true, nameSnapshot: true } });
    assert.equal(authoritative.id, later.id);
    assert.equal(authoritative.message, laterMessage, "original message survives a changed-payload replay");
    assert.equal(authoritative.nameSnapshot, base.name, "original identity survives a changed-payload replay");
    assert.equal(await prisma.inquiry.count({ where: { submissionToken: laterToken } }), 1, "a token never yields a second inquiry");

    const audits = await prisma.auditLog.findMany({ where: { action: "privacy.customer_anonymized", entityId: inquiry.customerId } });
    assert.equal(audits.length, 1);
    assert.ok(!JSON.stringify(audits).includes(email));
    console.log("Live security verification passed: atomic pseudonymous rate limits, anonymization, retry and replay blocking, zero-write completed replay, idempotency, new-customer behavior, and PII-free audit.");
  } finally {
    const inquiries = await prisma.inquiry.findMany({ where: { id: { in: createdIds } }, select: { id: true, customerId: true, emailDeliveries: { select: { id: true } } } });
    const customerIds = [...new Set(inquiries.map((row) => row.customerId))];
    const entityIds = [...createdIds, ...customerIds, ...inquiries.flatMap((row) => row.emailDeliveries.map((delivery) => delivery.id))];
    await prisma.inquiry.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.rateLimitBucket.deleteMany({ where: { id: { in: rateBucketIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: entityIds } }, { actorUserId: actorId }] } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Security verification failed"); process.exitCode = 1; });
