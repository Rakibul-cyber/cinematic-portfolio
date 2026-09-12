import "server-only";

import type { AdminUser } from "@/server/auth/session";
import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import { prisma } from "@/server/db/prisma";

export async function anonymizeCustomer(customerId: string, actor: AdminUser) {
  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { anonymizedAt: true },
    });
    if (customer.anonymizedAt) return { changed: false };

    const anonymizedAt = new Date();
    await tx.customer.update({
      where: { id: customerId },
      data: {
        name: "Anonymized customer",
        email: `anonymized-${customerId}@invalid.example`,
        normalizedEmail: `anonymized-${customerId}@invalid.example`,
        phone: null,
        whatsapp: null,
        company: null,
        anonymizedAt,
      },
    });
    await tx.inquiry.updateMany({
      where: { customerId },
      data: {
        nameSnapshot: "Anonymized customer",
        emailSnapshot: "anonymized@invalid.example",
        phoneSnapshot: null,
        whatsappSnapshot: null,
        companySnapshot: null,
        location: null,
        referralSource: null,
        message: "[Removed during privacy anonymization]",
        anonymizedAt,
      },
    });
    await tx.customerNote.updateMany({
      where: { customerId },
      data: { body: "[Removed during privacy anonymization]" },
    });
    return { changed: true };
  });

  if (result.changed) {
    await recordAuditLog({
      action: AuditAction.PrivacyCustomerAnonymized,
      entityType: AuditEntityType.Customer,
      entityId: customerId,
      actorUserId: actor.id,
      actorEmail: actor.email,
      metadata: { operation: "anonymize" },
    });
  }
  return result;
}
