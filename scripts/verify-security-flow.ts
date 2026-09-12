import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { normalizeEmail } from "@/lib/validation/crm";
import { createInquiry } from "@/server/crm/service";
import { prisma } from "@/server/db/prisma";
import { deliverInquiryEmails, retryInquiryEmail, DeliveryNotRetryableError } from "@/server/email/service";
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

    // The public action's idempotent replay branch reaches delivery without
    // authentication, rate limiting, or Turnstile. After erasure it must claim
    // nothing and attempt nothing, including for a delivery type that was never
    // claimed in the first place.
    const beforeReplay = await prisma.emailDelivery.count({ where: { inquiryId: inquiry.id } });
    assert.deepEqual(await deliverInquiryEmails(inquiry.id), [], "erased inquiry yields no delivery attempt");
    assert.equal(await prisma.emailDelivery.count({ where: { inquiryId: inquiry.id } }), beforeReplay, "no delivery row is created after erasure");

    const later = await createInquiry({ ...base, submissionToken: randomUUID(), message: "A later legitimate inquiry." });
    createdIds.push(later.id);
    const laterInquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: later.id } });
    assert.notEqual(laterInquiry.customerId, inquiry.customerId, "erased identity is not resurrected");
    const audits = await prisma.auditLog.findMany({ where: { action: "privacy.customer_anonymized", entityId: inquiry.customerId } });
    assert.equal(audits.length, 1);
    assert.ok(!JSON.stringify(audits).includes(email));
    console.log("Live security verification passed: atomic pseudonymous rate limits, anonymization, retry and replay blocking, idempotency, new-customer behavior, and PII-free audit.");
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
