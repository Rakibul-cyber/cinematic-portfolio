import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import { AuthorizationError, requireSuperAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireSuperAdmin("/admin/customers"); }
  catch (error) {
    if (error instanceof AuthorizationError) return new Response("Forbidden", { status: 403, headers: { "cache-control": "private, no-store" } });
    throw error;
  }
  const { id } = await context.params;
  // Explicit field lists, never `include` on its own: the subject's export must
  // not carry internal columns. `submissionToken` in particular is a live
  // capability that replays the public inquiry action, and `normalizedEmail` is
  // a derived internal key. A single transaction keeps the customer row and its
  // relations consistent if anonymization commits while this export is running.
  const customer = await prisma.$transaction((tx) =>
    tx.customer.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, phone: true, whatsapp: true,
        company: true, createdAt: true, updatedAt: true, anonymizedAt: true,
        inquiries: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, serviceNameSnapshot: true, nameSnapshot: true, emailSnapshot: true,
            phoneSnapshot: true, whatsappSnapshot: true, companySnapshot: true,
            projectType: true, projectDate: true, location: true, budgetLabel: true,
            message: true, referralSource: true, status: true,
            createdAt: true, updatedAt: true, anonymizedAt: true,
          },
        },
        notes: { orderBy: { createdAt: "asc" }, select: { body: true, createdAt: true } },
      },
    }),
  );
  if (!customer) return new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });
  await recordAuditLog({ action: AuditAction.PrivacyCustomerExported, entityType: AuditEntityType.Customer, entityId: id, actorUserId: actor.id, actorEmail: actor.email, metadata: { operation: "export" } });
  return Response.json({ exportedAt: new Date().toISOString(), customer }, { headers: { "cache-control": "private, no-store", "content-disposition": `attachment; filename="customer-${id}.json"` } });
}
