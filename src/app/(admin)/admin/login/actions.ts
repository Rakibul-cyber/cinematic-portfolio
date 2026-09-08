"use server";

import { headers } from "next/headers";
import { APIError } from "better-auth/api";

import { GENERIC_SIGN_IN_ERROR, adminLoginSchema } from "@/lib/validation/auth";
import {
  AuditAction,
  AuditEntityType,
  recordAuditLog,
} from "@/server/audit/audit-log";
import { auth } from "@/server/auth/config";

export type SignInResult = { ok: true } | { ok: false; message: string };

/**
 * Authenticates an administrator.
 *
 * Every failure path returns the same message. Nothing distinguishes an unknown
 * email from a wrong password, so the endpoint cannot be used to enumerate
 * accounts, and no internal authentication detail reaches the browser.
 *
 * Credentials are never logged. Failed attempts are audited by email only so an
 * operator can spot brute-force patterns; the submitted password is discarded.
 */
export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<SignInResult> {
  const parsed = adminLoginSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: GENERIC_SIGN_IN_ERROR };
  }

  const { email, password } = parsed.data;

  try {
    const result = await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });

    await recordAuditLog({
      action: AuditAction.AdminSignedIn,
      entityType: AuditEntityType.Session,
      actorUserId: result.user.id,
      actorEmail: result.user.email,
    });

    return { ok: true };
  } catch (error) {
    // Log only the auth library's error code, never the submitted credentials.
    if (error instanceof APIError) {
      console.warn(
        "[auth] Sign-in rejected:",
        error.body?.code ?? error.status,
      );
    } else {
      console.error(
        "[auth] Sign-in failed unexpectedly:",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    await recordAuditLog({
      action: AuditAction.AdminSignInFailed,
      entityType: AuditEntityType.Session,
      actorEmail: email,
    });

    return { ok: false, message: GENERIC_SIGN_IN_ERROR };
  }
}
