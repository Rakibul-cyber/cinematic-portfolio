"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { anonymizeCustomerSchema, customerSchema, noteSchema, retryEmailSchema } from "@/lib/validation/crm";
import { statusSchema } from "@/lib/validation/crm";
import { recordAuditLog } from "@/server/audit/audit-log";
import { requireSuperAdmin, requireUser } from "@/server/auth/session";
import { anonymizeCustomer } from "@/server/privacy/service";
import { updateCustomer } from "@/server/crm/service";
import { DeliveryNotRetryableError, retryInquiryEmail } from "@/server/email/service";
import { prisma } from "@/server/db/prisma";

const values = (form: FormData) => Object.fromEntries(form);
export async function changeInquiryStatusAction(form: FormData) {
  const actor = await requireUser("/admin/inquiries"); const data = statusSchema.parse(values(form));
  await prisma.$transaction(async (tx) => { const current = await tx.inquiry.findUniqueOrThrow({ where: { id: data.id }, select: { status: true } }); if (current.status !== data.status) { await tx.inquiry.update({ where: { id: data.id }, data: { status: data.status } }); await tx.inquiryStatusHistory.create({ data: { inquiryId: data.id, fromStatus: current.status, toStatus: data.status, changedByUserId: actor.id } }); }});
  await recordAuditLog({ action: "inquiry.status_changed", entityType: "inquiry", entityId: data.id, actorUserId: actor.id, actorEmail: actor.email, metadata: { toStatus: data.status } });
  revalidatePath(`/admin/inquiries/${data.id}`); redirect(`/admin/inquiries/${data.id}?saved=Status+updated`);
}
export async function addCustomerNoteAction(form: FormData) {
  const actor = await requireUser("/admin/customers"); const data = noteSchema.parse(values(form));
  const active = await prisma.customer.count({ where: { id: data.customerId, anonymizedAt: null } });
  if (!active) redirect(`/admin/customers/${data.customerId}?saved=Customer+is+anonymized`);
  const note = await prisma.customerNote.create({ data: { customerId: data.customerId, body: data.body, authorUserId: actor.id } });
  await recordAuditLog({ action: "customer_note.created", entityType: "customer_note", entityId: note.id, actorUserId: actor.id, actorEmail: actor.email });
  revalidatePath(`/admin/customers/${data.customerId}`); redirect(`/admin/customers/${data.customerId}?saved=Note+added`);
}

export async function anonymizeCustomerAction(form: FormData) {
  const actor = await requireSuperAdmin("/admin/customers");
  const data = anonymizeCustomerSchema.parse(values(form));
  await anonymizeCustomer(data.customerId, actor);
  revalidatePath(`/admin/customers/${data.customerId}`);
  redirect(`/admin/customers/${data.customerId}?saved=Customer+anonymized`);
}
export async function updateCustomerAction(form: FormData) {
  const actor = await requireUser("/admin/customers"); const data = customerSchema.parse(values(form)); await updateCustomer(data, actor);
  revalidatePath(`/admin/customers/${data.id}`); redirect(`/admin/customers/${data.id}?saved=Customer+updated`);
}

/**
 * Re-attempts one transactional email for an inquiry.
 *
 * Available to EDITOR and above, matching the rest of the CRM: re-sending a
 * notification about an inquiry an editor already manages is an ordinary part
 * of that work, not a privileged operation like CSV export.
 *
 * The service performs the authorization-independent safety checks: only a
 * failed, skipped, or stale delivery can be claimed, so this can never resend
 * a message the provider already accepted, and two administrators clicking at
 * once cannot both send.
 */
export async function retryInquiryEmailAction(form: FormData) {
  const actor = await requireUser("/admin/inquiries");
  const data = retryEmailSchema.parse(values(form));

  let notice = "Email retried";
  try {
    const outcome = await retryInquiryEmail(data.inquiryId, data.type, actor);
    notice =
      outcome.status === "ACCEPTED"
        ? "Email accepted by the provider"
        : outcome.status === "SKIPPED"
          ? "Email is not configured, so nothing was sent"
          : "Email could not be sent";
  } catch (error) {
    // Provider detail is never surfaced to the admin UI.
    notice =
      error instanceof DeliveryNotRetryableError
        ? error.message
        : "The email could not be retried.";
  }

  revalidatePath(`/admin/inquiries/${data.inquiryId}`);
  redirect(
    `/admin/inquiries/${data.inquiryId}?saved=${encodeURIComponent(notice)}`,
  );
}
