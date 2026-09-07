"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LOGIN_PATH } from "@/lib/admin-routes";
import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import { auth } from "@/server/auth/config";
import { getCurrentUser } from "@/server/auth/session";

/**
 * Signs the current administrator out and returns them to the login page.
 *
 * Better Auth revokes the session row and clears the session cookie; the
 * `nextCookies` plugin applies the resulting `Set-Cookie` header to this
 * action's response.
 */
export async function signOutAction(): Promise<void> {
  const requestHeaders = await headers();
  const user = await getCurrentUser();

  await auth.api.signOut({ headers: requestHeaders });

  if (user) {
    await recordAuditLog({
      action: AuditAction.AdminSignedOut,
      entityType: AuditEntityType.Session,
      actorUserId: user.id,
      actorEmail: user.email,
    });
  }

  redirect(ADMIN_LOGIN_PATH);
}
