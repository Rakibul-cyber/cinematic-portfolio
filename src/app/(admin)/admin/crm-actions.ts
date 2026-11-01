"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { anonymizeCustomerSchema, customerSchema, noteSchema } from "@/lib/validation/crm";
import { statusSchema } from "@/lib/validation/crm";
import { describeValidationError, type AdminFormState } from "@/lib/admin/form-state";
import { recordAuditLog } from "@/server/audit/audit-log";
import { requireSuperAdmin, requireUser } from "@/server/auth/session";
import { anonymizeCustomer } from "@/server/privacy/service";
import { updateCustomer } from "@/server/crm/service";
import { CustomerUpdateError } from "@/server/crm/errors";
import { type RecoveryAnswer, runRecoverMissingEmails, runRetryEmail } from "@/server/email/recovery-workflow";
import { recoverMissingInquiryEmails, retryInquiryEmail } from "@/server/email/service";
import { prisma } from "@/server/db/prisma";

const values = (form: FormData) => Object.fromEntries(form);
export async function changeInquiryStatusAction(form: FormData) {
  const actor = await requireUser("/admin/inquiries"); const data = statusSchema.parse(values(form));
  await prisma.$transaction(async (tx) => { const current = await tx.inquiry.findUniqueOrThrow({ where: { id: data.id }, select: { status: true } }); if (current.status !== data.status) { await tx.inquiry.update({ where: { id: data.id }, data: { status: data.status } }); await tx.inquiryStatusHistory.create({ data: { inquiryId: data.id, fromStatus: current.status, toStatus: data.status, changedByUserId: actor.id } }); }});
  await recordAuditLog({ action: "inquiry.status_changed", entityType: "inquiry", entityId: data.id, actorUserId: actor.id, actorEmail: actor.email, metadata: { toStatus: data.status } });
  revalidatePath(`/admin/inquiries/${data.id}`); redirect(`/admin/inquiries/${data.id}?saved=Status+updated`);
}
/*
 * The customer forms submit through `AdminForm`: a rejected submission returns
 * a message as form state, so the administrator stays on the form with what
 * they typed. Only expected failures are returned; anything else still throws
 * to the admin error boundary, which shows nothing about the cause.
 */
export async function addCustomerNoteAction(_state: AdminFormState, form: FormData): Promise<AdminFormState> {
  const actor = await requireUser("/admin/customers");
  const parsed = noteSchema.safeParse(values(form));
  if (!parsed.success) return describeValidationError(parsed.error);
  const data = parsed.data;
  const active = await prisma.customer.count({ where: { id: data.customerId, anonymizedAt: null } });
  if (!active) redirect(`/admin/customers/${data.customerId}?error=Customer+is+anonymized`);
  const note = await prisma.customerNote.create({ data: { customerId: data.customerId, body: data.body, authorUserId: actor.id } });
  await recordAuditLog({ action: "customer_note.created", entityType: "customer_note", entityId: note.id, actorUserId: actor.id, actorEmail: actor.email });
  revalidatePath(`/admin/customers/${data.customerId}`); redirect(`/admin/customers/${data.customerId}?saved=Note+added`);
}

export async function anonymizeCustomerAction(_state: AdminFormState, form: FormData): Promise<AdminFormState> {
  const actor = await requireSuperAdmin("/admin/customers");
  const parsed = anonymizeCustomerSchema.safeParse(values(form));
  if (!parsed.success) return describeValidationError(parsed.error);
  const data = parsed.data;
  await anonymizeCustomer(data.customerId, actor);
  revalidatePath(`/admin/customers/${data.customerId}`);
  redirect(`/admin/customers/${data.customerId}?saved=Customer+anonymized`);
}
export async function updateCustomerAction(_state: AdminFormState, form: FormData): Promise<AdminFormState> {
  const actor = await requireUser("/admin/customers");
  const parsed = customerSchema.safeParse(values(form));
  if (!parsed.success) return describeValidationError(parsed.error);
  const data = parsed.data;
  try {
    await updateCustomer(data, actor);
  } catch (error) {
    if (error instanceof CustomerUpdateError) return error.field ? { error: error.message, field: error.field } : { error: error.message };
    throw error;
  }
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
 * failed, skipped, or confirmed stale delivery can be claimed, so this can never
 * resend a message the provider already accepted, and two administrators
 * clicking at once cannot both send.
 */
export async function retryInquiryEmailAction(form: FormData) {
  showRecoveryAnswer(await runRetryEmail(form, { requireActor: () => requireUser("/admin/inquiries"), retry: retryInquiryEmail }));
}

/** Sends the emails an inquiry has no delivery record for. Same access as a retry. */
export async function recoverMissingInquiryEmailsAction(form: FormData) {
  showRecoveryAnswer(await runRecoverMissingEmails(form, { requireActor: () => requireUser("/admin/inquiries"), recover: recoverMissingInquiryEmails }));
}

function showRecoveryAnswer({ inquiryId, outcome, notice }: RecoveryAnswer): never {
  revalidatePath(`/admin/inquiries/${inquiryId}`);
  redirect(`/admin/inquiries/${inquiryId}?${outcome}=${encodeURIComponent(notice)}`);
}
