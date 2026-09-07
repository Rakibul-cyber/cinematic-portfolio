import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/server/auth/config";

/**
 * Better Auth HTTP endpoints.
 *
 * The sign-up route is closed by `emailAndPassword.disableSignUp`, so this
 * handler exposes sign-in, sign-out, and session endpoints only.
 */
export const { GET, POST } = toNextJsHandler(auth);
