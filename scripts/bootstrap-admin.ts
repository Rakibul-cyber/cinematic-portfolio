/**
 * Controlled bootstrap for the first administrator.
 *
 * This is the only way an administrator account can be created in Phase 2.
 * There is no public sign-up route: Better Auth's sign-up endpoint is closed by
 * `emailAndPassword.disableSignUp`, so no anonymous visitor can provision an
 * account from the website.
 *
 * Usage:
 *
 *   npm run admin:bootstrap -- --email you@example.com --name "Your Name"
 *
 * The password is never taken from the command line (shell history) or from
 * source. It is read from the local `ADMIN_BOOTSTRAP_PASSWORD` environment
 * variable, which the operator sets for a single invocation and does not commit:
 *
 *   PowerShell:  $env:ADMIN_BOOTSTRAP_PASSWORD = 'a strong unique password'
 *   bash:        export ADMIN_BOOTSTRAP_PASSWORD='a strong unique password'
 *
 * Hashing is performed by Better Auth's own password hasher (obtained from
 * `auth.$context`), so this script never implements password cryptography
 * itself. Better Auth's HTTP sign-up endpoint is closed, and closing it also
 * closes the equivalent server API, so the account rows are written directly
 * with the library-produced hash. The password is never printed, never logged,
 * and never written to the audit trail.
 *
 * The script runs with `--conditions=react-server` so the `server-only` markers
 * in the imported modules resolve to a no-op outside the Next.js bundler, and
 * with `--env-file-if-exists=.env.local` so credentials are present before the
 * auth configuration is evaluated. See the `admin:bootstrap` package script.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { AdminRole } from "@/generated/prisma/enums";
import {
  AuditAction,
  AuditEntityType,
  recordAuditLog,
} from "@/server/audit/audit-log";
import { auth } from "@/server/auth/config";
import { prisma } from "@/server/db/prisma";

type BootstrapArgs = {
  email: string;
  name: string;
  role: AdminRole;
};

const MINIMUM_PASSWORD_LENGTH = 12;

function fail(message: string): never {
  console.error(`\n  Bootstrap aborted: ${message}\n`);
  process.exit(1);
}

function readArgs(): BootstrapArgs {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: AdminRole.SUPER_ADMIN },
    },
    allowPositionals: false,
  });

  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  const role = values.role;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("--email is required and must be a valid email address.");
  }

  if (!name) {
    fail('--name is required, for example --name "Studio Owner".');
  }

  if (!role || !(role in AdminRole)) {
    fail(`--role must be one of ${Object.keys(AdminRole).join(", ")}.`);
  }

  return { email, name, role: role as BootstrapArgs["role"] };
}

function readPassword(): string {
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!password) {
    fail(
      "ADMIN_BOOTSTRAP_PASSWORD is not set. Set it in your shell for this " +
        "invocation only; never pass a password as a command-line argument " +
        "and never commit it.",
    );
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    fail(
      `ADMIN_BOOTSTRAP_PASSWORD must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
    );
  }

  return password;
}

async function main(): Promise<void> {
  const { email, name, role } = readArgs();
  const password = readPassword();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (existing) {
    fail(
      `A user with that email already exists (current role: ${existing.role}). ` +
        "Delete it or choose another email; this script does not reset passwords.",
    );
  }

  // Use Better Auth's configured password hasher so the stored hash is exactly
  // what its sign-in path expects.
  const context = await auth.$context;
  const passwordHash = await context.password.hash(password);

  const userId = randomUUID();

  // The user row and its credential account are written together: a user
  // without a credential account could never sign in.
  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        id: userId,
        name,
        email,
        role,
        // No transactional email provider exists until Phase 7, and a
        // deliberately provisioned administrator address needs no proving.
        emailVerified: true,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await tx.account.create({
      data: {
        id: randomUUID(),
        userId: createdUser.id,
        // Better Auth's credential provider looks the account up by this exact
        // provider id with `accountId` equal to the user id.
        providerId: "credential",
        accountId: createdUser.id,
        password: passwordHash,
      },
    });

    return createdUser;
  });

  await recordAuditLog({
    action: AuditAction.AdminUserBootstrapped,
    entityType: AuditEntityType.AdminUser,
    entityId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    metadata: { role: user.role, createdBy: "scripts/bootstrap-admin.ts" },
  });

  console.log(
    `\n  Created ${user.role} "${user.name}" <${user.email}>.` +
      "\n  Sign in at /admin/login, then clear ADMIN_BOOTSTRAP_PASSWORD from your shell.\n",
  );
}

main()
  // Report any failure without echoing the submitted credentials.
  .catch((error: unknown) =>
    fail(error instanceof Error ? error.message : "unexpected error"),
  )
  .finally(() => prisma.$disconnect());
