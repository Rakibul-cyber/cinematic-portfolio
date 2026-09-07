"use client";

import { createAuthClient } from "better-auth/react";

import { AUTH_API_BASE_PATH } from "@/lib/admin-routes";

/**
 * Browser-side Better Auth client.
 *
 * This module contains no secrets: it only calls the application's own auth
 * endpoints on the same origin. Server configuration lives in
 * `src/server/auth/config.ts` and must never be imported from the browser.
 */
export const authClient = createAuthClient({
  basePath: AUTH_API_BASE_PATH,
});
