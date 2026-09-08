"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { customerSchema, noteSchema, statusSchema } from "@/lib/validation/crm";
import { recordAuditLog } from "@/server/audit/audit-log";
import { requireUser } from "@/server/auth/session";
import { updateCustomer } from "@/server/crm/service";
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
  const note = await prisma.customerNote.create({ data: { customerId: data.customerId, body: data.body, authorUserId: actor.id } });
  await recordAuditLog({ action: "customer_note.created", entityType: "customer_note", entityId: note.id, actorUserId: actor.id, actorEmail: actor.email });
  revalidatePath(`/admin/customers/${data.customerId}`); redirect(`/admin/customers/${data.customerId}?saved=Note+added`);
}
export async function updateCustomerAction(form: FormData) {
  const actor = await requireUser("/admin/customers"); const data = customerSchema.parse(values(form)); await updateCustomer(data, actor);
  revalidatePath(`/admin/customers/${data.id}`); redirect(`/admin/customers/${data.id}?saved=Customer+updated`);
}
