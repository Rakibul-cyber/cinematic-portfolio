import { z } from "zod";

/**
 * Login input contract.
 *
 * Shared between the login form and the Server Action so the browser can give
 * immediate feedback while the server still performs the authoritative check.
 * Deliberately permissive about the password beyond "present": the server must
 * not reveal password policy details of existing accounts, and length rules for
 * new accounts are enforced where accounts are created.
 */
export const adminLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254)
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, "Enter your password.").max(128),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/**
 * The only error message shown for a failed sign-in.
 *
 * A single message for "unknown email", "wrong password", and "inactive
 * account" prevents account enumeration.
 */
export const GENERIC_SIGN_IN_ERROR =
  "Unable to sign in with those credentials.";
