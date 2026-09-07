import { AdminRole } from "@/generated/prisma/enums";

export { AdminRole };

/**
 * Ordered role list, least to most privileged.
 *
 * Phase 2 deliberately implements a simple ordered hierarchy rather than a
 * permissions engine. Feature-level permissions are introduced with the admin
 * features that need them.
 */
export const ADMIN_ROLES = [
  AdminRole.EDITOR,
  AdminRole.ADMIN,
  AdminRole.SUPER_ADMIN,
] as const;

/** Roles that may be assigned by the initial bootstrap script or admin tooling. */
export const ADMIN_ROLE_VALUES = ADMIN_ROLES.map(String) as [string, ...string[]];

const roleRank: Record<AdminRole, number> = {
  [AdminRole.EDITOR]: 0,
  [AdminRole.ADMIN]: 1,
  [AdminRole.SUPER_ADMIN]: 2,
};

/** Human-readable label for admin UI. */
export const roleLabels: Record<AdminRole, string> = {
  [AdminRole.SUPER_ADMIN]: "Super admin",
  [AdminRole.ADMIN]: "Admin",
  [AdminRole.EDITOR]: "Editor",
};

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(role: AdminRole, minimum: AdminRole): boolean {
  return roleRank[role] >= roleRank[minimum];
}

/** True when `role` has general administrative access. */
export function isAdministrative(role: AdminRole): boolean {
  return roleAtLeast(role, AdminRole.ADMIN);
}

/** Narrows an unknown value to a known role. */
export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && value in roleRank;
}
