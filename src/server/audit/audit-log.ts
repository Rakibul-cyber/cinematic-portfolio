import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

/**
 * Audit foundation.
 *
 * Phase 2 provides the write path and the vocabulary. Admin features record
 * their own actions as they are built, and an audit browsing UI is out of
 * scope for this phase.
 *
 * Nothing sensitive may be written here. `metadata` is for describing *what*
 * changed, never for credentials, session tokens, password hashes, API keys,
 * or connection strings.
 */

/** Known audit actions. Extended by later phases as features are added. */
export const AuditAction = {
  AdminSignedIn: "admin.signed_in",
  AdminSignInFailed: "admin.sign_in_failed",
  AdminSignedOut: "admin.signed_out",
  AdminUserBootstrapped: "admin_user.bootstrapped",
  MediaUploaded: "media.uploaded",
  MediaUpdated: "media.updated",
  MediaDeleted: "media.deleted",
  CmsCreated: "cms.created",
  CmsUpdated: "cms.updated",
  CmsDeleted: "cms.deleted",
  ProjectPublished: "project.published",
  ProjectUnpublished: "project.unpublished",
  InquiryCreated: "inquiry.created",
  InquiryStatusChanged: "inquiry.status_changed",
  CustomerUpdated: "customer.updated",
  CustomerNoteCreated: "customer_note.created",
  CrmExported: "crm.exported",
  EmailDeliveryAccepted: "email.delivery_accepted",
  EmailDeliveryFailed: "email.delivery_failed",
  EmailDeliverySkipped: "email.delivery_skipped",
  EmailDeliveryRetried: "email.delivery_retried",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Known audited entity types. Extended by later phases. */
export const AuditEntityType = {
  AdminUser: "admin_user",
  Session: "session",
  Media: "media",
  Project: "project",
  Category: "category",
  Service: "service",
  Testimonial: "testimonial",
  Page: "page",
  Settings: "settings",
  SocialLink: "social_link",
  Inquiry: "inquiry",
  Customer: "customer",
  CustomerNote: "customer_note",
  EmailDelivery: "email_delivery",
} as const;

export type AuditEntityType =
  (typeof AuditEntityType)[keyof typeof AuditEntityType];

export type AuditLogInput = {
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId?: string | null;
  /** The acting user, or null for anonymous/failed attempts. */
  actorUserId?: string | null;
  /** Retained so the audit trail stays readable after a user is deleted. */
  actorEmail?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

/**
 * Records an audit entry.
 *
 * Auditing must never break the action being audited, so a write failure is
 * swallowed after being reported without any of the entry's payload. This
 * tradeoff is acceptable for the Phase 2 foundation; a durable outbox can be
 * introduced if auditing later becomes a compliance guarantee.
 */
export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail ?? null,
        ...(input.metadata == null ? {} : { metadata: input.metadata }),
      },
    });
  } catch (error) {
    console.error(
      "[audit] Failed to record audit entry for action:",
      input.action,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
