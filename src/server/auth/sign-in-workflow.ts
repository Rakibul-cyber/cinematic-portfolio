import "server-only";

import { APIError } from "better-auth/api";

import { adminLoginSchema, GENERIC_SIGN_IN_ERROR, SIGN_IN_UNAVAILABLE_ERROR } from "@/lib/validation/auth";

export type SignInResult = { ok: true } | { ok: false; message: string };

/**
 * Everything the workflow reaches outside itself. `login/actions.ts` binds the
 * real services; tests bind fakes, so no database is needed.
 */
export type SignInDependencies = {
  signIn: (credentials: { email: string; password: string }) => Promise<{ user: { id: string; email: string } }>;
  auditSignedIn: (user: { id: string; email: string }) => Promise<void>;
  auditFailed: (email: string) => Promise<void>;
};

/** Refusals from the login guard, which never looked at the account or password. */
const isGuardRefusal = (error: unknown) =>
  error instanceof APIError && (error.status === "TOO_MANY_REQUESTS" || error.status === "SERVICE_UNAVAILABLE");

/**
 * Authenticates an administrator.
 *
 * Every credential failure returns the same message. Nothing distinguishes an
 * unknown email from a wrong password, so the endpoint cannot be used to
 * enumerate accounts, and no internal authentication detail reaches the browser.
 *
 * Credentials are never logged. Failed attempts are audited by email only so an
 * operator can spot brute-force patterns; the submitted password is discarded. A
 * refused attempt writes no row per request: the guard audits each limit once.
 */
export async function runSignIn(input: { email: string; password: string }, dependencies: SignInDependencies): Promise<SignInResult> {
  const parsed = adminLoginSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: GENERIC_SIGN_IN_ERROR };
  }

  const { email, password } = parsed.data;

  try {
    const result = await dependencies.signIn({ email, password });
    await dependencies.auditSignedIn(result.user);
    return { ok: true };
  } catch (error) {
    if (isGuardRefusal(error)) return { ok: false, message: SIGN_IN_UNAVAILABLE_ERROR };

    // Log only the auth library's error code or an error's class name: messages
    // can quote submitted values or connection details.
    if (error instanceof APIError) {
      console.warn("[auth] Sign-in rejected:", error.body?.code ?? error.status);
    } else {
      console.error("[auth] Sign-in failed unexpectedly:", error instanceof Error ? error.name : "unknown error");
    }

    await dependencies.auditFailed(email);
    return { ok: false, message: GENERIC_SIGN_IN_ERROR };
  }
}
