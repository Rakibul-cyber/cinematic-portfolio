import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";
import { normalizeEmail, type customerSchema, type inquirySchema } from "@/lib/validation/crm";
import { recordAuditLog } from "@/server/audit/audit-log";
import type { AdminUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

type InquiryInput = z.infer<typeof inquirySchema>;
type CustomerInput = z.infer<typeof customerSchema>;
export class InvalidServiceError extends Error {}

export async function createInquiry(data: InquiryInput) {
  const service = data.serviceSlug ? await prisma.service.findFirst({ where: { slug: data.serviceSlug, isActive: true }, select: { id: true, name: true } }) : null;
  if (data.serviceSlug && !service) throw new InvalidServiceError("The selected service is no longer available.");
  const normalizedEmail = normalizeEmail(data.email);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.upsert({
        where: { normalizedEmail },
        create: { name: data.name, email: data.email, normalizedEmail, phone: data.phone, whatsapp: data.whatsapp, company: data.company },
        update: { name: data.name, email: data.email, ...(data.phone ? { phone: data.phone } : {}), ...(data.whatsapp ? { whatsapp: data.whatsapp } : {}), ...(data.company ? { company: data.company } : {}) },
      });
      const inquiry = await tx.inquiry.create({ data: {
        submissionToken: data.submissionToken, customerId: customer.id, serviceId: service?.id,
        serviceNameSnapshot: service?.name, nameSnapshot: data.name, emailSnapshot: data.email,
        phoneSnapshot: data.phone, whatsappSnapshot: data.whatsapp, companySnapshot: data.company,
        projectType: data.projectType, projectDate: data.projectDate, location: data.location,
        budgetLabel: data.budgetLabel, message: data.message, referralSource: data.referralSource,
        statusHistory: { create: { toStatus: "NEW" } },
      }});
      return { inquiry, customer };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await recordAuditLog({ action: "inquiry.created", entityType: "inquiry", entityId: result.inquiry.id });
    await recordAuditLog({ action: "customer.created_or_matched", entityType: "customer", entityId: result.customer.id });
    return { id: result.inquiry.id, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.inquiry.findUnique({ where: { submissionToken: data.submissionToken }, select: { id: true } });
      if (existing) return { id: existing.id, duplicate: true };
    }
    throw error;
  }
}

export async function updateCustomer(data: CustomerInput, actor: AdminUser) {
  const customer = await prisma.customer.update({ where: { id: data.id }, data: { name: data.name, email: data.email, normalizedEmail: normalizeEmail(data.email), phone: data.phone, whatsapp: data.whatsapp, company: data.company } });
  await recordAuditLog({ action: "customer.updated", entityType: "customer", entityId: customer.id, actorUserId: actor.id, actorEmail: actor.email });
}
