"use server";

import { headers } from "next/headers";

import {
  AuditAction,
  AuditEntityType,
  recordAuditLog,
} from "@/server/audit/audit-log";
import { auth } from "@/server/auth/config";
import { runSignIn, type SignInResult } from "@/server/auth/sign-in-workflow";

export type { SignInResult };

/** The sign-in action: the workflow in `sign-in-workflow.ts`, bound to the real services. */
export async function signInAction(input: {
  email: string;
  password: string;
}): Promise<SignInResult> {
  return runSignIn(input, {
    signIn: async (body) => auth.api.signInEmail({ body, headers: await headers() }),
    auditSignedIn: (user) =>
      recordAuditLog({
        action: AuditAction.AdminSignedIn,
        entityType: AuditEntityType.Session,
        actorUserId: user.id,
        actorEmail: user.email,
      }),
    auditFailed: (email) =>
      recordAuditLog({
        action: AuditAction.AdminSignInFailed,
        entityType: AuditEntityType.Session,
        actorEmail: email,
      }),
  });
}
