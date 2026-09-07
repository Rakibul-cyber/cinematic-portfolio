import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildLoginRedirect, isSafeInternalPath } from "@/lib/admin-routes";
import {
  AdminRole,
  isAdminRole,
  isAdministrative,
  roleAtLeast,
} from "@/server/auth/roles";

/**
 * Unit coverage for the pure authorization decisions.
 *
 * Node's built-in test runner is used so Phase 2 adds no testing framework.
 * These modules are kept free of Next.js runtime imports so they stay directly
 * testable. The HTTP-level behaviour (route protection, sessions, sign-out) is
 * verified separately by `scripts/verify-auth-flow.mjs` against a running
 * application.
 *
 * These functions decide who may do what, and the redirect helper decides where
 * an unauthenticated visitor is sent, so both are worth pinning down.
 */

describe("role hierarchy", () => {
  it("treats every role as sufficient for itself", () => {
    for (const role of [AdminRole.EDITOR, AdminRole.ADMIN, AdminRole.SUPER_ADMIN]) {
      assert.equal(roleAtLeast(role, role), true, role);
    }
  });

  it("lets a higher role satisfy a lower requirement", () => {
    assert.equal(roleAtLeast(AdminRole.SUPER_ADMIN, AdminRole.ADMIN), true);
    assert.equal(roleAtLeast(AdminRole.SUPER_ADMIN, AdminRole.EDITOR), true);
    assert.equal(roleAtLeast(AdminRole.ADMIN, AdminRole.EDITOR), true);
  });

  it("never lets a lower role satisfy a higher requirement", () => {
    assert.equal(roleAtLeast(AdminRole.EDITOR, AdminRole.ADMIN), false);
    assert.equal(roleAtLeast(AdminRole.EDITOR, AdminRole.SUPER_ADMIN), false);
    assert.equal(roleAtLeast(AdminRole.ADMIN, AdminRole.SUPER_ADMIN), false);
  });

  it("counts only ADMIN and above as administrative", () => {
    assert.equal(isAdministrative(AdminRole.SUPER_ADMIN), true);
    assert.equal(isAdministrative(AdminRole.ADMIN), true);
    assert.equal(isAdministrative(AdminRole.EDITOR), false);
  });

  it("rejects anything that is not a known role", () => {
    assert.equal(isAdminRole(AdminRole.SUPER_ADMIN), true);
    assert.equal(isAdminRole("OWNER"), false);
    assert.equal(isAdminRole("super_admin"), false);
    assert.equal(isAdminRole(""), false);
    assert.equal(isAdminRole(undefined), false);
    assert.equal(isAdminRole({ role: "ADMIN" }), false);
  });
});

describe("post-login redirect target", () => {
  it("accepts admin paths", () => {
    assert.equal(isSafeInternalPath("/admin"), true);
    assert.equal(isSafeInternalPath("/admin/projects"), true);
    assert.equal(isSafeInternalPath("/admin/projects?status=draft"), true);
  });

  it("refuses off-site and protocol-relative targets", () => {
    assert.equal(isSafeInternalPath("//evil.example/steal"), false);
    assert.equal(isSafeInternalPath("https://evil.example/steal"), false);
    assert.equal(isSafeInternalPath("http://localhost:3000/admin"), false);
    assert.equal(isSafeInternalPath("javascript:alert(1)"), false);
  });

  it("refuses paths outside the admin area", () => {
    assert.equal(isSafeInternalPath("/"), false);
    assert.equal(isSafeInternalPath("/administrator"), false);
    assert.equal(isSafeInternalPath("/api/auth/sign-out"), false);
  });

  it("refuses empty and missing values", () => {
    assert.equal(isSafeInternalPath(""), false);
    assert.equal(isSafeInternalPath(null), false);
    assert.equal(isSafeInternalPath(undefined), false);
  });

  it("carries a safe return path through to the login URL", () => {
    assert.equal(
      buildLoginRedirect("/admin/projects"),
      "/admin/login?next=%2Fadmin%2Fprojects",
    );
  });

  it("drops an unsafe or pointless return path", () => {
    assert.equal(buildLoginRedirect("https://evil.example"), "/admin/login");
    assert.equal(buildLoginRedirect("/admin/login"), "/admin/login");
    assert.equal(buildLoginRedirect(undefined), "/admin/login");
  });
});
